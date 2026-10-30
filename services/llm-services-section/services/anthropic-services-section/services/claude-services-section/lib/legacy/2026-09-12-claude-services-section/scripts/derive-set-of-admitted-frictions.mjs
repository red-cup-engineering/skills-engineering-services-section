#!/usr/bin/env node
// One readout: every friction admitted on the rail as a duty between two
// dates, grouped by carrier then kind, with observed/expected/session/date
// per entry, read off MetroPlat's own agent-work-dispatch settlement for each
// day (the rail is production at ops.561.group). Sessions read this before
// asking the founder or re-deriving what today's sessions already hit.
import { resolveWorkRail } from "../src/ops-rail.mjs";
import { cliArgument } from "./lib/claude-hook-input.mjs";

const FRICTION_CELL = /^task:friction-(carrier-falsehood|missing-capability)-/u;
const CARRIER_FALSEHOOD_TEXT = /^(?<carrier>.+?) states (?<observed>".*?") but on disk (?<expected>.+?)\. Repair: /su;
const MISSING_CAPABILITY_TEXT = /^(?<carrier>.+?) needed (?<observed>".*?") and the org offers (?<expected>.+?)\. Repair: /su;

/**
 * Every ISO date from `since` to `until`, inclusive.
 * @param {string} since - `YYYY-MM-DD`
 * @param {string} until - `YYYY-MM-DD`
 * @returns {string[]}
 */
export function datesBetween(since, until) {
  const dates = [];
  const cursor = new Date(`${since}T00:00:00.000Z`);
  const end = new Date(`${until}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime())) throw new TypeError(`since is not a valid ISO date: ${since}`);
  if (Number.isNaN(end.getTime())) throw new TypeError(`until is not a valid ISO date: ${until}`);
  if (end.getTime() < cursor.getTime()) throw new RangeError(`until must not precede since (${until} < ${since})`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function unquote(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * One friction entry read off a dispatch item whose scope is a friction task
 * cell: the kind from the cell, carrier/observed/expected from the task text
 * the admit scripts wrote (a fixed sentence shape), the intent as the session digest.
 * @param {{scope: string, text?: string, intent?: string, state?: string, status?: string}} item
 * @param {string} date
 * @returns {{cell: string, kind: string, carrier: string, observed: string|null, expected: string|null, sessionDigest: string|null, state: string|null, status: string|null, date: string}}
 */
export function frictionEntryOfDispatchItem(item, date) {
  const kind = FRICTION_CELL.exec(item.scope)?.[1] ?? "unknown";
  const text = typeof item.text === "string" ? item.text : "";
  const match = (kind === "carrier-falsehood" ? CARRIER_FALSEHOOD_TEXT : MISSING_CAPABILITY_TEXT).exec(text);
  return Object.freeze({
    cell: item.scope,
    kind,
    carrier: match?.groups?.carrier ?? "unknown",
    observed: match ? unquote(match.groups.observed) : null,
    expected: match?.groups?.expected ?? null,
    sessionDigest: typeof item.intent === "string" ? `structured-work-intent-${item.intent}` : null,
    state: typeof item.state === "string" ? item.state : null,
    status: typeof item.status === "string" ? item.status : null,
    date,
  });
}

/**
 * Groups every friction duty on the rail between two dates by carrier then kind.
 * @param {object} options
 * @param {string} options.since - ISO date (`YYYY-MM-DD`), inclusive
 * @param {string} [options.until] - ISO date (`YYYY-MM-DD`), inclusive; default `since`
 * @param {ReturnType<typeof resolveWorkRail>} [options.work] - the rail; defaults to production.
 * @param {(input: object) => Promise<object>} [options.readDispatch] - overrides the rail's readout (tests).
 * @param {number} [options.limit] - dispatch page size per day.
 * @returns {Promise<object>} `{kind, since, until, count, carriers: readonly {carrier, count, kinds: readonly {kind, count, entries}[]}[]}`
 */
export async function deriveAdmittedFrictions({ since, until = since, work, readDispatch, limit = 500 }) {
  if (typeof since !== "string" || since === "") throw new TypeError("since must be a nonempty ISO date string");
  const read = readDispatch ?? (work ?? resolveWorkRail()).readDispatch;
  const entries = [];
  for (const date of datesBetween(since, until)) {
    const readout = await read({ date, limit });
    const seen = new Set();
    for (const item of readout?.queue ?? []) {
      if (typeof item?.scope !== "string" || !FRICTION_CELL.test(item.scope) || seen.has(item.scope)) continue;
      seen.add(item.scope);
      entries.push(frictionEntryOfDispatchItem(item, date));
    }
  }

  const byCarrier = new Map();
  for (const entry of entries) {
    const kinds = byCarrier.get(entry.carrier) ?? new Map();
    const kindEntries = kinds.get(entry.kind) ?? [];
    kindEntries.push(entry);
    kinds.set(entry.kind, kindEntries);
    byCarrier.set(entry.carrier, kinds);
  }
  const carriers = [...byCarrier.entries()]
    .map(([carrier, kinds]) => {
      const kindGroups = [...kinds.entries()]
        .map(([kind, kindEntries]) => Object.freeze({ kind, count: kindEntries.length, entries: Object.freeze(kindEntries) }))
        .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
      const count = kindGroups.reduce((total, group) => total + group.count, 0);
      return Object.freeze({ carrier, count, kinds: Object.freeze(kindGroups) });
    })
    .sort((left, right) => right.count - left.count || left.carrier.localeCompare(right.carrier));

  return Object.freeze({
    kind: "bare-cedar-fog-claude.admitted-frictions",
    since,
    until,
    count: entries.length,
    carriers: Object.freeze(carriers),
  });
}

function usage() {
  return "Usage: derive-set-of-admitted-frictions --since <YYYY-MM-DD> [--until <YYYY-MM-DD>]\n" +
    "Prints the {kind:\"bare-cedar-fog-claude.admitted-frictions\"} readout of every friction\n" +
    "admitted as a duty on the rail at ops.561.group (task:friction-* scopes) between --since and\n" +
    "--until, inclusive, grouped by carrier then kind with counts at every level.\n";
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--help")) {
    process.stdout.write(usage());
    process.exit(0);
  }
  let work = null;
  try {
    const since = cliArgument("--since");
    if (since === undefined) throw new Error("--since is required");
    work = resolveWorkRail();
    const readout = await deriveAdmittedFrictions({ since, until: cliArgument("--until") ?? since, work });
    process.stdout.write(`${JSON.stringify(readout, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`derive-set-of-admitted-frictions: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await work?.close();
  }
}
