/**
 * The allowance book: the host-wide allowance ledger projected as a Beancount book, so the
 * Group's consolidated ledger reading (organizing `entityBooks`) shows every subscription pool in
 * its own unit beside the money books. It is a projection, rewritten whole from the ledger each
 * time; nothing is ever posted to it by hand.
 *
 * Each pool keeps its units apart: a commodity names what one unit of a meter or a kind of work
 * is, prefixed by its pool, declared once with its pool, meter or kind, and source, and never
 * priced in money (an unpriced unit stays in its own unit; unknown is never zero).
 *
 *   stated windows  a window the provider states (Codex's week, Claude's five hours and seven
 *                   days) is granted its budget when it opens, used down by each reading's rise,
 *                   and lapses what its last reading left when it turns:
 *                   Assets:Allowances:<Pool>:<Meter>, Income:Allowances:<Pool>:Granted,
 *                   Expenses:Allowances:<Pool>:Used, Expenses:Allowances:<Pool>:Lapsed;
 *   draws           what each consumer drew, in kinds of work (settled holds by principal,
 *                   recorded spends by consumer or source):
 *                   Expenses:Allowances:<Pool>:Spent:<Consumer> against Equity:Allowances:<Pool>:Draws.
 */
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { admitAllowance, admitAllowanceEvidence, entityAllowanceBookOf } from "@red-cup-engineering/organizing/enterprise";
import { allowanceLedgerDeclarations, allowanceLedgerPath, allowanceLedgerUse } from "./allowance-ledger.mjs";
import { DatabaseSync } from "node:sqlite";

