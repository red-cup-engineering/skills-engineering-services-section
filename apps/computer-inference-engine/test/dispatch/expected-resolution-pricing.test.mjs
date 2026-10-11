import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nonnegativeHostRatio as exactNonnegativeAmount, positiveHostRatio as exactAmount } from "@red-cup-engineering/metrologic/number/wire-ratio";
import { appendDelivery, appendObservation, appendInferenceRefusal, expectedResolutionPrice, loadObservations, rankOffers, reliabilityCounts, terminalResolutionCounts } from "../../src/dispatch/expected-resolution-pricing.mjs";
import { executionConfigurationIdentity } from "../../src/dispatch/sen-carrier.mjs";

function withTempDataRoot(run) {
  const dataRoot = mkdtempSync(join(tmpdir(), "expected-resolution-pricing-test-"));
  try {
    return run(dataRoot);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
}
async function withTempDataRootAsync(run) {
  const dataRoot = mkdtempSync(join(tmpdir(), "expected-resolution-pricing-test-"));
  try { return await run(dataRoot); }
  finally { rmSync(dataRoot, { recursive: true, force: true }); }
}

const delivery = { workLot: "urn:lot:one", provider: "urn:ame:provider-a", taskClass: "t", selectedOffer: "urn:offer:one", receipt: "urn:receipt:one", receiver: "urn:ame:receiver" };
const receiverOutcome = (extra = {}) => ({ ...delivery, outcome: "accepted", evidence: "urn:receiver:decision:one", ...extra });

test("an unobserved provider prices at exactly twice its declared amount", () => {
  const price = expectedResolutionPrice(exactAmount(80), "urn:ame:provider-a", "leader-movement-work-order/define", []);
  assert.equal(price.numerator, "160");
  assert.equal(price.denominator, "1");
  assert.deepEqual(price.basis, { receiverAcceptances: 0, receiverRefusals: 0, providerRefusals: 0, successfulResolutions: 0, terminalResolutions: 0 });
});

test("observed acceptances converge expected price toward the declared amount", () => {
  const observations = [
    { kind: "receiver-outcome", provider: "urn:ame:provider-a", taskClass: "t", outcome: "accepted" },
    { kind: "receiver-outcome", provider: "urn:ame:provider-a", taskClass: "t", outcome: "accepted" },
    { kind: "receiver-outcome", provider: "urn:ame:provider-a", taskClass: "t", outcome: "accepted" },
  ];
  const price = expectedResolutionPrice(exactAmount(80), "urn:ame:provider-a", "t", observations);
  // (successes+1)/(total+2) = 4/5 reliability -> price = 80 * 5/4 = 100
  assert.equal(price.numerator, "100");
  assert.equal(price.denominator, "1");
});

test("observed refusals price a provider above its declared amount", () => {
  const observations = [
    { kind: "receiver-outcome", provider: "urn:ame:provider-a", taskClass: "t", outcome: "refused" },
    { kind: "receiver-outcome", provider: "urn:ame:provider-a", taskClass: "t", outcome: "refused" },
    { kind: "receiver-outcome", provider: "urn:ame:provider-a", taskClass: "t", outcome: "refused" },
  ];
  const price = expectedResolutionPrice(exactAmount(80), "urn:ame:provider-a", "t", observations);
  // reliability 1/5 -> price = 80 * 5/1 = 400
  assert.equal(price.numerator, "400");
  assert.equal(price.denominator, "1");
});

test("reliabilityCounts scopes strictly to one provider within one taskClass", () => {
  const observations = [
    { kind: "receiver-outcome", provider: "urn:ame:provider-a", taskClass: "t1", outcome: "accepted" },
    { kind: "receiver-outcome", provider: "urn:ame:provider-a", taskClass: "t2", outcome: "refused" },
    { kind: "receiver-outcome", provider: "urn:ame:provider-b", taskClass: "t1", outcome: "refused" },
  ];
  assert.deepEqual(reliabilityCounts("urn:ame:provider-a", "t1", observations), { successes: 1, total: 1 });
});

test("rankOffers orders a cheaper-but-unreliable provider behind a pricier-but-proven one", () => {
  const observations = [
    ...Array(5).fill({ kind: "receiver-outcome", provider: "urn:ame:cheap-flaky", taskClass: "t", outcome: "refused" }),
    ...Array(5).fill({ kind: "receiver-outcome", provider: "urn:ame:pricier-reliable", taskClass: "t", outcome: "accepted" }),
  ];
  const offers = [
    { provider: "urn:ame:cheap-flaky", consideration: { kind: "credit", asset: "urn:union:credit:relative-resolution-milliquanta-v1", unit: "relative-resolution-milliquanta-v1", amount: exactAmount(20) } },
    { provider: "urn:ame:pricier-reliable", consideration: { kind: "credit", asset: "urn:union:credit:relative-resolution-milliquanta-v1", unit: "relative-resolution-milliquanta-v1", amount: exactAmount(80) } },
  ];
  const ranked = rankOffers("t", offers, observations);
  // cheap-flaky: 5 refusals -> (5+2)/(0+1) = 7 -> 20*7 = 140
  // pricier-reliable: 5 acceptances -> (5+2)/(5+1) = 7/6 -> 80*7/6 = 280/3 ~= 93.33
  assert.equal(ranked[0].provider, "urn:ame:pricier-reliable");
  assert.equal(ranked[0].expectedPrice.numerator, "280");
  assert.equal(ranked[0].expectedPrice.denominator, "3");
  assert.equal(ranked[1].provider, "urn:ame:cheap-flaky");
  assert.equal(ranked[1].expectedPrice.numerator, "140");
  assert.equal(ranked[1].expectedPrice.denominator, "1");
});

test("the free-goods rule: two $0 offers tie on price and rank by observed accepted-resolution rate", () => {
  const observations = [
    ...Array(9).fill({ kind: "receiver-outcome", provider: "urn:ame:free-reliable", taskClass: "t", outcome: "accepted" }),
    { kind: "receiver-outcome", provider: "urn:ame:free-flaky", taskClass: "t", outcome: "accepted" },
    ...Array(4).fill({ kind: "receiver-outcome", provider: "urn:ame:free-flaky", taskClass: "t", outcome: "refused" }),
  ];
  const offers = [
    { provider: "urn:ame:free-flaky", consideration: { kind: "credit", asset: "urn:union:credit:relative-resolution-milliquanta-v1", unit: "relative-resolution-milliquanta-v1", amount: exactNonnegativeAmount(0) } },
    { provider: "urn:ame:free-reliable", consideration: { kind: "credit", asset: "urn:union:credit:relative-resolution-milliquanta-v1", unit: "relative-resolution-milliquanta-v1", amount: exactNonnegativeAmount(0) } },
  ];
  const ranked = rankOffers("t", offers, observations);
  // both price at exactly 0 -- price cannot order them, so the tie breaks on
  // the same smoothed rate the price multiplier inverts: free-reliable
  // (10/11) beats free-flaky (2/7).
  assert.equal(ranked[0].expectedPrice.numerator, "0");
  assert.equal(ranked[1].expectedPrice.numerator, "0");
  assert.equal(ranked[0].provider, "urn:ame:free-reliable");
  assert.equal(ranked[1].provider, "urn:ame:free-flaky");
});

test("an unbroken tie (no observations on either side) falls back to provider order", () => {
  const offers = [
    { provider: "urn:ame:free-b", consideration: { kind: "credit", asset: "urn:union:credit:relative-resolution-milliquanta-v1", unit: "relative-resolution-milliquanta-v1", amount: exactNonnegativeAmount(0) } },
    { provider: "urn:ame:free-a", consideration: { kind: "credit", asset: "urn:union:credit:relative-resolution-milliquanta-v1", unit: "relative-resolution-milliquanta-v1", amount: exactNonnegativeAmount(0) } },
  ];
  const ranked = rankOffers("t", offers, []);
  assert.deepEqual(ranked.map(({ provider }) => provider), ["urn:ame:free-a", "urn:ame:free-b"]);
});

test("appendObservation and loadObservations round-trip through disk, and absence is empty rather than an error", () => {
  withTempDataRoot((dataRoot) => {
    assert.deepEqual(loadObservations({ dataRoot }), []);
    appendDelivery(delivery, { dataRoot });
    const written = appendObservation(receiverOutcome(), { dataRoot });
    assert.match(written.id, /^ni:\/\/\/sha-256;/);
    assert.equal(typeof written.observedAt, "string");
    const loaded = loadObservations({ dataRoot });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].provider, "urn:ame:provider-a");
  });
});

