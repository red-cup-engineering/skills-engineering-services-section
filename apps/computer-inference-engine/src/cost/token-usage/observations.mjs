/**
 * Shared token-usage fold: counts, exact costs, grouping, and context/rate pressure.
 * Consumers compose their own ledger, statement-information, and charge readings
 * over this collector; they do not implement a second token-accounting fold.
 */
import { isJsonRecord } from "@red-cup-engineering/json-services-section";
import {
  DEFAULT_TOKEN_USAGE_RESOURCE_KIND,
  DEFAULT_TOKEN_USAGE_UNIT,
  composeTokenUsageCostEstimates,
  tokenUsageMeasurement,
  tokenUsageCostRatesFor,
  tokenUsageCostEstimate,
  tokenUsageBreakdown,
  tokenUsageGenAiAttributes,
  tokenUsageCounts,
} from "./core.mjs";

function stringField(record, key) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberField(record, key) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function usageCounts(value) {
  return tokenUsageCounts(isJsonRecord(value) ? value : {});
}

function eventKey(event) {
  return [
    stringField(event, "resourceKind") ?? DEFAULT_TOKEN_USAGE_RESOURCE_KIND,
    stringField(event, "unit") ?? DEFAULT_TOKEN_USAGE_UNIT,
    stringField(event, "agentId") ?? "unknown-agent",
    stringField(event, "provider") ?? "unknown-provider",
    stringField(event, "surface") ?? "unknown-surface",
    stringField(event, "sessionId") ?? "unknown-session",
    stringField(event, "source") ?? "unknown-source",
    String(numberField(event, "row")),
    stringField(event, "usageKind") ?? "unknown-kind",
  ].join("\n");
}

function cellFor(cells, key, event) {
  const current = cells.get(key);
  if (current !== undefined) return current;
  const agentId = stringField(event, "agentId");
  const sessionId = stringField(event, "sessionId");
  const model = stringField(event, "model");
  const cell = {
    key,
    resourceKind: stringField(event, "resourceKind") ?? DEFAULT_TOKEN_USAGE_RESOURCE_KIND,
    unit: stringField(event, "unit") ?? DEFAULT_TOKEN_USAGE_UNIT,
    provider: stringField(event, "provider") ?? "unknown-provider",
    surface: stringField(event, "surface") ?? "unknown-surface",
    events: 0,
    turns: 0,
    pricedTurns: 0,
    rateLimitEvents: 0,
    duplicateEvents: 0,
    usages: [],
    costEstimates: [],
  };
  if (agentId !== undefined) cell.agentId = agentId;
  if (sessionId !== undefined) cell.sessionId = sessionId;
  if (model !== undefined) cell.model = model;
  cells.set(key, cell);
  return cell;
}

function pushCell(cells, key, event, usageKind, usage, costEstimate) {
  const cell = cellFor(cells, key, event);
  cell.events += 1;
  if (usageKind === "turn") {
    cell.turns += 1;
    cell.usages.push(usage);
    if (costEstimate !== undefined) {
      cell.pricedTurns += 1;
      cell.costEstimates.push(costEstimate);
    }
  }
  if (usageKind === "rate-limit") cell.rateLimitEvents += 1;
  if (usageKind === "duplicate") cell.duplicateEvents += 1;
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : undefined;
}

/**
 * The context a turn was sent with: every call re-reads it whole, so this, not the turn's own
 * tokens, is what the turn costs. Anthropic counts cache reads and writes beside its uncached
 * input; OpenAI counts its cached input within `inputTokens`, so the sum holds for both.
 */
function turnContextTokens(usage) {
  return usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
}

/** Context bands turns are grouped by; past 200k a session re-reads more than a capped window holds. */
const CONTEXT_BANDS = Object.freeze([
  [100_000, "context:0-100k"],
  [200_000, "context:100k-200k"],
  [400_000, "context:200k-400k"],
  [Infinity, "context:400k+"],
]);

function contextBandOf(tokens) {
  return CONTEXT_BANDS.find(([bound]) => tokens <= bound)[1];
}

function contextTokensReading(contexts) {
  if (contexts.length === 0) return undefined;
  const sorted = [...contexts].sort((left, right) => left - right);
  const at = (quantile) => sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))];
  return Object.freeze({ turns: sorted.length, median: at(0.5), p90: at(0.9), peak: sorted[sorted.length - 1] });
}

