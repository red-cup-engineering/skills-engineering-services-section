import type { AnthropicMessageRequest, AnthropicMessageStreamEvent } from "./messages-schema.d.mts";

export const ANTHROPIC_API_KEY_ENV: "ANTHROPIC_API_KEY";
export const ANTHROPIC_BASE_URL_ENV: "ANTHROPIC_BASE_URL";
export const ANTHROPIC_VERSION: string;

export type AnthropicMessagesStreamEvent =
  | Readonly<{ kind: "anthropic.messages.stream.event"; event: AnthropicMessageStreamEvent }>
  | Readonly<{ kind: "anthropic.messages.stream.failure"; condition: "missing-api-key" | "unreachable" | "cancelled" | "unauthorized" | "rate-limited" | "malformed" | "rejected" | "truncated"; reason: string }>;

export interface AnthropicMessagesClientOptions {
  readonly fetch?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal;
  readonly idempotencyKey?: string;
  readonly version?: string;
}

export function streamAnthropicMessage(
  request: Omit<AnthropicMessageRequest, "stream">,
  options?: AnthropicMessagesClientOptions,
): AsyncIterable<AnthropicMessagesStreamEvent>;
