// @emsenn/organizing-with-llm-agents/codecs/anthropic — the Anthropic Messages wire codec.
//
// Zero runtime dependencies beyond the carrier it decodes into. Pure functions: an
// InferenceRequest encodes to the Messages request body (the system prompt is
// hoisted to a top-level field and max_tokens is mandatory), and a decoded response
// reads its content blocks back to text and token usage. Authentication, the
// request target, and fetching are the holography layer's business.

import type {
  InferenceRequest,
  JsonObject,
  JsonValue,
  TokenUsage,
} from "../../algebra/index.mjs";

const DEFAULT_MAX_TOKENS = 4096;

/**
 * The decoded form of an Anthropic Messages response: the first text content
 * block as `text`, and `usage` token counts when the response carries them.
 */
export type DecodedResponse = Readonly<{
  text: string;
  usage?: TokenUsage;
}>;

/** Encode an organizing-with-llm-agents algebra request into the Anthropic Messages request body. */
export function encodeRequestBody(request: InferenceRequest): JsonObject {
  const messages = request.messages.map((m) => ({ role: m.role, content: m.content }));
  const body: Record<string, JsonValue> = {
    model: request.model,
    messages: messages as unknown as JsonValue,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: request.temperature ?? 0,
  };
  if (request.system !== undefined) body["system"] = request.system;
  if (request.extraBody !== undefined) Object.assign(body, request.extraBody);
  return body;
}

/** Decode an Anthropic response into text and usage. */
export function decodeResponse(raw: unknown): DecodedResponse {
  const text = decodeText(raw);
  const usage = decodeUsage(raw);
  return {
    text,
    ...(usage === undefined ? {} : { usage }),
  };
}

/** Read the first text content block of an Anthropic response. */
export function decodeText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const record = raw as { readonly content?: readonly { readonly type?: string; readonly text?: unknown }[] };
  const first = record.content?.find((c) => c.type === "text");
  return typeof first?.text === "string" ? first.text : "";
}

/**
 * Read the token usage from an Anthropic response: returns a TokenUsage with
 * `input` and `output` from `usage.input_tokens` / `usage.output_tokens`,
 * omitting either field that is missing or non-finite, and undefined when
 * neither is present.
 */
export function decodeUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = (raw as { readonly usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as { readonly input_tokens?: unknown; readonly output_tokens?: unknown };
  const input = finiteOrUndefined(record.input_tokens);
  const output = finiteOrUndefined(record.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
  };
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
