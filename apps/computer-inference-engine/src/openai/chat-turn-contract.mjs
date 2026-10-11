/**
 * The admitted provider-neutral portion of one non-streaming OpenAI chat
 * completion request. Provider selection supplies the model and resource
 * bounds separately.
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
      items: {
        type: "object", required: ["role"],
        properties: {
          role: { enum: ["system", "developer", "user", "assistant", "tool"] },
          content: { type: ["string", "null"] },
          name: { type: "string", minLength: 1 },
          tool_call_id: { type: "string", minLength: 1 },
          tool_calls: {
            type: "array",
            items: {
              type: "object", required: ["id", "type", "function"],
              properties: {
                id: { type: "string", minLength: 1 },
                type: { const: "function" },
                function: {
                  type: "object", required: ["name", "arguments"],
                  properties: { name: { type: "string", minLength: 1 }, arguments: { type: "string" } },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    tools: {
      type: "array",
      items: {
        type: "object", required: ["type", "function"],
        properties: {
          type: { const: "function" },
          function: {
            type: "object", required: ["name"],
            properties: { name: { type: "string", minLength: 1 }, description: { type: "string" }, parameters: { type: "object" }, strict: { type: "boolean" } },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
    tool_choice: {
      anyOf: [
        { enum: ["auto", "none", "required"] },
        { type: "object", required: ["type", "function"], properties: { type: { const: "function" }, function: { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1 } }, additionalProperties: false } }, additionalProperties: false },
      ],
    },
    parallel_tool_calls: { type: "boolean" },
    response_format: { anyOf: [RESPONSE_FORMAT_NON_SCHEMA, RESPONSE_FORMAT_JSON_SCHEMA] },
    temperature: { type: "number" },
    top_p: { type: "number" },
    seed: { type: "integer" },
    stop: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
  },
  additionalProperties: false,
});
