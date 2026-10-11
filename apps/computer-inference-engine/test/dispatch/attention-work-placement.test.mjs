import assert from "node:assert/strict";
import test from "node:test";
import { decideAttentionWorkPlacement, decideWorkPlacement } from "../../src/dispatch/decide-work-placement.mjs";
import { allocateAttention } from "@red-cup-engineering/metrologic/obstruction/attention-allocation";

const q = (n) => ({ numerator: String(n), denominator: "1" });
const budget = (amount = 2) => ({ amount, unit: "review-slot", evidence: "urn:capacity:review-window" });
function demand(id) {
  return {
    type: "TypedWorkDemand", id, taskClass: "reconcile", principal: "urn:actor:receiver",
    requiredCapabilities: ["reconcile"], requiredQualityTiers: [], requiredEffects: ["read-only"],
    requiredExecutionClasses: ["local"], idempotence: "idempotent",
    context: { identity: "urn:context:" + id, authorityScope: "urn:scope:review",
      freshnessIdentity: "urn:revision:current", dataConstraints: [], custodyConstraints: [] },
    outputContract: { identity: "urn:contract:reconciliation" },
    routePolicy: { preferenceOrder: [["consideration-per-acceptance"], ["resources"], ["acceptance-probability"]],
      considerationPreference: [], considerationCeilings: [], resourceCeilings: [], reuse: "forbid" },
  };
}
function offer(id = "urn:offer:a", asset = "urn:credit:review") {
  return {
    type: "NormalizedWorkOffer", id, provider: "urn:provider:" + id, executionClass: "local",
    operation: "reconcile", implementationIdentity: "urn:implementation:" + id,
    capabilities: ["reconcile"], qualityTiers: [], authorityScopes: ["urn:scope:review"],
    effects: ["read-only"], idempotence: ["idempotent"], dataConstraints: [], custodyConstraints: [],
    outputContractIdentities: ["urn:contract:reconciliation"], availability: "available",
    availableCapacity: 1, consideration: [{ kind: "credit", asset, unit: "credit", amount: q(1) }],
    declaredResources: [], semantics: { reuse: "none" },
  };
}
function candidate(id, cost = 1, benefit = 1) {
  return {
    demand: demand(id), offers: [offer()], observations: [],
    attention: {
      cost: { amount: cost, unit: "review-slot", evidence: "urn:cost-reading:" + id },
      held: { atoms: Array.from({ length: benefit }, (_, i) => id + ":obstruction:" + i),
        evidence: "urn:held-reading:" + id },
    },
  };
}
const read = (candidates, amount = 2, extra = {}) => decideAttentionWorkPlacement({ budget: budget(amount), candidates, ...extra });
const attempt = (offerId, outcome, receipt = "urn:receipt:" + offerId) => ({
  type: "WorkPlacementObservation", kind: "attempt", receipt, offerId, taskClass: "reconcile",
  outcome, resources: [],
});

test("actual demand feasibility precedes attention benefit; refused work stays visible", () => {
  const unavailable = candidate("unavailable", 1, 20);
  unavailable.offers[0].availableCapacity = 0;
  const good = candidate("good", 1, 2);
  const out = read([unavailable, good], 1);
  assert.deepEqual(out.allocation.readNext, ["good"]);
  assert.equal(out.deferred[0].placement.disposition, "refused");
  assert.deepEqual(out.deferred[0].placement.refusals[0].reasons, ["no-available-capacity"]);
  assert.equal(out.unselected.unavailable, 20);
  assert.equal(out.unselected.total, 20);
  assert.equal(out.observedRemoval, null);
  assert.equal(out.customerMutation, false);
  assert.equal(out.sharedResourcesReserved, false);
  assert.equal(out.assetSettlementClaimed, false);
});

