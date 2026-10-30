import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkSubstrateImportHook } from "../scripts/check-substrate-import-hook.mjs";

function writeInput({ filePath, content }) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  };
}

test("throws when the hook event does not match what was projected", () => {
  assert.throws(() => checkSubstrateImportHook({ hook_event_name: "PostToolUse" }, "PreToolUse"), TypeError);
});

test("skips a tool call that is not a checked Write/Edit", () => {
  const result = checkSubstrateImportHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} }, "PreToolUse");
  assert.equal(result.decision, "skip");
});

test("skips a Write to a file outside the checked extensions", () => {
  const result = checkSubstrateImportHook(writeInput({ filePath: "/tmp/notes.md", content: "hello" }), "PreToolUse");
  assert.equal(result.decision, "skip");
});

test("allows a Write with no house-owned substrate imports", () => {
  const result = checkSubstrateImportHook(writeInput({ filePath: "/tmp/clean.mjs", content: "export const value = 1;\n" }), "PreToolUse");
  assert.equal(result.decision, "allow");
});

test("denies a Write that hand-imports a house-owned Node built-in", () => {
  const result = checkSubstrateImportHook(writeInput({ filePath: "/tmp/hand.mjs", content: "import { readFileSync } from \"node:fs\";\n" }), "PreToolUse");
  assert.equal(result.decision, "deny");
  assert.match(result.reason, /node:fs/);
});

test("allows an Edit that does not introduce a new hand-import already present on disk", () => {
  const root = mkdtempSync(join(tmpdir(), "substrate-import-hook-"));
  const filePath = join(root, "existing.mjs");
  writeFileSync(filePath, "import { readFileSync } from \"node:fs\";\nexport function noop() {}\n");
  try {
    const input = {
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: filePath, old_string: "export function noop() {}\n", new_string: "export function noop2() {}\n" },
    };
    const result = checkSubstrateImportHook(input, "PreToolUse");
    assert.equal(result.decision, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("denies an Edit that introduces a new hand-import not already present on disk", () => {
  const root = mkdtempSync(join(tmpdir(), "substrate-import-hook-"));
  const filePath = join(root, "existing.mjs");
  writeFileSync(filePath, "export function noop() {}\n");
  try {
    const input = {
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: {
        file_path: filePath,
        old_string: "export function noop() {}\n",
        new_string: "import { readFileSync } from \"node:fs\";\nexport function noop() {}\n",
      },
    };
    const result = checkSubstrateImportHook(input, "PreToolUse");
    assert.equal(result.decision, "deny");
    assert.match(result.reason, /node:fs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
