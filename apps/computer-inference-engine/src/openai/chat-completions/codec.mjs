/**
 * integrations/openai/codec/chat-completions — the literal `/chat/completions`
 * wire codec: admits and emits the exact snake_case JSON a real OpenAI-compatible
 * host (OpenAI itself, NVIDIA NIM, vLLM, …) sends and receives. This is what a
 * live client encodes requests with and decodes responses through; the
 * abstracted camelCase material in `codecs/text/json/openai` stays the
 * package-internal protocol-boundary reading and does not round-trip the wire
 * byte-for-byte.
 *
 * Streaming decode reuses the package SSE codec: a `stream: true` reply is a
 * `text/event-stream` body of `chat.completion.chunk` JSON payloads terminated
 * by a literal `data: [DONE]` frame.
 *
 * @packageDocumentation
 */
import { requireJsonValue, parse } from "@red-cup-engineering/json-services-section";
import { parseSseStream } from "@red-cup-engineering/computer-serialized-content-engineering-services-section/services/http-data-services-section/src/server-sent-event";
import {
  openaiChatCompletionContract,
  openaiChatCompletionChunkContract,
  openaiChatCompletionRequestContract,
  openaiChatFunctionToolContract,
  openaiChatMessageContract,
  openaiChatToolCallContract,
  openaiResponseFormatContract,
  openaiUsageWireContract,

} from "./schema.mjs";

export {
  openaiChatCompletionContract,
  openaiChatCompletionChunkContract,
  openaiChatCompletionRequestContract,
  openaiChatFunctionToolContract,
  openaiChatMessageContract,
  openaiChatToolCallContract,
  openaiResponseFormatContract,
  openaiUsageWireContract,
} from "./schema.mjs";

/** Admit one wire message. */
export function openaiChatMessage(input) {
  return openaiChatMessageContract.assert(input, "OpenAI chat-completions message");
}

/** Admit one wire tool call (`function.arguments` stays the raw JSON-encoded string; parse it yourself). */
export function openaiChatToolCall(input) {
  return openaiChatToolCallContract.assert(input, "OpenAI chat-completions tool call");
}

/** Parse a tool call's `function.arguments` string as JSON, falling back to the raw string on parse failure. */
export function openaiChatToolCallArguments(call) {
  try {
    return requireJsonValue(JSON.parse(call.function.arguments), "OpenAI chat-completions tool call arguments");
  } catch {
    return call.function.arguments;
  }
}

/** Admit one wire function-tool descriptor. */
export function openaiChatFunctionTool(input) {
  return openaiChatFunctionToolContract.assert(input, "OpenAI chat-completions function tool");
}

/** Admit a `response_format` field. */
export function openaiResponseFormat(input) {
  return openaiResponseFormatContract.assert(input, "OpenAI chat-completions response format");
}

/** Admit a `usage` object. */
export function openaiUsageWire(input) {
  return openaiUsageWireContract.assert(input, "OpenAI chat-completions usage");
}

/** Admit a full `/chat/completions` request body. */
export function openaiChatCompletionRequest(input) {
  return openaiChatCompletionRequestContract.assert(input, "OpenAI chat-completions request");
}

/** Admit a full non-streaming `/chat/completions` response body. */
export function openaiChatCompletion(input) {
  return openaiChatCompletionContract.assert(input, "OpenAI chat-completions response");
}

/** Admit one streamed `chat.completion.chunk` payload. */
export function openaiChatCompletionChunk(input) {
  return openaiChatCompletionChunkContract.assert(input, "OpenAI chat-completions chunk");
}

/** Serialize an admitted request to its wire JSON text. */
export function chatCompletionRequestToWireJson(request) {
  return JSON.stringify(openaiChatCompletionRequestContract.assert(request, "OpenAI chat-completions request"));
}

/** Parse and admit a request from wire JSON text. */
export function chatCompletionRequestOfWireJson(text) {
  return openaiChatCompletionRequest(parse(text));
}

/** Parse and admit a non-streaming response from wire JSON text. */
export function chatCompletionOfWireJson(text) {
  return openaiChatCompletion(parse(text));
}

/** Decode a `text/event-stream` body into its admitted `chat.completion.chunk` payloads,
 *  dropping the terminal literal `data: [DONE]` frame and any comment/keep-alive frames. */
export function chatCompletionStreamOfSse(text) {
  return Object.freeze(
    parseSseStream(text)
      .filter((event) => event.data.trim().length > 0 && event.data.trim() !== "[DONE]")
      .map((event) => openaiChatCompletionChunk(JSON.parse(event.data))),
  );
}

/** Fold a chunk stream into one completion: concatenates `delta.content` per choice index,
 *  accumulates `delta.tool_calls` by their stream index (arguments concatenate as text, since a
 *  tool call's JSON argument string itself streams token-by-token), takes id/model/created from
 *  the first chunk, the last non-null finish_reason per choice, and the last carried `usage`
 *  (present only when the request set `stream_options.include_usage`). */

/** Bounded-overhead fold: memory grows with the resulting message, not the number of chunks. */
export function chatCompletionChunkAccumulator() {
  let first;
  const choices = new Map

 ();
  let usage;
  const push = (chunk) => {
    first ??= chunk;
    if (chunk.usage !== undefined && chunk.usage !== null) usage = chunk.usage;
    for (const choice of chunk.choices) {
      const entry = choices.get(choice.index) ?? { content: null, toolCalls: new Map(), finishReason: null };
      if (choice.delta.content !== undefined && choice.delta.content !== null) {
        entry.content = (entry.content ?? "") + choice.delta.content;
      }
      for (const call of choice.delta.tool_calls ?? []) {
        const existing = entry.toolCalls.get(call.index) ?? { arguments: "" };
        entry.toolCalls.set(call.index, {
          id: call.id ?? existing.id,
          name: call.function?.name ?? existing.name,
          arguments: existing.arguments + (call.function?.arguments ?? ""),
          extraContent: call.extra_content ?? existing.extraContent,
        });
      }
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) entry.finishReason = choice.finish_reason;
      choices.set(choice.index, entry);
    }
  };
  const read = () => {
    if (first === undefined) throw new TypeError("chatCompletionChunkAccumulator: expected at least one chunk");
    return openaiChatCompletion({
      id: first.id,
      object: "chat.completion",
      created: first.created,
      model: first.model,
      choices: [...choices.entries()]
        .sort(([left], [right]) => left - right)
        .map(([index, entry]) => {
          const toolCalls = [...entry.toolCalls.values()]
            .filter((call) => call.id !== undefined && call.name !== undefined)
            .map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
              ...(call.extraContent === undefined ? {} : { extra_content: call.extraContent }),
            }));
          return {
            index,
            message: {
              role: "assistant",
              content: toolCalls.length > 0 ? null : entry.content,
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: entry.finishReason,
          };
        }),
      ...(usage === undefined ? {} : { usage }),
    });
  };
  return Object.freeze({ push, read });
}

export function foldChatCompletionChunks(chunks) {
  const accumulator = chatCompletionChunkAccumulator();
  for (const chunk of chunks) accumulator.push(chunk);
  return accumulator.read();
}
