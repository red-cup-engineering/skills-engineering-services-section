import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readInferencePurchases } from "@red-cup-engineering/computer-inference-engine/dispatch/inference-purchase";
import { CLAUDE_CUSTOMER_ACTOR, DEFAULT_CATALOG_PATH, runMechanicalInferenceCli } from "../../scripts/dispatch/run-mechanical-inference.mjs";

test("the default catalog path resolves to a real, well-formed catalog.json without an explicit --catalog", () => {
  assert.ok(existsSync(DEFAULT_CATALOG_PATH), `DEFAULT_CATALOG_PATH does not exist: ${DEFAULT_CATALOG_PATH}`);
  const catalog = JSON.parse(readFileSync(DEFAULT_CATALOG_PATH, "utf8"));
  assert.ok(Array.isArray(catalog.rows) && catalog.rows.length > 0, "default catalog must carry at least one provider row");
  assert.ok(Array.isArray(catalog.routingPolicy?.freeFirstOrder), "default catalog must carry routingPolicy.freeFirstOrder");
});

function fixtureDir(t, label) {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeCatalog(dir, rows) {
  const path = join(dir, "catalog.json");
  writeFileSync(path, JSON.stringify({ kind: "test-catalog", version: 1, rows, routingPolicy: { freeFirstOrder: rows.map((row) => row.providerId) } }));
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

test("a non-mechanical taskType is refused before any dispatch is attempted", async (t) => {
  let fetchCalled = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; return original(); };
  t.after(() => { globalThis.fetch = original; });
  const result = await runMechanicalInferenceCli(["--task-type", "software-engineering", "--instructions", "fix the bug", "--input", "x"]);
  assert.equal(result.admitted, false);
  assert.match(result.reason, /taskType must be one of/u);
  assert.equal(fetchCalled, false);
});

test("instructions that smell like judgment are refused before any dispatch is attempted", async () => {
  const result = await runMechanicalInferenceCli(["--task-type", "summarization", "--instructions", "Recommend which approach we should decide on.", "--input", "x"]);
  assert.equal(result.admitted, false);
  assert.match(result.reason, /judgment-smell term/u);
});

test("an admitted mechanical task dispatches free-first and writes a purchase receipt", async (t) => {
  const dir = fixtureDir(t, "run-mechanical-inference");
  const journalRoot = fixtureDir(t, "run-mechanical-inference-journal");
  withEnv(t, "TEST_MECH_KEY", "any-nonempty-value");
  const catalogPath = writeCatalog(dir, [{ providerId: "test-free", chatCompletionsUrl: "https://example.invalid/v1/chat/completions", apiKeyEnvVar: "TEST_MECH_KEY", keyed: true, pricePerMillionTokensMicroUsd: { input: 0, output: 0 } }]);
  stubFetch(t, { model: "test-model", choices: [{ message: { content: "positive" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 1 } });

  const result = await runMechanicalInferenceCli([
    "--task-type", "classification",
    "--instructions", "Classify the sentiment as positive, negative, or neutral.",
    "--input", "I love this.",
    "--catalog", catalogPath,
    "--receipt-root", journalRoot,
    "--turn", "turn-mech-1",
    "--actor", CLAUDE_CUSTOMER_ACTOR,
  ]);

  assert.equal(result.admitted, true);
  assert.equal(result.ok, true);
  assert.equal(result.provider, "test-free");
  assert.equal(result.exchange.completion.text, "positive");
  assert.ok(result.receipt, "an admitted dispatched exchange must produce a receipt");
  assert.equal(result.receipt.event.actor, CLAUDE_CUSTOMER_ACTOR);
  assert.equal(result.receipt.event.price.amount.numerator, "0");

  const journaled = readInferencePurchases({ root: journalRoot });
  assert.equal(journaled.length, 1);
  assert.equal(journaled[0].record.exchangeId, result.exchange.id);
});

test("when every free-first candidate is unarmed, the refusal carries no exchange and no receipt is attempted", async (t) => {
  const dir = fixtureDir(t, "run-mechanical-inference-unarmed");
  const catalogPath = writeCatalog(dir, [{ providerId: "test-unarmed", chatCompletionsUrl: "https://example.invalid/v1/chat/completions", apiKeyEnvVar: "TEST_UNARMED_KEY_DOES_NOT_EXIST", keyed: true }]);
  const result = await runMechanicalInferenceCli([
    "--task-type", "extraction",
    "--instructions", "Extract every email address.",
    "--input", "contact us at a@example.com",
    "--catalog", catalogPath,
  ]);
  assert.equal(result.admitted, true);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "free-first-exhausted");
  assert.equal(result.receipt, undefined);
});

test("an exchange with no --receipt-root throws rather than silently skipping the receipt", async (t) => {
  const dir = fixtureDir(t, "run-mechanical-inference-missing-root");
  withEnv(t, "TEST_MECH_KEY2", "any-nonempty-value");
  const catalogPath = writeCatalog(dir, [{ providerId: "test-free", chatCompletionsUrl: "https://example.invalid/v1/chat/completions", apiKeyEnvVar: "TEST_MECH_KEY2", keyed: true, pricePerMillionTokensMicroUsd: { input: 0, output: 0 } }]);
  stubFetch(t, { model: "test-model", choices: [{ message: { content: "ok" } }] });
  await assert.rejects(
    runMechanicalInferenceCli(["--task-type", "boilerplate-transform", "--instructions", "Reformat as JSON.", "--input", "a: 1", "--catalog", catalogPath, "--turn", "turn-1"]),
    /--receipt-root/u,
  );
});