test("non-commensurate provider frontier remains choice-required, never a scalar price", () => {
  const ambiguous = candidate("ambiguous", 1, 10);
  ambiguous.offers.push(offer("urn:offer:b", "urn:currency:other"));
  const out = read([ambiguous, candidate("good")], 1);
  assert.deepEqual(out.allocation.readNext, ["good"]);
  assert.deepEqual(out.deferred[0].placement, decideWorkPlacement(ambiguous));
  assert.equal(out.deferred[0].placement.disposition, "choice-required");
  assert.equal(out.deferred[0].placement.attemptPlan[0].relation, "incomparable");
});

test("explicit customer denomination preference is preserved without changing attention units", () => {
  const a = candidate("a");
  a.offers.push(offer("urn:offer:b", "urn:credit:other"));
  a.demand.routePolicy.considerationPreference = [
    [{ kind: "credit", asset: "urn:credit:other", unit: "credit" }],
    [{ kind: "credit", asset: "urn:credit:review", unit: "credit" }],
  ];
  const out = read([a], 1);
  assert.equal(out.planned[0].placement.selected.offerId, "urn:offer:b");
  assert.deepEqual(out.planned[0].placement.selected.offer.consideration, a.offers[1].consideration);
  assert.deepEqual(out.budget, budget(1));
});

test("receiver acceptance/refusal changes provider placement under the existing posterior law", () => {
  const a = candidate("a");
  a.offers.push(offer("urn:offer:b"));
  assert.equal(read([a], 1).planned[0].placement.selected.offerId, "urn:offer:a");
  a.observations = [attempt("urn:offer:a", "refused"), attempt("urn:offer:b", "accepted")];
  const out = read([a], 1);
  assert.equal(out.planned[0].placement.selected.offerId, "urn:offer:b");
  assert.deepEqual(out.planned[0].placement, decideWorkPlacement(a));
  assert.deepEqual(out.planned[0].placement.selected.observationBasis.receipts, ["urn:receipt:urn:offer:b"]);
  assert.equal(out.allocation.benefit, 1);
  assert.equal(out.observedRemoval, null);
});

test("replay does not double-count receiver observations; contested receipts defer placement", () => {
  const a = candidate("a");
  const accepted = attempt("urn:offer:a", "accepted", "urn:receipt:one");
  a.observations = [accepted, structuredClone(accepted)];
  assert.equal(read([a]).planned[0].placement.selected.observationBasis.attempts, 1);
  a.observations.push({ ...accepted, outcome: "refused" });
  const out = read([a]);
  assert.equal(out.planned.length, 0);
  assert.equal(out.deferred[0].placement.disposition, "refused");
  assert.match(out.deferred[0].placement.refusals[0].reasons[0], /^contested-observation:/u);
});

test("availability expiry is evaluated at supplied time and never repaired by attention", () => {
  const a = candidate("a");
  a.offers[0].availabilityEvidence = {
    offerId: a.offers[0].id, providerIdentity: a.offers[0].provider,
    accountIdentity: "urn:account:a", windowIdentity: "urn:window:a",
    observedAt: "2026-10-11T00:00:00Z", expiresAt: "2026-10-11T01:00:00Z", availableResources: [],
  };
  assert.equal(read([a], 1, { evaluatedAt: "2026-10-11T00:30:00Z" }).planned.length, 1);
  const expired = read([a], 1, { evaluatedAt: "2026-10-11T01:00:00Z" });
  assert.deepEqual(expired.deferred[0].placement.refusals[0].reasons, ["availability-evidence-not-current"]);
});

test("overlapping enabling counts cannot become additive benefit", () => {
  const a = candidate("a"), b = candidate("b");
  b.attention.held.atoms = [...a.attention.held.atoms];
  assert.throws(() => read([a, b]), /benefit is not additive/u);
  b.offers = [];
  assert.throws(() => read([a, b]), /benefit is not additive/u);
});

