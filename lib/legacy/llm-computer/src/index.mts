// @red-cup-engineering/llm-computer — the LLM domain's computing.
//
// Composes the algebra, codecs, and topology layers into the pure work of running
// an agentic loop, governing tools, converting MCP catalogs, and projecting cost
// into a ledger. Inference is injected (the `Infer` capability); nothing here opens
// a socket or reads a key.

export type {
  Infer, ToolHandler, GovernOptions,
  CostRates, AgentLoopOptions, McpToolDescriptor,
  AgentProvisions, CapabilityGrant, CapabilityGrants,
} from "./loop.mjs";
export {
  runAgentLoop, runGovernedToolCall, toolResultMessage, toolsFromMcpCatalog, defaultCapabilityOf,
} from "./loop.mjs";

export type { CostLedgerOptions, CostLedgerProjection } from "./cost-ledger.mjs";
export { costEventTransaction } from "./cost-ledger.mjs";
