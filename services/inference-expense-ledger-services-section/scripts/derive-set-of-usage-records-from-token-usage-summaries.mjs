#!/usr/bin/env node
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";
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
  const result = await runJavascriptNodeOperation({ name: "derive-set-of-usage-records-from-token-usage-summaries", description: "Adapts metroplat `metroplat.agent-session.token-usage-summary` records into the `usageRecords` shape `@red-cup-engineering/derive-set-of-inference-expense-transactions-service` prices: a summary naming exactly one model becomes one usage record, folding `reasoningOutputTokens` into `outputTokens`.", operation: deriveSetOfUsageRecordsFromTokenUsageSummaries }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
