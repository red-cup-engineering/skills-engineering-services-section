import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runClaudeWithCapacity } from "../src/claude-capacity.mjs";

function wait(milliseconds) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); }

test("the live Claude process owns the kernel slot and death releases it", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-kernel-slot-"));
  const lock = join(root, "slot.lock"), marker = join(root, "owner-entered");
  const holder = spawn("flock", ["--exclusive", "--no-fork", lock, process.execPath, "-e", `require(\"node:fs\").writeFileSync(${JSON.stringify(marker)}, \"entered\\n\"); setTimeout(() => {}, 60000);`], { detached: true, stdio: "ignore" });
  try {
    const deadline = Date.now() + 5_000;
    while (!existsSync(marker) && Date.now() < deadline) wait(25);
    assert.equal(existsSync(marker), true, "the first process must own the kernel lock");
    const refused = runClaudeWithCapacity(process.execPath, ["-e", "process.exit(0)"], { lockPath: lock, encoding: "utf8" });
    assert.notEqual(refused.status, 0);
    process.kill(-holder.pid, "SIGKILL");
    await once(holder, "exit");
    const accepted = runClaudeWithCapacity(process.execPath, ["-e", "process.exit(0)"], { lockPath: lock, encoding: "utf8" });
    assert.equal(accepted.status, 0, accepted.stderr || accepted.error?.message);
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) process.kill(-holder.pid, "SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});
