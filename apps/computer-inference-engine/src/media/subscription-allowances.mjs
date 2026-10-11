/**
 * The subscriptions this house's agent CLIs run on, as allowances of organizing's algebra
 * (`content/allowances/<id>.json`): windows the provider states on every turn, a `stated` meter
 * each, read from what the CLI reports and never summed from the house's own sessions, since the
 * account's other sessions draw on the same windows.
 *
 *   chatgpt-codex  Codex's `token_count` rate limits (primary: used_percent, window_minutes, resets_at)
 *   claude-max     Claude Code's `rate_limit_event` (unifiedWindows: utilization, resetsAt)
 *
 * A carrier's session reports its statement; `subscriptionReadings` turns it into ledger evidence,
 * and the session itself into a spend its consumer drew.
 */
import { readFileSync } from "node:fs";
import { admitAllowance } from "@red-cup-engineering/organizing/enterprise/allowances";

const declarations = new Map();
const declared = new Map();

/** The declaration of subscription allowance `id` as written, with the fields only its readers use
 *  (`carries`, a command provider's `kindsByModel` and `refusedOn`). */
export function subscriptionDeclaration(id) {
  if (!/^[a-z0-9-]+$/u.test(id)) throw new TypeError("a subscription allowance id is a slug");
  if (!declarations.has(id)) declarations.set(id, Object.freeze(JSON.parse(readFileSync(new URL(`../../content/allowances/${id}.json`, import.meta.url), "utf8"))));
  return declarations.get(id);
}

/** The subscription allowance `id`, admitted from its declaration. */
export function subscriptionAllowance(id) {
  if (!declared.has(id)) declared.set(id, admitAllowance(subscriptionDeclaration(id)));
  return declared.get(id);
}

const toInstant = (seconds) => (Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : undefined);

/**
 * Ledger readings from a CLI's own statement of its windows, at `at`. `statement` is either Codex's
 * `rate_limits` ({primary, secondary}: used_percent, window_minutes, resets_at) or Claude Code's
 * `rate_limit_info` ({unifiedWindows: {five_hour, seven_day}: utilization, resetsAt}). Only windows
 * the allowance meters are read; a window the statement omits says nothing.
 */
export function subscriptionReadings(allowance, statement, { at }) {
  if (statement === null || typeof statement !== "object") return [];
  const meters = new Set(allowance.meters.filter((meter) => meter.law === "stated").map((meter) => meter.id));
  const readings = [];
  const push = (meter, used, resetsAt) => {
    if (!meters.has(meter) || !Number.isFinite(used) || resetsAt === undefined) return;
    // One statement of a window is one reading, whichever session reported it.
    readings.push({ type: "reading", meter, at, used, resetsAt, source: `reading:${allowance.id}:${meter}:${resetsAt}:${used}` });
  };
  for (const [meter, window] of Object.entries(statement.unifiedWindows ?? {})) push(meter, Math.round(Number(window?.utilization) * 10_000) / 100, toInstant(window?.resetsAt));
  for (const meter of ["primary", "secondary"]) {
    const window = statement[meter];
    if (window && typeof window === "object") push(meter, Number(window.used_percent), toInstant(window.resets_at));
  }
  return readings;
}
