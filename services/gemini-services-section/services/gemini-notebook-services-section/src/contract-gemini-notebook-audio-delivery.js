#!/usr/bin/env node

import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
import { queryProviderCategory } from "./provider-evidence.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { isNiUri, niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";

export const PROVIDER = "urn:ame:notebooklm-inference-team";
export const RESULT_TYPE = "GeminiNotebookAudioArtifact";
export const RECEIPT_TYPE = "GeminiNotebookSourceReconciliationReceipt";
const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function omitUndefinedObjectProperties(value) {
  if (Array.isArray(value)) return value.map(omitUndefinedObjectProperties);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined).map((key) => [key, omitUndefinedObjectProperties(value[key])]));
}





/** The file-name stem of a content id: the digest an ni URI names, or the hex tail of the
 *  `urn:sha256:` ids that stored records minted before the content address carry. */
export function contentIdStem(id) {
  return isNiUri(id) ? niUriDigest(id) : id.slice(-64);
}

/** True when `id` names `body`'s content: its semantic content address, or the `urn:sha256:` JSON
 *  digest that stored records minted before the address carry. */
export function contentIdMatches(id, body) {
  return id === semanticId(body) || id === `urn:${sha256Digest(canonicalJson(omitUndefinedObjectProperties(body)))}`;
}


async function jobRecords(dataRoot, category, options = {}) { return (await queryProviderCategory(category, { predicate: "urn:emsenn:gemini-notebook:category", witnessJournalAgentUrl: options.witnessJournalAgentUrl })).map(({ value }) => value).filter((value) => value?.type === "GeminiNotebookJobRecord" && value.category === category).map(({ row }) => row); }

function receiptValid(record) {
  if (!record || record.type !== RECEIPT_TYPE || record.provider !== PROVIDER || record.outcome !== "reconciled") return false;
  const { id, ...body } = record;
  return contentIdMatches(id, body) && Array.isArray(record.finalSourceIds) && record.finalSourceIds.length > 0
    && record.finalSourceIds.every((item) => typeof item === "string" && item.length > 0)
    && new Set(record.finalSourceIds).size === record.finalSourceIds.length;
}

export async function resolveSourceReceipt(dataRoot, receiptId, options = {}) {
  if (!/^(?:urn:sha256:[a-f0-9]{64}|ni:\/\/\/sha-256;[A-Za-z0-9_-]{43})$/u.test(receiptId ?? "")) return null;
  return (await jobRecords(dataRoot, "receipts", options)).find((record) => record.id === receiptId && receiptValid(record)) ?? null;
}

function responseIdentityValid(record) {
  return record?.id !== undefined && contentIdMatches(record.id, { actor: record.actor, type: record.type, inReplyTo: record.inReplyTo, object: record.object });
}

async function generationWitnessValid(dataRoot, invocation, result, options = {}) {
  return (await jobRecords(dataRoot, "events", options)).some((event) => event.source === PROVIDER
    && event.type === "org.emsenn.notebooklm-inference-team.contract.completed"
    && event.subject === invocation.id
    && event.data?.activityDigest === semanticId(invocation)
    && event.data?.result === result.id);
}

function packetBoundGenerationRequest(packet, request) {
  if (packet?.type !== "HarmoniousUnionArtifactSourcePacket" || !Array.isArray(packet.documents) || packet.documents.length === 0) return false;
  if (!packet.documents.every((document) => typeof document?.name === "string" && typeof document?.content === "string"
    && document.digest === sha256Digest(Buffer.from(document.content)))) return false;
  const documents = packet.documents.map((document) => ({ title: document.name, digest: sha256Digest(Buffer.from(document.content)) }));
  const sources = request?.sources?.map((source) => ({ title: source?.title, digest: source?.digest }));
  return request?.artifactType === "audio" && request?.corpusMode === "reconciled-notebook"
    && semanticId(sources) === semanticId(documents);
}

function confinedArtifact(providerRoot, value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || /^https?:/iu.test(value)) return null;
  let root;
  try {
    const statedRoot = resolve(providerRoot);
    if (lstatSync(statedRoot).isSymbolicLink() || !lstatSync(statedRoot).isDirectory()) return null;
    root = realpathSync(statedRoot);
  } catch { return null; }
  const statedPath = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const statedRelative = relative(root, statedPath);
  if (statedRelative === "" || statedRelative === ".." || statedRelative.startsWith(`..${sep}`) || isAbsolute(statedRelative)) return null;
  let component = root;
  try {
    for (const segment of statedRelative.split(sep)) {
      if (segment === "" || segment === "." || segment === "..") return null;
      component = resolve(component, segment);
      const evidence = lstatSync(component);
      if (evidence.isSymbolicLink()) return null;
    }
  } catch { return null; }
  let path;
  try { path = realpathSync(statedPath); } catch { return null; }
  const rel = relative(root, path);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  try { if (!existsSync(path) || !lstatSync(path).isFile()) return null; } catch { return null; }
  return path;
}

