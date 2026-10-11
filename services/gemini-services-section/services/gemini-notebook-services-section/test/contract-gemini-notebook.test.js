import assert from "node:assert/strict";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { queryWitnessJournalDocumentsByCategory } from "@red-cup-engineering/witness-journal-document-service";
import { startGeminiNotebookWitnessJournalFixture } from "./witness-journal-fixture.js";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTEXT = "https://www.w3.org/ns/activitystreams";
const PROVIDER = "urn:ame:notebooklm-inference-team";
const LMT = "urn:ame:leader-movement-team";
let NOW = "2096-07-17T12:00:00.000Z";
let testWeek = 0;
let base; let root; let endpoint; let witnessJournal;

function leader(content, request, grant) {
  const attachment = [...(request ? [request] : []), ...(grant ? [grant] : [])];
  return { "@context": CONTEXT, id: `urn:leader:${semanticId({ content, attachment })}`, type: "Create", actor: "urn:leader:emsenn", target: LMT, object: { type: "Note", content, ...(attachment.length ? { attachment } : {}) } };
}
function solicit(sourceActivity) {
  return { "@context": CONTEXT, id: `urn:solicitation:${sourceActivity.id}`, type: "Offer", actor: LMT, target: PROVIDER, object: { type: "ServiceSolicitation", demand: "urn:demand:test", sourceActivity } };
}
function findUp(start, relative) { let directory = start; while (true) { const candidate = join(directory, relative); if (existsSync(candidate)) return candidate; const parent = dirname(directory); if (parent === directory) return null; directory = parent; } }
const SCHEMA_READER = join(SOURCE, "node_modules/@red-cup-engineering/json-schema-services-section/scripts/read-a-schema.mjs");
async function providerCategory(category) { return queryWitnessJournalDocumentsByCategory(category, { agentUrl: witnessJournal.agentCardUrl, predicate: "urn:emsenn:gemini-notebook:category" }); }
function run(operation, activity, extraEnv = {}) {
  const runner = `import{pathToFileURL}from"node:url";let input="";for await(const chunk of process.stdin)input+=chunk;const endpoint=pathToFileURL(process.argv[2]);const{executeGeminiNotebookContract}=await import(endpoint);const{recordProviderJobRecord}=await import(new URL("./contract-gemini-notebook-async-jobs.js",endpoint));const witness=({category,envelope,recordedAt})=>recordProviderJobRecord(category,envelope.row,{now:recordedAt,witnessJournalAgentUrl:process.env.WITNESS_JOURNAL_RDF_AGENT});const result=await executeGeminiNotebookContract(process.argv[3],JSON.parse(input),{instant:process.argv[4],testOnlyWitness:witness,witnessJournalAgentUrl:process.env.WITNESS_JOURNAL_RDF_AGENT});process.stdout.write(JSON.stringify(result.response));process.exitCode=result.status;`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", runner, "gemini-notebook-contract-test-runner", endpoint, operation, NOW], { cwd: root, input: JSON.stringify(activity), encoding: "utf8", timeout: 90_000, env: { ...process.env, WITNESS_JOURNAL_RDF_AGENT: witnessJournal.agentCardUrl, ...extraEnv } });
  let output; try { output = JSON.parse(result.stdout); } catch { output = undefined; }
  return { ...result, output };
}
function accept(offer, allowedActions = ["invoke-service"]) {
  const capability = { id: `urn:cap:${offer.id}`, type: "Capability", issuer: LMT, holder: PROVIDER, invocationTarget: PROVIDER, parentOffer: offer.id, allowedActions, attenuation: { sourceActivity: offer.object.sourceActivity, requestDigest: offer.object.requestDigest, effects: offer.object.effects, providerScope: offer.object.scope, customerTerritoryMutation: false }, capTP: { target: PROVIDER, method: "invoke-service" } };
  const object = { type: "ServiceContract", demand: "urn:demand:test", offer, capability };
  return { "@context": CONTEXT, id: `urn:accept:${offer.id}`, type: "Accept", actor: LMT, target: PROVIDER, inReplyTo: offer.id, object };
}
function filesBelow(path) { if (!existsSync(path)) return []; return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesBelow(join(path, entry.name)) : [join(path, entry.name)]); }
function seatTestPython(providerRoot) {
  const observed = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  assert.equal(observed.status, 0, observed.stderr);
  const bin = join(providerRoot, ".venv", "bin"); mkdirSync(bin, { recursive: true });
  symlinkSync(observed.stdout.trim(), join(bin, "python3"));
}

