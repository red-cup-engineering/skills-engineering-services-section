import { openaiChatMessageSchema, openaiChatFunctionToolSchema } from "./chat-completions/schema.mjs";

/**
 * The admitted data carrier of one non-streaming OpenAI-compatible chat
 * completion request. Provider selection supplies the model and resource
 * bounds separately. Optional reasoning controls have supplier/model-specific
 * meanings; admission does not assert that every supplier supports them.
 * Sources: https://console.groq.com/docs/api-reference and
 * https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-ultra-550b-a55b-infer
 * https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-ultra-550b-a55b
 * @type {object}
 */
const RESPONSE_FORMAT_PROPERTIES = Object.freeze({
  type: { enum: ["text", "json_object", "json_schema"] },
  json_schema: {
    type: "object", required: ["name", "schema"],
    properties: { name: { type: "string", minLength: 1 }, description: { type: "string" }, strict: { type: "boolean" }, schema: { type: "object", additionalProperties: true } },
    additionalProperties: false,
  },
});

const RESPONSE_FORMAT_NON_SCHEMA = Object.freeze({
  type: "object", required: ["type"],
  properties: { ...RESPONSE_FORMAT_PROPERTIES, type: { enum: ["text", "json_object"] } },
  additionalProperties: false,
});

const RESPONSE_FORMAT_JSON_SCHEMA = Object.freeze({
  type: "object", required: ["type", "json_schema"],
  properties: { ...RESPONSE_FORMAT_PROPERTIES, type: { const: "json_schema" } },
  additionalProperties: false,
});

export const CHAT_COMPLETION_TURN_INPUT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:red-cup-engineering:schema:chat-completion-turn-input:1",
  type: "object",
  required: ["messages"],
  properties: {
    messages: {
      type: "array", minItems: 1,
      items: openaiChatMessageSchema,
    },
    tools: { type: "array", items: openaiChatFunctionToolSchema },
    tool_choice: {
      anyOf: [
        { enum: ["auto", "none", "required"] },
        { type: "object", required: ["type", "function"], properties: { type: { const: "function" }, function: { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1 } }, additionalProperties: false } }, additionalProperties: false },
      ],
    },
    parallel_tool_calls: { type: "boolean" },
    response_format: { anyOf: [RESPONSE_FORMAT_NON_SCHEMA, RESPONSE_FORMAT_JSON_SCHEMA] },
    reasoning_effort: { enum: ["none", "default", "minimal", "low", "medium", "high", "xhigh", "max"] },
    reasoning_budget: { type: "integer", minimum: 0 },
    chat_template_kwargs: {
      type: "object", additionalProperties: false,
      properties: {
        enable_thinking: { type: "boolean" },
        medium_effort: { type: "boolean" },
        force_nonempty_content: { type: "boolean" },
      },
    },
    temperature: { type: "number" },
    top_p: { type: "number" },
    seed: { type: "integer" },
    stop: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
  },
  additionalProperties: false,
});
