import test from "node:test";
import assert from "node:assert/strict";
import { createInferenceResourceReservations } from "../../src/dispatch/resource-reservation-execution.mjs";
import { workResourceAccountKey } from "../../src/dispatch/work-placement/resource-reservations.mjs";

const start = "2026-09-07T00:00:00.000Z";
const before = "2026-09-07T00:59:59.999Z";
const boundary = "2026-09-07T01:00:00.000Z";
const end = "2026-09-08T00:00:00.000Z";
const row = (resource, unit, n) => ({ resource, unit, amount: { numerator: String(n), denominator: "1" } });
const binding = () => ({
  providerIdentity: "provider:fixture", accountIdentity: "account:fixture", windowIdentity: "window:fixture",
  evidenceIdentity: "evidence:capacity", observedAt: start, validFrom: start, validUntil: end, resetsAt: end,
  availableResources: [row("requests", "request", 4), row("output-tokens", "token", 400)],
  financialControl: { type: "WorkResourceFinancialControl", costState: "observed", costEvidenceIdentity: "evidence:cost",
    costObservedAt: start, costValidUntil: end,
    consideration: [{ kind: "currency", asset: "urn:currency:usd", unit: "cent", amount: { numerator: "0", denominator: "1" } }],
    billing: { status: "not-required" }, meterEvidenceIdentity: "evidence:meter", meterObservedAt: start, meterValidUntil: end },
});
const completed = () => ({ type: "ReceiverOwnedToolAgentCompletion", exchanges: [{ usage: { outputTokens: 10 } }] });

function fixture({ initial = binding(), afterWrite = async () => {}, afterGet = async () => {} } = {}) {
  const state = { binding: initial, time: before, calls: 0 };
  const records = new Map();
  const store = {
    async get(key) { const record = structuredClone(records.get(key)); await afterGet(record, state); return record; },
    async compareAndSet(key, expected, record) {
      if ((records.get(key)?.version ?? null) !== expected) throw Error("conflict");
      const written = { ...structuredClone(record), version: String(Number(expected ?? 0) + 1) };
      records.set(key, written);
      await afterWrite(written, state);
      return structuredClone(written);
    },
  };
  const root = createInferenceResourceReservations({ store, reservationId: "tree:fixture", resolveBinding: () => state.binding, now: () => state.time });
  const invoke = root.wrap({ provider: initial.providerIdentity }, initial.availableResources, async () => { state.calls += 1; return completed(); });
  return { state, records, store, root, invoke };
}
const expireCases = [
  ["capacity", "resource-availability-evidence-not-current", (value) => { value.validUntil = boundary; }],
  ["reset", "resource-availability-evidence-not-current", (value) => { value.validUntil = boundary; value.resetsAt = boundary; }],
  ["cost", "resource-cost-evidence-not-current", (value) => { value.financialControl.costValidUntil = boundary; }],
  ["meter", "resource-meter-evidence-not-current", (value) => { value.financialControl.meterValidUntil = boundary; }],
  ["billing", "resource-billing-authority-expired", (value) => {
    value.financialControl.costState = "committed";
    value.financialControl.consideration[0].amount.numerator = "1";
    value.financialControl.billing = { status: "authorized", authorityIdentity: "authority:fixture", validUntil: boundary };
  }],
];

for (const [name, reason, amend] of expireCases) {
  test(`${name} expiry while persisting an attempt prevents transport entry`, async () => {
    const initial = binding(); amend(initial);
    const f = fixture({ initial, afterWrite: async (record, state) => {
      if (record.reservations.at(-1).state === "attempted") state.time = boundary;
    } });
    await assert.rejects(f.invoke({}), new RegExp(reason));
    assert.equal(f.state.calls, 0);
    const originalPool = f.records.get(workResourceAccountKey(initial));
    assert.equal(originalPool.reservations[0].state, "attempted");
    assert.equal(originalPool.reservations[0].updatedAt, before);
    // A committed attempt is not a claim that the provider was invoked.
    const receipts = await f.root.finish();
    assert.equal(receipts.at(-1).disposition, "settled");
    assert.deepEqual(f.records.get(workResourceAccountKey(initial)).reservations[0].resources,
      [row("output-tokens", "token", 0), row("requests", "request", 0)]);
  });
}

