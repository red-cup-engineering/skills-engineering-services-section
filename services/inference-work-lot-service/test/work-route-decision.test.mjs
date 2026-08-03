import assert from "node:assert/strict";
import test from "node:test";
import { decideWorkRoute } from "../src/work-route-decision.mjs";

const q = (numerator, denominator = 1) => ({ numerator: String(numerator), denominator: String(denominator) });
const credit = (amount, asset = "urn:credit:resolution") => ({ kind: "credit", asset, unit: "milliquanta", amount: q(amount) });
const resource = (amount) => ({ resource: "provider-call", unit: "call", amount: q(amount) });

function demand(overrides = {}) {
  return {
    type: "TypedWorkDemand",
    id: "urn:demand:one",
    taskClass: "bounded-extraction",
    principal: "urn:actor:customer",
    requiredCapabilities: ["extraction", "json-output"],
    requiredQualityTiers: [],
    effect: "read-only",
    idempotence: "idempotent",
    context: { identity: "ni:///sha-256;context", authorityScope: "urn:scope:public", freshnessIdentity: "urn:freshness:immutable" },
    outputContract: { identity: "ni:///sha-256;schema" },
    difficulty: q(1, 2),
    measures: { sourceCharacters: 100, outputTokens: 20 },
    routePolicy: {
      preferenceOrder: [["consideration"], ["acceptance-probability"], ["latency", "resources"]],
      considerationPreference: [],
      reuse: "forbid",
      unknownObservations: "choice-required",
    },
    ...overrides,
  };
}
function offer(id, amount, overrides = {}) {
  return {
    type: "NormalizedEndpointOffer",
    id,
    provider: "urn:provider:" + id.slice("urn:offer:".length),
    endpointClass: "bounded-inference",
    operation: "derive",
    implementationIdentity: "ni:///sha-256;implementation",
    capabilities: ["extraction", "json-output"],
    qualityTiers: ["bounded"],
    authorityScopes: ["urn:scope:public"],
    effects: ["read-only"],
    idempotence: ["idempotent"],
    availability: "available",
    availableCapacity: 1,
    bounds: { maximumDifficulty: q(1), maximumSourceCharacters: 1000, maximumOutputTokens: 100 },
    consideration: [credit(amount)],
    declaredResources: [resource(1)],
    semantics: { reuse: "none" },
    ...overrides,
  };
}
function attempt(offerId, suffix, outcome, latency, calls = 1) {
  return {
    type: "RouteReceipt",
    kind: "attempt",
    receipt: "urn:receipt:" + suffix,
    offerId,
    taskClass: "bounded-extraction",
    outcome,
    latency: { unit: "millisecond", amount: q(latency) },
    resources: [resource(calls)],
  };
}

test("exact capability and bounds feasibility precede price preference", () => {
  const result = decideWorkRoute({
    demand: demand(),
    offers: [
      offer("urn:offer:cheap-incomplete", 1, { capabilities: ["extraction"] }),
      offer("urn:offer:complete", 8),
    ],
  });
  assert.equal(result.disposition, "selected");
  assert.equal(result.selected.offerId, "urn:offer:complete");
  assert.deepEqual(result.refused, [{ offerId: "urn:offer:cheap-incomplete", reasons: ["missing-capability:json-output"] }]);
});

test("non-commensurate consideration remains a customer choice with no implicit execution behavior", () => {
  const result = decideWorkRoute({
    demand: demand(),
    offers: [offer("urn:offer:credit", 2), offer("urn:offer:currency", 1, { consideration: [{ kind: "currency", asset: "urn:currency:usd", unit: "cent", amount: q(1) }] })],
  });
  assert.equal(result.disposition, "choice-required");
  assert.equal(result.selected, null);
  assert.equal(result.attemptPlan[0].relation, "incomparable");
  assert.equal(result.attemptPlan[0].implicitFallbackPermitted, false);
  assert.equal(result.attemptPlan[0].speculativeExecutionPermitted, false);
  assert.equal(result.attemptPlan[0].stopCondition, "customer-assayed-acceptance");
});

test("customer-authored consideration preference may order assets without conversion", () => {
  const preferredCurrency = [{ kind: "currency", asset: "urn:currency:usd", unit: "cent" }];
  const allowedCredit = [{ kind: "credit", asset: "urn:credit:resolution", unit: "milliquanta" }];
  const result = decideWorkRoute({
    demand: demand({ routePolicy: { ...demand().routePolicy, considerationPreference: [preferredCurrency, allowedCredit] } }),
    offers: [offer("urn:offer:credit", 1), offer("urn:offer:currency", 99, { consideration: [{ ...preferredCurrency[0], amount: q(99) }] })],
  });
  assert.equal(result.selected.offerId, "urn:offer:currency");
});

