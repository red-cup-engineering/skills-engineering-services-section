import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
function wait(milliseconds) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); }

test("the kernel NVIDIA request slot waits for pressure to release capacity and releases on owner death", async () => {
  const root = mkdtempSync(join(tmpdir(), "nvidia-kernel-slot-"));
  const lock = join(root, "slot.lock"), marker = join(root, "owner-entered");
  const holder = spawn("flock", ["--exclusive", "--no-fork", lock, process.execPath, "-e", `require(\"node:fs\").writeFileSync(${JSON.stringify(marker)}, \"entered\\n\"); setTimeout(() => {}, 60000);`], { detached: true, stdio: "ignore" });
  let contender;
  try {
    const deadline = Date.now() + 5_000;
    while (!existsSync(marker) && Date.now() < deadline) wait(25);
    assert.equal(existsSync(marker), true, "the first process must own the kernel lock");
    const executorUrl = new URL("../src/execute-rmn-inference.mjs", import.meta.url).href;
    contender = spawn(process.execPath, ["--input-type=module", "-e", `import { runWithCapacityAdmission } from ${JSON.stringify(executorUrl)}; const result = runWithCapacityAdmission(process.execPath, ["-e", "process.exit(0)"], { lockPath: ${JSON.stringify(lock)}, encoding: "utf8" }); process.exit(result.status ?? 1);`], { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(contender.exitCode, null, "the second owner must remain queued while capacity is occupied");
    process.kill(-holder.pid, "SIGKILL");
    await once(holder, "exit");
    const [code] = await once(contender, "exit");
    assert.equal(code, 0);
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) process.kill(-holder.pid, "SIGKILL");
    if (contender && contender.exitCode === null && contender.signalCode === null) contender.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});
