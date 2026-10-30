import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { claimDelivery, evaluateToolUse, handle } from "../src/hooks.mjs";

const root = () => mkdtempSync(join(tmpdir(), "codex-hooks-"));

test("evaluateToolUse allows apply_patch that stays inside the workspace", () => {
  const patch = "*** Update File: src/index.mjs\n--- a/src/index.mjs\n+++ b/src/index.mjs\n";
  const disposition = evaluateToolUse({ tool_name: "apply_patch", tool_input: { patch } });
  assert.equal(disposition.allowed, true);
});

test("evaluateToolUse refuses apply_patch with an absolute path", () => {
  const patch = "*** Update File: /etc/passwd\n";
  const disposition = evaluateToolUse({ tool_name: "apply_patch", tool_input: { patch } });
  assert.equal(disposition.allowed, false);
});

test("evaluateToolUse refuses apply_patch that escapes with ..", () => {
  const patch = "*** Update File: ../outside/file.mjs\n";
  const disposition = evaluateToolUse({ tool_name: "apply_patch", tool_input: { patch } });
  assert.equal(disposition.allowed, false);
});

test("evaluateToolUse allows every other tool", () => {
  assert.equal(evaluateToolUse({ tool_name: "Read", tool_input: {} }).allowed, true);
});

test("claimDelivery claims a delivery exactly once", () => {
  const stateRoot = root();
  const input = { hook_event_name: "PreToolUse", session_id: "s1", turn_id: "t1", tool_use_id: "u1" };
  assert.equal(claimDelivery(input, { stateRoot }), true);
  assert.equal(claimDelivery(input, { stateRoot }), false);
});

test("handle denies PreToolUse for an out-of-workspace apply_patch", () => {
  const stateRoot = root();
  const input = { hook_event_name: "PreToolUse", session_id: "s1", turn_id: "t1", tool_use_id: "u1", tool_name: "apply_patch", tool_input: { patch: "*** Update File: /etc/passwd\n" } };
  const output = handle(input, { stateRoot });
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
});

test("handle returns an empty response on a repeated delivery", () => {
  const stateRoot = root();
  const input = { hook_event_name: "PreToolUse", session_id: "s1", turn_id: "t1", tool_use_id: "u1", tool_name: "Read", tool_input: {} };
  handle(input, { stateRoot });
  assert.deepEqual(handle(input, { stateRoot }), {});
});

test("handle caches PostToolUse output without erroring", () => {
  const stateRoot = root();
  const input = { hook_event_name: "PostToolUse", session_id: "s1", turn_id: "t1", tool_use_id: "u1", tool_name: "Bash", tool_response: "line one\nline two\n" };
  assert.deepEqual(handle(input, { stateRoot }), {});
});

test("handle reports usage on Stop when a turn was observed", () => {
  const stateRoot = root();
  const input = { hook_event_name: "Stop", session_id: "s1", turn_id: "t1" };
  const output = handle(input, { stateRoot, observeUsage: () => ({ latestTurn: { usage: { total_tokens: 42 } } }) });
  assert.match(output.systemMessage, /42/u);
});
