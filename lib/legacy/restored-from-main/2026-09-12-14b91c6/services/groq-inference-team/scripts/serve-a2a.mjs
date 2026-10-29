#!/usr/bin/env node
import { resolve } from "node:path";
import { serveContractedAgentProcess } from "@red-cup-engineering/a2a-contracted-agent-service";
const ROOT = resolve(import.meta.dirname, "..");
serveContractedAgentProcess({ port: Number(process.env.PORT ?? "8791"), host: process.env.HOST ?? "127.0.0.1", baseUrl: process.env.BASE_URL, agentCard: resolve(ROOT, "content/agent-cards/groq-inference-team.json"), executor: process.execPath, executorArgs: [resolve(ROOT, "src/execute-rmn-inference.mjs")] });
