import assert from "node:assert/strict";
import test from "node:test";
import { makeNiUri } from "@red-cup-engineering/ni-uri-services-section";
import { CONSIDERATION_CLOSE_CATEGORY, closeAssayedInferenceConsideration, recordAssayedInferenceConsiderationClose } from "../src/consideration-close.mjs";
import { DIRECT_WITNESS_ADAPTER, RESOLUTION_CREDIT_ASSET, RESOLUTION_CREDIT_UNIT, createExchangeCompact, createExchangeReceipt } from "../src/consideration.mjs";

const at = "2026-07-22T06:00:00.000Z";
function fixture(accepted = true) {
  const compact = createExchangeCompact({
    demand: "ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    offer: "ni:///sha-256;BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    customer: { actor: "urn:ame:customer", account: "eip155:31337:0x1111111111111111111111111111111111111111" },
    provider: { actor: "urn:ame:provider", account: "eip155:31337:0x2222222222222222222222222222222222222222" },
    consideration: { providerAlternative: "resolution-credit", policyAlternative: "resolution-credit", obligations: [{ id: "resolution-credit", kind: "credit", asset: RESOLUTION_CREDIT_ASSET, amount: 20, unit: RESOLUTION_CREDIT_UNIT, settlementAdapter: DIRECT_WITNESS_ADAPTER }] },
    createdAt: "2026-07-22T05:59:00.000Z",
  });
  const settlement = "ni:///sha-256;CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
  const receipt = createExchangeReceipt(compact, { disposition: "completion", completion: settlement });
  const assay = { id: makeNiUri(Buffer.from(`assay:${accepted}`, "utf8")), type: "CustomerTypedInferenceAssay", customer: compact.customer.actor, provider: compact.provider.actor, procurement: settlement, accepted, problems: accepted ? [] : ["$:required:missing"] };
  return { procurement: { type: "TypedRmnInferenceProcurement", disposition: "candidate-pending-customer-assay", compact, receipt, settlement }, assay };
}

test("schema-accepted work issues the exact provider-agreed credit and closes the receipt", () => {
  const { procurement, assay } = fixture(true), close = closeAssayedInferenceConsideration(procurement, assay, { closedAt: at });
  assert.equal(close.disposition, "credit-issued");
  assert.deepEqual(close.evidence.amount, { numerator: "20", denominator: "1" });
  assert.equal(close.evidence.status, "outstanding");
  assert.equal(close.successor.previous, procurement.receipt.id);
  assert.deepEqual(close.successor.consideration.map(({ status }) => status), ["fulfilled"]);
  assert.equal(close.successor.consideration[0].evidence, close.evidence.id);
});

test("schema-rejected work creates non-due evidence and no credit", () => {
  const { procurement, assay } = fixture(false), close = closeAssayedInferenceConsideration(procurement, assay, { closedAt: at });
  assert.equal(close.disposition, "consideration-not-due");
  assert.equal(close.evidence.type, "InferenceConsiderationNonDue");
  assert.equal(Object.hasOwn(close.evidence, "amount"), false);
  assert.deepEqual(close.successor.consideration.map(({ status }) => status), ["not-due"]);
});

test("the close refuses foreign assays and non-credit substitution", () => {
  const { procurement, assay } = fixture(true);
  assert.throws(() => closeAssayedInferenceConsideration(procurement, { ...assay, provider: "urn:ame:other" }, { closedAt: at }), /exact procurement parties/u);
  const changed = structuredClone(procurement);
  changed.compact.consideration.obligations[0].kind = "currency";
  assert.throws(() => closeAssayedInferenceConsideration(changed, assay, { closedAt: at }), /identity does not match/u);
});

test("network-backed settlement record lookup is awaited before idempotence filtering", async () => {
  const { procurement, assay } = fixture(true);
  const existing = closeAssayedInferenceConsideration(procurement, assay, { closedAt: at });
  let recorded = false;
  const result = await recordAssayedInferenceConsiderationClose(procurement, assay, {
    customerServices: { witnessJournal: { actor: "urn:ame:witnessJournal", agentCard: "https://witnessJournal.example/.well-known/agent-card.json" } },
    store: {
      actor: procurement.compact.customer.actor,
      settlement: procurement.compact.customer.account,
      async records(category) {
        assert.equal(category, CONSIDERATION_CLOSE_CATEGORY);
        return [existing];
      },
      async record() { recorded = true; },
    },
  });
  assert.equal(result.id, existing.id);
  assert.equal(result.idempotent, true);
  assert.equal(recorded, false);
});
