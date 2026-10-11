import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  allowanceHold, allowanceLedgerDeclarations, allowanceLedgerEvidence, allowanceLedgerPools, allowanceLedgerUse,
  attemptAllowance, holdAllowance, readAllowanceLedger, recordAllowanceEvidence, releaseAllowance, settleAllowance,
} from "../../src/media/allowance-ledger.mjs";
import { allowanceBookText } from "../../src/media/allowance-book.mjs";
import { openAccountArtifactCapacityStore } from "../../src/media/account-artifact-capacity.mjs";
import { ledgerJournalRoot } from "../../src/media/ledger-journal.mjs";
import { admitAllowance } from "@red-cup-engineering/organizing/enterprise";

const scratch = (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "ledger-journal-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};
// One daily budget of 50 and a 20-credit kind: two fit a day.
const declared = {
  id: "flow-credits", account: "google:fixture", product: "google-flow", unit: "credit", draws: "first",
  meters: [{ id: "daily", law: "period", every: "day", anchor: "2026-10-01T07:00:00Z", budget: 50 }],
  costs: { "veo:fast": 20, "veo:quality": 100 }, because: "fixture",
};
const flow = admitAllowance(declared);
const now = "2026-10-02T12:00:00.000Z";

test("the allowance ledger is a journal: holds, attempts, settlements and evidence, and no SQL", (t) => {
  const storePath = path.join(scratch(t), "allowance-ledger.sqlite");
  const first = holdAllowance(flow, { id: "a", kind: "veo:fast", principal: "studio" }, { storePath, now });
  const second = holdAllowance(flow, { id: "b", kind: "veo:fast", principal: "studio" }, { storePath, now });
  const third = holdAllowance(flow, { id: "c", kind: "veo:fast", principal: "studio" }, { storePath, now });
  assert.deepEqual([first.disposition, second.disposition, third.disposition], ["held", "held", "refused"]);
  assert.equal(holdAllowance(flow, { id: "a", kind: "veo:fast", principal: "studio" }, { storePath, now }).hold.state, "held", "a retried reservation is returned as it stands");
  assert.equal(attemptAllowance(flow, "a", { storePath, now }).disposition, "attempted");
  assert.equal(settleAllowance(flow, "a", { outcome: "spent", source: "studio:artifact-1", storePath, now }).hold.state, "settled");
  assert.equal(releaseAllowance(flow, "b", { storePath, now }).disposition, "released");
  assert.equal(allowanceHold("b", { storePath }).state, "released");
  assert.equal(recordAllowanceEvidence(flow, [{ type: "spend", kind: "veo:fast", at: now, source: "studio:artifact-1" }, { type: "spend", kind: "veo:fast", at: now, source: "sync:2" }], { storePath }), 1, "a spend already recorded under its source is one spend");
  assert.deepEqual(allowanceLedgerEvidence("flow-credits", { storePath }).map((entry) => entry.source), ["studio:artifact-1", "sync:2"]);
  assert.equal(readAllowanceLedger(flow, { storePath, now }).holds.length, 0);
  assert.deepEqual(allowanceLedgerPools({ storePath }), ["flow-credits"]);
  assert.equal(allowanceLedgerDeclarations({ storePath }).length, 1);
  const use = allowanceLedgerUse(flow, { storePath, since: "2026-10-02T00:00:00Z", now });
  assert.deepEqual(use.consumers.map((consumer) => [consumer.consumer, consumer.spent]), [["source:sync", 1], ["studio", 1]]);
  assert.match(allowanceBookText({ storePath, entity: "fixture", since: "2026-10-02T00:00:00Z", now }), /studio drew 1 veo:fast from flow-credits/u);
  assert.equal(existsSync(storePath), false, "no SQLite file is made");
  assert.ok(existsSync(ledgerJournalRoot(storePath)));
});

test("concurrent consumers on one host serialize: no more holds go through than fit", async (t) => {
  const storePath = path.join(scratch(t), "allowance-ledger.sqlite");
  const source = `
    import { workerData, parentPort } from "node:worker_threads";
    const { holdAllowance } = await import(workerData.module);
    const { admitAllowance } = await import("@red-cup-engineering/organizing/enterprise");
    parentPort.postMessage(holdAllowance(admitAllowance(workerData.flow), { id: workerData.id, kind: "veo:fast", principal: workerData.id }, { storePath: workerData.storePath, now: workerData.now }).disposition);`;
  const module = new URL("../../src/media/allowance-ledger.mjs", import.meta.url).href;
  const outcomes = await Promise.all(Array.from({ length: 6 }, (_, index) => new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, type: "module", workerData: { module, flow: declared, storePath, now, id: `w${index}` } });
    worker.once("message", resolve);
    worker.once("error", reject);
  })));
  assert.equal(outcomes.filter((outcome) => outcome === "held").length, 2);
  assert.equal(outcomes.filter((outcome) => outcome === "refused").length, 4);
});

test("account capacity windows compare-and-set by version in the journal", async (t) => {
  const directory = scratch(t);
  const storePath = path.join(directory, "account-capacity.sqlite");
  const store = openAccountArtifactCapacityStore(storePath);
  assert.equal(await store.get("k"), null);
  assert.deepEqual(await store.compareAndSet("k", null, { type: "WorkResourceAccountWindow", reservations: [] }), { version: 1 });
  await assert.rejects(() => store.compareAndSet("k", null, { reservations: [1] }), /account-capacity-conflict/u);
  assert.deepEqual(await store.compareAndSet("k", 1, { type: "WorkResourceAccountWindow", reservations: [{ id: "r" }] }), { version: 2 });
  assert.deepEqual(await openAccountArtifactCapacityStore(storePath).get("k"), { type: "WorkResourceAccountWindow", reservations: [{ id: "r" }], version: 2 });

});
