import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { deriveCborNi } from "@red-cup-engineering/cbor-services-section";
import { deliverGeminiNotebookAudio, omitUndefinedObjectProperties, PROVIDER, resolveSourceReceipt } from "../src/contract-gemini-notebook-audio-delivery.js";
import { startGeminiNotebookWitnessJournalFixture } from "./witness-journal-fixture.js";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";

let witnessJournal;
before(async () => { witnessJournal = await startGeminiNotebookWitnessJournalFixture(); });
after(async () => { await witnessJournal.close(); });
function deliveryOptions(f) { return { providerRoot: f.root, dataRoot: f.dataRoot, witnessJournalAgentUrl: witnessJournal.agentCardUrl }; }

test("delivery identity is independent of key order and omits undefined members", () => {
  const value = { z: [null, true, false, 4, "é"], a: { β: 2, alpha: 1 }, omitted: undefined };
  assert.equal(semanticId(value), semanticId({ a: { alpha: 1, β: 2 }, z: [null, true, false, 4, "é"] }));
  assert.equal(semanticId(value), deriveCborNi({ value: omitUndefinedObjectProperties(value) }).uri);
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-audio-delivery-"));
  const dataRoot = join(root, "data");
  const body = {
    type: "GeminiNotebookSourceReconciliationReceipt",
    provider: PROVIDER,
    notebookId: "notebook-1",
    outcome: "reconciled",
    finalSourceIds: ["source-1"],
    settledAt: "2026-07-19T00:00:00.000Z",
  };
  const receipt = { id: semanticId(body), ...body };
  await witnessJournal.record(dataRoot, "receipts", receipt);
  const bytes = Buffer.concat([Buffer.from("ID3", "ascii"), Buffer.from([4, 0, 0, 0, 0, 0, 0]), Buffer.from("bounded audio")]);
  const audioPath = join(root, "artifacts", "briefing.mp3"); mkdirSync(dirname(audioPath), { recursive: true }); writeFileSync(audioPath, bytes);
  const sourcePacket = {
    type: "HarmoniousUnionArtifactSourcePacket",
    documents: [
      { name: "current-manifest.json", content: "{\"period\":\"2026-07-19\"}" },
      { name: "narrative.txt", content: "Bounded state narrative." },
    ].map((document) => ({ ...document, digest: sha256Digest(Buffer.from(document.content)) })),
  };
  const generationRequest = {
    sources: sourcePacket.documents.map((document) => ({ path: join(root, "sources", document.name), digest: sha256Digest(Buffer.from(document.content)), title: document.name })),
    prompt: "Produce a source-grounded audio briefing.", artifactType: "audio", executionMode: "live",
    corpusMode: "reconciled-notebook", notebookSourceReceiptId: receipt.id,
  };
  const offer = {
    type: "Offer", actor: PROVIDER, id: `urn:sha256:${"c".repeat(64)}`,
    object: { type: "ExecutableServiceOffer", request: generationRequest, requestDigest: semanticId(generationRequest) },
  };
  const invocation = { type: "Accept", target: PROVIDER, id: `urn:sha256:${"e".repeat(64)}`, object: { offer } };
  const resultObject = { type: "GeminiNotebookServiceResult", requestDigest: offer.object.requestDigest, notebookSourceReceiptId: receipt.id, artifact: { type: "audio", path: audioPath } };
  const generationResult = { type: "Accept", actor: PROVIDER, inReplyTo: invocation.id, object: resultObject };
  generationResult.id = semanticId({ actor: generationResult.actor, type: generationResult.type, inReplyTo: generationResult.inReplyTo, object: resultObject });
  const recordWitness = (result = generationResult) => witnessJournal.record(dataRoot, "events", { source: PROVIDER, type: "org.emsenn.notebooklm-inference-team.contract.completed", subject: invocation.id, data: { activityDigest: semanticId(invocation), result: result.id } });
  await recordWitness();
  const request = {
    type: "GeminiNotebookAudioDeliveryRequest",
    sourcePacket,
    sourcePacketDigest: semanticId(sourcePacket),
    notebookSourceReceiptId: receipt.id,
    generationOffer: offer,
    generationInvocation: invocation,
    generationResult,
  };
  return { root, dataRoot, receipt, bytes, sourcePacket, packetDigest: semanticId(sourcePacket), recordWitness, request, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("returns explicit bound MP3 bytes without exposing the provider-local path", async () => {
  const f = await fixture();
  try {
    const result = await deliverGeminiNotebookAudio(f.request, deliveryOptions(f));
    assert.equal(result.type, "GeminiNotebookAudioArtifact");
    assert.equal(result.mediaType, "audio/mpeg");
    assert.equal(result.byteLength, f.bytes.length);
    assert.equal(result.audioDigest, sha256Digest(f.bytes));
    assert.deepEqual(Buffer.from(result.audioBase64, "base64"), f.bytes);
    assert.equal(result.sourcePacketDigest, f.packetDigest);
    assert.equal(result.notebookSourceReceiptId, f.receipt.id);
    assert.equal(Object.hasOwn(result, "path"), false);
    assert.equal(Object.hasOwn(result, "providerLocalPath"), false);
  } finally { f.cleanup(); }
});

test("refuses absent, foreign, or mismatched receipt and generation bindings", async () => {
  const f = await fixture();
  try {
    const absent = structuredClone(f.request); absent.notebookSourceReceiptId = `urn:sha256:${"b".repeat(64)}`;
    assert.equal((await deliverGeminiNotebookAudio(absent, deliveryOptions(f))).code, "provider-local-source-reconciliation-receipt-absent-or-invalid");
    const mismatch = structuredClone(f.request); mismatch.generationOffer.object.request.sources[0].digest = `sha256:${"c".repeat(64)}`;
    assert.equal((await deliverGeminiNotebookAudio(mismatch, deliveryOptions(f))).code, "generation-bindings-mismatch");
    const foreignBody = { type: "GeminiNotebookSourceReconciliationReceipt", provider: "urn:ame:foreign", notebookId: "notebook-1", outcome: "reconciled", finalSourceIds: ["source-1"], settledAt: "2026-07-19T00:00:00.000Z" };
    const foreign = { id: semanticId(foreignBody), ...foreignBody }; await witnessJournal.record(f.dataRoot, "receipts", foreign);
    assert.equal(await resolveSourceReceipt(f.dataRoot, foreign.id, deliveryOptions(f)), null);
  } finally { f.cleanup(); }
});

test("requires the exact content-valid generation envelope and provider-local completion witness", async () => {
  const f = await fixture();
  try {
    const forged = structuredClone(f.request); forged.generationResult.object.artifact.path = "/etc/passwd";
    assert.equal((await deliverGeminiNotebookAudio(forged, deliveryOptions(f))).code, "generation-bindings-mismatch");
    const unwitnessed = structuredClone(f.request); unwitnessed.generationResult.object.artifact.mediaType = "audio/mpeg";
    unwitnessed.generationResult.id = semanticId({ actor: unwitnessed.generationResult.actor, type: unwitnessed.generationResult.type, inReplyTo: unwitnessed.generationResult.inReplyTo, object: unwitnessed.generationResult.object });
    assert.equal((await deliverGeminiNotebookAudio(unwitnessed, deliveryOptions(f))).code, "generation-bindings-mismatch");
  } finally { f.cleanup(); }
});

test("refuses path escape, non-MP3 bytes, media mismatch, byte mismatch, and digest mismatch", async () => {
  const f = await fixture();
  try {
    const escaped = structuredClone(f.request); escaped.generationResult.object.artifact.path = "/etc/passwd";
    escaped.generationResult.id = semanticId({ actor: escaped.generationResult.actor, type: escaped.generationResult.type, inReplyTo: escaped.generationResult.inReplyTo, object: escaped.generationResult.object });
    await f.recordWitness(escaped.generationResult);
    assert.equal((await deliverGeminiNotebookAudio(escaped, deliveryOptions(f))).code, "artifact-path-absent-or-outside-provider");
    const wrongMedia = structuredClone(f.request); wrongMedia.generationResult.object.artifact.mediaType = "audio/wav";
    wrongMedia.generationResult.id = semanticId({ actor: wrongMedia.generationResult.actor, type: wrongMedia.generationResult.type, inReplyTo: wrongMedia.generationResult.inReplyTo, object: wrongMedia.generationResult.object });
    await f.recordWitness(wrongMedia.generationResult);
    assert.equal((await deliverGeminiNotebookAudio(wrongMedia, deliveryOptions(f))).code, "artifact-media-type-mismatch");
    const wrongLength = structuredClone(f.request); wrongLength.generationResult.object.artifact.byteLength = f.bytes.length + 1;
    wrongLength.generationResult.id = semanticId({ actor: wrongLength.generationResult.actor, type: wrongLength.generationResult.type, inReplyTo: wrongLength.generationResult.inReplyTo, object: wrongLength.generationResult.object });
    await f.recordWitness(wrongLength.generationResult);
    assert.equal((await deliverGeminiNotebookAudio(wrongLength, deliveryOptions(f))).code, "artifact-byte-length-mismatch");
    const wrongDigest = structuredClone(f.request); wrongDigest.generationResult.object.artifact.audioDigest = `sha256:${"d".repeat(64)}`;
    wrongDigest.generationResult.id = semanticId({ actor: wrongDigest.generationResult.actor, type: wrongDigest.generationResult.type, inReplyTo: wrongDigest.generationResult.inReplyTo, object: wrongDigest.generationResult.object });
    await f.recordWitness(wrongDigest.generationResult);
    assert.equal((await deliverGeminiNotebookAudio(wrongDigest, deliveryOptions(f))).code, "artifact-digest-mismatch");
    writeFileSync(f.request.generationResult.object.artifact.path, "not an mp3");
    const nonMp3 = structuredClone(f.request); delete nonMp3.generationResult.object.artifact.byteLength; delete nonMp3.generationResult.object.artifact.audioDigest;
    assert.equal((await deliverGeminiNotebookAudio(nonMp3, deliveryOptions(f))).code, "artifact-is-not-supported-audio");
  } finally { f.cleanup(); }
});

test("refuses a symlinked artifact and a symlinked ancestor even when both resolve inside the provider", async () => {
  const f = await fixture();
  try {
    const directLink = join(f.root, "artifacts", "linked.mp3");
    symlinkSync(f.request.generationResult.object.artifact.path, directLink);
    const direct = structuredClone(f.request); direct.generationResult.object.artifact.path = directLink;
    direct.generationResult.id = semanticId({ actor: direct.generationResult.actor, type: direct.generationResult.type, inReplyTo: direct.generationResult.inReplyTo, object: direct.generationResult.object });
    await f.recordWitness(direct.generationResult);
    assert.equal((await deliverGeminiNotebookAudio(direct, deliveryOptions(f))).code, "artifact-path-absent-or-outside-provider");
    const realDirectory = join(f.root, "real-audio"); mkdirSync(realDirectory); const realAudio = join(realDirectory, "briefing.mp3");
    writeFileSync(realAudio, f.bytes); const linkedDirectory = join(f.root, "linked-audio"); symlinkSync(realDirectory, linkedDirectory);
    const ancestor = structuredClone(f.request); ancestor.generationResult.object.artifact.path = join(linkedDirectory, "briefing.mp3");
    ancestor.generationResult.id = semanticId({ actor: ancestor.generationResult.actor, type: ancestor.generationResult.type, inReplyTo: ancestor.generationResult.inReplyTo, object: ancestor.generationResult.object });
    await f.recordWitness(ancestor.generationResult);
    assert.equal((await deliverGeminiNotebookAudio(ancestor, deliveryOptions(f))).code, "artifact-path-absent-or-outside-provider");
  } finally { f.cleanup(); }
});

test("all refusal paths preserve zero external and cross-settlement effects", async () => {
  const result = await deliverGeminiNotebookAudio({ type: "wrong" });
  assert.deepEqual(result, {
    type: "GeminiNotebookAudioDeliveryRefusal",
    code: "invalid-request-type",
    externalNetwork: false,
    externalSpend: 0,
    customerMutation: false,
    foreignMutation: false,
  });
});
