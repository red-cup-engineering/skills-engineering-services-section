#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveContractedAgent } from "@emsenn/a2a-services-section/server";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

serveContractedAgent({
  port: Number(process.env.PORT ?? "8788"),
  host: process.env.HOST ?? "127.0.0.1",
  baseUrl: process.env.BASE_URL,
  agentCard: resolve(ROOT, "content/agent-cards/logical-inference-service-section.json"),
  executor: process.execPath,
  executorArgs: [resolve(ROOT, "src/contract-rmn-inference.mjs")],
}).then(({ server, baseUrl }) => {
  process.stdout.write(`${baseUrl}\n`);
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}).catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
