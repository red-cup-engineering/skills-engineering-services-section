#!/usr/bin/env node
/**
 * count-anthropic-message-tokens.mjs — one effect: read a JSON object
 * `{ kind: "response", message }` (a batched Anthropic Messages response),
 * `{ kind: "stream", content }` (raw SSE text), or
 * `{ kind: "claude-session", content }` (a Claude Code transcript JSONL
 * document) from a file path (argv[2]) or stdin, and print its witnessed
 * token-usage summary as JSON on stdout.
 *
 * Usage:
 *   node scripts/count-anthropic-message-tokens.mjs path/to/request.json
 *   cat request.json | node scripts/count-anthropic-message-tokens.mjs
 */
import { readFileSync } from "node:fs";
import { anthropicMessageTokenUsage, anthropicMessageStreamTokenUsageOfContent, claudeSessionTokenUsageOfContent } from "../../src/anthropic/token-usage.mjs";

function readInput() {
  const path = process.argv[2];
  if (path !== undefined) return readFileSync(path, "utf8");
  return readFileSync(0, "utf8");
}

function main() {
  const request = JSON.parse(readInput());
  if (request === null || typeof request !== "object") {
    process.stderr.write("count-anthropic-message-tokens: input must be a JSON object\n");
    process.exit(2);
  }
  let summary;
  if (request.kind === "response") {
    summary = anthropicMessageTokenUsage(request.message, request.options ?? {});
  } else if (request.kind === "stream") {
    summary = anthropicMessageStreamTokenUsageOfContent(request.content, request.options ?? {});
  } else if (request.kind === "claude-session") {
    summary = claudeSessionTokenUsageOfContent(request.content, request.options ?? {});
  } else {
    process.stderr.write('count-anthropic-message-tokens: kind must be one of "response", "stream", "claude-session"\n');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
