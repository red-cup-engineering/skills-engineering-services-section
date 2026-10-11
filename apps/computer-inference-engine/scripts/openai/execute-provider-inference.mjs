#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { executeProviderMessage } from "../../src/openai/provider-runtime.mjs";
try {
  const [provider, resourceRoot] = process.argv.slice(2);
  if (!provider) throw new Error("usage: execute-provider-inference <provider-id> [resource-root] < message.json");
  process.stdout.write(`${JSON.stringify(await executeProviderMessage(provider, JSON.parse(readFileSync(0, "utf8")), { resourceRoot }))}\n`);
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
