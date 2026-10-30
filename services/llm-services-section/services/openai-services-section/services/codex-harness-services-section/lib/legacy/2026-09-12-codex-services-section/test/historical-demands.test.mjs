import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { admitNextHistoricalDemand, observeHistoricalDemands } from "../src/historical-demands.mjs";
import { readTrajectory } from "../src/enterprise.mjs";
import { admitPrompt } from "../src/prompt-cycle.mjs";
const root = () => mkdtempSync(join(tmpdir(), "codex-historical-demands-"));

function row(timestamp, type, payload) { return JSON.stringify({ timestamp, type, payload }); }

test("historical Leader demands are deduplicated, source-bound, and ordered backward", () => {
  const sessionsRoot = root();
  const stateRoot = root();
  const directory = join(sessionsRoot, "2026", "07", "27");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "one.jsonl"), [
    row("2026-07-27T10:00:00.000Z", "session_meta", { id: "session-one" }),
    row("2026-07-27T10:01:00.000Z", "event_msg", { type: "user_message", client_id: "client-one", message: "older demand" }),
    row("2026-07-27T10:02:00.000Z", "event_msg", { type: "user_message", client_id: "client-one", message: "shared demand" }),
  ].join("\n"));
  writeFileSync(join(directory, "two.jsonl"), [
    row("2026-07-27T11:00:00.000Z", "session_meta", { id: "session-two" }),
    row("2026-07-27T11:01:00.000Z", "event_msg", { type: "user_message", client_id: "client-two", message: "newest demand" }),
    row("2026-07-27T11:02:00.000Z", "event_msg", { type: "user_message", client_id: "client-two", message: "shared demand" }),
  ].join("\n"));
  admitPrompt({ session_id: "live", turn_id: "turn", prompt: "newest demand" }, { stateRoot, enqueue: () => null });
  const ledger = observeHistoricalDemands({ sessionsRoot, stateRoot });
  assert.equal(ledger.sessionFileCount, 2);
  assert.equal(ledger.transcriptRowCount, 6);
  assert.equal(ledger.distinctDemandCount, 3);
  assert.equal(ledger.pendingDemandCount, 2);
  assert.deepEqual(ledger.demands.map(({ prompt }) => prompt), ["shared demand", "newest demand", "older demand"]);
  assert.equal(ledger.demands.find(({ prompt }) => prompt === "shared demand").sources.length, 2);
  assert.equal(ledger.demands.find(({ prompt }) => prompt === "newest demand").status, "admitted-to-prompt-cycle");
  assert.match(ledger.demands[0].sources[0].digest, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
});

test("malformed transcript rows remain explicit ledger problems", () => {
  const sessionsRoot = root();
  const directory = join(sessionsRoot, "2026");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "broken.jsonl"), "{not json}\n");
  const ledger = observeHistoricalDemands({ sessionsRoot, stateRoot: root() });
  assert.equal(ledger.problems.length, 1);
  assert.equal(ledger.problems[0].line, 1);
});

test("the backward cursor admits one exact sourced demand into the prompt pipeline", () => {
  const sessionsRoot = root();
  const stateRoot = root();
  const directory = join(sessionsRoot, "2026");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "one.jsonl"), [
    row("2026-07-27T12:00:00.000Z", "session_meta", { id: "session-one" }),
    row("2026-07-27T12:01:00.000Z", "event_msg", { type: "user_message", client_id: "client", message: "first historical demand" }),
    row("2026-07-27T12:02:00.000Z", "event_msg", { type: "user_message", client_id: "client", message: "next historical demand" }),
  ].join("\n"));
  const result = admitNextHistoricalDemand({ sessionsRoot, stateRoot, enqueue: () => null, now: () => "2026-07-27T13:00:00.000Z" });
  assert.equal(result.disposition, "historical-demand-admitted");
  assert.equal(result.demand.prompt, "next historical demand");
  assert.match(result.record.sourceReceipt, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.equal(readTrajectory({ stateRoot }).some((event) => event.type === "PromptResourcePlacementIntentOpened" && event.cycle === result.admitted.cycle.id), true);
  assert.equal(observeHistoricalDemands({ sessionsRoot, stateRoot }).pendingDemandCount, 1);
});
