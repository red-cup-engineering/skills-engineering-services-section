# derive-set-of-usage-records-from-token-usage-summaries
## Requirements
- `one-record-per-single-model-summary`: A `metroplat.agent-session.token-usage-summary`-shaped input naming exactly one model in its `models` array is adapted into one `InferenceTokenUsageRecord` (recordId, sessionId, provider, model, timestamp, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens) matching `@red-cup-engineering/derive-set-of-inference-expense-transactions-service`'s input shape.
- `stable-record-id`: The adapted record's `recordId` is built from the summary's `sessionId` and `source` fields so the same summary always adapts to the same id.
- `explicit-timestamp-input`: Because `TokenUsageSummary` carries no timestamp of its own, each input entry carries an `observedAt` `ISO 8601` date-time supplied by the reader that produced the summary; the adapted record's `timestamp` is exactly that value.
- `reasoning-output-folded-into-output`: `total.reasoningOutputTokens` is added to `total.outputTokens` to form the adapted `outputTokens`, because Anthropic and OpenAI both bill reasoning/thinking output tokens at the standard output-token rate, so the pricing operation's single `output` class covers both.
- `event-sourced-model-attribution`: When a summary carries its own `events` array (each a `{model, usageKind, usage}` row mirroring metroplat's per-event token-usage rows), model attribution is taken from those events instead of the summary's own `models` field, because a summary's `models` array can be empty or `null` even when its own events reliably name a model (observed for Claude Code-sourced Anthropic summaries).
- `turn-events-only`: Only `usageKind: "turn"` events are summed; `duplicate`, `cumulative`, and `rate-limit` events are excluded, because a session's `total` is itself the sum of only its `turn` events (verified against real data) and including the others would double- or over-count.
- `split-not-refuse-on-multi-model-events`: A session whose turn events name more than one billable (non-zero-usage) model is SPLIT into one usage record per model — recordId `${sessionId}#${source}#${model}` — rather than refused, because the per-model usage is directly recoverable from the events (unlike the `models`-array-only path, where the aggregate `total` cannot be safely divided).
- `synthetic-zero-cost-marker-excluded`: A `<synthetic>` event (Claude Code's system-injected marker) carrying all-zero usage is excluded from model grouping entirely, since it is a zero-cost non-billable marker; a `<synthetic>` event that ever carries non-zero usage is kept as its own model group instead of being silently folded away, so it surfaces as an ordinary missing-price refusal.
## Prohibitions
- `no-network-io`: The operation performs no network call, file read, or file write; it is a pure function of its input. [claims: pure-data-transformation]
- `no-model-guess`: A summary whose `models` array is empty (no model identified) or names more than one model (no way to split the aggregate `total` counts per model) is refused rather than assigned a guessed or first-listed model — unless its own `events` resolve the ambiguity per `event-sourced-model-attribution`. [claims: ambiguity-is-refused-not-guessed]
- `no-cache-class-guess`: A summary (or, when events are used, a model group) whose `cachedInputTokens` is non-zero is refused rather than folded into `cacheReadTokens` or `cacheCreationTokens`, because the generic `cachedInputTokens` bucket does not say which class it belongs to and folding it either way risks mispricing or double-counting against `cacheReadInputTokens`/`cacheCreationInputTokens`. [claims: ambiguity-is-refused-not-guessed]
- `no-silent-drop`: Every input summary produces at least one adapted record or refusal naming the summary's provider, sessionId, source, and reason (and, for an events-sourced refusal, the model); none are silently dropped. [claims: every-summary-answers]
## Laws
- `pure-data-transformation-law` | The language law (asserted 2026-08-30) | v1 | .claude/rules/org-layering.md | Applies to deriveSetOfUsageRecordsFromTokenUsageSummaries as data transformation, never I/O. | I/O with a system is written in Node; a decision that is only data transformation performs no I/O of its own.
- `no-silent-price-guess-analog` | Owner working discipline (task:inference-expense-ledger) | v1 | .claude/rules/session-bootstrap.md | Applies this adapter's model and cache-class ambiguity handling. | A group with ambiguous pricing inputs must never be priced or classified by guesswork; it is refused instead, naming what is missing.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation and its import.meta.main guard. | The operation is one executable ESM source file.
- `iso-8601-date-time` | ISO 8601 | 2019 | https://www.iso.org/iso-8601-date-and-time-format.html | Applies to every input `observedAt` and output `timestamp`. | Timestamps are ISO 8601 date-time strings.
## Open questions
none
## Claims
- `pure-data-transformation` | derived | world | A decision that is only data transformation performs no I/O of its own | none | constraint:pure-data-transformation-law | The law states that I/O with a system is written in Node and a pure data transformation performs none
- `ambiguity-is-refused-not-guessed` | derived | world | A model or cache class that the input leaves ambiguous is refused, naming what is missing, not guessed | none | constraint:no-silent-price-guess-analog | The law forbids pricing or classifying an ambiguous group by guesswork and directs that it be refused naming what is missing
- `every-summary-answers` | derived | world | Every input summary produces a record or a named refusal | none | constraint:no-silent-price-guess-analog; requirement:one-record-per-single-model-summary | The law makes ambiguity a named refusal and the requirement makes a clean summary a record, so no input is left without an answer
## Package
```json
{"packageName":"@red-cup-engineering/inference-expense-ledger-services-section","packageVersion":"0.1.0","license":"UNLICENSED","dependencies":{},"devDependencies":{}}
```
## Operation
```mjs path=scripts/derive-set-of-usage-records-from-token-usage-summaries.mjs
#!/usr/bin/env node
const SUMMARY_KIND = "metroplat.agent-session.token-usage-summary";
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u;
const COUNT_FIELDS = ["inputTokens", "cachedInputTokens", "cacheCreationInputTokens", "cacheReadInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"];
const EVENT_USAGE_KINDS = ["turn", "cumulative", "rate-limit", "duplicate"];
const TURN_USAGE_KIND = "turn";
const SYNTHETIC_MODEL = "<synthetic>";

function requireString(value, context) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`derive-set-of-usage-records-from-token-usage-summaries: ${context} must be a non-empty string`);
  return value;
}

function requireTimestamp(value, context) {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) throw new TypeError(`derive-set-of-usage-records-from-token-usage-summaries: ${context} must be an ISO 8601 date-time string`);
  return value;
}

function requireNonNegativeInteger(value, context) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`derive-set-of-usage-records-from-token-usage-summaries: ${context} must be a non-negative integer`);
  return value;
}

function requireUsageCounts(value, context) {
  if (value === null || typeof value !== "object") throw new TypeError(`derive-set-of-usage-records-from-token-usage-summaries: ${context} must be an object`);
  for (const field of COUNT_FIELDS) requireNonNegativeInteger(value[field], `${context}.${field}`);
  return value;
}

function requireEventUsageKind(value, context) {
  if (!EVENT_USAGE_KINDS.includes(value)) throw new TypeError(`derive-set-of-usage-records-from-token-usage-summaries: ${context} must be one of ${EVENT_USAGE_KINDS.join(", ")}`);
  return value;
}

function validateEventEntry(event, summaryIndex, eventIndex) {
  const context = `summaries[${summaryIndex}].events[${eventIndex}]`;
  if (event === null || typeof event !== "object") throw new TypeError(`derive-set-of-usage-records-from-token-usage-summaries: ${context} must be an object`);
  requireString(event.model, `${context}.model`);
  requireEventUsageKind(event.usageKind, `${context}.usageKind`);
  requireUsageCounts(event.usage, `${context}.usage`);
}

function validateSummaryEntry(entry, index) {
  const context = `summaries[${index}]`;
  if (entry === null || typeof entry !== "object") throw new TypeError(`derive-set-of-usage-records-from-token-usage-summaries: ${context} must be an object`);
  if (entry.kind !== SUMMARY_KIND) throw new TypeError(`derive-set-of-usage-records-from-token-usage-summaries: ${context}.kind must be "${SUMMARY_KIND}"`);
  requireString(entry.provider, `${context}.provider`);
  requireString(entry.sessionId, `${context}.sessionId`);
  requireString(entry.source, `${context}.source`);
  requireTimestamp(entry.observedAt, `${context}.observedAt`);
  if (!Array.isArray(entry.models) || !entry.models.every((model) => typeof model === "string")) {
    throw new TypeError(`derive-set-of-usage-records-from-token-usage-summaries: ${context}.models must be an array of strings`);
  }
  requireUsageCounts(entry.total, `${context}.total`);
  if (entry.events !== undefined) {
    if (!Array.isArray(entry.events)) throw new TypeError(`derive-set-of-usage-records-from-token-usage-summaries: ${context}.events must be an array when present`);
    entry.events.forEach((event, eventIndex) => validateEventEntry(event, index, eventIndex));
  }
}

function zeroUsageCounts() {
  return Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0]));
}

function isZeroUsageCounts(usage) {
  return COUNT_FIELDS.every((field) => usage[field] === 0);
}

function addUsageCounts(a, b) {
  return Object.fromEntries(COUNT_FIELDS.map((field) => [field, a[field] + b[field]]));
}

/**
 * Groups a session's own-model, turn-kind events by model, summing their usage counts. A
 * `duplicate`/`cumulative`/`rate-limit` event is excluded (only `turn` events are
 * non-overlapping, additive usage); a `<synthetic>` event carrying all-zero usage is excluded
 * as the zero-cost system marker it is, but a `<synthetic>` event with any non-zero usage is
 * kept as its own model group so it surfaces as an ordinary missing-price refusal rather than
 * being silently folded away.
 * @param {readonly {model: string, usageKind: string, usage: Record<string, number>}[]} events
 * @returns {[string, Record<string, number>][]} `[model, summedUsage]` pairs with non-zero usage, insertion order.
 */
function groupTurnEventsByModel(events) {
  const byModel = new Map();
  for (const event of events) {
    if (event.usageKind !== TURN_USAGE_KIND) continue;
    if (event.model === SYNTHETIC_MODEL && isZeroUsageCounts(event.usage)) continue;
    byModel.set(event.model, addUsageCounts(byModel.get(event.model) ?? zeroUsageCounts(), event.usage));
  }
  return [...byModel.entries()].filter(([, usage]) => !isZeroUsageCounts(usage));
}

/**
 * @typedef {Object} TokenUsageCountsInput
 * @property {number} inputTokens
 * @property {number} cachedInputTokens
 * @property {number} cacheCreationInputTokens
 * @property {number} cacheReadInputTokens
 * @property {number} outputTokens
 * @property {number} reasoningOutputTokens
 * @property {number} totalTokens
 * @typedef {Object} TokenUsageEventAdapterEntry
 * @property {string} model
 * @property {"turn"|"cumulative"|"rate-limit"|"duplicate"} usageKind
 * @property {TokenUsageCountsInput} usage
 * @typedef {Object} TokenUsageSummaryAdapterEntry
 * @property {"metroplat.agent-session.token-usage-summary"} kind
 * @property {string} provider
 * @property {string} sessionId
 * @property {string} source
 * @property {string} observedAt
 * @property {readonly string[]} models
 * @property {TokenUsageCountsInput} total
 * @property {readonly TokenUsageEventAdapterEntry[]} [events]
 * @typedef {Object} UsageRecordAdaptationInput
 * @property {TokenUsageSummaryAdapterEntry[]} summaries
 * @typedef {Object} InferenceTokenUsageRecord
 * @property {string} recordId
 * @property {string} sessionId
 * @property {string} provider
 * @property {string} model
 * @property {string} timestamp
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheReadTokens
 * @property {number} cacheCreationTokens
 * @typedef {Object} UsageRecordAdaptationRefusal
 * @property {string} provider
 * @property {string} sessionId
 * @property {string} source
 * @property {string} [model]
 * @property {"missing-model"|"ambiguous-model"|"ambiguous-cache-accounting"} reason
 * @typedef {Object} UsageRecordAdaptationSet
 * @property {"InferenceUsageRecordAdaptationSet"} type
 * @property {1} version
 * @property {number} usageRecordCount
 * @property {InferenceTokenUsageRecord[]} usageRecords
 * @property {number} refusalCount
 * @property {UsageRecordAdaptationRefusal[]} refusals
 */

function pushUsageRecord(usageRecords, { sessionId, source, provider, model, observedAt, usage, recordId }) {
  usageRecords.push({
    recordId,
    sessionId,
    provider,
    model,
    timestamp: observedAt,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens + usage.reasoningOutputTokens,
    cacheReadTokens: usage.cacheReadInputTokens,
    cacheCreationTokens: usage.cacheCreationInputTokens,
  });
}

/**
 * Adapts metroplat `metroplat.agent-session.token-usage-summary` records into the `usageRecords` shape `@red-cup-engineering/derive-set-of-inference-expense-transactions-service` prices: a summary naming exactly one model becomes one usage record, folding `reasoningOutputTokens` into `outputTokens`. When a summary carries its own `events` (each a `{model, usageKind, usage}` row), model attribution is taken from those `turn`-kind events instead of the summary's own `models` field — a session whose turn events name exactly one billable model becomes one usage record from the summed event usage, and a session whose turn events name more than one billable model is SPLIT into one usage record per model rather than refused. Without `events`, a summary naming zero or more than one model, or carrying a non-zero generic `cachedInputTokens` that cannot be safely split into `cacheReadTokens`/`cacheCreationTokens`, is refused by name instead of guessed; the same cache-ambiguity refusal applies per model group when `events` are used.
 * @param {UsageRecordAdaptationInput} input A record with the token-usage summaries to adapt, each carrying an externally supplied `observedAt` timestamp.
 * @returns {UsageRecordAdaptationSet} The adapted usage records and every refusal.
 * @throws {TypeError} When the input or a summary entry is malformed.
 */
export function deriveSetOfUsageRecordsFromTokenUsageSummaries(input) {
  if (input === null || typeof input !== "object") throw new TypeError("derive-set-of-usage-records-from-token-usage-summaries: input must be an object");
  if (!Array.isArray(input.summaries)) throw new TypeError("derive-set-of-usage-records-from-token-usage-summaries: input.summaries must be an array");
  input.summaries.forEach((entry, index) => validateSummaryEntry(entry, index));

  const usageRecords = [];
  const refusals = [];
  for (const entry of input.summaries) {
    if (Array.isArray(entry.events)) {
      const modelGroups = groupTurnEventsByModel(entry.events);
      if (modelGroups.length === 0) {
        refusals.push({ provider: entry.provider, sessionId: entry.sessionId, source: entry.source, reason: "missing-model" });
        continue;
      }
      const split = modelGroups.length > 1;
      for (const [model, usage] of modelGroups) {
        if (usage.cachedInputTokens > 0) {
          refusals.push({ provider: entry.provider, sessionId: entry.sessionId, source: entry.source, model, reason: "ambiguous-cache-accounting" });
          continue;
        }
        pushUsageRecord(usageRecords, {
          sessionId: entry.sessionId, source: entry.source, provider: entry.provider, model, observedAt: entry.observedAt, usage,
          recordId: split ? `${entry.sessionId}#${entry.source}#${model}` : `${entry.sessionId}#${entry.source}`,
        });
      }
      continue;
    }
    if (entry.models.length === 0) {
      refusals.push({ provider: entry.provider, sessionId: entry.sessionId, source: entry.source, reason: "missing-model" });
      continue;
    }
    if (entry.models.length > 1) {
      refusals.push({ provider: entry.provider, sessionId: entry.sessionId, source: entry.source, reason: "ambiguous-model" });
      continue;
    }
    if (entry.total.cachedInputTokens > 0) {
      refusals.push({ provider: entry.provider, sessionId: entry.sessionId, source: entry.source, reason: "ambiguous-cache-accounting" });
      continue;
    }
    pushUsageRecord(usageRecords, {
      sessionId: entry.sessionId, source: entry.source, provider: entry.provider, model: entry.models[0], observedAt: entry.observedAt, usage: entry.total,
      recordId: `${entry.sessionId}#${entry.source}`,
    });
  }

  return Object.freeze({
    type: "InferenceUsageRecordAdaptationSet",
    version: 1,
    usageRecordCount: usageRecords.length,
    usageRecords: Object.freeze(usageRecords),
    refusalCount: refusals.length,
    refusals: Object.freeze(refusals),
  });
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write("deriveSetOfUsageRecordsFromTokenUsageSummaries — Adapts metroplat token-usage summaries into inference-expense-transaction usage records, taking model attribution from a summary's own turn-kind events when present (splitting a session across models rather than refusing it), and otherwise refusing summaries with no identified model, more than one model, or ambiguous generic cached-token accounting.\n");
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) process.stdout.write(`${JSON.stringify(deriveSetOfUsageRecordsFromTokenUsageSummaries(JSON.parse(line)))}\n`);
    }
  }
}