test.before(async () => { witnessJournal = await startGeminiNotebookWitnessJournalFixture(); });
test.after(async () => { await witnessJournal.close(); });
test.beforeEach(() => {
  NOW = new Date(Date.parse("2096-07-17T12:00:00.000Z") + testWeek * 7 * 24 * 60 * 60 * 1000).toISOString(); testWeek += 1;
  base = mkdtempSync(join("/tmp", "gemini-notebook-provider-contract-")); root = join(base, "notebooklm-inference-team");
  cpSync(SOURCE, root, { recursive: true, filter: (path) => !path.startsWith(join(SOURCE, ".venv")) && !path.startsWith(join(SOURCE, "data")) && !path.startsWith(join(SOURCE, "test")) && !path.startsWith(join(SOURCE, "node_modules")) });
  symlinkSync(join(SOURCE, "node_modules"), join(root, "node_modules"), "dir");
  seatTestPython(root); endpoint = join(root, "src", "contract-gemini-notebook.js");
});
test.afterEach(() => rmSync(base, { recursive: true, force: true }));

test("provider owns intent recognition and asks for missing executable terms", () => {
  const result = run("solicit-service", solicit(leader("Please use Gemini Notebook for this.")));
  assert.equal(result.status, 0, result.stderr); assert.equal(result.output.type, "Question");
  assert.deepEqual(result.output.object.missing, ["sources", "prompt", "artifactType(report|mind-map|infographic|audio|video|code|json|data-table)", "executionMode(dry-run|live)", "corpusMode(ephemeral-upload|reconciled-notebook)"]);
});

test("provider advertises Gemini Notebook audio as a typed artifact operation", () => {
  const request = { type: "GeminiNotebookRequest", sources: ["source text"], prompt: "Make a short delta briefing.", artifactType: "audio", executionMode: "dry-run" };
  const offered = run("solicit-service", solicit(leader("Use Gemini Notebook to produce an audio briefing.", request)));
  assert.equal(offered.status, 0, offered.stderr); assert.equal(offered.output.type, "Offer");
  assert.equal(offered.output.object.request.artifactType, "audio");
  assert.equal(offered.output.object.scope.artifactType, "audio");
  const accepted = accept(offered.output), invoked = run("invoke-service", accepted);
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "ready");
  assert.deepEqual(invoked.output.object.observations, { networkCalls: 0, recordsWritten: 0 });
});

test("provider advertises code as a JSON-carried proposal without receiver mutation authority", () => {
  const request = { type: "GeminiNotebookRequest", sources: ["source text"], prompt: "Implement the source contract.", artifactType: "code", executionMode: "dry-run", corpusMode: "ephemeral-upload" };
  const offered = run("solicit-service", solicit(leader("Use Gemini Notebook to propose code.", request)));
  assert.equal(offered.status, 0, offered.stderr); assert.equal(offered.output.type, "Offer");
  assert.equal(offered.output.object.scope.artifactType, "code");
  assert.deepEqual(offered.output.object.effects, []);
  assert.deepEqual(offered.output.object.consideration, { type: "GeminiNotebookResourceBudgetConsideration", fixedFee: null, markup: "0", monetaryConversion: "none-without-an-observed-cost-oracle", meters: ["gemini-notebook-provider-calls", "source-bytes-egressed", "provider-wall-time", "studio-quota-consumed"], requires: ["resource-budget-authorization", "observed-cost-settlement"] });
  const invoked = run("invoke-service", accept(offered.output));
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "ready");
});

