import assert from "node:assert/strict";
import test from "node:test";
import { ROLE_USER } from "@red-cup-engineering/a2a-services-section/a2a-client";
import { senPart } from "@red-cup-engineering/a2a-services-section/sen-part";
import { loadDirectEndpointProviderDescriptors } from "../../src/dispatch/direct-endpoint-provider.mjs";
import { dispatchInference } from "../../src/dispatch/inference-dispatch.mjs";
import { invokeDispatchInference } from "../../src/dispatch/inference-dispatch-mcp-contract.mjs";
import { identifyJsonValue } from "../../src/dispatch/sen-carrier.mjs";
import { createInferenceResourceReservationRuntime } from "../../src/dispatch/resource-reservation-runtime.mjs";
import { executeA2aMessage } from "../../scripts/dispatch/execute-a2a-task.mjs";

const binding = { providerIdentity: "urn:provider:fixture", accountIdentity: "urn:account:fixture", windowIdentity: "urn:window:fixture",
  evidenceIdentity: "urn:evidence:fixture", observedAt: "2026-09-07T00:00:00Z", validFrom: "2026-09-07T00:00:00Z",
  validUntil: "2026-09-07T01:00:00Z", resetsAt: "2026-09-07T01:00:00Z",
  availableResources: [{ resource: "requests", unit: "request", amount: { numerator: "1", denominator: "1" } }],
  financialControl: { type: "WorkResourceFinancialControl", costState: "observed", costEvidenceIdentity: "urn:evidence:cost",
    costObservedAt: "2026-09-07T00:00:00Z", costValidUntil: "2100-01-01T00:00:00Z",
    consideration: [{ kind: "currency", asset: "urn:currency:usd", unit: "cent", amount: { numerator: "0", denominator: "1" } }],
    billing: { status: "not-required" }, meterEvidenceIdentity: "urn:evidence:meter",
    meterObservedAt: "2026-09-07T00:00:00Z", meterValidUntil: "2100-01-01T00:00:00Z" } };

function memoryStore() {
  const rows = new Map();
  return { async get(key) { return structuredClone(rows.get(key)); }, async compareAndSet(key, expected, value) {
    if ((rows.get(key)?.version ?? null) !== expected) throw new Error("stale expected version");
    const stored = { ...structuredClone(value), version: String(Number(expected ?? 0) + 1) }; rows.set(key, stored); return stored;
  } };
}

function independentlyConstructedStores() {
  const rows = new Map();
  return () => ({ async get(key) { return structuredClone(rows.get(key)); }, async compareAndSet(key, expected, value) {
    if ((rows.get(key)?.version ?? null) !== expected) throw new Error("stale expected version");
    const stored = { ...structuredClone(value), version: String(Number(expected ?? 0) + 1) }; rows.set(key, stored); return stored;
  } });
}

function runtime(store = memoryStore()) {
  return createInferenceResourceReservationRuntime({
    environment: { INFERENCE_RESOURCE_RESERVATION_SQLITE_PATH: "fixture", INFERENCE_RESOURCE_RESERVATION_BINDINGS: JSON.stringify([binding]) },
    createStore: () => store,
  });
}

test("absent, partial, or invalid reservation configuration fails closed", () => {
  for (const environment of [
    {},
    { INFERENCE_RESOURCE_RESERVATION_SQLITE_PATH: "fixture" },
    { INFERENCE_RESOURCE_RESERVATION_SQLITE_PATH: "fixture", INFERENCE_RESOURCE_RESERVATION_BINDINGS: "not-json" },
    { INFERENCE_RESOURCE_RESERVATION_SQLITE_PATH: "fixture", INFERENCE_RESOURCE_RESERVATION_BINDINGS: JSON.stringify([binding, binding]) },
  ]) assert.throws(() => createInferenceResourceReservationRuntime({ environment, createStore: memoryStore }).resolveBinding({ provider: binding.providerIdentity }), /resource-reservations-unavailable/);
});

