import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { exactAmount } from "../src/exact-amount.mjs";
import { appendDelivery, appendObservation, appendProviderRefusal, expectedResolutionPrice, loadObservations, rankOffers, reliabilityCounts } from "../src/expected-resolution-pricing.mjs";
import { createExpectedResolutionPricingServer } from "../scripts/serve-expected-resolution-pricing.mjs";

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
async function listen(server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); await new Promise((done) => setImmediate(done)); }
async function close(server) { server.close(); await once(server, "close"); }

test("an unobserved provider prices at exactly twice its declared amount", () => {
  const price = expectedResolutionPrice(exactAmount(80), "urn:ame:provider-a", "leader-movement-work-order/define", []);
  assert.equal(price.numerator, "160");
  assert.equal(price.denominator, "1");
  assert.deepEqual(price.basis, { successes: 0, total: 0 });
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

test("appendObservation and loadObservations round-trip through disk, and absence is empty rather than an error", () => {
  withTempDataRoot((dataRoot) => {
    assert.deepEqual(loadObservations({ dataRoot }), []);
    appendDelivery(delivery, { dataRoot });
    const written = appendObservation(receiverOutcome(), { dataRoot });
    assert.match(written.id, /^urn:sha256:/);
    assert.equal(typeof written.observedAt, "string");
    const loaded = loadObservations({ dataRoot });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].provider, "urn:ame:provider-a");
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
    const input = { workLot: "urn:lot:refused", provider: "urn:ame:provider-a", taskClass: "t", selectedOffer: "urn:offer:refused", disposition: "provider-refusal", evidence: "ni:///sha-256;refusal" };
    const first = appendProviderRefusal(input, { dataRoot });
    const replay = appendProviderRefusal(input, { dataRoot });
    assert.equal(replay.id, first.id);
    assert.deepEqual(reliabilityCounts(input.provider, input.taskClass, loadObservations({ dataRoot })), { successes: 0, total: 1 });
    assert.throws(() => appendProviderRefusal({ ...input, evidence: "ni:///sha-256;conflict" }, { dataRoot }), /conflicting evidence/u);
  });
});

test("the HTTP server observes real outcomes and ranks with them on the next call", async () => {
  await withTempDataRootAsync(async (dataRoot) => {
    const server = createExpectedResolutionPricingServer({ dataRoot });
    await listen(server);
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    try {
      const offers = [{ provider: "urn:ame:provider-a", consideration: { kind: "credit", asset: "urn:union:credit:relative-resolution-milliquanta-v1", unit: "relative-resolution-milliquanta-v1", amount: exactAmount(80) } }];

      const firstRank = await (await fetch(`${base}/rank`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskClass: "t", offers }) })).json();
      assert.equal(firstRank.ok, true);
      assert.equal(firstRank.result.ranked[0].expectedPrice.numerator, "160"); // unobserved: 2x

      const registered = await (await fetch(`${base}/deliver`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(delivery) })).json();
      assert.equal(registered.ok, true);
      const observeResponse = await (await fetch(`${base}/observe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(receiverOutcome()) })).json();
      assert.equal(observeResponse.ok, true);
      assert.match(observeResponse.observation.id, /^urn:sha256:/);

      const secondRank = await (await fetch(`${base}/rank`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskClass: "t", offers }) })).json();
      // one observed acceptance: (1+2)/(1+1) = 3/2 -> 80*3/2 = 120
      assert.equal(secondRank.result.ranked[0].expectedPrice.numerator, "120");
      assert.equal(secondRank.result.ranked[0].expectedPrice.denominator, "1");
      const unknown = await fetch(`${base}/rank`, { method: "GET" });
      assert.equal(unknown.status, 404);
      assert.equal((await unknown.json()).ok, false);
    } finally {
      await close(server);
    }
  });
});
