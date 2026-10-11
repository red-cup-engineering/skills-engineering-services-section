import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { settleGeminiNotebookAudio } from "../src/contract-gemini-notebook.js";
import { PROVIDER } from "../src/contract-gemini-notebook-audio-delivery.js";
import { startGeminiNotebookWitnessJournalFixture } from "./witness-journal-fixture.js";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";

let witnessJournal;
before(async () => { witnessJournal = await startGeminiNotebookWitnessJournalFixture(); });
after(async () => { await witnessJournal.close(); });

async function fixture() {
  const providerRoot = mkdtempSync(join(tmpdir(), "gemini-notebook-audio-integration-"));
  const dataRoot = join(providerRoot, "data");
  const receiptBody = {
    type: "GeminiNotebookSourceReconciliationReceipt",
    provider: PROVIDER,
    notebookId: "notebook-integrated",
    outcome: "reconciled",
    finalSourceIds: ["source-integrated"],
    settledAt: "2026-07-19T00:00:00.000Z",
  };
  const receipt = { id: semanticId(receiptBody), ...receiptBody };
  await witnessJournal.record(dataRoot, "receipts", receipt);
  const audio = Buffer.concat([Buffer.from("ID3", "ascii"), Buffer.alloc(10), Buffer.from("integration audio")]);
  const audioPath = join(providerRoot, "artifacts", "generated.mp3");
  mkdirSync(dirname(audioPath), { recursive: true }); writeFileSync(audioPath, audio);
  const sourcePacket = {
    type: "HarmoniousUnionArtifactSourcePacket",
    documents: [{ name: "integrated.md", content: "Integrated source", digest: sha256Digest(Buffer.from("Integrated source")) }],
  };
  const sourcePacketDigest = semanticId(sourcePacket);
  const request = {
    sources: sourcePacket.documents.map((document) => ({ path: join(providerRoot, "sources", document.name), title: document.name, digest: sha256Digest(Buffer.from(document.content)) })),
    prompt: "Generate the integrated audio.",
    artifactType: "audio",
    executionMode: "live",
    corpusMode: "reconciled-notebook",
    sourcePacket,
    sourcePacketDigest,
    notebookSourceReceiptId: receipt.id,
  };
  const generationOffer = {
    type: "Offer",
    actor: PROVIDER,
    object: { type: "ExecutableServiceOffer", request, requestDigest: semanticId(request) },
  };
  const generationInvocation = {
    type: "Accept",
    id: "urn:activity:gemini-notebook-audio-integration",
    actor: "urn:ame:leader-movement-team",
    target: PROVIDER,
    object: { offer: generationOffer },
  };
  const harnessResult = { ok: true, outcome: "artifact", record: { artifact: { type: "audio", path: audioPath } } };
  const options = {
    providerRoot,
    dataRoot,
    witnessJournalAgentUrl: witnessJournal.agentCardUrl,
    generationOffer,
    generationInvocation,
    recordGenerationWitness: (result) => {
      const event = {
        source: PROVIDER,
        type: "org.emsenn.notebooklm-inference-team.contract.completed",
        subject: generationInvocation.id,
        data: { activityDigest: semanticId(generationInvocation), result: result.id },
      };
      return witnessJournal.record(dataRoot, "events", event);
    },
  };
  return { providerRoot, dataRoot, receipt, audio, request, harnessResult, options, cleanup: () => rmSync(providerRoot, { recursive: true, force: true }) };
}

test("invoke-service audio settlement returns explicit bytes and never the provider-local path", async () => {
  const f = await fixture();
  try {
    const result = await settleGeminiNotebookAudio(f.request, f.harnessResult, f.options);
    assert.equal(result.type, "GeminiNotebookAudioArtifact");
    assert.deepEqual(Buffer.from(result.audioBase64, "base64"), f.audio);
    assert.equal(result.audioDigest, sha256Digest(f.audio));
    assert.equal(result.byteLength, f.audio.length);
    assert.equal(result.mediaType, "audio/mpeg");
    assert.equal(result.sourcePacketDigest, f.request.sourcePacketDigest);
    assert.equal(result.notebookSourceReceiptId, f.receipt.id);
    assert.equal(Object.hasOwn(result, "path"), false);
    assert.equal(JSON.stringify(result).includes(f.harnessResult.record.artifact.path), false);
  } finally { f.cleanup(); }
});

test("invoke-service audio settlement refuses a harness binding that differs from the exact operation request", async () => {
  const f = await fixture();
  try {
    f.harnessResult.record.notebookSourceReceiptId = `urn:sha256:${"8".repeat(64)}`;
    const result = await settleGeminiNotebookAudio(f.request, f.harnessResult, f.options);
    assert.equal(result.type, "GeminiNotebookAudioDeliveryRefusal");
    assert.equal(result.code, "generation-bindings-mismatch");
    assert.equal(Object.hasOwn(result, "path"), false);
  } finally { f.cleanup(); }
});
