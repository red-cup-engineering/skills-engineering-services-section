/**
 * integrations/openai/chat-completions/schema — JSON schemas for
 * the literal `/chat/completions` wire shapes (snake_case, as sent and
 * received over HTTP), distinct from the abstracted camelCase protocol
 * material carried by `integrations/openai/schemas`. A client that
 * speaks to a real OpenAI-compatible host encodes/decodes THIS shape.
 */

import { schemaFrom } from "@red-cup-engineering/json-schema-services-section/contracts";

const jsonValueSchema = {};
const roleSchema = { enum: ["system", "developer", "user", "assistant", "tool"] };
const finishReasonSchema = { enum: ["stop", "length", "tool_calls", "content_filter", "function_call"] };

export const openaiChatToolCallSchema = {
  $id: "metroplat/codecs/text/json/openai/chat-completions/tool-call",
  title: "OpenAIChatWireToolCall",
  description: "One model-emitted tool_calls entry: a function name and its JSON-encoded argument string, exactly as OpenAI transports it.",
  type: "object",
  required: ["id", "type", "function"],
  properties: {
    id: { type: "string", minLength: 1 },
    type: { const: "function" },
    function: {
      type: "object",
      required: ["name", "arguments"],
      properties: {
        name: { type: "string", minLength: 1 },
        arguments: { type: "string" },
      },
      additionalProperties: false,
    },
    extra_content: {
      type: "object",
      additionalProperties: true,
    },
  },
  additionalProperties: false,
};

export const openaiChatMessageSchema = {
  $id: "metroplat/codecs/text/json/openai/chat-completions/message",
  title: "OpenAIChatWireMessage",
  description: "One `/chat/completions` message: role, text content (null for a tool-calling assistant turn on OpenAI itself; OMITTED entirely for the same case on live NVIDIA NIM — verified 2026-07-04 against a real endpoint, so `content` is not required), and optional name/tool_call_id/tool_calls. `additionalProperties: true` because live hosts (observed on NVIDIA NIM/vLLM) emit further assistant-turn fields explicitly as null rather than omitting them: refusal, annotations, audio, function_call, reasoning, reasoning_content.",
  type: "object",
  required: ["role"],
  properties: {
    role: roleSchema,
    content: { type: ["string", "null"] },
    name: { type: "string", minLength: 1 },
    tool_call_id: { type: "string", minLength: 1 },
    tool_calls: { type: "array", items: openaiChatToolCallSchema },
  },
  additionalProperties: true,
};

