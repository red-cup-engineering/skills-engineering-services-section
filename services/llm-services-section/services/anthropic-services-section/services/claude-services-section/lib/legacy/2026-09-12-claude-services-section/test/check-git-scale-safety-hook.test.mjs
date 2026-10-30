import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkGitScaleSafetyHook, findGitScaleSafetyViolation } from "../scripts/check-git-scale-safety-hook.mjs";

function transcriptOf(root, entries) {
  const filePath = join(root, "transcript.jsonl");
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join("\n"));
  return filePath;
}

test("throws when the hook event does not match what was projected", () => {
  assert.throws(() => checkGitScaleSafetyHook({ hook_event_name: "PostToolUse" }, "PreToolUse"), TypeError);
});

test("skips a tool call that is not Bash", () => {
  const result = checkGitScaleSafetyHook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} }, "PreToolUse");
  assert.equal(result.decision, "skip");
});

test("skips a Bash command with no git in it", () => {
  const result = checkGitScaleSafetyHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rg -n foo src/" } }, "PreToolUse");
  assert.equal(result.decision, "skip");
});

for (const command of ["git add -A", "git add .", "git add -u", "git add -f -A"]) {
  test(`denies wildcard staging: ${command}`, () => {
    const result = checkGitScaleSafetyHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }, "PreToolUse");
    assert.equal(result.decision, "deny");
    assert.match(result.reason, /stages everything/);
  });
}

for (const command of ["git commit -a -m x", "git commit -am x", "git commit --all -m x"]) {
  test(`denies wildcard commit: ${command}`, () => {
    const result = checkGitScaleSafetyHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }, "PreToolUse");
    assert.equal(result.decision, "deny");
    assert.match(result.reason, /commits everything/);
  });
}

test("does not confuse --amend with wildcard commit", () => {
  assert.equal(findGitScaleSafetyViolation("git commit --amend -m x"), null);
});

test("denies git grep", () => {
  const result = checkGitScaleSafetyHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git grep -n foo" } }, "PreToolUse");
  assert.equal(result.decision, "deny");
  assert.match(result.reason, /git grep/);
});

test("denies unscoped git log -p", () => {
  const result = checkGitScaleSafetyHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git log -p --all" } }, "PreToolUse");
  assert.equal(result.decision, "deny");
});

test("allows git log -p scoped to a path", () => {
  const result = checkGitScaleSafetyHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git log -p -- src/file.mjs" } }, "PreToolUse");
  assert.equal(result.decision, "skip");
});

test("denies git worktree add", () => {
  const result = checkGitScaleSafetyHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git worktree add ../wt -b x" } }, "PreToolUse");
  assert.equal(result.decision, "deny");
});

test("allows scoped git status and plain git log --oneline", () => {
  assert.equal(findGitScaleSafetyViolation("git status --short -- src"), null);
  assert.equal(findGitScaleSafetyViolation("git log --oneline -15"), null);
});

test("allows wildcard staging when the transcript carries the owner's explicit bulk-commit opt-in", () => {
  const root = mkdtempSync(join(tmpdir(), "git-scale-safety-hook-"));
  try {
    const transcriptPath = transcriptOf(root, [{ message: { role: "user", content: "do a bulk commit of everything, git add -A and commit it all" } }]);
    const result = checkGitScaleSafetyHook(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git add -A" }, transcript_path: transcriptPath },
      "PreToolUse",
    );
    assert.equal(result.decision, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("denies wildcard staging when the transcript has no opt-in", () => {
  const root = mkdtempSync(join(tmpdir(), "git-scale-safety-hook-"));
  try {
    const transcriptPath = transcriptOf(root, [{ message: { role: "user", content: "please fix the bug in file.mjs" } }]);
    const result = checkGitScaleSafetyHook(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git add -A" }, transcript_path: transcriptPath },
      "PreToolUse",
    );
    assert.equal(result.decision, "deny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
