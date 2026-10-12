/**
 * Provider-neutral LLM token-usage accounting: counts, exact-rational cost
 * pricing, and derived summaries. Ported verbatim (types stripped) from
 * MetroPlat's `src/integrations/token-usage/core.mts` — this module has no
 * dependency on any provider, transport, or MetroPlat-internal concept; it
 * is the reusable engine this section owns.
 */

export const DEFAULT_TOKEN_USAGE_RESOURCE_KIND = "llm-token";
export const DEFAULT_TOKEN_USAGE_UNIT = "token";

export const ZERO_TOKEN_USAGE = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});

function nonnegativeInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function nonnegativeRate(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label}: expected a nonnegative finite microdollar rate`);
  }
  return Math.trunc(value);
}

export function tokenUsageCounts(input = {}) {
  return Object.freeze(Object.fromEntries(Object.keys(ZERO_TOKEN_USAGE)
    .filter((field) => Number.isSafeInteger(input[field]) && input[field] >= 0)
    .map((field) => [field, input[field]])));
}

const MICRODOLLAR_RATE_DENOMINATOR = 1_000_000n;
const MICRODOLLARS_PER_DOLLAR = 1_000_000;

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0n ? 1n : a;
}

function rationalString(numerator, denominator) {
  const divisor = gcd(numerator, denominator);
  const num = numerator / divisor;
  const den = denominator / divisor;
  return den === 1n ? num.toString() : `${num}/${den}`;
}

function costComponent(kind, tokens, microdollarsPerMillionTokens) {
  const admittedTokens = typeof tokens === "bigint" ? tokens : BigInt(nonnegativeInteger(tokens));
  const admittedRate = nonnegativeRate(microdollarsPerMillionTokens, `${kind} rate`);
  const numerator = BigInt(admittedTokens) * BigInt(admittedRate);
  const microdollars = Number(numerator) / Number(MICRODOLLAR_RATE_DENOMINATOR);
  return Object.freeze({
    kind,
    tokens: admittedTokens <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(admittedTokens) : String(admittedTokens),
    microdollarsPerMillionTokens: admittedRate,
    exactMicrodollars: rationalString(numerator, MICRODOLLAR_RATE_DENOMINATOR),
    microdollars,
    dollars: microdollars / MICRODOLLARS_PER_DOLLAR,
  });
}

function rateLimitMatches(value, min, max) {
  if ((min !== undefined || max !== undefined) && !Number.isSafeInteger(value)) return false;
  if (min !== undefined && value < nonnegativeInteger(min)) return false;
  if (max !== undefined && value > nonnegativeInteger(max)) return false;
  return true;
}

function rateEntryMatches(entry, query) {
  if (entry.resourceKind !== undefined && entry.resourceKind !== (query.resourceKind ?? DEFAULT_TOKEN_USAGE_RESOURCE_KIND)) return false;
  if (entry.unit !== undefined && entry.unit !== (query.unit ?? DEFAULT_TOKEN_USAGE_UNIT)) return false;
  if (entry.agentId !== undefined && entry.agentId !== query.agentId) return false;
  if (entry.provider !== undefined && entry.provider !== query.provider) return false;
  if (entry.surface !== undefined && entry.surface !== query.surface) return false;
  if (entry.model !== undefined && entry.model !== query.model) return false;
  if (!rateLimitMatches(query.usage.inputTokens, entry.minInputTokens, entry.maxInputTokens)) return false;
  if (!rateLimitMatches(query.usage.totalTokens, entry.minTotalTokens, entry.maxTotalTokens)) return false;
  return true;
}

export function tokenUsageCostRatesFor(query, table) {
  for (const entry of table.entries) {
    if (rateEntryMatches(entry, query)) return entry.rates;
  }
  return table.defaultRates;
}

export function tokenUsageCostEstimate(usage, rates, { provider } = {}) {
  if (rates.totalMicrodollarsPerMillionTokens !== undefined) {
    if (!Number.isSafeInteger(usage.totalTokens) || usage.totalTokens < 0) return undefined;
    const totalRate = nonnegativeRate(rates.totalMicrodollarsPerMillionTokens, "total token rate");
    const components = Object.freeze([
      costComponent("total", usage.totalTokens, totalRate),
    ]);
    const numerator = BigInt(usage.totalTokens) * BigInt(totalRate);
    const totalMicrodollars = Number(numerator) / Number(MICRODOLLAR_RATE_DENOMINATOR);
    return Object.freeze({
      kind: "metroplat.agent-session.token-usage-cost-estimate",
      totalMicrodollars,
      exactMicrodollars: rationalString(numerator, MICRODOLLAR_RATE_DENOMINATOR),
      dollars: totalMicrodollars / MICRODOLLARS_PER_DOLLAR,
      components,
      evidence: Object.freeze([
        "total tokens priced by resource unit",
      ]),
    });
  }
  if (rates.inputMicrodollarsPerMillionTokens === undefined || rates.outputMicrodollarsPerMillionTokens === undefined) {
    throw new TypeError("tokenUsageCostEstimate: expected total rate or both input and output rates");
  }
  const known = (field) => Number.isSafeInteger(usage[field]) && usage[field] >= 0;
  const inputRate = nonnegativeRate(rates.inputMicrodollarsPerMillionTokens, "input rate");
  const outputRate = nonnegativeRate(rates.outputMicrodollarsPerMillionTokens, "output rate");
  const cachedInputRate = rates.cachedInputMicrodollarsPerMillionTokens === undefined
    ? inputRate : nonnegativeRate(rates.cachedInputMicrodollarsPerMillionTokens, "cached input rate");
  const cacheCreationRate = rates.cacheCreationInputMicrodollarsPerMillionTokens === undefined
    ? inputRate : nonnegativeRate(rates.cacheCreationInputMicrodollarsPerMillionTokens, "cache creation input rate");
  const cacheReadRate = rates.cacheReadInputMicrodollarsPerMillionTokens === undefined
    ? cachedInputRate : nonnegativeRate(rates.cacheReadInputMicrodollarsPerMillionTokens, "cache read input rate");
  const cacheWriteRate = rates.cacheWriteInputMicrodollarsPerMillionTokens === undefined
    ? inputRate : nonnegativeRate(rates.cacheWriteInputMicrodollarsPerMillionTokens, "cache write input rate");
  const reasoningRate = rates.reasoningOutputMicrodollarsPerMillionTokens === undefined
    ? outputRate : nonnegativeRate(rates.reasoningOutputMicrodollarsPerMillionTokens, "reasoning output rate");
  if (!known("inputTokens") || !known("outputTokens")) return undefined;
  const parts = [];
  const add = (kind, tokens, rate) => parts.push(costComponent(kind, tokens, rate));
  // Native provider categories are different bases, not absent observations of zero.
  if (provider === "anthropic") {
    if (!known("cacheCreationInputTokens") || !known("cacheReadInputTokens")) return undefined;
    add("uncached-input", usage.inputTokens, inputRate);
    add("cache-creation-input", usage.cacheCreationInputTokens, cacheCreationRate);
    add("cache-read-input", usage.cacheReadInputTokens, cacheReadRate);
  } else {
    // OpenAI cached/read and cache-write tokens are subsets of inputTokens.
    // Unidentified legacy callers retain their additive cache categories.
    if (provider !== "openai" && (!known("cacheCreationInputTokens") || !known("cacheReadInputTokens"))) return undefined;
    if (!known("cachedInputTokens") && cachedInputRate !== inputRate) return undefined;
    if (provider === "openai" && !known("cacheWriteInputTokens") && cacheWriteRate !== inputRate) return undefined;
    const cached = known("cachedInputTokens") ? usage.cachedInputTokens : 0;
    const written = provider === "openai" && known("cacheWriteInputTokens") ? usage.cacheWriteInputTokens : 0;
    if (BigInt(cached) + BigInt(written) > BigInt(usage.inputTokens)) return undefined;
    add(known("cachedInputTokens") ? "uncached-input" : "input", usage.inputTokens - cached - written, inputRate);
    if (known("cachedInputTokens")) add("cached-input", cached, cachedInputRate);
    if (provider === "openai" && known("cacheWriteInputTokens")) add("cache-write-input", written, cacheWriteRate);
    if (provider !== "openai") {
      add("cache-creation-input", usage.cacheCreationInputTokens, cacheCreationRate);
      add("cache-read-input", usage.cacheReadInputTokens, cacheReadRate);
    }
  }
  if (!known("reasoningOutputTokens") && reasoningRate !== outputRate) return undefined;
  if (known("reasoningOutputTokens")) {
    if (usage.reasoningOutputTokens > usage.outputTokens) return undefined;
    add("output", usage.outputTokens - usage.reasoningOutputTokens, outputRate);
    add("reasoning-output", usage.reasoningOutputTokens, reasoningRate);
  } else add("output", usage.outputTokens, outputRate);
  const components = Object.freeze(parts);
  const numerator = components.reduce((sum, component) =>
    sum + BigInt(component.tokens) * BigInt(component.microdollarsPerMillionTokens), 0n);
  const totalMicrodollars = Number(numerator) / Number(MICRODOLLAR_RATE_DENOMINATOR);
  return Object.freeze({
    kind: "metroplat.agent-session.token-usage-cost-estimate",
    totalMicrodollars,
    exactMicrodollars: rationalString(numerator, MICRODOLLAR_RATE_DENOMINATOR),
    dollars: totalMicrodollars / MICRODOLLARS_PER_DOLLAR,
    components,
    evidence: Object.freeze([
      `input-accounting:${provider === "openai" ? "inclusive-cache" : provider === "anthropic" ? "separate-cache" : "legacy-mixed"}`,
      "unknown breakdown allowed only when its rate equals the containing total rate",
      "reasoning output is a subset of output; cached OpenAI input is a subset of input",
    ]),
  });
}

export function composeTokenUsageCostEstimates(estimates, evidence = []) {
  const componentGroups = new Map();
  for (const estimate of estimates) {
    for (const component of estimate.components) {
      const key = `${component.kind}\n${component.microdollarsPerMillionTokens}`;
      const current = componentGroups.get(key);
      if (current === undefined) {
        componentGroups.set(key, {
          kind: component.kind,
          tokens: BigInt(component.tokens),
          rate: component.microdollarsPerMillionTokens,
        });
      } else {
        current.tokens += BigInt(component.tokens);
      }
    }
  }
  const components = Object.freeze([...componentGroups.values()]
    .map((group) => costComponent(group.kind, group.tokens, group.rate))
    .sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.microdollarsPerMillionTokens - right.microdollarsPerMillionTokens));
  const numerator = components.reduce((sum, component) =>
    sum + BigInt(component.tokens) * BigInt(component.microdollarsPerMillionTokens), 0n);
  const totalMicrodollars = Number(numerator) / Number(MICRODOLLAR_RATE_DENOMINATOR);
  return Object.freeze({
    kind: "metroplat.agent-session.token-usage-cost-estimate",
    totalMicrodollars,
    exactMicrodollars: rationalString(numerator, MICRODOLLAR_RATE_DENOMINATOR),
    dollars: totalMicrodollars / MICRODOLLARS_PER_DOLLAR,
    components,
    evidence: Object.freeze([
      `cost-estimates:${estimates.length}`,
      "cost-components:grouped-by-kind-and-rate",
      ...evidence,
    ]),
  });
}

export function composeTokenUsage(events) {
  return tokenUsageMeasurement(events).total;
}

/** Whole totals require whole coverage; exact partial sums remain evidence. */
export function tokenUsageMeasurement(events) {
  const rows = events.map((usage) => tokenUsageCounts(usage));
  const total = {};
  const partialTotal = {};
  const usageCoverage = {};
  for (const field of Object.keys(ZERO_TOKEN_USAGE)) {
    const observed = rows.filter((usage) => Object.hasOwn(usage, field));
    const amount = observed.reduce((sum, usage) => sum + BigInt(usage[field]), 0n);
    usageCoverage[field] = Object.freeze({ observed: observed.length, expected: rows.length, exactSum: String(amount) });
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    if (rows.length > 0 && observed.length === rows.length) total[field] = Number(amount);
    else if (observed.length > 0) partialTotal[field] = Number(amount);
  }
  return Object.freeze({ total: Object.freeze(total), partialTotal: Object.freeze(partialTotal), usageCoverage: Object.freeze(usageCoverage) });
}

export function tokenUsageBreakdown(usage) {
  return finiteFields({ ...tokenUsageCounts(usage),
    uncachedInputTokens: Math.max(0, usage.inputTokens - usage.cachedInputTokens),
    totalInputTokens: usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens });
}

function finiteFields(record) {
  return Object.freeze(Object.fromEntries(Object.entries(record).filter(([, value]) => Number.isSafeInteger(value))));
}

export function tokenUsageGenAiAttributes(usage, { provider } = {}) {
  const counts = tokenUsageCounts(usage);
  return finiteFields({
    "gen_ai.usage.input_tokens": provider === "openai" ? counts.inputTokens
      : counts.inputTokens + counts.cacheCreationInputTokens + counts.cacheReadInputTokens,
    "gen_ai.usage.output_tokens": counts.outputTokens,
    "gen_ai.usage.cache_read.input_tokens": provider === "openai" ? counts.cachedInputTokens
      : provider === "anthropic" ? counts.cacheReadInputTokens : counts.cachedInputTokens + counts.cacheReadInputTokens,
    "gen_ai.usage.cache_creation.input_tokens": provider === "openai" ? counts.cacheWriteInputTokens : counts.cacheCreationInputTokens,
    "gen_ai.usage.reasoning.output_tokens": counts.reasoningOutputTokens,
    "metroplat.usage.total_tokens": counts.totalTokens,
  });
}

/** Project each provider before summing; a mixed cohort has no single native basis. */
export function composeTokenUsageGenAiAttributes(events) {
  const projections = events.map(({ usage, provider }) => tokenUsageGenAiAttributes(usage, { provider }));
  if (projections.length === 0) return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.keys(projections[0]).flatMap((field) => {
    if (!projections.every((record) => Object.hasOwn(record, field))) return [];
    const sum = projections.reduce((amount, record) => amount + BigInt(record[field]), 0n);
    return sum <= BigInt(Number.MAX_SAFE_INTEGER) ? [[field, Number(sum)]] : [];
  })));
}

export function jsonUsage(value, label) {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new TypeError(`${label}: expected JSON-serializable usage material`, { cause: error });
  }
}

export function tokenUsageSummary(input) {
  const turnEvents = input.rawEvents.filter((event) => event.usageKind === "turn");
  const cumulativeEvents = input.rawEvents.filter((event) => event.usageKind === "cumulative");
  const measurement = tokenUsageMeasurement(turnEvents.length > 0
    ? turnEvents.map((event) => event.usage)
    : input.cumulative === undefined ? [] : [input.cumulative]);
  const { total } = measurement;
  const models = Object.freeze([...new Set(input.rawEvents.flatMap((event) => event.model === undefined ? [] : [event.model]))].sort());
  const requests = Object.freeze([...new Set(input.rawEvents.flatMap((event) => event.requestId === undefined ? [] : [event.requestId]))].sort());
  return Object.freeze({
    kind: "metroplat.agent-session.token-usage-summary",
    provider: input.provider,
    ...(input.resourceKind === undefined ? {} : { resourceKind: input.resourceKind }),
    ...(input.unit === undefined ? {} : { unit: input.unit }),
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    surface: input.surface,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    source: input.source,
    rows: input.rows,
    events: input.rawEvents.length,
    turns: turnEvents.length,
    ...(input.cumulative === undefined ? {} : { cumulative: input.cumulative }),
    ...measurement,
    usageBreakdown: tokenUsageBreakdown(total),
    genAiAttributes: tokenUsageGenAiAttributes(total, { provider: input.provider }),
    ...(input.modelContextWindow === undefined ? {} : { modelContextWindow: input.modelContextWindow }),
    models,
    requests,
    rateLimitEvents: input.rawEvents.filter((event) => event.rateLimits !== undefined || event.usageKind === "rate-limit").length,
    rawEvents: Object.freeze([...input.rawEvents]),
    evidence: Object.freeze([
      `rows:${input.rows}`,
      `events:${input.rawEvents.length}`,
      `turns:${turnEvents.length}`,
      `cumulative-events:${cumulativeEvents.length}`,
      ...(input.evidence ?? []),
    ]),
  });
}