test("provider refuses code against a shared reconciled notebook", () => {
  const request = { type: "GeminiNotebookRequest", sources: ["source text"], prompt: "Implement the source contract.", artifactType: "code", executionMode: "dry-run", corpusMode: "reconciled-notebook" };
  const result = run("solicit-service", solicit(leader("Use Gemini Notebook to propose code.", request)));
  assert.equal(result.output.type, "Question");
  assert.ok(result.output.object.missing.includes("code corpusMode(ephemeral-upload)"));
});

test("live code execution returns a validated JSON bundle and writes no receiver files", () => {
  const sourcePath = join(base, "source.md"); writeFileSync(sourcePath, "export one grounded JavaScript constant\n");
  const request = {
    type: "GeminiNotebookRequest",
    sources: [{ path: sourcePath, digest: sha256Digest(readFileSync(sourcePath)) }],
    prompt: "Implement the grounded constant.",
    artifactType: "code", executionMode: "live", corpusMode: "ephemeral-upload",
  };
  const offered = run("solicit-service", solicit(leader("Use Gemini Notebook to propose code.", request)));
  assert.equal(offered.output.type, "Offer");
  assert.deepEqual(offered.output.object.effects, ["external-network", "source-egress"]);
  const statePath = join(base, "fake-gemini-notebook-code-state.json");
  writeFileSync(statePath, JSON.stringify({ sequence: 0, sources: [], calls: [] }));
  const invoked = run("invoke-service", accept(offered.output, ["invoke-service", "external-network", "source-egress"]), {
    PYTHONPATH: `${join(SOURCE, "test", "fake-gemini-notebook")}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""}`,
    FAKE_GEMINI_NOTEBOOK_STATE: statePath,
    EMSENN_READ_A_SCHEMA: SCHEMA_READER,
  });
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "artifact");
  const exchange = invoked.output.object.providerExchange;
  assert.equal(exchange.artifact.type, "code");
  const bundle = JSON.parse(readFileSync(exchange.artifact.path));
  assert.equal(bundle.format, "json-code-bundle");
  assert.equal(bundle.files[0].path, "src/generated.js");
  assert.equal(bundle.files[0].content, "export const grounded = true;\n");
  assert.match(sha256Digest(Buffer.from(bundle.files[0].content)), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(existsSync(join(root, "src", "generated.js")), false);
  const state = JSON.parse(readFileSync(statePath));
  assert.ok(state.calls.some((call) => call[0] === "ask"));
  assert.ok(state.calls.some((call) => call[0] === "delete" && call.includes("notebook-new-000001")));
  assert.equal(invoked.output.object.ephemeralCleanup.disposition, "deleted");
  assert.equal(invoked.output.object.ephemeralCleanup.leakedNotebook, false);
});

test("live JSON generation is schema-bound and cleans its exact ephemeral notebook", () => {
  const sourcePath = join(base, "source.md"); writeFileSync(sourcePath, "Produce one grounded report-shaped datum.\n");
  const request = {
    type: "GeminiNotebookRequest",
    sources: [{ path: sourcePath, digest: sha256Digest(readFileSync(sourcePath)) }],
    prompt: "Return the grounded datum.", artifactType: "json",
    resultSchema: "emsenn/schema/gemini-notebook-report-artifact",
    executionMode: "live", corpusMode: "ephemeral-upload",
  };
  const offered = run("solicit-service", solicit(leader("Use Gemini Notebook for schema-bound JSON.", request)));
  assert.equal(offered.output.type, "Offer");
  assert.equal(offered.output.object.scope.resultSchema, request.resultSchema);
  const statePath = join(base, "fake-gemini-notebook-json-state.json");
  writeFileSync(statePath, JSON.stringify({ sequence: 0, sources: [], calls: [] }));
  const invoked = run("invoke-service", accept(offered.output, ["invoke-service", "external-network", "source-egress"]), {
    PYTHONPATH: `${join(SOURCE, "test", "fake-gemini-notebook")}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""}`,
    FAKE_GEMINI_NOTEBOOK_STATE: statePath,
    EMSENN_READ_A_SCHEMA: SCHEMA_READER,
  });
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "artifact");
  const payload = JSON.parse(readFileSync(invoked.output.object.providerExchange.artifact.path));
  assert.equal(payload.format, "json");
  assert.equal(payload.resultSchema, request.resultSchema);
  assert.deepEqual(payload.data, { format: "markdown", body: "Grounded structured result." });
  assert.equal(invoked.output.object.ephemeralCleanup.disposition, "deleted");
});

