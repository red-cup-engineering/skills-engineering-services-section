export {
  claudeCodeTerm,
  embodiesPredicate,
  runsPredicate,
  canonicalizeClaudeCodeAction,
  canonicalizeClaudeCodeTopologyAction,
  claudeCode,
  induceClaudeCodeTopology,
  extendClaudeCodeTopology,
  induceClaudeCodeInstanceTopology,
  actions,
} from "./claude-code-topology.mjs";

export type {
  ClaudeCodeInput,
  ClaudeCodeCarrier,
  ClaudeCodeTopologyCarrier,
  UtteranceCarrier,
} from "./claude-code-topology.mjs";

export * as cliHarness from "./cli-harness/index.mjs";
