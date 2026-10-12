/**
 * The media ledgers' one log: each ledger is a semiotic-eavt store (content-addressed records, each
 * with the instant it was recorded at) beside the name its SQLite store had, and nothing is updated in place.
 * A ledger named `…/allowance-ledger.sqlite` keeps its journal at `…/allowance-ledger.journal`; historical
 * SQL file is received only through a separate explicit offline tool. Runtime opening does not
 * read or convert original SQL custody.
 *
 * Readers fold the journal and see what other processes appended. A writer whose admission depends
 * on what it reads (a hold fitting its allowance, a compare-and-set) runs inside `exclusively`, a
 * lock directory beside the journal, so consumers on one host serialize as they did on the SQLite
 * store's IMMEDIATE transactions. A lock left by a process that died is taken over once stale.
 */
import {assertNativeLedgerCustody} from "./native-ledger-custody.mjs";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { each, put } from "@red-cup-engineering/semiotic-eavt-services-section/store";

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 15_000;
const pause = new Int32Array(new SharedArrayBuffer(4));

/** The journal root a ledger named by `storePath` keeps. */
export const ledgerJournalRoot = (storePath) => {
  if (typeof storePath !== "string" || !storePath.trim()) throw new TypeError("ledger store path is required");
  return `${resolve(storePath).replace(/\.sqlite$/u, "")}.journal`;
};

/** Recording instants that strictly increase within the process, so journal order is append order. */
function instants() {
  let last = 0;
  return () => {
    const now = Math.max(Date.now(), last + 1);
    last = now;
    return new Date(now).toISOString();
  };
}
const recordedAt = instants();

/** One ledger's journal: `record(category, record)` appends a record; `read(category)` folds them in append order. A category is a store type. */
export function openLedgerJournal(storePath) {
  assertNativeLedgerCustody(storePath);
  const root = ledgerJournalRoot(storePath);
  mkdirSync(root, { recursive: true });
  return Object.freeze({
    root,
    // A record is held with the instant it was recorded at; unreadable storage is refused, never skipped.
    record: (category, record) => put(root, category, { at: recordedAt(), record }),
    read: (category) => [...each(root, category, { strict: true })].map(({ record }) => record)
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map(({ record }) => record),
    exclusively: (work) => exclusively(root, work),
  });
}

function exclusively(root, work) {
  const lock = join(root, ".lock");
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { mkdirSync(lock); break; } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let age = 0;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch { continue; }
      if (age > LOCK_STALE_MS) { rmSync(lock, { recursive: true, force: true }); continue; }
      if (Date.now() > deadline) throw new Error(`ledger journal ${root} is held by another writer`);
      Atomics.wait(pause, 0, 0, 5);
    }
  }
  try { return work(); } finally { rmSync(lock, { recursive: true, force: true }); }
}
