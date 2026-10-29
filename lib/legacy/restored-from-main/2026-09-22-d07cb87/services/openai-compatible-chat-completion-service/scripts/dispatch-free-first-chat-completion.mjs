#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { dispatchFreeFirstChatCompletion } from "../src/openai-compatible-chat-completion.mjs";

/**
 * CLI entry point: reads a catalog and packet from disk and dispatches them
 * through `dispatchFreeFirstChatCompletion` (the actual free-first retry
 * loop lives there; this wrapper is file I/O only).
 * Usage: node dispatch-free-first-chat-completion.mjs <catalog.json> <packet.json>
 * @param {string[]} argv - process.argv, unused positions ignored.
 * @returns {Promise<object>} `{ok, provider?, tried, exchange?, reason?}`.
 */
export async function dispatchFreeFirstChatCompletionCli(argv) {
  const [catalogPath, packetPath] = argv;
  if (!catalogPath || !packetPath) throw new Error("usage: dispatch-free-first-chat-completion.mjs <catalog.json> <packet.json>");
  const catalog = JSON.parse(readFileSync(resolve(catalogPath), "utf8"));
  const packet = JSON.parse(readFileSync(resolve(packetPath), "utf8"));
  try {
    return await dispatchFreeFirstChatCompletion({ catalog, packet });
  } catch (error) {
    throw new Error(`packet at ${packetPath} is invalid:\n  - ${error.message.replace(/^packet is invalid:\n\s*-\s*/u, "")}`);
  }
}

runMain(({ argv }) => dispatchFreeFirstChatCompletionCli(argv), {
  moduleUrl: import.meta.url,
  exitCode: 1,
  formatResult: (result) => `${JSON.stringify(result, null, 2)}\n`,
});