test("live native data-table generation validates CSV and cleans its exact ephemeral notebook", () => {
  const sourcePath = join(base, "source.md"); writeFileSync(sourcePath, "Gemini Notebook is an Analyze provider.\n");
  const request = {
    type: "GeminiNotebookRequest",
    sources: [{ path: sourcePath, digest: sha256Digest(readFileSync(sourcePath)) }],
    prompt: "Tabulate capability, stage, and value.", artifactType: "data-table",
    executionMode: "live", corpusMode: "ephemeral-upload",
  };
  const offered = run("solicit-service", solicit(leader("Use Gemini Notebook for a native CSV.", request)));
  assert.equal(offered.output.type, "Offer");
  const statePath = join(base, "fake-gemini-notebook-table-state.json");
  writeFileSync(statePath, JSON.stringify({ sequence: 0, sources: [], calls: [] }));
  const invoked = run("invoke-service", accept(offered.output, ["invoke-service", "external-network", "source-egress"]), {
    PYTHONPATH: `${join(SOURCE, "test", "fake-gemini-notebook")}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""}`,
    FAKE_GEMINI_NOTEBOOK_STATE: statePath,
    EMSENN_READ_A_SCHEMA: SCHEMA_READER,
  });
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "artifact");
  const csv = readFileSync(invoked.output.object.providerExchange.artifact.path, "utf8");
  assert.equal(csv, "capability,stage,value\ngemini-notebook,analyze,1\n");
  const metadata = JSON.parse(readFileSync(invoked.output.object.providerExchange.artifact.path.replace(/\.csv$/u, ".json")));
  assert.deepEqual(metadata.header, ["capability", "stage", "value"]);
  assert.equal(metadata.rowCount, 1);
  assert.equal(metadata.formulaLikeCellCount, 0);
  assert.equal(invoked.output.object.ephemeralCleanup.disposition, "deleted");
});

test("provider advertises a native infographic operation instead of requiring an out-of-band visualizer", () => {
  const request = { type: "GeminiNotebookRequest", sources: ["source text"], prompt: "Produce a detailed scientific infographic.", artifactType: "infographic", executionMode: "dry-run" };
  const offered = run("solicit-service", solicit(leader("Use Gemini Notebook to produce an infographic.", request)));
  assert.equal(offered.status, 0, offered.stderr); assert.equal(offered.output.type, "Offer");
  assert.equal(offered.output.object.request.artifactType, "infographic");
  assert.equal(offered.output.object.scope.artifactType, "infographic");
});

test("provider advertises cinematic and explainer video terms as digest-bound operations", () => {
  const cinematic = { type: "GeminiNotebookRequest", sources: ["source text"], prompt: "Show the geometry of causal diamonds.", artifactType: "video", videoFormat: "cinematic", videoStyle: null, videoLanguage: "en", executionMode: "dry-run" };
  const cinemaOffer = run("solicit-service", solicit(leader("Use Gemini Notebook for one cinematic video.", cinematic)));
  assert.equal(cinemaOffer.status, 0, cinemaOffer.stderr); assert.equal(cinemaOffer.output.type, "Offer");
  assert.equal(cinemaOffer.output.object.scope.artifactType, "video");
  assert.equal(cinemaOffer.output.object.scope.videoFormat, "cinematic");
  assert.equal(cinemaOffer.output.object.scope.videoStyle, null);
  assert.equal(cinemaOffer.output.object.scope.videoLanguage, "en");
  assert.equal(cinemaOffer.output.object.scope.videoCapacityCustomer, "urn:ame:mathematics-youtube-channel-enterprise");
  assert.equal(cinemaOffer.output.object.scope.videoCapacityAllocation, "mathematics-daily");
  const cinemaReady = run("invoke-service", accept(cinemaOffer.output));
  assert.equal(cinemaReady.status, 0, cinemaReady.stderr || cinemaReady.stdout);
  assert.equal(cinemaReady.output.object.disposition, "ready");

  const explainer = { ...cinematic, prompt: "Explain a relational system.", videoFormat: "explainer", videoStyle: "whiteboard" };
  const explainerOffer = run("solicit-service", solicit(leader("Use Gemini Notebook for one explainer video.", explainer)));
  assert.equal(explainerOffer.status, 0, explainerOffer.stderr); assert.equal(explainerOffer.output.type, "Offer");
  assert.equal(explainerOffer.output.object.scope.videoFormat, "explainer");
  assert.equal(explainerOffer.output.object.scope.videoStyle, "whiteboard");
});