test("configuration-bound receiver outcomes cannot cross-contaminate sibling models or add a second disposition", () => {
  withTempDataRoot((dataRoot) => {
    const first = { ...delivery, selectedOffer: "urn:offer:model-a", receipt: "urn:receipt:model-a", configuration: { provider: delivery.provider, model: "model-a" } };
    const second = { ...delivery, selectedOffer: "urn:offer:model-b", receipt: "urn:receipt:model-b", configuration: { provider: delivery.provider, model: "model-b" } };
    first.configurationIdentity = executionConfigurationIdentity(first.configuration);
    second.configurationIdentity = executionConfigurationIdentity(second.configuration);
    appendDelivery(first, { dataRoot });
    appendDelivery(second, { dataRoot });
    appendObservation({ ...first, outcome: "accepted", evidence: "urn:evidence:model-a" }, { dataRoot });
    assert.deepEqual(terminalResolutionCounts(first.provider, first.taskClass, loadObservations({ dataRoot }), first.configurationIdentity), { receiverAcceptances: 1, receiverRefusals: 0, providerRefusals: 0, successfulResolutions: 1, terminalResolutions: 1 });
    assert.deepEqual(terminalResolutionCounts(second.provider, second.taskClass, loadObservations({ dataRoot }), second.configurationIdentity), { receiverAcceptances: 0, receiverRefusals: 0, providerRefusals: 0, successfulResolutions: 0, terminalResolutions: 0 });
    assert.throws(() => appendObservation({ ...first, outcome: "refused", evidence: "urn:evidence:contradiction" }, { dataRoot }), /one receiver disposition/u);
  });
});

