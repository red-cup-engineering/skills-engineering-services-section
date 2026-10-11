import test from "node:test";
import assert from "node:assert/strict";
import { createInferenceResourceReservations } from "../../src/dispatch/resource-reservation-execution.mjs";
import { createWorkResourceReservations } from "../../src/dispatch/work-placement/resource-reservations.mjs";
import { dispatchInference } from "../../src/dispatch/inference-dispatch.mjs";
import { loadDirectEndpointProviderDescriptors } from "../../src/dispatch/direct-endpoint-provider.mjs";

const row = (resource, unit, n) => ({ resource, unit, amount: { numerator: String(n), denominator: "1" } });
const binding = { providerIdentity: "provider:fixture", accountIdentity: "account:fixture", windowIdentity: "window:fixture",
  evidenceIdentity: "evidence:fixture", observedAt: "2026-09-07T00:00:00Z", validFrom: "2026-09-07T00:00:00Z",
  validUntil: "2026-09-08T00:00:00Z", resetsAt: "2026-09-08T00:00:00Z",
  availableResources: [row("requests", "request", 4), row("output-tokens", "token", 400)],
  financialControl: { type: "WorkResourceFinancialControl", costState: "observed", costEvidenceIdentity: "evidence:cost",
    costObservedAt: "2026-09-07T00:00:00Z", costValidUntil: "2026-09-08T00:00:00Z",
    consideration: [{ kind: "currency", asset: "urn:currency:usd", unit: "cent", amount: { numerator: "0", denominator: "1" } }],
    billing: { status: "not-required" }, meterEvidenceIdentity: "evidence:meter",
    meterObservedAt: "2026-09-07T00:00:00Z", meterValidUntil: "2026-09-08T00:00:00Z" } };
const descriptor = { provider: binding.providerIdentity };
const now = () => "2026-09-07T01:00:00Z";
const completion = (tokens = 10) => ({ type: "ReceiverOwnedToolAgentCompletion", text: "fixture", exchanges: [{ usage: { outputTokens: tokens } }] });
function storeFixture() {
  const records = new Map();
  return { records, async get(key) { return structuredClone(records.get(key)); },
    async compareAndSet(key, expected, record) {
      if ((records.get(key)?.version ?? null) !== expected) throw Error("conflict");
      const value = { ...structuredClone(record), version: String(Number(expected ?? 0) + 1) }; records.set(key, value); return value;
    } };
}
const controller = (store, id, resolveBinding = () => binding) => createInferenceResourceReservations({ store, reservationId: id, resolveBinding, now });

test("two root jobs cannot both invoke through one whole-job account capacity", async () => {
  const store = storeFixture(), left = controller(store, "left"), right = controller(store, "right");
  let calls = 0;
  const invoke = async () => { calls += 1; return completion(); };
  const results = await Promise.allSettled([left.wrap(descriptor, binding.availableResources, invoke)({}), right.wrap(descriptor, binding.availableResources, invoke)({})]);
  assert.equal(calls, 1);
  assert.equal(results.filter(x => x.status === "rejected").length, 1);
  assert.match(results.find(x => x.status === "rejected").reason.message, /resource-quota-exhausted/);
  await Promise.all([left.finish(), right.finish()]);
});

test("same job id through independent controllers admits one transport invocation", async () => {
  const store = storeFixture(), left = controller(store, "same"), right = controller(store, "same");
  let calls = 0;
  const invoke = async () => { calls += 1; return completion(); };
  await Promise.allSettled([left.wrap(descriptor, binding.availableResources, invoke)({}), right.wrap(descriptor, binding.availableResources, invoke)({})]);
  assert.equal(calls, 1);
});

test("children and retries share one hold and settlement includes all child usage", async () => {
  const store = storeFixture(), root = controller(store, "tree");
  const child = root.wrap(descriptor, binding.availableResources, async () => completion(20));
  await root.wrap(descriptor, binding.availableResources, async () => { await child({}); return completion(30); })({});
  await root.wrap(descriptor, binding.availableResources, async () => completion(10))({});
  await root.finish();
  const entries = [...store.records.values()][0].reservations;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, "settled");
  assert.deepEqual(entries[0].resources, [row("output-tokens", "token", 60), row("requests", "request", 3)]);
  assert.equal(root.receipts().filter(x => x.disposition === "held").length, 1);
});

test("uncertain network failure conservatively charges the tree and cancellation before invocation leaks no hold", async () => {
  const store = storeFixture(), cancelled = controller(store, "cancelled");
  await assert.rejects(cancelled.wrap(descriptor, binding.availableResources, async () => completion())({ signal: AbortSignal.abort() }), /cancelled/);
  await cancelled.finish();
  assert.equal(store.records.size, 0);
  const root = controller(store, "uncertain");
  await assert.rejects(root.wrap(descriptor, binding.availableResources, async () => { throw Error("lost network response"); })({}), /lost network/);
  await root.finish();
  assert.deepEqual([...store.records.values()][0].reservations[0].resources, [binding.availableResources[1], binding.availableResources[0]]);
});

