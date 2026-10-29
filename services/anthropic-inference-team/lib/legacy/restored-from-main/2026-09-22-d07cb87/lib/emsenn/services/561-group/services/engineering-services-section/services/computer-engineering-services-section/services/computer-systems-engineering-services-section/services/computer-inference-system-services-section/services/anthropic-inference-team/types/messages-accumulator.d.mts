import type { AnthropicMessageResponse, AnthropicMessageStreamEvent } from "./messages-schema.d.mts";

export interface AnthropicMessageStreamAccumulator {
  push(event: AnthropicMessageStreamEvent): void;
  read(): AnthropicMessageResponse;
}

export function anthropicMessageStreamAccumulator(): AnthropicMessageStreamAccumulator;