test("provider refuses video terms that Gemini Notebook would silently ignore", () => {
  const request = { type: "GeminiNotebookRequest", sources: ["source text"], prompt: "Make a cinematic.", artifactType: "video", videoFormat: "cinematic", videoStyle: "watercolor", videoLanguage: "fr", executionMode: "dry-run" };
  const result = run("solicit-service", solicit(leader("Use invalid cinematic terms.", request)));
  assert.equal(result.output.type, "Question");
  assert.ok(result.output.object.missing.includes("cinematic videoStyle(null)"));
  assert.ok(result.output.object.missing.includes("cinematic videoLanguage(en)"));
});

test("historical pilot records do not block a contracted dry-run", () => {
  const request = { type: "GeminiNotebookRequest", sources: ["source text"], prompt: "Produce a report.", artifactType: "report", executionMode: "dry-run" };
  const offered = run("solicit-service", solicit(leader("Use Gemini Notebook to produce a report.", request)));
  assert.equal(offered.status, 0, offered.stderr); assert.equal(offered.output.type, "Offer");
  const invoked = run("invoke-service", accept(offered.output));
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout); assert.equal(invoked.output.type, "Accept");
  assert.equal(invoked.output.object.disposition, "ready"); assert.equal(invoked.output.object.observations.networkCalls, 0);
  const exchangeRecords = filesBelow(join(root, "content", "exchanges")).filter((path) => /exchange-2096/u.test(path));
  assert.equal(exchangeRecords.length, 0);
});

test("raw Leader activity is adapted into an accepted independent Gemini Notebook dry execution", async () => {
  const request = { type: "GeminiNotebookRequest", sources: ["source text"], prompt: "Produce a report.", artifactType: "report", executionMode: "dry-run" };
  const activity = leader("Use Gemini Notebook to produce a report.", request);
  const offered = run("solicit-service", solicit(activity)); assert.equal(offered.status, 0, offered.stderr || offered.stdout);
  const accepted = accept(offered.output), invoked = run("invoke-service", accepted);
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout); assert.equal(invoked.output.type, "Accept");
  assert.equal(invoked.output.object.disposition, "ready");
  const events = (await providerCategory("events")).map(({ value }) => value).filter((value) => value?.type === "GeminiNotebookJobRecord" && value.category === "events");
  assert.equal(events.some((value) => value.row?.subject === accepted.id), true);
});

test("live source egress is not offered for unbound source locators", () => {
  const request = { type: "GeminiNotebookRequest", sources: ["/tmp/unbound.md"], prompt: "Produce a report.", artifactType: "report", executionMode: "live" };
  const result = run("solicit-service", solicit(leader("Use Gemini Notebook live.", request)));
  assert.equal(result.output.type, "Question"); assert.ok(result.output.object.missing.includes("live sources must be {path,digest} records"));
});

test("provider refuses a live invocation whose accepted capability omits egress effects", () => {
  const sourcePath = join(base, "source.md"); writeFileSync(sourcePath, "grounded source\n");
  const request = { type: "GeminiNotebookRequest", sources: [{ path: sourcePath, digest: sha256Digest(readFileSync(sourcePath)) }], prompt: "Produce a report.", artifactType: "report", executionMode: "live" };
  const offered = run("solicit-service", solicit(leader("Use Gemini Notebook live.", request)));
  assert.equal(offered.output.type, "Offer");
  const invoked = run("invoke-service", accept(offered.output, ["invoke-service"]));
  assert.equal(invoked.status, 2); assert.equal(invoked.output.type, "Reject"); assert.match(invoked.output.object.reason, /external-network/u);
});