test("an unset runtime cannot send a direct endpoint request", async () => {
  const descriptor = loadDirectEndpointProviderDescriptors({ API_KEY_OPENROUTER: "fixture-only" }).find((item) => item.zeroCashEligible);
  assert.ok(descriptor);
  let calls = 0;
  const result = await dispatchInference({
    objective: "return fixture", context: "bounded fixture", workLotId: "urn:fixture:unconfigured-reservation-runtime", zeroCashOnly: true,
    agentBounds: { maximumRequests: 1, maximumOutputTokens: 100, maximumTokensPerRequest: 100, maximumDepth: 0 },
  }, {
    resourceReservations: createInferenceResourceReservationRuntime({ environment: {}, createStore: memoryStore }),
    directDescriptors: [{ ...descriptor, declaredResources: [] }], pricingRoot: null,
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directTransport: async () => { calls += 1; throw new Error("transport must remain behind resource admission"); },
  });
  assert.equal(calls, 0);
  assert.equal(result.outcome, "market-residue");
  assert.match(result.directLaneRefusals[0].reason, /resource-reservations-unavailable:operator-configuration-missing/);
});

test("the operator database path reaches the private durable-store composer", () => {
  let options;
  const composed = createInferenceResourceReservationRuntime({
    environment: { INFERENCE_RESOURCE_RESERVATION_SQLITE_PATH: "/tmp/operator-reservations.sqlite", INFERENCE_RESOURCE_RESERVATION_BINDINGS: JSON.stringify([binding]) },
    createStore(value) { options = value; return memoryStore(); },
  });
  assert.deepEqual(options, { path: "/tmp/operator-reservations.sqlite" });
  assert.deepEqual(composed.resolveBinding({ provider: binding.providerIdentity }), binding);
});

test("MCP and A2A adapters pass the same private reservation authority without admitting it in their public inputs", async () => {
  const shared = runtime();
  let mcpOptions, a2aOptions;
  const dispatch = async (_input, options) => { mcpOptions = options; return { outcome: "candidate-pending-codex-acceptance" }; };
  const mcp = await invokeDispatchInference({ objective: "fixture" }, { resourceReservations: shared, dispatch });
  assert.equal(mcp.isError, false);
  assert.equal(mcpOptions.resourceReservations, shared);
  const request = { objective: "fixture", context: "bounded fixture" };
  const source = { messageId: "adapter-request", contextId: "adapter-context", role: ROLE_USER,
    parts: [senPart(identifyJsonValue(request).bytes, "work-lot.sen.cbor")], metadata: {}, extensions: [], referenceTaskIds: [] };
  await executeA2aMessage(source, { resourceReservations: shared, contract: async (_input, options) => {
    a2aOptions = options; return { outcome: "candidate-pending-codex-acceptance", integrationAccepted: false };
  } });
  assert.equal(a2aOptions.resourceReservations, shared);
});

