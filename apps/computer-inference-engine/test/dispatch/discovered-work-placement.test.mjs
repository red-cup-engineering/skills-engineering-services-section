import assert from "node:assert/strict";
import test from "node:test";
import {
  CURRENT_PLACEMENT_PROFILE_KIND,
  decideDiscoveredWorkPlacement,
} from "../../src/dispatch/discovered-work-placement.mjs";

const q = (numerator, denominator = 1) => ({ numerator: String(numerator), denominator: String(denominator) });
const quota = (amount, asset) => ({ resource: "inference-quota", asset, unit: "call", amount: q(amount) });

function demand(overrides = {}) {
  return {
    type: "TypedWorkDemand",
    id: "urn:demand:discovered",
    taskClass: "derive",
    principal: "urn:actor:customer",
    requiredCapabilities: ["inquiry"],
    requiredQualityTiers: [],
    requiredEffects: ["read-only"],
    requiredExecutionClasses: ["remote-inference"],
    idempotence: "idempotent",
    context: {
      identity: "ni:///sha-256;context",
      authorityScope: "urn:scope:customer",
      freshnessIdentity: "urn:freshness:current",
      dataConstraints: [],
      custodyConstraints: [],
    },
    outputContract: { identity: "ni:///sha-256;output" },
    measures: {},
    routePolicy: {
      preferenceOrder: [["consideration-per-acceptance"], ["resources"], ["acceptance-probability"]],
      considerationPreference: [],
      considerationCeilings: [],
      resourceCeilings: [],
      reuse: "forbid",
      unknownObservations: "choice-required",
    },
    ...overrides,
  };
}

function candidate(id, overrides = {}) {
  const operation = overrides.operation ?? "derive";
  return {
    offer: `urn:offer:${id}`,
    cell: `urn:cell:${id}`,
    sku: `urn:sku:${id}`,
    activity: `https://${id}.example/activities/offer`,
    publisher: `https://${id}.example/actors/provider`,
    provider: `urn:ame:${id}`,
    operation,
    law: `urn:law:${id}`,
    agentCard: `https://${id}.example/agent-card.json`,
    coordinates: {
      packageOperation: {
        kind: "reference",
        href: `https://${id}.example/package#${operation}`,
        operation,
        invocation: `https://${id}.example/invoke`,
      },
      resourceMeter: { kind: "reference", href: `https://${id}.example/meter` },
    },
    ...overrides,
  };
}

function discovery(candidates) {
  return Object.freeze({
    kind: "org.emsenn.capability-offer-discovery.result.v1",
    provider: "urn:ame:federated-capability-offer-discovery-cell",
    request: "ni:///sha-256;request",
    operation: "derive",
    denominator: candidates.map(({ publisher }) => `${publisher}/outbox`),
    completeness: "supplied-denominator-only",
    candidates,
    refusals: [],
    residuals: [],
    receipt: { id: "urn:receipt:discovery" },
  });
}

function profile(candidateValue, { cost = 0, quotaAsset = `urn:quota:${candidateValue.provider}`, available = 1, overrides = {} } = {}) {
  const packageOperation = candidateValue.coordinates.packageOperation;
  return {
    kind: CURRENT_PLACEMENT_PROFILE_KIND,
    offer: candidateValue.offer,
    provider: candidateValue.provider,
    operation: candidateValue.operation,
    sku: candidateValue.sku,
    law: candidateValue.law,
    packageOperation: {
      href: packageOperation.href,
      operation: packageOperation.operation,
      invocation: packageOperation.invocation,
    },
    workOffer: {
      executionClass: "remote-inference",
      implementationIdentity: `urn:implementation:${candidateValue.provider}`,
      capabilities: ["chat", "inquiry"],
      qualityTiers: [],
      authorityScopes: ["urn:scope:customer"],
      effects: ["read-only"],
      idempotence: ["idempotent"],
      dataConstraints: [],
      custodyConstraints: [],
      outputContractIdentities: ["ni:///sha-256;output"],
      availability: "available",
      availableCapacity: 1,
      bounds: {},
      consideration: [{ kind: "currency", asset: "urn:currency:usd", unit: "cent", amount: q(cost) }],
      declaredResources: [quota(1, quotaAsset)],
      availableResources: [quota(available, quotaAsset)],
      semantics: { reuse: "none" },
    },
    ...overrides,
  };
}