test("observed acceptance, latency, and resources form exact ordered Pareto criteria", () => {
  const slow = offer("urn:offer:slow", 4);
  const fast = offer("urn:offer:fast", 4);
  const observations = [
    attempt(slow.id, "slow-1", "accepted", 100, 2),
    attempt(slow.id, "slow-2", "accepted", 80, 2),
    attempt(fast.id, "fast-1", "accepted", 20, 1),
    attempt(fast.id, "fast-2", "accepted", 40, 1),
  ];
  const result = decideWorkRoute({ demand: demand(), offers: [slow, fast], observations });
  assert.equal(result.disposition, "selected");
  assert.equal(result.selected.offerId, fast.id);
  assert.deepEqual(result.attemptPlan[0].offers[0].observationBasis, { attempts: 2, accepted: 2, receipts: ["urn:receipt:fast-1", "urn:receipt:fast-2"] });
});

test("stable offer id breaks only an exact metric equivalence", () => {
  const result = decideWorkRoute({ demand: demand(), offers: [offer("urn:offer:z", 4), offer("urn:offer:a", 4)] });
  assert.equal(result.disposition, "selected");
  assert.equal(result.selected.offerId, "urn:offer:a");
  assert.match(result.rationale.join(" "), /equivalent-candidates-stable-offer-id/u);
});

test("reuse requires exact accepted coordinates and explicit permission on demand and offer", () => {
  const reusable = offer("urn:offer:reusable", 9, { semantics: { reuse: "exact-accepted-result" } });
  const fresh = offer("urn:offer:fresh", 1);
  const exactReceipt = {
    type: "RouteReceipt",
    kind: "accepted-result",
    receipt: "urn:receipt:accepted-result-observation",
    resultReceipt: "urn:receipt:original-result",
    offerId: reusable.id,
    taskClass: "bounded-extraction",
    demandId: "urn:demand:one",
    principal: "urn:actor:customer",
    contextIdentity: "ni:///sha-256;context",
    authorityScope: "urn:scope:public",
    freshnessIdentity: "urn:freshness:immutable",
    outputContractIdentity: "ni:///sha-256;schema",
    implementationIdentity: "ni:///sha-256;implementation",
    outcome: "accepted",
    reuse: "permitted",
  };
  const reuseDemand = demand({ routePolicy: { ...demand().routePolicy, reuse: "prefer-exact-accepted" } });
  const reused = decideWorkRoute({ demand: reuseDemand, offers: [reusable, fresh], observations: [exactReceipt] });
  assert.equal(reused.selected.offerId, reusable.id);
  assert.equal(reused.selected.mode, "reuse-exact-accepted-result");
  assert.equal(reused.selected.reuseReceipt, "urn:receipt:original-result");

  const crossPrincipal = decideWorkRoute({ demand: reuseDemand, offers: [reusable, fresh], observations: [{ ...exactReceipt, principal: "urn:actor:other" }] });
  assert.equal(crossPrincipal.selected.offerId, fresh.id);
  assert.equal(crossPrincipal.selected.mode, "execute");
});

test("premium is an ordinary required quality tier and never a provider-name branch", () => {
  const premium = offer("urn:offer:arbitrary-actor", 8, { provider: "urn:provider:not-codex", endpointClass: "customer-session", qualityTiers: ["premium-review"] });
  const ordinary = offer("urn:offer:name-contains-codex", 1, { provider: "urn:provider:codex", qualityTiers: ["bounded"] });
  const result = decideWorkRoute({ demand: demand({ requiredQualityTiers: ["premium-review"] }), offers: [ordinary, premium] });
  assert.equal(result.selected.offerId, premium.id);
  assert.equal(result.selected.provider, "urn:provider:not-codex");
  assert.deepEqual(result.refused, [{ offerId: ordinary.id, reasons: ["missing-quality-tier:premium-review"] }]);
});

test("absence of an exactly feasible endpoint returns a typed refusal", () => {
  const result = decideWorkRoute({ demand: demand(), offers: [offer("urn:offer:none", 1, { availableCapacity: 0 })] });
  assert.equal(result.disposition, "refused");
  assert.equal(result.selected, null);
  assert.deepEqual(result.attemptPlan, []);
});
