import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAIN_ITEMS,
  CHECKOUT_BOUND_UNITS_ALLOW,
  DEFAULT_ALLOCATION_ACTOR,
  DEFAULT_ALLOCATION_OFFICE,
  PLAN_CELL,
  admitAllocationsForTasks,
  admitSetOfHealthWorkIntents,
  allocationIdFor,
  buildTaskAllocation,
  slugify,
} from "../scripts/admit-set-of-health-work-intents.mjs";

const FAKE_BINDING = { dataRoot: "/fake/metroplat-root" };

/**
 * Fake `admitAgencyWorkAllocation` reporting `appended` rows on the first
 * call for a given allocation id and 0 on every later call for that same
 * id, matching the real service's already-admitted idempotence.
 */
function fakeAdmitAllocation(appended = 3) {
  const calls = [];
  const admittedIds = new Set();
  const fn = (binding, allocation, options) => {
    calls.push({ binding, allocation, options });
    const alreadyAdmitted = admittedIds.has(allocation.id);
    admittedIds.add(allocation.id);
    const rowsAppended = alreadyAdmitted ? 0 : appended;
    return {
      kind: "metroplat.work.agency-work-allocation-admission",
      allocation: allocation.id,
      subject: allocation.subject,
      office: allocation.office.id,
      incumbent: allocation.incumbency.actor,
      scope: allocation.allocation.scope,
      incumbency: "dignitas",
      appended: rowsAppended,
      status: rowsAppended === 0 ? "already-admitted" : "admitted",
    };
  };
  fn.calls = calls;
  return fn;
}

test("slugify lowercases, collapses non [a-z0-9-] runs, trims edges", () => {
  assert.equal(slugify("@red-cup-engineering/foo Bar_Baz!!"), "red-cup-engineering-foo-bar-baz");
});

test("allocationIdFor and buildTaskAllocation shape one allocation payload deterministically", () => {
  assert.equal(allocationIdFor("task:exact-deps-pkg-a"), "allocation-task:exact-deps-pkg-a");
  const allocation = buildTaskAllocation({ taskCell: "task:exact-deps-pkg-a", subject: "structured-work-intent-x" });
  assert.equal(allocation.kind, "metroplat.work.agency-work-allocation");
  assert.equal(allocation.id, "allocation-task:exact-deps-pkg-a");
  assert.equal(allocation.subject, "structured-work-intent-x");
  assert.equal(allocation.office.id, DEFAULT_ALLOCATION_OFFICE);
  assert.equal(allocation.incumbency.actor, DEFAULT_ALLOCATION_ACTOR);
  assert.equal(allocation.incumbency.recognition, "t");
  assert.equal(allocation.incumbency.induction, "t");
  assert.equal(allocation.allocation.scope, "task:exact-deps-pkg-a");
  assert.equal(allocation.allocation.assigner, DEFAULT_ALLOCATION_ACTOR);
  assert.equal(allocation.allocation.charge, "t");
});

test("admitAllocationsForTasks admits one allocation per task and sums appended rows", async () => {
  const admitAllocationFn = fakeAdmitAllocation(3);
  const tasks = [{ cell: "task:exact-deps-pkg-a" }, { cell: "task:exact-deps-pkg-b" }];
  const result = await admitAllocationsForTasks({ tasks, subject: "structured-work-intent-x", at: "2026-09-03T12:00:00.000Z", binding: FAKE_BINDING, admitAllocationFn });
  assert.equal(result.allocated, 2);
  assert.equal(result.allocationsAppended, 6);
  assert.equal(admitAllocationFn.calls.length, 2);
  await assert.rejects(() => admitAllocationsForTasks({ tasks, subject: "s", at: "t", binding: null }), /admitAllocationFn is required/u);
});

function fakeWork() {
  const intents = [];
  const allocations = [];
  return {
    kind: "ops",
    binding: null,
    admitFn: async (_binding, intent, options) => { intents.push({ intent, options }); return { appended: intent.items.length, status: "admitted" }; },
    admitAllocationFn: async (_binding, allocation) => { allocations.push(allocation); return { appended: 3, status: "admitted" }; },
    close: async () => {},
    intents,
    allocations,
  };
}

const ONE_VIOLATION = Object.freeze({
  kind: "metroplat.monitoring.checkout-health.read",
  checked: 4,
  violations: 1,
  truncated: false,
  findings: [{ check: "exact-deps", path: "/repo/pkg-a/package.json", reason: "range", name: "dep", field: "dependencies", specification: "^1.0.0" }],
  failedUnits: [],
  unitsObserved: 0,
  hostsReached: ["local"],
  hostsUnreachable: [],
  checkoutBoundUnits: [],
});

test("admitSetOfHealthWorkIntents runs the checkers on this checkout with the chain and allow list, then admits metroplat's own intent and one allocation per task on the rail", async () => {
  const reads = [];
  const readHealthFn = (request) => { reads.push(request); return ONE_VIOLATION; };
  const work = fakeWork();
  const summary = await admitSetOfHealthWorkIntents({
    root: "/repo",
    changedOnly: true,
    budgetMs: 5000,
    hosts: ["local"],
    intentId: "health-work-intents-2026-09-03",
    office: "some-office",
    actor: "actor:x",
    work,
    readHealthFn,
    now: () => new Date("2026-09-03T12:00:00.000Z"),
  });
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0], { root: "/repo", changedOnly: true, budgetMs: 5000, hosts: ["local"], checkoutBoundUnitsAllow: CHECKOUT_BOUND_UNITS_ALLOW });
  assert.equal(work.intents.length, 1);
  const [{ intent, options }] = work.intents;
  assert.equal(intent.kind, "metroplat.work.structured-intent");
  assert.equal(intent.id, "health-work-intents-2026-09-03");
  assert.deepEqual(intent.items.slice(0, CHAIN_ITEMS.length).map((item) => item.cell), CHAIN_ITEMS.map((item) => item.cell));
  assert.equal(intent.items.at(-1).parent, PLAN_CELL);
  assert.match(intent.items.at(-1).cell, /^task:exact-deps-/u);
  assert.equal(options.subject, "structured-work-intent-health-work-intents-2026-09-03");
  assert.equal(work.allocations.length, 1);
  assert.equal(work.allocations[0].office.id, "some-office");
  assert.equal(work.allocations[0].incumbency.actor, "actor:x");
  assert.equal(work.allocations[0].allocation.scope, intent.items.at(-1).cell);
  assert.equal(summary.kind, "metroplat.monitoring.checkout-health.work-intent-summary");
  assert.equal(summary.violations, 1);
  assert.equal(summary.admitted, 1);
  assert.equal(summary.allocated, 1);
  assert.equal(summary.allocationsAppended, 3);
  assert.equal(summary.intentId, "health-work-intents-2026-09-03");
});

test("admitSetOfHealthWorkIntents admits nothing and never opens the rail when the checkout is clean", async () => {
  const readHealthFn = () => ({ ...ONE_VIOLATION, violations: 0, findings: [] });
  const work = { admitFn: () => { throw new Error("must not be called"); }, admitAllocationFn: () => { throw new Error("must not be called"); } };
  const summary = await admitSetOfHealthWorkIntents({ readHealthFn, work, now: () => new Date("2026-09-03T12:00:00.000Z") });
  assert.equal(summary.violations, 0);
  assert.equal(summary.admitted, 0);
  assert.equal(summary.intentId, null);
});

test("PLAN_CELL matches the last CHAIN_ITEMS cell", () => {
  assert.equal(PLAN_CELL, CHAIN_ITEMS.at(-1).cell);
});
