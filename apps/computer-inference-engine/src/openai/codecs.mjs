import { assertNonemptyString as nonempty } from "@red-cup-engineering/json-services-section/assert-nonempty-string";
/**
 * integrations/openai/codec — OpenAI protocol material as metroplat boundary records.
 *
 * This module admits OpenAI-facing requests, model coordinates, tool calls, and
 * usage costs without owning the network runtime. API keys, sockets, SDKs,
 * retries, and streaming transports stay outside this boundary; the material
 * here is the recoverable shape an metroplat service can record, settle, and
 * relate to capability/accountability protocols.
 *
 * @packageDocumentation
 */
import { requireJsonValue } from "@red-cup-engineering/json-services-section";
import { canonicalJson } from "@red-cup-engineering/json-services-section";

import {
  openaiChatCompletionRequestContract,
  openaiFunctionToolContract,
  openaiInferenceResultContract,
  openaiMessageContract,
  openaiModelContract,
  openaiResponseRequestContract,
  openaiToolCallContract,
  openaiToolContract,
  openaiUsageCostContract,
} from "./schemas.mjs";
import { toEavt, eavtRecord } from "@red-cup-engineering/eavt-services-section/row";

export * as chatCompletions from "./chat-completions/codec.mjs";
export * as embeddings from "./embeddings/codec.mjs";
export * as models from "./models/codec.mjs";
export * as responses from "./responses/codec.mjs";

export {
  openaiChatCompletionRequestContract,
  openaiFunctionToolContract,
  openaiInferenceResultContract,
  openaiMessageContract,
  openaiModelContract,
  openaiResponseRequestContract,
  openaiToolCallContract,
  openaiToolContract,
  openaiUsageCostContract,
} from "./schemas.mjs";

const OPENAI_BOUNDARY_ATTRIBUTE = "openai.protocol.boundary";

function optionalRecord(value, label) {
  if (value === undefined) return undefined;
  return requireJsonValue({ ...value }, label);
}

function jsonClone(value, context) {
  return requireJsonValue(JSON.parse(JSON.stringify(value)), context);
}

function textTokens(text) {
  return (text ?? "").split(/\s+/).filter(Boolean).length;
}

/** Admit one OpenAI model coordinate as protocol material. */
export function openaiModel(input

) {
  return openaiModelContract.assert(Object.freeze({
    kind: "openai.model",
    id: nonempty(input.id, "OpenAI model id"),
    surface: input.surface,
    tier: nonempty(input.tier ?? "unclassified", "OpenAI model tier"),
    ...(input.realizes === undefined ? {} : { realizes: nonempty(input.realizes, "OpenAI model realizes") }),
  }), "OpenAI model");
}

/** Admit a function or MCP tool descriptor as OpenAI request material. */
export function openaiTool(input

) {
  return openaiToolContract.assert(Object.freeze({
    kind: "openai.tool",
    type: input.type ?? "function",
    name: nonempty(input.name, "OpenAI tool name"),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.parameters === undefined ? {} : { parameters: optionalRecord(input.parameters, "OpenAI tool parameters") }),
  }), "OpenAI tool");
}

/** Admit a current OpenAI function-tool wire descriptor. */
export function openaiFunctionTool(input

) {
  return openaiFunctionToolContract.assert(Object.freeze({
    kind: "openai.function-tool",
    type: "function",
    function: Object.freeze({
      name: nonempty(input.name, "OpenAI function tool name"),
      ...(input.description === undefined ? {} : { description: input.description }),
      parameters: optionalRecord(input.parameters ?? { type: "object", properties: {}, additionalProperties: false }, "OpenAI function tool parameters"),
      ...(input.strict === undefined ? {} : { strict: input.strict }),
    }),
  }), "OpenAI function tool");
}