test("appendObservation refuses an observation missing provider, taskClass, or outcome", () => {
  withTempDataRoot((dataRoot) => {
    assert.throws(() => appendObservation({ taskClass: "t", outcome: "accepted" }, { dataRoot }), /provider/);
    assert.throws(() => appendObservation({ provider: "urn:ame:a", outcome: "accepted" }, { dataRoot }), /taskClass/);
    assert.throws(() => appendObservation({ provider: "urn:ame:a", taskClass: "t" }, { dataRoot }), /outcome/);
    assert.throws(() => appendObservation({ provider: "urn:ame:a", taskClass: "t", outcome: "schema-valid", evidence: "urn:evidence:1" }, { dataRoot }), /accepted or refused/);
    assert.throws(() => appendObservation({ ...delivery, provider: "urn:ame:a", outcome: "accepted" }, { dataRoot }), /evidence/);
  });
});

test("replaying the same receiver evidence does not inflate reliability", () => {
  withTempDataRoot((dataRoot) => {
    appendDelivery(delivery, { dataRoot });
    const input = receiverOutcome();
    const first = appendObservation(input, { dataRoot });
    const replay = appendObservation(input, { dataRoot });
    assert.equal(replay.id, first.id);
    assert.equal(loadObservations({ dataRoot }).length, 1);
  });
});

