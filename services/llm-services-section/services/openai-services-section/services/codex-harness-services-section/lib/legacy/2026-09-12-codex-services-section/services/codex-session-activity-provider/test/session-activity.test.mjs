import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { summarizeSessionActivity } from "../src/session-activity.mjs";

function fixture(rows) {
  const root = mkdtempSync(join(tmpdir(), "codex-session-activity-"));
  const directory = join(root, "2026", "07", "19");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "rollout-test.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return root;
}

test("counts activity inside the exact (fromExclusive, toInclusive] window and never leaks message text", async () => {
  const secret = "DO-NOT-DISCLOSE-TRANSCRIPT-TEXT";
  const root = fixture([
    { timestamp: "2026-07-20T01:59:59.000Z", type: "event_msg", payload: { type: "user_message", message: secret } }, // before window: excluded
    { timestamp: "2026-07-20T02:01:00.000Z", type: "event_msg", payload: { type: "user_message", message: secret } },
    { timestamp: "2026-07-20T02:02:00.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: secret } },
    { timestamp: "2026-07-20T02:03:00.000Z", type: "event_msg", payload: { type: "patch_apply_end", output: secret } },
    { timestamp: "2026-07-20T02:04:00.000Z", type: "event_msg", payload: { type: "task_complete" } },
  ]);
  const window = { fromExclusive: "2026-07-20T02:00:00.000Z", toInclusive: "2026-07-20T03:00:00.000Z" };
  const summary = await summarizeSessionActivity({ window, sessionRoot: root });

  assert.equal(summary.sessionsActive, 1);
  assert.equal(summary.userMessages, 1);
  assert.equal(summary.toolInvocations, 1);
  assert.equal(summary.patchCompletions, 1);
  assert.equal(summary.completedTurns, 1);
  assert.equal(summary.webSearches, 0);
  assert.equal(summary.contextCompactions, 0);
  assert.equal(JSON.stringify(summary).includes(secret), false);
});

test("malformed transcript rows are counted, not guessed at", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-malformed-"));
  const directory = join(root, "2026", "07", "19");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "rollout-test.jsonl"), "not json\n{\"timestamp\":\"2026-07-20T02:05:00.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\"}}\n", "utf8");
  const window = { fromExclusive: "2026-07-20T02:00:00.000Z", toInclusive: "2026-07-20T03:00:00.000Z" };
  const summary = await summarizeSessionActivity({ window, sessionRoot: root });
  assert.equal(summary.malformedRows, 1);
  assert.equal(summary.completedTurns, 1);
});

test("a quiet interval reports all-zero counts", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-quiet-"));
  const window = { fromExclusive: "2026-07-20T02:00:00.000Z", toInclusive: "2026-07-20T03:00:00.000Z" };
  const summary = await summarizeSessionActivity({ window, sessionRoot: root });
  assert.deepEqual(summary, {
    sessionsActive: 0,
    userMessages: 0,
    completedTurns: 0,
    toolInvocations: 0,
    patchCompletions: 0,
    webSearches: 0,
    contextCompactions: 0,
    malformedRows: 0,
  });
});

test("rejects a non-increasing window", async () => {
  await assert.rejects(
    summarizeSessionActivity({ window: { fromExclusive: "2026-07-20T03:00:00.000Z", toInclusive: "2026-07-20T02:00:00.000Z" }, sessionRoot: mkdtempSync(join(tmpdir(), "codex-session-bad-window-")) }),
    /increasing exact interval/u,
  );
});

test("a missing session directory is an explicit failure, not a silent empty result", async () => {
  await assert.rejects(
    summarizeSessionActivity({ window: { fromExclusive: "2026-07-20T02:00:00.000Z", toInclusive: "2026-07-20T03:00:00.000Z" }, sessionRoot: join(tmpdir(), "not-a-codex-session-directory") }),
    /Codex session directory not found/u,
  );
});