test("provider rechecks a bound local source immediately before live egress", () => {
  const sourcePath = join(base, "source.md"); writeFileSync(sourcePath, "accepted bytes\n");
  const request = { type: "GeminiNotebookRequest", sources: [{ path: sourcePath, digest: sha256Digest(readFileSync(sourcePath)) }], prompt: "Produce a report.", artifactType: "report", executionMode: "live" };
  const offered = run("solicit-service", solicit(leader("Use Gemini Notebook live.", request)));
  assert.equal(offered.output.type, "Offer");
  writeFileSync(sourcePath, "changed after offer\n");
  const invoked = run("invoke-service", accept(offered.output, ["invoke-service", "external-network", "source-egress"]));
  assert.equal(invoked.status, 2); assert.equal(invoked.output.type, "Reject");
  assert.match(invoked.output.object.reason, /source digest mismatch/u);
});

test("audio reuses one reconciled notebook without a second source-egress effect", async () => {
  const sourceDigest = sha256Digest(Buffer.from("current union delta\n"));
  const sourceIds = ["source-stable-000001"];
  const body = {
    type: "GeminiNotebookSourceReconciliationReceipt", provider: PROVIDER,
    notebookId: "notebook-stable-000001", requestDigest: semanticId({ reconciliation: "test" }),
    mode: "reconcile-live", policy: "replace-all-staged", outcome: "reconciled",
    previousSources: [], desiredSources: [{ digest: sourceDigest, title: "Current Union delta" }],
    addedSources: [{ digest: sourceDigest, title: "Current Union delta", sourceId: sourceIds[0] }],
    deletedSourceIds: [], finalSources: [{ id: sourceIds[0], title: "Current Union delta", status: "ready", type: "file", url: null }],
    finalSourceIds: sourceIds, finalSourceSetDigest: semanticId(sourceIds), grounds: null, failureStage: null,
    cost: { denomination: "gemini-notebook-cli-call-and-wall-seconds", calls: 4, wallSeconds: 1 }, settledAt: NOW,
  };
  const receipt = { id: semanticId(body), ...body };
  await witnessJournal.record(join(root, "data"), "receipts", receipt, NOW);
  const statePath = join(base, "fake-gemini-notebook-state.json");
  writeFileSync(statePath, JSON.stringify({ sequence: 0, sources: receipt.finalSources }));
  const sourcePacket = { type: "HarmoniousUnionArtifactSourcePacket",
    documents: [{ name: "Current Union delta", content: "current union delta\n", digest: sourceDigest }] };
  const request = {
    type: "GeminiNotebookRequest", sources: [{ path: "/receipt-bound/current-union-delta.json", digest: sourceDigest, title: "Current Union delta" }],
    prompt: "Make a short delta briefing.", artifactType: "audio", executionMode: "live",
    corpusMode: "reconciled-notebook", notebookSourceReceiptId: receipt.id,
    sourcePacket, sourcePacketDigest: semanticId(sourcePacket),
  };
  const offered = run("solicit-service", solicit(leader("Use the reconciled stable notebook for audio.", request)));
  assert.equal(offered.status, 0, offered.stderr || offered.stdout); assert.equal(offered.output.type, "Offer");
  assert.deepEqual(offered.output.object.effects, ["external-network"]);
  assert.equal(offered.output.object.scope.notebookId, receipt.notebookId);
  const schemaReader = SCHEMA_READER;
  assert.ok(schemaReader, "schema reader fixture must resolve from the workspace");
  const invoked = run("invoke-service", accept(offered.output, ["invoke-service", "external-network"]), {
    PYTHONPATH: `${join(SOURCE, "test", "fake-gemini-notebook")}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""}`,
    FAKE_GEMINI_NOTEBOOK_STATE: statePath,
    EMSENN_READ_A_SCHEMA: schemaReader,
  });
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "artifact");
  assert.equal(invoked.output.object.corpusMode, "reconciled-notebook");
  assert.equal(invoked.output.object.notebookSourceReceiptId, receipt.id);
  assert.deepEqual(JSON.parse(readFileSync(statePath)).sources.map((row) => row.id), sourceIds);
});