test("missing output metering retains tokens while measured requests release unused request quota", async () => {
  const store = storeFixture(), root = controller(store, "partial");
  await root.wrap(descriptor, binding.availableResources, async () => completion(null))({});
  await root.finish();
  assert.deepEqual([...store.records.values()][0].reservations[0].resources, [binding.availableResources[1], row("requests", "request", 1)]);
});

test("caller-shaped account evidence cannot replace a missing server binding", async () => {
  const store = storeFixture(), root = controller(store, "forged", () => undefined);
  let calls = 0;
  await assert.rejects(root.wrap({ ...descriptor, availabilityEvidence: binding }, binding.availableResources, async () => { calls += 1; })({}), /not-admitted/);
  assert.equal(calls, 0);
  assert.equal(store.records.size, 0);
});

test("candidate capacity cannot reach the endpoint transport", async () => {
  const root = controller(storeFixture(), "candidate", () => ({ ...binding, financialControl: { ...binding.financialControl, costState: "candidate" } }));
  let calls = 0;
  await assert.rejects(root.wrap(descriptor, binding.availableResources, async () => { calls += 1; return completion(); })({}), /resource-cost-is-candidate/);
  assert.equal(calls, 0);
});

test("deterministic clients and inference controller spend the same canonical resource owner", async () => {
  const store = storeFixture(), owner = createWorkResourceReservations({ store, binding });
  const held = await owner.apply({ type: "WorkResourceReservationRequest", action: "reserve", reservationId: "deterministic",
    providerIdentity: binding.providerIdentity, accountIdentity: binding.accountIdentity, windowIdentity: binding.windowIdentity,
    evaluatedAt: now(), resources: binding.availableResources });
  assert.equal(held.disposition, "held");
  const root = controller(store, "inference");
  await assert.rejects(root.wrap(descriptor, binding.availableResources, async () => completion())({}), /resource-quota-exhausted/);
});

async function concurrentDispatch(ids, failTransport = false) {
  const store = storeFixture();
  const admitted = loadDirectEndpointProviderDescriptors({ API_KEY_OPENROUTER: "fixture-only" }).find(x => x.zeroCashEligible);
  assert.ok(admitted);
  const selected = { ...admitted, declaredResources: [] };
  const accountBinding = { ...binding, providerIdentity: selected.provider, availableResources: [row("requests", "request", 1), row("output-tokens", "token", 100)] };
  let calls = 0;
  const options = { directDescriptors: [selected], pricingRoot: null,
    resourceReservations: { store, resolveBinding: () => accountBinding, now },
    procure: async () => { throw Error("strict free work must not contact the paid market"); },
    directTransport: async (call) => { calls += 1; if (failTransport) throw Error("uncertain provider response"); return { ...completion(10), provider: call.provider, model: call.model, invocations: [], durationMs: 1 }; } };
  const results = await Promise.all(ids.map(id => dispatchInference({
    objective: "Return fixture", context: "A bounded synthetic fixture.", workLotId: id, zeroCashOnly: true,
    agentBounds: { maximumRequests: 1, maximumOutputTokens: 100, maximumTokensPerRequest: 100, maximumDepth: 0 },
  }, options)));
  return { results, calls, store };
}

test("the real dispatcher reserves before two simultaneous strict-free jobs reach injected transport", async () => {
  const { results, calls, store } = await concurrentDispatch(["urn:fixture:job:a", "urn:fixture:job:b"]);
  assert.equal(calls, 1);
  const delivered = results.find(x => x.outcome === "candidate-pending-customer-acceptance");
  assert.ok(delivered);
  assert.equal(delivered.providerEvidence.resourceReservations.at(-1).disposition, "settled");
  const refused = results.find(x => x !== delivered);
  assert.ok(refused.directLaneRefusals.some(x => x.reason.includes("resource-quota-exhausted")));
  assert.equal([...store.records.values()][0].reservations.length, 1);
});

test("the real dispatcher cannot replay one work-lot identity as two executions against one reservation", async () => {
  const { results, calls } = await concurrentDispatch(["urn:fixture:job:duplicate", "urn:fixture:job:duplicate"]);
  assert.equal(calls, 1);
  assert.equal(results.filter(x => x.outcome === "candidate-pending-customer-acceptance").length, 1);
});

test("the real dispatcher exposes conservatively charged reservation receipts on a failed transport outcome", async () => {
  const { results: [result], calls, store } = await concurrentDispatch(["urn:fixture:job:uncertain"], true);
  assert.equal(calls, 1);
  assert.equal(result.outcome, "market-residue");
  assert.ok(result.providerEvidence.resourceReservations.some(x => x.disposition === "attempted"));
  assert.equal(result.providerEvidence.resourceReservations.at(-1).disposition, "settled");
  assert.deepEqual([...store.records.values()][0].reservations[0].resources, [row("output-tokens", "token", 100), row("requests", "request", 1)]);
});
