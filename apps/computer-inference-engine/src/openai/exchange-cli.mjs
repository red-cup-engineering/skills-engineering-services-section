import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeProviderExchange } from "./provider-runtime.mjs";
import { runOpenAiCompatibleChatExchange, validateChatCompletionPacket } from "./openai-compatible-chat-completion.mjs";

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

/** Shared file/argv boundary; provider modules supply only endpoint and policy differences. */
export async function runChatExchangeCli(config, request = fetch) {
  const { entryUrl, apiKeyEnvVars, defaultModelEnvVar, retiredFuelEnvVar, resourceEnv } = config;
  const directory = config.resourceRoot ?? dirname(fileURLToPath(entryUrl));
  const argv = config.argv ?? process.argv.slice(2);
  if (resourceEnv) {
    const resourcePath = join(directory, "content/resources/inference-account.env");
    if (existsSync(resourcePath)) process.loadEnvFile(resourcePath);
  }
  if (retiredFuelEnvVar && process.env[retiredFuelEnvVar] !== undefined) {
    return fail(2, `${retiredFuelEnvVar} is retired; cancel the durable lot explicitly`);
  }
  const packetPath = argv[0];
  if (!packetPath || packetPath.startsWith("--")) return fail(2, "usage: dispatch-chat-completion <provider-id> <packet.json> [--dry-run]");
  let raw, packet;
  try { raw = readFileSync(resolve(packetPath), "utf8"); }
  catch (error) { return fail(2, `cannot read packet at ${packetPath}: ${error.message}`); }
  try { packet = JSON.parse(raw); }
  catch (error) { return fail(2, `packet at ${packetPath} is not valid JSON: ${error.message}`); }
  if (packet && typeof packet === "object" && !Array.isArray(packet) && [undefined, null, ""].includes(packet.model) && process.env[defaultModelEnvVar]) packet.model = process.env[defaultModelEnvVar];
  const errors = validateChatCompletionPacket(packet);
  if (errors.length) return fail(2, `packet at ${packetPath} is invalid:\n  - ${errors.join("\n  - ")}`);
  const emit = (value) => { if (config.emitResult !== false) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); return value; };
  if (argv.includes("--dry-run")) {
    return emit({ ok: true, "dry-run": true, "packet-valid": true, "auth-presence": Object.fromEntries(apiKeyEnvVars.map((name) => [name, Boolean(process.env[name])])) });
  }
  const apiKey = apiKeyEnvVars.map((name) => process.env[name]).find((value) => value !== undefined && value !== null);
  const record = config.executeExchange ? await config.executeExchange(packet) : await runOpenAiCompatibleChatExchange(packet, { ...config, apiKey, timeoutMs: null }, request);
  if (!config.executeExchange) finalizeProviderExchange(record, config, directory);
  emit(record);
  return record;
}
