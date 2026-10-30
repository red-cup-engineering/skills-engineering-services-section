#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { cliArgument, commandInvocations, commandText, readBoundedHookInput } from "./lib/claude-hook-input.mjs";

const BYPASS_ENV_VAR = "DISK_IO_COORDINATOR_HOOK_BYPASS";
const DEFAULT_LOCK_PATH = "/tmp/bare-cedar-fog-disk-io-coordinator.lock";
const STALE_MS = 20 * 60 * 1000;
const HEAVY_NPM_SUBCOMMANDS = new Set(["i", "install", "ci", "update", "up", "upgrade"]);

/**
 * Whether a Bash command actually invokes a disk-heavy `npm install`-family subcommand, as opposed
 * to merely mentioning one in prose — e.g. a commit message arguing against running one. A whole-
 * string regex over the raw command text (this function's prior form) could not tell the two apart:
 * `commit-git-paths ... --message "...forced with a raw npm install..."` matched and was denied for
 * a command that runs no npm at all. Tokenizing quote-aware and requiring the subcommand to appear
 * as `npm`'s own next argument fixes that without losing the real hazard this hook exists to catch.
 */
function isHeavyCommand(command) {
  return commandInvocations(command, "npm").some(([subcommand]) => HEAVY_NPM_SUBCOMMANDS.has(subcommand));
}

function readLock(lockPath) {
  if (!existsSync(lockPath)) return null;
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function isStale(lock) {
  const startedAt = Date.parse(lock?.startedAt);
  return !Number.isFinite(startedAt) || Date.now() - startedAt > STALE_MS;
}

/**
 * Serializes disk-heavy `npm install`-family commands across every concurrent Claude Code session on this
 * machine: this 270k-file, many-package repository has no shared root install, so the actual hazard is not
 * any one install but several sessions extracting node_modules onto the same disk at once (the documented
 * mechanism behind repeated WSL crashes and forced restarts). A machine-wide lock file at a fixed path
 * outside the repo (so it is visible to every session's checkout) is the coordinating point; a stale lock
 * (older than twenty minutes, or one no session ever releases) is treated as abandoned rather than
 * deadlocking every future install.
 *
 * @param {object} input A Claude Code PreToolUse hook stdin payload.
 * @param {string} expectedEvent The lifecycle event this invocation was projected for.
 * @param {{lockPath?: string}} [options] Overrides the machine-wide lock path (tests only; production uses the fixed default).
 * @returns {object} A record naming the decision: allow, skip (not Bash, or no heavy command), or deny with a reason.
 * @throws {TypeError} When the input is not an object or names a different hook event.
 */
export function checkDiskIoCoordinationHook(input, expectedEvent, { lockPath = DEFAULT_LOCK_PATH } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("hook input must be a JSON object");
  if (input.hook_event_name !== expectedEvent) throw new TypeError(`hook event '${input.hook_event_name}' does not match projected event '${expectedEvent}'`);
  if (input.tool_name !== "Bash") return { decision: "skip", reason: "not a Bash tool call" };
  if (!isHeavyCommand(commandText(input.tool_input))) return { decision: "skip", reason: "no disk-heavy command found" };
  const sessionId = typeof input.session_id === "string" && input.session_id ? input.session_id : null;
  const lock = readLock(lockPath);
  if (lock && lock.sessionId !== sessionId && !isStale(lock)) {
    return {
      decision: "deny",
      reason: `another session (${lock.sessionId ?? "unknown"}) started '${lock.command}' at ${lock.startedAt} and has not finished — concurrent npm installs are the documented mechanism behind repeated disk/WSL crashes on this machine; wait for it to finish and retry (a lock older than 20 minutes is treated as abandoned)`,
    };
  }
  try {
    writeFileSync(lockPath, JSON.stringify({ sessionId, command: commandText(input.tool_input), startedAt: new Date().toISOString() }));
  } catch {
    // A lock we cannot write cannot coordinate anything; fail open rather than block all installs on a filesystem fault.
  }
  return { decision: "allow" };
}

/**
 * Releases this session's disk-io coordination lock once its `npm install`-family command has finished.
 *
 * @param {object} input A Claude Code PostToolUse hook stdin payload.
 * @param {string} expectedEvent The lifecycle event this invocation was projected for.
 * @param {{lockPath?: string}} [options] Overrides the machine-wide lock path (tests only; production uses the fixed default).
 * @returns {object} A record naming the decision: allow (always) and whether a lock was released.
 * @throws {TypeError} When the input is not an object or names a different hook event.
 */
export function releaseDiskIoCoordinationLock(input, expectedEvent, { lockPath = DEFAULT_LOCK_PATH } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("hook input must be a JSON object");
  if (input.hook_event_name !== expectedEvent) throw new TypeError(`hook event '${input.hook_event_name}' does not match projected event '${expectedEvent}'`);
  if (input.tool_name !== "Bash" || !isHeavyCommand(commandText(input.tool_input))) return { decision: "allow", released: false };
  const sessionId = typeof input.session_id === "string" && input.session_id ? input.session_id : null;
  const lock = readLock(lockPath);
  if (!lock || lock.sessionId !== sessionId) return { decision: "allow", released: false };
  try {
    unlinkSync(lockPath);
  } catch {
    // Already gone, or another session reclaimed it as stale in the meantime; nothing to do.
  }
  return { decision: "allow", released: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.env[BYPASS_ENV_VAR] === "1") {
    process.exit(0);
  }
  try {
    const expectedEvent = cliArgument("--expected-event");
    const input = await readBoundedHookInput(process.stdin);
    const result = expectedEvent === "PostToolUse" ? releaseDiskIoCoordinationLock(input, expectedEvent) : checkDiskIoCoordinationHook(input, expectedEvent);
    if (result.decision === "deny") {
      process.stderr.write(`check-disk-io-coordination-hook: denied: ${result.reason} (bypass with ${BYPASS_ENV_VAR}=1)\n`);
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(`check-disk-io-coordination-hook: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