test("a provider refusal is pressure without a fabricated delivery or receiver outcome", () => {
  withTempDataRoot((dataRoot) => {
    const input = { workLot: "urn:lot:refused", provider: "urn:ame:provider-a", taskClass: "t", selectedOffer: "urn:offer:refused", disposition: "provider-refusal", refusalReceipt: "ni:///sha-256;refusal-receipt", refusalWitness: "ni:///sha-256;refusal-witness" };
    const first = appendInferenceRefusal(input, { dataRoot });
    const replay = appendInferenceRefusal(input, { dataRoot });
    assert.equal(replay.id, first.id);
    assert.deepEqual(reliabilityCounts(input.provider, input.taskClass, loadObservations({ dataRoot })), { successes: 0, total: 1 });
    assert.throws(() => appendInferenceRefusal({ ...input, refusalWitness: "ni:///sha-256;conflict" }, { dataRoot }), /conflicting evidence/u);
    assert.throws(() => appendInferenceRefusal({ ...input, workLot: "urn:lot:missing-receipt", refusalReceipt: undefined }, { dataRoot }), /refusalReceipt/u);
  });
});

test("terminal resolution counts preserve provider and receiver refusal ownership", () => {
  const observations = [
    { kind: "provider-refusal", provider: "urn:ame:a", taskClass: "t" },
    { kind: "receiver-outcome", provider: "urn:ame:a", taskClass: "t", outcome: "accepted" },
    { kind: "receiver-outcome", provider: "urn:ame:a", taskClass: "t", outcome: "refused" },
    { kind: "provider-transport-obstructed", provider: "urn:ame:a", taskClass: "t" },
  ];
  assert.deepEqual(terminalResolutionCounts("urn:ame:a", "t", observations), {
    receiverAcceptances: 1, receiverRefusals: 1, providerRefusals: 1, successfulResolutions: 1, terminalResolutions: 3,
  });
  const price = expectedResolutionPrice(exactAmount(80), "urn:ame:a", "t", observations);
  assert.equal(price.numerator, "200");
  assert.equal(price.denominator, "1");
});

test("recorded outcomes sharpen the next ranking", async () => {
  await withTempDataRootAsync(async (dataRoot) => {
      const offers = [{ provider: "urn:ame:provider-a", consideration: { kind: "credit", asset: "urn:union:credit:relative-resolution-milliquanta-v1", unit: "relative-resolution-milliquanta-v1", amount: exactAmount(80) } }];
    assert.equal(rankOffers("t", offers, loadObservations({ dataRoot }))[0].expectedPrice.numerator, "160"); // unobserved: 2x
    appendDelivery(delivery, { dataRoot });
    assert.match(appendObservation(receiverOutcome(), { dataRoot }).id, /^ni:\/\/\/sha-256;/);
    // one observed acceptance: (1+2)/(1+1) = 3/2 -> 80*3/2 = 120
    const ranked = rankOffers("t", offers, loadObservations({ dataRoot }));
    assert.equal(ranked[0].expectedPrice.numerator, "120");
    assert.equal(ranked[0].expectedPrice.denominator, "1");
  });
});

