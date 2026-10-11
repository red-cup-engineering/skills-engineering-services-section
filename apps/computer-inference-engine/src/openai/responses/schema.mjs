/**
 * integrations/openai/responses/schema — JSON schemas for the
 * literal `/responses` wire shapes: OpenAI's current primary inference
 * surface, distinct from `/chat/completions` (flat `tools[]` with no nested
 * `function` object, an `output[]` array of typed items instead of
 * `choices[].message`, `input_tokens`/`output_tokens` instead of
 * `prompt_tokens`/`completion_tokens`, and `text.format` instead of
 * `response_format`).
 */

import { schemaFrom } from "@red-cup-engineering/json-schema-services-section/contracts";

const roleSchema = { enum: ["system", "developer", "user", "assistant"] };

export const openaiResponseInputTextPartSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/input-text-part",
  title: "OpenAIResponseInputTextPart",
  description: "One text content part of a /responses input message.",
  type: "object",
  required: ["type", "text"],
  properties: {
    type: { enum: ["input_text", "output_text"] },
    text: { type: "string" },
  },
  additionalProperties: true,
};

export const openaiResponseInputMessageSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/input-message",
  title: "OpenAIResponseInputMessage",
  description: "One /responses input message: a role and text content (a bare string or content parts).",
  type: "object",
  required: ["role", "content"],
  properties: {
    role: roleSchema,
    content: { anyOf: [{ type: "string" }, { type: "array", items: openaiResponseInputTextPartSchema }] },
  },
  additionalProperties: true,
};

export const openaiResponseFunctionCallOutputSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/function-call-output",
  title: "OpenAIResponseFunctionCallOutput",
  description: "An input item feeding a prior function call's result back to the model.",
  type: "object",
  required: ["type", "call_id", "output"],
  properties: {
    type: { const: "function_call_output" },
    call_id: { type: "string", minLength: 1 },
    output: { type: "string" },
  },
  additionalProperties: true,
};

export const openaiResponseInputItemSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/input-item",
  title: "OpenAIResponseInputItem",
  description: "One /responses input array entry: a role message or a function-call-output.",
  anyOf: [openaiResponseInputMessageSchema, openaiResponseFunctionCallOutputSchema],
};

export const openaiResponseFunctionToolSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/function-tool",
  title: "OpenAIResponseFunctionTool",
  description: "A /responses tool descriptor: flat (name/parameters directly on the tool), unlike the nested chat-completions shape.",
  type: "object",
  required: ["type", "name"],
  properties: {
    type: { const: "function" },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    parameters: { type: "object", additionalProperties: true },
    strict: { type: "boolean" },
  },
  additionalProperties: true,
};

export const openaiResponseTextFormatSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/text-format",
  title: "OpenAIResponseTextFormat",
  description: "The `text.format` request field: /responses' response_format equivalent.",
  type: "object",
  required: ["type"],
  properties: {
    type: { enum: ["text", "json_object", "json_schema"] },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    strict: { type: "boolean" },
    schema: { type: "object", additionalProperties: true },
  },
  additionalProperties: true,
};

export const openaiResponseRequestWireSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/request",
  title: "OpenAIResponseWireRequest",
  description: "The literal `/responses` request body.",
  type: "object",
  required: ["model", "input"],
  properties: {
    model: { type: "string", minLength: 1 },
    input: { anyOf: [{ type: "string" }, { type: "array", items: openaiResponseInputItemSchema }] },
    instructions: { type: "string" },
    tools: { type: "array", items: openaiResponseFunctionToolSchema },
    tool_choice: {},
    text: { type: "object", properties: { format: openaiResponseTextFormatSchema }, additionalProperties: true },
    max_output_tokens: { type: "integer", minimum: 0 },
    temperature: { type: "number" },
    top_p: { type: "number" },
    stream: { type: "boolean" },
  },
  additionalProperties: true,
};

export const openaiResponseOutputTextPartSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/output-text-part",
  title: "OpenAIResponseOutputTextPart",
  description: "One output_text content part of a /responses message output item.",
  type: "object",
  required: ["type", "text"],
  properties: {
    type: { const: "output_text" },
    text: { type: "string" },
    annotations: { type: "array", items: {} },
  },
  additionalProperties: true,
};

export const openaiResponseMessageOutputSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/message-output",
  title: "OpenAIResponseMessageOutput",
  description: "A `type: message` /responses output item.",
  type: "object",
  required: ["type", "role", "content"],
  properties: {
    type: { const: "message" },
    id: { type: "string" },
    status: { type: "string" },
    role: { const: "assistant" },
    content: { type: "array", items: openaiResponseOutputTextPartSchema },
  },
  additionalProperties: true,
};

export const openaiResponseFunctionCallOutputItemSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/function-call-output-item",
  title: "OpenAIResponseFunctionCallOutputItem",
  description: "A `type: function_call` /responses output item: a model-emitted tool call.",
  type: "object",
  required: ["type", "call_id", "name", "arguments"],
  properties: {
    type: { const: "function_call" },
    id: { type: "string" },
    call_id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    arguments: { type: "string" },
    status: { type: "string" },
  },
  additionalProperties: true,
};

export const openaiResponseOutputItemSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/output-item",
  title: "OpenAIResponseOutputItem",
  description: "One /responses `output[]` entry: a message or a function call.",
  anyOf: [openaiResponseMessageOutputSchema, openaiResponseFunctionCallOutputItemSchema],
};

const responseUsageDetailsSchema = { type: "object", additionalProperties: true };

export const openaiResponseUsageSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/usage",
  title: "OpenAIResponseUsage",
  description: "The /responses `usage` object: input/output/total token counts.",
  type: "object",
  required: ["input_tokens", "output_tokens", "total_tokens"],
  properties: {
    input_tokens: { type: "integer", minimum: 0 },
    output_tokens: { type: "integer", minimum: 0 },
    total_tokens: { type: "integer", minimum: 0 },
    input_tokens_details: { anyOf: [responseUsageDetailsSchema, { type: "null" }] },
    output_tokens_details: { anyOf: [responseUsageDetailsSchema, { type: "null" }] },
  },
  additionalProperties: true,
};

export const openaiResponseWireSchema = {
  $id: "metroplat/codecs/text/json/openai/responses/response",
  title: "OpenAIResponseWire",
  description: "The literal non-streaming `/responses` response body.",
  type: "object",
  required: ["id", "object", "created_at", "model", "output"],
  properties: {
    id: { type: "string", minLength: 1 },
    object: { const: "response" },
    created_at: { type: "integer", minimum: 0 },
    model: { type: "string", minLength: 1 },
    status: { type: "string" },
    output: { type: "array", items: openaiResponseOutputItemSchema },
    usage: { anyOf: [openaiResponseUsageSchema, { type: "null" }] },
  },
  additionalProperties: true,
};

export const openaiResponseInputTextPartContract = schemaFrom(openaiResponseInputTextPartSchema);
export const openaiResponseInputMessageContract = schemaFrom(openaiResponseInputMessageSchema);
export const openaiResponseFunctionCallOutputContract = schemaFrom(openaiResponseFunctionCallOutputSchema);
export const openaiResponseFunctionToolContract = schemaFrom(openaiResponseFunctionToolSchema);
export const openaiResponseTextFormatContract = schemaFrom(openaiResponseTextFormatSchema);
export const openaiResponseRequestWireContract = schemaFrom(openaiResponseRequestWireSchema);
export const openaiResponseMessageOutputContract = schemaFrom(openaiResponseMessageOutputSchema);
export const openaiResponseFunctionCallOutputItemContract = schemaFrom(openaiResponseFunctionCallOutputItemSchema);
export const openaiResponseUsageContract = schemaFrom(openaiResponseUsageSchema);
export const openaiResponseWireContract = schemaFrom(openaiResponseWireSchema);
