import type { AnthropicMessageRequest, AnthropicMessageResponse, AnthropicMessageStreamEvent } from "./messages-schema.d.mts";

export * from "./messages-schema.d.mts";

export function anthropicMessageRequest(input: unknown): AnthropicMessageRequest;
export function anthropicMessageResponse(input: unknown): AnthropicMessageResponse;
export function anthropicMessageStreamEvent(input: unknown): AnthropicMessageStreamEvent;
export function anthropicMessageRequestToWireJson(input: unknown): string;
export function anthropicMessageRequestOfWireJson(text: string): AnthropicMessageRequest;
export function anthropicMessageResponseOfWireJson(text: string): AnthropicMessageResponse;
