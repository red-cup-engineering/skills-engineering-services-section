import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenUsageBreakdown, composeTokenUsageBreakdown, tokenUsageCounts, tokenUsageCostEstimate, tokenUsageGenAiAttributes, composeTokenUsageGenAiAttributes, tokenUsageSummary, tokenUsageMeasurement } from '../../src/cost/token-usage/core.mjs';
import { agentSessionTokenUsageObservationsOfRows } from '../../src/cost/token-usage/observations.mjs';
import { agentSessionTokenUsageStatementRows } from '../../src/cost/token-usage/persistence.mjs';
import { openaiResponseUsageCounts } from '../../src/openai/responses/token-usage.mjs';

// Synthetic counts and rates, never live provider quotes.
const rates = { inputMicrodollarsPerMillionTokens: 1_000_000, cachedInputMicrodollarsPerMillionTokens: 100_000, cacheCreationInputMicrodollarsPerMillionTokens: 1_250_000, cacheReadInputMicrodollarsPerMillionTokens: 100_000, outputMicrodollarsPerMillionTokens: 2_000_000 };
const openai = tokenUsageCounts({ inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 120 });
const anthropic = tokenUsageCounts({ inputTokens: 60, cacheCreationInputTokens: 10, cacheReadInputTokens: 40, outputTokens: 20 });

test('OpenAI inclusive input and reasoning subsets are charged exactly once', () => {
  const estimate = tokenUsageCostEstimate(openai, rates, { provider: 'openai' });
  assert.equal(estimate.exactMicrodollars, '104');
  assert.equal(estimate.components.reduce((sum, c) => sum + c.tokens, 0), 120);
  assert.deepEqual(openai, { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 120 });
});

test('Anthropic additive cache inputs price without fabricated cached-subset or reasoning counts', () => {
  const estimate = tokenUsageCostEstimate(anthropic, rates, { provider: 'anthropic' });
  assert.equal(estimate.exactMicrodollars, '233/2');
  assert.equal(estimate.components.reduce((sum, c) => sum + c.tokens, 0), 130);
  assert.equal(anthropic.cachedInputTokens, undefined);
  assert.equal(anthropic.reasoningOutputTokens, undefined);
});

test('unknown applicable counts remain unpriced when they can change cost', () => {
  assert.equal(tokenUsageCostEstimate({ inputTokens: 100, outputTokens: 20 }, rates, { provider: 'openai' }), undefined);
  assert.equal(tokenUsageCostEstimate({ inputTokens: 60, outputTokens: 20, cacheReadInputTokens: 40 }, rates, { provider: 'anthropic' }), undefined);
  assert.equal(tokenUsageCostEstimate(anthropic, { ...rates, reasoningOutputMicrodollarsPerMillionTokens: 3_000_000 }, { provider: 'anthropic' }), undefined);
  assert.equal(tokenUsageCostEstimate(openai, rates), undefined, 'unidentified legacy basis remains conservative');
});

test('equal rates price containing totals without inventing subset observations', () => {
  const usage = { inputTokens: 100, outputTokens: 20 };
  const estimate = tokenUsageCostEstimate(usage, { inputMicrodollarsPerMillionTokens: 1_000_000, outputMicrodollarsPerMillionTokens: 2_000_000 }, { provider: 'openai' });
  assert.equal(estimate.exactMicrodollars, '140');
  assert.deepEqual(estimate.components.map(c => c.kind), ['input', 'output']);
  assert.deepEqual(usage, { inputTokens: 100, outputTokens: 20 });
});

test('observed zero remains priceable while empty readings never report zero usage', () => {
  assert.equal(tokenUsageCostEstimate({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, rates, { provider: 'openai' }).exactMicrodollars, '0');
  assert.deepEqual(tokenUsageMeasurement([]).total, {});
  assert.deepEqual(tokenUsageSummary({ provider: 'openai', surface: 'responses', source: 'fixture', rows: 1, rawEvents: [] }).genAiAttributes, {});
  assert.equal(tokenUsageCostEstimate({}, { totalMicrodollarsPerMillionTokens: 1 }), undefined);
});

test('impossible subset counts are not clamped into an invented price', () => {
  assert.equal(tokenUsageCostEstimate({ ...openai, cachedInputTokens: 101 }, rates, { provider: 'openai' }), undefined);
  assert.equal(tokenUsageCostEstimate({ ...openai, reasoningOutputTokens: 21 }, rates, { provider: 'openai' }), undefined);
});

test('Responses cache-write counts stay a distinct observed subset', () => {
  const usage = openaiResponseUsageCounts({ input_tokens: 100, input_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 }, output_tokens: 20 });
  assert.equal(usage.cacheWriteInputTokens, 10);
  assert.equal(usage.cacheCreationInputTokens, undefined);
  assert.equal(tokenUsageCostEstimate(usage, { ...rates, cacheWriteInputMicrodollarsPerMillionTokens: 1_250_000 }, { provider: 'openai' }).exactMicrodollars, '213/2');
  assert.equal(tokenUsageCostEstimate(openai, { ...rates, cacheWriteInputMicrodollarsPerMillionTokens: 1_250_000 }, { provider: 'openai' }), undefined);
  assert.equal(tokenUsageGenAiAttributes(usage, { provider: 'openai' })['gen_ai.usage.input_tokens'], 100);
});

