/**
 * Pure Anthropic Messages reading of provider-neutral inference material.
 *
 * `anthropicMessageRequest`/`anthropicMessageResponse` (the wire codec) is a
 * pure Anthropic-wire concern owned by the published
 * `@red-cup-engineering/anthropic-inference-team` package, consumed
 * directly below. Everything else in this file (mapping Anthropic wire
 * shapes to and from MetroPlat's own provider-neutral
 * InferenceCall/InferenceResult model) is MetroPlat's own cross-provider
 * inference-orchestration concern, not an Anthropic API boundary concern,
 * and stays here.
 */
import { isJsonRecord, requireJsonValue } from "@red-cup-engineering/json-services-section";
import { inferenceCall, inferenceMessage, inferenceResult, inferenceTool, inferenceToolMove } from "../../dispatch/inference-model.mjs";
import { inferenceStreamMove } from "../../dispatch/inference-source-kind.mjs";
import { anthropicMessageRequest, anthropicMessageResponse, anthropicMessageResponseMaterial } from "@red-cup-engineering/computer-inference-engine/anthropic/messages-codec";

import { anthropicUsageCounts } from "../token-usage.mjs";

function record(value) {
  return isJsonRecord(value) ? value : undefined;
}

function stopFromAnthropic(value) {
  if (value === "tool_use") return "tool-moves";
  if (value === "max_tokens" || value === "model_context_window_exceeded") return "length";
  if (value === "refusal") return "refused";
  if (value === "pause_turn") return "incomplete";
  return "completed";
}

/** Project one Anthropic event into canonical moves; ping and future unknown events are ignored. */
export function inferenceMovesFromAnthropicEvent(event, firstSequence, observedAt) {
  let sequence = firstSequence;
  const moves = [];
  if (event.type === "message_start") {
    const message = record(event.message);
    if (typeof message?.model === "string") moves.push(inferenceStreamMove({ type: "inference.response-start", channel: "response", sequence: sequence++, body: { model: message.model }, observedAt }));
  }
  if (event.type === "content_block_start" && typeof event.index === "number") {
    const block = record(event.content_block);
    if (block?.type === "text" && typeof block.text === "string" && block.text.length > 0) moves.push(inferenceStreamMove({ type: "inference.text-delta", channel: `block:${event.index}`, sequence: sequence++, body: { choice: 0, text: block.text }, observedAt }));
    if (block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") moves.push(inferenceStreamMove({ type: "inference.tool-call-delta", channel: `block:${event.index}`, sequence: sequence++, body: { choice: 0, index: event.index, request: block.id, name: block.name }, observedAt }));
  }
  if (event.type === "content_block_delta" && typeof event.index === "number") {
    const delta = record(event.delta);
    if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) moves.push(inferenceStreamMove({ type: "inference.text-delta", channel: `block:${event.index}`, sequence: sequence++, body: { choice: 0, text: delta.text }, observedAt }));
    if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") moves.push(inferenceStreamMove({ type: "inference.tool-call-delta", channel: `block:${event.index}`, sequence: sequence++, body: { choice: 0, index: event.index, arguments: delta.partial_json }, observedAt }));
  }
  if (event.type === "message_delta") {
    const delta = record(event.delta);
    if (delta?.stop_reason !== undefined && delta.stop_reason !== null) moves.push(inferenceStreamMove({ type: "inference.finish", channel: "response", sequence: sequence++, body: { choice: 0, stop: stopFromAnthropic(delta.stop_reason) }, observedAt }));
  }
  return Object.freeze(moves);
}

function textOf(blocks) {
  return blocks.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
}
function messagesOf(message) {
  if (typeof message.content === "string") return [inferenceMessage({ role: message.role, content: message.content })];
  const tools = message.content.filter((block) => block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string").map((block) => inferenceToolMove({ request: String(block.id), name: String(block.name), input: requireJsonValue(block.input ?? {}, "Anthropic tool input") }));
  const results = message.content.filter((block) => block.type === "tool_result" && typeof block.tool_use_id === "string").map((block) => inferenceMessage({ role: "tool", toolRequest: String(block.tool_use_id), content: typeof block.content === "string" ? block.content : Array.isArray(block.content) ? textOf(block.content) : "" }));
  const text = textOf(message.content);
  return Object.freeze([...results, ...(text.length === 0 && tools.length === 0 ? [] : [inferenceMessage({ role: message.role, content: tools.length > 0 ? null : text, ...(tools.length === 0 ? {} : { toolMoves: tools }) })])]);
}

export function inferenceCallFromAnthropicMessage(input, context) {
  const wire = anthropicMessageRequest(input);
  const system = typeof wire.system === "string" ? wire.system : wire.system === undefined ? undefined : textOf(wire.system);
  return inferenceCall({
    request: context.request, subject: context.subject, model: wire.model,
    messages: Object.freeze([...(system === undefined ? [] : [inferenceMessage({ role: "system", content: system })]), ...wire.messages.flatMap(messagesOf)]),
    tools: (wire.tools ?? []).map((tool) => inferenceTool({ name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }), inputSchema: tool.input_schema, ...(tool.strict === undefined ? {} : { strict: tool.strict }) })),
    generation: { maxOutputTokens: wire.max_tokens, ...(wire.temperature === undefined ? {} : { temperature: wire.temperature }), ...(wire.top_p === undefined ? {} : { topP: wire.top_p }), ...(wire.stop_sequences === undefined ? {} : { stopSequences: wire.stop_sequences }) },
    extensions: Object.freeze({ "anthropic.messages.request": requireJsonValue(wire, "Anthropic Messages request") }),
    caller: context.caller ?? Object.freeze({ protocol: "anthropic.messages" }), observedAt: context.observedAt, causes: context.causes ?? [],
  });
}

