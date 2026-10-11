import assert from "node:assert/strict";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { startGeminiNotebookWitnessJournalFixture } from "./witness-journal-fixture.js";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_CLIENT = join(SOURCE, "test", "fake-gemini-notebook");
const CONTEXT = "https://www.w3.org/ns/activitystreams";
const PROVIDER = "urn:ame:notebooklm-inference-team";
const LMT = "urn:ame:leader-movement-team";
const NOW = "2096-07-18T12:00:00.000Z";
let base; let root; let endpoint; let statePath; let sourcePath; let witnessJournal;

function leader(content, request) { return { "@context": CONTEXT, id: `urn:leader:${semanticId({ content, request })}`, type: "Create", actor: "urn:leader:emsenn", target: LMT, object: { type: "Note", content, attachment: request } }; }
function solicit(sourceActivity) { return { "@context": CONTEXT, id: `urn:solicitation:${sourceActivity.id}`, type: "Offer", actor: LMT, target: PROVIDER, object: { type: "ServiceSolicitation", demand: "urn:demand:test", sourceActivity } }; }
function run(operation, activity) {
  const environment = { ...process.env, WITNESS_JOURNAL_RDF_AGENT: witnessJournal.agentCardUrl, PYTHONPATH: `${FAKE_CLIENT}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""}`, FAKE_GEMINI_NOTEBOOK_STATE: statePath };
  const result = spawnSync(process.execPath, [endpoint, "--operation", operation, "--now", NOW], { cwd: root, input: JSON.stringify(activity), encoding: "utf8", timeout: 90_000, env: environment });
  let output; try { output = JSON.parse(result.stdout); } catch { output = undefined; }
  return { ...result, output };
}
function accept(offer, allowedActions = ["invoke-source-reconciliation", ...(offer.object.effects ?? [])]) {
  const capability = { id: `urn:cap:${offer.id}`, type: "Capability", issuer: LMT, holder: PROVIDER, invocationTarget: PROVIDER, parentOffer: offer.id, allowedActions, attenuation: { sourceActivity: offer.object.sourceActivity, requestDigest: offer.object.requestDigest, effects: offer.object.effects, providerScope: offer.object.scope, customerTerritoryMutation: false }, capTP: { target: PROVIDER, method: "invoke-source-reconciliation" } };
  return { "@context": CONTEXT, id: `urn:accept:${offer.id}`, type: "Accept", actor: LMT, target: PROVIDER, inReplyTo: offer.id, object: { type: "ServiceContract", demand: "urn:demand:test", offer, capability } };
}
function request(overrides = {}) { return { type: "GeminiNotebookSourceReconciliationRequest", notebookId: "notebook-stable-000001", policy: "replace-all-staged", executionMode: "dry-run", expectedCurrentSourceIds: null, desiredSources: [{ path: sourcePath, digest: sha256Digest(readFileSync(sourcePath)), title: "Union delta" }], ...overrides }; }
function seed(sources) { writeFileSync(statePath, JSON.stringify({ sequence: 0, sources })); }
function seatTestPython(providerRoot) {
  const observed = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  assert.equal(observed.status, 0, observed.stderr);
  const bin = join(providerRoot, ".venv", "bin"); mkdirSync(bin, { recursive: true });
  symlinkSync(observed.stdout.trim(), join(bin, "python3"));
}

test.before(async () => { witnessJournal = await startGeminiNotebookWitnessJournalFixture(); });
test.after(async () => { await witnessJournal.close(); });
test.beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "gemini-notebook-source-contract-"));
  root = join(base, "notebooklm-inference-team");
  cpSync(SOURCE, root, { recursive: true, filter: (path) => !path.startsWith(join(SOURCE, ".venv")) && !path.startsWith(join(SOURCE, "data")) && !path.startsWith(join(SOURCE, "test")) && !path.startsWith(join(SOURCE, "node_modules")) });
  symlinkSync(join(SOURCE, "node_modules"), join(root, "node_modules"), "dir");
  seatTestPython(root);
  endpoint = join(root, "src", "contract-gemini-notebook-sources.js");
  statePath = join(base, "fake-state.json");
  sourcePath = join(base, "union-delta.json");
  writeFileSync(sourcePath, "{\"delta\":\"material\"}\n");
  seed([]);
});
test.afterEach(() => rmSync(base, { recursive: true, force: true }));