```
## Tests
```mjs path=test/derive-set-of-usage-records-from-token-usage-summaries.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { deriveSetOfUsageRecordsFromTokenUsageSummaries } from "../scripts/derive-set-of-usage-records-from-token-usage-summaries.mjs";

const baseTotal = { inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };

test("adapts a single-model summary, folding reasoning output into output", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "anthropic",
        sessionId: "s1",
        source: "2026/09/04/session-s1.jsonl",
        observedAt: "2026-09-04T10:00:00.000Z",
        models: ["claude-sonnet-5"],
        total: { ...baseTotal, inputTokens: 1000000, outputTokens: 200000, reasoningOutputTokens: 5000, cacheReadInputTokens: 50000, cacheCreationInputTokens: 10000 },
      },
    ],
  });
  assert.equal(result.type, "InferenceUsageRecordAdaptationSet");
  assert.equal(result.usageRecordCount, 1);
  assert.equal(result.refusalCount, 0);
  const [record] = result.usageRecords;
  assert.equal(record.recordId, "s1#2026/09/04/session-s1.jsonl");
  assert.equal(record.provider, "anthropic");
  assert.equal(record.model, "claude-sonnet-5");
  assert.equal(record.timestamp, "2026-09-04T10:00:00.000Z");
  assert.equal(record.inputTokens, 1000000);
  assert.equal(record.outputTokens, 205000);
  assert.equal(record.cacheReadTokens, 50000);
  assert.equal(record.cacheCreationTokens, 10000);
});