function blockMessages(message) {
  if (message.role === "tool") return Object.freeze({ role: "user", content: Object.freeze([Object.freeze({ type: "tool_result", tool_use_id: message.toolRequest ?? "unresolved", content: message.content ?? "" })]) });
  const role = message.role === "assistant" ? "assistant" : "user";
  const blocks = Object.freeze([
    ...(message.content === null || message.content.length === 0 ? [] : [Object.freeze({ type: "text", text: message.content })]),
    ...(message.toolMoves ?? []).map((move) => Object.freeze({ type: "tool_use", id: move.request, name: move.name, input: move.input })),
  ]);
  return Object.freeze({ role, content: blocks });
}

export function inferenceCallToAnthropicMessage(call) {
  const preserved = call.extensions?.["anthropic.messages.request"];
  if (preserved !== null && typeof preserved === "object" && !Array.isArray(preserved)) return anthropicMessageRequest(preserved);
  const system = call.messages.filter((message) => message.role === "system" || message.role === "developer").map((message) => message.content ?? "").join("\n");
  return anthropicMessageRequest({
    model: call.model, max_tokens: call.generation?.maxOutputTokens ?? 1024,
    messages: call.messages.filter((message) => message.role !== "system" && message.role !== "developer").map(blockMessages),
    ...(system.length === 0 ? {} : { system }),
    ...(call.tools.length === 0 ? {} : { tools: call.tools.map((tool) => Object.freeze({ name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }), input_schema: tool.inputSchema, ...(tool.strict === undefined ? {} : { strict: tool.strict }) })) }),
    ...(call.generation?.temperature === undefined ? {} : { temperature: call.generation.temperature }), ...(call.generation?.topP === undefined ? {} : { top_p: call.generation.topP }), ...(call.generation?.stopSequences === undefined ? {} : { stop_sequences: call.generation.stopSequences }),
  });
}

export function inferenceResultFromAnthropicMessage(input, call, observedAt, causes = []) {
  const wire = anthropicMessageResponseMaterial(input);
  const moves = wire.content.filter((block) => block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string").map((block) => inferenceToolMove({ request: String(block.id), name: String(block.name), input: requireJsonValue(block.input ?? {}, "Anthropic tool input") }));
  const text = textOf(wire.content);
  const stop = moves.length > 0 || wire.stop_reason === "tool_use" ? "tool-moves" : wire.stop_reason === "max_tokens" || wire.stop_reason === "model_context_window_exceeded" ? "length" : wire.stop_reason === "refusal" ? "refused" : wire.stop_reason === "pause_turn" ? "incomplete" : "completed";
  return inferenceResult({ call: call.id, model: wire.model, stop, message: inferenceMessage({ role: "assistant", content: moves.length > 0 ? null : text, ...(moves.length === 0 ? {} : { toolMoves: moves }) }), toolMoves: moves,
    ...(wire.usage === undefined || wire.usage === null ? {} : { usage: { ...anthropicUsageCounts(wire.usage), extensions: Object.freeze({ "anthropic.messages.usage": requireJsonValue(wire.usage, "Anthropic usage") }) } }),
    extensions: Object.freeze({ "anthropic.messages.response": requireJsonValue(wire, "Anthropic response") }), observedAt, causes });
}

export function inferenceResultToAnthropicMessage(result) {
  const preserved = result.extensions?.["anthropic.messages.response"];
  if (preserved !== null && typeof preserved === "object" && !Array.isArray(preserved)) return anthropicMessageResponse(preserved);
  return anthropicMessageResponse({ id: result.id, type: "message", role: "assistant", model: result.model,
    content: Object.freeze([...(result.message?.content === null || result.message?.content === undefined ? [] : [Object.freeze({ type: "text", text: result.message.content })]), ...result.toolMoves.map((move) => Object.freeze({ type: "tool_use", id: move.request, name: move.name, input: move.input }))]),
    stop_reason: result.stop === "tool-moves" ? "tool_use" : result.stop === "length" ? "max_tokens" : result.stop === "refused" ? "refusal" : result.stop === "incomplete" ? "pause_turn" : "end_turn", stop_sequence: null,
    usage: { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens,
      ...(result.usage?.cacheCreationInputTokens === undefined ? {} : { cache_creation_input_tokens: result.usage.cacheCreationInputTokens }),
      ...((result.usage?.cacheReadInputTokens ?? result.usage?.cachedInputTokens) === undefined ? {} : { cache_read_input_tokens: result.usage.cacheReadInputTokens ?? result.usage.cachedInputTokens }) } });
}
