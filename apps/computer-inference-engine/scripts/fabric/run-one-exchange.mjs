#!/usr/bin/env node
import { runChatExchangeCli } from "@red-cup-engineering/computer-inference-engine/openai/exchange-cli";

await runChatExchangeCli({
  entryUrl: import.meta.url,
  providerId: "openai",
  chatCompletionsUrl: "https://api.openai.com/v1/chat/completions",
  apiKeyEnvVars: ["OPENAI_API_KEY"],
  defaultModelEnvVar: "OPENAI_INFERENCE_DEFAULT_MODEL",
  schemaValidation: true,
  persistExchange: true,
});
