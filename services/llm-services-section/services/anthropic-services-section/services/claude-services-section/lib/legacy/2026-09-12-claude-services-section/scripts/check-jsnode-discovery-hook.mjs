#!/usr/bin/env node
import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cliArgument, readBoundedHookInput, transcriptHasToolUse } from "./lib/claude-hook-input.mjs";

const BYPASS_ENV_VAR = "JSNODE_DISCOVERY_HOOK_BYPASS";
const CODE_EXTENSIONS = new Set([".mjs", ".mts", ".cjs", ".cts", ".ts", ".tsx", ".js", ".jsx"]);
const EXCLUDED_PATH_PATTERN = /\/(node_modules|scratchpad|dist|build|coverage|\.claude)\/|(^|\/)test(s)?\//u;
const DISCOVERY_TOOL_PATTERN = /^(jsnode_|mcp__jsnode-server__)/u;

/**
 * Denies a Write of a brand-new JS/TS source file when this transcript shows no prior jsnode-server
 * discovery call — the executable-behavior and package graph this house built expressly so that a new
 * function or data class is never authored before checking whether the capability already exists.
 *
 * @summary Denies authoring a new JS/TS file until the transcript shows a jsnode-server discovery call.
 * @param {object} input A Claude Code PreToolUse hook stdin payload, including transcript_path.
 * @param {string} expectedEvent The lifecycle event this invocation was projected for.
 * @returns {object} A record naming the decision: allow, skip (not a qualifying Write), or deny with a reason.
 * @throws {TypeError} When the input is not an object or names a different hook event.
 */
export function checkJsnodeDiscoveryHook(input, expectedEvent) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("hook input must be a JSON object");
  if (input.hook_event_name !== expectedEvent) throw new TypeError(`hook event '${input.hook_event_name}' does not match projected event '${expectedEvent}'`);
  if (input.tool_name !== "Write") return { decision: "skip", reason: "not a Write tool call" };
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== "string" || !filePath) return { decision: "skip", reason: "no file_path on the Write call" };
  if (!CODE_EXTENSIONS.has(extname(filePath))) return { decision: "skip", reason: "not a JS/TS source file" };
  if (EXCLUDED_PATH_PATTERN.test(filePath.split("\\").join("/"))) return { decision: "skip", reason: "excluded path (test, generated, or scratch)" };
  if (existsSync(filePath)) return { decision: "skip", reason: "the file already exists; this is not a new implementation" };
  if (typeof input.transcript_path !== "string" || !input.transcript_path) {
    return { decision: "deny", reason: "no transcript available to verify a jsnode-server discovery search happened before this new file" };
  }
  if (transcriptHasToolUse(input.transcript_path, (name) => DISCOVERY_TOOL_PATTERN.test(name))) return { decision: "allow" };
  return {
    decision: "deny",
    reason:
      `this transcript shows no jsnode-server discovery call before writing new file '${filePath}'. ` +
      "Load the jsnode-server tools first (ToolSearch \"select:jsnode_search,jsnode_duplication,jsnode_atlas,jsnode_package,jsnode_query\") " +
      "and use jsnode_search/jsnode_atlas to find the package that should own this capability, or jsnode_duplication to check for an " +
      "existing implementation, before authoring a new function or data class here " +
      `(bypass with ${BYPASS_ENV_VAR}=1 only when you have already confirmed by another route that nothing upstream provides this)`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.env[BYPASS_ENV_VAR] === "1") {
    process.exit(0);
  }
  try {
    const result = checkJsnodeDiscoveryHook(await readBoundedHookInput(process.stdin), cliArgument("--expected-event"));
    if (result.decision === "deny") {
      process.stderr.write(`check-jsnode-discovery-hook: denied: ${result.reason}\n`);
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(`check-jsnode-discovery-hook: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