function pressureBand(pressure) {
  if (pressure > 1) return "over";
  if (pressure > 0.8) return "near";
  return "under";
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rateLimitReadings(value, path = []) {
  if (!isJsonRecord(value)) return Object.freeze([]);
  const usedPercent = finiteNumber(value["used_percent"]);
  const windowMinutes = finiteNumber(value["window_minutes"]);
  const here = usedPercent === undefined
    ? []
    : [Object.freeze({
      path: path.length === 0 ? "rate_limits" : path.join("."),
      usedPercent,
      ...(windowMinutes === undefined ? {} : { windowMinutes }),
    })];
  const nested = Object.entries(value).flatMap(([key, child]) =>
    isJsonRecord(child) ? [...rateLimitReadings(child, Object.freeze([...path, key]))] : []);
  return Object.freeze([...here, ...nested]);
}

function rateLimitPressureOfEvents(events) {
  const readings = events.flatMap((event) => rateLimitReadings(event["rateLimits"]));
  if (readings.length === 0) return undefined;
  const maxUsedPercent = readings.reduce((max, reading) => Math.max(max, reading.usedPercent), 0);
  const pressure = maxUsedPercent / 100;
  const band = pressureBand(pressure);
  return Object.freeze({
    kind: "metroplat.agent-session.token-usage-rate-limit-pressure",
    events: readings.length,
    maxUsedPercent,
    pressure,
    band,
    windows: Object.freeze([...new Set(readings.map((reading) =>
      reading.windowMinutes === undefined ? reading.path : `${reading.path}:${reading.windowMinutes}m`))].sort()),
    evidence: Object.freeze([
      `rate-limit-readings:${readings.length}`,
      `max-used-percent:${maxUsedPercent}`,
      `rate-limit-pressure:${pressure}`,
      `rate-limit-band:${band}`,
    ]),
  });
}

function tokenUsageAverages(total, turns) {
  if (turns <= 0) return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries({
    averageTokensPerTurn: total.totalTokens / turns,
    averageInputTokensPerTurn: total.inputTokens / turns,
    averageOutputTokensPerTurn: total.outputTokens / turns,
  }).filter(([, value]) => Number.isFinite(value))));
}

function tokenUsageRatios(breakdown) {
  const cacheHitRatio = ratio(breakdown.cachedInputTokens + breakdown.cacheReadInputTokens, breakdown.totalInputTokens);
  const cacheWriteRatio = ratio(breakdown.cacheCreationInputTokens, breakdown.totalInputTokens);
  const reasoningOutputRatio = ratio(breakdown.reasoningOutputTokens, breakdown.outputTokens);
  return Object.freeze({
    ...(cacheHitRatio === undefined ? {} : { cacheHitRatio }),
    ...(cacheWriteRatio === undefined ? {} : { cacheWriteRatio }),
    ...(reasoningOutputRatio === undefined ? {} : { reasoningOutputRatio }),
  });
}

function freezeCell(cell) {
  const measurement = tokenUsageMeasurement(cell.usages);
  const { total } = measurement;
  const breakdown = tokenUsageBreakdown(total);
  const costEstimate = cell.costEstimates.length === 0 ? undefined : composeTokenUsageCostEstimates(cell.costEstimates, [`cell:${cell.key}`]);
  const pricingCoverage = ratio(cell.pricedTurns, cell.turns);
  return Object.freeze({
    key: cell.key,
    resourceKind: cell.resourceKind,
    unit: cell.unit,
    ...(cell.agentId === undefined ? {} : { agentId: cell.agentId }),
    provider: cell.provider,
    surface: cell.surface,
    ...(cell.sessionId === undefined ? {} : { sessionId: cell.sessionId }),
    ...(cell.model === undefined ? {} : { model: cell.model }),
    events: cell.events,
    turns: cell.turns,
    pricedTurns: cell.pricedTurns,
    unpricedTurns: cell.turns - cell.pricedTurns,
    ...(pricingCoverage === undefined ? {} : { pricingCoverage }),
    ...tokenUsageAverages(total, cell.turns),
    ...tokenUsageRatios(breakdown),
    ...(costEstimate === undefined || cell.turns === 0 || cell.pricedTurns !== cell.turns ? {} : {
      costMicrodollarsPerTurn: costEstimate.totalMicrodollars / cell.turns,
      costDollarsPerTurn: costEstimate.dollars / cell.turns,
    }),
    rateLimitEvents: cell.rateLimitEvents,
    duplicateEvents: cell.duplicateEvents,
    ...measurement,
    usageBreakdown: breakdown,
    genAiAttributes: tokenUsageGenAiAttributes(total),
    ...(costEstimate === undefined ? {} : { costEstimate }),
  });
}

