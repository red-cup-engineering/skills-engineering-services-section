#!/usr/bin/env node
import { executeOllamaToolExchange, observeOllamaResource } from "../../src/ollama/ollama-exchange.mjs";

const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const model = process.env.OLLAMA_TOOL_MODEL ?? "llama3.2:3b";
const result = await executeOllamaToolExchange({
  baseUrl,
  model,
  messages: [{ role: "user", content: "Call resource_health exactly once for local-ollama, then report whether it is usable and name the resident models." }],
  tools: [{
    type: "function",
    function: {
      name: "resource_health",
      description: "Observe the addressable Ollama resource without changing it",
      parameters: { type: "object", properties: { resource: { type: "string", const: "local-ollama" } }, required: ["resource"] },
    },
  }],
  toolHandlers: {
    resource_health: async ({ resource }) => {
      if (resource !== "local-ollama") throw new Error("resource_health grant is limited to local-ollama");
      return observeOllamaResource({ baseUrl });
    },
  },
  maximumOutputTokens: 128,
  contextTokens: 2_048,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
