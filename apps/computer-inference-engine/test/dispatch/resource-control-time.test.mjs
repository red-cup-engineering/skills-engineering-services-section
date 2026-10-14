import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWorkResourceControl, createWorkResourceReservations, workResourceAccountKey } from "../../src/dispatch/work-placement/resource-reservations.mjs";
import { createInferenceResourceReservations } from "../../src/dispatch/resource-reservation-execution.mjs";

const row = (resource, unit, n) => ({ resource, unit, amount: { numerator: String(n), denominator: "1" } });
const start = "2026-09-07T00:00:00.000Z";
const before = "2026-09-07T00:59:59.999Z";
const boundary = "2026-09-07T01:00:00.000Z";
const end = "2026-09-08T00:00:00.000Z";
const binding = () => ({
  providerIdentity: "provider:fixture", accountIdentity: "account:fixture", windowIdentity: "window:fixture",
  evidenceIdentity: "evidence:capacity", observedAt: start, validFrom: start, validUntil: end, resetsAt: end,
  availableResources: [row("requests", "request", 4), row("output-tokens", "token", 400)],
  financialControl: { type: "WorkResourceFinancialControl", costState: "observed", costEvidenceIdentity: "evidence:cost",
    costObservedAt: start, costValidUntil: end,
    consideration: [{ kind: "currency", asset: "urn:currency:usd", unit: "cent", amount: { numerator: "0", denominator: "1" } }],
    billing: { status: "not-required" }, meterEvidenceIdentity: "evidence:meter", meterObservedAt: start, meterValidUntil: end },
});
const cases = [
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
function storeFixture() {
  const records = new Map();
  let reads = 0, writes = 0;
  return { records, get reads() { return reads; }, get writes() { return writes; },
    async get(key) { reads += 1; return structuredClone(records.get(key)); },
    async compareAndSet(key, expected, record) {
      if ((records.get(key)?.version ?? null) !== expected) throw Error("conflict");
      writes += 1;
      const value = { ...structuredClone(record), version: String(Number(expected ?? 0) + 1) };
      records.set(key, value);
      return value;
    },
  };
}
const request = (value, action, evaluatedAt, extra = {}) => ({
  type: "WorkResourceReservationRequest", action, reservationId: "reservation:fixture",
  providerIdentity: value.providerIdentity, accountIdentity: value.accountIdentity, windowIdentity: value.windowIdentity,
  evaluatedAt, ...extra,
});
const completion = () => ({ type: "ReceiverOwnedToolAgentCompletion", exchanges: [{ usage: { outputTokens: 10 } }] });

for (const [name, reason, amend] of cases) {
  test(`${name} evidence admits the last current millisecond and refuses the boundary`, () => {
    const value = binding(); amend(value);
    assert.equal(evaluateWorkResourceControl(value, before).disposition, "admitted");
    for (const time of [boundary, "2026-09-07T02:00:00.000+01:00", end]) {
      const result = evaluateWorkResourceControl(value, time);
      assert.equal(result.disposition, "refused");
      assert.equal(result.reason, time === end ? "resource-availability-evidence-not-current" : reason);
    }
  });

  test(`${name} expiry blocks a retry using an existing shared account hold`, async () => {
    const value = binding(); amend(value);
    const store = storeFixture(); let time = before, calls = 0;
    const root = createInferenceResourceReservations({ store, reservationId: "tree:fixture", resolveBinding: () => value, now: () => time });
    const invoke = root.wrap({ provider: value.providerIdentity }, value.availableResources, async () => { calls += 1; return completion(); });
    await invoke({});
    time = boundary;
    await assert.rejects(invoke({}), new RegExp(reason));
    assert.equal(calls, 1);
    assert.equal(root.receipts().filter((receipt) => receipt.disposition === "held").length, 1);
    // Closure must still account for the successful attempt after expiry.
    const receipts = await root.finish();
    assert.equal(receipts.at(-1).disposition, "settled");
    assert.deepEqual([...store.records.values()][0].reservations[0].resources,
      [row("output-tokens", "token", 10), row("requests", "request", 1)]);
  });

  test(`${name} expiry is refused consistently before observation or reservation store access`, async () => {
    const value = binding(); amend(value);
    const store = storeFixture(), owner = createWorkResourceReservations({ store, binding: value });
    const observed = await owner.observe({ evaluatedAt: boundary });
    const reserved = await owner.apply(request(value, "reserve", boundary, { resources: value.availableResources }));
    assert.equal(observed.reason, reason);
    assert.equal(reserved.reason, reason);
    assert.equal(store.reads, 0);
    assert.equal(store.writes, 0);
  });
}

for (const [field, reason] of [["observedAt", "resource-availability-evidence-not-current"],
  ["costObservedAt", "resource-cost-evidence-not-current"], ["meterObservedAt", "resource-meter-evidence-not-current"]]) {
  test(`${field} evidence cannot authorize work before it was observed`, async () => {
    const value = binding();
    if (field === "observedAt") value.observedAt = boundary;
    else value.financialControl[field] = boundary;
    assert.equal(evaluateWorkResourceControl(value, boundary).disposition, "admitted");
    assert.equal(evaluateWorkResourceControl(value, before).reason, reason);
    const store = storeFixture(), owner = createWorkResourceReservations({ store, binding: value });
    assert.equal((await owner.observe({ evaluatedAt: before })).reason, reason);
    assert.equal((await owner.apply(request(value, "reserve", before, { resources: value.availableResources }))).reason, reason);
    assert.equal(store.reads, 0);
  });
}

test("one current account pool remains shared by different model descriptors and independent jobs", async () => {
  const value = binding(), store = storeFixture();
  const makeRoot = (id) => createInferenceResourceReservations({ store, reservationId: id, resolveBinding: () => value, now: () => before });
  const left = makeRoot("tree:left"), right = makeRoot("tree:right");
  let calls = 0;
  const invoke = async () => { calls += 1; return completion(); };
  const results = await Promise.allSettled([
    left.wrap({ provider: value.providerIdentity, model: "model:left" }, value.availableResources, invoke)({}),
    right.wrap({ provider: value.providerIdentity, model: "model:right" }, value.availableResources, invoke)({}),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /resource-quota-exhausted/);
  assert.equal(store.records.size, 1);
  assert.equal([...store.records.keys()][0], workResourceAccountKey(value));
  await Promise.all([left.finish(), right.finish()]);
});

test("expired evidence does not block release or conservative settlement of previously admitted work", async () => {
  const value = binding(), store = storeFixture(), owner = createWorkResourceReservations({ store, binding: value });
  const resources = [row("requests", "request", 1), row("output-tokens", "token", 100)];
  assert.equal((await owner.apply(request(value, "reserve", before, { resources }))).disposition, "held");
  assert.equal((await owner.apply(request(value, "release", end))).disposition, "released");
  const other = (action, evaluatedAt, extra = {}) => ({ ...request(value, action, evaluatedAt, extra), reservationId: "reservation:attempted" });
  await owner.apply(other("reserve", before, { resources }));
  await owner.apply(other("attempt", before, { executionIdentity: "execution:fixture" }));
  const result = await owner.apply(other("settle", end, { measuredResources: [] }));
  assert.equal(result.disposition, "settled");
  const retained = [...store.records.values()][0].reservations.find((entry) => entry.reservationId === "reservation:attempted");
  assert.deepEqual(retained.resources, [resources[1], resources[0]]);
});

test("an unattempted hold cannot be claimed with future-dated cost or meter evidence", async () => {
  for (const [field, reason] of [["costObservedAt", "resource-cost-evidence-not-current"], ["meterObservedAt", "resource-meter-evidence-not-current"]]) {
    const value = binding(); value.financialControl[field] = boundary;
    const store = storeFixture(), owner = createWorkResourceReservations({ store, binding: value });
    await owner.apply(request(value, "reserve", boundary, { resources: value.availableResources }));
    const writes = store.writes;
    const result = await owner.apply(request(value, "attempt", before, { executionIdentity: "execution:fixture" }));
    assert.equal(result.reason, reason);
    assert.equal(store.writes, writes);
  }
});

test("candidate price, uncommitted cost, missing authority and malformed instants stay hard refusals", () => {
  const candidate = binding(); candidate.financialControl.costState = "candidate";
  assert.equal(evaluateWorkResourceControl(candidate, before).reason, "resource-cost-is-candidate");
  const paid = binding(); paid.financialControl.consideration[0].amount.numerator = "1";
  assert.equal(evaluateWorkResourceControl(paid, before).reason, "resource-cost-not-committed");
  paid.financialControl.costState = "committed";
  assert.equal(evaluateWorkResourceControl(paid, before).reason, "resource-billing-authority-not-admitted");
  for (const time of [Date.parse(before), "invalid", "2026-09-07T01:00:00", null]) {
    assert.throws(() => evaluateWorkResourceControl(binding(), time), TypeError);
  }
});
