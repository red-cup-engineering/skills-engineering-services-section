import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runWithCapacityAdmission } from "../src/execute-rmn-inference.mjs";

function wait(milliseconds) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); }

test("the kernel Groq request slot refuses a second owner and releases on owner death", async () => {
  const root = mkdtempSync(join(tmpdir(), "groq-kernel-slot-"));
  const lock = join(root, "slot.lock"), marker = join(root, "owner-entered");
  const holder = spawn("flock", ["--exclusive", "--no-fork", lock, process.execPath, "-e", `require(\"node:fs\").writeFileSync(${JSON.stringify(marker)}, \"entered\\n\"); setTimeout(() => {}, 60000);`], { detached: true, stdio: "ignore" });
  try {
    const deadline = Date.now() + 5_000;
    while (!existsSync(marker) && Date.now() < deadline) wait(25);
    assert.equal(existsSync(marker), true, "the first process must own the kernel lock");
    const refused = runWithCapacityAdmission(process.execPath, ["-e", "process.exit(0)"], { lockPath: lock, admissionTimeoutMs: 0, encoding: "utf8", timeout: 2_000 });
    assert.notEqual(refused.status, 0);
    process.kill(-holder.pid, "SIGKILL");
    await once(holder, "exit");
    const accepted = runWithCapacityAdmission(process.execPath, ["-e", "process.exit(0)"], { lockPath: lock, admissionTimeoutMs: 1_000, encoding: "utf8", timeout: 3_000 });
    assert.equal(accepted.status, 0, accepted.stderr || accepted.error?.message);
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) process.kill(-holder.pid, "SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});
