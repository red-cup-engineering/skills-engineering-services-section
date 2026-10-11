/**
 * Anthropic-specific witnessed token-usage extraction: reading Anthropic
 * Messages API responses (batched and streamed) and Claude Code session
 * transcripts for their own reported token counts, expressed in the
 * provider-neutral shape `@red-cup-engineering/llm-cost-optimization-services-section`'s
 * token-usage engine owns. Ported from MetroPlat's
 * `src/integrations/anthropic/token-usage.mts`.
 */
import { parseSseStream } from "@red-cup-engineering/computer-serialized-content-engineering-services-section/services/http-data-services-section/src/server-sent-event";
import { isJsonRecord } from "@red-cup-engineering/json-services-section";
import { parseLines } from "@red-cup-engineering/jsonl-services-section";
import {
  jsonUsage,
  tokenUsageCounts,
  tokenUsageSummary,
} from "@red-cup-engineering/computer-inference-engine/cost/token-usage/core";

function objectRecord(value) {
  return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function numberField(record, key) {
  const value = record?.[key];
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function stringField(record, key) {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Retain only counts reported by Anthropic; cache buckets are distinct input categories. */
export function anthropicUsageCounts(usage) {
  return tokenUsageCounts({
    inputTokens: usage?.input_tokens,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens,
    cacheReadInputTokens: usage?.cache_read_input_tokens,
    outputTokens: usage?.output_tokens,
  });
}

function usageHasObservations(usage) {
  return objectRecord(usage) !== undefined;
}

function messageSessionId(message) {
  const metadata = objectRecord(message?.["metadata"]);
  return stringField(metadata, "session") ?? stringField(metadata, "session_id") ?? stringField(metadata, "worker");
}

function usageEvent(input) {
  const rawUsage = jsonUsage(input.usage, "Anthropic usage");
  return Object.freeze({
    kind: "metroplat.agent-session.token-usage-event",
    provider: "anthropic",
    surface: input.surface,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    source: input.source,
    row: input.row,
    ...(input.at === undefined ? {} : { at: input.at }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    usageKind: input.usageKind,
    usage: anthropicUsageCounts(input.usage),
    ...(rawUsage === undefined ? {} : { rawUsage }),
    evidence: input.evidence,
  });
}

/** Read one Anthropic Messages API (non-streaming) response's own reported
 *  token usage. */
export function anthropicMessageTokenUsage(messageInput, options = {}) {
  const message = objectRecord(messageInput);
  const usage = objectRecord(message?.["usage"]);
  const requestId = options.requestId ?? stringField(message, "id");
  const source = options.source ?? `anthropic-messages:${requestId ?? "response"}`;
  const sessionId = options.sessionId ?? messageSessionId(message);
  const model = stringField(message, "model");
  const rawEvents = usageHasObservations(usage)
    ? [usageEvent({
      source,
      surface: "messages",
      row: 0,
      usage,
      usageKind: "turn",
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(options.at === undefined ? {} : { at: options.at }),
      ...(model === undefined ? {} : { model }),
      ...(requestId === undefined ? {} : { requestId }),
      evidence: Object.freeze([
        "surface:anthropic-messages",
        "message.usage",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
      ]),
    })]
    : [];
  return tokenUsageSummary({
    provider: "anthropic",
    surface: "messages",
    ...(sessionId === undefined ? {} : { sessionId }),
    source,
    rows: 1,
    rawEvents: Object.freeze(rawEvents),
    evidence: Object.freeze(["source:anthropic-messages-usage"]),
  });
}

/** Anthropic stream usage is cumulative: the last supplied value wins per field. */
export function mergeAnthropicUsage(previous, reported) {
  const record = objectRecord(reported);
  return record === undefined ? previous : Object.freeze({ ...previous, ...record });
}

function mergedStreamingUsage(events) {
  return events.reduce((usage, event) => mergeAnthropicUsage(usage, event.rawUsage), undefined);
}

/** Read one Anthropic Messages API SSE stream's own reported token usage,
 *  folding per-frame `usage` deltas into one cumulative reading and a final
 *  turn event. */
export function anthropicMessageStreamTokenUsageOfContent(content, options = {}) {
  const frames = parseSseStream(content);
  const source = options.source ?? "anthropic-messages-stream";
  let model;
  let requestId = options.requestId;
  let sessionId = options.sessionId;
  const cumulativeEvents = [];
  frames.forEach((frame, index) => {
    if (frame.data.trim().length === 0) return;
    const record = objectRecord(JSON.parse(frame.data));
    if (record === undefined) return;
    const message = objectRecord(record["message"]);
    if (message !== undefined) {
      model = model ?? stringField(message, "model");
      requestId = requestId ?? stringField(message, "id");
      sessionId = sessionId ?? messageSessionId(message);
    }
    const usage = objectRecord(message?.["usage"]) ?? objectRecord(record["usage"]);
    if (!usageHasObservations(usage)) return;
    cumulativeEvents.push(usageEvent({
      source,
      surface: "messages-stream",
      row: index,
      usage,
      usageKind: "cumulative",
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(options.at === undefined ? {} : { at: options.at }),
      ...(model === undefined ? {} : { model }),
      ...(requestId === undefined ? {} : { requestId }),
      evidence: Object.freeze([
        `sse-event:${frame.event ?? "message"}`,
        record["type"] === "message_delta" ? "message_delta.usage:cumulative" : "message_start.message.usage",
      ]),
    }));
  });
  const finalUsage = mergedStreamingUsage(cumulativeEvents);
  const finalEvent = usageHasObservations(finalUsage)
    ? usageEvent({
      source,
      surface: "messages-stream",
      row: frames.length,
      usage: finalUsage,
      usageKind: "turn",
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(options.at === undefined ? {} : { at: options.at }),
      ...(model === undefined ? {} : { model }),
      ...(requestId === undefined ? {} : { requestId }),
      evidence: Object.freeze([
        `sse-frames:${frames.length}`,
        `usage-frames:${cumulativeEvents.length}`,
        "fold:anthropic-message-stream-cumulative-usage",
      ]),
    })
    : undefined;
  return tokenUsageSummary({
    provider: "anthropic",
    surface: "messages-stream",
    ...(sessionId === undefined ? {} : { sessionId }),
    source,
    rows: frames.length,
    rawEvents: Object.freeze([
      ...cumulativeEvents,
      ...(finalEvent === undefined ? [] : [finalEvent]),
    ]),
    evidence: Object.freeze(["source:anthropic-messages-stream-usage"]),
  });
}

function usageIdentity(row, message, usage) {
  const requestId = stringField(row, "requestId");
  const messageId = stringField(message, "id");
  if (requestId !== undefined) return `request:${requestId}`;
  if (messageId !== undefined) return `message:${messageId}`;
  return JSON.stringify({
    model: stringField(message, "model"),
    timestamp: stringField(row, "timestamp"),
    input: numberField(usage, "input_tokens"),
    cacheCreation: numberField(usage, "cache_creation_input_tokens"),
    cacheRead: numberField(usage, "cache_read_input_tokens"),
    output: numberField(usage, "output_tokens"),
  });
}

/** Read one Claude Code session transcript's (JSONL) own reported token
 *  usage, one event per assistant turn, duplicate requests marked rather
 *  than dropped. */
export function claudeSessionTokenUsageOfContent(content, options = {}) {
  const rows = Object.freeze(parseLines(content));
  const source = options.source ?? "claude-session";
  const sessionId = options.sessionId ?? rows
    .map((row) => stringField(objectRecord(row), "sessionId"))
    .find((value) => value !== undefined);
  // A subagent's transcript stamps its agent on every row; a main session's carries none.
  const agentId = options.agentId ?? rows
    .map((row) => stringField(objectRecord(row), "agentId"))
    .find((value) => value !== undefined);
  const seen = new Set();
  const events = [];
  rows.forEach((row, index) => {
    const record = objectRecord(row);
    const message = objectRecord(record?.["message"]);
    const usage = objectRecord(message?.["usage"]);
    if (record === undefined || message === undefined || usage === undefined) return;
    const id = usageIdentity(record, message, usage);
    const duplicate = seen.has(id);
    seen.add(id);
    const rawUsage = jsonUsage(usage, "Claude Code assistant usage");
    const at = stringField(record, "timestamp");
    const model = stringField(message, "model");
    const requestId = stringField(record, "requestId");
    events.push(Object.freeze({
      ...usageEvent({
        source,
        surface: "claude-code",
        row: index,
        usage,
        usageKind: duplicate ? "duplicate" : "turn",
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(agentId === undefined ? {} : { agentId }),
        ...(at === undefined ? {} : { at }),
        ...(model === undefined ? {} : { model }),
        ...(requestId === undefined ? {} : { requestId }),
        evidence: Object.freeze([
          `row:${index}`,
          "message.usage",
          duplicate ? "duplicate-request" : "distinct-request",
        ]),
      }),
      ...(rawUsage === undefined ? {} : { rawUsage }),
    }));
  });
  return tokenUsageSummary({
    provider: "anthropic",
    surface: "claude-code",
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(agentId === undefined ? {} : { agentId }),
    source,
    rows: rows.length,
    rawEvents: Object.freeze(events),
    evidence: Object.freeze(["source:claude-code-message-usage"]),
  });
}