test("refuses a summary with zero or multiple identified models", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      { kind: "metroplat.agent-session.token-usage-summary", provider: "openai", sessionId: "s2", source: "rollout-s2.jsonl", observedAt: "2026-08-26T10:47:29.000Z", models: [], total: baseTotal },
      { kind: "metroplat.agent-session.token-usage-summary", provider: "openai", sessionId: "s3", source: "rollout-s3.jsonl", observedAt: "2026-08-26T10:47:29.000Z", models: ["gpt-5-codex", "gpt-5"], total: baseTotal },
    ],
  });
  assert.equal(result.usageRecordCount, 0);
  assert.equal(result.refusalCount, 2);
  assert.equal(result.refusals[0].reason, "missing-model");
  assert.equal(result.refusals[1].reason, "ambiguous-model");
});

test("refuses a summary with non-zero generic cachedInputTokens rather than guessing its class", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "openai",
        sessionId: "s4",
        source: "rollout-s4.jsonl",
        observedAt: "2026-08-26T10:47:29.000Z",
        models: ["gpt-5-codex"],
        total: { ...baseTotal, inputTokens: 1799828, cachedInputTokens: 1686528 },
      },
    ],
  });
  assert.equal(result.usageRecordCount, 0);
  assert.equal(result.refusalCount, 1);
  assert.equal(result.refusals[0].reason, "ambiguous-cache-accounting");
});

