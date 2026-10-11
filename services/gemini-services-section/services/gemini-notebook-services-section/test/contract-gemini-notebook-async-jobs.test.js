import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { recordWitnessJournalBatch, relationalWitnessJournalDocument } from "@red-cup-engineering/witness-journal-document-service";

import { PROVIDER, resolveSourceReceipt, contentIdStem } from "../src/contract-gemini-notebook-audio-delivery.js";
import { cancelSourceJob, normalizeCliExecution, recoverAudioSubmission, recoverVideoSubmission, resumeAudioJob, resumeSourceJob, resumeVideoJob, startSourceCarrierRepair, submitAudioJob, submitSourceJob, submitVideoJob } from "../src/contract-gemini-notebook-async-jobs.js";
import { startGeminiNotebookWitnessJournalFixture } from "./witness-journal-fixture.js";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";

let operationSequence = 0;
let OPERATION;
function nextOperationId() { operationSequence += 1; return `ni:///sha-256;${operationSequence.toString(16).padStart(42, "0")}A`; }
const NOW = "2026-07-19T00:00:00.000Z";
const ACCOUNT = "eip155:31337:0xf1c133d8f725af2f4ad00176ff810e32d1d2f6cd";
let witnessJournal;
test.before(async () => { witnessJournal = await startGeminiNotebookWitnessJournalFixture(); });
test.beforeEach(() => { OPERATION = nextOperationId(); });
test.after(async () => { await witnessJournal.close(); });

async function receipt(dataRoot, overrides = {}) {
  const body = { type: "GeminiNotebookSourceReconciliationReceipt", provider: PROVIDER, notebookId: "notebook-stable", outcome: "reconciled", finalSourceIds: ["source-new"], finalSources: [{ id: "source-new", status: "ready" }], settledAt: NOW, ...overrides };
  const value = { id: semanticId(body), ...body };
  const envelope = { type: "GeminiNotebookJobRecord", category: "receipts", row: value }; const graph = semanticId(relationalWitnessJournalDocument(envelope));
  await recordWitnessJournalBatch({ agentUrl: witnessJournal.agentCardUrl, batch: { settlement: ACCOUNT, graph, recordedAt: NOW, document: relationalWitnessJournalDocument(envelope), assertions: [{ subject: PROVIDER, predicate: "urn:emsenn:gemini-notebook:recorded", object: { kind: "iri", value: graph } }, { subject: graph, predicate: "urn:emsenn:gemini-notebook:category", object: { kind: "literal", value: "receipts" } }] } });
  return value;
}

function explainerVideoRequest(sourceReceipt, overrides = {}) {
  const operationId = overrides.operationId ?? OPERATION;
  return { type: "GeminiNotebookAsyncVideoJobRequest", operationId, notebookId: "notebook-stable", prompt: "Explain the supplied relation.",
    videoFormat: "explainer", videoStyle: "whiteboard", videoLanguage: "en", notebookSourceReceiptId: sourceReceipt.id,
    providerRequestDigest: `ni:///sha-256;${"c".repeat(42)}A`, providerInvocationId: overrides.providerInvocationId ?? operationId,
    ...overrides };
}

