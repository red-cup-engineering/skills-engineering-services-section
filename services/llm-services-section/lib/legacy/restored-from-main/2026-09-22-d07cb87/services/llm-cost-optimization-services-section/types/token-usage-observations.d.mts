import type { TokenUsageCounts, TokenUsageBreakdown, TokenUsageCostEstimate, TokenUsageGenAiAttributes, TokenUsageCostRates, TokenUsageCostRateTable } from "./token-usage-core.d.mts";
import type { TokenUsagePersistenceRow } from "./token-usage-persistence.d.mts";

export interface AgentSessionTokenUsageCell {
  readonly key: string;
  readonly resourceKind: string;
  readonly unit: string;
  readonly agentId?: string;
  readonly provider: string;
  readonly surface: string;
  readonly sessionId?: string;
  readonly model?: string;
  readonly events: number;
  readonly turns: number;
  readonly pricedTurns: number;
  readonly unpricedTurns: number;
  readonly pricingCoverage?: number;
  readonly averageTokensPerTurn?: number;
  readonly averageInputTokensPerTurn?: number;
  readonly averageOutputTokensPerTurn?: number;
  readonly cacheHitRatio?: number;
  readonly cacheWriteRatio?: number;
  readonly reasoningOutputRatio?: number;
  readonly costMicrodollarsPerTurn?: number;
  readonly costDollarsPerTurn?: number;
  readonly rateLimitEvents: number;
  readonly duplicateEvents: number;
  readonly total: TokenUsageCounts;
  readonly usageBreakdown: TokenUsageBreakdown;
  readonly genAiAttributes: TokenUsageGenAiAttributes;
  readonly costEstimate?: TokenUsageCostEstimate;
}

export type AgentSessionTokenUsagePressureBand = "under" | "near" | "over";

export interface AgentSessionTokenUsageRateLimitPressure {
  readonly kind: "metroplat.agent-session.token-usage-rate-limit-pressure";
  readonly events: number;
  readonly maxUsedPercent: number;
  readonly pressure: number;
  readonly band: AgentSessionTokenUsagePressureBand;
  readonly windows: readonly string[];
  readonly evidence: readonly string[];
}

export interface AgentSessionTokenUsageReadout {
  readonly kind: "metroplat.agent-session.token-usage-settlement";
  readonly rows: number;
  readonly events: number;
  readonly uniqueEvents: number;
  readonly duplicateStatementEvents: number;
  readonly turns: number;
  readonly pricedTurns: number;
  readonly unpricedTurns: number;
  readonly pricingCoverage?: number;
  readonly averageTokensPerTurn?: number;
  readonly averageInputTokensPerTurn?: number;
  readonly averageOutputTokensPerTurn?: number;
  readonly cacheHitRatio?: number;
  readonly cacheWriteRatio?: number;
  readonly reasoningOutputRatio?: number;
  readonly costMicrodollarsPerTurn?: number;
  readonly costDollarsPerTurn?: number;
  readonly rateLimitEvents: number;
  readonly duplicateEvents: number;
  readonly total: TokenUsageCounts;
  readonly usageBreakdown: TokenUsageBreakdown;
  readonly genAiAttributes: TokenUsageGenAiAttributes;
  readonly costEstimate?: TokenUsageCostEstimate;
  readonly modelContextWindow?: number;
  readonly contextWindowPressure?: number;
  readonly contextWindowPressureBand?: AgentSessionTokenUsagePressureBand;
  readonly rateLimitPressure?: AgentSessionTokenUsageRateLimitPressure;
  readonly modelContextWindows: readonly number[];
  readonly byProvider: readonly AgentSessionTokenUsageCell[];
  readonly byResource: readonly AgentSessionTokenUsageCell[];
  readonly byUnit: readonly AgentSessionTokenUsageCell[];
  readonly byAgent: readonly AgentSessionTokenUsageCell[];
  readonly bySurface: readonly AgentSessionTokenUsageCell[];
  readonly bySession: readonly AgentSessionTokenUsageCell[];
  readonly byModel: readonly AgentSessionTokenUsageCell[];
  readonly models: readonly string[];
  readonly requests: readonly string[];
  readonly evidence: readonly string[];
}

export interface AgentSessionTokenUsageObservationOptions {
  readonly tokenCostRates?: TokenUsageCostRates;
  readonly tokenCostRateTable?: TokenUsageCostRateTable;
}

export interface AgentSessionTokenUsageObservationCollector {
  push(row: TokenUsagePersistenceRow): void;
  read(): AgentSessionTokenUsageReadout;
}
export function agentSessionTokenUsageObservationCollector(options?: AgentSessionTokenUsageObservationOptions): AgentSessionTokenUsageObservationCollector;
export function agentSessionTokenUsageObservationsOfRows(rows: Iterable<TokenUsagePersistenceRow>, options?: AgentSessionTokenUsageObservationOptions): AgentSessionTokenUsageReadout;