export const openaiChatFunctionToolSchema = {
  $id: "metroplat/codecs/text/json/openai/chat-completions/function-tool",
  title: "OpenAIChatWireFunctionTool",
  description: "One `tools[]` entry offered to the model: a named function with a JSON-Schema parameter shape.",
  type: "object",
  required: ["type", "function"],
  properties: {
    type: { const: "function" },
    function: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        description: { type: "string" },
        parameters: { type: "object", additionalProperties: true },
        strict: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const openaiResponseFormatSchema = {
  $id: "metroplat/codecs/text/json/openai/chat-completions/response-format",
  title: "OpenAIChatWireResponseFormat",
  description: "The `response_format` request field: free text, a bare JSON object, or a named/strict JSON Schema the completion must satisfy.",
  type: "object",
  required: ["type"],
  properties: {
    type: { enum: ["text", "json_object", "json_schema"] },
    json_schema: {
      type: "object",
      required: ["name", "schema"],
      properties: {
        name: { type: "string", minLength: 1 },
        description: { type: "string" },
        strict: { type: "boolean" },
        schema: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const openaiChatCompletionRequestSchema = {
  $id: "metroplat/codecs/text/json/openai/chat-completions/request",
  title: "OpenAIChatWireCompletionRequest",
  description: "The literal `/chat/completions` request body. `additionalProperties: true` so a host's own extensions (e.g. NVIDIA NIM sampling knobs) pass through unmodified.",
  type: "object",
  required: ["model", "messages"],
  properties: {
    model: { type: "string", minLength: 1 },
    messages: { type: "array", minItems: 1, items: openaiChatMessageSchema },
    temperature: { type: "number" },
    top_p: { type: "number" },
    max_tokens: { type: "integer", minimum: 0 },
    max_completion_tokens: { type: "integer", minimum: 0 },
    n: { type: "integer", minimum: 1 },
    stop: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
    presence_penalty: { type: "number" },
    frequency_penalty: { type: "number" },
    seed: { type: "integer" },
    tools: { type: "array", items: openaiChatFunctionToolSchema },
    tool_choice: jsonValueSchema,
    response_format: openaiResponseFormatSchema,
    stream: { type: "boolean" },
    stream_options: { type: "object", additionalProperties: true },
    user: { type: "string" },
  },
  additionalProperties: true,
};

const usageDetailsSchema = { type: "object", additionalProperties: true };

export const openaiUsageWireSchema = {
  $id: "metroplat/codecs/text/json/openai/chat-completions/usage",
  title: "OpenAIChatWireUsage",
  description: "The response `usage` object: prompt/completion/total token counts, with optional per-vendor nested detail breakdowns.",
  type: "object",
  required: ["prompt_tokens", "completion_tokens", "total_tokens"],
  properties: {
    prompt_tokens: { type: "integer", minimum: 0 },
    completion_tokens: { type: "integer", minimum: 0 },
    total_tokens: { type: "integer", minimum: 0 },
    prompt_tokens_details: { anyOf: [usageDetailsSchema, { type: "null" }] },
    completion_tokens_details: { anyOf: [usageDetailsSchema, { type: "null" }] },
  },
  additionalProperties: true,
};

export const openaiChatCompletionSchema = {
  $id: "metroplat/codecs/text/json/openai/chat-completions/completion",
  title: "OpenAIChatWireCompletion",
  description: "The literal non-streaming `/chat/completions` response body.",
  type: "object",
  required: ["id", "object", "created", "model", "choices"],
  properties: {
    id: { type: "string", minLength: 1 },
    object: { const: "chat.completion" },
    created: { type: "integer", minimum: 0 },
    model: { type: "string", minLength: 1 },
    choices: {
      type: "array",
      items: {
        type: "object",
        required: ["index", "message", "finish_reason"],
        properties: {
          index: { type: "integer", minimum: 0 },
          message: openaiChatMessageSchema,
          finish_reason: { anyOf: [finishReasonSchema, { type: "null" }] },
          logprobs: jsonValueSchema,
        },
        additionalProperties: true,
      },
    },
    usage: openaiUsageWireSchema,
    system_fingerprint: { type: ["string", "null"] },
  },
  additionalProperties: true,
};

export const openaiChatCompletionChunkSchema = {
  $id: "metroplat/codecs/text/json/openai/chat-completions/chunk",
  title: "OpenAIChatWireCompletionChunk",
  description: "One `text/event-stream` `data:` payload of a streamed `/chat/completions` reply, decoded through the package SSE codec.",
  type: "object",
  required: ["id", "object", "created", "model", "choices"],
  properties: {
    id: { type: "string", minLength: 1 },
    object: { const: "chat.completion.chunk" },
    created: { type: "integer", minimum: 0 },
    model: { type: "string", minLength: 1 },
    choices: {
      type: "array",
      items: {
        type: "object",
        required: ["index", "delta"],
        properties: {
          index: { type: "integer", minimum: 0 },
          delta: {
            type: "object",
            properties: {
              role: roleSchema,
              content: { type: ["string", "null"] },
              tool_calls: {
                type: "array",
                items: {
                  type: "object",
                  required: ["index"],
                  properties: {
                    index: { type: "integer", minimum: 0 },
                    id: { type: "string" },
                    type: { const: "function" },
                    function: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        arguments: { type: "string" },
                      },
                      additionalProperties: false,
                    },
                    extra_content: { type: "object", additionalProperties: true },
                  },
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: true,
          },
          finish_reason: { anyOf: [finishReasonSchema, { type: "null" }] },
        },
        additionalProperties: true,
      },
    },
    usage: { anyOf: [openaiUsageWireSchema, { type: "null" }] },
  },
  additionalProperties: true,
};

export const openaiChatToolCallContract = schemaFrom(openaiChatToolCallSchema);
export const openaiChatMessageContract = schemaFrom(openaiChatMessageSchema);
export const openaiChatFunctionToolContract = schemaFrom(openaiChatFunctionToolSchema);
export const openaiResponseFormatContract = schemaFrom(openaiResponseFormatSchema);
export const openaiUsageWireContract = schemaFrom(openaiUsageWireSchema);
export const openaiChatCompletionRequestContract = schemaFrom(openaiChatCompletionRequestSchema);
export const openaiChatCompletionContract = schemaFrom(openaiChatCompletionSchema);
export const openaiChatCompletionChunkContract = schemaFrom(openaiChatCompletionChunkSchema);
