import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDiskIoCoordinationHook, releaseDiskIoCoordinationLock } from "../scripts/check-disk-io-coordination-hook.mjs";

// A dedicated test-only path, never the real `/tmp/bare-cedar-fog-disk-io-coordinator.lock`:
// this machine coordinates real concurrent npm installs across live sessions through that
// exact file, and clearing or overwriting it from a test run would corrupt that coordination
// for whoever else is mid-install right now.
const LOCK_PATH = join(tmpdir(), `check-disk-io-coordination-hook.test.${process.pid}.lock`);
const withLock = { lockPath: LOCK_PATH };

function clearLock() {
  if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
}

test.beforeEach(clearLock);
test.after(clearLock);

test("throws when the hook event does not match what was projected", () => {
  assert.throws(() => checkDiskIoCoordinationHook({ hook_event_name: "Stop" }, "PreToolUse", withLock), /does not match projected event/u);
});

test("skips a tool call that is not Bash", () => {
  const result = checkDiskIoCoordinationHook({ hook_event_name: "PreToolUse", tool_name: "Write" }, "PreToolUse", withLock);
  assert.equal(result.decision, "skip");
});

test("skips a Bash command with no npm install-family invocation", () => {
  const result = checkDiskIoCoordinationHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm run test" } }, "PreToolUse", withLock);
  assert.equal(result.decision, "skip");
});

test("does not treat a commit message that merely mentions 'npm install' as a heavy command", () => {
  // Regression: the prior whole-string regex matched this literal command text and denied a
  // `commit-git-paths` invocation that runs no npm at all, because its own --message argument
  // was prose about *not* running a raw npm install.
  const command = 'node commit-git-paths.mjs --message "forced with a raw npm install against a 2014-package workspace"';
  const result = checkDiskIoCoordinationHook({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "s1", tool_input: { command } }, "PreToolUse", withLock);
  assert.equal(result.decision, "skip");
  assert.equal(existsSync(LOCK_PATH), false);
});

test("allows and locks a real npm install with no prior lock", () => {
  const result = checkDiskIoCoordinationHook({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "s1", tool_input: { command: "npm install --no-audit --no-fund" } }, "PreToolUse", withLock);
  assert.equal(result.decision, "allow");
  assert.equal(existsSync(LOCK_PATH), true);
});

test("recognizes every heavy npm subcommand", () => {
  for (const subcommand of ["npm i", "npm install", "npm ci", "npm update", "npm up", "npm upgrade"]) {
    clearLock();
    const result = checkDiskIoCoordinationHook({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "s1", tool_input: { command: subcommand } }, "PreToolUse", withLock);
    assert.equal(result.decision, "allow", subcommand);
  }
});

test("denies a second session's install while the first session's lock is fresh", () => {
  writeFileSync(LOCK_PATH, JSON.stringify({ sessionId: "s1", command: "npm install", startedAt: new Date().toISOString() }));
  const result = checkDiskIoCoordinationHook({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "s2", tool_input: { command: "npm install" } }, "PreToolUse", withLock);
  assert.equal(result.decision, "deny");
  assert.match(result.reason, /another session \(s1\)/u);
});

test("allows the same session to re-run its own locked install", () => {
  writeFileSync(LOCK_PATH, JSON.stringify({ sessionId: "s1", command: "npm install", startedAt: new Date().toISOString() }));
  const result = checkDiskIoCoordinationHook({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "s1", tool_input: { command: "npm install" } }, "PreToolUse", withLock);
  assert.equal(result.decision, "allow");
});

test("treats a lock older than twenty minutes as abandoned", () => {
  const startedAt = new Date(Date.now() - 21 * 60 * 1000).toISOString();
  writeFileSync(LOCK_PATH, JSON.stringify({ sessionId: "s1", command: "npm install", startedAt }));
  const result = checkDiskIoCoordinationHook({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "s2", tool_input: { command: "npm install" } }, "PreToolUse", withLock);
  assert.equal(result.decision, "allow");
});

test("releaseDiskIoCoordinationLock removes only the releasing session's own lock", () => {
  writeFileSync(LOCK_PATH, JSON.stringify({ sessionId: "s1", command: "npm install", startedAt: new Date().toISOString() }));
  const foreign = releaseDiskIoCoordinationLock({ hook_event_name: "PostToolUse", tool_name: "Bash", session_id: "s2", tool_input: { command: "npm install" } }, "PostToolUse", withLock);
  assert.equal(foreign.released, false);
  assert.equal(existsSync(LOCK_PATH), true);
  const owner = releaseDiskIoCoordinationLock({ hook_event_name: "PostToolUse", tool_name: "Bash", session_id: "s1", tool_input: { command: "npm install" } }, "PostToolUse", withLock);
  assert.equal(owner.released, true);
  assert.equal(existsSync(LOCK_PATH), false);
});

test("releaseDiskIoCoordinationLock is a no-op for a non-heavy command", () => {
  const result = releaseDiskIoCoordinationLock({ hook_event_name: "PostToolUse", tool_name: "Bash", session_id: "s1", tool_input: { command: "echo hi" } }, "PostToolUse", withLock);
  assert.deepEqual(result, { decision: "allow", released: false });
});
