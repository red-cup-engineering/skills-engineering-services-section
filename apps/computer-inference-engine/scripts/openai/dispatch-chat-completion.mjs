#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { runChatExchangeCli } from "../../src/openai/exchange-cli.mjs";
import { providerConfiguration, providerResourceRoot, runProviderExchange } from "../../src/openai/provider-runtime.mjs";

export async function dispatchChatCompletionCli(argv) {
  const [provider, packetPath] = argv;
  if (!provider || !packetPath) throw new Error("usage: dispatch-chat-completion <provider-id|provider-row.json> <packet.json> [--resource-root PATH] [--dry-run]");
  const row = providerConfiguration(existsSync(provider) ? JSON.parse(readFileSync(resolve(provider), "utf8")) : provider);
  const resourceIndex = argv.indexOf("--resource-root");
  if (resourceIndex >= 0 && !argv[resourceIndex + 1]) throw new Error("--resource-root requires a path");
  const resourceRoot = providerResourceRoot(row, resourceIndex >= 0 ? argv[resourceIndex + 1] : undefined);
  return runChatExchangeCli({
    ...row, ...row.execution,
    apiKeyEnvVars: row.apiKeyEnvVars ?? [row.apiKeyEnvVar],
    entryUrl: pathToFileURL(resolve(resourceRoot, "dispatch-chat-completion.mjs")).href,
    resourceRoot, argv: [packetPath, ...argv.slice(2)], emitResult: false,
    executeExchange: (packet) => runProviderExchange(row, packet, { resourceRoot }),
  });
}

runMain(({ argv }) => dispatchChatCompletionCli(argv), {
  moduleUrl: import.meta.url, exitCode: 1,
  formatResult: (result) => result === undefined ? "" : `${JSON.stringify(result, null, 2)}\n`,
});
