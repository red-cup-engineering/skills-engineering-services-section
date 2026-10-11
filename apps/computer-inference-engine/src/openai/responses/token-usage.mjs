import { requireJsonValue } from "@red-cup-engineering/json-services-section";

import { tokenUsageCounts, tokenUsageSummary } from "@red-cup-engineering/computer-inference-engine/cost/token-usage/core";

/** Project supplied Responses usage counts without treating missing details as zero. */
export function openaiResponseUsageCounts(usage) {
  return tokenUsageCounts({
    inputTokens: usage?.input_tokens,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens,
    outputTokens: usage?.output_tokens,
    reasoningOutputTokens: usage?.output_tokens_details?.reasoning_tokens,
    totalTokens: usage?.total_tokens,
  });
}

function responseRequestSessionId(request) {
  const metadata = request === undefined ? undefined : (request)["metadata"];
  if (metadata === undefined || metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const worker = (metadata)["worker"] ?? (metadata)["session"];
  return typeof worker === "string" && worker.trim().length > 0 ? worker.trim() : undefined;
}

export function openaiResponseTokenUsage(
  response,
  options

 = {},
) {
  const usage = response.usage;
  const source = options.source ?? `openai-responses:${response.id}`;
  const sessionId = options.sessionId ?? responseRequestSessionId(options.request);
  const at = new Date(response.created_at * 1000).toISOString();
  const rawEvents = usage === undefined || usage === null
    ? []
    : [Object.freeze({
      kind: "metroplat.agent-session.token-usage-event",
      provider: "openai",
      surface: "responses",
      ...(sessionId === undefined ? {} : { sessionId }),
      source,
      row: 0,
      at,
      model: response.model,
      requestId: response.id,
      usageKind: "turn",
      usage: openaiResponseUsageCounts(usage),
      rawUsage: requireJsonValue(JSON.parse(JSON.stringify(usage)), "OpenAI Responses usage"),
      evidence: Object.freeze([
        "surface:openai-responses",
        "response.usage",
        "input_tokens_details.cached_tokens",
        "output_tokens_details.reasoning_tokens",
      ]),
    })];
  return tokenUsageSummary({
    provider: "openai",
    surface: "responses",
    ...(sessionId === undefined ? {} : { sessionId }),
    source,
    rows: 1,
    rawEvents: Object.freeze(rawEvents),
    evidence: Object.freeze(["source:openai-responses-usage"]),
  });
}
