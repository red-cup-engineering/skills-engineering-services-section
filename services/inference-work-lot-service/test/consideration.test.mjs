import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECT_WITNESS_SETTLEMENT_CAPABILITY,
  X402_SETTLEMENT_CAPABILITY,
  appendConsiderationEvidence,
  chooseConsideration,
  considerationPolicyIsSubpolicy,
  createExchangeCompact,
  createExchangeReceipt,
  exactAmount,
  resolutionCreditPolicy,
  validateConsiderationAlternative,
} from "../src/consideration.mjs";

const policy = {
  type: "ConsiderationPolicy",
  acceptableAlternatives: [
    { id: "reciprocal-service-first", obligations: [{ kind: "service", asset: "urn:service:inference-reciprocity", unit: "bounded-lot", settlementCapabilities: [DIRECT_WITNESS_SETTLEMENT_CAPABILITY] }] },
    { id: "storage-second", obligations: [{ kind: "resource", asset: "urn:resource:storage", unit: "megabyte-day", settlementCapabilities: [DIRECT_WITNESS_SETTLEMENT_CAPABILITY] }] },
    { id: "currency-last", obligations: [{ kind: "currency", asset: "eip155:8453/erc20:0x1111111111111111111111111111111111111111", unit: "base-unit", settlementCapabilities: [X402_SETTLEMENT_CAPABILITY] }] },
  ],
};
const obligation = (id, kind, asset, amount, unit, settlementCapability = DIRECT_WITNESS_SETTLEMENT_CAPABILITY) => ({ id, kind, asset, amount: exactAmount(amount), unit, settlementCapability });
const entry = (actor, id, alternatives) => ({ provider: { actor }, offer: { id, object: { considerationAlternatives: alternatives } } });

test("customer ordering selects reciprocal service without converting it to currency", () => {
  const service = entry("urn:provider:service", "urn:offer:service", [{ id: "service", obligations: [obligation("return-lot", "service", "urn:service:inference-reciprocity", 1, "bounded-lot")] }]);
  const currency = entry("urn:provider:currency", "urn:offer:currency", [{ id: "cash", obligations: [obligation("cash", "currency", "eip155:8453/erc20:0x1111111111111111111111111111111111111111", 1, "base-unit", X402_SETTLEMENT_CAPABILITY)] }]);
  const result = chooseConsideration([currency, service], policy);
  assert.equal(result.disposition, "consideration-selected");
  assert.equal(result.selected.entry.provider.actor, "urn:provider:service");
  assert.equal(result.selected.consideration.policyAlternative, "reciprocal-service-first");
});

test("incomparable multi-obligation bundles require an explicit customer choice", () => {
  const multiPolicy = { type: "ConsiderationPolicy", acceptableAlternatives: [{ id: "mixed", obligations: [
    { kind: "service", asset: "urn:service:review", unit: "review", settlementCapabilities: [DIRECT_WITNESS_SETTLEMENT_CAPABILITY] },
    { kind: "resource", asset: "urn:resource:storage", unit: "megabyte-day", settlementCapabilities: [DIRECT_WITNESS_SETTLEMENT_CAPABILITY] },
  ] }] };
  const left = entry("urn:provider:left", "urn:offer:left", [{ id: "left", obligations: [obligation("review", "service", "urn:service:review", 1, "review"), obligation("storage", "resource", "urn:resource:storage", 30, "megabyte-day")] }]);
  const right = entry("urn:provider:right", "urn:offer:right", [{ id: "right", obligations: [obligation("review", "service", "urn:service:review", 3, "review"), obligation("storage", "resource", "urn:resource:storage", 10, "megabyte-day")] }]);
  assert.equal(chooseConsideration([left, right], multiPolicy).disposition, "customer-consideration-choice-required");
});

test("x402 is an optional currency settlement capability and cannot masquerade as service settlement", () => {
  assert.doesNotThrow(() => validateConsiderationAlternative({ id: "cash", obligations: [obligation("cash", "currency", "eip155:8453/erc20:0x1111111111111111111111111111111111111111", 4, "base-unit", X402_SETTLEMENT_CAPABILITY)] }));
  assert.throws(() => validateConsiderationAlternative({ id: "bad", obligations: [obligation("labor", "service", "urn:service:labor", 1, "hour", X402_SETTLEMENT_CAPABILITY)] }), /x402/u);
});

test("a refinement policy may narrow settlement capabilities but cannot broaden denomination", () => {
  assert.equal(considerationPolicyIsSubpolicy(resolutionCreditPolicy(), resolutionCreditPolicy()), true);
  assert.equal(considerationPolicyIsSubpolicy(policy, resolutionCreditPolicy()), false);
});

test("compact and append-only receipts evidence work and each barter obligation independently", () => {
  const consideration = { providerAlternative: "mixed", policyAlternative: "mixed", preferenceRank: 0, obligations: [
    obligation("review", "service", "urn:service:review", 1, "review"),
    obligation("storage", "resource", "urn:resource:storage", 10, "megabyte-day"),
  ] };
  const compact = createExchangeCompact({ demand: "ni:///sha-256;demand", offer: "urn:offer:mixed", customer: { actor: "urn:customer", account: "eip155:1:0x1111111111111111111111111111111111111111" }, provider: { actor: "urn:provider", account: "eip155:1:0x2222222222222222222222222222222222222222" }, consideration, createdAt: "2026-07-21T00:00:00.000Z" });
  const receipt = createExchangeReceipt(compact, { disposition: "completion", completion: "ni:///sha-256;work" });
  assert.equal(receipt.work.status, "fulfilled");
  assert.deepEqual(receipt.consideration.map(({ status }) => status), ["pending", "pending"]);
  const successor = appendConsiderationEvidence(receipt, { obligation: "review", status: "fulfilled", evidence: "ni:///sha-256;review" });
  assert.equal(successor.previous, receipt.id);
  assert.equal(successor.consideration.find(({ obligation: id }) => id === "review").evidence, "ni:///sha-256;review");
  assert.equal(successor.consideration.find(({ obligation: id }) => id === "storage").status, "pending");
  const nonDue = appendConsiderationEvidence(receipt, { obligation: "storage", status: "not-due", evidence: "ni:///sha-256;schema-refusal" });
  assert.equal(nonDue.consideration.find(({ obligation: id }) => id === "storage").status, "not-due");
  assert.throws(() => appendConsiderationEvidence(receipt, { obligation: "storage", status: "refused", evidence: "ni:///sha-256;legacy" }), /fulfilled or not-due/u);
});