test("dry-run validates a replacement manifest without network effects", () => {
  const offered = run("solicit-source-reconciliation", solicit(leader("Prepare Gemini Notebook source replacement.", request())));
  assert.equal(offered.status, 0, offered.stderr); assert.equal(offered.output.type, "Offer");
  assert.deepEqual(offered.output.object.effects, []);
  const invoked = run("invoke-source-reconciliation", accept(offered.output));
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "ready");
  assert.deepEqual(invoked.output.object.observations, { networkCalls: 0, recordsWritten: 0 });
  assert.deepEqual(JSON.parse(readFileSync(statePath)), { sequence: 0, sources: [] });
});

test("observe-live reports exact current IDs under a network-only grant", () => {
  seed([{ id: "source-old-000001", title: "old", status: "ready", type: "file", url: null }]);
  const observation = request({ policy: "observe-only", executionMode: "observe-live", expectedCurrentSourceIds: null, desiredSources: [] });
  const offered = run("solicit-source-reconciliation", solicit(leader("Observe the stable Gemini Notebook source set.", observation)));
  assert.deepEqual(offered.output.object.effects, ["external-network"]);
  const invoked = run("invoke-source-reconciliation", accept(offered.output));
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "observed");
  assert.deepEqual(invoked.output.object.receipt.finalSourceIds, ["source-old-000001"]);
  assert.deepEqual(invoked.output.object.receipt.deletedSourceIds, []);
});

test("reconcile-live stages ready sources before deleting the exact accepted old set", () => {
  seed([
    { id: "source-old-000001", title: "old one", status: "ready", type: "file", url: null },
    { id: "source-old-000002", title: "old two", status: "ready", type: "file", url: null },
  ]);
  const replacement = request({ executionMode: "reconcile-live", expectedCurrentSourceIds: ["source-old-000001", "source-old-000002"] });
  const offered = run("solicit-source-reconciliation", solicit(leader("Replace the stable Gemini Notebook source set.", replacement)));
  assert.deepEqual(offered.output.object.effects, ["external-network", "source-egress", "notebook-source-mutation"]);
  const invoked = run("invoke-source-reconciliation", accept(offered.output));
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "reconciled");
  assert.deepEqual(invoked.output.object.receipt.deletedSourceIds, ["source-old-000001", "source-old-000002"]);
  assert.deepEqual(invoked.output.object.receipt.finalSourceIds, ["source-new-000001"]);
  const state = JSON.parse(readFileSync(statePath));
  assert.deepEqual(state.sources.map((row) => row.id), ["source-new-000001"]);
});

test("curated cumulative reconciliation preserves every incumbent and adds only an absent identity", () => {
  seed([{ id: "source-old-000001", title: "old one", status: "ready", type: "file", url: null }]);
  const cumulative = request({ policy: "curated-cumulative-add", executionMode: "reconcile-live", expectedCurrentSourceIds: ["source-old-000001"] });
  const offered = run("solicit-source-reconciliation", solicit(leader("Add this research packet without retiring the notebook corpus.", cumulative)));
  assert.deepEqual(offered.output.object.effects, ["external-network", "source-egress", "notebook-source-mutation"]);
  const invoked = run("invoke-source-reconciliation", accept(offered.output));
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "reconciled");
  assert.deepEqual(invoked.output.object.receipt.preservedSourceIds, ["source-old-000001"]);
  assert.deepEqual(invoked.output.object.receipt.deletedSourceIds, []);
  assert.deepEqual(invoked.output.object.receipt.finalSourceIds, ["source-new-000001", "source-old-000001"]);
  assert.deepEqual(JSON.parse(readFileSync(statePath)).sources.map((row) => row.id), ["source-old-000001", "source-new-000001"]);
});

