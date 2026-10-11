import assert from "node:assert/strict";
import test from "node:test";
import { deriveSetOfInferenceExpenseTransactions } from "../../scripts/fabric/derive-set-of-inference-expense-transactions.mjs";

const priceDirectives = [
  { provider: "claude", model: "claude-sonnet-5", tokenClass: "input", date: "2026-06-24", price: "2.00" },
  { provider: "claude", model: "claude-sonnet-5", tokenClass: "output", date: "2026-06-24", price: "10.00" },
  { provider: "claude", model: "claude-sonnet-5", tokenClass: "cache-read", date: "2026-06-24", price: "0.20" },
  { provider: "claude", model: "claude-sonnet-5", tokenClass: "cache-write", date: "2026-06-24", price: "2.50" },
];

test("aggregates two records for the same day/provider/model into one balanced transaction", () => {
  const result = deriveSetOfInferenceExpenseTransactions({
    usageRecords: [
      { recordId: "r1", sessionId: "s1", provider: "claude", model: "claude-sonnet-5", timestamp: "2026-09-04T10:00:00.000Z", inputTokens: 1000000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { recordId: "r2", sessionId: "s1", provider: "claude", model: "claude-sonnet-5", timestamp: "2026-09-04T11:00:00.000Z", inputTokens: 0, outputTokens: 500000, cacheReadTokens: 0, cacheCreationTokens: 0 },
    ],
    priceDirectives,
  });
  assert.equal(result.transactionCount, 1);
  const [tx] = result.transactions;
  assert.equal(tx.recordCount, 2);
  assert.equal(tx.totalUsd, "7"); // 1,000,000 tok @ $2.00/M = $2.00 + 500,000 tok @ $10.00/M = $5.00
  assert.match(tx.directive, /Expenses:Inference-and-Compute:Claude\s+7 USD/u);
  assert.match(tx.directive, /Liabilities:Accounts-Payable:Claude\s+-7 USD/u);
  assert.match(tx.directive, /witness_record_ids: "r1,r2"/u);
  assert.match(tx.directive, /session_ids: "s1"/u);
  assert.equal(result.accountsToOpen.length, 2);
  assert.equal(result.totalUsd, "7");
  assert.equal(result.refusals.length, 0);
});

test("carries every distinct sessionId in a group as comma-joined session_ids metadata", () => {
  const result = deriveSetOfInferenceExpenseTransactions({
    usageRecords: [
      { recordId: "r1", sessionId: "s1", provider: "claude", model: "claude-sonnet-5", timestamp: "2026-09-04T10:00:00.000Z", inputTokens: 1000000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { recordId: "r2", sessionId: "s2", provider: "claude", model: "claude-sonnet-5", timestamp: "2026-09-04T11:00:00.000Z", inputTokens: 0, outputTokens: 500000, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { recordId: "r3", sessionId: "s1", provider: "claude", model: "claude-sonnet-5", timestamp: "2026-09-04T12:00:00.000Z", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    ],
    priceDirectives,
  });
  assert.equal(result.transactionCount, 1);
  assert.match(result.transactions[0].directive, /session_ids: "s1,s2"/u);
});

test("refuses a group with a used token class that has no matching price directive", () => {
  const result = deriveSetOfInferenceExpenseTransactions({
    usageRecords: [
      { recordId: "r1", sessionId: "s1", provider: "openai", model: "gpt-unknown", timestamp: "2026-09-04T10:00:00.000Z", inputTokens: 100, outputTokens: 10 },
    ],
    priceDirectives,
  });
  assert.equal(result.transactionCount, 0);
  assert.equal(result.refusals.length, 1);
  assert.equal(result.refusals[0].recordIds[0], "r1");
  assert.match(result.refusals[0].reason, /no price directive/u);
});

test("refuses a malformed usage record", () => {
  assert.throws(() => deriveSetOfInferenceExpenseTransactions({ usageRecords: [{ recordId: "r1" }], priceDirectives: [] }), /sessionId must be a non-empty string/u);
});