test("one MCP and one A2A request contend through the same server-owned account window before transport", async () => {
  const descriptor = loadDirectEndpointProviderDescriptors({ API_KEY_OPENROUTER: "fixture-only" }).find((item) => item.zeroCashEligible);
  assert.ok(descriptor);
  const instant = Date.now();
  const accountBinding = { ...binding, providerIdentity: descriptor.provider,
    observedAt: new Date(instant - 60_000).toISOString(), validFrom: new Date(instant - 60_000).toISOString(),
    validUntil: new Date(instant + 60_000).toISOString(), resetsAt: new Date(instant + 60_000).toISOString(), availableResources: [
    { resource: "requests", unit: "request", amount: { numerator: "1", denominator: "1" } },
    { resource: "output-tokens", unit: "token", amount: { numerator: "100", denominator: "1" } },
  ] };
  const shared = createInferenceResourceReservationRuntime({
    environment: { INFERENCE_RESOURCE_RESERVATION_SQLITE_PATH: "fixture", INFERENCE_RESOURCE_RESERVATION_BINDINGS: JSON.stringify([accountBinding]) },
    createStore: memoryStore,
  });
  let calls = 0;
  const contract = (input, options) => dispatchInference(input, {
    ...options, directDescriptors: [{ ...descriptor, declaredResources: [] }], pricingRoot: null,
    procure: async () => { throw new Error("strict free work must not contact market"); },
    directTransport: async (call) => { calls += 1; return { type: "ReceiverOwnedToolAgentCompletion", text: "fixture", provider: call.provider, model: call.model, invocations: [], durationMs: 1, exchanges: [{ usage: { outputTokens: 10 } }] }; },
  });
  const request = (id) => ({ objective: "return fixture", context: "bounded fixture", workLotId: id, zeroCashOnly: true,
    agentBounds: { maximumRequests: 1, maximumOutputTokens: 100, maximumTokensPerRequest: 100, maximumDepth: 0 } });
  const a2aRequest = request("urn:fixture:a2a");
  const source = { messageId: "cross-adapter-a2a", contextId: "cross-adapter", role: ROLE_USER,
    parts: [senPart(identifyJsonValue(a2aRequest).bytes, "work-lot.sen.cbor")], metadata: {}, extensions: [], referenceTaskIds: [] };
  const [mcp, a2a] = await Promise.all([
    invokeDispatchInference(request("urn:fixture:mcp"), { resourceReservations: shared, dispatch: contract }),
    executeA2aMessage(source, { resourceReservations: shared, contract }),
  ]);
  assert.equal(calls, 1);
  assert.equal([mcp.isError, a2a.metadata.disposition === "market-residue"].filter(Boolean).length, 1);
});

test("independently constructed adapter runtimes contend through the shared CAS store, not JavaScript identity", async () => {
  const descriptor = loadDirectEndpointProviderDescriptors({ API_KEY_OPENROUTER: "fixture-only" }).find((item) => item.zeroCashEligible);
  assert.ok(descriptor);
  const instant = Date.now();
  const accountBinding = { ...binding, providerIdentity: descriptor.provider,
    observedAt: new Date(instant - 60_000).toISOString(), validFrom: new Date(instant - 60_000).toISOString(),
    validUntil: new Date(instant + 60_000).toISOString(), resetsAt: new Date(instant + 60_000).toISOString(), availableResources: [
      { resource: "requests", unit: "request", amount: { numerator: "1", denominator: "1" } },
      { resource: "output-tokens", unit: "token", amount: { numerator: "100", denominator: "1" } },
    ] };
  const createStore = independentlyConstructedStores();
  const environment = { INFERENCE_RESOURCE_RESERVATION_SQLITE_PATH: "fixture", INFERENCE_RESOURCE_RESERVATION_BINDINGS: JSON.stringify([accountBinding]) };
  const left = createInferenceResourceReservationRuntime({ environment, createStore });
  const right = createInferenceResourceReservationRuntime({ environment, createStore });
  assert.notEqual(left, right);
  assert.notEqual(left.store, right.store);
  let calls = 0;
  const request = (id) => ({ objective: "return fixture", context: "bounded fixture", workLotId: id, zeroCashOnly: true,
    agentBounds: { maximumRequests: 1, maximumOutputTokens: 100, maximumTokensPerRequest: 100, maximumDepth: 0 } });
  const options = (resourceReservations) => ({ resourceReservations, directDescriptors: [{ ...descriptor, declaredResources: [] }], pricingRoot: null,
    procure: async () => { throw new Error("strict free work must not contact market"); },
    directTransport: async (call) => { calls += 1; return { type: "ReceiverOwnedToolAgentCompletion", text: "fixture", provider: call.provider, model: call.model, invocations: [], durationMs: 1, exchanges: [{ usage: { outputTokens: 10 } }] }; },
  });
  const [first, second] = await Promise.all([dispatchInference(request("urn:fixture:left"), options(left)), dispatchInference(request("urn:fixture:right"), options(right))]);
  assert.equal(calls, 1);
  assert.equal([first, second].filter(({ outcome }) => outcome === "candidate-pending-customer-acceptance").length, 1);
});
