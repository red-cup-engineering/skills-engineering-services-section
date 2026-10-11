import assert from "node:assert/strict";
import test from "node:test";
import { inspectInferenceResources } from "../../src/dispatch/inference-resource-inspection.mjs";
import { invokeInspectInferenceResources } from "../../src/dispatch/inference-dispatch-mcp-contract.mjs";
import { loadDirectEndpointProviderDescriptors } from "../../src/dispatch/direct-endpoint-provider.mjs";

const now = () => "2026-09-07T12:00:00.000Z";
function fixture() {
  return loadDirectEndpointProviderDescriptors({ DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([{
    provider: "urn:provider:fixture", endpoint: "https://example.invalid/chat?private=endpoint-secret",
    apiKey: "credential-must-stay-private", model: "fixture-model", capabilities: ["text-output"],
    declaredResources: [{ resource: "requests", unit: "request", amount: { numerator: "1", denominator: "1" } }],
  }]) });
}

test("inspection exposes explicit dimensions and filters without leaking credentials or claiming liveness", async () => {
  const result = await inspectInferenceResources({ zeroCashOnly: true, requiredCapabilities: ["json-schema-output"] }, { loadDescriptors: fixture, now });
  assert.equal(result.eligibleProviders, 0);
  const provider = result.providers[0];
  assert.deepEqual(provider.reasons, ["missing-capability:json-schema-output", "zero-cash-entitlement-not-admitted"]);
  assert.equal(provider.reachability, "unobserved");
  assert.equal(provider.reservation.disposition, "unmanaged");
  assert.equal(provider.declaredResources[0].amount.numerator, "1");
  assert.ok(provider.configurationIdentity.startsWith("ni:///sha-256;"));
  assert.doesNotMatch(JSON.stringify(result), /credential-must-stay-private|endpoint-secret|apiKey|https:/u);
});

test("model aliases share one read of their authoritative account without writes or transport", async () => {
  const descriptors = fixture();
  const binding = { providerIdentity: descriptors[0].provider, accountIdentity: "urn:account:fixture", windowIdentity: "urn:window:fixture" };
  const remaining = [{ resource: "requests", unit: "request", amount: { numerator: "0", denominator: "1" } }];
  let reads = 0;
  const result = await inspectInferenceResources({}, {
    now, loadDescriptors: () => [descriptors[0], { ...descriptors[0], model: "second-model" }],
    resourceReservations: { store: {}, resolveBinding: () => binding },
    observeResources: async (request) => {
      reads += 1;
      assert.equal(request.evaluatedAt, now());
      assert.equal(request.binding, binding);
      return { type: "WorkResourceAvailabilityObservation", disposition: "observed", availableResources: remaining, version: "7" };
    },
  });
  assert.equal(reads, 1);
  assert.equal(result.reservationAccountsObserved, 1);
  assert.deepEqual(result.providers[1].reservation.availableResources, remaining);
  assert.equal(result.providers[0].configuredCapacity, 1);
  assert.equal(result.providers[0].reservation.availableResources[0].amount.numerator, "0");
});

test("failed capacity reads stay unknown and private exception text never becomes public evidence", async () => {
  const result = await inspectInferenceResources({}, {
    now, loadDescriptors: fixture,
    resourceReservations: { resolveBinding() { throw new Error("https://secret.example/?key=credential-secret"); } },
  });
  assert.equal(result.providers[0].reservation.disposition, "refused");
  assert.equal(result.providers[0].reservation.availableResources, undefined);
  assert.doesNotMatch(JSON.stringify(result), /credential-secret|secret.example/u);
  const invalid = await inspectInferenceResources({}, { now, loadDescriptors() { throw new Error("configuration-secret"); } });
  assert.equal(invalid.disposition, "refused");
  assert.doesNotMatch(JSON.stringify(invalid), /configuration-secret/u);
});

test("MCP inspection admits no caller-owned authority, arbitrary path, or inference request", async () => {
  for (const input of [{ objective: "invoke" }, { environment: { API_KEY: "secret" } }, { configPath: "/private" }, { resourceReservations: {} }]) {
    const result = await invokeInspectInferenceResources(input, { loadDescriptors() { assert.fail("invalid request reached loader"); } });
    assert.equal(result.isError, true);
  }
  const result = await invokeInspectInferenceResources({}, { loadDescriptors: fixture, now });
  assert.equal(result.isError, false);
});

test("routine MCP inspection keeps configured-model evidence; full enumeration is explicit", async () => {
  const descriptor = fixture()[0];
  const catalog = {
    type: "ProviderModelCatalogObservation", providerIdentity: descriptor.provider,
    observedAt: now(), disposition: "observed", source: "https://example.invalid",
    models: Array.from({ length: 1000 }, (_, i) => ({
      id: i === 19 ? descriptor.model : `other-model-${i}`,
      capabilities: ["chat"], limits: { contextWindowTokens: 32768 },
    })),
  };
  let observations = 0;
  const ports = { loadDescriptors: fixture, now, observeCatalogs: async () => { observations += 1; return [catalog]; } };
  const ordinary = await invokeInspectInferenceResources({}, ports);
  const enumerated = await invokeInspectInferenceResources({ includeCatalogModels: true }, ports);
  assert.equal(ordinary.isError, false);
  assert.equal(enumerated.isError, false);
  const brief = ordinary.structuredContent.providers[0].modelCatalog;
  const full = enumerated.structuredContent.providers[0].modelCatalog;
  assert.equal(brief.totalModels, 1000);
  assert.equal(brief.configuredModelDisposition, "listed");
  assert.deepEqual(brief.models, [catalog.models[19]]);
  assert.deepEqual(full.models, catalog.models);
  for (const key of ["type", "providerIdentity", "observedAt", "disposition", "source"]) assert.equal(brief[key], catalog[key]);
  const withoutCatalog = ({ modelCatalog, ...provider }) => provider;
  assert.deepEqual(withoutCatalog(ordinary.structuredContent.providers[0]), withoutCatalog(enumerated.structuredContent.providers[0]));
  assert.equal(observations, 2);
  assert.equal(catalog.models.length, 1000);
  assert.ok(JSON.stringify(ordinary).length < JSON.stringify(enumerated).length / 20);
  const invalid = await invokeInspectInferenceResources({ includeCatalogModels: "true" }, ports);
  assert.equal(invalid.isError, true);
  assert.equal(observations, 2);
});

test("catalog availability distinguishes a missing configured model from unknown membership", async () => {
  for (const disposition of ["observed", "refused", "unavailable", "not-listed"]) {
    const result = await inspectInferenceResources({}, {
      loadDescriptors: fixture, now,
      observeCatalogs: async () => [{ providerIdentity: fixture()[0].provider, disposition, observedAt: now(), models: [] }],
    });
    assert.equal(result.providers[0].modelCatalog.configuredModelDisposition, disposition === "observed" ? "not-listed" : "unknown");
    assert.deepEqual(result.providers[0].modelCatalog.models, []);
    // Catalog membership is evidence, not an inferred provider entitlement.
    assert.equal(result.providers[0].eligibility, "admitted-by-requested-filters");
  }
});