test("an in-flight audio task is submitted once and later ticks poll the same task ID", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-async-audio-")); const dataRoot = join(root, "data"); const sourceReceipt = await receipt(dataRoot);
  const sourcePacket = { type: "HarmoniousUnionArtifactSourcePacket", documents: [{ name: "brief.json", content: "{\"fact\":true}" }].map((item) => ({ ...item, digest: sha256Digest(Buffer.from(item.content)) })) };
  const request = { type: "GeminiNotebookAsyncAudioJobRequest", operationId: OPERATION, notebookId: "notebook-stable", prompt: "Report only the supplied facts.", sourcePacket, sourcePacketDigest: semanticId(sourcePacket), notebookSourceReceiptId: sourceReceipt.id };
  const calls = []; let polls = 0;
  const runCli = (args) => {
    calls.push(args);
    if (args[0] === "generate") return { status: 0, json: { task_id: "task-persisted-001" } };
    if (args[0] === "artifact") return { status: 0, json: ++polls === 1 ? { task_id: "task-persisted-001", status: "in_progress" } : { artifact_id: "task-persisted-001", status: "completed" } };
    if (args[0] === "download") { writeFileSync(args[2], Buffer.concat([Buffer.from("ID3"), Buffer.alloc(16)])); return { status: 0, json: { path: args[2] } }; }
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, providerRoot: root, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    const submitted = await submitAudioJob(request, options); assert.equal(submitted.status, "audio-submitted"); assert.equal(submitted.taskId, "task-persisted-001");
    const duplicate = await submitAudioJob(request, options); assert.equal(duplicate.id, submitted.id);
    const pending = await resumeAudioJob(OPERATION, options); assert.equal(pending.status, "audio-in-progress"); assert.equal(pending.taskId, "task-persisted-001");
    assert.equal(calls.filter((args) => args[0] === "generate").length, 1, "the bad incumbent must not resubmit generation");
    assert.deepEqual(calls.filter((args) => args[0] === "artifact")[0].slice(0, 3), ["artifact", "poll", "task-persisted-001"]);
    const completed = await resumeAudioJob(OPERATION, { ...options, now: "2026-07-19T01:00:00.000Z" });
    assert.equal(completed.status, "completed"); assert.equal(completed.artifact.type, "GeminiNotebookAudioArtifact");
    assert.equal(calls.filter((args) => args[0] === "generate").length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an exact post-commit audio task is recovered without a second generation", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-audio-submit-recovery-")); const dataRoot = join(root, "data"); const sourceReceipt = await receipt(dataRoot);
  const sourcePacket = { type: "HarmoniousUnionArtifactSourcePacket", documents: [{ name: "brief.txt", content: "bounded\n" }].map((item) => ({ ...item, digest: sha256Digest(Buffer.from(item.content)) })) };
  const request = { type: "GeminiNotebookAsyncAudioJobRequest", operationId: OPERATION, notebookId: "notebook-stable", prompt: "Report supplied facts.", sourcePacket, sourcePacketDigest: semanticId(sourcePacket), notebookSourceReceiptId: sourceReceipt.id };
  let generations = 0;
  const ambiguousCli = (args) => { if (args[0] === "generate") { generations += 1; throw new Error("transport lost after provider commit"); } throw new Error(`unexpected call ${args.join(" ")}`); };
  try {
    await assert.rejects(submitAudioJob(request, { dataRoot, now: NOW, runCli: ambiguousCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl }), /transport lost/u);
    const pending = await recoverAudioSubmission({ type: "GeminiNotebookAudioSubmissionRecoveryRequest", operationId: OPERATION, expectedRequestDigest: semanticId(request), taskId: "task-recovered-001", grounds: "provider-task-observed-after-post-commit-journal-failure" }, { dataRoot, now: "2026-07-19T00:01:00.000Z", witnessJournalAgentUrl: witnessJournal.agentCardUrl, runCli: (args) => {
      assert.deepEqual(args.slice(0, 2), ["artifact", "list"]); return { status: 0, json: { artifacts: [{ id: "task-recovered-001", type_id: "audio", status: "pending", created_at: NOW }] } };
    } });
    assert.equal(pending.status, "audio-submitted"); assert.equal(pending.taskId, "task-recovered-001"); assert.equal(pending.recoveredPostCommitSubmission, true);
    const duplicate = await submitAudioJob(request, { dataRoot, now: "2026-07-19T00:02:00.000Z", runCli: ambiguousCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl });
    assert.equal(duplicate.taskId, "task-recovered-001"); assert.equal(generations, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an in-flight explainer video submits once, polls the exact task, and downloads the exact artifact", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-async-video-")); const dataRoot = join(root, "data"); const sourceReceipt = await receipt(dataRoot);
  const request = explainerVideoRequest(sourceReceipt); const calls = []; let polls = 0;
  const runCli = (args) => {
    calls.push(args);
    if (args[0] === "source") return { status: 0, json: [{ id: "source-new", status: "ready" }] };
    if (args[0] === "generate") return { status: 0, json: { task_id: "video-task-001" } };
    if (args[0] === "artifact") return { status: 0, json: ++polls === 1 ? { task_id: "video-task-001", status: "in_progress" } : { artifact_id: "video-artifact-001", status: "completed" } };
    if (args[0] === "download") { writeFileSync(args[2], Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("async video bytes")])); return { status: 0, json: { path: args[2] } }; }
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, providerRoot: root, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    const submitted = await submitVideoJob(request, options); assert.equal(submitted.status, "video-submitted"); assert.equal(submitted.taskId, "video-task-001");
    assert.equal((await submitVideoJob(request, options)).id, submitted.id);
    const pending = await resumeVideoJob(OPERATION, options); assert.equal(pending.status, "video-in-progress");
    const completed = await resumeVideoJob(OPERATION, { ...options, now: "2026-07-19T01:00:00.000Z" });
    assert.equal(completed.status, "completed"); assert.equal(completed.artifact.type, "video");
    assert.equal(completed.artifact.payload.videoFormat, "explainer"); assert.equal(completed.artifact.payload.videoStyle, "whiteboard");
    assert.equal(completed.artifact.payload.providerArtifactId, "video-artifact-001"); assert.match(completed.artifact.payload.sha256, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(calls.filter((args) => args[0] === "generate").length, 1);
    assert.deepEqual(calls.find((args) => args[0] === "generate"), ["generate", "video", request.prompt, "--format", "explainer", "--language", "en", "--style", "whiteboard", "--notebook", "notebook-stable", "--no-wait", "--json"]);
    assert.deepEqual(calls.find((args) => args[0] === "artifact").slice(0, 3), ["artifact", "poll", "video-task-001"]);
    assert.equal(calls.find((args) => args[0] === "download")[calls.find((args) => args[0] === "download").indexOf("--artifact") + 1], "video-artifact-001");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("video submission preserves an admitted legacy error source but recovers if a ready source had transiently degraded", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-video-source-baseline-")); const dataRoot = join(root, "data");
  try {
    const sourceReceipt = await receipt(dataRoot, { finalSourceIds: ["source-error", "source-ready"], finalSources: [{ id: "source-error", status: "error" }, { id: "source-ready", status: "ready" }] });
    const request = explainerVideoRequest(sourceReceipt); let observations = 0; let generations = 0;
    const runCli = (args) => {
      if (args[0] === "source") { observations += 1; return { status: 0, json: { sources: observations === 1 ? [{ id: "source-error", status: "error" }, { id: "source-ready", status: "error" }] : [{ id: "source-error", status: "error" }, { id: "source-ready", status: "ready" }] } }; }
      if (args[0] === "generate") { generations += 1; return { status: 0, json: { task_id: "video-task-recovered-001" } }; }
      throw new Error(`unexpected call ${args.join(" ")}`);
    };
    const options = { dataRoot, providerRoot: root, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
    const refused = await submitVideoJob(request, options); assert.equal(refused.code, "stable-notebook-source-set-changed-before-video-submission"); assert.equal(generations, 0);
    const recovered = await resumeVideoJob(OPERATION, { ...options, now: "2026-07-19T00:01:00.000Z" });
    assert.equal(recovered.status, "video-submitted"); assert.equal(recovered.taskId, "video-task-recovered-001"); assert.equal(recovered.recoveredFrom, "stable-notebook-source-set-changed-before-video-submission"); assert.equal(generations, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("concurrent explainer submission crosses one atomic operation lock and generates once", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-async-video-concurrent-")); const dataRoot = join(root, "data"); const sourceReceipt = await receipt(dataRoot);
  const request = explainerVideoRequest(sourceReceipt); let generations = 0;
  const runCli = (args) => {
    if (args[0] === "source") return { status: 0, json: [{ id: "source-new", status: "ready" }] };
    if (args[0] === "generate") { generations += 1; return { status: 0, json: { task_id: "video-concurrent-001" } }; }
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, providerRoot: root, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    const outcomes = await Promise.all([submitVideoJob(request, options), submitVideoJob(request, options)]);
    assert.equal(generations, 1);
    assert.equal(outcomes.some((row) => row.status === "video-submitted"), true);
    assert.equal(outcomes.every((row) => row.status === "video-submitted" || row.code === "video-submission-in-progress"), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an exact post-commit cinematic task is recovered without a second generation", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-video-submit-recovery-")); const dataRoot = join(root, "data"); const sourceReceipt = await receipt(dataRoot);
  const providerRequestDigest = `ni:///sha-256;${"d".repeat(42)}A`;
  const request = explainerVideoRequest(sourceReceipt, { videoFormat: "cinematic", videoStyle: null, videoLanguage: "en", providerRequestDigest,
    });
  let generations = 0;
  const ambiguousCli = (args) => {
    if (args[0] === "source") return { status: 0, json: [{ id: "source-new", status: "ready" }] };
    if (args[0] === "generate") { generations += 1; throw new Error("transport lost after video provider commit"); }
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  try {
    await assert.rejects(submitVideoJob(request, { dataRoot, now: NOW, runCli: ambiguousCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl }), /transport lost/u);
    const pending = await recoverVideoSubmission({ type: "GeminiNotebookVideoSubmissionRecoveryRequest", operationId: OPERATION, expectedRequestDigest: semanticId(request), taskId: "video-recovered-001", grounds: "provider-task-observed-after-post-commit-journal-failure" }, { dataRoot, now: "2026-07-19T00:01:00.000Z", witnessJournalAgentUrl: witnessJournal.agentCardUrl, runCli: (args) => {
      assert.deepEqual(args.slice(0, 2), ["artifact", "list"]); assert.ok(args.includes("video"));
      return { status: 0, json: { artifacts: [{ id: "video-recovered-001", type_id: "video", status: "pending", created_at: NOW }] } };
    } });
    assert.equal(pending.status, "video-submitted"); assert.equal(pending.taskId, "video-recovered-001"); assert.equal(pending.recoveredPostCommitSubmission, true);
    assert.equal((await submitVideoJob(request, { dataRoot, now: NOW, runCli: ambiguousCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl })).taskId, "video-recovered-001");
    assert.equal(generations, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("video completion recovers an exact post-download carrier without downloading again", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-video-download-recovery-")); const dataRoot = join(root, "data"); const sourceReceipt = await receipt(dataRoot);
  const request = explainerVideoRequest(sourceReceipt); let downloads = 0; let generations = 0;
  const runCli = (args) => {
    if (args[0] === "source") return { status: 0, json: [{ id: "source-new", status: "ready" }] };
    if (args[0] === "generate") { generations += 1; return { status: 0, json: { task_id: "video-download-task" } }; }
    if (args[0] === "artifact") return { status: 0, json: { artifact_id: "video-download-artifact", status: "completed" } };
    if (args[0] === "download") { downloads += 1; writeFileSync(args[2], Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("post commit bytes")])); return { status: 0, json: { path: args[2] } }; }
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, providerRoot: root, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    await submitVideoJob(request, options);
    await assert.rejects(resumeVideoJob(OPERATION, { ...options,
      recordWitnessJournalBatch: async () => { throw new Error("journal transport lost after download"); } }), /journal transport lost/u);
    const recovered = await resumeVideoJob(OPERATION, { ...options, now: "2026-07-19T00:02:00.000Z" });
    assert.equal(recovered.status, "completed"); assert.equal(recovered.recoveredPostCommitDownload, true);
    assert.equal(generations, 1); assert.equal(downloads, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a completed video with a temporarily unavailable download remains resumable", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-video-download-retry-")); const dataRoot = join(root, "data"); const sourceReceipt = await receipt(dataRoot);
  const request = explainerVideoRequest(sourceReceipt); let downloads = 0; let generations = 0;
  const runCli = (args) => {
    if (args[0] === "source") return { status: 0, json: [{ id: "source-new", status: "ready" }] };
    if (args[0] === "generate") { generations += 1; return { status: 0, json: { task_id: "video-download-retry-task" } }; }
    if (args[0] === "artifact") return { status: 0, json: { artifact_id: "video-download-retry-artifact", status: "completed" } };
    if (args[0] === "download") {
      downloads += 1; if (downloads === 1) return { status: 1, json: null, stderr: "artifact is not downloadable yet" };
      writeFileSync(args[2], Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("retry bytes")])); return { status: 0, json: { path: args[2] } };
    }
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, providerRoot: root, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    await submitVideoJob(request, options);
    const pending = await resumeVideoJob(OPERATION, options); assert.equal(pending.status, "video-in-progress"); assert.equal(pending.code, "video-download-failed");
    const completed = await resumeVideoJob(OPERATION, { ...options, now: "2026-07-19T00:03:00.000Z" }); assert.equal(completed.status, "completed");
    assert.equal(generations, 1); assert.equal(downloads, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a completed video recovers metadata after its exchange directory becomes writable", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-video-metadata-recovery-")); const dataRoot = join(root, "data"); const sourceReceipt = await receipt(dataRoot);
  const request = explainerVideoRequest(sourceReceipt); let downloads = 0; let generations = 0;
  const runCli = (args) => {
    if (args[0] === "source") return { status: 0, json: [{ id: "source-new", status: "ready" }] };
    if (args[0] === "generate") { generations += 1; return { status: 0, json: { task_id: "video-metadata-task" } }; }
    if (args[0] === "artifact") return { status: 0, json: { artifact_id: "video-metadata-artifact", status: "completed" } };
    if (args[0] === "download") { downloads += 1; writeFileSync(args[2], Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("metadata recovery bytes")])); return { status: 0, json: { path: args[2] } }; }
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, providerRoot: root, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  const metadataPath = join(root, "content", "exchanges", `${contentIdStem(OPERATION)}.video.json`);
  try {
    await submitVideoJob(request, options);
    mkdirSync(join(root, "content", "exchanges"), { recursive: true }); writeFileSync(metadataPath, "conflicting metadata\n");
    const refused = await resumeVideoJob(OPERATION, options); assert.equal(refused.status, "refused"); assert.equal(refused.code, "video-metadata-conflict");
    rmSync(metadataPath);
    const recovered = await resumeVideoJob(OPERATION, { ...options, now: "2026-07-19T00:03:00.000Z" }); assert.equal(recovered.status, "completed");
    assert.equal(recovered.recoveredPostCommitDownload, true); assert.equal(generations, 1); assert.equal(downloads, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("video polling and download transport exceptions remain typed and never resubmit", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-video-transport-recovery-")); const dataRoot = join(root, "data"); const sourceReceipt = await receipt(dataRoot);
  const request = explainerVideoRequest(sourceReceipt); let generations = 0; let polls = 0; let downloads = 0;
  const runCli = (args) => {
    if (args[0] === "source") return { status: 0, json: [{ id: "source-new", status: "ready" }] };
    if (args[0] === "generate") { generations += 1; return { status: 0, json: { task_id: "video-transport-task" } }; }
    if (args[0] === "artifact") { polls += 1; if (polls === 1) throw Object.assign(new Error("poll transport"), { code: "ECONNRESET" }); return { status: 0, json: { artifact_id: "video-transport-artifact", status: "completed" } }; }
    if (args[0] === "download") { downloads += 1; writeFileSync(args[2], Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("transport committed bytes")])); throw Object.assign(new Error("reply lost"), { code: "ECONNRESET" }); }
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, providerRoot: root, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    await submitVideoJob(request, options);
    const pending = await resumeVideoJob(OPERATION, options); assert.equal(pending.status, "video-in-progress"); assert.equal(pending.code, "poll-transport-exception");
    const completed = await resumeVideoJob(OPERATION, { ...options, now: "2026-07-19T00:03:00.000Z" });
    assert.equal(completed.status, "completed"); assert.equal(completed.recoveredPostCommitDownload, true);
    assert.equal(generations, 1); assert.equal(downloads, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("video jobs reject unsupported styles and non-English cinematic requests before generation", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-video-binding-refusal-")); const dataRoot = join(root, "data"); const sourceReceipt = await receipt(dataRoot); let calls = 0;
  const options = { dataRoot, now: NOW, runCli: () => { calls += 1; return { status: 0, json: [] }; }, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    for (const terms of [{ videoStyle: "invalid" }, { videoFormat: "cinematic", videoStyle: null, videoLanguage: "fr" }]) {
      assert.equal((await submitVideoJob(explainerVideoRequest(sourceReceipt, terms), options)).code, "invalid-request-or-provider-receipt-binding");
    }
    assert.equal(calls, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("source replacement persists each uploaded ID and retires incumbents only after all staged sources are ready", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-async-source-")); const dataRoot = join(root, "data"); const path = join(root, "brief.json"); writeFileSync(path, "{\"fact\":true}\n");
  const request = { type: "GeminiNotebookAsyncSourceJobRequest", operationId: OPERATION, notebookId: "notebook-stable", expectedCurrentSourceIds: ["source-old"], desiredSources: [{ path, title: "Union brief", digest: sha256Digest(readFileSync(path)) }] };
  const calls = []; let lists = 0;
  const runCli = (args) => {
    calls.push(args);
    if (args[0] === "source" && args[1] === "list") {
      lists += 1;
      if (lists === 1) return { status: 0, json: [{ id: "source-old", title: "old", status: "ready" }] };
      if (lists === 2) return { status: 0, json: [{ id: "source-old", status: "ready" }, { id: "source-new", status: "processing" }] };
      return { status: 0, json: [{ id: "source-old", status: "ready" }, { id: "source-new", status: "ready" }] };
    }
    if (args[0] === "source" && args[1] === "add") return { status: 0, json: { source: { id: "source-new" } } };
    if (args[0] === "source" && args[1] === "delete") return { status: 0, json: { deleted: args[2] } };
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    assert.equal((await submitSourceJob(request, options)).status, "source-uploading");
    const staged = await resumeSourceJob(OPERATION, options); assert.equal(staged.status, "source-processing"); assert.deepEqual(staged.stagedSources.map((item) => item.id), ["source-new"]);
    const pending = await resumeSourceJob(OPERATION, options); assert.equal(pending.status, "source-processing"); assert.equal(calls.some((args) => args[1] === "delete"), false);
    assert.equal((await resumeSourceJob(OPERATION, options)).status, "source-retiring"); assert.equal(calls.some((args) => args[1] === "delete"), false);
    assert.equal((await resumeSourceJob(OPERATION, options)).status, "source-retiring"); assert.deepEqual(calls.find((args) => args[1] === "delete").slice(0, 3), ["source", "delete", "source-old"]);
    const completed = await resumeSourceJob(OPERATION, options); assert.equal(completed.status, "completed"); assert.deepEqual(completed.receipt.finalSourceIds, ["source-new"]);
    assert.equal((await resolveSourceReceipt(dataRoot, completed.receipt.id, { witnessJournalAgentUrl: witnessJournal.agentCardUrl }))?.id, completed.receipt.id, "provider must resolve the exact receipt it issued");
    assert.equal(calls.filter((args) => args[1] === "add").length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a post-commit source-delete append failure recovers the exact observed set without deleting twice", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-source-delete-recovery-")); const dataRoot = join(root, "data"); const path = join(root, "brief.txt"); writeFileSync(path, "current\n");
  const request = { type: "GeminiNotebookAsyncSourceJobRequest", operationId: OPERATION, notebookId: "notebook-stable", expectedCurrentSourceIds: ["source-old"], desiredSources: [{ path, title: "Current", digest: sha256Digest(readFileSync(path)) }] };
  const live = new Set(["source-old"]); const deleted = [];
  const runCli = (args) => {
    if (args[0] === "source" && args[1] === "list") return { status: 0, json: [...live].map((id) => ({ id, status: "ready" })) };
    if (args[0] === "source" && args[1] === "add") { live.add("source-new"); return { status: 0, json: { id: "source-new" } }; }
    if (args[0] === "source" && args[1] === "delete") { deleted.push(args[2]); live.delete(args[2]); return { status: 0, json: { deleted: args[2] } }; }
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    await submitSourceJob(request, options); await resumeSourceJob(OPERATION, options);
    assert.equal((await resumeSourceJob(OPERATION, options)).status, "source-retiring");
    await assert.rejects(resumeSourceJob(OPERATION, { ...options,
      recordWitnessJournalBatch: async () => { throw new Error("journal transport lost after delete"); } }), /journal transport lost/u);
    assert.deepEqual(deleted, ["source-old"]); assert.deepEqual([...live], ["source-new"]);
    const recovered = await resumeSourceJob(OPERATION, options);
    assert.equal(recovered.status, "source-retiring"); assert.equal(recovered.recoveredPostCommitDeletedSourceId, "source-old"); assert.deepEqual(recovered.remainingRetiredSourceIds, []);
    assert.deepEqual(deleted, ["source-old"], "recovery must not issue the delete twice");
    const completed = await resumeSourceJob(OPERATION, options); assert.equal(completed.status, "completed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("cancellation removes only a refused downstream run's staged sources before incumbent retirement", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-source-cancellation-")); const dataRoot = join(root, "data");
  const paths = [join(root, "one.txt"), join(root, "two.txt")]; writeFileSync(paths[0], "one\n"); writeFileSync(paths[1], "two\n");
  const request = { type: "GeminiNotebookAsyncSourceJobRequest", operationId: OPERATION, notebookId: "notebook-stable", expectedCurrentSourceIds: ["source-incumbent"], desiredSources: paths.map((path, index) => ({ path, title: `Source ${index + 1}`, digest: sha256Digest(readFileSync(path)) })) };
  const deleted = []; let added = 0;
  const runCli = (args) => {
    if (args[0] === "source" && args[1] === "list") return { status: 0, json: [{ id: "source-incumbent", title: "incumbent", status: "ready" }] };
    if (args[0] === "source" && args[1] === "add") return { status: 0, json: { source: { id: `source-staged-${++added}` } } };
    if (args[0] === "source" && args[1] === "delete") { deleted.push(args[2]); return { status: 0, json: { deleted: args[2] } }; }
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    const submitted = await submitSourceJob(request, options); await resumeSourceJob(OPERATION, options); const staged = await resumeSourceJob(OPERATION, options);
    assert.equal(staged.status, "source-processing"); assert.deepEqual(staged.stagedSources.map((source) => source.id), ["source-staged-1", "source-staged-2"]);
    const cancellation = { type: "GeminiNotebookSourceJobCancellationRequest", operationId: OPERATION, expectedRequestDigest: submitted.requestDigest, grounds: "downstream-run-refused-before-source-retirement" };
    assert.equal((await cancelSourceJob({ ...cancellation, expectedRequestDigest: "sha256:mismatch" }, options)).code, "source-job-request-digest-mismatch"); assert.deepEqual(deleted, []);
    assert.equal((await cancelSourceJob(cancellation, options)).status, "source-cancelling"); assert.deepEqual(deleted, []);
    await cancelSourceJob(cancellation, options); await cancelSourceJob(cancellation, options); const completed = await cancelSourceJob(cancellation, options);
    assert.equal(completed.status, "cancelled"); assert.deepEqual(deleted, ["source-staged-1", "source-staged-2"]);
    assert.deepEqual(completed.cancellationReceipt.preservedIncumbentSourceIds, ["source-incumbent"]);
    assert.equal(deleted.includes("source-incumbent"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a post-commit source-add failure recovers one stripped-title upload without resubmitting", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-async-source-recovery-")); const dataRoot = join(root, "data"); const path = join(root, "01-brief.txt"); writeFileSync(path, "{\"fact\":true}\n");
  const request = { type: "GeminiNotebookAsyncSourceJobRequest", operationId: OPERATION, notebookId: "notebook-stable", expectedCurrentSourceIds: ["source-old"], desiredSources: [{ path, title: "Union brief", digest: sha256Digest(readFileSync(path)) }] };
  const calls = []; let lists = 0;
  const runCli = (args) => {
    calls.push(args);
    if (args[0] === "source" && args[1] === "list") {
      lists += 1;
      return lists === 1 ? { status: 0, json: [{ id: "source-old", title: "old", status: "ready" }] }
        : { status: 0, json: [{ id: "source-old", title: "old", status: "ready" }, { id: "source-recovered", title: "01-brief.txt", status: "preparing" }] };
    }
    if (args[0] === "source" && args[1] === "add") return { status: 1, json: null, stderr: "serialization failed after upload commit" };
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    assert.equal((await submitSourceJob(request, options)).status, "source-uploading");
    const ambiguous = await resumeSourceJob(OPERATION, options); assert.equal(ambiguous.status, "refused"); assert.equal(ambiguous.code, "source-add-failed-or-ambiguous");
    const recovered = await resumeSourceJob(OPERATION, options); assert.equal(recovered.status, "source-processing"); assert.equal(recovered.recoveredPostCommitSourceId, "source-recovered");
    assert.deepEqual(recovered.stagedSources.map((source) => source.id), ["source-recovered"]);
    assert.equal(calls.filter((args) => args[0] === "source" && args[1] === "add").length, 1, "recovery must not upload again");
    assert.equal(calls.filter((args) => args[0] === "source" && args[1] === "list").length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("explicit provider source failure settles a typed refusal while preparing stays in flight", async () => {
  for (const providerStatus of ["preparing", "error", "failed", "refused"]) {
    OPERATION = nextOperationId();
    const root = mkdtempSync(join(tmpdir(), `gemini-notebook-source-status-${providerStatus}-`)); const dataRoot = join(root, "data"); const path = join(root, "brief.json"); writeFileSync(path, "{\"fact\":true}\n");
    const request = { type: "GeminiNotebookAsyncSourceJobRequest", operationId: OPERATION, notebookId: "notebook-stable", expectedCurrentSourceIds: [], desiredSources: [{ path, title: "Union brief", digest: sha256Digest(readFileSync(path)) }] };
    let lists = 0; const calls = [];
    const runCli = (args) => {
      calls.push(args);
      if (args[1] === "list") return { status: 0, json: ++lists === 1 ? [] : [{ id: "source-new", title: "Union brief", status: providerStatus }] };
      if (args[1] === "add") return { status: 0, json: { id: "source-new" } };
      throw new Error(`unexpected call ${args.join(" ")}`);
    };
    try {
      const options = { dataRoot, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
      await submitSourceJob(request, options); await resumeSourceJob(OPERATION, options);
      const observed = await resumeSourceJob(OPERATION, options);
      if (providerStatus === "preparing") assert.equal(observed.status, "source-processing");
      else { assert.equal(observed.status, "refused"); assert.equal(observed.code, "source-processing-terminal-failure"); assert.deepEqual(observed.terminalFailures, [{ id: "source-new", status: providerStatus }]); }
      assert.equal(calls.some((args) => args[1] === "delete"), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("manual carrier repair starts a distinct preconditioned job with byte-identical text carriers and no early delete", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-carrier-repair-")); const dataRoot = join(root, "data"); const path = join(root, "manifest.json"); const bytes = Buffer.from("{\"union\":\"bounded\"}\n"); writeFileSync(path, bytes);
  const repairOperationId = nextOperationId(); const calls = []; let lists = 0;
  const runCli = (args) => {
    calls.push(args);
    if (args[1] === "list") {
      lists += 1;
      if (lists === 1) return { status: 0, json: [] };
      if (lists === 2) return { status: 0, json: [{ id: "source-structured", title: "manifest.json", status: "preparing" }] };
      if (lists === 3) return { status: 0, json: [{ id: "source-structured", status: "preparing" }, { id: "source-text", status: "preparing" }] };
      return { status: 0, json: [{ id: "source-structured", status: "preparing" }, { id: "source-text", status: "ready" }] };
    }
    if (args[1] === "add") return { status: 0, json: { id: "source-text" } };
    if (args[1] === "delete") return { status: 0, json: { deleted: args[2] } };
    throw new Error(`unexpected call ${args.join(" ")}`);
  };
  const options = { dataRoot, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl };
  try {
    await submitSourceJob({ type: "GeminiNotebookAsyncSourceJobRequest", operationId: OPERATION, notebookId: "notebook-stable", expectedCurrentSourceIds: [], desiredSources: [{ path, title: "manifest.json", digest: sha256Digest(bytes) }] }, options);
    const repair = await startSourceCarrierRepair({ type: "GeminiNotebookSourceCarrierRepairRequest", manual: true, grounds: "structured-file-sources-nonterminal-plain-text-works", originalOperationId: OPERATION, repairOperationId, expectedCurrentSourceIds: ["source-structured"] }, options);
    assert.equal(repair.status, "started"); assert.equal(repair.receipt.repairOperationId, repairOperationId); assert.notEqual(repair.receipt.repairOperationId, OPERATION);
    assert.match(repair.receipt.carriers[0].path, /\.txt$/u); assert.deepEqual(readFileSync(repair.receipt.carriers[0].path), bytes); assert.equal(repair.receipt.carriers[0].digest, sha256Digest(bytes));
    assert.equal((await resumeSourceJob(repairOperationId, options)).status, "source-processing");
    assert.equal((await resumeSourceJob(repairOperationId, options)).status, "source-processing"); assert.equal(calls.some((args) => args[1] === "delete"), false);
    assert.equal((await resumeSourceJob(repairOperationId, options)).status, "source-retiring"); assert.equal(calls.some((args) => args[1] === "delete"), false);
    await resumeSourceJob(repairOperationId, options); assert.deepEqual(calls.find((args) => args[1] === "delete").slice(0, 3), ["source", "delete", "source-structured"]);
    assert.equal(calls.filter((args) => args[1] === "add").length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an explicit cancelled provider process closes as a typed source refusal before any source mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-source-cancelled-")); const dataRoot = join(root, "data");
  const path = join(root, "brief.txt"); writeFileSync(path, "bounded source\n");
  const request = { type: "GeminiNotebookAsyncSourceJobRequest", operationId: OPERATION, notebookId: "notebook-stable",
    expectedCurrentSourceIds: [], desiredSources: [{ path, title: "Union brief", digest: sha256Digest(readFileSync(path)) }] };
  const calls = [];
  const runCli = (args) => {
    calls.push(args);
    return normalizeCliExecution({ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" }, stdout: "", stderr: "" });
  };
  try {
    const result = await submitSourceJob(request, { dataRoot, now: NOW, runCli, witnessJournalAgentUrl: witnessJournal.agentCardUrl });
    assert.equal(result.status, "refused");
    assert.equal(result.code, "source-list-failed");
    assert.deepEqual(result.providerObservation, { status: 124, signal: "SIGTERM", errorCode: "ETIMEDOUT" });
    assert.equal(calls.some((args) => args[1] === "add" || args[1] === "delete"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