test("refuses a malformed entry", () => {
  assert.throws(() => deriveSetOfUsageRecordsFromTokenUsageSummaries({ summaries: [{ kind: "wrong-kind" }] }), /kind must be/u);
  assert.throws(() => deriveSetOfUsageRecordsFromTokenUsageSummaries({ summaries: "not-an-array" }), /input.summaries must be an array/u);
});

test("takes model attribution from a summary's own turn events when present", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "anthropic",
        sessionId: "s5",
        source: "s5.jsonl",
        observedAt: "2026-09-05T10:00:00.000Z",
        models: [],
        total: { ...baseTotal, inputTokens: 9, outputTokens: 4420, cacheReadInputTokens: 18970, cacheCreationInputTokens: 5225 },
        events: [
          { model: "claude-haiku-4-5-20251001", usageKind: "turn", usage: { ...baseTotal, inputTokens: 9, outputTokens: 4420, cacheReadInputTokens: 18970, cacheCreationInputTokens: 5225 } },
          { model: "claude-haiku-4-5-20251001", usageKind: "duplicate", usage: { ...baseTotal, inputTokens: 9, outputTokens: 4420, cacheReadInputTokens: 18970, cacheCreationInputTokens: 5225 } },
        ],
      },
    ],
  });
  assert.equal(result.usageRecordCount, 1);
  assert.equal(result.refusalCount, 0);
  const [record] = result.usageRecords;
  assert.equal(record.recordId, "s5#s5.jsonl");
  assert.equal(record.model, "claude-haiku-4-5-20251001");
  assert.equal(record.inputTokens, 9);
  assert.equal(record.outputTokens, 4420);
  assert.equal(record.cacheReadTokens, 18970);
  assert.equal(record.cacheCreationTokens, 5225);
});