function sortedCells(cells) {
  return Object.freeze([...cells.values()]
    .map(freezeCell)
    .sort((left, right) => left.key.localeCompare(right.key)));
}

export function agentSessionTokenUsageObservationCollector(options = {}) {
  const tokenCostRateTable = options.tokenCostRateTable
    ?? (options.tokenCostRates === undefined ? undefined : Object.freeze({ defaultRates: options.tokenCostRates, entries: Object.freeze([]) }));
  const seen = new Set();
  const byProvider = new Map();
  const byResource = new Map();
  const byUnit = new Map();
  const byAgent = new Map();
  const bySurface = new Map();
  const bySession = new Map();
  const byModel = new Map();
  const byContext = new Map();
  const contexts = [];
  const models = new Set();
  const requests = new Set();
  const modelContextWindows = new Set();
  const statementRows = [];
  const rateLimitEventsObserved = [];
  const usages = [];
  const costEstimates = [];
  let rows = 0;
  let events = 0;
  let duplicateStatementEvents = 0;
  let turns = 0;
  let pricedTurns = 0;
  let rateLimitEvents = 0;
  let duplicateEvents = 0;
  const push = (row) => {
    statementRows.push(row);
    rows += 1;
    const [, , value] = row;
    if (!isJsonRecord(value)) return;
    if (value["kind"] === "metroplat.agent-session.token-usage-summary") {
      const contextWindow = numberField(value, "modelContextWindow");
      if (contextWindow > 0) modelContextWindows.add(contextWindow);
      return;
    }
    if (value["kind"] !== "metroplat.agent-session.token-usage-event") return;
    const key = eventKey(value);
    if (seen.has(key)) {
      duplicateStatementEvents += 1;
      return;
    }
    seen.add(key);
    events += 1;
    const usageKind = stringField(value, "usageKind") ?? "unknown-kind";
    const usage = usageCounts(value["usage"]);
    if (isJsonRecord(value["rateLimits"])) rateLimitEventsObserved.push(value);
    const resourceKind = stringField(value, "resourceKind") ?? DEFAULT_TOKEN_USAGE_RESOURCE_KIND;
    const unit = stringField(value, "unit") ?? DEFAULT_TOKEN_USAGE_UNIT;
    const agentId = stringField(value, "agentId");
    const provider = stringField(value, "provider") ?? "unknown-provider";
    const surface = stringField(value, "surface") ?? "unknown-surface";
    const sessionId = stringField(value, "sessionId") ?? "unknown-session";
    const model = stringField(value, "model");
    const request = stringField(value, "requestId");
    if (model !== undefined) models.add(model);
    if (request !== undefined) requests.add(request);
    if (usageKind === "turn") {
      turns += 1;
      usages.push(usage);
    }
    const rates = usageKind === "turn" && tokenCostRateTable !== undefined
      ? tokenUsageCostRatesFor({
        resourceKind,
        unit,
        ...(agentId === undefined ? {} : { agentId }),
        provider,
        surface,
        ...(model === undefined ? {} : { model }),
        usage,
      }, tokenCostRateTable)
      : undefined;
    const costEstimate = rates === undefined ? undefined : tokenUsageCostEstimate(usage, rates);
    if (costEstimate !== undefined) {
      pricedTurns += 1;
      costEstimates.push(costEstimate);
    }
    if (usageKind === "rate-limit") rateLimitEvents += 1;
    if (usageKind === "duplicate") duplicateEvents += 1;
    pushCell(byProvider, provider, value, usageKind, usage, costEstimate);
    pushCell(byResource, `${resourceKind}/${unit}`, value, usageKind, usage, costEstimate);
    pushCell(byUnit, unit, value, usageKind, usage, costEstimate);
    pushCell(byAgent, agentId ?? "unknown-agent", value, usageKind, usage, costEstimate);
    pushCell(bySurface, `${provider}/${surface}`, value, usageKind, usage, costEstimate);
    pushCell(bySession, `${provider}/${surface}/${sessionId}`, value, usageKind, usage, costEstimate);
    pushCell(byModel, `${provider}/${surface}/${model ?? "unknown-model"}`, value, usageKind, usage, costEstimate);
    if (usageKind === "turn") {
      const context = turnContextTokens(usage);
      if (Number.isFinite(context)) contexts.push(context);
      pushCell(byContext, Number.isFinite(context) ? contextBandOf(context) : "context:unknown", value, usageKind, usage, costEstimate);
    }
  };
  const read = () => {
    const contextWindows = Object.freeze([...modelContextWindows].sort((left, right) => left - right));
    const measurement = tokenUsageMeasurement(usages);
    const { total } = measurement;
    const breakdown = tokenUsageBreakdown(total);
    const costEstimate = costEstimates.length === 0 ? undefined : composeTokenUsageCostEstimates(costEstimates, ["settlement:agent-session-token-usage"]);
    const pricingCoverage = ratio(pricedTurns, turns);
    const contextWindow = contextWindows.length === 1 ? contextWindows[0] : undefined;
    const contextTokens = contextTokensReading(contexts);
    // The fullest window any turn was sent with, against the window it had.
    const contextWindowPressure = contextWindow === undefined || contextWindow <= 0 || contextTokens === undefined
      ? undefined
      : contextTokens.peak / contextWindow;
    const contextWindowPressureBand = contextWindowPressure === undefined ? undefined : pressureBand(contextWindowPressure);
    const rateLimitPressure = rateLimitPressureOfEvents(rateLimitEventsObserved);
    const providerCells = sortedCells(byProvider);
    const resourceCells = sortedCells(byResource);
    const unitCells = sortedCells(byUnit);
    const agentCells = sortedCells(byAgent);
    const surfaceCells = sortedCells(bySurface);
    const sessionCells = sortedCells(bySession);
    const modelCells = sortedCells(byModel);
    return Object.freeze({
      kind: "metroplat.agent-session.token-usage-settlement",
      rows,
      events,
      uniqueEvents: seen.size,
      duplicateStatementEvents,
      turns,
      pricedTurns,
      unpricedTurns: turns - pricedTurns,
      ...(pricingCoverage === undefined ? {} : { pricingCoverage }),
      ...tokenUsageAverages(total, turns),
      ...tokenUsageRatios(breakdown),
      ...(costEstimate === undefined || turns === 0 || pricedTurns !== turns ? {} : {
        costMicrodollarsPerTurn: costEstimate.totalMicrodollars / turns,
        costDollarsPerTurn: costEstimate.dollars / turns,
      }),
      rateLimitEvents,
      duplicateEvents,
      ...measurement,
      usageBreakdown: breakdown,
      genAiAttributes: tokenUsageGenAiAttributes(total),
      ...(costEstimate === undefined ? {} : { costEstimate }),
      ...(contextTokens === undefined ? {} : { contextTokens }),
      ...(contextWindow === undefined ? {} : { modelContextWindow: contextWindow }),
      ...(contextWindowPressure === undefined ? {} : { contextWindowPressure }),
      ...(contextWindowPressureBand === undefined ? {} : { contextWindowPressureBand }),
      ...(rateLimitPressure === undefined ? {} : { rateLimitPressure }),
      modelContextWindows: contextWindows,
      byProvider: providerCells,
      byResource: resourceCells,
      byUnit: unitCells,
      byAgent: agentCells,
      bySurface: surfaceCells,
      bySession: sessionCells,
      byModel: modelCells,
      byContext: sortedCells(byContext),
      models: Object.freeze([...models].sort()),
      requests: Object.freeze([...requests].sort()),
      evidence: Object.freeze([
        "feed:agent-session-token-usage",
        `rows:${rows}`,
        `events:${events}`,
        `turns:${turns}`,
        `priced-turns:${pricedTurns}`,
        `unpriced-turns:${turns - pricedTurns}`,
        `duplicate-statement-events:${duplicateStatementEvents}`,
        ...(contextTokens === undefined ? [] : [`context-tokens-median:${contextTokens.median}`, `context-tokens-p90:${contextTokens.p90}`]),
        ...(contextWindowPressureBand === undefined ? [] : [`context-window-pressure-band:${contextWindowPressureBand}`]),
        ...(rateLimitPressure === undefined ? [] : [`rate-limit-pressure:${rateLimitPressure.pressure}`]),
        ...(tokenCostRateTable === undefined ? [] : ["cost-estimate:token-usage-rates", "cost-estimate:token-usage-rate-table"]),
      ]),
    });
  };
  return Object.freeze({ push, read });
}

export function agentSessionTokenUsageObservationsOfRows(rows, options = {}) {
  const collector = agentSessionTokenUsageObservationCollector(options);
  for (const row of rows) collector.push(row);
  return collector.read();
}