/** Convert an admitted MCP tools/list catalog row into the current OpenAI function-tool wire descriptor. */
export function openaiFunctionToolFromMcpCatalogTool(tool) {
  return openaiFunctionTool({
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    parameters: tool.parameters ?? { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  });
}

/** Convert an admitted MCP tools/list catalog row into the legacy flattened descriptor. */
export function openaiToolFromMcpCatalogTool(tool) {
  return openaiTool({
    name: tool.name,
    type: "mcp",
    ...(tool.description === undefined ? {} : { description: tool.description }),
    ...(tool.parameters === undefined ? {} : { parameters: tool.parameters }),
  });
}

export function openaiToolName(tool) {
  return tool.kind === "openai.function-tool" ? tool.function.name : tool.name;
}

function admitOpenAIToolDescriptor(tool, label) {
  if ((tool).kind === "openai.function-tool") {
    return openaiFunctionToolContract.assert(tool, label);
  }
  return openaiToolContract.assert(tool, label);
}

/** Admit a conversation message. */
export function openaiMessage(input) {
  return openaiMessageContract.assert(Object.freeze({
    kind: "openai.message",
    role: input.role,
    content: input.content,
    ...(input.name === undefined ? {} : { name: nonempty(input.name, "OpenAI message name") }),
    ...(input.toolCallId === undefined ? {} : { toolCallId: nonempty(input.toolCallId, "OpenAI tool call id") }),
  }), "OpenAI message");
}

/** Admit a Responses-style request. */
export function openaiResponseRequest(input

) {
  const requestInput = typeof input.input === "string"
    ? input.input
    : Object.freeze(input.input.map((message) => openaiMessage(message)));
  return openaiResponseRequestContract.assert(Object.freeze({
    kind: "openai.response-request",
    model: nonempty(input.model, "OpenAI response model"),
    input: requestInput,
    ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
    ...(input.tools === undefined ? {} : { tools: Object.freeze(input.tools.map((tool) => admitOpenAIToolDescriptor(tool, "OpenAI response tool"))) }),
    ...(input.metadata === undefined ? {} : { metadata: optionalRecord(input.metadata, "OpenAI response metadata") }),
  }), "OpenAI response request");
}

/** Admit the older Chat Completions wire face as the same protocol family. */
export function openaiChatCompletionRequest(input

) {
  return openaiChatCompletionRequestContract.assert(Object.freeze({
    kind: "openai.chat-completion-request",
    model: nonempty(input.model, "OpenAI chat model"),
    messages: Object.freeze(input.messages.map((message) => openaiMessage(message))),
    ...(input.tools === undefined ? {} : { tools: Object.freeze(input.tools.map((tool) => admitOpenAIToolDescriptor(tool, "OpenAI chat tool"))) }),
    ...(input.responseFormat === undefined ? {} : { responseFormat: input.responseFormat }),
    ...(input.stream === undefined ? {} : { stream: input.stream }),
  }), "OpenAI chat completion request");
}

/** Admit one model-emitted tool call. */
export function openaiToolCall(input

) {
  return openaiToolCallContract.assert(Object.freeze({
    kind: "openai.tool-call",
    id: nonempty(input.id, "OpenAI tool call id"),
    name: nonempty(input.name, "OpenAI tool call name"),
    arguments: requireJsonValue(input.arguments ?? {}, "OpenAI tool call arguments"),
  }), "OpenAI tool call");
}

/** Build a pure inference result over admitted text/tool-call/usage material. */
export function openaiInferenceResult(input

) {
  const calls = Object.freeze((input.toolCalls ?? []).map((call) => openaiToolCallContract.assert(call, "OpenAI result tool call")));
  const status = input.status ?? (calls.length > 0 ? "tool-calls" : "completed");
  return openaiInferenceResultContract.assert(Object.freeze({
    kind: "openai.inference-result",
    model: nonempty(input.model, "OpenAI result model"),
    status,
    text: input.text ?? null,
    toolCalls: calls,
    ...(input.usage === undefined ? {} : {
      usage: Object.freeze({
        inputTokens: Math.max(0, Math.trunc(input.usage.inputTokens)),
        outputTokens: Math.max(0, Math.trunc(input.usage.outputTokens)),
      }),
    }),
  }), "OpenAI inference result");
}

/** Estimate a local result from a request without calling OpenAI. Useful for fixtures and protocol examples. */
export function observeOpenAIResponseRequest(request) {
  const admitted = openaiResponseRequestContract.assert(request, "OpenAI response request");
  const text = typeof admitted.input === "string"
    ? admitted.input
    : admitted.input.map((message) => message.content ?? "").join("\n");
  const calls = admitted.tools?.[0] === undefined
    ? []
    : [openaiToolCall({ id: `call_${openaiToolName(admitted.tools[0])}`, name: openaiToolName(admitted.tools[0]), arguments: { kind: "openai.protocol.tool-call", model: admitted.model } })];
  return openaiInferenceResult({
    model: admitted.model,
    text: calls.length === 0 ? `observed:${text}` : null,
    toolCalls: calls,
    usage: { inputTokens: textTokens(text) + textTokens(admitted.instructions), outputTokens: calls.length === 0 ? textTokens(text) : 0 },
  });
}

/** Project an inference result into a usage/cost observation. Dollars are provided by the caller, not inferred here. */
export function openaiUsageCost(input

) {
  return openaiUsageCostContract.assert(Object.freeze({
    kind: "openai.usage-cost",
    operation: nonempty(input.operation, "OpenAI usage operation"),
    model: nonempty(input.model, "OpenAI usage model"),
    inputTokens: Math.max(0, Math.trunc(input.usage?.inputTokens ?? 0)),
    outputTokens: Math.max(0, Math.trunc(input.usage?.outputTokens ?? 0)),
    dollars: Math.max(0, input.dollars ?? 0),
    at: nonempty(input.at, "OpenAI usage time"),
    ...(input.evidence === undefined ? {} : { evidence: Object.freeze([...input.evidence]) }),
  }), "OpenAI usage cost");
}

function openaiBoundaryEntity(observation) {
  const value = jsonClone(observation.material, "OpenAI boundary value");
  return Object.freeze({
    kind: "metroplat.openai-boundary",
    surface: observation.material.kind,
    ...(observation.sessionId === undefined ? {} : { session: observation.sessionId }),
    id: boundaryId(value),
  });
}

function openaiBoundaryStatementValue(observation) {
  const material = jsonClone(observation.material, "OpenAI boundary value");
  return requireJsonValue(Object.freeze({
    material,
    ...(observation.boundary === undefined ? {} : { boundary: observation.boundary }),
    ...(observation.caller === undefined ? {} : { caller: observation.caller }),
  }), "OpenAI boundary value");
}

/** The OpenAI boundary feed: protocol material enters the statement log as EAVT rows. */
export const openaiBoundaryFeed = Object.freeze({
  name: "openai-boundary",
  functional: Object.freeze([]),
  cellize: (observation, at) => Object.freeze([
    toEavt({
      e: openaiBoundaryEntity(observation),
      a: OPENAI_BOUNDARY_ATTRIBUTE,
      v: openaiBoundaryStatementValue(observation),
      t: at,
    }),
  ]),
});

/** Encode one OpenAI boundary observation as EAVT material. */
export function openaiBoundaryStatementRows(observation) {
  return openaiBoundaryFeed.cellize(observation, observation.at ?? boundaryTime(observation.material));
}

/** Encode any OpenAI protocol record as one EAVT boundary row. */
export function openaiBoundaryRow(input) {
  const row = openaiBoundaryStatementRows({ material: input })[0];
  if (row === undefined) throw new TypeError("openaiBoundaryRow: expected one boundary statement row");
  return row;
}

/** Recover the OpenAI boundary value carried by a row emitted through `openaiBoundaryRow`. */
export function openaiBoundaryValue(row) {
  const object = eavtRecord(row);
  if (object.a !== OPENAI_BOUNDARY_ATTRIBUTE) throw new TypeError(`openaiBoundaryValue: unsupported attribute ${JSON.stringify(object.a)}`);
  const value = object.v;
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "material" in value) {
    return (value).material;
  }
  throw new TypeError("openaiBoundaryValue: expected recorded OpenAI boundary material");
}

function boundaryId(value) {
  let hash = 0;
  const text = canonicalJson(value);
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function boundaryTime(input) {
  if (input.kind === "openai.usage-cost") return input.at;
  return "boundary";
}
