#!/usr/bin/env node

import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { queryWitnessJournalDocumentsByCategory, recordWitnessJournalBatch, relationalWitnessJournalDocument } from "@red-cup-engineering/witness-journal-document-service";
import { identifyAscribed } from "../../src/semantic-content.mjs";

import { admitEnterpriseInstall, inspectMeshScope, revalidateEnterpriseInstall } from "@red-cup-engineering/agent-harness-computer-system-engineering-services-section/mesh-scope";
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { writeFileBytesSync } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKTREE_ROOT = ROOT;
const NODE_ID = "notebooklm-inference-team";
const ACTOR = `urn:ame:${NODE_ID}`;
const SETTLEMENT_ACCOUNT = "eip155:31337:0xf1c133d8f725af2f4ad00176ff810e32d1d2f6cd";
const PRODUCT = "urn:sha256:bb66553f289665b8a37dc3d77280f8f6ff9123b99d6fc73c9d4f173000ca25b5";
const DECISION = "urn:sha256:2010e7f62327a45b92638a09cc5624002721e002e22d755e6d1dec64a544bddf";
const RECEIPT = "urn:sha256:f141824766f248fd6452b238aae969ec6de0680fd39fb8daa1c983117a7c4a84";
const DIRECTION = "urn:sha256:1ac3cc9f1cffee6ffe399821ecb831208a73f2393ce336b8632ecfdba87ba77d";
const SOURCE_ROOT = "services/notebooklm-inference-team";

function assert(value, message) { if (!value) throw new Error(message); }
function digest(value) { return sha256Digest(canonical(value)); }
function contentId(body) { return `urn:${digest(body)}`; }
function contentRecord(body) { return { id: contentId(body), ...body }; }
function withoutId(value) { const { id: _id, ...body } = value; return body; }
function assertContent(value, label) { assert(value?.id === contentId(withoutId(value)), `${label} content identity mismatch`); }
function assertReply(value, label) { assert(value?.id === `urn:${digest({ type: value.type, source: value.inReplyTo ?? null, object: value.object })}`, `${label} reply identity mismatch`); }
function arg(name) { return argument(name) ?? null; }
function now() { return arg("--now") ?? new Date().toISOString(); }
function exactDirectory(path, label) {
  const lexical = resolve(path);
  assert(realpathSync(lexical) === lexical && !lstatSync(lexical).isSymbolicLink() && statSync(lexical).isDirectory(), `${label} is not an exact directory`);
  return lexical;
}
function safeSuffix(path) { return typeof path === "string" && path.length > 0 && !path.includes("\0") && !path.includes("\\") && !path.includes("//") && !path.startsWith("/") && path.split("/").every((part) => part && part !== "." && part !== ".." && part !== ".git"); }
function allVisible(value) {
  return [value, value?.record, value?.row, value?.delivery, value?.decision, value?.receipt].filter(Boolean);
}
async function findExact(root, id) {
  const matches = (await queryWitnessJournalDocumentsByCategory(exactDirectory(root, "ingress WitnessJournal root")))
    .flatMap(({ value }) => allVisible(value))
    .flatMap(allVisible)
    .filter((item) => item.id === id);
  assert(matches.length === 1, `${id} must resolve exactly once from supplied WitnessJournal ingress`);
  return matches[0];
}
async function records(category) {
  return (await queryWitnessJournalDocumentsByCategory(join(ROOT, "data")))
    .map(({ value }) => value)
    .filter((value) => value?.type === "NotebookLMJobRecord" && value.category === category)
    .map(({ row }) => row);
}
async function record(category, value) {
  assertContent(value, `${category} record`);
  const envelope = { type: "NotebookLMJobRecord", category, row: value };
  const document = relationalWitnessJournalDocument(envelope);
  const graph = identifyAscribed("notebooklm.witness-journal-audio-egress", document).token;
  const agentUrl = process.env.WITNESS_JOURNAL_RDF_AGENT;
  assert(agentUrl, "WITNESS_JOURNAL_RDF_AGENT must name the contracted witness-journal RDF provider");
  await recordWitnessJournalBatch({ agentUrl, batch: {
    settlement: SETTLEMENT_ACCOUNT, graph, recordedAt: value.recordedAt, document,
    assertions: [{ subject: ACTOR, predicate: "urn:emsenn:notebooklm:recorded", object: { kind: "iri", value: graph } }],
  } });
  return value;
}
function walk(root) {
  const output = [];
  function descend(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = join(path, entry.name);
      assert(!entry.isSymbolicLink(), `symlink refused: ${child}`);
      if (entry.isDirectory()) descend(child);
      else {
        assert(entry.isFile(), `special file refused: ${child}`);
        const bytes = readFileSync(child);
        output.push({ path: relative(root, child).split(sep).join("/"), digest: digest(bytes.toString("base64")), byteLength: bytes.length });
      }
    }
  }
  descend(root);
  return output;
}
function resourceReceipt() { return { externalNetwork: false, externalSpend: 0, credentials: false, customerMutation: false, foreignMutation: false, inferenceTokens: { state: "unknown-not-zero" }, coordination: { state: "unknown-not-zero" } }; }

