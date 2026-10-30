#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { cliArgument, readBoundedHookInput, transcriptHasUserPattern } from "./lib/claude-hook-input.mjs";

const BYPASS_ENV_VAR = "WORKFLOW_OPT_IN_HOOK_BYPASS";
const OPT_IN_PATTERNS = [/\bultracode\b/i, /\b(use|run)\s+a\s+workflow\b/i, /\bfan\s+out\s+agents\b/i, /\borchestrate\s+this\s+with\s+subagents\b/i, /\bmulti-agent\s+orchestration\b/i];

/**
 * Denies a Workflow tool call whose transcript carries no user-stated multi-agent opt-in.
 *
 * @summary Denies a Workflow call unless the transcript shows the user opted into multi-agent orchestration.
 * @param {object} input A Claude Code PreToolUse hook stdin payload, including transcript_path.
 * @param {string} expectedEvent The lifecycle event this invocation was projected for.
 * @returns {object} A record naming the decision: allow, skip (not a Workflow call), or deny with a reason.
 * @throws {TypeError} When the input is not an object or names a different hook event.
 */
export function checkWorkflowOptInHook(input, expectedEvent) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("hook input must be a JSON object");
  if (input.hook_event_name !== expectedEvent) throw new TypeError(`hook event '${input.hook_event_name}' does not match projected event '${expectedEvent}'`);
  if (input.tool_name !== "Workflow") return { decision: "skip", reason: "not a Workflow tool call" };
  if (typeof input.transcript_path !== "string" || !input.transcript_path) {
    return { decision: "deny", reason: "no transcript available to verify the user opted into multi-agent orchestration" };
  }
  if (transcriptHasUserPattern(input.transcript_path, OPT_IN_PATTERNS)) return { decision: "allow" };
  return {
    decision: "deny",
    reason: "the transcript shows no user opt-in (the word 'ultracode', a stated ultracode session flag, or an explicit ask for multi-agent orchestration/a workflow in the user's own words) — ask the user before calling Workflow; a named workflow existing, or the Skill tool suggesting one, is not itself authorization",
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.env[BYPASS_ENV_VAR] === "1") {
    process.exit(0);
  }
  try {
    const result = checkWorkflowOptInHook(await readBoundedHookInput(process.stdin), cliArgument("--expected-event"));
    if (result.decision === "deny") {
      process.stderr.write(`check-workflow-opt-in-hook: denied Workflow call: ${result.reason} (bypass with ${BYPASS_ENV_VAR}=1)\n`);
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(`check-workflow-opt-in-hook: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
