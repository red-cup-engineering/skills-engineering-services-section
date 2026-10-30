import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectClaudeSessionActivity } from "../src/collect-claude-session-activity.mjs";

function fixture(rows) {
  const root = mkdtempSync(join(tmpdir(), "claude-session-activity-"));
  const path = join(root, "11111111-1111-4111-8111-111111111111.jsonl");
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  const mtime = new Date("2026-07-30T12:30:00.000Z");
  utimesSync(path, mtime, mtime);
  return root;
}

const WINDOW = { fromExclusive: "2026-07-30T12:00:00.000Z", toInclusive: "2026-07-30T13:00:00.000Z" };

test("counts turns, tool calls, and user messages inside the window, ignoring rows outside it", async () => {
  const secret = "DO-NOT-DISCLOSE-TRANSCRIPT-TEXT";
  const rows = [
    { type: "user", timestamp: "2026-07-30T11:59:59.000Z", message: { role: "user", content: secret } }, // before window
    { type: "user", timestamp: "2026-07-30T12:01:00.000Z", message: { role: "user", content: secret } },
    { type: "assistant", timestamp: "2026-07-30T12:02:00.000Z", message: { role: "assistant", model: "claude-sonnet-5", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: secret } }], stop_reason: "tool_use" } },
    { type: "user", timestamp: "2026-07-30T12:02:05.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false, content: secret }] } },
    { type: "assistant", timestamp: "2026-07-30T12:03:00.000Z", message: { role: "assistant", model: "claude-sonnet-5", content: [{ type: "text", text: secret }], stop_reason: "end_turn" } },
  ];
  const root = fixture(rows);
  const result = await collectClaudeSessionActivity({ window: WINDOW, sessionRoot: root });

  assert.equal(result.sessionsActive, 1);
  assert.equal(result.turnsCompleted, 1);
  assert.equal(result.toolInvocations, 1);
  assert.equal(result.patchInvocations, 0);
  assert.equal(result.webInvocations, 0);
  assert.equal(result.userMessages, 1);
  assert.equal(JSON.stringify(result).includes(secret), false, "transcript text must never appear in the result");
});

test("classifies patch tools (Edit/Write/NotebookEdit) and web tools (WebSearch/WebFetch)", async () => {
  const rows = [
    { type: "assistant", timestamp: "2026-07-30T12:02:00.000Z", message: { role: "assistant", model: "claude-sonnet-5", content: [{ type: "tool_use", id: "toolu_1", name: "Edit", input: {} }], stop_reason: "tool_use" } },
    { type: "assistant", timestamp: "2026-07-30T12:03:00.000Z", message: { role: "assistant", model: "claude-sonnet-5", content: [{ type: "tool_use", id: "toolu_2", name: "WebSearch", input: {} }], stop_reason: "tool_use" } },
  ];
  const root = fixture(rows);
  const result = await collectClaudeSessionActivity({ window: WINDOW, sessionRoot: root });

  assert.equal(result.toolInvocations, 2);
  assert.equal(result.patchInvocations, 1);
  assert.equal(result.webInvocations, 1);
});

test("a quiet interval reports all-zero counts rather than throwing", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-session-quiet-"));
  const result = await collectClaudeSessionActivity({ window: WINDOW, sessionRoot: root });

  assert.deepEqual(result, {
    window: WINDOW,
    sessionsActive: 0,
    turnsCompleted: 0,
    toolInvocations: 0,
    patchInvocations: 0,
    webInvocations: 0,
    userMessages: 0,
    malformedRows: 0,
  });
});

test("malformed JSON lines are excluded and counted rather than crashing the read", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-session-malformed-"));
  const path = join(root, "22222222-2222-4222-8222-222222222222.jsonl");
  const goodRow = { type: "user", timestamp: "2026-07-30T12:01:00.000Z", message: { role: "user", content: "hi" } };
  writeFileSync(path, `${JSON.stringify(goodRow)}\nnot json\n`, "utf8");
  const mtime = new Date("2026-07-30T12:30:00.000Z");
  utimesSync(path, mtime, mtime);

  const result = await collectClaudeSessionActivity({ window: WINDOW, sessionRoot: root });
  assert.equal(result.userMessages, 1);
  assert.equal(result.malformedRows, 1);
});

test("a missing session directory raises a clear error instead of silently reporting zero activity", async () => {
  await assert.rejects(
    collectClaudeSessionActivity({ window: WINDOW, sessionRoot: join(tmpdir(), "not-a-claude-session-dir") }),
    /Claude session directory not found/u,
  );
});

test("rejects a window that is not an increasing exact interval", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-session-badwindow-"));
  await assert.rejects(
    collectClaudeSessionActivity({ window: { fromExclusive: "2026-07-30T13:00:00.000Z", toInclusive: "2026-07-30T12:00:00.000Z" }, sessionRoot: root }),
    TypeError,
  );
});
