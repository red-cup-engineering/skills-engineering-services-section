/**
 * integrations/openai/services — a live HTTP client for OpenAI-compatible
 * `/chat/completions` endpoints (NVIDIA NIM, OpenAI itself, vLLM, …).
 *
 * Reads `OPENAI_BASE_URL` / `OPENAI_API_KEY` from the process environment.
 * The key is used only to build the request's `Authorization` header for the
 * duration of one call; it is never returned, logged, or recorded. This
 * adapter owns only the HTTP effect. Witnessing and accounting are consumers
 * of the canonical inference result outside this vendor boundary.
 *
 * @packageDocumentation
 */
import {
  chatCompletionRequestToWireJson,
  openaiChatCompletionChunk,
  openaiChatCompletionRequest,

} from "./chat-completions/codec.mjs";
import { endpointUrl } from "./pricing/endpoint.mjs";
import { processEnvironment, processEnvValue } from "@red-cup-engineering/node-process-services-section/environment";
import { parseSseByteStream } from "@red-cup-engineering/http-services-section/sse/parse-byte-stream";

export const OPENAI_BASE_URL_ENV = "OPENAI_BASE_URL";
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

/** Resolve the endpoint from `OPENAI_BASE_URL`, or undefined when unset/empty. */
export function resolveOpenAIEndpoint(env = processEnvironment()) {
  const baseUrl = processEnvValue(OPENAI_BASE_URL_ENV, env);
  return baseUrl === undefined || baseUrl.trim().length === 0
    ? undefined
    : Object.freeze({ id: "openai-compatible", baseUrl: baseUrl.trim() });
}

/** Whether an `OPENAI_API_KEY` value is present. Presence only — the value itself never leaves this module. */
export function hasOpenAIApiKey(env = processEnvironment()) {
  const key = processEnvValue(OPENAI_API_KEY_ENV, env);
  return typeof key === "string" && key.trim().length > 0;
}

function errorReason(status, bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    return typeof parsed.error?.message === "string" ? parsed.error.message : `HTTP ${status}`;
  } catch {
    return `HTTP ${status}: ${bodyText.slice(0, 500)}`;
  }
}

/** Effect-only incremental `/chat/completions` source. */
export function streamOpenAIChatCompletion(
  request,
  options = {},
) {
  return Object.freeze({
    async *[Symbol.asyncIterator]() {
      const env = options.env ?? processEnvironment();
      const endpoint = resolveOpenAIEndpoint(env);
      if (endpoint === undefined) {
        yield { kind: "openai.chat-completions.stream.failure", condition: "missing-base-url", reason: `${OPENAI_BASE_URL_ENV} is not set` };
        return;
      }
      const apiKey = processEnvValue(OPENAI_API_KEY_ENV, env);
      if (apiKey === undefined || apiKey.trim().length === 0) {
        yield { kind: "openai.chat-completions.stream.failure", condition: "missing-api-key", reason: `${OPENAI_API_KEY_ENV} is not set` };
        return;
      }
      const admitted = openaiChatCompletionRequest(Object.freeze({
        ...request,
        stream: true,
        stream_options: Object.freeze({
          ...(typeof request.stream_options === "object" && request.stream_options !== null ? request.stream_options : {}),
          include_usage: true,
        }),
      }));
      let response;
      try {
        response = await (options.fetch ?? fetch)(endpointUrl(endpoint), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "text/event-stream",
            authorization: `Bearer ${apiKey}`,
            ...(options.idempotencyKey === undefined ? {} : { "idempotency-key": options.idempotencyKey }),
          },
          body: chatCompletionRequestToWireJson(admitted),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } catch (error) {
        yield {
          kind: "openai.chat-completions.stream.failure",
          condition: options.signal?.aborted === true ? "cancelled" : "unreachable",
          reason: options.signal?.aborted === true ? "OpenAI-compatible request was cancelled" : error instanceof Error ? error.message : String(error),
        };
        return;
      }
      if (!response.ok) {
        const body = await response.text();
        yield {
          kind: "openai.chat-completions.stream.failure",
          condition: response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 429 ? "rate-limited" : "rejected",
          reason: errorReason(response.status, body),
        };
        return;
      }
      if (response.body === null) {
        yield { kind: "openai.chat-completions.stream.failure", condition: "malformed", reason: "OpenAI-compatible streaming response has no body" };
        return;
      }
      try {
        for await (const event of parseSseByteStream(response.body)) {
          const data = event.data.trim();
          if (data.length === 0) continue;
          if (data === "[DONE]") {
            yield { kind: "openai.chat-completions.stream.done" };
            return;
          }
          yield {
            kind: "openai.chat-completions.stream.chunk",
            chunk: openaiChatCompletionChunk(JSON.parse(data)),
          };
        }
      } catch (error) {
        yield {
          kind: "openai.chat-completions.stream.failure",
          condition: options.signal?.aborted === true ? "cancelled" : "malformed",
          reason: options.signal?.aborted === true ? "OpenAI-compatible request was cancelled" : error instanceof Error ? error.message : String(error),
        };
        return;
      }
      yield { kind: "openai.chat-completions.stream.failure", condition: "truncated", reason: "OpenAI-compatible stream ended before [DONE]" };
    },
  });
}
