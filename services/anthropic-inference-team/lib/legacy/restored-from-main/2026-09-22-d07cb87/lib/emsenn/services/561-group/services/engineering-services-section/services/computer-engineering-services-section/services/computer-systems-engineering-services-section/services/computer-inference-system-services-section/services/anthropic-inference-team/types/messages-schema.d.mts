export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonRecord = { readonly [key: string]: JsonValue };

export type AnthropicTextBlock = Readonly<{ type: "text"; text: string; [key: string]: JsonValue }>;
export type AnthropicToolUseBlock = Readonly<{ type: "tool_use"; id: string; name: string; input: JsonValue; [key: string]: JsonValue }>;
export type AnthropicToolResultBlock = Readonly<{ type: "tool_result"; tool_use_id: string; content?: string | readonly AnthropicTextBlock[]; is_error?: boolean; [key: string]: JsonValue }>;
export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock | Readonly<{ type: string; [key: string]: JsonValue }>;
export interface AnthropicMessageInput { readonly role: "user" | "assistant"; readonly content: string | readonly AnthropicContentBlock[]; }
export interface AnthropicTool { readonly name: string; readonly description?: string; readonly input_schema: JsonRecord; readonly strict?: boolean; }
export interface AnthropicMessageRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly messages: readonly AnthropicMessageInput[];
  readonly system?: string | readonly AnthropicTextBlock[];
  readonly tools?: readonly AnthropicTool[];
  readonly temperature?: number;
  readonly top_p?: number;
  readonly stop_sequences?: readonly string[];
  readonly stream?: boolean;
}
export interface AnthropicUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}
export interface AnthropicMessageResponse {
  readonly id: string;
  readonly type: "message";
  readonly role: "assistant";
  readonly content: readonly AnthropicContentBlock[];
  readonly model: string;
  readonly stop_reason?: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "pause_turn" | "refusal" | "model_context_window_exceeded" | null;
  readonly stop_sequence?: string | null;
  readonly usage: AnthropicUsage;
}
export type AnthropicMessageStreamEvent = JsonRecord & Readonly<{ type: string }>;

/** A `@red-cup-engineering/computer-system-engine/contracts` JSON Schema contract. */
export interface Contract<T> {
  assert(value: unknown, context?: string): T;
  readonly [key: string]: unknown;
}

export const anthropicMessageRequestSchema: Readonly<Record<string, unknown>>;
export const anthropicMessageResponseSchema: Readonly<Record<string, unknown>>;
export const anthropicMessageRequestContract: Contract<AnthropicMessageRequest>;
export const anthropicMessageResponseContract: Contract<AnthropicMessageResponse>;