for (const [name, change, reason] of [
  ["account", (value) => { value.accountIdentity = "account:replacement"; }, "resource-capacity-anchor-mismatch"],
  ["window", (value) => { value.windowIdentity = "window:replacement"; }, "resource-capacity-anchor-mismatch"],
  ["capacity evidence", (value) => { value.evidenceIdentity = "evidence:replacement"; }, "resource-capacity-anchor-mismatch"],
  ["resource quota", (value) => { value.availableResources[0].amount.numerator = "5"; }, "resource-capacity-anchor-mismatch"],
  ["cost evidence", (value) => { value.financialControl.costEvidenceIdentity = "cost:replacement"; }, "resource-capacity-anchor-mismatch"],
  ["provider", (value) => { value.providerIdentity = "provider:replacement"; }, "provider-account-binding-mismatch"],
]) {
  test(`changed ${name} during attempt persistence cannot execute under the original pool hold`, async () => {
    const initial = binding();
    const f = fixture({ initial, afterWrite: async (record, state) => {
      if (record.reservations.at(-1).state === "attempted") { state.binding = structuredClone(initial); change(state.binding); }
    } });
    await assert.rejects(f.invoke({}), new RegExp(reason));
    assert.equal(f.state.calls, 0);
    assert.equal(f.records.size, 1);
    assert.ok(f.records.has(workResourceAccountKey(initial)));
    assert.equal((await f.root.finish()).at(-1).disposition, "settled");
    assert.deepEqual(f.records.get(workResourceAccountKey(initial)).binding.availableResources,
      [initial.availableResources[1], initial.availableResources[0]]);
  });
}

test("missing or invalid current binding after an awaited claim fails closed", async () => {
  for (const replacement of [undefined, null, { type: "not-a-binding" }]) {
    const f = fixture({ afterWrite: async (record, state) => { if (record.reservations.at(-1).state === "attempted") state.binding = replacement; } });
    await assert.rejects(f.invoke({}));
    assert.equal(f.state.calls, 0);
    assert.equal((await f.root.finish()).at(-1).disposition, "settled");
  }
});

test("an equivalent freshly resolved binding permits transport and measured closure", async () => {
  const f = fixture({ afterWrite: async (record, state) => {
    if (record.reservations.at(-1).state === "attempted") state.binding = structuredClone(state.binding);
  } });
  await f.invoke({});
  assert.equal(f.state.calls, 1);
  assert.equal((await f.root.finish()).at(-1).disposition, "settled");
  assert.deepEqual([...f.records.values()][0].reservations[0].resources,
    [row("output-tokens", "token", 10), row("requests", "request", 1)]);
});

test("cancellation during attempt persistence stops transport while closure remains available", async () => {
  const abort = new AbortController();
  const f = fixture({ afterWrite: async (record) => { if (record.reservations.at(-1).state === "attempted") abort.abort(); } });
  await assert.rejects(f.invoke({ signal: abort.signal }), /receiver-cancelled-before-resource-invocation/);
  assert.equal(f.state.calls, 0);
  assert.equal((await f.root.finish()).at(-1).disposition, "settled");
  assert.deepEqual([...f.records.values()][0].reservations[0].resources,
    [row("output-tokens", "token", 0), row("requests", "request", 0)]);
});

test("tree closure during an awaited claim prevents later transport without releasing attempted quota", async () => {
  let entered, release;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const proceed = new Promise((resolve) => { release = resolve; });
  const f = fixture({ afterWrite: async (record) => { if (record.reservations.at(-1).state === "attempted") { entered(); await proceed; } } });
  const result = f.invoke({});
  await waiting;
  const receipts = await f.root.finish();
  assert.equal(receipts.at(-1).reason, "resource-attempt-conservatively-charged");
  release();
  await assert.rejects(result, /resource-execution-tree-closed/);
  assert.equal(f.state.calls, 0);
  const entry = [...f.records.values()][0].reservations[0];
  assert.equal(entry.state, "attempted");
  assert.deepEqual(entry.resources, [f.state.binding.availableResources[1], f.state.binding.availableResources[0]]);
});

test("expired retry after asynchronous reuse preserves already observed use", async () => {
  const initial = binding(); initial.financialControl.meterValidUntil = boundary;
  const f = fixture({ initial });
  await f.invoke({});
  // wrap begins evaluation synchronously and then awaits the existing hold.
  const retry = f.invoke({});
  f.state.time = boundary;
  await assert.rejects(retry, /resource-meter-evidence-not-current/);
  assert.equal(f.state.calls, 1);
  assert.equal((await f.root.finish()).at(-1).disposition, "settled");
  assert.deepEqual([...f.records.values()][0].reservations[0].resources,
    [row("output-tokens", "token", 10), row("requests", "request", 1)]);
});

test("a new refusal never turns an earlier unknown transport outcome into measured zero", async () => {
  const initial = binding(); initial.financialControl.costValidUntil = boundary;
  const f = fixture({ initial });
  let calls = 0;
  const failed = f.root.wrap({ provider: initial.providerIdentity }, initial.availableResources, async () => { calls += 1; throw Error("uncertain response"); });
  await assert.rejects(failed({}), /uncertain response/);
  const retry = failed({});
  f.state.time = boundary;
  await assert.rejects(retry, /resource-cost-evidence-not-current/);
  assert.equal(calls, 1);
  assert.equal((await f.root.finish()).at(-1).disposition, "settled");
  assert.deepEqual([...f.records.values()][0].reservations[0].resources,
    [initial.availableResources[1], initial.availableResources[0]]);
});
