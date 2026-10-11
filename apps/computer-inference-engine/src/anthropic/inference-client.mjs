/** Anthropic Messages effect source for witnessed inference encounters. */
import { inferenceObstruction } from "../dispatch/inference-model.mjs";
import { inferenceSourceMove, inferenceSourceTerminal, inferenceStreamMove } from "../dispatch/inference-source-kind.mjs";
import { streamAnthropicMessage } from "@red-cup-engineering/computer-inference-engine/anthropic/messages-client";
import { anthropicMessageStreamAccumulator } from "@red-cup-engineering/computer-inference-engine/anthropic/messages-accumulator";
import { inferenceCallToAnthropicMessage, inferenceMovesFromAnthropicEvent, inferenceResultFromAnthropicMessage } from "./messages/inference.mjs";
import { anthropicUsageCounts } from "./token-usage.mjs";
import { isJsonRecord } from "@red-cup-engineering/json-services-section";

/** Options for the published `streamAnthropicMessage` client (local to this call site). */

function conditionOf(value) {
  return value === "missing-api-key" ? "configuration" : value === "truncated" ? "truncated-stream" : value;
}

export function anthropicMessagesInferenceSource(options = {}) {
  return (call, callOptions) => Object.freeze({
    async *[Symbol.asyncIterator]() {
      const { now: _now, timeoutMs, ...clientOptions } = options;
      const timeoutController = timeoutMs === undefined ? undefined : new AbortController();
      let timedOut = false;
      const timeout = timeoutMs === undefined ? undefined : setTimeout(() => { timedOut = true; timeoutController?.abort(); }, Math.max(0, timeoutMs));
      const signals = [callOptions?.signal, timeoutController?.signal].filter((signal) => signal !== undefined);
      const signal = signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);
      const accumulator = anthropicMessageStreamAccumulator();
      let sequence = 0;
      try {
        for await (const streamed of streamAnthropicMessage(inferenceCallToAnthropicMessage(call), {
          ...clientOptions,
          ...(signal === undefined ? {} : { signal }),
          ...(callOptions?.idempotencyKey === undefined ? {} : { idempotencyKey: callOptions.idempotencyKey }),
        })) {
          const observedAt = options.now?.() ?? new Date().toISOString();
          if (streamed.kind === "anthropic.messages.stream.failure") {
            yield inferenceSourceTerminal(inferenceObstruction({
              call: call.id,
              condition: timedOut ? "timeout" : conditionOf(streamed.condition),
              reasons: Object.freeze([streamed.reason]),
              retryable: streamed.condition === "unreachable" || streamed.condition === "rejected" || streamed.condition === "truncated",
              observedAt,
              causes: Object.freeze([call.id]),
            }));
            return;
          }
          const event = streamed.event;
          if (event.type === "error") {
            const error = isJsonRecord(event.error) ? event.error : undefined;
            yield inferenceSourceTerminal(inferenceObstruction({
              call: call.id,
              condition: error?.type === "rate_limit_error" ? "rate-limited" : "rejected",
              reasons: Object.freeze([typeof error?.message === "string" ? error.message : "Anthropic stream error"]),
              retryable: error?.type === "overloaded_error" || error?.type === "rate_limit_error",
              observedAt,
              causes: Object.freeze([call.id]),
            }));
            return;
          }
          accumulator.push(event);
          const moves = inferenceMovesFromAnthropicEvent(event, sequence, observedAt);
          sequence += moves.length;
          for (const move of moves) yield inferenceSourceMove(move);
          if (event.type === "message_stop") {
            try {
              const response = accumulator.read();
              yield inferenceSourceMove(inferenceStreamMove({
                type: "inference.usage",
                channel: "usage",
                sequence: sequence++,
                body: anthropicUsageCounts(response.usage),
                observedAt,
              }));
              yield inferenceSourceTerminal(inferenceResultFromAnthropicMessage(response, call, observedAt, Object.freeze([call.id])));
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
