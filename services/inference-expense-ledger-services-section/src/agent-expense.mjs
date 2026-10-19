// Expense records per session, agent and model, from request lists read out of transcripts.
import { createHash } from "node:crypto";
import { findPriceClaim, priceTokens } from "./published-prices.mjs";

export const EXPENSE_RECORD_KIND = "agent-inference-expense";
const TOKEN_KINDS = ["input", "cacheWrite5m", "cacheWrite1h", "cacheRead", "output"];

/** Canonical JSON: keys sorted, so a record's address does not depend on construction order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export const addressOf = (record) => `sha256:${createHash("sha256").update(canonicalJson(record)).digest("hex")}`;

/** True when a request's timestamp lies in [since, until) (ISO strings, either may be omitted). */
export const inWindow = (request, { since, until }) => (since === undefined || request.at >= since) && (until === undefined || request.at < until);

const sum = (values) => values.reduce((a, b) => a + b, 0);

function contextSummary(requests) {
  const contexts = requests.map((request) => request.context);
  return {
    first: contexts[0],
    final: contexts[contexts.length - 1],
    peak: Math.max(...contexts),
    mean: Math.round(sum(contexts) / contexts.length),
    turnsOver200k: contexts.filter((value) => value > 200_000).length,
  };
}

/**
 * Records for one agent's requests (already window-filtered): one per model and speed.
 * `agent` is `{harness, sessionId, agentId, role, meta}`; `claims` the published price claims.
 */
export function expenseRecordsOfAgent(agent, requests, { claims, day, provider = "anthropic", observedThrough, allowLaterPrices = false }) {
  const groups = new Map();
  for (const request of requests) {
    const key = `${request.model}\u0000${request.speed}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(request);
  }
  return [...groups.values()].map((group) => {
    const tokens = Object.fromEntries(TOKEN_KINDS.map((kind) => [kind, sum(group.map((request) => request.tokens[kind]))]));
    const unsplit = sum(group.map((request) => request.cacheWriteUnsplit));
    const { model, speed } = group[0];
    // Cache writes whose TTL the transcript did not split are priced as 5-minute writes, the documented default and the lower price.
    const claim = findPriceClaim(claims, { provider, model, speed, day, allowLater: allowLaterPrices });
    const priced = priceTokens({ ...tokens, cacheWrite5m: tokens.cacheWrite5m + unsplit }, claim);
    const record = {
      kind: EXPENSE_RECORD_KIND,
      provider,
      harness: agent.harness,
      sessionId: agent.sessionId,
      agent: { id: agent.agentId, role: agent.role, type: agent.meta?.agentType ?? null, description: agent.meta?.description ?? null, toolUseId: agent.meta?.toolUseId ?? null },
      model,
      speed,
      day,
      window: { first: group[0].at, last: group[group.length - 1].at },
      observedThrough,
      turns: group.length,
      tokens,
      cacheWriteTtlUnknownTokens: unsplit,
      context: contextSummary(group),
      priced: priced.priced,
      ...(priced.priced ? { costUsd: priced.costUsd, priceClaim: priced.claim, ...(claim.observedAt.slice(0, 10) > day ? { priceObservedAfterUsage: claim.observedAt } : {}) } : { unpricedReason: priced.reason }),
    };
    return { id: addressOf(record), ...record };
  });
}

export function totalsOf(records) {
  const total = { turns: 0, tokens: Object.fromEntries(TOKEN_KINDS.map((kind) => [kind, 0])), pricedMicros: 0n, unpricedTurns: 0 };
  for (const record of records) {
    total.turns += record.turns;
    for (const kind of TOKEN_KINDS) total.tokens[kind] += record.tokens[kind];
    if (record.priced) total.pricedMicros += BigInt(record.costUsd.total.replace(".", ""));
    else total.unpricedTurns += record.turns;
  }
  return total;
}
