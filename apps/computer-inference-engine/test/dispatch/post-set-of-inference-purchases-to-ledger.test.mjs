import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkBooksBalance, checkAll } from "@red-cup-engineering/energy-bank/invariants";
import { createLedger } from "@red-cup-engineering/energy-bank/ledger";
import {
  fractionToDecimalString,
  parseInferencePurchaseJournal,
  postInferencePurchasesToLedger,
} from "../../scripts/dispatch/post-set-of-inference-purchases-to-ledger.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/inference-purchases-sample.jsonl", import.meta.url));

test("fractionToDecimalString: whole-integer fractions (denominator 1) render exactly", () => {
  assert.equal(fractionToDecimalString("1000", "1"), "1000");
  assert.equal(fractionToDecimalString("0", "1"), "0");
  assert.equal(fractionToDecimalString("-5", "1"), "-5");
});

test("fractionToDecimalString: a power-of-ten denominator renders an exact decimal", () => {
  assert.equal(fractionToDecimalString("299", "100"), "2.99");
});

test("fractionToDecimalString: a non-power-of-ten denominator has no finite decimal rendering and throws", () => {
  assert.throws(() => fractionToDecimalString("1", "3"), /not representable as a finite decimal/u);
});

test("parseInferencePurchaseJournal: three real-shaped purchases parse cleanly, non-purchase categories are skipped", () => {
  const text = `${readFileSync(FIXTURE, "utf8")}{"a":"publish","e":"ni:x","t":"2026-01-01T00:00:00.000Z","v":{}}\n\n`;
  const { purchases, failures } = parseInferencePurchaseJournal(text);
  assert.equal(failures.length, 0);
  assert.equal(purchases.length, 3);
  assert.deepEqual(purchases.map((p) => p.event.exchangeId), ["exchange-fixture-1", "exchange-fixture-2", "exchange-fixture-3"]);
});

test("postInferencePurchasesToLedger over the sample fixture: 5 postings, balanced, exact byProvider totals", () => {
  const text = readFileSync(FIXTURE, "utf8");
  const result = postInferencePurchasesToLedger(text);
  assert.equal(result.ok, true);
  assert.equal(result.summary.purchases, 3);
  assert.equal(result.summary.postings, 5);
  assert.equal(result.summary.unpriced, 0);
  assert.deepEqual(result.summary.byProvider, {
    anthropic: { credits: "1500", inputTokens: 100000, outputTokens: 5000 },
    "gemini-direct": { credits: "2500", inputTokens: 300, outputTokens: 200 },
  });
  assert.match(result.journalText, /expense:inference:anthropic:claude-fable-5-1\s+1000 token-claude-fable-5-1-token/u);
  assert.match(result.journalText, /liability:provider:anthropic\s+-1000 token-claude-fable-5-1-token/u);
  assert.match(result.journalText, /resource:inference-tokens:anthropic:claude-fable-5-1\s+100000 tokens/u);
  assert.match(result.journalText, /resource:inference-tokens:anthropic:claude-fable-5-1\s+5000 tokens/u);
  assert.match(result.journalText, /liability:provider:anthropic\s+-105000 tokens/u);

  // Independently reduced through energy-bank's own reference ledger, never a cached total.
  const rebuilt = createLedger();
  const replay = readFileSync(FIXTURE, "utf8");
  const replayed = postInferencePurchasesToLedger(replay);
  assert.equal(checkBooksBalance(rebuilt).length, 0);
  assert.equal(replayed.ok, true);
});

test("postInferencePurchasesToLedger is idempotent: the same input yields the same journal bytes", () => {
  const text = readFileSync(FIXTURE, "utf8");
  const first = postInferencePurchasesToLedger(text);
  const second = postInferencePurchasesToLedger(text);
  assert.equal(first.journalText, second.journalText);
  assert.deepEqual(first.summary, second.summary);
});

test("postInferencePurchasesToLedger over an empty journal: empty ledger, no error", () => {
  const result = postInferencePurchasesToLedger("");
  assert.equal(result.ok, true);
  assert.equal(result.journalText, "");
  assert.deepEqual(result.summary, { purchases: 0, postings: 0, byProvider: {}, unpriced: 0 });
});

test("postInferencePurchasesToLedger over a zero-priced (free-tier) purchase with usage: no consideration entry, tokens still posted, counted unpriced", () => {
  const line = JSON.stringify({
    a: "inference-purchased",
    e: "ni:free1",
    t: "2026-09-01T00:00:00.000Z",
    v: {
      provider: "gemini-direct",
      model: "gemini-3.5-flash-lite",
      exchangeId: "exchange-free-1",
      outcome: "completion",
      price: { amount: { numerator: "0", denominator: "1" }, denomination: { kind: "fiat", asset: "usd", unit: "micro-usd" } },
      usage: { input: { denomination: "gemini-direct-tokens-in", quantity: 44 }, output: { denomination: "gemini-direct-tokens-out", quantity: 1 } },
    },
  });
  const result = postInferencePurchasesToLedger(`${line}\n`);
  assert.equal(result.ok, true);
  assert.equal(result.summary.purchases, 1);
  assert.equal(result.summary.postings, 1);
  assert.equal(result.summary.unpriced, 1);
  assert.deepEqual(result.summary.byProvider, { "gemini-direct": { credits: "0", inputTokens: 44, outputTokens: 1 } });
  assert.doesNotMatch(result.journalText, /expense:inference/u);
  assert.equal(checkAll(createLedger()).length, 0);
});

test("postInferencePurchasesToLedger refuses a malformed line, naming it", () => {
  const goodLine = readFileSync(FIXTURE, "utf8").split("\n")[0];
  const text = `${goodLine}\n{not valid json\n`;
  const result = postInferencePurchasesToLedger(text);
  assert.equal(result.ok, false);
  assert.equal(result.error, "malformed-purchase-line");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].line, 2);
});

test("postInferencePurchasesToLedger refuses a purchase envelope missing required fields, naming the line", () => {
  const text = `${JSON.stringify({ a: "inference-purchased", e: "ni:bad", t: "2026-09-01T00:00:00.000Z", v: { provider: "p" } })}\n`;
  const result = postInferencePurchasesToLedger(text);
  assert.equal(result.ok, false);
  assert.equal(result.error, "malformed-purchase-line");
  assert.equal(result.failures[0].line, 1);
});
