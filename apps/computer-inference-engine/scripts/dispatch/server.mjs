#!/usr/bin/env node

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createA2aServer, createA2aServerProcess } from "@red-cup-engineering/a2a-services-section/a2a-server";
import { loadSignedAgentCard } from "@red-cup-engineering/a2a-services-section/agent-card-signing";
import { DurableA2aTaskStore } from "@red-cup-engineering/a2a-services-section/durable-task-store";
import { createFilesystemA2aTaskSource } from "@red-cup-engineering/a2a-services-section/filesystem-state-sources";
import { executeA2aMessage } from "./execute-a2a-task.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function serve(options = {}) {
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PORT ?? "8796");
  const baseUrl = options.baseUrl ?? process.env.BASE_URL;
  const signedCard = options.agentCard ? { card: options.agentCard, jwks: options.jwks } : await loadSignedAgentCard({
    origin: baseUrl ?? `http://${host}:${port}`,
    cardPath: resolve(ROOT, "content/dispatch/agent-cards/inference-work-lot-market.json"),
    signingKeyPath: process.env.AGENT_CARD_SIGNING_KEY,
    jwksPath: process.env.AGENT_CARD_JWKS,
    kid: process.env.AGENT_CARD_SIGNING_KID,
  });
  const dataRoot = resolve(options.dataRoot ?? process.env.INFERENCE_WORK_LOT_DATA_ROOT ?? resolve(ROOT, "data"));
  const taskStore = options.taskStore ?? new DurableA2aTaskStore(
    createFilesystemA2aTaskSource(join(dataRoot, "a2a-tasks")),
    { tenant: "inference-work-lot" },
  );
  return createA2aServer({
    ...options, host, port, baseUrl, agentCard: signedCard.card, jwks: signedCard.jwks, taskStore,
    handlers: { "message/send": (message) => executeA2aMessage(message) },
  });
}

await createA2aServerProcess({}, { serve });
