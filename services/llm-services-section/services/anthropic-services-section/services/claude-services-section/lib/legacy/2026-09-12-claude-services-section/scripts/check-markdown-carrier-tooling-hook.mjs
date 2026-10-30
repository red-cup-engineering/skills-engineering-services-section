#!/usr/bin/env node
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cliArgument, readBoundedHookInput } from "./lib/claude-hook-input.mjs";

const BYPASS_ENV_VAR = "MARKDOWN_CARRIER_TOOLING_HOOK_BYPASS";
const QUALIFYING_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

/**
 * Denies a raw Write/Edit of a Markdown carrier: this house owns a real Markdown-engine operator
 * (`@red-cup-engineering/markdown-engineering-services-section`'s `scripts/markdown-services.mjs`,
 * with `write-markdown-file`/`replace-markdown-section`/`apply-markdown-edit`/`mutate-markdown-frontmatter`
 * among its bins) for exactly this, the same way `commit-git-paths.mjs` is the one lawful route for a
 * commit. Founder-ruled 2026-09-11 after this session hand-edited Markdown rule carriers directly with
 * the Edit tool twice, despite being told to stop after the first time: "fix it so future sessions
 * CANNOT NOT use the tool... by the methods I keep screaming" — meaning enforced here, not left to an
 * agent's memory of a skill it may or may not reread.
 *
 * @param {object} input A Claude Code PreToolUse hook stdin payload.
 * @param {string} expectedEvent The lifecycle event this invocation was projected for.
 * @returns {object} A record naming the decision: allow, skip (not a qualifying call), or deny with a reason.
 * @throws {TypeError} When the input is not an object or names a different hook event.
 */
export function checkMarkdownCarrierToolingHook(input, expectedEvent) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("hook input must be a JSON object");
  if (input.hook_event_name !== expectedEvent) throw new TypeError(`hook event '${input.hook_event_name}' does not match projected event '${expectedEvent}'`);
  if (!QUALIFYING_TOOLS.has(input.tool_name)) return { decision: "skip", reason: "not a Write/Edit/MultiEdit tool call" };
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== "string" || !filePath) return { decision: "skip", reason: "no file_path on the tool call" };
  if (extname(filePath) !== ".md") return { decision: "skip", reason: "not a Markdown file" };
  return {
    decision: "deny",
    reason:
      `direct ${input.tool_name} of a Markdown carrier ('${filePath}') is refused — this house owns a real ` +
      "Markdown-engine operator for this: markdown-engineering-services-section's scripts/markdown-services.mjs " +
      "(bins include write-markdown-file, replace-markdown-section, apply-markdown-edit, mutate-markdown-frontmatter, " +
      "validate-markdown-document). Load the write-markdown skill and use that operator instead of a raw Write/Edit " +
      `(bypass with ${BYPASS_ENV_VAR}=1 only for a case the operator genuinely cannot express)`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.env[BYPASS_ENV_VAR] === "1") {
    process.exit(0);
  }
  try {
    const result = checkMarkdownCarrierToolingHook(await readBoundedHookInput(process.stdin), cliArgument("--expected-event"));
    if (result.decision === "deny") {
      process.stderr.write(`check-markdown-carrier-tooling-hook: denied: ${result.reason}\n`);
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(`check-markdown-carrier-tooling-hook: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