test("a judgment another register makes of an inference delivery reaches routing", async () => {
  const { withRegisterJudgments, terminalResolutionCounts } = await import("../../src/dispatch/expected-resolution-pricing.mjs");
  const { outcomeOf, standingOutcomes } = await import("@red-cup-engineering/organizing/enterprise/outcomes");
  const delivery = (receipt) => ({ id: `delivery-${receipt}`, workLot: `lot-${receipt}`, provider: "urn:ame:p", taskClass: "news-draft", selectedOffer: "urn:offer:o", receipt, receiver: "urn:ame:newsroom" });
  const deliveries = [delivery("r1"), delivery("r2"), delivery("r3")];
  const accepted = { kind: "receiver-outcome", id: "obs-r1", delivery: "delivery-r1", workLot: "lot-r1", provider: "urn:ame:p", taskClass: "news-draft", selectedOffer: "urn:offer:o", receipt: "r1", receiver: "urn:ame:newsroom", outcome: "accepted", evidence: "assay" };
  const verdict = (receipt, value, extra = {}) => outcomeOf({ source: "editor", lot: `lot-${receipt}`, delivery: receipt, provider: "urn:ame:p", judge: "editor", verdict: value, at: "2026-10-03T18:00:00Z", evidence: ["edition"], market: { provider: "urn:ame:p", offer: "urn:offer:o", taskClass: "news-draft", receipt }, ...extra });
  const rejected = verdict("r1", "rejected");
  const market = outcomeOf({ source: "inference-market", lot: "lot-r3", delivery: "r3", provider: "urn:ame:p", judge: "urn:ame:newsroom", verdict: "accepted", at: "2026-10-03T18:00:00Z", evidence: ["x"], market: { provider: "urn:ame:p", offer: "urn:offer:o", taskClass: "news-draft", receipt: "r3" } });
  const joined = withRegisterJudgments([accepted], standingOutcomes([rejected, verdict("r2", "accepted"), market]), deliveries);
  // The editor's rejection retracts the assay's acceptance of r1; its acceptance of r2, never judged
  // by the receiver, is r2's outcome; the market's own outcome for r3 is not read twice.
  assert.deepEqual(terminalResolutionCounts("urn:ame:p", "news-draft", joined), { receiverAcceptances: 1, receiverRefusals: 1, providerRefusals: 0, successfulResolutions: 1, terminalResolutions: 2 });
  assert.equal(joined.filter((item) => item.register === "editor").length, 2);
  // A voided verdict no longer stands.
  const voided = outcomeOf({ source: "editor", lot: "lot-r1", delivery: "r1", provider: "urn:ame:p", judge: "editor", verdict: "voided", voids: rejected.id, at: "2026-10-03T19:00:00Z", evidence: ["withdrawn"] });
  assert.equal(withRegisterJudgments([accepted], standingOutcomes([rejected, voided]), deliveries).length, 1);
});

test("the pricing book is kept in the one log; JSONL left by an earlier release is admitted once and left unchanged", async () => {
  const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
  const { loadDeliveries, DELIVERIES_FILE, OBSERVATIONS_FILE } = await import("../../src/dispatch/expected-resolution-pricing.mjs");
  return withTempDataRoot((dataRoot) => {
    const earlier = { id: "urn:test:earlier-availability", observedAt: "2026-10-01T00:00:00.000Z", kind: "provider-availability", provider: "urn:ame:provider-a", credentialSha256: null, state: "available", quota: null, backoffUntil: null, reason: "earlier release" };
    const legacy = `${JSON.stringify(earlier)}\n`;
    writeFileSync(join(dataRoot, OBSERVATIONS_FILE), legacy);
    const recorded = appendDelivery(delivery, { dataRoot });
    const outcome = appendObservation(receiverOutcome(), { dataRoot });
    assert.deepEqual(loadObservations({ dataRoot }).map((item) => item.id), [earlier.id, outcome.id]);
    assert.deepEqual(loadDeliveries({ dataRoot }).map((item) => item.id), [recorded.id]);
    assert.equal(readFileSync(join(dataRoot, OBSERVATIONS_FILE), "utf8"), legacy);
    assert.equal(existsSync(join(dataRoot, DELIVERIES_FILE)), false);
    assert.ok(existsSync(join(dataRoot, "pricing-book.journal", "jsonl-admission.json")));
    assert.equal(loadObservations({ dataRoot }).filter((item) => item.id === earlier.id).length, 1);
  });
});

