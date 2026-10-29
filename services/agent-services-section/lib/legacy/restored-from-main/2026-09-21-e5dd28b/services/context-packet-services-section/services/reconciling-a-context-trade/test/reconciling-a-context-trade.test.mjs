import assert from "node:assert/strict";
import test from "node:test";
import { contextTradeReceiptClaim, exactConsideration, reconcileContextTrade } from "../src/reconciling-a-context-trade.mjs";

const packet = { profile: "org.harmonious-union.context-packet.v1", id: `ni:///sha-256;${"A".repeat(43)}`, knowledge: [{ ni: `ni:///sha-256;${"B".repeat(43)}`, relation: "supports-objective" }] };
const price = { asset: "urn:asset:inference-credit", numerator: "2", denominator: "4" };
const release = contextTradeReceiptClaim({ role: "release", actor: "urn:ame:supplier", counterparty: "urn:ame:customer", caseId: "urn:case:one", packet, consideration: price });
const admission = contextTradeReceiptClaim({ role: "admission", actor: "urn:ame:customer", counterparty: "urn:ame:supplier", caseId: "urn:case:one", packet, consideration: price });
const receipt = (claim) => ({ claim, proof: { type: "test-proof", value: claim.id } });
const verifyReceipt = async (claim, proof) => proof.value === claim.id;

test("two verified WITs produce one exact context tally", async () => {
  const tally = await reconcileContextTrade({ packet, receipts: [receipt(release), receipt(admission)], verifyReceipt });
  assert.equal(tally.witCount, 2);
  assert.deepEqual(tally.consideration, { asset: "urn:asset:inference-credit", numerator: "1", denominator: "2" });
  assert.deepEqual(tally.receipts, [release.id, admission.id].sort());
});

test("refuses free, unilateral, mismatched, and unverified transfers", async () => {
  assert.throws(() => exactConsideration({ asset: "urn:asset:x", numerator: "0", denominator: "1" }), /positive/u);
  await assert.rejects(reconcileContextTrade({ packet, receipts: [receipt(release)], verifyReceipt }), /exactly two/u);
  const mismatch = contextTradeReceiptClaim({ role: "admission", actor: "urn:ame:customer", counterparty: "urn:ame:supplier", caseId: "urn:case:other", packet, consideration: price });
  await assert.rejects(reconcileContextTrade({ packet, receipts: [receipt(release), receipt(mismatch)], verifyReceipt }), /caseId/u);
  await assert.rejects(reconcileContextTrade({ packet, receipts: [receipt(release), receipt(admission)], verifyReceipt: async () => false }), /not verified/u);
});
