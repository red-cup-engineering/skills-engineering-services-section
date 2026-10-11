import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readInferencePurchases, recordInferencePurchase } from "@red-cup-engineering/computer-inference-engine/dispatch/inference-purchase";
import { deriveInferencePnl, deriveInferencePnlCli } from "../../scripts/dispatch/derive-inference-pnl.mjs";

const CLAUDE = "actor:bZH6KBOlPVWbYpqp04izN_Xtwykn0XgsMBStm_FkPPw";
const CODEX = "actor:WWOM5azg-fTrn1Id0YVbz5AhppbnFny_W5Xl-rKgSs4";
const USD = { kind: "fiat", asset: "usd", unit: "micro-usd" };

function temporaryRoot(t, label) {
  const root = mkdtempSync(join(tmpdir(), `${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("deriveInferencePnl over zero records: a legitimate empty P&L, not an error", () => {
  const pnl = deriveInferencePnl([]);
  assert.equal(pnl.purchaseCount, 0);
  assert.deepEqual(pnl.totalsByDenomination, []);
  assert.deepEqual(pnl.byProvider, []);
  assert.deepEqual(pnl.byCustomerActor, []);
  assert.deepEqual(pnl.byConsiderationClass, []);
});

test("deriveInferencePnl over free-only receipts: total is exactly zero and everything classifies as free", (t) => {
  const root = temporaryRoot(t, "derive-pnl-free-only");
  recordInferencePurchase({ root, actor: CLAUDE, turnId: "turn-1", provider: "ollama-local", model: "qwen3:1.7b", outcome: "completion", latencySeconds: 12, exchangeId: "exchange-1", price: { denomination: USD, amount: { numerator: "0", denominator: "1" } }, recordedAt: "2026-08-31T10:00:00.000Z" });
  recordInferencePurchase({ root, actor: CLAUDE, turnId: "turn-1", provider: "groq", model: "openai/gpt-oss-20b", outcome: "completion", latencySeconds: 0.6, exchangeId: "exchange-2", price: { denomination: USD, amount: { numerator: "0", denominator: "1" } }, recordedAt: "2026-08-31T10:01:00.000Z" });
  const records = readInferencePurchases({ root });
  const pnl = deriveInferencePnl(records);
  assert.equal(pnl.purchaseCount, 2);
  assert.deepEqual(pnl.totalsByDenomination, [{ denomination: USD, amount: { numerator: "0", denominator: "1" }, count: 2 }]);
  assert.equal(pnl.byConsiderationClass.length, 1);
  assert.equal(pnl.byConsiderationClass[0].class, "free");
  assert.equal(pnl.byConsiderationClass[0].count, 2);
  assert.deepEqual(pnl.byProvider.map(({ provider, count }) => [provider, count]).sort(), [["groq", 1], ["ollama-local", 1]]);
});

test("deriveInferencePnl over a mixed free+paid session: exact totals, free/paid split, per-provider and per-actor breakdowns", (t) => {
  const root = temporaryRoot(t, "derive-pnl-mixed");
  recordInferencePurchase({ root, actor: CLAUDE, turnId: "turn-1", provider: "ollama-local", model: "qwen3:1.7b", outcome: "completion", latencySeconds: 12, exchangeId: "exchange-1", price: { denomination: USD, amount: { numerator: "0", denominator: "1" } }, recordedAt: "2026-08-31T10:00:00.000Z" });
  recordInferencePurchase({ root, actor: CLAUDE, turnId: "turn-1", provider: "openrouter-gpt-4o-paid-reference", model: "openai/gpt-4o", outcome: "completion", latencySeconds: 2.1, exchangeId: "exchange-2", price: { denomination: USD, amount: { numerator: "400", denominator: "1" } }, recordedAt: "2026-08-31T10:02:00.000Z" });
  recordInferencePurchase({ root, actor: CODEX, turnId: "turn-2", provider: "openrouter-gpt-4o-paid-reference", model: "openai/gpt-4o", outcome: "completion", latencySeconds: 3.4, exchangeId: "exchange-3", price: { denomination: USD, amount: { numerator: "600", denominator: "1" } }, recordedAt: "2026-08-31T11:00:00.000Z" });
  const records = readInferencePurchases({ root });
  const pnl = deriveInferencePnl(records);

  assert.equal(pnl.purchaseCount, 3);
  assert.deepEqual(pnl.totalsByDenomination, [{ denomination: USD, amount: { numerator: "1000", denominator: "1" }, count: 3 }]);

  const byClass = Object.fromEntries(pnl.byConsiderationClass.map((entry) => [entry.class, entry]));
  assert.equal(byClass.free.count, 1);
  assert.deepEqual(byClass.free.totalsByDenomination[0].amount, { numerator: "0", denominator: "1" });
  assert.equal(byClass.paid.count, 2);
  assert.deepEqual(byClass.paid.totalsByDenomination[0].amount, { numerator: "1000", denominator: "1" });

  const byProvider = Object.fromEntries(pnl.byProvider.map((entry) => [entry.provider, entry]));
  assert.equal(byProvider["ollama-local"].count, 1);
  assert.equal(byProvider["openrouter-gpt-4o-paid-reference"].count, 2);
  assert.deepEqual(byProvider["openrouter-gpt-4o-paid-reference"].totalsByDenomination[0].amount, { numerator: "1000", denominator: "1" });

  const byActor = Object.fromEntries(pnl.byCustomerActor.map((entry) => [entry.actor, entry]));
  assert.equal(byActor[CLAUDE].count, 2);
  assert.deepEqual(byActor[CLAUDE].totalsByDenomination[0].amount, { numerator: "400", denominator: "1" });
  assert.equal(byActor[CODEX].count, 1);
  assert.deepEqual(byActor[CODEX].totalsByDenomination[0].amount, { numerator: "600", denominator: "1" });

  // --date and --actor filters narrow correctly.
  const onlyClaude = deriveInferencePnl(records, { actor: CLAUDE });
  assert.equal(onlyClaude.purchaseCount, 2);
  const onlyHour11 = deriveInferencePnl(records, { date: "2026-08-31T11" });
  assert.equal(onlyHour11.purchaseCount, 1);
  const onlyTurn1 = deriveInferencePnl(records, { session: "turn-1" });
  assert.equal(onlyTurn1.purchaseCount, 2);
});

test("deriveInferencePnlCli requires --root", () => {
  assert.throws(() => deriveInferencePnlCli([]), /--root/u);
});

test("deriveInferencePnlCli reads the named journal root end to end", (t) => {
  const root = temporaryRoot(t, "derive-pnl-cli");
  recordInferencePurchase({ root, actor: CLAUDE, turnId: "turn-1", provider: "ollama-local", model: "qwen3:1.7b", outcome: "completion", latencySeconds: 1, exchangeId: "exchange-1", price: { denomination: USD, amount: { numerator: "0", denominator: "1" } } });
  const pnl = deriveInferencePnlCli(["--root", root]);
  assert.equal(pnl.purchaseCount, 1);
});

