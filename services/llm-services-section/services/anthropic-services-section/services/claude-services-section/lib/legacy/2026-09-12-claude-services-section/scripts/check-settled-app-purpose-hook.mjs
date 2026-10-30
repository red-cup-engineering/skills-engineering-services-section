#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cliArgument, readBoundedHookInput } from "./lib/claude-hook-input.mjs";

const BYPASS_ENV_VAR = "SETTLED_APP_PURPOSE_HOOK_BYPASS";
const QUALIFYING_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = resolve(ROOT, "content/harness/settled-app-purposes.json");

/**
 * Denies a Write/Edit/MultiEdit under a path this house has already settled the purpose of, where
 * that purpose forbids the app carrying capability code of its own (a UI, a composition point). This
 * exists so "should I fix this app's build/code in place" is never a live question a session has to
 * ask or a Founder has to keep answering — the settled purpose already answers it: move the capability
 * to its real script-tier home and migrate the app to consume it, don't patch it in place. Founder-ruled
 * 2026-09-11, after repeating "MetroPlat is the UI for MARSH" and "FeltOS composes, it does not hold"
 * across many sessions: "if you were listening to my 'make it so you are configured with the right
 * agents, skills, to follow our methods' then 'Should I fix metroplat?' would never be a question you
 * would ask me... you would have the agents, skills, etc., to know the question is invalid as formed."
 *
 * @param {object} input A Claude Code PreToolUse hook stdin payload.
 * @param {string} expectedEvent The lifecycle event this invocation was projected for.
 * @param {string} [registryPath] Override for testing; defaults to the authored settled-app-purposes.json.
 * @returns {object} A record naming the decision: allow, skip (not a qualifying call), or deny with a reason.
 * @throws {TypeError} When the input is not an object or names a different hook event.
 */
export function checkSettledAppPurposeHook(input, expectedEvent, registryPath = REGISTRY_PATH) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("hook input must be a JSON object");
  if (input.hook_event_name !== expectedEvent) throw new TypeError(`hook event '${input.hook_event_name}' does not match projected event '${expectedEvent}'`);
  if (!QUALIFYING_TOOLS.has(input.tool_name)) return { decision: "skip", reason: "not a Write/Edit/MultiEdit tool call" };
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== "string" || !filePath) return { decision: "skip", reason: "no file_path on the tool call" };
  const normalized = filePath.split("\\").join("/");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const entry = (registry.entries ?? []).find((candidate) => normalized.includes(candidate.pathContains));
  if (!entry) return { decision: "skip", reason: "not a path with a settled, capability-forbidden purpose" };
  return {
    decision: "deny",
    reason:
      `'${filePath}' is inside ${entry.app}, whose purpose this house has already settled: ${entry.purpose} ${entry.instruction} ` +
      `(bypass with ${BYPASS_ENV_VAR}=1 only for a genuinely purpose-conforming change, e.g. pure UI/composition wiring, not a capability fix)`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.env[BYPASS_ENV_VAR] === "1") {
    process.exit(0);
  }
  try {
    const result = checkSettledAppPurposeHook(await readBoundedHookInput(process.stdin), cliArgument("--expected-event"));
    if (result.decision === "deny") {
      process.stderr.write(`check-settled-app-purpose-hook: denied: ${result.reason}\n`);
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(`check-settled-app-purpose-hook: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
