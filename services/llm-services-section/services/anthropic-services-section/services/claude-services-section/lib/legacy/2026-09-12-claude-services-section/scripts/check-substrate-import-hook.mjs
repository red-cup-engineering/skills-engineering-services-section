#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { newlyIntroducedNodeBuiltinImportFindings } from "@red-cup-engineering/audit-node-builtin-imports-service";
import { cliArgument, readBoundedHookInput } from "./lib/claude-hook-input.mjs";

const CHECKED_TOOLS = new Set(["Write", "Edit"]);
const CHECKED_EXTENSIONS = new Set([".mjs", ".mts", ".js", ".ts"]);
const BYPASS_ENV_VAR = "SUBSTRATE_IMPORT_HOOK_BYPASS";

function resultingText(toolName, toolInput) {
  if (toolName === "Write") return typeof toolInput.content === "string" ? toolInput.content : null;
  if (typeof toolInput.old_string !== "string" || typeof toolInput.new_string !== "string") return null;
  let current;
  try {
    current = readFileSync(toolInput.file_path, "utf8");
  } catch {
    return null;
  }
  return toolInput.replace_all
    ? current.split(toolInput.old_string).join(toolInput.new_string)
    : current.replace(toolInput.old_string, toolInput.new_string);
}

function findingReason(finding) {
  if (finding.needsUpstreamWrapper) {
    return `imports \`${finding.builtin}\` at line ${finding.line}, which has no house wrapper yet — the task is building that wrapper upstream (computer-code/data/networking), not hand-wiring the substrate here`;
  }
  return `imports \`${finding.builtin}\` at line ${finding.line}, which \`${finding.houseService}\` already owns — use that instead of the substrate directly`;
}

/**
 * Reads the file currently on disk at one path, for comparison against a pending edit's resulting text.
 * @param {string} filePath An absolute or cwd-relative filesystem path.
 * @returns {string|undefined} The file's current text, or undefined when it does not yet exist (a brand-new file) or cannot be read.
 */
function currentTextOnDisk(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Denies a Write or Edit of one JavaScript file whose resulting text hand-imports a substrate
 * module (a Node built-in or third-party package) that a house service already owns or should own.
 *
 * @summary Denies a Write or Edit that hand-imports a substrate a house service owns or should own.
 * @param {object} input A Claude Code PreToolUse hook stdin payload.
 * @param {string} expectedEvent The lifecycle event this invocation was projected for.
 * @returns {object} A record naming the decision: allow, skip (not a checked file), or deny with a reason.
 * @throws {TypeError} When the input is not an object or names a different hook event.
 */
export function checkSubstrateImportHook(input, expectedEvent) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("hook input must be a JSON object");
  if (input.hook_event_name !== expectedEvent) throw new TypeError(`hook event '${input.hook_event_name}' does not match projected event '${expectedEvent}'`);
  const toolInput = input.tool_input;
  if (!CHECKED_TOOLS.has(input.tool_name) || !toolInput || typeof toolInput.file_path !== "string") {
    return { decision: "skip", reason: "not a checked Write/Edit tool call" };
  }
  if (!CHECKED_EXTENSIONS.has(extname(toolInput.file_path))) return { decision: "skip", reason: "not a JavaScript file" };
  const text = resultingText(input.tool_name, toolInput);
  if (text === null) return { decision: "skip", reason: "could not resolve the resulting file text" };
  const newFindings = newlyIntroducedNodeBuiltinImportFindings({
    path: toolInput.file_path,
    text,
    beforeText: currentTextOnDisk(toolInput.file_path),
    packageName: toolInput.packageName,
  });
  if (newFindings.length === 0) return { decision: "allow", path: toolInput.file_path };
  return {
    decision: "deny",
    path: toolInput.file_path,
    reason: newFindings.map(findingReason).join("; "),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.env[BYPASS_ENV_VAR] === "1") {
    process.exit(0);
  }
  try {
    const result = checkSubstrateImportHook(await readBoundedHookInput(process.stdin), cliArgument("--expected-event"));
    if (result.decision === "deny") {
      process.stderr.write(`check-substrate-import-hook: denied ${result.path}: ${result.reason} (bypass with ${BYPASS_ENV_VAR}=1)\n`);
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(`check-substrate-import-hook: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
