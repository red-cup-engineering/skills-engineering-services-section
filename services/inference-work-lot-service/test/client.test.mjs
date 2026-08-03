import assert from "node:assert/strict";
import test from "node:test";
import { inferenceBatchRequest, requestInferenceWorkBatch } from "../src/client.mjs";

const job = {
  id: "timeout-composition",
  objective: "Exercise one bounded inference cancellation path.",
  outputContract: { schema: { type: "object", properties: {}, additionalProperties: false } },
};

test("mission customer projections survive the shared inference client boundary", () => {
  const schema = { type: "object", required: ["action"], properties: { action: { const: "observe" } }, additionalProperties: false };
  const request = inferenceBatchRequest({
    id: "projected-reasoning", objective: "Reason, then expose one action.",
    outputContract: { format: "text" },
    customerProjection: { type: "fenced-json-tool-call", schema },
  }, { customer: "urn:test:customer", purpose: "projection assay", desiredUse: "one action", workLotPrefix: "client-test" });
  assert.deepEqual(request.outputSchema, schema);
  assert.deepEqual(request.outputProjection, { type: "fenced-json-tool-call", schema });
  assert.equal(request.enforceProviderSchema, false);
});

function waitForAbort(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("an artificial per-job timeout is refused before provider contact", async () => {
  let observed;
  const records = await requestInferenceWorkBatch([job], {
    customer: "urn:test:customer", purpose: "timeout assay", desiredUse: "assay", workLotPrefix: "client-test",
    timeoutMs: 20,
    contract: async ({ signal }) => { observed = signal; return waitForAbort(signal); },
  });
  assert.equal(observed, undefined);
  assert.equal(records[0].refusal.type, "market-transport-refusal");
  assert.match(records[0].refusal.reason, /timeoutMs is retired/u);
});

test("external cancellation composes into the same per-job provider signal", async () => {
  const customer = new AbortController();
  let observed;
  const pending = requestInferenceWorkBatch([job], {
    customer: "urn:test:customer", purpose: "external abort assay", desiredUse: "assay", workLotPrefix: "client-test",
    signal: customer.signal,
    contract: async ({ signal }) => { observed = signal; return waitForAbort(signal); },
  });
  customer.abort(abortedByCustomer());
  await assert.rejects(pending, /inference procurement aborted/);
  assert.equal(observed, customer.signal);
  assert.equal(observed.aborted, true);
  assert.match(observed.reason.message, /customer cancelled/);
});

test("a selected-provider refusal preserves provider, offer, reason, and ranked frontier", async () => {
  const rankedFeasibleOffers = [{ provider: "urn:ame:provider-a", offer: "urn:offer:a", model: "model-a", consideration: { amount: 3 } }];
  const [record] = await requestInferenceWorkBatch([job], {
    customer: "urn:test:customer", purpose: "preserve market residue", desiredUse: "retry from pressure", workLotPrefix: "client-test",
    contract: async () => ({
      result: {
        outcome: "market-residue", disposition: "selected-provider-refused", provider: "urn:ame:provider-a", selectedOffer: "urn:offer:a",
        selectionRule: "expected-resolution", rankedFeasibleOffers,
        settlementResidues: [{ provider: "urn:ame:provider-a", offer: "urn:offer:a", disposition: "settlement-transport-refusal", reason: "provider relay exited" }],
      },
      provider: { account: "urn:ame:inference-market" }, resultNi: "ni:///sha-256;market-residue",
    }),
  });
  assert.equal(record.provider, "urn:ame:provider-a");
  assert.equal(record.refusal.settlementResidues[0].reason, "provider relay exited");
  assert.equal(record.procurement.selectedOffer, "urn:offer:a");
  assert.equal(record.procurement.selectionRule, "expected-resolution");
  assert.deepEqual(record.procurement.rankedFeasibleOffers, rankedFeasibleOffers);
});

function abortedByCustomer() {
  const error = new Error("customer cancelled this bounded lot");
  error.name = "AbortError";
  return error;
}
