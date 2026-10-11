#!/usr/bin/env node
import { resolve } from "node:path";
import { createA2aServerProcess } from "@red-cup-engineering/a2a-services-section/a2a-server";
import { loadSignedAgentCard } from "@red-cup-engineering/a2a-services-section/agent-card-signing";
import { executeProviderMessage, providerConfiguration, providerResourceRoot } from "../../src/openai/provider-runtime.mjs";
const [provider, directory] = process.argv.slice(2);
const row = providerConfiguration(provider), root = providerResourceRoot(row, directory);
if (!row.execution?.team) throw new Error("provider requires an explicit signed agent card identity");
const host = process.env.HOST ?? "127.0.0.1", port = Number(process.env.PORT ?? "8791"), baseUrl = process.env.BASE_URL;
const agentCard = (await loadSignedAgentCard({
  origin: baseUrl ?? `http://${host}:${port}`,
  cardPath: resolve(root, "content/agent-cards", `${row.execution.team}.json`),
  signingKeyPath: process.env.AGENT_CARD_SIGNING_KEY,
  jwksPath: process.env.AGENT_CARD_JWKS,
  kid: process.env.AGENT_CARD_SIGNING_KID,
})).card;
await createA2aServerProcess({
  host, port, baseUrl, agentCard,
  handlers: { "message/send": (message) => executeProviderMessage(row.providerId, message, { resourceRoot: root }) },
});