test("explainer video reuses one reconciled notebook and downloads the exact generated artifact", async () => {
  const sourceDigest = sha256Digest(Buffer.from("relational systems packet\n"));
  const sourceIds = ["source-stable-video-000001"];
  const body = {
    type: "GeminiNotebookSourceReconciliationReceipt", provider: PROVIDER,
    notebookId: "notebook-stable-video-000001", requestDigest: semanticId({ reconciliation: "video-test" }),
    mode: "reconcile-live", policy: "replace-all-staged", outcome: "reconciled",
    previousSources: [], desiredSources: [{ digest: sourceDigest, title: "Relational systems packet" }],
    addedSources: [{ digest: sourceDigest, title: "Relational systems packet", sourceId: sourceIds[0] }],
    deletedSourceIds: [], finalSources: [{ id: sourceIds[0], title: "Relational systems packet", status: "ready", type: "file", url: null }],
    finalSourceIds: sourceIds, finalSourceSetDigest: semanticId(sourceIds), grounds: null, failureStage: null,
    cost: { denomination: "gemini-notebook-cli-call-and-wall-seconds", calls: 4, wallSeconds: 1 }, settledAt: NOW,
  };
  const receipt = { id: semanticId(body), ...body };
  await witnessJournal.record(join(root, "data"), "receipts", receipt, NOW);
  const statePath = join(base, "fake-gemini-notebook-video-state.json");
  writeFileSync(statePath, JSON.stringify({ sequence: 0, sources: receipt.finalSources, calls: [] }));
  const request = {
    type: "GeminiNotebookRequest", sources: [{ path: "/receipt-bound/relational-systems.md", digest: sourceDigest, title: "Relational systems packet" }],
    prompt: "Explain how the relations change the practical problem.", artifactType: "video", videoFormat: "explainer", videoStyle: "whiteboard", videoLanguage: "en",
    executionMode: "live", corpusMode: "reconciled-notebook", notebookSourceReceiptId: receipt.id,
  };
  const offered = run("solicit-service", solicit(leader("Generate one reconciled-notebook explainer.", request)));
  assert.equal(offered.status, 0, offered.stderr || offered.stdout); assert.equal(offered.output.type, "Offer");
  assert.deepEqual(offered.output.object.effects, ["external-network"]);
  const schemaReader = SCHEMA_READER;
  const accepted = accept(offered.output, ["invoke-service", "external-network"]);
  const submitted = run("invoke-service", accepted, {
    PYTHONPATH: `${join(SOURCE, "test", "fake-gemini-notebook")}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""}`,
    FAKE_GEMINI_NOTEBOOK_STATE: statePath,
    EMSENN_READ_A_SCHEMA: schemaReader,
  });
  assert.equal(submitted.status, 0, submitted.stderr || submitted.stdout);
  assert.equal(submitted.output.object.disposition, "in-progress");
  assert.equal(submitted.output.object.status, "video-submitted");
  const invoked = run("invoke-service", accepted, {
    PYTHONPATH: `${join(SOURCE, "test", "fake-gemini-notebook")}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""}`,
    FAKE_GEMINI_NOTEBOOK_STATE: statePath,
    EMSENN_READ_A_SCHEMA: schemaReader,
  });
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.object.disposition, "artifact");
  assert.equal(invoked.output.object.artifact.type, "video");
  assert.equal(invoked.output.object.artifact.payload.videoFormat, "explainer");
  assert.equal(invoked.output.object.artifact.payload.videoStyle, "whiteboard");
  assert.equal(invoked.output.object.artifact.payload.providerArtifactId, "video-fake-000001");
  assert.match(invoked.output.object.artifact.payload.sha256, /^sha256:[a-f0-9]{64}$/u);
  const state = JSON.parse(readFileSync(statePath));
  const generated = state.calls.find((call) => call[0] === "generate" && call[1] === "video");
  assert.ok(generated); assert.ok(generated.includes("explainer")); assert.ok(generated.includes("whiteboard"));
  const downloaded = state.calls.find((call) => call[0] === "download" && call[1] === "video");
  assert.equal(downloaded[downloaded.indexOf("--artifact") + 1], "video-fake-000001");
});

