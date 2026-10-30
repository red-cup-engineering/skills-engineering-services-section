import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkWorkflowOptInHook } from "../scripts/check-workflow-opt-in-hook.mjs";

function transcriptOf(root, entries) {
  const filePath = join(root, "transcript.jsonl");
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join("\n"));
  return filePath;
}

test("throws when the hook event does not match what was projected", () => {
  assert.throws(() => checkWorkflowOptInHook({ hook_event_name: "PostToolUse" }, "PreToolUse"), TypeError);
});

test("skips a tool call that is not Workflow", () => {
  const result = checkWorkflowOptInHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }, "PreToolUse");
  assert.equal(result.decision, "skip");
});

test("denies a Workflow call with no transcript_path", () => {
  const result = checkWorkflowOptInHook({ hook_event_name: "PreToolUse", tool_name: "Workflow", tool_input: {} }, "PreToolUse");
  assert.equal(result.decision, "deny");
});

test("denies a Workflow call whose transcript carries no opt-in", () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-opt-in-hook-"));
  try {
    const transcriptPath = transcriptOf(root, [
      { message: { role: "user", content: "please read this file and summarize it" } },
      { message: { role: "assistant", content: "sure" } },
    ]);
    const result = checkWorkflowOptInHook({ hook_event_name: "PreToolUse", tool_name: "Workflow", tool_input: {}, transcript_path: transcriptPath }, "PreToolUse");
    assert.equal(result.decision, "deny");
    assert.match(result.reason, /no user opt-in/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows a Workflow call when a user message contains the ultracode keyword", () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-opt-in-hook-"));
  try {
    const transcriptPath = transcriptOf(root, [{ message: { role: "user", content: "run this with ultracode" } }]);
    const result = checkWorkflowOptInHook({ hook_event_name: "PreToolUse", tool_name: "Workflow", tool_input: {}, transcript_path: transcriptPath }, "PreToolUse");
    assert.equal(result.decision, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows a Workflow call when a user message explicitly asks for a workflow, across content blocks", () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-opt-in-hook-"));
  try {
    const transcriptPath = transcriptOf(root, [
      { message: { role: "user", content: [{ type: "text", text: "can you use a workflow for this" }] } },
    ]);
    const result = checkWorkflowOptInHook({ hook_event_name: "PreToolUse", tool_name: "Workflow", tool_input: {}, transcript_path: transcriptPath }, "PreToolUse");
    assert.equal(result.decision, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("denies when the transcript file cannot be read", () => {
  const result = checkWorkflowOptInHook({ hook_event_name: "PreToolUse", tool_name: "Workflow", tool_input: {}, transcript_path: "/nonexistent/transcript.jsonl" }, "PreToolUse");
  assert.equal(result.decision, "deny");
});
