import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { INFERENCE_PURCHASED_EVENT_TYPE, openHarnessLifecycleJournal, INFERENCE_PURCHASED_CATEGORY } from "@red-cup-engineering/agent-harness-computer-system-engineering-services-section";
import { CLAUDE_CUSTOMER_ACTOR, dispatchFreeFirstChatCompletionWithReceiptCli } from "../scripts/dispatch-free-first-chat-completion-with-receipt.mjs";

function fixtureDir(t, label) {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeCatalog(dir, { rows, freeFirstOrder }) {
  const path = join(dir, "catalog.json");
  writeFileSync(path, JSON.stringify({ kind: "test-catalog", version: 1, rows, routingPolicy: { freeFirstOrder } }));
  return path;
}

function writePacket(dir) {
  const path = join(dir, "packet.json");
  writeFileSync(path, JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "hi" }] }));
  return path;
}

function stubFetch(t, body, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: status >= 200 && status < 300, status, statusText: "", text: async () => JSON.stringify(body) });
  t.after(() => { globalThis.fetch = original; });
}

function withEnv(t, name, value) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
}

test("dispatching a free-tier ($0) exchange writes a $0 purchase receipt through the same command", (t) => {
  const dir = fixtureDir(t, "dispatch-with-receipt-free");
  const journalRoot = fixtureDir(t, "dispatch-with-receipt-free-journal");
  withEnv(t, "TEST_FREE_KEY", "any-nonempty-value");
  const catalogPath = writeCatalog(dir, {
    rows: [{ providerId: "test-free", chatCompletionsUrl: "https://example.invalid/v1/chat/completions", apiKeyEnvVar: "TEST_FREE_KEY", keyed: true, pricePerMillionTokensMicroUsd: { input: 0, output: 0 } }],
    freeFirstOrder: ["test-free"],
  });
  const packetPath = writePacket(dir);
  stubFetch(t, { model: "test-model", choices: [{ message: { content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } });

  return dispatchFreeFirstChatCompletionWithReceiptCli([catalogPath, packetPath, "--receipt-root", journalRoot, "--turn", "turn-1", "--actor", CLAUDE_CUSTOMER_ACTOR]).then((result) => {
    assert.equal(result.ok, true);
    assert.equal(result.provider, "test-free");
    assert.ok(result.receipt, "a dispatched exchange must produce a receipt");
    assert.equal(result.receipt.event.type, INFERENCE_PURCHASED_EVENT_TYPE);
    assert.equal(result.receipt.event.actor, CLAUDE_CUSTOMER_ACTOR);
    assert.equal(result.receipt.event.price.amount.numerator, "0");
    assert.equal(result.receipt.event.outcome, "completion");
    assert.deepEqual(result.receipt.event.usage, { input: { quantity: 3, denomination: "test-free-tokens-in" }, output: { quantity: 2, denomination: "test-free-tokens-out" } });

    const journaled = openHarnessLifecycleJournal({ root: journalRoot }).query({ category: INFERENCE_PURCHASED_CATEGORY });
    assert.equal(journaled.length, 1);
    assert.equal(journaled[0].record.exchangeId, result.exchange.id);
  });
});

test("dispatching a paid-rate exchange records the exact computed nonzero price", (t) => {
  const dir = fixtureDir(t, "dispatch-with-receipt-paid");
  const journalRoot = fixtureDir(t, "dispatch-with-receipt-paid-journal");
  withEnv(t, "TEST_PAID_KEY", "any-nonempty-value");
  const catalogPath = writeCatalog(dir, {
    rows: [{ providerId: "test-paid", chatCompletionsUrl: "https://example.invalid/v1/chat/completions", apiKeyEnvVar: "TEST_PAID_KEY", keyed: true, pricePerMillionTokensMicroUsd: { input: 2000000, output: 4000000 } }],
    freeFirstOrder: ["test-paid"],
  });
  const packetPath = writePacket(dir);
  stubFetch(t, { model: "test-model", choices: [{ message: { content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50 } });

  return dispatchFreeFirstChatCompletionWithReceiptCli([catalogPath, packetPath, "--receipt-root", journalRoot, "--turn", "turn-1", "--actor", CLAUDE_CUSTOMER_ACTOR]).then((result) => {
    // (100 * 2,000,000 + 50 * 4,000,000) / 1,000,000 = 400,000,000 / 1,000,000 = 400/1 exact.
    assert.deepEqual(result.receipt.event.price.amount, { numerator: "400", denominator: "1" });
  });
});

test("dispatching an exchange with no --receipt-root throws rather than silently skipping the receipt", (t) => {
  const dir = fixtureDir(t, "dispatch-with-receipt-missing-root");
  withEnv(t, "TEST_FREE_KEY2", "any-nonempty-value");
  const catalogPath = writeCatalog(dir, {
    rows: [{ providerId: "test-free", chatCompletionsUrl: "https://example.invalid/v1/chat/completions", apiKeyEnvVar: "TEST_FREE_KEY2", keyed: true, pricePerMillionTokensMicroUsd: { input: 0, output: 0 } }],
    freeFirstOrder: ["test-free"],
  });
  const packetPath = writePacket(dir);
  stubFetch(t, { model: "test-model", choices: [{ message: { content: "hello" } }] });

  return assert.rejects(
    dispatchFreeFirstChatCompletionWithReceiptCli([catalogPath, packetPath, "--turn", "turn-1"]),
    /--receipt-root/u,
  );
});

test("when every free-first candidate is unarmed, no exchange occurs and no receipt is attempted", (t) => {
  const dir = fixtureDir(t, "dispatch-with-receipt-unarmed");
  const journalRoot = fixtureDir(t, "dispatch-with-receipt-unarmed-journal");
  const catalogPath = writeCatalog(dir, {
    rows: [{ providerId: "test-unarmed", chatCompletionsUrl: "https://example.invalid/v1/chat/completions", apiKeyEnvVar: "TEST_TOTALLY_UNSET_KEY", keyed: false, pricePerMillionTokensMicroUsd: { input: 0, output: 0 } }],
    freeFirstOrder: ["test-unarmed"],
  });
  const packetPath = writePacket(dir);

  return dispatchFreeFirstChatCompletionWithReceiptCli([catalogPath, packetPath, "--receipt-root", journalRoot, "--turn", "turn-1"]).then((result) => {
    assert.equal(result.ok, false);
    assert.equal(result.reason, "free-first-exhausted");
    assert.ok(!Object.hasOwn(result, "receipt"));
  });
});
