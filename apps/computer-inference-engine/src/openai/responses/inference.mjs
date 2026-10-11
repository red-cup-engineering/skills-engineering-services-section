/** Pure OpenAI Responses reading of provider-neutral inference material. */
import { isJsonRecord, requireJsonValue } from "@red-cup-engineering/json-services-section";
import {
  inferenceCall,
  inferenceMessage,
  inferenceResult,
  inferenceTool,
  inferenceToolMove,
  isNeutralConstraint,
} from "../../dispatch/inference-model.mjs";
import { inferenceStreamMove } from "../../dispatch/inference-source-kind.mjs";
import { openaiResponse, openaiResponseRequest } from "./codec.mjs";

import { openaiResponseUsageCounts } from "./token-usage.mjs";

function eventRecord(value) {
  return isJsonRecord(value) ? value : undefined;
}

/** Native Responses semantic events projected directly to canonical moves. */
export function inferenceMovesFromOpenAIResponseEvent(event, firstSequence, observedAt) {
  let sequence = firstSequence;
  const moves = [];
  const outputIndex = typeof event.output_index === "number" ? event.output_index : 0;
  if (event.type === "response.created") {
    const response = eventRecord(event.response);
    if (typeof response?.model === "string") moves.push(inferenceStreamMove({ type: "inference.response-start", channel: "response", sequence: sequence++, body: { model: response.model }, observedAt }));
  }
  if (event.type === "response.output_text.delta" && typeof event.delta === "string" && event.delta.length > 0) {
    moves.push(inferenceStreamMove({ type: "inference.text-delta", channel: `output:${outputIndex}`, sequence: sequence++, body: { choice: outputIndex, text: event.delta }, observedAt }));
  }
  if (event.type === "response.output_item.added") {
    const item = eventRecord(event.item);
    if (item?.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
      moves.push(inferenceStreamMove({ type: "inference.tool-call-delta", channel: `output:${outputIndex}`, sequence: sequence++, body: { choice: outputIndex, index: outputIndex, request: item.call_id, name: item.name }, observedAt }));
    }
  }
  if (event.type === "response.function_call_arguments.delta" && typeof event.delta === "string") {
    moves.push(inferenceStreamMove({ type: "inference.tool-call-delta", channel: `output:${outputIndex}`, sequence: sequence++, body: { choice: outputIndex, index: outputIndex, arguments: event.delta }, observedAt }));
  }
  if (event.type === "response.completed" || event.type === "response.incomplete") {
    moves.push(inferenceStreamMove({ type: "inference.finish", channel: "response", sequence: sequence++, body: { choice: 0, stop: event.type === "response.completed" ? "completed" : "incomplete" }, observedAt }));
  }
  return Object.freeze(moves);
}

function inputMessage(item) {
  if ("call_id" in item) {
    return inferenceMessage({ role: "tool", content: item.output, toolRequest: item.call_id });
  }
  const content = typeof item.content === "string" ? item.content : item.content.map((part) => part.text).join("");
  return inferenceMessage({ role: item.role, content });
}

/** Decode Responses wire to the same canonical call used by Chat Completions. */
export function inferenceCallFromOpenAIResponse(input, context) {
  const wire = openaiResponseRequest(input);
  const messages = typeof wire.input === "string"
    ? [inferenceMessage({ role: "user", content: wire.input })]
    : wire.input.map(inputMessage);
  if (wire.instructions !== undefined) messages.unshift(inferenceMessage({ role: "system", content: wire.instructions }));
  return inferenceCall({
    request: context.request,
    subject: context.subject,
    model: wire.model,
    messages,
    tools: (wire.tools ?? []).map((tool) => inferenceTool({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: requireJsonValue(tool.parameters ?? {}, "OpenAI Responses tool parameters"),
      ...(tool.strict === undefined ? {} : { strict: tool.strict }),
    })),
    ...([wire.max_output_tokens, wire.temperature, wire.top_p].every((value) => value === undefined) ? {} : { generation: {
      ...(wire.max_output_tokens === undefined ? {} : { maxOutputTokens: wire.max_output_tokens }),
      ...(wire.temperature === undefined ? {} : { temperature: wire.temperature }),
      ...(wire.top_p === undefined ? {} : { topP: wire.top_p }),
    } }),
    ...(wire.text?.format === undefined ? {} : { responseConstraint: wire.text.format }),
    extensions: Object.freeze({ "openai.responses.request": requireJsonValue(wire, "OpenAI Responses request") }),
    caller: context.caller ?? Object.freeze({ protocol: "openai.responses" }),
    observedAt: context.observedAt,
    causes: context.causes ?? [],
  });
}

