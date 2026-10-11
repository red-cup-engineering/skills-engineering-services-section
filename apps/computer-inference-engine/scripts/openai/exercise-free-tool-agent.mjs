#!/usr/bin/env node
import { executeOpenAiCompatibleToolAgent } from "../../src/openai/tool-agent.mjs";
import { createRepositoryObservationHandlers, REPOSITORY_OBSERVATION_TOOLS } from "@red-cup-engineering/feltos/operations";

import { providerConfiguration } from "@red-cup-engineering/computer-inference-engine/openai/provider-runtime";

function option(name) { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1] ?? null; }
const providerName = option("--provider") ?? "groq";
const provider = providerConfiguration(providerName);
const objective = option("--objective") ?? "Observe the machine territory and explain one capacity fact without proposing a mutation.";
const root = option("--root") ?? process.cwd();
const handlers = createRepositoryObservationHandlers({ root });
const seedQuery = option("--seed-query");
let seed = null;
if (seedQuery !== null) {
  const [content, names] = await Promise.all([
    handlers.search_repository({ query: seedQuery, path: ".", maximumMatches: 40 }),
    handlers.find_repository_paths({ fragment: seedQuery, path: ".", maximumPaths: 40 }),
  ]);
  const all = [...new Set([...(names.paths ?? []), ...(content.paths ?? [])])];
  const rank = (path) => (path.includes("/lib/legacy/") ? 4 : 0) + (path.includes("/.lake/") ? 10 : 0) + (path.toLowerCase().includes(seedQuery.toLowerCase()) ? -1 : 0);
  all.sort((left, right) => rank(left) - rank(right) || left.localeCompare(right));
  seed = Object.freeze({ type: "DeterministicRepositorySeedObservation", query: seedQuery, candidates: all.slice(0, 12), omittedCandidateCount: Math.max(0, all.length - 12), prioritization: "exact-name and live non-legacy paths first; omitted candidates remain discoverable" });
}
const result = await executeOpenAiCompatibleToolAgent({
  provider: providerName,
  endpoint: provider.chatCompletionsUrl,
  apiKey: (provider.apiKeyEnvVars ?? [provider.apiKeyEnvVar]).map((name) => process.env[name]).find(Boolean),
  model: option("--model") ?? process.env[provider.defaultModelEnvVar] ?? provider.defaultModel,
  messages: [
    { role: "system", content: "You are a read-only repository research worker. Use only offered observation tools. Deterministic code may provide a seed search observation: use only paths that observation actually names, and never invent a path. If more discovery is needed, search from '.'. Distinguish observed evidence from inference. Never claim a write, execution, or settlement." },
    { role: "user", content: seed === null ? objective : `${objective}\n\nDeterministic seed observation:\n${JSON.stringify(seed)}` },
  ],
  tools: REPOSITORY_OBSERVATION_TOOLS,
  toolHandlers: handlers,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
