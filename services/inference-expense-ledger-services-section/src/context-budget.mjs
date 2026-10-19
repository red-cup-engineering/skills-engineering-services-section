// Context budgets per agent, from the expense ledger, and the measured counterfactual of ending an
// agent at a context threshold and continuing in a fresh one from a handoff record.
import { decimalToMicros, tokenCostMicros, microsToDecimal } from "./decimal-money.mjs";

export const DEFAULT_CONTEXT_BUDGET_TOKENS = 200_000;

/** Per session+agent: peak and final context against the budget, with the agent's priced cost. Over-budget agents first, dearest first. */
export function contextBudgetReport(records, { budgetTokens = DEFAULT_CONTEXT_BUDGET_TOKENS } = {}) {
  const byAgent = new Map();
  for (const record of records) {
    const key = `${record.sessionId}\u0000${record.agent.id}`;
    const row = byAgent.get(key) ?? { sessionId: record.sessionId, agentId: record.agent.id, role: record.agent.role, description: record.agent.description, models: [], turns: 0, peakContext: 0, finalContext: 0, turnsOverBudget: 0, costMicros: 0n, unpricedTurns: 0, lastAt: "" };
    row.models.push(record.model);
    row.turns += record.turns;
    row.peakContext = Math.max(row.peakContext, record.context.peak);
    if (record.window.last >= row.lastAt) { row.lastAt = record.window.last; row.finalContext = record.context.final; }
    row.turnsOverBudget += record.context.turnsOver200k;
    if (record.priced) row.costMicros += decimalToMicros(record.costUsd.total); else row.unpricedTurns += record.turns;
    byAgent.set(key, row);
  }
  return [...byAgent.values()]
    .map((row) => ({ ...row, models: [...new Set(row.models)], budgetTokens, overBudget: row.peakContext > budgetTokens, costUsd: microsToDecimal(row.costMicros) }))
    .sort((a, b) => Number(b.overBudget) - Number(a.overBudget) || (b.costMicros > a.costMicros ? 1 : b.costMicros < a.costMicros ? -1 : 0));
}

const sumBy = (requests, kind) => requests.reduce((total, request) => total + request.tokens[kind], 0);

/**
 * What one agent's requests (one model, one speed) would have cost had the agent ended whenever its
 * context passed `thresholdTokens` and a fresh agent continued from a `handoffTokens` record.
 *
 * Model, from the agent's own per-request series: each request's context growth is kept as measured;
 * a fresh agent starts at the agent's own first-request context (its system prompt and tools) plus the
 * handoff record, all written to the cache; later requests read the context so far and write only
 * their growth, at the agent's measured mean write price; uncached input and output are kept as
 * measured; each handoff costs the outgoing agent `handoffTokens` of output to write the record.
 * Not modeled: extra turns a fresh agent spends re-orienting, and cache expiry between agents.
 */
export function simulateHandoff(requests, claim, { thresholdTokens, handoffTokens }) {
  if (requests.length === 0 || claim === null) return null;
  const price = claim.usdPerMillionTokens;
  const writeTokens = sumBy(requests, "cacheWrite5m") + sumBy(requests, "cacheWrite1h");
  const writeMicros = tokenCostMicros(sumBy(requests, "cacheWrite5m"), price.cacheWrite5m) + tokenCostMicros(sumBy(requests, "cacheWrite1h"), price.cacheWrite1h);
  const meanWriteMicrosPerToken = writeTokens === 0 ? 0 : Number(writeMicros) / writeTokens; // micro-USD per token
  // The fixed prefix every fresh agent carries (system prompt, tools, charge) is the smallest context the agent ever had.
  const base = Math.min(...requests.map((request) => request.context));
  if (base + handoffTokens >= thresholdTokens) return { turns: requests.length, thresholdTokens, handoffTokens, simulable: false, reason: "the agent's smallest observed context plus the handoff record already exceeds the threshold" };
  const actualOf = (request) => tokenCostMicros(request.tokens.input, price.input) + tokenCostMicros(request.tokens.cacheWrite5m, price.cacheWrite5m) + tokenCostMicros(request.tokens.cacheWrite1h, price.cacheWrite1h) + tokenCostMicros(request.tokens.cacheRead, price.cacheRead) + tokenCostMicros(request.tokens.output, price.output);
  let actual = 0n;
  let simulated = 0n;
  let handoffs = 0;
  let previousContext = 0;
  let virtual = 0;
  let peakVirtual = 0;
  for (const request of requests) {
    actual += actualOf(request);
    const first = previousContext === 0;
    const growth = first ? request.context : Math.max(0, request.context - previousContext);
    previousContext = request.context;
    if (first) { // the window's first request is kept as measured: what came before it is not in the series
      virtual = request.context;
      peakVirtual = virtual;
      simulated += actualOf(request);
      continue;
    }
    let read = virtual;
    let write = growth;
    virtual += growth;
    if (virtual > thresholdTokens) {
      handoffs += 1;
      simulated += tokenCostMicros(handoffTokens, price.output);
      read = 0;
      virtual = base + handoffTokens + growth;
      write = virtual;
    }
    peakVirtual = Math.max(peakVirtual, virtual);
    simulated += tokenCostMicros(request.tokens.input, price.input) + tokenCostMicros(read, price.cacheRead) + BigInt(Math.round(write * meanWriteMicrosPerToken)) + tokenCostMicros(request.tokens.output, price.output);
  }
  return { turns: requests.length, thresholdTokens, handoffTokens, simulable: true, handoffs, actualMicros: actual, simulatedMicros: simulated, savedMicros: actual - simulated, peakVirtualContext: peakVirtual, peakActualContext: Math.max(...requests.map((request) => request.context)) };
}
