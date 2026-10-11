
import { schemaFrom } from "@red-cup-engineering/json-schema-services-section/contracts";
export * as chatCompletions from "./chat-completions/schema.mjs";
export * as embeddings from "./embeddings/schema.mjs";
export * as models from "./models/schema.mjs";
export * as responses from "./responses/schema.mjs";

const jsonValueSchema = {};

export const openaiModelSchema = {
  $id: "metroplat/codecs/text/json/openai/model",
  title: "OpenAIModel",
  description: "An OpenAI model read as a protocol boundary coordinate, not as ambient provider state.",
  type: "object",
  required: ["kind", "id", "surface", "tier"],
  properties: {
    kind: { const: "openai.model" },
    id: { type: "string", minLength: 1 },
    surface: { enum: ["responses", "chat-completions", "codex", "realtime"] },
    tier: { type: "string", minLength: 1 },
    realizes: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

export const openaiToolSchema = {
  $id: "metroplat/codecs/text/json/openai/tool",
  title: "OpenAITool",
  description: "Legacy flattened tool descriptor admitted at an OpenAI request boundary.",
  type: "object",
  required: ["kind", "type", "name"],
  properties: {
    kind: { const: "openai.tool" },
    type: { enum: ["function", "mcp"] },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    parameters: { type: "object", additionalProperties: {} },
  },
  additionalProperties: false,
};

export const openaiFunctionToolSchema = {
  $id: "metroplat/codecs/text/json/openai/function-tool",
  title: "OpenAIFunctionTool",
  description: "Current OpenAI function-tool wire descriptor with nested function metadata and JSON Schema parameters.",
  type: "object",
  required: ["kind", "type", "function"],
  properties: {
    kind: { const: "openai.function-tool" },
    type: { const: "function" },
    function: {
      type: "object",
      required: ["name", "parameters"],
      properties: {
        name: { type: "string", minLength: 1 },
        description: { type: "string" },
        parameters: { type: "object", additionalProperties: {} },
        strict: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const openaiMessageSchema = {
  $id: "metroplat/codecs/text/json/openai/message",
  title: "OpenAIMessage",
  description: "One message item in an OpenAI-compatible conversation boundary.",
  type: "object",
  required: ["kind", "role", "content"],
  properties: {
    kind: { const: "openai.message" },
    role: { enum: ["system", "developer", "user", "assistant", "tool"] },
    content: { type: ["string", "null"] },
    name: { type: "string", minLength: 1 },
    toolCallId: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

export const openaiToolCallSchema = {
  $id: "metroplat/codecs/text/json/openai/tool-call",
  title: "OpenAIToolCall",
  description: "A model-emitted request to invoke a named tool with JSON arguments.",
  type: "object",
  required: ["kind", "id", "name", "arguments"],
  properties: {
    kind: { const: "openai.tool-call" },
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    arguments: jsonValueSchema,
  },
  additionalProperties: false,
};

export const openaiResponseRequestSchema = {
  $id: "metroplat/codecs/text/json/openai/response-request",
  title: "OpenAIResponseRequest",
  description: "A Responses-style model request read as prompt, model, tools, and metadata boundary material.",
  type: "object",
  required: ["kind", "model", "input"],
  properties: {
    kind: { const: "openai.response-request" },
    model: { type: "string", minLength: 1 },
    input: { anyOf: [{ type: "string" }, { type: "array", items: openaiMessageSchema }] },
    instructions: { type: "string" },
    tools: { type: "array", items: { anyOf: [openaiToolSchema, openaiFunctionToolSchema] } },
    metadata: { type: "object", additionalProperties: {} },
  },
  additionalProperties: false,
};

export const openaiChatCompletionRequestSchema = {
  $id: "metroplat/codecs/text/json/openai/chat-completion-request",
  title: "OpenAIChatCompletionRequest",
  description: "The legacy Chat Completions wire face preserved as admitted OpenAI protocol material.",
  type: "object",
  required: ["kind", "model", "messages"],
  properties: {
    kind: { const: "openai.chat-completion-request" },
    model: { type: "string", minLength: 1 },
    messages: { type: "array", minItems: 1, items: openaiMessageSchema },
    tools: { type: "array", items: { anyOf: [openaiToolSchema, openaiFunctionToolSchema] } },
    responseFormat: { type: "string" },
    stream: { type: "boolean" },
  },
  additionalProperties: false,
};

export const openaiInferenceResultSchema = {
  $id: "metroplat/codecs/text/json/openai/inference-result",
  title: "OpenAIInferenceResult",
  description: "A model result with emitted text, tool calls, usage, and charge-bearing stop status.",
  type: "object",
  required: ["kind", "model", "status", "text", "toolCalls"],
  properties: {
    kind: { const: "openai.inference-result" },
    model: { type: "string", minLength: 1 },
    status: { enum: ["completed", "tool-calls", "incomplete", "refused", "errored"] },
    text: { type: ["string", "null"] },
    toolCalls: { type: "array", items: openaiToolCallSchema },
    usage: {
      type: "object",
      required: ["inputTokens", "outputTokens"],
      properties: {
        inputTokens: { type: "integer", minimum: 0 },
        outputTokens: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const openaiUsageCostSchema = {
  $id: "metroplat/codecs/text/json/openai/usage-cost",
  title: "OpenAIUsageCost",
  description: "A token and dollar cost observation over an OpenAI boundary request.",
  type: "object",
  required: ["kind", "operation", "model", "inputTokens", "outputTokens", "dollars", "at"],
  properties: {
    kind: { const: "openai.usage-cost" },
    operation: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    inputTokens: { type: "integer", minimum: 0 },
    outputTokens: { type: "integer", minimum: 0 },
    dollars: { type: "number", minimum: 0 },
    at: { type: "string", minLength: 1 },
    evidence: { type: "array", items: { type: "string", minLength: 1 } },
  },
  additionalProperties: false,
};

export const openaiModelContract = schemaFrom(openaiModelSchema);
export const openaiToolContract = schemaFrom(openaiToolSchema);
export const openaiFunctionToolContract = schemaFrom(openaiFunctionToolSchema);
export const openaiMessageContract = schemaFrom(openaiMessageSchema);
export const openaiToolCallContract = schemaFrom(openaiToolCallSchema);
export const openaiResponseRequestContract = schemaFrom(openaiResponseRequestSchema);
export const openaiChatCompletionRequestContract = schemaFrom(openaiChatCompletionRequestSchema);
export const openaiInferenceResultContract = schemaFrom(openaiInferenceResultSchema);
export const openaiUsageCostContract = schemaFrom(openaiUsageCostSchema);