test("selects from complete discovered candidates and preserves discovery plus the exact invocation coordinate", async () => {
  const expensive = candidate("expensive");
  const cheap = candidate("cheap");
  const observed = discovery([expensive, cheap]);
  const calls = [];
  const result = await decideDiscoveredWorkPlacement({
    demand: demand(),
    discovery: observed,
    resolvePlacementProfile: async (request) => {
      calls.push(request);
      return profile(request.candidate, { cost: request.candidate === cheap ? 1 : 9, quotaAsset: "urn:quota:shared" });
    },
  });
  assert.equal(result.disposition, "selected");
  assert.equal(result.selected.offerId, cheap.offer);
  assert.equal(result.discoveryProvenance, observed);
  assert.deepEqual(result.selectedInvocation, {
    href: cheap.coordinates.packageOperation.href,
    operation: "derive",
    invocation: cheap.coordinates.packageOperation.invocation,
  });
  assert.deepEqual(calls.map(({ href }) => href), [expensive.coordinates.resourceMeter.href, cheap.coordinates.resourceMeter.href]);
});

test("residual resourceMeter and packageOperation coordinates become typed refusals without resolving", async () => {
  const missingMeter = candidate("missing-meter", { coordinates: {
    packageOperation: candidate("missing-meter").coordinates.packageOperation,
    resourceMeter: { kind: "org.emsenn.capability-offer.coordinate-residual.v1", coordinate: "resourceMeter", state: "missing", reason: "not published" },
  } });
  const missingInvocation = candidate("missing-invocation", { coordinates: {
    packageOperation: { kind: "reference", href: "https://missing-invocation.example/package", operation: "derive" },
    resourceMeter: { kind: "reference", href: "https://missing-invocation.example/meter" },
  } });
  let resolutions = 0;
  const result = await decideDiscoveredWorkPlacement({
    demand: demand(),
    discovery: discovery([missingMeter, missingInvocation]),
    resolvePlacementProfile: async () => { resolutions += 1; },
  });
  assert.equal(result.disposition, "refused");
  assert.equal(resolutions, 0);
  assert.deepEqual(result.refusals, [
    { offerId: missingMeter.offer, reasons: ["offer-coordinate-residual:resourceMeter:missing"] },
    { offerId: missingInvocation.offer, reasons: ["offer-coordinate-missing:packageOperation.invocation"] },
  ]);
});

test("a placement profile with drifted provider identity is refused", async () => {
  const offered = candidate("drift");
  const result = await decideDiscoveredWorkPlacement({
    demand: demand(),
    discovery: discovery([offered]),
    resolvePlacementProfile: async () => profile(offered, { overrides: { provider: "urn:ame:other" } }),
  });
  assert.equal(result.disposition, "refused");
  assert.deepEqual(result.refusals, [{ offerId: offered.offer, reasons: ["placement-profile-identity-drift:provider"] }]);
});

test("a candidate operation differing from its discovery operation is refused before resolution", async () => {
  const drifted = candidate("operation-drift", { operation: "summarize" });
  let resolutions = 0;
  const result = await decideDiscoveredWorkPlacement({
    demand: demand(),
    discovery: discovery([drifted]),
    resolvePlacementProfile: async () => { resolutions += 1; },
  });
  assert.equal(result.disposition, "refused");
  assert.equal(resolutions, 0);
  assert.deepEqual(result.refusals, [{
    offerId: drifted.offer,
    reasons: ["discovery-candidate-identity-drift:operation"],
  }]);
});

test("duplicate candidate offer identities reject the discovery before any resolution", async () => {
  const first = candidate("duplicate");
  const second = candidate("other", { offer: first.offer });
  let resolutions = 0;
  await assert.rejects(
    decideDiscoveredWorkPlacement({
      demand: demand(),
      discovery: discovery([first, second]),
      resolvePlacementProfile: async () => { resolutions += 1; },
    }),
    { name: "TypeError", message: "discovery candidates must not repeat an offer identity" },
  );
  assert.equal(resolutions, 0);
});

test("exactly exhausted provider quota is refused by the existing work placement decision", async () => {
  const exhausted = candidate("exhausted");
  const result = await decideDiscoveredWorkPlacement({
    demand: demand(),
    discovery: discovery([exhausted]),
    resolvePlacementProfile: async () => profile(exhausted, { available: 0 }),
  });
  assert.equal(result.disposition, "refused");
  assert.deepEqual(result.refusals, [{
    offerId: exhausted.offer,
    reasons: ["resource-quota-exhausted:inference-quota:urn:quota:urn:ame:exhausted:call"],
  }]);
});

test("distinct paid entitlement resources remain incomparable without cross-asset conversion", async () => {
  const alpha = candidate("alpha");
  const beta = candidate("beta");
  const result = await decideDiscoveredWorkPlacement({
    demand: demand(),
    discovery: discovery([alpha, beta]),
    resolvePlacementProfile: async ({ candidate: offered }) => profile(offered, {
      cost: 0,
      quotaAsset: `urn:paid-entitlement:${offered.provider}`,
      available: 10,
    }),
  });
  assert.equal(result.disposition, "choice-required");
  assert.equal(result.selected, null);
  assert.equal(result.selectedInvocation, null);
  assert.equal(result.attemptPlan[0].relation, "incomparable");
  assert.equal(result.attemptPlan[0].implicitFallbackPermitted, false);
});