test("curated cumulative reconciliation may preserve an already non-ready incumbent while the added source must be ready", () => {
  seed([
    { id: "source-old-000001", title: "old ready", status: "ready", type: "file", url: null },
    { id: "source-old-000002", title: "legacy broken URL", status: "error", type: "web_page", url: "https://example.invalid/old" },
  ]);
  const cumulative = request({ policy: "curated-cumulative-add", executionMode: "reconcile-live", expectedCurrentSourceIds: ["source-old-000001", "source-old-000002"] });
  const offered = run("solicit-source-reconciliation", solicit(leader("Add a ready packet while preserving the accepted incumbent set.", cumulative)));
  const invoked = run("invoke-source-reconciliation", accept(offered.output));
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "reconciled");
  assert.deepEqual(invoked.output.object.receipt.deletedSourceIds, []);
  assert.deepEqual(invoked.output.object.receipt.finalSourceIds, ["source-new-000001", "source-old-000001", "source-old-000002"]);
  assert.equal(invoked.output.object.receipt.finalSources.find((row) => row.id === "source-old-000002").status, "error");
  assert.equal(invoked.output.object.receipt.finalSources.find((row) => row.id === "source-new-000001").status, "ready");
});

test("curated cumulative replay recognizes the digest-bound title and issues no second add", () => {
  const source = request().desiredSources[0];
  const title = `SHUOC ${source.digest} ${source.title}`;
  seed([{ id: "source-old-000001", title, status: "ready", type: "file", url: null }]);
  const cumulative = request({ policy: "curated-cumulative-add", executionMode: "reconcile-live", expectedCurrentSourceIds: ["source-old-000001"] });
  const offered = run("solicit-source-reconciliation", solicit(leader("Re-admit the same curated packet idempotently.", cumulative)));
  const invoked = run("invoke-source-reconciliation", accept(offered.output));
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.deepEqual(invoked.output.object.receipt.addedSources, []);
  assert.deepEqual(invoked.output.object.receipt.deletedSourceIds, []);
  assert.deepEqual(invoked.output.object.receipt.finalSourceIds, ["source-old-000001"]);
  assert.deepEqual(JSON.parse(readFileSync(statePath)), { sequence: 0, sources: [{ id: "source-old-000001", title, status: "ready", type: "file", url: null }] });
});

test("a stale precondition refuses without adding or deleting a source", () => {
  seed([{ id: "source-actual-000001", title: "actual", status: "ready", type: "file", url: null }]);
  const replacement = request({ executionMode: "reconcile-live", expectedCurrentSourceIds: ["source-stale-000001"] });
  const offered = run("solicit-source-reconciliation", solicit(leader("Replace only if the observed state still matches.", replacement)));
  const invoked = run("invoke-source-reconciliation", accept(offered.output));
  assert.equal(invoked.status, 2, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.type, "Reject");
  assert.equal(invoked.output.object.reconciliationReceipt.failureStage, "precondition");
  assert.deepEqual(invoked.output.object.reconciliationReceipt.finalSourceIds, ["source-actual-000001"]);
  assert.deepEqual(JSON.parse(readFileSync(statePath)).sources.map((row) => row.id), ["source-actual-000001"]);
});

test("reconciliation is rejected before execution when the mutation grant is absent", () => {
  seed([{ id: "source-old-000001", title: "old", status: "ready", type: "file", url: null }]);
  const replacement = request({ executionMode: "reconcile-live", expectedCurrentSourceIds: ["source-old-000001"] });
  const offered = run("solicit-source-reconciliation", solicit(leader("Replace the stable Gemini Notebook source set.", replacement)));
  const invoked = run("invoke-source-reconciliation", accept(offered.output, ["invoke-source-reconciliation", "external-network", "source-egress"]));
  assert.equal(invoked.status, 2); assert.match(invoked.output.object.reason, /notebook-source-mutation/u);
  assert.deepEqual(JSON.parse(readFileSync(statePath)).sources.map((row) => row.id), ["source-old-000001"]);
});

test("duplicate desired source identities are refused at solicitation", () => {
  const duplicate = request({ desiredSources: [request().desiredSources[0], request().desiredSources[0]] });
  const result = run("solicit-source-reconciliation", solicit(leader("Prepare a bounded source replacement.", duplicate)));
  assert.equal(result.output.type, "Question");
  assert.ok(result.output.object.missing.includes("desiredSources(unique digest/title identities)"));
});
