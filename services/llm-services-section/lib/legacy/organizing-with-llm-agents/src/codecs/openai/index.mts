// @emsenn/organizing-with-llm-agents/codecs/openai — the OpenAI chat-completions wire codec.
//
// Zero runtime dependencies beyond the carrier it decodes into. Pure functions: an
// InferenceRequest encodes to the request-body record, and a decoded response body
// reads back to text, tool calls, and token usage. Authentication, the request
// target, and fetching are the holography layer's business.

import type {
  Conversation,
  InferenceRequest,
  JsonObject,
  JsonValue,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from "../../algebra/index.mjs";
import { jsonResource } from "@emsenn/relating/writing";

/**
 * The decoded result of an OpenAI response body: the assistant text, any tool
 * calls the model requested, and token usage. toolCalls and usage are omitted
 * when absent.
 */
export type DecodedResponse = Readonly<{
  text: string;
  toolCalls?: readonly ToolCall[];
  usage?: TokenUsage;
}>;

/** Encode an organizing-with-llm-agents algebra request into the OpenAI chat-completions request body. */
export function encodeRequestBody(request: InferenceRequest): JsonObject {
  const messages = withSystem(request.messages, request.system).map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.name === undefined ? {} : { name: m.name }),
    ...(m.toolCallId === undefined ? {} : { tool_call_id: m.toolCallId }),
  }));
  const body: Record<string, JsonValue> = {
    model: request.model,
    messages: messages as unknown as JsonValue,
    temperature: request.temperature ?? 0,
  };
  if (request.maxTokens !== undefined) body["max_tokens"] = request.maxTokens;
  if (request.tools !== undefined && request.tools.length > 0) {
    body["tools"] = request.tools.map(encodeTool) as unknown as JsonValue;
  }
  if (request.extraBody !== undefined) Object.assign(body, request.extraBody);
  return body;
}

function withSystem(messages: Conversation, system: string | undefined): Conversation {
  return system === undefined ? messages : [{ role: "system", content: system }, ...messages];
}

function encodeTool(tool: ToolDefinition): JsonObject {
  return jsonResource({
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      ...(tool.parameters === undefined ? {} : { parameters: tool.parameters }),
    },
  }, "openai tool definition") as JsonObject;
}

/** Decode an OpenAI response body into text, tool calls, and usage. */
export function decodeResponse(raw: unknown): DecodedResponse {
  const text = decodeText(raw);
  const toolCalls = decodeToolCalls(raw);
  const usage = decodeUsage(raw);
  return {
    text,
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
    ...(usage === undefined ? {} : { usage }),
  };
}

/** Read just the assistant text, tolerant of the chat/completion/responses shapes. */
export function decodeText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const record = raw as {
    readonly choices?: readonly {
      readonly message?: { readonly content?: unknown };
      readonly text?: unknown;
    }[];
    readonly output_text?: unknown;
  };
  const choice = record.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? record.output_text;
  return typeof content === "string" ? content : "";
}

/**
 * Read the tool calls from the first choice of an OpenAI response body. Returns
 * one ToolCall per well-formed function entry, carrying its id when present and
 * its parsed arguments; skips entries without a string name.
 */
export function decodeToolCalls(raw: unknown): readonly ToolCall[] {
  if (!raw || typeof raw !== "object") return [];
  const choice = (raw as { readonly choices?: readonly { readonly message?: { readonly tool_calls?: unknown } }[] }).choices?.[0];
  const calls = choice?.message?.tool_calls;
  if (!Array.isArray(calls)) return [];
  const decoded: ToolCall[] = [];
  for (const entry of calls) {
    if (!entry || typeof entry !== "object") continue;
    const fn = (entry as { readonly function?: { readonly name?: unknown; readonly arguments?: unknown } }).function;
    const name = fn?.name;
    if (typeof name !== "string") continue;
    const id = (entry as { readonly id?: unknown }).id;
    decoded.push({
      ...(typeof id === "string" ? { id } : {}),
      name,
      arguments: parseArguments(fn?.arguments),
    });
  }
  return decoded;
}

/**
 * Read token usage from an OpenAI response body, mapping prompt_tokens to input
 * and completion_tokens to output. Returns undefined when neither finite count
 * is present.
 */
export function decodeUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = (raw as { readonly usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as { readonly prompt_tokens?: unknown; readonly completion_tokens?: unknown };
  const input = finiteOrUndefined(record.prompt_tokens);
  const output = finiteOrUndefined(record.completion_tokens);
  if (input === undefined && output === undefined) return undefined;
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
  };
}

/** Tool arguments arrive as a JSON string; decode opportunistically, keeping the raw text when malformed. */
function parseArguments(value: unknown): JsonValue {
  if (typeof value !== "string") return (value ?? null) as JsonValue;
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return value;
  }
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
