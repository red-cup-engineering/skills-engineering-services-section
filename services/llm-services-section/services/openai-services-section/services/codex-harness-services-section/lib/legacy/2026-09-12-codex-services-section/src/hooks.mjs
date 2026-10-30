#!/usr/bin/env node
// Codex CLI lifecycle hook handler. Wired up by scripts/install-hooks.mjs
// into .codex/hooks.json. Reads one hook event JSON payload from stdin and
// writes a hook response JSON to stdout.
//
// What it does:
//   - PreToolUse on apply_patch: refuses patches that touch paths outside
//     the workspace (absolute paths, `..` traversal, or `.git`).
//   - PostToolUse: caches large tool output to disk and returns a bounded
//     summary instead of the full text (see tool-evidence.mjs).
//   - Stop / SessionEnd: reports the turn's token usage (see usage.mjs).
//
// Each hook delivery is claimed exactly once via a lock file, since Codex
// can deliver the same native event to more than one installed hook.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EMPTY_WITNESS_ROOT,
  identifyJsonSemanticContent,
  sha256DigestBytesFromNiUri,
} from "@red-cup-engineering/semantic-content-identify-service";
import { stateRoot } from "./state-root.mjs";
import { compileEvidence } from "./tool-evidence.mjs";
import { observeNativeUsage } from "./native-usage.mjs";

/** True the first time this exact hook delivery is seen; false on a repeat. */
export function claimDelivery(input, options = {}) {
  const eventIdentity = identifyJsonSemanticContent({
    objectKind: "bare-cedar-fog-codex.hook-delivery",
    value: {
      hookEventName: input?.hook_event_name ?? "unknown",
      sessionId: input?.session_id ?? null,
      turnId: input?.turn_id ?? null,
      toolUseId: input?.tool_use_id ?? null,
      nativeEventId: input?.hook_event_id ?? input?.event_id ?? null,
    },
    witnessRoot: EMPTY_WITNESS_ROOT,
  }).id;
  const claimsRoot = join(stateRoot(options), "hook-delivery-claims");
  mkdirSync(claimsRoot, { recursive: true, mode: 0o700 });
  const path = join(claimsRoot, `${Buffer.from(sha256DigestBytesFromNiUri(eventIdentity)).toString("hex")}.json`);
  try {
    writeFileSync(path, `${JSON.stringify({ eventIdentity })}\n`, { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

/** Extract the file paths a Codex `apply_patch` command's patch text touches. */
function patchPaths(patchText) {
  return [
    ...patchText.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): ([^\n]+)$/gmu),
    ...patchText.matchAll(/^(?:\+\+\+|---) [ab]\/([^\n]+)$/gmu),
  ].map((match) => match[1]);
}

function isWorkspacePath(path) {
  return path.length > 0 && !path.startsWith("/") && !path.split("/").some((segment) => segment === ".." || segment === ".git");
}

/**
 * Decide whether a PreToolUse call may proceed. The only enforced rule is
 * that `apply_patch` may not name a path outside the workspace; every other
 * tool is allowed through.
 */
export function evaluateToolUse(input) {
  const tool = String(input?.tool_name ?? "unknown");
  if (tool !== "apply_patch") return Object.freeze({ allowed: true });
  const toolInput = input?.tool_input;
  const patchText = typeof toolInput === "string"
    ? toolInput
    : ["patch", "input", "command", "cmd"].map((key) => toolInput?.[key]).find((value) => typeof value === "string") ?? "";
  const paths = patchPaths(patchText);
  if (paths.length > 0 && paths.every(isWorkspacePath)) return Object.freeze({ allowed: true });
  return Object.freeze({ allowed: false, reason: "apply_patch may only touch paths inside the workspace" });
}

export function handle(input, options = {}) {
  const claim = options.claimDelivery ?? claimDelivery;
  if (!claim(input, options)) return {};

  if (input.hook_event_name === "PreToolUse") {
    const disposition = evaluateToolUse(input);
    if (!disposition.allowed) {
      return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: disposition.reason } };
    }
    return {};
  }

  if (input.hook_event_name === "PostToolUse") {
    const raw = typeof input.tool_response === "string" ? input.tool_response : JSON.stringify(input.tool_response ?? null);
    compileEvidence(raw, { ...options, tool: String(input.tool_name ?? "unknown") });
    return {};
  }

  if (input.hook_event_name === "Stop" || input.hook_event_name === "SessionEnd") {
    const usage = (options.observeUsage ?? observeNativeUsage)({ sessionId: input.session_id, turnId: input.turn_id, includeWeekly: false });
    if (usage.latestTurn) {
      return { systemMessage: `turn used ${usage.latestTurn.usage.total_tokens} tokens` };
    }
    return {};
  }

  return {};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    process.stdout.write(`${JSON.stringify(handle(input))}\n`);
  } catch (error) {
    process.stderr.write(`hooks: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
