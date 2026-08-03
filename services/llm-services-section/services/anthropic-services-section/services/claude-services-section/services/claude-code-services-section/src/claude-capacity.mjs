import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function runClaudeWithCapacity(executable, args, {
  lockPath = resolve(process.env.CLAUDE_CODE_CAPACITY_LOCK ?? join(ROOT, "data", "claude-code-request-slot.lock")),
  ...spawnOptions
} = {}) {
  mkdirSync(dirname(lockPath), { recursive: true });
  return spawnSync("flock", [
    "--exclusive", "--nonblock", "--no-fork",
    lockPath, executable, ...args,
  ], spawnOptions);
}