test("splits a session across models instead of refusing it, when its turn events name more than one billable model", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "anthropic",
        sessionId: "s6",
        source: "s6.jsonl",
        observedAt: "2026-09-05T10:00:00.000Z",
        models: ["claude-fable-5-1", "claude-opus-4-8"],
        total: { ...baseTotal, inputTokens: 1050, outputTokens: 224466, cacheReadInputTokens: 35947868, cacheCreationInputTokens: 587963 },
        events: [
          { model: "claude-opus-4-8", usageKind: "turn", usage: { ...baseTotal, inputTokens: 144, outputTokens: 159046, cacheReadInputTokens: 32549729, cacheCreationInputTokens: 292162 } },
          { model: "claude-fable-5-1", usageKind: "turn", usage: { ...baseTotal, inputTokens: 906, outputTokens: 65420, cacheReadInputTokens: 3398139, cacheCreationInputTokens: 295801 } },
        ],
      },
    ],
  });
  assert.equal(result.refusalCount, 0);
  assert.equal(result.usageRecordCount, 2);
  const byModel = Object.fromEntries(result.usageRecords.map((r) => [r.model, r]));
  assert.equal(byModel["claude-opus-4-8"].recordId, "s6#s6.jsonl#claude-opus-4-8");
  assert.equal(byModel["claude-opus-4-8"].inputTokens, 144);
  assert.equal(byModel["claude-fable-5-1"].inputTokens, 906);
  const totalInput = result.usageRecords.reduce((sum, r) => sum + r.inputTokens, 0);
  assert.equal(totalInput, 1050);
});

