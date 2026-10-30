import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkJsnodeDiscoveryHook } from "../scripts/check-jsnode-discovery-hook.mjs";

function transcriptOf(root, entries) {
  const filePath = join(root, "transcript.jsonl");
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join("\n"));
  return filePath;
}

function assistantToolUse(name, input = {}) {
  return { message: { role: "assistant", content: [{ type: "tool_use", name, input }] } };
}

test("throws when the hook event does not match what was projected", () => {
  assert.throws(() => checkJsnodeDiscoveryHook({ hook_event_name: "PostToolUse" }, "PreToolUse"), TypeError);
});

test("skips a tool call that is not Write", () => {
  const result = checkJsnodeDiscoveryHook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: {} }, "PreToolUse");
  assert.equal(result.decision, "skip");
});

test("skips a Write of a non-code file", () => {
  const result = checkJsnodeDiscoveryHook(
    { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/repo/notes.md" } },
    "PreToolUse",
  );
  assert.equal(result.decision, "skip");
});

test("skips a Write under a test directory", () => {
  const result = checkJsnodeDiscoveryHook(
    { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/repo/test/new-thing.test.mjs" } },
    "PreToolUse",
  );
  assert.equal(result.decision, "skip");
});

test("skips a Write to a file that already exists (not a new implementation)", () => {
  const root = mkdtempSync(join(tmpdir(), "jsnode-discovery-hook-"));
  try {
    const filePath = join(root, "existing.mjs");
    writeFileSync(filePath, "export const x = 1;\n");
    const result = checkJsnodeDiscoveryHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: filePath } }, "PreToolUse");
    assert.equal(result.decision, "skip");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("denies a new source file with no transcript_path", () => {
  const result = checkJsnodeDiscoveryHook(
    { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/repo/scripts/new-thing.mjs" } },
    "PreToolUse",
  );
  assert.equal(result.decision, "deny");
});

test("denies a new source file whose transcript shows no jsnode-server discovery call", () => {
  const root = mkdtempSync(join(tmpdir(), "jsnode-discovery-hook-"));
  try {
    const transcriptPath = transcriptOf(root, [assistantToolUse("Bash", { command: "grep -r foo ." }), assistantToolUse("Read", { file_path: "/repo/x.mjs" })]);
    const result = checkJsnodeDiscoveryHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: join(root, "scripts/new-thing.mjs") },
        transcript_path: transcriptPath,
      },
      "PreToolUse",
    );
    assert.equal(result.decision, "deny");
    assert.match(result.reason, /no jsnode-server discovery call/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows a new source file once the transcript shows a jsnode_search call", () => {
  const root = mkdtempSync(join(tmpdir(), "jsnode-discovery-hook-"));
  try {
    const transcriptPath = transcriptOf(root, [assistantToolUse("mcp__jsnode-server__jsnode_search", { term: "foo" })]);
    const result = checkJsnodeDiscoveryHook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: join(root, "scripts/new-thing.mjs") },
        transcript_path: transcriptPath,
      },
      "PreToolUse",
    );
    assert.equal(result.decision, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("denies when the transcript file cannot be read", () => {
  const result = checkJsnodeDiscoveryHook(
    { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/repo/scripts/new-thing.mjs" }, transcript_path: "/nonexistent/transcript.jsonl" },
    "PreToolUse",
  );
  assert.equal(result.decision, "deny");
});
