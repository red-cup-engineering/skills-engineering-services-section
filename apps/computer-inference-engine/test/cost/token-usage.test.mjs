import assert from "node:assert/strict";
import test from "node:test";

import {
  ZERO_TOKEN_USAGE,
  composeTokenUsage,
  tokenUsageBreakdown,
  tokenUsageCostEstimate,
  tokenUsageCostRatesFor,
  tokenUsageCounts,
  tokenUsageGenAiAttributes,
  tokenUsageSummary,
  jsonUsage,
} from "../../src/cost/token-usage/core.mjs";
import {
  agentSessionTokenUsageFeed,
  agentSessionTokenUsageStatementRows,
} from "../../src/cost/token-usage/persistence.mjs";
import {
  agentSessionTokenUsageObservationCollector,
  agentSessionTokenUsageObservationsOfRows,
} from "../../src/cost/token-usage/observations.mjs";

test("tokenUsageCounts admits nonnegative integers and totals input+output when totalTokens is absent", () => {
  const usage = tokenUsageCounts({ inputTokens: 5, outputTokens: 2 });
  assert.deepEqual(usage, {
    inputTokens: 5,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 2,
    reasoningOutputTokens: 0,
    totalTokens: 7,
  });
  assert.deepEqual(tokenUsageCounts({}), ZERO_TOKEN_USAGE);
});

test("tokenUsageCostEstimate prices input/output separately and rejects a rate-free query", () => {
  const usage = tokenUsageCounts({ inputTokens: 1_000_000, outputTokens: 500_000 });
  const estimate = tokenUsageCostEstimate(usage, {
    inputMicrodollarsPerMillionTokens: 3_000_000,
    outputMicrodollarsPerMillionTokens: 15_000_000,
  });
  assert.equal(estimate.totalMicrodollars, 3_000_000 + 7_500_000);
  assert.equal(estimate.dollars, (3_000_000 + 7_500_000) / 1_000_000);
  assert.throws(() => tokenUsageCostEstimate(usage, {}));
});

test("tokenUsageCostEstimate exact rational tracks fractional microdollars a float would lose", () => {
  const usage = tokenUsageCounts({ inputTokens: 3, outputTokens: 0 });
  const estimate = tokenUsageCostEstimate(usage, { inputMicrodollarsPerMillionTokens: 1, outputMicrodollarsPerMillionTokens: 1 });
  const component = estimate.components.find((c) => c.kind === "uncached-input");
  assert.equal(component.exactMicrodollars, "3/1000000");
});

test("tokenUsageCostRatesFor selects the first matching entry, falling back to defaultRates", () => {
  const table = {
    defaultRates: { totalMicrodollarsPerMillionTokens: 1 },
    entries: [
      { provider: "anthropic", model: "claude-big", rates: { totalMicrodollarsPerMillionTokens: 9 } },
      { provider: "anthropic", rates: { totalMicrodollarsPerMillionTokens: 5 } },
    ],
  };
  const usage = tokenUsageCounts({ inputTokens: 10, outputTokens: 0 });
  assert.deepEqual(
    tokenUsageCostRatesFor({ provider: "anthropic", model: "claude-big", usage }, table),
    { totalMicrodollarsPerMillionTokens: 9 },
  );
  assert.deepEqual(
    tokenUsageCostRatesFor({ provider: "anthropic", model: "claude-small", usage }, table),
    { totalMicrodollarsPerMillionTokens: 5 },
  );
  assert.deepEqual(
    tokenUsageCostRatesFor({ provider: "openai", usage }, table),
    { totalMicrodollarsPerMillionTokens: 1 },
  );
});

test("tokenUsageBreakdown and tokenUsageGenAiAttributes derive from counts consistently", () => {
  const usage = tokenUsageCounts({ inputTokens: 10, cachedInputTokens: 4, cacheReadInputTokens: 4, outputTokens: 6, reasoningOutputTokens: 2 });
  const breakdown = tokenUsageBreakdown(usage);
  assert.equal(breakdown.uncachedInputTokens, 6);
  assert.equal(breakdown.totalInputTokens, 14); // inputTokens(10) + cacheCreationInputTokens(0) + cacheReadInputTokens(4)
  const attributes = tokenUsageGenAiAttributes(usage);
  assert.equal(attributes["gen_ai.usage.output_tokens"], 6);
  assert.equal(attributes["metroplat.usage.total_tokens"], usage.totalTokens);
});