test("accepted native error reports remain terminal attempts without fabricated receiver refusal", async () => {
  const { withRegisterJudgments } = await import("../../src/dispatch/expected-resolution-pricing.mjs");
  const { outcomeOf, marketJudgmentsIndexOf } = await import("@red-cup-engineering/organizing/enterprise/outcomes");
  const { workResultFromSkillResult } = await import("@red-cup-engineering/organizing/work/schema");
  const { skillError, skillSuccess } = await import("@red-cup-engineering/animating/becoming/doing/working/governing/skill");
  const reportedResult = workResultFromSkillResult(skillError("Unresolvable", "Missing evidence", "recover source", "read the owner"));
  const registered = { id: "delivery-one", ...delivery };
  const make = (result, verdict = "accepted") => outcomeOf({
    source: "work-discharge", lot: delivery.workLot, delivery: delivery.receipt,
    provider: delivery.provider, judge: delivery.receiver, verdict, at: "2026-10-10T12:00:00Z", evidence: [delivery.receipt],
    reportedResult: result, value: { amount: "4", currency: "USD", basis: "cost" },
    market: { provider: delivery.provider, offer: delivery.selectedOffer, taskClass: delivery.taskClass, receipt: delivery.receipt },
  });
  const outcome = make(reportedResult);
  const judgments = marketJudgmentsIndexOf([outcome, outcome], { at: outcome.at, digest: "fixture" }).judgments;
  const joined = withRegisterJudgments([], judgments, [registered]);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].outcome, "accepted");
  assert.equal(joined[0].reportVerdict, "accepted");
  assert.deepEqual(joined[0].reportedResult, reportedResult);
  const expected = { receiverAcceptances: 0, receiverRefusals: 0, providerRefusals: 0, executionFailures: 1, successfulResolutions: 0, terminalResolutions: 1 };
  assert.deepEqual(terminalResolutionCounts(delivery.provider, "t", joined), expected);
  assert.deepEqual(terminalResolutionCounts(delivery.provider, "t", withRegisterJudgments(joined, judgments, [registered])), expected);
  assert.equal(expectedResolutionPrice(exactAmount(80), delivery.provider, "t", joined).numerator, "240");
  // An existing receiver observation is enriched in this read, never duplicated or rewritten.
  const prior = { kind: "receiver-outcome", id: "original", ...receiverOutcome(), delivery: registered.id };
  const enriched = withRegisterJudgments([prior], judgments, [registered]);
  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].id, "original");
  assert.equal(enriched[0].outcome, "accepted");
  assert.equal(Object.hasOwn(prior, "reportedResult"), false);
  assert.deepEqual(terminalResolutionCounts(delivery.provider, "t", enriched), expected);
  const rejected = make(workResultFromSkillResult(skillSuccess({ answer: 42 })), "rejected");
  const rejectedView = withRegisterJudgments([prior], [rejected], [registered]);
  assert.deepEqual(terminalResolutionCounts(delivery.provider, "t", rejectedView), { receiverAcceptances: 0, receiverRefusals: 1, providerRefusals: 0, successfulResolutions: 0, terminalResolutions: 1 });
});

test("failed execution reports do not become common-order receiver refusal or disappear from the denominator", async () => {
  const { incompleteOrders, withRegisterJudgments } = await import("../../src/dispatch/expected-resolution-pricing.mjs");
  const { workResultFromSkillResult } = await import("@red-cup-engineering/organizing/work/schema");
  const { skillError } = await import("@red-cup-engineering/animating/becoming/doing/working/governing/skill");
  const reportedResult = workResultFromSkillResult(skillError("Unresolvable", "No result", "recover", "retry"));
  const registered = { id: "delivery", ...delivery, order: "order-a" };
  const judgment = { id: "report", at: "2026-10-10T12:00:00Z", source: "work-discharge", verdict: "rejected", reportedResult, market: { receipt: delivery.receipt } };
  const joined = withRegisterJudgments([], [judgment], [registered]);
  assert.equal(incompleteOrders(joined, { orderChannels: 1 }).size, 0);
  assert.equal(terminalResolutionCounts(delivery.provider, "t", joined).terminalResolutions, 1);
  assert.equal(terminalResolutionCounts(delivery.provider, "t", joined).receiverRefusals, 0);
  assert.throws(() => withRegisterJudgments([], [{ ...judgment, reportedResult: { kind: "skill-error" } }], [registered]));
});
