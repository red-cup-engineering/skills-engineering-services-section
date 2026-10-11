/**
 * Provider-neutral token-usage journal material: EAVT statement rows for a
 * token-usage event or summary. Ported from MetroPlat's
 * `src/integrations/token-usage/persistence.mts`. `toEavt` here is the same
 * plain `[e, a, v, t]` row shape `@red-cup-engineering/eavt-services-section` carries — a
 * caller already holding that package's rows can pass them straight into
 * whatever journal it writes to.
 */
import { jsonUsage, tokenUsageBreakdown, tokenUsageGenAiAttributes } from "./core.mjs";

export const agentSessionTokenUsageFeed = Object.freeze({
  kind: "metroplat.agent-session.token-usage-feed",
  name: "agent-session-token-usage",
});

function toEavt({ e, a, v, t }) {
  return Object.freeze([e, a, v, t]);
}

function eventEntity(event) {
  return Object.freeze({
    protocol: "agent-session-token-usage",
    ...(event.resourceKind === undefined ? {} : { resourceKind: event.resourceKind }),
    ...(event.unit === undefined ? {} : { unit: event.unit }),
    provider: event.provider,
    surface: event.surface,
    source: event.source,
    row: event.row,
    usageKind: event.usageKind,
    ...(event.agentId === undefined ? {} : { agent: event.agentId }),
    ...(event.sessionId === undefined ? {} : { session: event.sessionId }),
    ...(event.requestId === undefined ? {} : { request: event.requestId }),
  });
}

function eventAttribute(event) {
  return Object.freeze({
    event: "measure-token-usage",
    ...(event.resourceKind === undefined ? {} : { resourceKind: event.resourceKind }),
    ...(event.unit === undefined ? {} : { unit: event.unit }),
    provider: event.provider,
    surface: event.surface,
    usageKind: event.usageKind,
  });
}

function eventValue(event) {
  return jsonUsage({
    ...event,
    usageBreakdown: tokenUsageBreakdown(event.usage),
    genAiAttributes: tokenUsageGenAiAttributes(event.usage),
  }, "agent session token usage event");
}

function summaryEntity(summary) {
  return Object.freeze({
    protocol: "agent-session-token-usage",
    ...(summary.resourceKind === undefined ? {} : { resourceKind: summary.resourceKind }),
    ...(summary.unit === undefined ? {} : { unit: summary.unit }),
    provider: summary.provider,
    surface: summary.surface,
    source: summary.source,
    ...(summary.agentId === undefined ? {} : { agent: summary.agentId }),
    ...(summary.sessionId === undefined ? {} : { session: summary.sessionId }),
  });
}

function summaryAttribute(summary) {
  return Object.freeze({
    event: "summarize-token-usage",
    ...(summary.resourceKind === undefined ? {} : { resourceKind: summary.resourceKind }),
    ...(summary.unit === undefined ? {} : { unit: summary.unit }),
    provider: summary.provider,
    surface: summary.surface,
  });
}

function summaryValue(summary) {
  const { rawEvents: _rawEvents, ...summaryWithoutRawEvents } = summary;
  return jsonUsage({
    ...summaryWithoutRawEvents,
    rawEventCount: summary.rawEventCount ?? summary.rawEvents.length,
    usageBreakdown: tokenUsageBreakdown(summary.total),
    genAiAttributes: tokenUsageGenAiAttributes(summary.total),
  }, "agent session token usage summary");
}

export function agentSessionTokenUsageStatementRows(summary, at) {
  return Object.freeze([
    toEavt({
      e: summaryEntity(summary),
      a: summaryAttribute(summary),
      v: summaryValue(summary),
      t: at,
    }),
    ...summary.rawEvents.map((event) => toEavt({
      e: eventEntity(event),
      a: eventAttribute(event),
      v: eventValue(event),
      t: at,
    })),
  ]);
}