test("excludes a zero-usage <synthetic> event from model attribution, but keeps a non-zero one as its own group", () => {
  const zeroSynthetic = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "anthropic",
        sessionId: "s7",
        source: "s7.jsonl",
        observedAt: "2026-09-05T10:00:00.000Z",
        models: [],
        total: baseTotal,
        events: [
          { model: "<synthetic>", usageKind: "turn", usage: baseTotal },
          { model: "claude-sonnet-5", usageKind: "turn", usage: { ...baseTotal, inputTokens: 10 } },
        ],
      },
    ],
  });
  assert.equal(zeroSynthetic.usageRecordCount, 1);
  assert.equal(zeroSynthetic.usageRecords[0].model, "claude-sonnet-5");

  const nonZeroSynthetic = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "anthropic",
        sessionId: "s8",
        source: "s8.jsonl",
        observedAt: "2026-09-05T10:00:00.000Z",
        models: [],
        total: baseTotal,
        events: [{ model: "<synthetic>", usageKind: "turn", usage: { ...baseTotal, inputTokens: 5 } }],
      },
    ],
  });
  assert.equal(nonZeroSynthetic.usageRecordCount, 1);
  assert.equal(nonZeroSynthetic.usageRecords[0].model, "<synthetic>");
});

test("refuses a model group whose turn events carry non-zero generic cachedInputTokens", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "openai",
        sessionId: "s9",
        source: "s9.jsonl",
        observedAt: "2026-09-05T10:00:00.000Z",
        models: [],
        total: baseTotal,
        events: [{ model: "gpt-5-codex", usageKind: "turn", usage: { ...baseTotal, inputTokens: 100, cachedInputTokens: 50 } }],
      },
    ],
  });
  assert.equal(result.usageRecordCount, 0);
  assert.equal(result.refusalCount, 1);
  assert.equal(result.refusals[0].reason, "ambiguous-cache-accounting");
  assert.equal(result.refusals[0].model, "gpt-5-codex");
});