/** Encode a canonical call for a Responses provider, preserving admitted wire when available. */
export function inferenceCallToOpenAIResponse(call) {
  const preserved = call.extensions?.["openai.responses.request"];
  if (preserved !== null && typeof preserved === "object" && !Array.isArray(preserved)) return openaiResponseRequest(preserved);
  const instructions = call.messages.filter((message) => message.role === "system" || message.role === "developer").map((message) => message.content ?? "").join("\n");
  const input = call.messages
    .filter((message) => message.role !== "system" && message.role !== "developer")
    .map((message) => message.role === "tool"
      ? Object.freeze({ type: "function_call_output", call_id: message.toolRequest ?? "unresolved", output: message.content ?? "" })
      : Object.freeze({ role: message.role, content: message.content ?? "" }));
  return openaiResponseRequest({
    model: call.model,
    input: Object.freeze(input),
    ...(instructions.length === 0 ? {} : { instructions }),
    ...(call.tools.length === 0 ? {} : { tools: call.tools.map((tool) => Object.freeze({
      type: "function",
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      parameters: tool.inputSchema,
      ...(tool.strict === undefined ? {} : { strict: tool.strict }),
    })) }),
    ...(call.responseConstraint === undefined ? {} : { text: Object.freeze({ format: isNeutralConstraint(call.responseConstraint)
      ? Object.freeze({ type: "json_schema", name: call.responseConstraint.name, schema: call.responseConstraint.schema, strict: false })
      : call.responseConstraint }) }),
    ...(call.generation?.maxOutputTokens === undefined ? {} : { max_output_tokens: call.generation.maxOutputTokens }),
    ...(call.generation?.temperature === undefined ? {} : { temperature: call.generation.temperature }),
    ...(call.generation?.topP === undefined ? {} : { top_p: call.generation.topP }),
  });
}

function parseArguments(text) {
  try { return requireJsonValue(JSON.parse(text), "OpenAI Responses tool input"); } catch { return text; }
}

/** Decode Responses output without dispatching its tool moves. */
export function inferenceResultFromOpenAIResponse(input, call, observedAt, causes = []) {
  const { usage, ...reply } = input;
  const wire = openaiResponse(reply);
  const toolMoves = wire.output.flatMap((item) => item.type === "function_call"
    ? [inferenceToolMove({ request: item.call_id, name: item.name, input: parseArguments(item.arguments) })]
    : []);
  const text = wire.output.flatMap((item) => item.type === "message" ? item.content.map((part) => part.text) : []).join("");

  return inferenceResult({
    call: call.id,
    model: wire.model,
    stop: toolMoves.length > 0 ? "tool-moves" : wire.status === "completed" || wire.status === undefined ? "completed" : "incomplete",
    message: inferenceMessage({ role: "assistant", content: toolMoves.length > 0 ? null : text, ...(toolMoves.length === 0 ? {} : { toolMoves }) }),
    toolMoves,
    ...(usage === undefined || usage === null ? {} : { usage: {
      ...openaiResponseUsageCounts(usage),
      extensions: Object.freeze({ "openai.responses.usage": requireJsonValue(usage, "OpenAI Responses usage") }),
    } }),
    extensions: Object.freeze({ "openai.responses.response": requireJsonValue(input, "OpenAI Responses response") }),
    observedAt,
    causes,
  });
}

export function inferenceResultToOpenAIResponse(result) {
  const preserved = result.extensions?.["openai.responses.response"];
  if (preserved !== null && typeof preserved === "object" && !Array.isArray(preserved)) return openaiResponse(preserved);
  const output = [
    ...(result.message?.content === null || result.message?.content === undefined ? [] : [Object.freeze({
      type: "message",
      role: "assistant",
      status: result.stop === "completed" ? "completed" : "in_progress",
      content: Object.freeze([Object.freeze({ type: "output_text", text: result.message.content, annotations: Object.freeze([]) })]),
    })]),
    ...result.toolMoves.map((move) => Object.freeze({ type: "function_call", call_id: move.request, name: move.name, arguments: JSON.stringify(move.input), status: "completed" })),
  ];
  return openaiResponse({
    id: result.id,
    object: "response",
    created_at: Math.max(0, Math.trunc(Date.parse(result.observedAt) / 1000)),
    model: result.model,
    status: result.stop === "completed" ? "completed" : "incomplete",
    output: Object.freeze(output),
    ...([result.usage?.inputTokens, result.usage?.outputTokens, result.usage?.totalTokens].every((value) => Number.isSafeInteger(value) && value >= 0) ? { usage: Object.freeze({
      input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens, total_tokens: result.usage.totalTokens,
      ...(result.usage.cachedInputTokens === undefined ? {} : { input_tokens_details: { cached_tokens: result.usage.cachedInputTokens } }),
      ...(result.usage.reasoningOutputTokens === undefined ? {} : { output_tokens_details: { reasoning_tokens: result.usage.reasoningOutputTokens } }),
    }) } : {}),
  });
}
