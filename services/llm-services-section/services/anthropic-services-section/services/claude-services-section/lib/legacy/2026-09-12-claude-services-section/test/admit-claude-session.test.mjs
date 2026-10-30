import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitClaudeSession, admitClaudeSessionOnStop, spawnDetachedAdmit } from "../scripts/admit-claude-session.mjs";

test("admitClaudeSessionOnStop refuses a non-Stop hook event", () => {
  assert.throws(() => admitClaudeSessionOnStop({ hook_event_name: "UserPromptSubmit", transcript_path: "/x.jsonl" }), /is not a Stop event/u);
});

test("admitClaudeSessionOnStop refuses a Stop event with no transcript_path", () => {
  assert.throws(() => admitClaudeSessionOnStop({ hook_event_name: "Stop" }), /names no transcript_path/u);
});

test("admitClaudeSessionOnStop spawns a detached process and returns immediately without calling metroplat itself", () => {
  const calls = [];
  const result = admitClaudeSessionOnStop(
    { hook_event_name: "Stop", session_id: "s", transcript_path: "/some/path/my-session.jsonl" },
    { spawnDetachedAdmitFn: (options) => calls.push(options) },
  );
  assert.deepEqual(result, { spawned: true, sessionId: "my-session" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].transcriptPath, "/some/path/my-session.jsonl");
  assert.equal(calls[0].sessionId, "my-session");
});

test("spawnDetachedAdmit invokes node on this file with --admit and the transcript/session args, detached and unreffed", () => {
  const calls = [];
  const spawnFn = (command, args, options) => {
    calls.push({ command, args, options });
    return { unref() { calls.at(-1).unrefCalled = true; } };
  };
  spawnDetachedAdmit({ transcriptPath: "/t.jsonl", sessionId: "sess-1", journalRoot: "/journal", spawnFn });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.command, process.execPath);
  assert.ok(call.args[0].endsWith("admit-claude-session.mjs"));
  assert.deepEqual(call.args.slice(1), ["--admit", "--transcript-path", "/t.jsonl", "--session-id", "sess-1", "--journal-root", "/journal"]);
  assert.equal(call.options.detached, true);
  assert.equal(call.options.stdio, "ignore");
  assert.equal(call.unrefCalled, true);
});

test("admitClaudeSession calls both metroplat verbs on the rail with exactly the fields their operations accept, and writes one receipt row naming both results", async () => {
  const journalRoot = mkdtempSync(join(tmpdir(), "admit-claude-session-journal-"));
  try {
    const seenCalls = [];
    const runVerb = async (verb, input) => {
      seenCalls.push({ verb, input });
      return verb === "claude-session-admit" ? { id: "urn:session-admission:1" } : { id: "urn:token-usage-admission:1" };
    };
    const result = await admitClaudeSession({ transcriptPath: "/x/session.jsonl", journalRoot, runVerb });

    assert.equal(seenCalls.length, 2);
    assert.equal(seenCalls[0].verb, "claude-session-admit");
    assert.deepEqual(seenCalls[0].input, { sessionId: "session" });
    assert.equal(seenCalls[1].verb, "agent-session-token-usage-admit");
    assert.deepEqual(seenCalls[1].input, { provider: "claude", sessionId: "session" });

    assert.deepEqual(result.sessionAdmission, { id: "urn:session-admission:1" });
    assert.deepEqual(result.tokenUsageAdmission, { id: "urn:token-usage-admission:1" });
    assert.equal(result.root, journalRoot);
    assert.ok(typeof result.id === "string" && result.id !== "");

    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "/");
    const logPath = join(journalRoot, "data/logs", day, "witness-journal-seavt.jsonl");
    const onDisk = readFileSync(logPath, "utf8");
    assert.match(onDisk, /urn:session-admission:1/);
    assert.match(onDisk, /urn:token-usage-admission:1/);
    assert.match(onDisk, /metroplat\.session-admit/);
  } finally {
    rmSync(journalRoot, { recursive: true, force: true });
  }
});

test("admitClaudeSession refuses a missing transcriptPath", async () => {
  await assert.rejects(() => admitClaudeSession({ runVerb: () => ({}) }), /names no transcriptPath/u);
});