test("replayed reconciled cinematic polls one async task", async () => {
  const sourceDigest = sha256Digest(Buffer.from("kinematic space lesson\n")); const sourceIds = ["source-math-video-000001"];
  const body = { type: "GeminiNotebookSourceReconciliationReceipt", provider: PROVIDER, notebookId: "notebook-math-video-000001", requestDigest: semanticId({ reconciliation: "math-video-test" }),
    mode: "reconcile-live", policy: "replace-all-staged", outcome: "reconciled", previousSources: [], desiredSources: [{ digest: sourceDigest, title: "Kinematic space lesson" }],
    addedSources: [{ digest: sourceDigest, title: "Kinematic space lesson", sourceId: sourceIds[0] }], deletedSourceIds: [],
    finalSources: [{ id: sourceIds[0], title: "Kinematic space lesson", status: "ready", type: "file", url: null }], finalSourceIds: sourceIds,
    finalSourceSetDigest: semanticId(sourceIds), grounds: null, failureStage: null, cost: { denomination: "gemini-notebook-cli-call-and-wall-seconds", calls: 4, wallSeconds: 1 }, settledAt: NOW };
  const receipt = { id: semanticId(body), ...body }; await witnessJournal.record(join(root, "data"), "receipts", receipt, NOW);
  const statePath = join(base, "fake-gemini-notebook-math-video-state.json"); writeFileSync(statePath, JSON.stringify({ sequence: 0, sources: receipt.finalSources, calls: [] }));
  const request = { type: "GeminiNotebookRequest", sources: [{ path: "/receipt-bound/kinematic-space.md", digest: sourceDigest, title: "Kinematic space lesson" }],
    prompt: "Show causal diamonds becoming points in kinematic space.", artifactType: "video", videoFormat: "cinematic", videoStyle: null, videoLanguage: "en",
    executionMode: "live", corpusMode: "reconciled-notebook", notebookSourceReceiptId: receipt.id };
  const offered = run("solicit-service", solicit(leader("Generate the reconciled mathematics cinematic.", request))); assert.equal(offered.output.type, "Offer");
  const accepted = accept(offered.output, ["invoke-service", "external-network"]); const environment = {
    PYTHONPATH: `${join(SOURCE, "test", "fake-gemini-notebook")}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""}`,
    FAKE_GEMINI_NOTEBOOK_STATE: statePath, EMSENN_READ_A_SCHEMA: SCHEMA_READER,
  };
  const submitted = run("invoke-service", accepted, environment); assert.equal(submitted.status, 0, submitted.stderr || submitted.stdout);
  const completed = run("invoke-service", accepted, environment); assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  assert.equal(completed.output.object.artifact.payload.videoFormat, "cinematic"); assert.equal(completed.output.object.artifact.payload.videoStyle, null);
  const replayed = run("invoke-service", accepted, environment); assert.equal(replayed.status, 0, replayed.stderr || replayed.stdout);
  assert.equal(replayed.output.object.disposition, "artifact"); assert.equal(replayed.output.object.artifact.payload.providerArtifactId, "video-fake-000001");
  const state = JSON.parse(readFileSync(statePath)); assert.equal(state.calls.filter((call) => call[0] === "generate" && call[1] === "video").length, 1);
  assert.equal(state.calls.filter((call) => call[0] === "download" && call[1] === "video").length, 1);
});


test("a self-hashed-looking but provider-absent source receipt is not admitted", () => {
  const request = {
    type: "GeminiNotebookRequest", sources: [{ path: "/receipt-bound/current.json", digest: `sha256:${"a".repeat(64)}`, title: "Current" }],
    prompt: "Make audio.", artifactType: "audio", executionMode: "live", corpusMode: "reconciled-notebook",
    notebookSourceReceiptId: `urn:sha256:${"b".repeat(64)}`,
  };
  const result = run("solicit-service", solicit(leader("Use a claimed receipt.", request)));
  assert.equal(result.output.type, "Question");
  assert.ok(result.output.object.missing.includes("notebookSourceReceiptId(provider-local receipt not found)"));
});