async function main() {
  const recordedAt = now();
  assert(arg("--leader-direction") === DIRECTION, "exact Leader omnibus direction is required");
  const product = findExact(arg("--delivery-witness-journal-root"), PRODUCT);
  const decision = findExact(arg("--decision-witness-journal-root"), DECISION);
  const receipt = findExact(arg("--decision-witness-journal-root"), RECEIPT);
  assertReply(product, "accepted audio product"); assertReply(receipt, "decision receipt");
  assert(product.type === "Accept" && product.actor === "urn:ame:software-development-services-section" && product.object?.type === "ProposedSoftwareDevelopmentProduct" && product.object?.targetSettlement === "urn:ame:software-development-services-section", "product contract mismatch");
  assert(decision.id === DECISION && decision.type === "Accept" && decision.actor === "urn:ame:leader-movement-team"
    && decision.object?.usefulness === "accepted-after-recorded-checks-and-independent-replay"
    && decision.object?.proposedProduct?.id === PRODUCT, "accepting decision chain mismatch");
  assert(receipt.type === "Accept" && receipt.inReplyTo === DECISION && receipt.object?.proposedProduct === PRODUCT && receipt.object?.decision === "Accept", "decision receipt chain mismatch");
  assert(Array.isArray(product.object.artifacts) && product.object.artifacts.length === 6, "exact six-artifact audio product is required");
  const artifacts = product.object.artifacts;
  const key = digest({ product: PRODUCT, decision: DECISION, direction: DIRECTION }).slice(7);
  const operationRoot = resolve(ROOT, "data", "audio-egress-product-admission", key);
  const stagedRoot = join(operationRoot, "staged");
  const prior = records("audio-egress-admission-receipts").find((item) => item.type === "NotebookLMAudioEgressProductAdmissionReceipt" && item.product === PRODUCT);
  if (prior) { process.stdout.write(`${JSON.stringify({ ...prior, replay: true }, null, 2)}\n`); return; }
  const priorPrepared = records("audio-egress-admission-transitions").find((item) => item.type === "NotebookLMAudioEgressProductAdmissionPrepared" && item.product === PRODUCT);
  if (!existsSync(operationRoot)) mkdirSync(stagedRoot, { recursive: true, mode: 0o700 });
  else assert(priorPrepared && existsSync(stagedRoot), "incomplete audio admission operation state");
  const expected = [];
  for (const artifact of artifacts) {
    assert(artifact.targetPath.startsWith(`${SOURCE_ROOT}/`), "artifact source target-root binding mismatch");
    const suffix = artifact.targetPath.slice(SOURCE_ROOT.length + 1);
    assert(safeSuffix(suffix), "unsafe audio artifact suffix");
    const bytes = Buffer.from(artifact.bytesBase64, "base64");
    assert(bytes.toString("base64") === artifact.bytesBase64 && bytes.length === artifact.byteLength && digest(artifact.bytesBase64) === artifact.digest, `artifact bytes mismatch: ${suffix}`);
    const staged = resolve(stagedRoot, suffix);
    assert(staged.startsWith(`${stagedRoot}${sep}`), "staging escape");
    if (!existsSync(staged)) {
      mkdirSync(dirname(staged), { recursive: true, mode: 0o700 });
      writeFileSync(staged, bytes, { flag: "wx", mode: 0o600 });
    }
    expected.push({ path: suffix, digest: artifact.digest, byteLength: artifact.byteLength });
  }
  expected.sort((left, right) => left.path.localeCompare(right.path));
  assert(digest(walk(stagedRoot)) === digest(expected), "staged audio product tree mismatch");
  const displaced = expected.filter((item) => existsSync(resolve(ROOT, item.path))).map((item) => {
    const bytes = readFileSync(resolve(ROOT, item.path));
    return { path: item.path, digest: digest(bytes.toString("base64")), byteLength: bytes.length, bytesBase64: bytes.toString("base64") };
  });
  const prepared = priorPrepared ?? contentRecord({ type: "NotebookLMAudioEgressProductAdmissionPrepared", recordedAt, actor: ACTOR, leaderDirection: DIRECTION,
    product: PRODUCT, customerDecision: DECISION, customerDecisionReceipt: RECEIPT, sourceTargetRoot: SOURCE_ROOT, localTargetRoot: ".",
    stagedTreeDigest: digest(expected), displaced, overwriteConfinedToAcceptedArtifacts: true, resourceReceipt: resourceReceipt() });
  if (!priorPrepared) await record("audio-egress-admission-transitions", prepared);

  const worktree = exactDirectory(WORKTREE_ROOT, "mesh worktree root");
  const providerRoot = exactDirectory(ROOT, "NotebookLM provider root");
  const sourceScope = inspectMeshScope({ authorityRoot: worktree, subject: stagedRoot });
  const targetScope = inspectMeshScope({ authorityRoot: worktree, subject: providerRoot });
  assert(sourceScope.inside && !sourceScope.boundaries.length && targetScope.inside && !targetScope.boundaries.length, "audio admission escaped the operated mesh");
  const admission = admitEnterpriseInstall({ authorityRoot: worktree, sourceEnterprise: stagedRoot, targetNode: providerRoot, installer: "codex", operation: "install", mode: "apply" });
  revalidateEnterpriseInstall(admission);
  for (const item of expected) {
    const source = resolve(stagedRoot, item.path);
    const target = resolve(ROOT, item.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileBytesSync(target, readFileSync(source), { mode: 0o600 });
  }
  for (const item of expected) {
    const bytes = readFileSync(resolve(ROOT, item.path));
    assert(bytes.length === item.byteLength && digest(bytes.toString("base64")) === item.digest, `admitted audio artifact drift: ${item.path}`);
  }
  const receiptRecord = contentRecord({ type: "NotebookLMAudioEgressProductAdmissionReceipt", recordedAt, actor: ACTOR, leaderDirection: DIRECTION,
    preparedTransition: prepared.id, product: PRODUCT, customerDecision: DECISION, customerDecisionReceipt: RECEIPT,
    admittedTreeDigest: digest(expected), admittedArtifacts: expected, displacedCarrierDigest: digest(displaced.map(({ bytesBase64: _bytes, ...item }) => item)),
    meshAdmissionRequestSha256: `sha256:${admission.requestSha256}`, meshAdmissionSnapshotDigest: digest(admission.snapshot),
    providerLocal: true, externalNetwork: false, externalSpend: 0, credentialDisclosure: false });
  await record("audio-egress-admission-receipts", receiptRecord);
  process.stdout.write(`${JSON.stringify(receiptRecord, null, 2)}\n`);
}

main().catch(async (error) => {
  const refusal = contentRecord({ type: "NotebookLMAudioEgressProductAdmissionRefusal", recordedAt: now(), actor: ACTOR, leaderDirection: DIRECTION,
    product: PRODUCT, code: "notebooklm-local-admission-refused", detail: error.message, externalNetwork: false, externalSpend: 0, credentialDisclosure: false });
  try { await record("audio-egress-admission-refusals", refusal); } catch {}
  process.stdout.write(`${JSON.stringify(refusal, null, 2)}\n`); process.exitCode = 2;
});
