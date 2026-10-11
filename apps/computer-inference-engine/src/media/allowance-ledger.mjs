/**
 * The allowance ledger: one host-wide store of what each provider allowance has shown and what
 * this host's consumers hold against it, read through organizing's allowance algebra.
 *
 * An allowance (organizing/enterprise allowances.mjs) is a subscription's perishable capacity: its
 * meters, how a spend draws on them, and what each kind of work costs, known or still to learn.
 * The ledger keeps three things per allowance and nothing else:
 *
 *   declaration the allowance as its consumer last presented it, so the ledger knows every pool any
 *             consumer on this host draws on, and one status reads them all;
 *   evidence  what the provider showed: spends (work it accepted), refusals (work it declined for
 *             capacity), balances (what a first-available pool shows left). Each entry has a
 *             source, the provider's own name for it where there is one (a Studio artifact, a
 *             billing line), so the same spend recorded by a consumer and by a sync of the
 *             provider's history is one spend.
 *   holds     what a consumer is about to spend or has in flight: held (reserved before
 *             submission, lapsing after `holdFor` if never attempted), attempted (submitted,
 *             outcome pending), then settled (spent, refused or void) or released. A live hold is
 *             a pending spend at its instant: it counts against the window holding that instant
 *             and no other, so a hold whose consumer died frees itself when its window turns.
 *
 * A hold is admitted when the allowance read with every live hold pending still holds the kind
 * to fit. With `probe`, a consumer may also take one hold where the fit is unknown: its success
 * or refusal is how an unstated price or budget is learned. Admission, attempt and settlement are
 * each one IMMEDIATE transaction, so concurrent consumers on one host serialize on the store.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { admitAllowanceEvidence, allowanceLapses, readAllowance } from "@red-cup-engineering/organizing/enterprise/allowances";

const MINUTE = 60_000;
const LIVE = ["held", "attempted"];

/** One host-wide store, so every consumer of an account draws from the same windows. */
export function allowanceLedgerPath(environment = process.env) {
  const path = environment.INFERENCE_ALLOWANCE_LEDGER_FILE
    ?? join(environment.XDG_STATE_HOME || join(environment.HOME || homedir(), ".local", "state"), "561-group", "computer-inference-engine", "allowance-ledger.sqlite");
  if (typeof path !== "string" || !path.trim()) throw new TypeError("allowance ledger path is required");
  return path;
}

const instant = (value, what) => {
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(at)) throw new TypeError(`${what} must be an instant`);
  return new Date(at).toISOString();
};
const sourceOf = (entry) => entry.source ?? `sha256:${createHash("sha256").update(JSON.stringify(entry)).digest("hex")}`;