test('OTel projections distinguish inclusive and additive inputs and preserve missing details', () => {
  const a = tokenUsageGenAiAttributes(openai, { provider: 'openai' });
  const b = tokenUsageGenAiAttributes(anthropic, { provider: 'anthropic' });
  assert.equal(a['gen_ai.usage.input_tokens'], 100);
  assert.equal(b['gen_ai.usage.input_tokens'], 110);
  assert.equal(a['gen_ai.usage.cache_read.input_tokens'], 40);
  assert.equal(b['gen_ai.usage.cache_read.input_tokens'], 40);
  assert.equal(b['gen_ai.usage.reasoning.output_tokens'], undefined);
  const combined = composeTokenUsageGenAiAttributes([{ provider: 'openai', usage: openai }, { provider: 'anthropic', usage: anthropic }]);
  assert.equal(combined['gen_ai.usage.input_tokens'], 210);
  assert.equal(combined['gen_ai.usage.output_tokens'], 40);
  assert.equal(combined['gen_ai.usage.cache_read.input_tokens'], 80);
  assert.equal(combined['metroplat.usage.total_tokens'], undefined);
  assert.equal(combined['gen_ai.usage.reasoning.output_tokens'], undefined);
});

test('missing or invalid fields and overflow never become complete aggregate telemetry', () => {
  for (const inputTokens of [undefined, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(tokenUsageGenAiAttributes({ inputTokens }, { provider: 'openai' })['gen_ai.usage.input_tokens'], undefined);
  }
  assert.deepEqual(composeTokenUsageGenAiAttributes([{ provider: 'openai', usage: { inputTokens: Number.MAX_SAFE_INTEGER } }, { provider: 'openai', usage: { inputTokens: 1 } }]), {});
  assert.deepEqual(composeTokenUsageGenAiAttributes([{ provider: 'openai', usage: { inputTokens: 2 } }, { provider: 'openai', usage: {} }]), {});
});

test('existing EAVT collector prices and projects mixed providers without losing identities', () => {
  const rows = [{ provider: 'openai', usage: openai }, { provider: 'anthropic', usage: anthropic }].flatMap(({ provider, usage }, row) => {
    const event = { kind: 'metroplat.agent-session.token-usage-event', provider, surface: 'synthetic-test-channel', source: 'fixture', sessionId: 'session', model: `synthetic-${provider}`, requestId: `request-${row}`, row, usageKind: 'turn', usage, evidence: [] };
    return agentSessionTokenUsageStatementRows(tokenUsageSummary({ provider, surface: event.surface, source: 'fixture', rows: 1, rawEvents: [event] }), '2026-10-12');
  });
  const result = agentSessionTokenUsageObservationsOfRows([...rows, ...rows], { tokenCostRates: rates });
  assert.equal(result.pricedTurns, 2);
  assert.equal(result.duplicateStatementEvents, 2);
  assert.equal(result.costEstimate.exactMicrodollars, '441/2');
  assert.equal(result.genAiAttributes['gen_ai.usage.input_tokens'], 210);
  assert.deepEqual(result.requests, ['request-0', 'request-1']);
  assert.equal(result.byProvider.find(c => c.provider === 'openai').genAiAttributes['gen_ai.usage.input_tokens'], 100);
  assert.equal(result.byProvider.find(c => c.provider === 'anthropic').genAiAttributes['gen_ai.usage.input_tokens'], 110);
  assert.equal(rows[1][2].genAiAttributes['gen_ai.usage.input_tokens'], 100);
  assert.equal(rows[3][2].genAiAttributes['gen_ai.usage.input_tokens'], 110);
  assert.equal(result.contextTokens.peak, 110);
});


test('provider breakdowns and ratios use the same cache-inclusive basis as telemetry', () => {
  const written = { inputTokens: 100, cachedInputTokens: 20, cacheWriteInputTokens: 10, outputTokens: 5 };
  const a = tokenUsageBreakdown(written, { provider: 'openai' });
  assert.equal(a.uncachedInputTokens, 70);
  assert.equal(a.totalInputTokens, 100);
  assert.equal(a.totalCachedInputTokens, 20);
  assert.equal(a.totalCacheCreationInputTokens, 10);
  assert.equal(tokenUsageBreakdown(openai, { provider: 'openai' }).uncachedInputTokens, undefined, 'unreported cache-write detail is not measured zero');
  assert.equal(tokenUsageBreakdown(anthropic, { provider: 'anthropic' }).uncachedInputTokens, 60);
  const events = [{ provider: 'openai', usage: written }, { provider: 'anthropic', usage: anthropic }];
  const combined = composeTokenUsageBreakdown(events);
  assert.equal(combined.uncachedInputTokens, 130);
  assert.equal(combined.totalInputTokens, 210);
  assert.equal(combined.totalCachedInputTokens, 60);
  assert.equal(combined.totalCacheCreationInputTokens, 20);
  const rows = events.map((event, row) => [{}, {}, { ...event, kind: 'metroplat.agent-session.token-usage-event', surface: 'fixture', source: 'fixture', row, usageKind: 'turn' }, '2026-10-12']);
  const result = agentSessionTokenUsageObservationsOfRows(rows);
  assert.equal(result.usageBreakdown.uncachedInputTokens, 130);
  assert.equal(result.usageBreakdown.totalInputTokens, result.genAiAttributes['gen_ai.usage.input_tokens']);
  assert.equal(result.cacheHitRatio, 60 / 210);
  assert.equal(result.cacheWriteRatio, 20 / 210);
});