function refusal(code) {
  return { type: "GeminiNotebookAudioDeliveryRefusal", code, externalNetwork: false, externalSpend: 0, customerMutation: false, foreignMutation: false };
}

function mp3Signature(bytes) {
  return bytes.length >= 3 && (bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
}

function audioMediaType(bytes) {
  if (mp3Signature(bytes)) return "audio/mpeg";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") return "audio/mp4";
  return null;
}

export async function deliverGeminiNotebookAudio(request, options = {}) {
  if (request?.type !== "GeminiNotebookAudioDeliveryRequest") return refusal("invalid-request-type");
  if (!isNiUri(request.sourcePacketDigest ?? "")) return refusal("invalid-source-packet-digest");
  if (!request.sourcePacket || typeof request.sourcePacket !== "object") return refusal("source-packet-absent-or-invalid");
  if (semanticId(request.sourcePacket) !== request.sourcePacketDigest) return refusal("source-packet-digest-mismatch");
  const dataRoot = options.dataRoot ?? resolve(MODULE_ROOT, "data");
  const receipt = await resolveSourceReceipt(dataRoot, request.notebookSourceReceiptId, options);
  if (!receipt) return refusal("provider-local-source-reconciliation-receipt-absent-or-invalid");
  const offer = request.generationOffer;
  const invocation = request.generationInvocation;
  const envelope = request.generationResult;
  const generation = envelope?.object;
  const generationRequest = offer?.object?.request;
  if (offer?.type !== "Offer" || offer.actor !== PROVIDER || offer.object?.type !== "ExecutableServiceOffer"
    || !generationRequest || typeof generationRequest !== "object"
    || offer.object.requestDigest !== semanticId(generationRequest)
    || generationRequest?.notebookSourceReceiptId !== request.notebookSourceReceiptId
    || !packetBoundGenerationRequest(request.sourcePacket, generationRequest)
    || invocation?.type !== "Accept" || invocation.target !== PROVIDER || !invocation.object?.offer
    || semanticId(invocation.object.offer) !== semanticId(offer)
    || envelope?.type !== "Accept" || envelope.actor !== PROVIDER || envelope.inReplyTo !== invocation.id
    || !responseIdentityValid(envelope) || generation?.type !== "GeminiNotebookServiceResult"
    || generation.requestDigest !== offer.object.requestDigest
    || generation.notebookSourceReceiptId !== request.notebookSourceReceiptId
    || !await generationWitnessValid(dataRoot, invocation, envelope, options)) return refusal("generation-bindings-mismatch");
  const artifact = generation.artifact ?? generation.providerExchange?.artifact;
  if (artifact?.type !== "audio") return refusal("artifact-type-mismatch");
  const path = confinedArtifact(options.providerRoot ?? MODULE_ROOT, artifact.path);
  if (!path) return refusal("artifact-path-absent-or-outside-provider");
  let bytes;
  try { bytes = (options.readFile ?? readFileSync)(path); } catch { return refusal("artifact-bytes-unreadable"); }
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const mediaType = audioMediaType(bytes);
  if (!mediaType) return refusal("artifact-is-not-supported-audio");
  if (artifact.mediaType !== undefined && artifact.mediaType !== mediaType) return refusal("artifact-media-type-mismatch");
  if (artifact.byteLength !== undefined && artifact.byteLength !== bytes.length) return refusal("artifact-byte-length-mismatch");
  const audioDigest = sha256Digest(bytes);
  if (artifact.audioDigest !== undefined && artifact.audioDigest !== audioDigest) return refusal("artifact-digest-mismatch");
  return {
    type: RESULT_TYPE,
    audioBase64: bytes.toString("base64"),
    mediaType,
    byteLength: bytes.length,
    audioDigest,
    sourcePacketDigest: request.sourcePacketDigest,
    notebookSourceReceiptId: request.notebookSourceReceiptId,
  };
}

function dryRun() {
  return {
    type: "GeminiNotebookAudioDeliveryDryRun",
    ready: true,
    resultType: RESULT_TYPE,
    requiredBindings: ["sourcePacketDigest", "notebookSourceReceiptId"],
    networkCalls: 0,
    externalSpend: 0,
    customerMutation: false,
    foreignMutation: false,
    installation: false,
    publication: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--dry-run")) process.stdout.write(`${JSON.stringify(dryRun())}\n`);
  else {
    try {
      const request = JSON.parse(readFileSync(0, "utf8"));
      const result = await deliverGeminiNotebookAudio(request, { providerRoot: process.cwd(), dataRoot: resolve(process.cwd(), "data") });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.type.endsWith("Refusal")) process.exitCode = 2;
    } catch (error) {
      process.stdout.write(`${JSON.stringify(refusal(`invalid-json:${error.message}`))}\n`); process.exitCode = 2;
    }
  }
}
