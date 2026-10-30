// Reads OpenAI Codex CLI's own session rollout logs (~/.codex/sessions/**/*.jsonl)
// and turns them into per-turn token usage and a rough weekly cost estimate
// based on the account's rate-limit window. Nothing here is an official
// OpenAI price; it is an internal estimate derived from the subscription
// amount the caller supplies and the rate-limit percentage Codex reports.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { identify, identifyBytes } from "./content-hash.mjs";

export const DEFAULT_SESSIONS_ROOT = join(homedir(), ".codex", "sessions");

const USAGE_FIELDS = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"];

function digest(value) {
  return Buffer.isBuffer(value) ? identifyBytes(value, "bare-cedar-fog-codex.rollout").id : identify(value, "bare-cedar-fog-codex.usage").id;
}
const int = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
const gcd = (a, b) => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));

function fraction(numerator, denominator = 1n) {
  if (denominator <= 0n) throw new TypeError("fraction denominator must be positive");
  const divisor = gcd(numerator, denominator) || 1n;
  return { numerator: String(numerator / divisor), denominator: String(denominator / divisor) };
}

function decimalFraction(value) {
  const source = String(value);
  if (!/^[0-9]+(?:\.[0-9]+)?$/u.test(source)) throw new TypeError("decimal value must be nonnegative");
  const [whole, decimal = ""] = source.split(".");
  return fraction(BigInt(`${whole}${decimal}`), 10n ** BigInt(decimal.length));
}

function filesBelow(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesBelow(join(path, entry.name)) : entry.name.endsWith(".jsonl") ? [join(path, entry.name)] : []
  );
}

