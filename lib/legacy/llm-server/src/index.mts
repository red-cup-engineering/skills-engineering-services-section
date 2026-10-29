// @red-cup-engineering/llm-server — apps/llm-computer bound to transports.
//
// The OpenAI-compatible chat-completions service, plus library re-exports of the
// pure computing (llm-computer) and the inference host projection (@red-cup-engineering/organizing-with-llm-agents/holography)
// so downstream callers depend on this single service package for the domain.

export type {
  LlmServerOptions, OpenAiChatRequest, OpenAiMessage,
} from "./service.mjs";
export {
  createLlmServerApp, inferFromHolography, requestFromOpenAi, completionFromRun,
} from "./service.mjs";

// library re-exports (the computing this service binds)
export { runAgentLoop, runGovernedToolCall, toolsFromMcpCatalog, costEventTransaction } from "@red-cup-engineering/llm-computer";
export { witnessInference, endpointProjection, resolveApiKey, projectApiKey } from "@red-cup-engineering/organizing-with-llm-agents/holography";
