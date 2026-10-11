/** Effect-only incremental client for OpenAI `/responses`. */
import { processEnvironment, processEnvValue } from "@red-cup-engineering/node-process-services-section/environment";
import { parseSseByteStream } from "@red-cup-engineering/http-services-section/sse/parse-byte-stream";
import { endpointUrl } from "../pricing/endpoint.mjs";
import { OPENAI_API_KEY_ENV, resolveOpenAIEndpoint } from "../compatible-http-client.mjs";
import { openaiResponseRequest, openaiResponseStreamEvent, responseRequestToWireJson } from "./codec.mjs";

function errorReason(status, body) {
  try {
    const value = JSON.parse(body);
    return typeof value.error?.message === "string" ? value.error.message : `HTTP ${status}`;
  } catch { return `HTTP ${status}: ${body.slice(0, 500)}`; }
}

export function streamOpenAIResponse(request, options = {}) {
  return Object.freeze({
    async *[Symbol.asyncIterator]() {
      const env = options.env ?? processEnvironment();
      const endpoint = resolveOpenAIEndpoint(env);
      if (endpoint === undefined) { yield { kind: "openai.responses.stream.failure", condition: "missing-base-url", reason: "OPENAI_BASE_URL is not set" }; return; }
      const apiKey = processEnvValue(OPENAI_API_KEY_ENV, env);
      if (apiKey === undefined || apiKey.trim().length === 0) { yield { kind: "openai.responses.stream.failure", condition: "missing-api-key", reason: `${OPENAI_API_KEY_ENV} is not set` }; return; }
      let response;
      try {
        response = await (options.fetch ?? fetch)(endpointUrl({ ...endpoint, path: "/responses" }), {
          method: "POST",
          headers: { "content-type": "application/json", "accept": "text/event-stream", authorization: `Bearer ${apiKey}`, ...(options.idempotencyKey === undefined ? {} : { "idempotency-key": options.idempotencyKey }) },
          body: responseRequestToWireJson(openaiResponseRequest({ ...request, stream: true })),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } catch (error) {
        yield { kind: "openai.responses.stream.failure", condition: options.signal?.aborted === true ? "cancelled" : "unreachable", reason: options.signal?.aborted === true ? "OpenAI Responses request was cancelled" : error instanceof Error ? error.message : String(error) };
        return;
      }
      if (!response.ok) {
        const body = await response.text();
        yield { kind: "openai.responses.stream.failure", condition: response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 429 ? "rate-limited" : "rejected", reason: errorReason(response.status, body) };
        return;
      }
      if (response.body === null) { yield { kind: "openai.responses.stream.failure", condition: "malformed", reason: "OpenAI Responses streaming response has no body" }; return; }
      try {
        for await (const frame of parseSseByteStream(response.body)) {
          if (frame.data.trim().length === 0 || frame.data.trim() === "[DONE]") continue;
          const event = openaiResponseStreamEvent(JSON.parse(frame.data));
          yield { kind: "openai.responses.stream.event", event };
          if (event.type === "response.completed" || event.type === "response.failed" || event.type === "response.incomplete") return;
        }
      } catch (error) {
        yield { kind: "openai.responses.stream.failure", condition: options.signal?.aborted === true ? "cancelled" : "malformed", reason: options.signal?.aborted === true ? "OpenAI Responses request was cancelled" : error instanceof Error ? error.message : String(error) };
        return;
      }
      yield { kind: "openai.responses.stream.failure", condition: "truncated", reason: "OpenAI Responses stream ended without a terminal response event" };
    },
  });
}
