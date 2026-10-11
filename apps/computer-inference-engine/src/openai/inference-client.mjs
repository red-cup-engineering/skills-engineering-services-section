/** OpenAI Chat Completions and Responses effect sources for witnessed inference encounters. */
import {
  inferenceObstruction,

} from "../dispatch/inference-model.mjs";
import {
  inferenceSourceMove,
  inferenceSourceTerminal,
  inferenceStreamMove,

} from "../dispatch/inference-source-kind.mjs";
import { inferenceCallToOpenAIChat, inferenceMovesFromOpenAIChatChunk, inferenceResultFromOpenAIChat } from "./chat-completions/inference.mjs";
import { chatCompletionChunkAccumulator } from "./chat-completions/codec.mjs";
import { streamOpenAIChatCompletion } from "./compatible-http-client.mjs";
import { streamOpenAIResponse } from "./responses/client.mjs";
import { inferenceCallToOpenAIResponse, inferenceMovesFromOpenAIResponseEvent, inferenceResultFromOpenAIResponse } from "./responses/inference.mjs";
import { tokenUsageCounts } from "../cost/token-usage/core.mjs";
import { isJsonRecord } from "@red-cup-engineering/json-services-section";

function conditionOf(condition) {
  if (condition === "missing-base-url" || condition === "missing-api-key") return "configuration";
  if (condition === "truncated") return "truncated-stream";
  return condition;
}

/** Incremental OpenAI source; every yielded move is provider-neutral domain material. */
export function openAIChatInferenceSource(options = {}) {
  return (call, callOptions) => Object.freeze({
    async *[Symbol.asyncIterator]() {
      const { now: _now, timeoutMs, requestExtensions, ...clientOptions } = options;
      const timeoutController = timeoutMs === undefined ? undefined : new AbortController();
      let timedOut = false;
      const timeout = timeoutMs === undefined ? undefined : setTimeout(() => {
        timedOut = true;
        timeoutController?.abort();
      }, Math.max(0, timeoutMs));
      const signals = [callOptions?.signal, timeoutController?.signal].filter((signal) => signal !== undefined);
      const signal = signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);
      const accumulator = chatCompletionChunkAccumulator();
      let sequence = 0;
      let began = false;
      try {
        for await (const event of streamOpenAIChatCompletion(inferenceCallToOpenAIChat(call, requestExtensions), {
          ...clientOptions,
          ...(signal === undefined ? {} : { signal }),
          ...(callOptions?.idempotencyKey === undefined ? {} : { idempotencyKey: callOptions.idempotencyKey }),
        })) {
          const observedAt = options.now();
          if (event.kind === "openai.chat-completions.stream.failure") {
            yield inferenceSourceTerminal(inferenceObstruction({
              call: call.id,
              condition: timedOut ? "timeout" : conditionOf(event.condition),
              reasons: Object.freeze([event.reason]),
              retryable: event.condition === "unreachable" || event.condition === "rate-limited" || event.condition === "rejected" || event.condition === "truncated",
              observedAt,
              causes: Object.freeze([call.id]),
            }));
            return;
          }
          if (event.kind === "openai.chat-completions.stream.done") {
            try {
              yield inferenceSourceTerminal(inferenceResultFromOpenAIChat(accumulator.read(), call, observedAt, Object.freeze([call.id])));
            } catch (error) {
              yield inferenceSourceTerminal(inferenceObstruction({
                call: call.id,
                condition: "malformed",
                reasons: Object.freeze([error instanceof Error ? error.message : String(error)]),
                retryable: false,
                observedAt,
                causes: Object.freeze([call.id]),
              }));
            }
            return;
          }
          accumulator.push(event.chunk);
          if (!began) {
            began = true;
            yield inferenceSourceMove(inferenceStreamMove({
              type: "inference.response-start",
              channel: "response",
              sequence: sequence++,
              body: Object.freeze({ model: event.chunk.model }),
              observedAt,
            }));
          }
          const moves = inferenceMovesFromOpenAIChatChunk(event.chunk, sequence, observedAt);
          sequence += moves.length;
          for (const move of moves) yield inferenceSourceMove(move);
        }
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  });
}

/** Native `/responses` source projected to the same canonical encounter vocabulary. */
export function openAIResponsesInferenceSource(options = {}) {
  return (call, callOptions) => Object.freeze({
    async *[Symbol.asyncIterator]() {
      const { now: _now, timeoutMs, requestExtensions: _requestExtensions, ...clientOptions } = options;
      const timeoutController = timeoutMs === undefined ? undefined : new AbortController();
      let timedOut = false;
      const timeout = timeoutMs === undefined ? undefined : setTimeout(() => { timedOut = true; timeoutController?.abort(); }, Math.max(0, timeoutMs));
      const signals = [callOptions?.signal, timeoutController?.signal].filter((signal) => signal !== undefined);
      const signal = signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);
      let sequence = 0;
      try {
        for await (const streamed of streamOpenAIResponse(inferenceCallToOpenAIResponse(call), {
          ...clientOptions,
          ...(signal === undefined ? {} : { signal }),
          ...(callOptions?.idempotencyKey === undefined ? {} : { idempotencyKey: callOptions.idempotencyKey }),
        })) {
          const observedAt = options.now();
          if (streamed.kind === "openai.responses.stream.failure") {
            yield inferenceSourceTerminal(inferenceObstruction({ call: call.id, condition: timedOut ? "timeout" : conditionOf(streamed.condition), reasons: Object.freeze([streamed.reason]), retryable: streamed.condition === "unreachable" || streamed.condition === "rejected" || streamed.condition === "truncated", observedAt, causes: Object.freeze([call.id]) }));
            return;
          }
          const event = streamed.event;
          const moves = inferenceMovesFromOpenAIResponseEvent(event, sequence, observedAt);
          sequence += moves.length;
          for (const move of moves) yield inferenceSourceMove(move);
          if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
            const response = isJsonRecord(event.response) ? event.response : undefined;
            if (event.type === "response.failed") {
              const error = isJsonRecord(response?.error) ? response.error : undefined;
              yield inferenceSourceTerminal(inferenceObstruction({ call: call.id, condition: "rejected", reasons: Object.freeze([typeof error?.message === "string" ? error.message : "OpenAI response failed"]), retryable: true, observedAt, causes: Object.freeze([call.id]) }));
              return;
            }
            try {
              const result = inferenceResultFromOpenAIResponse(response, call, observedAt, Object.freeze([call.id]));
              if (result.usage !== undefined) {
                yield inferenceSourceMove(inferenceStreamMove({ type: "inference.usage", channel: "usage", sequence: sequence++, body: tokenUsageCounts(result.usage), observedAt }));
              }
              yield inferenceSourceTerminal(result);
            } catch (error) {
              yield inferenceSourceTerminal(inferenceObstruction({ call: call.id, condition: "malformed", reasons: Object.freeze([error instanceof Error ? error.message : String(error)]), retryable: false, observedAt, causes: Object.freeze([call.id]) }));
            }
            return;
          }
        }
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  });
}

/** Bind one vendor adapter without leaking its wire types into the agent loop. */