const COMMODITY = /^[A-Z][A-Z0-9'._-]{0,22}[A-Z0-9]$/u;

/** A Beancount commodity for `parts`, uppercase and hyphenated, at most 24 characters. */
export function commodityOf(...parts) {
  const name = parts.join("-").toUpperCase().replace(/[^A-Z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (COMMODITY.test(name)) return name;
  const short = `${name.slice(0, 17).replace(/-+$/u, "")}-${createHash("sha256").update(name).digest("hex").slice(0, 6).toUpperCase()}`;
  return /^[A-Z]/u.test(short) ? short : `U${short}`.slice(0, 24);
}

/** A Beancount account component: words capitalised and joined by hyphens. */
export const accountPart = (value) => String(value).split(/[^A-Za-z0-9]+/u).filter(Boolean)
  .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join("-").replace(/^(\d)/u, "N$1") || "Unknown";

/** The short name a pool's units carry: its product's first word (codex, claude, gemini, flow). */
const productOf = (allowance) => String(allowance.product ?? allowance.id).split("-")[0];
/** A window's length as its units name it: 5H, 7D. */
const spanOf = (hours) => (hours % 24 === 0 ? `${hours / 24}D` : `${hours}H`);
/** The commodity of a stated window's percent, and of a kind of work, in one pool. */
const windowUnit = (allowance, meter) => commodityOf(productOf(allowance), spanOf(meter.hours), "percent");
const kindUnit = (allowance, kind) => commodityOf(productOf(allowance), String(kind).split(":").at(-1));

const day = (iso) => iso.slice(0, 10);
const quote = (value) => JSON.stringify(String(value));
const number = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/u, ""));

/** One pool's stated windows, from its readings: each window's grant, uses and lapse as entries. */
function statedEntries(allowance, readings, now, units) {
  const entries = [];
  const pool = accountPart(allowance.id);
  for (const meter of allowance.meters.filter((candidate) => candidate.law === "stated")) {
    const unit = windowUnit(allowance, meter);
    units.set(unit, { pool: allowance.id, meter: meter.id, unit: `percent of the ${spanOf(meter.hours)} window` });
    const asset = `Assets:Allowances:${pool}:${accountPart(meter.id)}`;
    const windows = new Map();
    for (const reading of readings.filter((entry) => entry.meter === meter.id).sort((a, b) => a.at - b.at)) {
      const list = windows.get(reading.resetsAt) ?? [];
      list.push(reading);
      windows.set(reading.resetsAt, list);
    }
    for (const [resetsAt, list] of [...windows].sort(([a], [b]) => a - b)) {
      const opensAt = new Date(resetsAt - meter.hours * 3_600_000).toISOString();
      entries.push({ at: opensAt, text: [`${day(opensAt)} * "${allowance.id} ${meter.id} window opens"`, `  window-resets: ${quote(new Date(resetsAt).toISOString())}`,
        `  ${asset}  ${number(meter.budget)} ${unit}`, `  Income:Allowances:${pool}:Granted  ${number(-meter.budget)} ${unit}`] });
      let level = 0;
      for (const reading of list) {
        const delta = reading.used - level;
        level = reading.used;
        if (delta === 0) continue;
        const at = new Date(reading.at).toISOString();
        entries.push({ at, text: [`${day(at)} * "${allowance.id} ${meter.id} stated at ${number(reading.used)} of ${number(meter.budget)}"`, `  read-at: ${quote(at)}`,
          `  Expenses:Allowances:${pool}:Used  ${number(delta)} ${unit}`, `  ${asset}  ${number(-delta)} ${unit}`] });
      }
      if (resetsAt <= now && level < meter.budget) {
        const at = new Date(resetsAt).toISOString();
        const left = meter.budget - level;
        entries.push({ at, text: [`${day(at)} * "${allowance.id} ${meter.id} window turns; ${number(left)} lapsed unspent"`,
          `  Expenses:Allowances:${pool}:Lapsed  ${number(left)} ${unit}`, `  ${asset}  ${number(-left)} ${unit}`] });
      }
    }
  }
  return entries;
}

/** One pool's draws by consumer, in kinds of work, between `since` and `now`. */
function drawEntries(allowance, use, units) {
  const pool = accountPart(allowance.id);
  return use.consumers.flatMap((consumer) => Object.entries(consumer.kinds).filter(([, count]) => count > 0).map(([kind, count]) => {
    const at = new Date(consumer.last ?? use.now).toISOString();
    const unit = kindUnit(allowance, kind);
    units.set(unit, { pool: allowance.id, kind, unit: `one ${kind}` });
    return { at, text: [`${day(at)} * "${consumer.consumer} drew ${count} ${kind} from ${allowance.id}"`, `  consumer: ${quote(consumer.consumer)}`,
      `  Expenses:Allowances:${pool}:Spent:${accountPart(consumer.consumer)}  ${count} ${unit}`, `  Equity:Allowances:${pool}:Draws  ${-count} ${unit}`] };
  }));
}

/** The commodities and account opens the entries use, declared before the first entry. */
function declarations(entries, units, opened) {
  const accounts = new Map();
  for (const entry of entries) {
    for (const line of entry.text.slice(1)) {
      const posting = /^ {2}([A-Z][A-Za-z0-9:-]+) {2}(-?[\d.]+) ([A-Z][A-Z0-9'._-]+)$/u.exec(line);
      if (posting === null) continue;
      const [, account, , unit] = posting;
      if (!accounts.has(account)) accounts.set(account, new Set());
      accounts.get(account).add(unit);
    }
  }
  const lines = [];
  for (const [unit, meta] of [...units].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${opened} commodity ${unit}`, `  pool: ${quote(meta.pool)}`, ...(meta.meter ? [`  meter: ${quote(meta.meter)}`] : []), ...(meta.kind ? [`  kind: ${quote(meta.kind)}`] : []),
      `  unit: ${quote(meta.unit)}`, `  source: ${quote("computer-inference-engine allowance ledger")}`);
  }
  for (const [account, units] of [...accounts].sort(([a], [b]) => a.localeCompare(b))) lines.push(`${opened} open ${account} ${[...units].sort().join(",")}`);
  return lines;
}

/** Every reading the ledger holds for an allowance, admitted (the ledger keeps them as evidence). */
function readingsOf(storePath, id) {
  const db = new DatabaseSync(storePath, { readOnly: true });
  try {
    return admitAllowanceEvidence(db.prepare("SELECT entry FROM allowance_evidence WHERE allowance = ? ORDER BY at").all(id)
      .map(({ entry }) => JSON.parse(entry)).filter((entry) => entry.type === "reading"));
  } finally { db.close(); }
}

/**
 * The book's text: every pool the ledger knows, its stated windows and its consumers' draws since
 * `since`, for `entity`.
 */
export function allowanceBookText({ storePath = allowanceLedgerPath(), entity, since, now = new Date().toISOString() }) {
  const at = Date.parse(now);
  const allowances = new Map(allowanceLedgerDeclarations({ storePath }).map(({ declaration }) => [declaration.id, { ...admitAllowance(declaration), ...declaration }]));
  const entries = [];
  const units = new Map();
  for (const allowance of allowances.values()) {
    entries.push(...statedEntries(allowance, readingsOf(storePath, allowance.id), at, units));
    entries.push(...drawEntries(allowance, allowanceLedgerUse(allowance, { storePath, since, now }), units));
  }
  entries.sort((a, b) => a.at.localeCompare(b.at) || a.text[0].localeCompare(b.text[0]));
  const opened = entries.length === 0 ? day(now) : day(entries[0].at);
  return [
    `; The ${entity} allowance book: every subscription pool this host draws on, in its own units.`,
    "; A projection of the computer-inference-engine allowance ledger, rewritten whole; never post to it by hand.",
    `; Projected ${now}; draws since ${since}.`,
    "",
    ...declarations(entries, units, opened),
    "",
    ...entries.flatMap((entry) => [...entry.text, ""]),
  ].join("\n");
}

/** Where the node keeps the book: beside the other projected books it consolidates (organizing `entityAllowanceBookOf`). */
export const allowanceBookPath = (entity, environment = process.env) => entityAllowanceBookOf(entity, { environment });

/** Rewrite the book whole, atomically. */
export function writeAllowanceBook({ entity, path = allowanceBookPath(entity), ...options }) {
  if (typeof path !== "string") throw new TypeError("the allowance book needs METROPLAT_WEB_DATA_DIR or a path");
  const text = allowanceBookText({ entity, ...options });
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
  return path;
}