```
## Examples
```json name="derive-set-of-usage-records-from-token-usage-summaries example"
{"input":{"summaries":[{"kind":"metroplat.agent-session.token-usage-summary","provider":"anthropic","sessionId":"s1","source":"2026/09/04/session-s1.jsonl","observedAt":"2026-09-04T10:00:00.000Z","models":["claude-sonnet-5"],"total":{"inputTokens":1000000,"cachedInputTokens":0,"cacheCreationInputTokens":10000,"cacheReadInputTokens":50000,"outputTokens":200000,"reasoningOutputTokens":5000,"totalTokens":1265000}}]},"output":{"type":"InferenceUsageRecordAdaptationSet","version":1,"usageRecordCount":1,"usageRecords":[{"recordId":"s1#2026/09/04/session-s1.jsonl","sessionId":"s1","provider":"anthropic","model":"claude-sonnet-5","timestamp":"2026-09-04T10:00:00.000Z","inputTokens":1000000,"outputTokens":205000,"cacheReadTokens":50000,"cacheCreationTokens":10000}],"refusalCount":0,"refusals":[]}}
```
## Traceability
- `one-record-per-single-model-summary` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`, `node-esm-operation`
- `stable-record-id` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `explicit-timestamp-input` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `iso-8601-date-time`
- `reasoning-output-folded-into-output` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `no-network-io` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `no-model-guess` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-silent-price-guess-analog`
- `no-cache-class-guess` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-silent-price-guess-analog`
- `no-silent-drop` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-silent-price-guess-analog`
- `event-sourced-model-attribution` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `turn-events-only` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `split-not-refuse-on-multi-model-events` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-silent-price-guess-analog`
- `synthetic-zero-cost-marker-excluded` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `no-silent-price-guess-analog`
