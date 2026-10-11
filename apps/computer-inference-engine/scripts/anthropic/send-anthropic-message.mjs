#!/usr/bin/env node
/**
 * send-anthropic-message.mjs — one effect: read an
 * `AnthropicMessageRequest` JSON object from a file path (argv[2]) or
 * stdin, drive one streamed Anthropic Messages API call
 * (`ANTHROPIC_API_KEY` from the environment), fold the stream to its final
 * response with `anthropicMessageStreamAccumulator`, and print that
 * response as JSON on stdout. A failed stream prints a structured failure
 * object and exits 1.
 *
 * Usage:
 *   node scripts/send-anthropic-message.mjs path/to/request.json
 *   cat request.json | node scripts/send-anthropic-message.mjs
 */
import { readFileSync } from "node:fs";
import { streamAnthropicMessage } from "../../src/anthropic/messages-client.mjs";
import { anthropicMessageStreamAccumulator } from "../../src/anthropic/messages-accumulator.mjs";
import { processEnvironment } from "../../src/anthropic/env.mjs";

function readInput() {
  const path = process.argv[2];
  if (path !== undefined) return readFileSync(path, "utf8");
  return readFileSync(0, "utf8");
}

async function main() {
  const request = JSON.parse(readInput());
  const accumulator = anthropicMessageStreamAccumulator();
  for await (const event of streamAnthropicMessage(request, { env: processEnvironment() })) {
    if (event.kind === "anthropic.messages.stream.failure") {
      process.stderr.write(`${JSON.stringify({ kind: event.kind, condition: event.condition, reason: event.reason }, null, 2)}\n`);
      process.exit(1);
    }
    accumulator.push(event.event);
  }
  process.stdout.write(`${JSON.stringify(accumulator.read(), null, 2)}\n`);
}

await main();
