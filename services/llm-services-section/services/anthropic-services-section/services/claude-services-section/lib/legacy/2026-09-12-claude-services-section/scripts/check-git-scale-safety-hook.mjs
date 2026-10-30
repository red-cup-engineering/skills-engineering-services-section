#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { cliArgument, commandInvocations, commandText, readBoundedHookInput, shellCommandSegmentTokens, transcriptHasUserPattern } from "./lib/claude-hook-input.mjs";

const BYPASS_ENV_VAR = "GIT_SCALE_SAFETY_HOOK_BYPASS";
const BULK_COMMIT_OPT_IN_PATTERNS = [/\bbulk commit\b/i, /\bblanket commit\b/i, /\bgit add -A\b/i, /\ball (the )?dirt\b.{0,40}\bcommit\b/i];
const commandSegments = shellCommandSegmentTokens;
const gitInvocations = (command) => commandInvocations(command, "git");

function isRecursiveGrepFlag(argument) {
  if (argument === "-r" || argument === "-R" || argument === "--recursive") return true;
  return /^-[a-zA-Z]+$/u.test(argument) && (argument.includes("r") || argument.includes("R"));
}

function excludesNodeModules(rest) {
  return rest.some((argument) => argument.includes("node_modules"));
}

/**
 * Finds a plain (non-git) `grep -r`/`-R` or an unbounded `find` in a Bash command: this repository
 * has dozens of independently-installed `node_modules` trees at every depth (270k files total), and
 * neither command skips them the way `git grep`/`rg`/`fd` do by respecting `.gitignore` — a bare
 * recursive walk from any directory can still fall into one and hang or crash the shared machine.
 *
 * @param {string} command The Bash tool's shell command string.
 * @returns {string|null} A reason naming the violation, or null when the command has none.
 */
export function findSearchScaleSafetyViolation(command) {
  if (typeof command !== "string") return null;
  for (const tokens of commandSegments(command)) {
    const [program, ...rest] = tokens;
    if (program === "grep" && rest.some(isRecursiveGrepFlag) && !excludesNodeModules(rest)) {
      return "`grep -r`/`-R` walks every directory including this repository's many independent `node_modules` trees and has hung/crashed the shared machine — use `rg` instead (it skips `.gitignore`d paths, including `node_modules`, by default)";
    }
    if (program === "find" && !rest.includes("-maxdepth") && !excludesNodeModules(rest)) {
      return "a `find` with no `-maxdepth` can walk into one of this repository's many `node_modules` trees and has hung/crashed the shared machine — add `-maxdepth <n>`, exclude `node_modules` explicitly, or use `fd` instead (it skips `.gitignore`d paths by default)";
    }
  }
  return null;
}

function isWildcardAddArg(argument) {
  return ["-A", "--all", ".", "-u", "--update"].includes(argument);
}

function isWildcardCommitArg(argument) {
  if (argument === "-a" || argument === "--all") return true;
  return /^-[a-zA-Z]+$/u.test(argument) && !argument.startsWith("--") && argument.includes("a");
}

/**
 * Finds the first git invocation in a Bash command that this 270k-file, many-concurrent-session
 * repository cannot safely absorb: wildcard staging/committing (sweeps up another live session's
 * uncommitted files), `git grep` or unscoped `git log -p`/`--all` (unscoped tree/history walks —
 * the documented mechanism behind repeated 2026-09-10 WSL crashes), and `git worktree add` (a linked
 * worktree materializes another full copy of the tree instead of isolating work cheaply).
 *
 * @param {string} command The Bash tool's shell command string.
 * @returns {string|null} A reason naming the violation, or null when the command has none.
 */
export function findGitScaleSafetyViolation(command) {
  if (typeof command !== "string" || !command.includes("git")) return null;
  for (const args of gitInvocations(command)) {
    const [subcommand, ...rest] = args;
    if (subcommand === "add" && rest.some(isWildcardAddArg)) {
      return "`git add -A`/`.`/`-u` stages everything currently sitting in the working tree, including another live session's uncommitted files — use commit-git-paths.mjs by exact path instead (see the use-git skill), or ask the owner and state the request as a deliberate bulk commit";
    }
    if (subcommand === "commit" && rest.some(isWildcardCommitArg)) {
      return "`git commit -a`/`-am`/`--all` commits everything currently modified in the working tree, including another live session's uncommitted files — use commit-git-paths.mjs by exact path instead";
    }
    if (subcommand === "grep") {
      return "`git grep` walks the whole working tree on this 270k-file repository and has crashed the shared machine — use `rg`/`fd` scoped to a path instead";
    }
    if (subcommand === "log" && rest.some((argument) => ["-p", "--patch", "--all"].includes(argument)) && !rest.includes("--")) {
      return "`git log -p`/`--all` without a `-- <path>` walks the whole repository's history and has crashed the shared machine — add `-- <path>`";
    }
    if (subcommand === "worktree" && rest[0] === "add") {
      return "a linked `git worktree` on this 270k-file repository materializes another full checkout and multiplies disk I/O — do the work directly in this checkout and commit by exact path instead";
    }
  }
  return null;
}

/**
 * Denies a Bash git invocation this repository's scale cannot safely absorb, unless the transcript
 * shows the owner explicitly asked for a bulk/blanket commit (the one lawful use of wildcard add).
 *
 * @param {object} input A Claude Code PreToolUse hook stdin payload.
 * @param {string} expectedEvent The lifecycle event this invocation was projected for.
 * @returns {object} A record naming the decision: allow, skip (not Bash, or no violation), or deny with a reason.
 * @throws {TypeError} When the input is not an object or names a different hook event.
 */
export function checkGitScaleSafetyHook(input, expectedEvent) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("hook input must be a JSON object");
  if (input.hook_event_name !== expectedEvent) throw new TypeError(`hook event '${input.hook_event_name}' does not match projected event '${expectedEvent}'`);
  if (input.tool_name !== "Bash") return { decision: "skip", reason: "not a Bash tool call" };
  const command = commandText(input.tool_input);
  const violation = findGitScaleSafetyViolation(command) ?? findSearchScaleSafetyViolation(command);
  if (!violation) return { decision: "skip", reason: "no unsafe git or search pattern found" };
  const isWildcardStaging = violation.startsWith("`git add") || violation.startsWith("`git commit");
  if (isWildcardStaging && typeof input.transcript_path === "string" && input.transcript_path && transcriptHasUserPattern(input.transcript_path, BULK_COMMIT_OPT_IN_PATTERNS)) {
    return { decision: "allow" };
  }
  return { decision: "deny", reason: violation };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.env[BYPASS_ENV_VAR] === "1") {
    process.exit(0);
  }
  try {
    const result = checkGitScaleSafetyHook(await readBoundedHookInput(process.stdin), cliArgument("--expected-event"));
    if (result.decision === "deny") {
      process.stderr.write(`check-git-scale-safety-hook: denied: ${result.reason} (bypass with ${BYPASS_ENV_VAR}=1)\n`);
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(`check-git-scale-safety-hook: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