function openLedger(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS allowance_evidence (allowance TEXT NOT NULL, source TEXT NOT NULL, at TEXT NOT NULL, entry TEXT NOT NULL, PRIMARY KEY (allowance, source));
    CREATE TABLE IF NOT EXISTS allowance_hold (id TEXT PRIMARY KEY, allowance TEXT NOT NULL, state TEXT NOT NULL, hold TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS allowance_hold_live ON allowance_hold (allowance, state);
    CREATE TABLE IF NOT EXISTS allowance_declaration (allowance TEXT PRIMARY KEY, at TEXT NOT NULL, declaration TEXT NOT NULL);`);
  const evidenceRows = db.prepare("SELECT entry FROM allowance_evidence WHERE allowance = ? ORDER BY at");
  const insertEvidence = db.prepare("INSERT INTO allowance_evidence (allowance, source, at, entry) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING");
  const holdRow = db.prepare("SELECT hold FROM allowance_hold WHERE id = ?");
  const liveRows = db.prepare(`SELECT hold FROM allowance_hold WHERE allowance = ? AND state IN (${LIVE.map(() => "?").join(", ")})`);
  const allRows = db.prepare("SELECT hold FROM allowance_hold WHERE allowance = ?");
  const writeHold = db.prepare("INSERT INTO allowance_hold (id, allowance, state, hold) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET state = excluded.state, hold = excluded.hold");
  const writeDeclaration = db.prepare("INSERT INTO allowance_declaration (allowance, at, declaration) VALUES (?, ?, ?) ON CONFLICT (allowance) DO UPDATE SET at = excluded.at, declaration = excluded.declaration WHERE allowance_declaration.declaration <> excluded.declaration");
  const declarationRows = db.prepare("SELECT allowance, at, declaration FROM allowance_declaration ORDER BY allowance");
  const poolRows = db.prepare("SELECT allowance FROM allowance_evidence UNION SELECT allowance FROM allowance_hold UNION SELECT allowance FROM allowance_declaration ORDER BY allowance");
  const rawEvidenceRows = db.prepare("SELECT entry FROM allowance_evidence WHERE allowance = ? AND at >= ? ORDER BY at");
  const store = {
    evidence: (allowance) => admitAllowanceEvidence(evidenceRows.all(allowance).map(({ entry }) => JSON.parse(entry))),
    record: (allowance, entry) => {
      const source = sourceOf(entry);
      return insertEvidence.run(allowance, source, entry.at, JSON.stringify({ ...entry, source })).changes > 0;
    },
    hold: (id) => { const row = holdRow.get(id); return row ? JSON.parse(row.hold) : null; },
    holds: (allowance, { all = false } = {}) => (all ? allRows.all(allowance) : liveRows.all(allowance, ...LIVE)).map(({ hold }) => JSON.parse(hold)),
    write: (hold) => { writeHold.run(hold.id, hold.allowance, hold.state, JSON.stringify(hold)); return Object.freeze(hold); },
    declare: (allowance) => writeDeclaration.run(allowance.id, new Date().toISOString(), JSON.stringify(allowance)),
    declarations: () => declarationRows.all().map(({ allowance, at, declaration }) => ({ allowance, at, declaration: JSON.parse(declaration) })),
    pools: () => poolRows.all().map(({ allowance }) => allowance),
    rawEvidence: (allowance, since) => rawEvidenceRows.all(allowance, since).map(({ entry }) => JSON.parse(entry)),
    transaction: (work) => {
      db.exec("BEGIN IMMEDIATE");
      try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    close: () => db.close(),
  };
  return store;
}

const withLedger = (storePath, work, allowance) => {
  const store = openLedger(storePath);
  try {
    // Every allowance a consumer draws on is known to the ledger as it was last presented.
    if (Array.isArray(allowance?.meters)) store.declare(allowance);
    return work(store);
  } finally { store.close(); }
};

/** Holds that still count at `now`: attempted ones until settled, held ones until they lapse. */
const liveAt = (holds, now) => holds.filter((hold) => hold.state === "attempted" || (hold.state === "held" && hold.expiresAt > now));
const pendingOf = (holds) => holds.map(({ kind, count, at }) => ({ kind, count, at }));

/** Whether `count` more of `kind` go through: the FOUR fit for one, the guaranteed count for more. */
function fitFor(reading, kind, count) {
  const fit = reading.fits[kind];
  if (count === 1 || fit !== "held") return fit;
  return reading.counts[kind].lo >= count ? "held" : "unknown";
}

function admit(store, allowance, { kind, count, probe, except = null }, now) {
  const live = liveAt(store.holds(allowance.id), now).filter((hold) => hold.id !== except);
  const reading = readAllowance(allowance, store.evidence(allowance.id), { now, pending: pendingOf(live) });
  const fit = fitFor(reading, kind, count);
  if (fit === "held") return { goes: true, probe: false, reading };
  // One probe at a time per allowance: two would learn nothing the first does not.
  if (probe && fit === "unknown" && !live.some((hold) => hold.probe)) return { goes: true, probe: true, reading };
  return { goes: false, reason: fit === "unknown" && probe ? "probing" : fit, reading };
}

/**
 * Reserve `count` of `kind` from `allowance` for `principal`. Returns `{disposition: "held", hold,
 * reading}` or `{disposition: "refused", reason, reading}`, where reason is the kind's fit
 * (denied, unknown, contested) or `probing` when another probe is already out. A hold with the
 * given `id` that exists is returned as it stands, so a consumer may retry its own reservation.
 */
export function holdAllowance(allowance, { id = randomUUID(), kind, count = 1, principal, reference, probe = false, holdFor = 15 * MINUTE }, { storePath, now = new Date() }) {
  if (!(kind in allowance.costs)) throw new TypeError(`allowance ${allowance.id} does not meter ${kind}`);
  if (!Number.isSafeInteger(count) || count < 1) throw new TypeError("hold count must be a positive integer");
  if (typeof principal !== "string" || !principal) throw new TypeError("hold principal is required");
  const at = instant(now, "now");
  return withLedger(storePath, (store) => store.transaction(() => {
    const existing = store.hold(id);
    if (existing) return Object.freeze({ disposition: existing.state, hold: existing });
    const verdict = admit(store, allowance, { kind, count, probe }, at);
    if (!verdict.goes) return Object.freeze({ disposition: "refused", reason: verdict.reason, reading: verdict.reading });
    const hold = store.write({ id, allowance: allowance.id, account: allowance.account, kind, count, at, state: "held", probe: verdict.probe,
      principal, ...(reference ? { reference } : {}), heldAt: at, expiresAt: new Date(Date.parse(at) + holdFor).toISOString() });
    return Object.freeze({ disposition: "held", hold, reading: verdict.reading });
  }), allowance);
}

/**
 * The hold's work is being submitted now. The fit is read again at this instant (the window the
 * hold was taken in may have turned), and the hold's instant moves to now, the spend's own time.
 * A hold that no longer fits is released and the attempt refused.
 */
export function attemptAllowance(allowance, id, { storePath, now = new Date() }) {
  const at = instant(now, "now");
  return withLedger(storePath, (store) => store.transaction(() => {
    const hold = store.hold(id);
    if (!hold || hold.allowance !== allowance.id) throw new Error(`no hold ${id} on allowance ${allowance.id}`);
    if (hold.state === "attempted") return Object.freeze({ disposition: "attempted", hold });
    if (hold.state !== "held") return Object.freeze({ disposition: "refused", reason: `hold-${hold.state}`, hold });
    const verdict = admit(store, allowance, { kind: hold.kind, count: hold.count, probe: hold.probe, except: id }, at);
    if (!verdict.goes) {
      store.write({ ...hold, state: "released", releasedAt: at, why: verdict.reason });
      return Object.freeze({ disposition: "refused", reason: verdict.reason, reading: verdict.reading });
    }
    return Object.freeze({ disposition: "attempted", hold: store.write({ ...hold, at, state: "attempted", attemptedAt: at, probe: verdict.probe }) });
  }), allowance);
}

/**
 * The provider answered. `spent`: it accepted the work, recorded as a spend under `source` (the
 * provider's name for what it made) at the attempt's instant unless `at` says otherwise.
 * `refused`: it declined for capacity, recorded as a refusal (naming `meter` if it said which).
 * `void`: the work failed for any other reason and says nothing about capacity. Settling a
 * settled hold returns it unchanged.
 */
export function settleAllowance(allowance, id, { outcome, source, at, meter, storePath, now = new Date() }) {
  if (!["spent", "refused", "void"].includes(outcome)) throw new TypeError("outcome is spent, refused or void");
  const settledAt = instant(now, "now");
  return withLedger(storePath, (store) => store.transaction(() => {
    const hold = store.hold(id);
    if (!hold || hold.allowance !== allowance.id) throw new Error(`no hold ${id} on allowance ${allowance.id}`);
    if (hold.state === "settled") return Object.freeze({ disposition: "settled", hold });
    const entry = outcome === "spent"
      ? { type: "spend", kind: hold.kind, count: hold.count, at: at ? instant(at, "at") : hold.at, source: source ?? `hold:${id}` }
      : outcome === "refused" ? { type: "refusal", kind: hold.kind, count: hold.count, at: at ? instant(at, "at") : settledAt, ...(meter ? { meter } : {}), source: source ?? `hold:${id}` } : null;
    if (entry) { admitAllowanceEvidence([entry]); store.record(allowance.id, entry); }
    return Object.freeze({ disposition: "settled", hold: store.write({ ...hold, state: "settled", outcome, settledAt, ...(entry ? { evidence: entry.source } : {}) }) });
  }), allowance);
}

/** Return a hold that was never submitted. An attempted hold is in flight and must be settled. */
export function releaseAllowance(allowance, id, { storePath, now = new Date() }) {
  const at = instant(now, "now");
  return withLedger(storePath, (store) => store.transaction(() => {
    const hold = store.hold(id);
    if (!hold || hold.allowance !== allowance.id) throw new Error(`no hold ${id} on allowance ${allowance.id}`);
    if (hold.state !== "held") return Object.freeze({ disposition: hold.state, hold });
    return Object.freeze({ disposition: "released", hold: store.write({ ...hold, state: "released", releasedAt: at }) });
  }), allowance);
}

/** One hold as the ledger has it, or null. */
export const allowanceHold = (id, { storePath }) => withLedger(storePath, (store) => store.hold(id));

/**
 * Record what the provider showed, from wherever it was read (a sync of its history, an operator,
 * a balance page, a session's rate-limit statement). Entries are allowance evidence; one with a
 * source already recorded is skipped. An entry may name its `consumer`, who drew the spend, which
 * the ledger keeps beside it for whoever asks what used a window. Returns how many were new.
 */
export function recordAllowanceEvidence(allowance, entries, { storePath }) {
  const admitted = entries.map((entry) => [admitAllowanceEvidence([entry])[0], typeof entry?.consumer === "string" && entry.consumer ? entry.consumer : undefined]);
  return withLedger(storePath, (store) => store.transaction(() =>
    admitted.reduce((added, [entry, consumer]) => added + (store.record(allowance.id, { ...entry, at: new Date(entry.at).toISOString(), ...(consumer === undefined ? {} : { consumer }) }) ? 1 : 0), 0)), allowance);
}

/** The allowance read at `now` with every live hold pending, and those holds. */
export function readAllowanceLedger(allowance, { storePath, now = new Date() }) {
  const at = instant(now, "now");
  return withLedger(storePath, (store) => {
    const holds = liveAt(store.holds(allowance.id), at);
    return Object.freeze({ reading: readAllowance(allowance, store.evidence(allowance.id), { now: at, pending: pendingOf(holds) }), holds: Object.freeze(holds) });
  }, allowance);
}

/** What the allowance lapsed between `since` and `now`, live holds counted as spent. */
export function allowanceLedgerLapses(allowance, { storePath, since, now = new Date() }) {
  const at = instant(now, "now");
  return withLedger(storePath, (store) => allowanceLapses(allowance, store.evidence(allowance.id), { since, now: at, pending: pendingOf(liveAt(store.holds(allowance.id), at)) }), allowance);
}

/** Every allowance a consumer on this host has drawn on or recorded against, as it last presented
 *  it: `[{allowance, at, declaration}]`. */
export const allowanceLedgerDeclarations = ({ storePath }) => withLedger(storePath, (store) => store.declarations());

/** Every allowance id the ledger holds anything for: evidence, holds or a declaration. */
export const allowanceLedgerPools = ({ storePath }) => withLedger(storePath, (store) => store.pools());

/**
 * What used an allowance between `since` and `now`: its consumers, each with what it drew. A hold
 * names its principal (and the work it referenced); a recorded spend names its consumer, or is
 * known only by its source. Holds still live are counted as in flight.
 */
export function allowanceLedgerUse(allowance, { storePath, since, now = new Date() }) {
  const from = instant(since, "since");
  const to = instant(now, "now");
  return withLedger(storePath, (store) => {
    const consumers = new Map();
    const note = (consumer, field, kind, count, at) => {
      const entry = consumers.get(consumer) ?? { consumer, spent: 0, inFlight: 0, refused: 0, kinds: {}, last: null };
      entry[field] += count;
      entry.kinds[kind] = (entry.kinds[kind] ?? 0) + count;
      if (entry.last === null || at > entry.last) entry.last = at;
      consumers.set(consumer, entry);
    };
    const fromHolds = new Set();
    for (const hold of store.holds(allowance.id, { all: true })) {
      if (hold.at < from || hold.at > to) continue;
      if (hold.state === "settled" && hold.outcome === "spent") { note(hold.principal, "spent", hold.kind, hold.count, hold.at); if (hold.evidence) fromHolds.add(hold.evidence); }
      else if (hold.state === "settled" && hold.outcome === "refused") { note(hold.principal, "refused", hold.kind, hold.count, hold.at); if (hold.evidence) fromHolds.add(hold.evidence); }
      else if (hold.state === "attempted" || (hold.state === "held" && hold.expiresAt > to)) note(hold.principal, "inFlight", hold.kind, hold.count, hold.at);
    }
    for (const entry of store.rawEvidence(allowance.id, from)) {
      if (entry.at > to || fromHolds.has(entry.source) || (entry.type !== "spend" && entry.type !== "refusal")) continue;
      const consumer = entry.consumer ?? `source:${String(entry.source).split(/[:/]/u)[0]}`;
      note(consumer, entry.type === "spend" ? "spent" : "refused", entry.kind, entry.count ?? 1, entry.at);
    }
    return Object.freeze({ allowance: allowance.id, since: from, now: to, consumers: Object.freeze([...consumers.values()].sort((a, b) => b.spent - a.spent || a.consumer.localeCompare(b.consumer))) });
  }, allowance);
}
