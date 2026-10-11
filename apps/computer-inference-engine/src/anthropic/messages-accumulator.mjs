/**
 * Fold Anthropic Messages stream events into the final response they
 * describe, with memory proportional to the resulting message. Ported from
 * the accumulator half of MetroPlat's
 * `src/integrations/anthropic/messages/inference.mts` — the other half of
 * that file (mapping Anthropic wire shapes to MetroPlat's own provider-
 * neutral InferenceCall/InferenceResult model) stays in MetroPlat, since it
 * is MetroPlat's own cross-provider orchestration concern, not an Anthropic
 * API boundary concern.
 */
import { mergeAnthropicUsage } from "./token-usage.mjs";
import { isJsonRecord, requireJsonValue } from "@red-cup-engineering/json-services-section";


function record(value) {
  return isJsonRecord(value) ? value : undefined;
}

/** Fold stream events with memory proportional to the resulting message. */
export function anthropicMessageStreamAccumulator() {
  let id;
  let model;
  let usage = {};
  let stopReason = null;
  let stopSequence = null;
  const blocks = new Map();
  const push = (event) => {
    if (event.type === "message_start") {
      const message = record(event.message);
      const reportedUsage = record(message?.usage);
      if (typeof message?.id === "string") id = message.id;
      if (typeof message?.model === "string") model = message.model;
      usage = mergeAnthropicUsage(usage, reportedUsage);
      return;
    }
    if (event.type === "content_block_start" && typeof event.index === "number") {
      const block = record(event.content_block);
      if (block?.type === "text") blocks.set(event.index, { type: "text", text: typeof block.text === "string" ? block.text : "" });
      if (block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
        blocks.set(event.index, { type: "tool_use", id: block.id, name: block.name, inputText: "", initialInput: requireJsonValue(block.input ?? {}, "Anthropic streamed tool input") });
      }
      return;
    }
    if (event.type === "content_block_delta" && typeof event.index === "number") {
      const delta = record(event.delta);
      const block = blocks.get(event.index);
      if (delta?.type === "text_delta" && typeof delta.text === "string" && block?.type === "text") block.text += delta.text;
      if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string" && block?.type === "tool_use") block.inputText += delta.partial_json;
      return;
    }
    if (event.type === "message_delta") {
      const delta = record(event.delta);
      const reportedUsage = record(event.usage);
      if (typeof delta?.stop_reason === "string" || delta?.stop_reason === null) stopReason = delta.stop_reason;
      if (typeof delta?.stop_sequence === "string" || delta?.stop_sequence === null) stopSequence = delta.stop_sequence;
      usage = mergeAnthropicUsage(usage, reportedUsage);
    }
  };
  const read = () => {
    if (id === undefined || model === undefined) throw new TypeError("Anthropic stream has no message_start identity");
    const content = [...blocks.entries()].sort(([left], [right]) => left - right).map(([, block]) => {
      if (block.type === "text") return Object.freeze({ type: "text", text: block.text });
      let input = block.initialInput;
      if (block.inputText.length > 0) {
        try { input = requireJsonValue(JSON.parse(block.inputText), "Anthropic streamed tool input"); }
        catch { input = block.inputText; }
      }
      return Object.freeze({ type: "tool_use", id: block.id, name: block.name, input });
    });
    return Object.freeze({
      id,
      type: "message",
      role: "assistant",
      content: Object.freeze(content),
      model,
      stop_reason: stopReason,
      stop_sequence: stopSequence,
      usage: requireJsonValue(usage, "Anthropic streamed usage"),
    });
  };
  return Object.freeze({ push, read });
}
