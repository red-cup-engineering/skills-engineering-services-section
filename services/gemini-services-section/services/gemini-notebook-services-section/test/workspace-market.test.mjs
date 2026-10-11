import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acceptWorkspaceOffer, addCorpus, authorizeResourceBudget, compileCorpus, destroyWorkspace, generateStudio, openWorkspace, quoteStudio, quoteWorkspace, settleStudio } from "../src/workspace-market.mjs";

const CUSTOMER = "urn:ame:test-notebook-buyer";
const SHA = `ni:///sha-256;${"a".repeat(42)}A`;
const NOTEBOOK = "11111111-1111-4111-8111-111111111111";
const AT = "2026-07-26T12:00:00.000Z";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "notebook-workspace-market-"));
  const repo = join(root, "repo"); mkdirSync(repo); writeFileSync(join(repo, "one.md"), "# One\n\nRepository K.\n");
  const session = join(root, "session.jsonl");
  writeFileSync(session, [
    { type: "response_item", payload: { type: "message", role: "system", content: [{ text: "SYSTEM SECRET" }] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ text: "Need a general notebook market." }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ text: "I will model leases." }] } },
    { type: "response_item", payload: { type: "function_call", name: "tool", arguments: "TOOL SECRET" } },
  ].map(JSON.stringify).join("\n"));
  return { root, repo, session, options: { dataRoot: join(root, "data"), outputRoot: join(root, "out"), now: AT, nonce: "fixture-nonce" } };
}

test("an actor buys, opens, fills, and destroys an exact ephemeral workspace", async (t) => {
  const f = fixture(); t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const budget = authorizeResourceBudget({ customer: CUSTOMER, maximumProviderCalls: 1000, maximumSourceBytes: 10_000_000, maximumWallTimeSeconds: 7200, maximumStudioQuota: 5, expiresAt: "2026-07-27T12:00:00.000Z" }, f.options);
  const offer = quoteWorkspace({ customer: CUSTOMER, title: "Planning condenser", sourceCeiling: 300, leaseHours: 24, retentionPolicy: "ephemeral" }, f.options);
  const acceptance = acceptWorkspaceOffer({ customer: CUSTOMER, offer: offer.id, resourceBudgetAuthorization: budget.id }, f.options);
  const lease = await openWorkspace({ customer: CUSTOMER, acceptance: acceptance.id, authorization: SHA, authorizationRequestDigest: `ni:///sha-256;${"b".repeat(42)}A`, creationRequestId: `ni:///sha-256;${"c".repeat(42)}A` }, { ...f.options, createNotebook: async () => ({ id: `urn:sha256:${"d".repeat(64)}`, customer: CUSTOMER, notebookId: NOTEBOOK, status: "completed" }) });
  assert.equal(lease.notebookId, NOTEBOOK); assert.equal(lease.sourceCeiling, 300);

  const corpus = compileCorpus({ customer: CUSTOMER, purpose: "test generalized corpus", sourceCeiling: 300, retention: "ephemeral", sources: [
    { kind: "tree", root: f.repo, extensions: [".md"] },
    { kind: "codex-session", path: f.session, title: "sanitized session", authorization: "leader-authorized-session-material", disclosure: "leader-authorized-session-material" },
  ] }, f.options);
  assert.equal(corpus.sourceCount, 2);
  const sessionText = readFileSync(corpus.projected.find((row) => row.origin === "sanitized-session").path, "utf8");
  assert.match(sessionText, /general notebook market/u); assert.doesNotMatch(sessionText, /SYSTEM SECRET|TOOL SECRET/u);

  let additions = 0;
  const admitted = addCorpus({ customer: CUSTOMER, lease: lease.id, corpus: corpus.id }, { ...f.options, runCli: (args) => args[0] === "source" && args[1] === "list" ? { status: 0, value: { sources: [] }, diagnostic: "" } : args[1] === "add" ? { status: 0, value: { source: { id: `source-${++additions}` } }, diagnostic: "" } : { status: 0, value: { status: "ready" }, diagnostic: "" } });
  assert.equal(admitted.admittedCount, 2);
  const studio = quoteStudio({ customer: CUSTOMER, lease: lease.id, artifactType: "data-table", instructions: "Return exact CSV." }, f.options);
  assert.equal(studio.consideration.markup, "0"); assert.equal(studio.consideration.fixedFee, null);
  const generation = generateStudio({ customer: CUSTOMER, offer: studio.id, resourceBudgetAuthorization: budget.id, instructions: "Return exact CSV." }, { ...f.options, runCli: () => ({ status: 0, value: { task_id: "artifact-1" }, diagnostic: "" }) });
  const artifact = settleStudio({ customer: CUSTOMER, generation: generation.id }, { ...f.options, runCli: (args) => { if (args[0] === "download") writeFileSync(args[2], "a,b\n1,2\n"); return { status: 0, value: { success: true }, diagnostic: "" }; } });
  assert.equal(artifact.carrier.mediaType, "text/csv"); assert.equal(artifact.remoteCleanup, "delete-acknowledged");

  const cleanup = destroyWorkspace({ customer: CUSTOMER, lease: lease.id }, { ...f.options, runCli: (args) => args[0] === "delete" ? { status: 0, value: { success: true }, diagnostic: "" } : { status: 0, value: { notebooks: [] }, diagnostic: "" } });
  assert.equal(cleanup.status, "confirmed-deleted"); assert.deepEqual(cleanup.externalEffects, [{ effect: "notebook-deleted", notebookId: NOTEBOOK }]);
});

test("a corpus cannot silently exceed its purchased source ceiling", (t) => {
  const f = fixture(); t.after(() => rmSync(f.root, { recursive: true, force: true }));
  assert.throws(() => compileCorpus({ customer: CUSTOMER, purpose: "bounded", sourceCeiling: 1, sources: [
    { kind: "file", path: join(f.repo, "one.md") },
    { kind: "codex-session", path: f.session, authorization: "leader-authorized-session-material" },
  ] }, f.options), /2 sources but purchased ceiling is 1/u);
});
