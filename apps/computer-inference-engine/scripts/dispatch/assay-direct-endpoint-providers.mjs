#!/usr/bin/env node

// Assay every admitted direct endpoint provider for real: which descriptors
// load (a bearer descriptor whose key variable is unset is reported as
// skipped, never hidden), whether the provider still serves the pinned
// model (its models listing, when the endpoint family has one), and one
// bounded chat round trip through the same transport the market uses.
// Prints one JSON line per provider and a final summary; exit 1 when no
// provider answers. Run with the environment loaded:
//   node --env-file-if-exists=/home/emsenn/info/.env scripts/assay-direct-endpoint-providers.mjs

import { readFileSync } from "node:fs";
import { executeOpenAiCompatibleToolAgent } from "@red-cup-engineering/computer-inference-engine/openai/tool-agent";
import { DEFAULT_DIRECT_ENDPOINT_PROVIDER_CONFIG, loadDirectEndpointProviderDescriptors } from "../../src/dispatch/direct-endpoint-provider.mjs";

const configPath = process.env.DIRECT_ENDPOINT_PROVIDER_CONFIG ?? DEFAULT_DIRECT_ENDPOINT_PROVIDER_CONFIG;
const carrier = JSON.parse(readFileSync(configPath, "utf8"));
const admitted = loadDirectEndpointProviderDescriptors(process.env, { configPath });
const admittedActors = new Set(admitted.map(({ provider }) => provider));

function modelsUrl(endpoint) {
  return endpoint.replace(/\/chat\/completions\/?$/u, "/models");
}

async function listModels(descriptor) {
  const url = modelsUrl(descriptor.endpoint);
  if (url === descriptor.endpoint) return { status: "n/a" };
  try {
    const response = await fetch(url, {
      headers: descriptor.auth.mode === "bearer" ? { authorization: `Bearer ${descriptor.apiKey}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => ({}));
    const ids = (body.data ?? body.models ?? []).map((m) => m.id ?? m.name ?? "").map((id) => id.replace(/^models\//u, ""));
    return { status: response.status, count: ids.length, servesPinnedModel: ids.includes(descriptor.model) };
  } catch (error) {
    return { status: "error", reason: error instanceof Error ? error.message : String(error) };
  }
}

async function chat(descriptor) {
  const t0 = Date.now();
  const completion = await executeOpenAiCompatibleToolAgent({
    provider: descriptor.provider,
    endpoint: descriptor.endpoint,
    apiKey: descriptor.apiKey,
    auth: descriptor.auth,
    model: descriptor.model,
    messages: [{ role: "user", content: "Reply with exactly the single word: ready" }],
    maximumOutputTokens: 16,
    timeoutMs: 45_000,
  });
  const ms = Date.now() - t0;
  if (completion.disposition === "refused" || completion.disposition === "provider-exchange-failed") {
    return { ok: false, ms, cause: completion.cause ?? completion.reason ?? completion.disposition };
  }
  return { ok: true, ms, model: completion.model, text: String(completion.text ?? "").slice(0, 60) };
}

const rows = [];
for (const entry of carrier.providers) {
  const actor = entry.actor;
  if (!admittedActors.has(actor)) {
    rows.push({ provider: actor, loaded: false, reason: entry.apiKeyEnv ? `key variable ${entry.apiKeyEnv} unset` : "under-configured" });
    continue;
  }
  const descriptor = admitted.find(({ provider }) => provider === actor);
  const models = await listModels(descriptor);
  const exchange = await chat(descriptor);
  rows.push({ provider: actor, loaded: true, model: descriptor.model, models, chat: exchange });
}
for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
const answering = rows.filter((row) => row.chat?.ok).length;
process.stdout.write(`${JSON.stringify({ summary: { configured: carrier.providers.length, loaded: admitted.length, answering } })}\n`);
if (answering === 0) process.exitCode = 1;
