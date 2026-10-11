/**
 * Literal Anthropic Messages API wire contracts (non-streaming core).
 * Ported from MetroPlat's `src/integrations/anthropic/messages/schema.mts`,
 * the real Anthropic Messages API boundary this team owns directly.
 *
 * Validation here is hand-rolled rather than built on a JSON Schema
 * validator library, matching this section's own `run-one-exchange.mjs`
 * (see its `validatePacket`) rather than reaching for a schema-contract
 * package whose own dependency graph is a full MUD-engine kernel this
 * team's Messages-wire boundary has no use for.
 */

/** Reference JSON Schema for the request wire shape — documentation and
 *  introspection only; `anthropicMessageRequestContract` below does not
 *  execute it. */
export const anthropicMessageRequestSchema = Object.freeze({
  $id: "anthropic-inference-team/messages/request",
  type: "object",
  required: ["model", "max_tokens", "messages"],
  properties: {
    model: { type: "string", minLength: 1 },
    max_tokens: { type: "integer", minimum: 1 },
    messages: { type: "array" },
    system: {},
    tools: { type: "array" },
    temperature: { type: "number" },
    top_p: { type: "number" },
    stop_sequences: { type: "array", items: { type: "string" } },
    stream: { type: "boolean" },
  },
  additionalProperties: true,
});

/** Reference JSON Schema for the response wire shape — documentation only. */
export const anthropicMessageResponseSchema = Object.freeze({
  $id: "anthropic-inference-team/messages/response",
  type: "object",
  required: ["id", "type", "role", "content", "model", "usage"],
  properties: {
    id: { type: "string", minLength: 1 },
    type: { const: "message" },
    role: { const: "assistant" },
    content: { type: "array" },
    model: { type: "string", minLength: 1 },
    stop_reason: {},
    stop_sequence: { type: ["string", "null"] },
    usage: { type: "object" },
  },
  additionalProperties: true,
});

function fail(context, reason) {
  throw new TypeError(`${context}: ${reason}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isContentBlock(value) {
  return isObject(value) && typeof value.type === "string" && value.type.length > 0;
}

function isMessageInput(value) {
  if (!isObject(value)) return false;
  if (value.role !== "user" && value.role !== "assistant") return false;
  if (typeof value.content === "string") return true;
  return Array.isArray(value.content) && value.content.every(isContentBlock);
}

function isSystemField(value) {
  if (value === undefined) return true;
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every(isContentBlock);
}

function isToolField(value) {
  if (!isObject(value)) return false;
  return typeof value.name === "string" && value.name.length > 0
    && isObject(value.input_schema)
    && (value.description === undefined || typeof value.description === "string")
    && (value.strict === undefined || typeof value.strict === "boolean");
}

/** Validate and admit an Anthropic Messages request. Throws `TypeError` on
 *  any structural violation; returns a frozen shallow copy on success. */
export function anthropicMessageRequestContractAssert(input, context = "Anthropic Messages request") {
  if (!isObject(input)) fail(context, "must be an object");
  if (typeof input.model !== "string" || input.model.length === 0) fail(context, "model must be a non-empty string");
  if (!Number.isInteger(input.max_tokens) || input.max_tokens < 1) fail(context, "max_tokens must be a positive integer");
  if (!Array.isArray(input.messages) || !input.messages.every(isMessageInput)) fail(context, "messages must be an array of {role, content} entries");
  if (!isSystemField(input.system)) fail(context, "system, if present, must be a string or an array of content blocks");
  if (input.tools !== undefined && (!Array.isArray(input.tools) || !input.tools.every(isToolField))) fail(context, "tools, if present, must be an array of {name, input_schema} entries");
  if (input.temperature !== undefined && typeof input.temperature !== "number") fail(context, "temperature, if present, must be a number");
  if (input.top_p !== undefined && typeof input.top_p !== "number") fail(context, "top_p, if present, must be a number");
  if (input.stop_sequences !== undefined && (!Array.isArray(input.stop_sequences) || !input.stop_sequences.every((s) => typeof s === "string"))) fail(context, "stop_sequences, if present, must be an array of strings");
  if (input.stream !== undefined && typeof input.stream !== "boolean") fail(context, "stream, if present, must be a boolean");
  return Object.freeze({ ...input });
}

const STOP_REASONS = new Set(["end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal", "model_context_window_exceeded"]);

function isUsage(value) {
  return isObject(value) && Number.isInteger(value.input_tokens) && value.input_tokens >= 0
    && Number.isInteger(value.output_tokens) && value.output_tokens >= 0
    && (value.cache_creation_input_tokens === undefined || (Number.isInteger(value.cache_creation_input_tokens) && value.cache_creation_input_tokens >= 0))
    && (value.cache_read_input_tokens === undefined || (Number.isInteger(value.cache_read_input_tokens) && value.cache_read_input_tokens >= 0));
}

/** Validate and admit an Anthropic Messages response. Throws `TypeError` on
 *  any structural violation; returns a frozen shallow copy on success. */
export function anthropicMessageResponseMaterial(input, context = "Anthropic Messages response material") {
  if (!isObject(input)) fail(context, "must be an object");
  if (typeof input.id !== "string" || input.id.length === 0) fail(context, "id must be a non-empty string");
  if (input.type !== "message") fail(context, "type must be \"message\"");
  if (input.role !== "assistant") fail(context, "role must be \"assistant\"");
  if (!Array.isArray(input.content) || !input.content.every(isContentBlock)) fail(context, "content must be an array of typed blocks");
  if (typeof input.model !== "string" || input.model.length === 0) fail(context, "model must be a non-empty string");
  if (input.stop_reason !== null && input.stop_reason !== undefined && !STOP_REASONS.has(input.stop_reason)) fail(context, "stop_reason, if present, must be a known Anthropic stop reason or null");
  if (input.stop_sequence !== undefined && input.stop_sequence !== null && typeof input.stop_sequence !== "string") fail(context, "stop_sequence, if present, must be a string or null");
  return Object.freeze({ ...input });
}

/** Literal Anthropic wire validation remains strict about required usage counts. */
export function anthropicMessageResponseContractAssert(input, context = "Anthropic Messages response") {
  const response = anthropicMessageResponseMaterial(input, context);
  if (!isUsage(response.usage)) fail(context, "usage must carry input_tokens and output_tokens as nonnegative integers");
  return response;
}

/** Thin `{assert}`-shaped wrappers, kept for call-site parity with the
 *  contract objects the ported source used. */
export const anthropicMessageRequestContract = Object.freeze({ assert: anthropicMessageRequestContractAssert });
export const anthropicMessageResponseContract = Object.freeze({ assert: anthropicMessageResponseContractAssert });
