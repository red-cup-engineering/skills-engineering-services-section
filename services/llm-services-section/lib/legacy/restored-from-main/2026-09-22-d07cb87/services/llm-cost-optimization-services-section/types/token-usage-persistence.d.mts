import type { JsonValue, TokenUsageEvent, TokenUsageSummary } from "./token-usage-core.d.mts";

export const agentSessionTokenUsageFeed: Readonly<{
  readonly kind: "metroplat.agent-session.token-usage-feed";
  readonly name: "agent-session-token-usage";
}>;

/** A plain `[e, a, v, t]` statement row; the same shape `@red-cup-engineering/eavt` carries. */
export type TokenUsagePersistenceRow = readonly [JsonValue, JsonValue, JsonValue, JsonValue];

export function agentSessionTokenUsageStatementRows(
  summary: TokenUsageSummary,
  at: JsonValue,
): readonly TokenUsagePersistenceRow[];

export type { TokenUsageEvent, TokenUsageSummary };