test("tokenUsageSummary composes turn events into a total and lists distinct models/requests", () => {
  const events = [
    {
      kind: "metroplat.agent-session.token-usage-event",
      provider: "anthropic",
      surface: "messages",
      source: "s",
      row: 0,
      model: "claude-test",
      requestId: "req-1",
      usageKind: "turn",
      usage: tokenUsageCounts({ inputTokens: 5, outputTokens: 2 }),
      evidence: [],
    },
  ];
  const summary = tokenUsageSummary({ provider: "anthropic", surface: "messages", source: "s", rows: 1, rawEvents: events });
  assert.equal(summary.turns, 1);
  assert.equal(summary.total.totalTokens, 7);
  assert.deepEqual(summary.models, ["claude-test"]);
  assert.deepEqual(summary.requests, ["req-1"]);
});

test("jsonUsage round-trips through JSON and rejects non-serializable material", () => {
  assert.equal(jsonUsage(undefined, "x"), undefined);
  assert.deepEqual(jsonUsage({ a: 1 }, "x"), { a: 1 });
  const circular = {};
  circular.self = circular;
  assert.throws(() => jsonUsage(circular, "x"));
});

test("agentSessionTokenUsageStatementRows emits one summary row plus one row per raw event, as plain EAVT rows", () => {
  const events = [{
    kind: "metroplat.agent-session.token-usage-event",
    provider: "anthropic",
    surface: "messages",
    source: "s",
    row: 0,
    usageKind: "turn",
    usage: tokenUsageCounts({ inputTokens: 5, outputTokens: 2 }),
    evidence: [],
  }];
  const summary = tokenUsageSummary({ provider: "anthropic", surface: "messages", source: "s", rows: 1, rawEvents: events });
  const rows = agentSessionTokenUsageStatementRows(summary, "2026-09-11");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.length, 4);
    const [, , , t] = row;
    assert.equal(t, "2026-09-11");
  }
  assert.equal(agentSessionTokenUsageFeed.name, "agent-session-token-usage");
});

test("agentSessionTokenUsageObservationsOfRows folds rows by provider/surface/session and dedupes repeats", () => {
  const events = [
    {
      kind: "metroplat.agent-session.token-usage-event",
      provider: "anthropic",
      surface: "messages",
      sessionId: "session-a",
      source: "s",
      row: 0,
      requestId: "req-1",
      usageKind: "turn",
      usage: tokenUsageCounts({ inputTokens: 5, outputTokens: 2 }),
      evidence: [],
    },
    {
      kind: "metroplat.agent-session.token-usage-event",
      provider: "anthropic",
      surface: "messages",
      sessionId: "session-a",
      source: "s",
      row: 1,
      requestId: "req-2",
      usageKind: "turn",
      usage: tokenUsageCounts({ inputTokens: 3, outputTokens: 1 }),
      evidence: [],
    },
  ];
  const summary = tokenUsageSummary({ provider: "anthropic", surface: "messages", sessionId: "session-a", source: "s", rows: 2, rawEvents: events });
  const rows = agentSessionTokenUsageStatementRows(summary, "2026-09-11");
  const readout = agentSessionTokenUsageObservationsOfRows([...rows, ...rows]); // duplicate the whole feed
  assert.equal(readout.turns, 2);
  assert.equal(readout.total.totalTokens, composeTokenUsage(events.map((e) => e.usage)).totalTokens);
  assert.equal(readout.duplicateStatementEvents, 2, "the second copy of every row must be recognized as a duplicate, not double-counted");
  assert.equal(readout.byProvider.length, 1);
  assert.equal(readout.byProvider[0].provider, "anthropic");
  assert.equal(readout.bySession.length, 1);
  assert.equal(readout.bySession[0].sessionId, "session-a");
});

test("the collector prices turns when a cost-rate table is supplied", () => {
  const collector = agentSessionTokenUsageObservationCollector({
    tokenCostRateTable: { defaultRates: { totalMicrodollarsPerMillionTokens: 10 }, entries: [] },
  });
  collector.push([
    { protocol: "agent-session-token-usage" },
    { event: "measure-token-usage" },
    {
      kind: "metroplat.agent-session.token-usage-event",
      provider: "anthropic",
      surface: "messages",
      source: "s",
      row: 0,
      usageKind: "turn",
      usage: tokenUsageCounts({ inputTokens: 1_000_000, outputTokens: 0 }),
      evidence: [],
    },
    "2026-09-11",
  ]);
  const readout = collector.read();
  assert.equal(readout.pricedTurns, 1);
  assert.ok(readout.costEstimate);
  assert.equal(readout.costEstimate.totalMicrodollars, 10);
});
