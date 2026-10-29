#!/usr/bin/env node
import { resolve } from "node:path";
import { serveContractedAgentProcess } from "@red-cup-engineering/a2a-services-section/serve-contracted-agent";

const ROOT = resolve(import.meta.dirname, "..");
serveContractedAgentProcess({ port: Number(process.env.PORT ?? "8795"), host: process.env.HOST ?? "127.0.0.1", baseUrl: process.env.BASE_URL, agentCard: resolve(ROOT, "content/agent-cards/bare-cedar-fog-npu-inference-team.json"), executor: process.execPath, executorArgs: [resolve(ROOT, "src/execute-rmn-inference.mjs")] });
