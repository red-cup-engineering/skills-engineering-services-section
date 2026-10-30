import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendObservation, readTrajectory } from "../src/enterprise.mjs";
import { admitPrompt, setPromptWorkState } from "../src/prompt-cycle.mjs";
import { observeRelevantPriorSessionEvidence } from "../src/relevant-history.mjs";

const root = () => mkdtempSync(join(tmpdir(), "codex-relevant-history-"));
const row = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });

function sessionFile(sessionsRoot, name, sessionId, messages, malformed = false) {
  const directory = join(sessionsRoot, "2026", "07", "27");
  mkdirSync(directory, { recursive: true });
  const lines = [row("2026-07-27T10:00:00.000Z", "session_meta", { id: sessionId })];
  for (const [index, message] of messages.entries()) lines.push(row(`2026-07-27T10:0${index + 1}:00.000Z`, "event_msg", { type: "user_message", message }));
  if (malformed) lines.push("{not-json");
  writeFileSync(join(directory, `${name}.jsonl`), `${lines.join("\n")}\n`);
}

function query(desiredOutcome, session = "session-current") {
  return { leaderMove: { desiredOutcome, source: "codex-session:current:turn:1" }, session };
}

test("exact prior-session selection emits source-bound evidence and active work without raw prompt replay", () => {
  const sessionsRoot = root();
  const stateRoot = root();
  const secret = "repair the zero distance gap exactly";
  const unrelated = "newer but irrelevant demand";
  sessionFile(sessionsRoot, "a", "session-prior", [secret, unrelated]);
  sessionFile(sessionsRoot, "b", "session-current", [secret]);
  const admitted = admitPrompt({ session_id: "session-prior", turn_id: "turn-prior", prompt: secret }, { stateRoot, now: () => "2026-07-27T11:00:00.000Z" });
  setPromptWorkState({ cycle: admitted.cycle.id, state: "in-progress", issuer: "urn:ame:bare-cedar-fog-codex", evidence: "urn:evidence:still-open", observedAt: "2026-07-27T11:01:00.000Z" }, { stateRoot });
  appendObservation({ type: "PromptWorkItemsCompiled", cycle: admitted.cycle.id, provider: "urn:ame:supplier", providerReceipt: "urn:receipt:supplier", workItems: [{ id: "urn:work:item", type: "PromptWorkItem", objective: "continue repair" }], observedAt: "2026-07-27T11:02:00.000Z" }, { stateRoot });
  const before = readTrajectory({ stateRoot }).length;
  const selected = observeRelevantPriorSessionEvidence(query(secret), { sessionsRoot, stateRoot });
  assert.equal(readTrajectory({ stateRoot }).length, before);
  assert.equal(selected.provider, "urn:ame:codex-relevant-history-selection-actuator");
  assert.equal(selected.evidence.length, 1);
  assert.equal(selected.evidence[0].sessionId, "session-prior");
  assert.equal(selected.evidence[0].rank, 3);
  assert.equal(selected.activeWork.length, 1);
  assert.equal(selected.activeWork[0].state, "in-progress");
  assert.equal(selected.activeWork[0].providerReceipt, "urn:receipt:supplier");
  assert.deepEqual(selected.conveys, []);
  const encoded = JSON.stringify(selected);
  assert.equal(encoded.includes(secret), false);
  assert.equal(encoded.includes(unrelated), false);
});

test("paraphrase and current-session-only evidence produce explicit body-free absence", () => {
  const sessionsRoot = root();
  sessionFile(sessionsRoot, "one", "session-current", ["an exact demand"]);
  const paraphrase = observeRelevantPriorSessionEvidence(query("a paraphrased demand"), { sessionsRoot, stateRoot: root() });
  assert.equal(paraphrase.absence, "no-exact-prior-session-evidence");
  assert.deepEqual(paraphrase.evidence, []);
  const current = observeRelevantPriorSessionEvidence(query("an exact demand"), { sessionsRoot, stateRoot: root() });
  assert.equal(current.absence, "no-exact-prior-session-evidence");
});

test("malformed transcript rows are scoped problems with no row content", () => {
  const sessionsRoot = root();
  sessionFile(sessionsRoot, "broken", "session-prior", ["target"], true);
  const selected = observeRelevantPriorSessionEvidence(query("target"), { sessionsRoot, stateRoot: root() });
  assert.equal(selected.problems.length, 1);
  assert.equal(selected.problems[0].error, "malformed-json-row");
  assert.equal(JSON.stringify(selected).includes("not-json"), false);
});

test("a fresh enterprise MCP process advertises and executes relevance-filtered continuity", () => {
  const sessionsRoot = root();
  const stateRoot = root();
  const secret = "fresh process continuity target";
  sessionFile(sessionsRoot, "prior", "session-prior", [secret]);
  const server = new URL("../src/mcp-server.mjs", import.meta.url);
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "observe_relevant_prior_session_evidence", arguments: query(secret) } },
  ];
  const run = spawnSync(process.execPath, [server.pathname], {
    input: `${requests.map(JSON.stringify).join("\n")}\n`, encoding: "utf8",
    env: { ...process.env, CODEX_SESSIONS_ROOT: sessionsRoot, CODEX_ENTERPRISE_STATE_ROOT: stateRoot },
  });
  assert.equal(run.status, 0, run.stderr);
  const replies = run.stdout.trim().split("\n").map(JSON.parse);
  assert.ok(replies[0].result.tools.some(({ name }) => name === "observe_relevant_prior_session_evidence"));
  assert.equal(replies[1].result.structuredContent.evidence.length, 1);
  assert.equal(JSON.stringify(replies[1].result).includes(secret), false);
});
