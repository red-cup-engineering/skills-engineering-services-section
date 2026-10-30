#!/usr/bin/env node
// SessionStart-hook entry: reapplies this host's cheap Git/npm interaction
// defaults (see src/configure-git-npm-interaction-defaults.mjs) at the start
// of every session, so the fix lives in versioned, tested code that runs
// automatically instead of a one-off shell command a session must remember
// to retype.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { configureGitNpmInteractionDefaults } from "../src/configure-git-npm-interaction-defaults.mjs";
import { cliArgument, readBoundedHookInput } from "./lib/claude-hook-input.mjs";

async function main() {
  const expected = cliArgument("--expected-event");
  let repositoryRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  if (!process.stdin.isTTY) {
    const input = await readBoundedHookInput(process.stdin);
    if (expected && input.hook_event_name !== expected) throw new Error(`hook event '${input.hook_event_name}' does not match projected event '${expected}'`);
    if (typeof input.cwd === "string" && input.cwd !== "") repositoryRoot = input.cwd;
  }
  const report = configureGitNpmInteractionDefaults({ repositoryRoot });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`configure-git-npm-interaction-defaults-hook: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
