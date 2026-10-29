import type { TokenUsageSummary } from "@red-cup-engineering/llm-cost-optimization-services-section/token-usage/core";

export interface AnthropicTokenUsageReadOptions {
  readonly source?: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly at?: string;
}

export function anthropicMessageTokenUsage(messageInput: unknown, options?: AnthropicTokenUsageReadOptions): TokenUsageSummary;
export function anthropicMessageStreamTokenUsageOfContent(content: string, options?: AnthropicTokenUsageReadOptions): TokenUsageSummary;
export function claudeSessionTokenUsageOfContent(content: string, options?: AnthropicTokenUsageReadOptions): TokenUsageSummary;