test("budget and measurements require explicit evidence and exact safe natural counts", () => {
  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => read([], invalid), /nonnegative safe integer/u);
    const a = candidate("a");
    a.attention.cost.amount = invalid;
    assert.throws(() => read([a]), /nonnegative safe integer/u);
  }
  for (const key of ["unit", "evidence"]) {
    const input = { budget: budget(), candidates: [] };
    input.budget[key] = "";
    assert.throws(() => decideAttentionWorkPlacement(input), /nonempty text/u);
  }
  for (const field of ["cost", "held"]) {
    const a = candidate("a"); delete a.attention[field].evidence;
    assert.throws(() => read([a]), /nonempty text/u);
  }
  const a = candidate("a"); a.attention.cost.unit = "USD";
  assert.throws(() => read([a]), /no denomination conversion/u);
  assert.throws(() => read([candidate("a", Number.MAX_SAFE_INTEGER), candidate("b", 1)]), /safe natural-count arithmetic/u);
});

test("demand and obstruction identities cannot be empty or repeated", () => {
  assert.throws(() => read([candidate("a"), candidate("a")]), /repeat demand/u);
  const a = candidate("a"); a.attention.held.atoms = ["x", "x"];
  assert.throws(() => read([a]), /duplicates/u);
  a.attention.held.atoms = [""];
  assert.throws(() => read([a]), /nonempty text/u);
});

test("empty, zero-budget, free and zero-benefit boundaries are honest", () => {
  const empty = read([], 0);
  assert.deepEqual(empty.allocation.readNext, []);
  assert.equal(empty.unselected.total, 0);
  const out = read([candidate("free", 0, 2), candidate("costly"), candidate("no-benefit", 0, 0)], 0);
  assert.deepEqual(out.allocation.readNext, ["free"]);
  assert.deepEqual(out.unfunded.map(x => x.demand), ["costly", "no-benefit"]);
  assert.equal(out.unselected.total, 1);
});

test("the exact solver's handed input tie policy survives, separate from readNext order", () => {
  const a = candidate("a"), b = candidate("b");
  const forward = read([a, b], 1), reverse = read([b, a], 1);
  assert.deepEqual(forward.candidateOrder, ["a", "b"]);
  assert.deepEqual(forward.allocation.readNext, ["b"]);
  assert.deepEqual(reverse.allocation.readNext, ["a"]);
  assert.equal(forward.allocation.choiceBits, 1);
  assert.equal(forward.allocation.exact, true);
});

test("twenty-one positive candidates disclose approximation and unknown tie ambiguity", () => {
  const out = read(Array.from({ length: 21 }, (_, i) => candidate("work-" + i)), 3);
  assert.equal(out.allocation.exact, false);
  assert.equal(out.allocation.choiceBits, null);
  assert.equal(out.allocation.cost, 3);
});

test("all small golden cases preserve existing allocator values and selection", () => {
  for (let n = 1; n <= 5; n += 1) for (let amount = 0; amount <= 7; amount += 1) {
    const candidates = Array.from({ length: n }, (_, i) => candidate("work-" + i, i % 3, i % 4));
    const before = structuredClone(candidates);
    const expected = allocateAttention({ budget: amount,
      obstructions: candidates.map(c => ({ id: c.demand.id, cost: c.attention.cost.amount, benefit: c.attention.held.atoms.length })) });
    const out = read(candidates, amount);
    assert.deepEqual(out.allocation, expected);
    assert.deepEqual(candidates, before);
    assert.equal(out.unselected.total, expected.residual);
  }
});

test("sparse obstruction arrays cannot contribute unnamed benefit", () => {
  for (const atoms of [Array(1), ["named", , "another"]]) {
    const a = candidate("a");
    a.attention.held.atoms = atoms;
    assert.throws(() => read([a]), /atoms must be an array of nonempty text/u);
  }
});

test("sparse candidate arrays refuse without returning a partial allocation", () => {
  for (const candidates of [Array(1), [candidate("valid"), , candidate("later")]]) {
    assert.throws(() => read(candidates), TypeError);
  }
});