function readRollout(path) {
  const bytes = readFileSync(path);
  const rows = bytes.toString("utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const meta = rows.find((row) => row.type === "session_meta")?.payload;
  return { path, receipt: digest(bytes), sessionId: meta?.id ?? null, rows };
}

function subtractUsage(current, prior = {}) {
  return Object.fromEntries(USAGE_FIELDS.map((field) => [field, Math.max(0, int(current?.[field]) - int(prior?.[field]))]));
}
function addUsage(target, delta) {
  for (const field of USAGE_FIELDS) target[field] += int(delta[field]);
  return target;
}
function exclusiveTokenMix(usage) {
  return {
    uncachedInputTokens: Math.max(0, usage.input_tokens - usage.cached_input_tokens),
    cachedInputTokens: usage.cached_input_tokens,
    ordinaryOutputTokens: Math.max(0, usage.output_tokens - usage.reasoning_output_tokens),
    reasoningOutputTokens: usage.reasoning_output_tokens,
  };
}

function turnUsage(rollout) {
  const turns = [];
  let latestUsage = {};
  let active = null;
  for (const row of rollout.rows) {
    if (row.payload?.type === "token_count") {
      latestUsage = row.payload.info?.total_token_usage ?? latestUsage;
      if (active) {
        active.latestUsage = latestUsage;
        active.latestUsageAt = row.timestamp;
        active.rateLimits = row.payload.rate_limits ?? null;
        active.modelContextWindow = row.payload.info?.model_context_window ?? null;
      }
    } else if (row.payload?.type === "task_started") {
      if (active) turns.push(active);
      active = {
        sessionId: rollout.sessionId, turnId: row.payload.turn_id, startedAt: row.timestamp, completedAt: null,
        baselineUsage: latestUsage, latestUsage, latestUsageAt: null, rateLimits: null, modelContextWindow: null,
        model: null, reasoningEffort: null, patches: [],
      };
    } else if (row.type === "turn_context" && active && row.payload?.turn_id === active.turnId) {
      active.model = row.payload.model ?? null;
      active.reasoningEffort = row.payload.effort ?? null;
    } else if (row.payload?.type === "patch_apply_end" && active && row.payload.turn_id === active.turnId && row.payload.success === true) {
      const changes = row.payload.changes ?? {};
      active.patches.push({ observedAt: row.timestamp, files: Object.keys(changes).sort(), digest: digest(JSON.stringify(changes)) });
    } else if (row.payload?.type === "task_complete" && active && row.payload.turn_id === active.turnId) {
      active.completedAt = row.timestamp;
      turns.push(active);
      active = null;
    }
  }
  if (active) turns.push(active);
  return turns.map((turn) => {
    const end = turn.completedAt ?? turn.latestUsageAt;
    const usage = subtractUsage(turn.latestUsage, turn.baselineUsage);
    return {
      sessionId: turn.sessionId, turnId: turn.turnId, complete: turn.completedAt !== null, startedAt: turn.startedAt, endedAt: end,
      wallTimeMs: end ? Math.max(0, Date.parse(end) - Date.parse(turn.startedAt)) : null,
      usage, exclusiveTokenMix: exclusiveTokenMix(usage), model: turn.model, reasoningEffort: turn.reasoningEffort,
      modelContextWindow: turn.modelContextWindow, rateLimits: turn.rateLimits, patches: turn.patches,
      source: { path: rollout.path, digest: rollout.receipt },
    };
  });
}

function weeklyEstimate(rollouts, monthlySubscription) {
  const events = rollouts
    .flatMap((rollout) => rollout.rows.filter((row) => row.payload?.type === "token_count").map((row) => ({ row, sessionId: rollout.sessionId })))
    .sort((a, b) => Date.parse(a.row.timestamp) - Date.parse(b.row.timestamp));
  const latest = events.at(-1);
  if (!latest?.row.payload.rate_limits?.primary) return null;
  const primary = latest.row.payload.rate_limits.primary;
  const resetSeconds = int(primary.resets_at), windowMinutes = int(primary.window_minutes);
  if (!resetSeconds || !windowMinutes) return null;
  const windowStart = (resetSeconds - windowMinutes * 60) * 1000;
  const bySession = new Map();
  const usage = Object.fromEntries(USAGE_FIELDS.map((field) => [field, 0]));
  for (const event of events) {
    const current = event.row.payload.info?.total_token_usage ?? {};
    const prior = bySession.get(event.sessionId) ?? {};
    if (Date.parse(event.row.timestamp) >= windowStart) addUsage(usage, subtractUsage(current, prior));
    bySession.set(event.sessionId, current);
  }
  const used = decimalFraction(primary.used_percent);
  const monthly = fraction(BigInt(monthlySubscription.numerator), BigInt(monthlySubscription.denominator));
  const weekly = fraction(BigInt(monthly.numerator) * 12n, BigInt(monthly.denominator) * 52n);
  const consumed = fraction(BigInt(weekly.numerator) * BigInt(used.numerator), BigInt(weekly.denominator) * BigInt(used.denominator) * 100n);
  return {
    windowStartedAt: new Date(windowStart).toISOString(),
    windowResetsAt: new Date(resetSeconds * 1000).toISOString(),
    windowMinutes,
    usedPercent: used,
    usage,
    weeklySubscriptionEstimate: { amount: weekly, unit: "USD" },
    consumedSubscriptionEstimate: { amount: consumed, unit: "USD" },
    estimatedCostPerToken: usage.total_tokens > 0
      ? { amount: fraction(BigInt(consumed.numerator), BigInt(consumed.denominator) * BigInt(usage.total_tokens)), unit: "USD-per-token", status: "estimate-not-provider-price" }
      : null,
  };
}

/**
 * Compute per-turn token usage from Codex CLI's session rollout files and,
 * optionally, a weekly cost estimate derived from the account's rate-limit
 * window and a caller-supplied monthly subscription amount.
 */
export function observeUsage({
  sessionsRoot = DEFAULT_SESSIONS_ROOT,
  sessionId,
  turnId,
  monthlySubscription = { numerator: "0", denominator: "1" },
  includeWeekly = true,
} = {}) {
  const paths = filesBelow(resolve(sessionsRoot));
  const cache = new Map();
  const read = (path) => {
    if (!cache.has(path)) cache.set(path, readRollout(path));
    return cache.get(path);
  };
  const relevantPaths = sessionId ? paths.filter((path) => path.includes(sessionId)) : paths;
  const turns = relevantPaths.map(read).flatMap(turnUsage).filter((turn) => (!sessionId || turn.sessionId === sessionId) && (!turnId || turn.turnId === turnId));
  const weekly = includeWeekly && BigInt(monthlySubscription.numerator) > 0n ? weeklyEstimate(paths.map(read), monthlySubscription) : null;
  return {
    observedAt: new Date().toISOString(),
    turns: turns.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
    latestTurn: turns.slice().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null,
    weekly,
  };
}
