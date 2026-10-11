#!/usr/bin/env node

import { runGeminiNotebookSync } from "./gemini-notebook-cli.mjs";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deliverGeminiNotebookAudio, PROVIDER, resolveSourceReceipt, contentIdStem } from "./contract-gemini-notebook-audio-delivery.js";
import { chainWitnessEnabled, createChainWitnessWriter, queryChainWitnesses } from "./chain-witness.mjs";
import { identifyRelationalValue } from "./semantic-content.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { notebookVideoPayload } from "./notebook-video-carrier.mjs";
import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

const NODE_ID = "notebooklm-inference-team";
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LMT = "urn:ame:leader-movement-team";
const AUDIO_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const VIDEO_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const SETTLEMENT_ACCOUNT = "eip155:31337:0xf1c133d8f725af2f4ad00176ff810e32d1d2f6cd";

async function records(dataRoot, category, operationId, options = {}) {
  const source = chainWitnessEnabled()
    ? await queryChainWitnesses({ rpcUrl: process.env.EVM_RPC_URL, keystorePath: process.env.EVM_KEYSTORE_PATH, passwordPath: process.env.EVM_KEYSTORE_PASSWORD_PATH, contractAddress: process.env.ONCHAIN_RESOURCE_CONTRACT, actor: PROVIDER, category })
    : await (await import("@red-cup-engineering/witness-journal-document-service")).queryWitnessJournalDocumentsByCategory(category, {
      agentUrl: options.witnessJournalAgentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT,
      predicate: "urn:emsenn:gemini-notebook:category",
    });
  const found = source.map(({ value }) => value)
    .filter((value) => value?.type === "GeminiNotebookJobRecord" && value.category === category && value.row?.operationId === operationId)
    .map(({ row }) => row);
  found.sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0) || Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  return found;
}

function senValue(value) {
  if (Array.isArray(value)) return value.map((item) => { if (item === undefined) throw new TypeError("SEN sequence members cannot be absent"); return senValue(item); });
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, senValue(item)]));
  return value;
}

async function append(dataRoot, category, state, instant, options = {}) {
  const previous = (await records(dataRoot, category, state.operationId, options)).at(-1);
  // Source receipts are themselves content-addressed evidence.
  // Journal sequencing metadata would change their body while retaining an
  // old identifier, making the provider unable to validate its own receipt.
  const exactReceipt = category === "receipts";
  const body = senValue(exactReceipt ? state : { ...state, sequence: Number(previous?.sequence ?? 0) + 1, recordedAt: instant });
  // An exact receipt already carries its own caller-minted identity (which may
  // predate this scheme, or carry a value this scheme cannot admit); never
  // recompute it here.
  const row = exactReceipt ? body : { id: semanticId(body), ...body };
  const envelope = { type: "GeminiNotebookJobRecord", category, row };
  if (chainWitnessEnabled()) {
    const writer = await createChainWitnessWriter({ rpcUrl: process.env.EVM_RPC_URL, keystorePath: process.env.EVM_KEYSTORE_PATH, passwordPath: process.env.EVM_KEYSTORE_PASSWORD_PATH, contractAddress: process.env.ONCHAIN_RESOURCE_CONTRACT });
    await writer({ actor: PROVIDER, category, envelope: { ...envelope, graph: semanticId(envelope) }, recordedAt: instant });
    return row;
  }
  const { recordWitnessJournalBatch, relationalWitnessJournalDocument } = await import("@red-cup-engineering/witness-journal-document-service");
  const graph = identifyRelationalValue("gemini-notebook.witness-journal-job-record", relationalWitnessJournalDocument(envelope)).token;
  const agentUrl = options.witnessJournalAgentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT;
  if (!agentUrl) throw new Error("WITNESS_JOURNAL_RDF_AGENT must name the contracted witness-journal RDF provider");
  const recordBatch = options.recordWitnessJournalBatch ?? recordWitnessJournalBatch;
  await recordBatch({ agentUrl, batch: { settlement: SETTLEMENT_ACCOUNT, graph, recordedAt: instant, document: relationalWitnessJournalDocument(envelope), assertions: [
    { subject: PROVIDER, predicate: "urn:emsenn:gemini-notebook:recorded", object: { kind: "iri", value: graph } },
    { subject: graph, predicate: "urn:emsenn:gemini-notebook:category", object: { kind: "literal", value: category } },
  ] } });
  return row;
}

export async function recordProviderJobRecord(category, row, options = {}) {
  return append(dataRoot(options), category, row, instant(options), options);
}

function refusal(kind, operationId, code, details = {}) {
  return { type: `Gemini Notebook${kind}JobRefusal`, operationId, code, externalSpend: 0, ...details };
}

export function normalizeCliExecution(execution, json = undefined) {
  const timedOut = execution.error?.code === "ETIMEDOUT";
  return {
    status: timedOut ? 124 : execution.status,
    signal: execution.signal,
    timedOut,
    errorCode: execution.error?.code ?? null,
    json,
    stdout: execution.stdout,
    stderr: execution.stderr,
  };
}

function defaultCli(args) {
  const execution = runGeminiNotebookSync(args, { json: false, root: NODE_ROOT, maxBuffer: Number.POSITIVE_INFINITY });
  return normalizeCliExecution({ ...execution, error: execution.errorCode ? { code: execution.errorCode } : undefined }, execution.value);
}

function cli(options, args) {
  const result = (options.runCli ?? defaultCli)(args);
  if (result && (Object.hasOwn(result, "json") || Object.hasOwn(result, "status"))) return result;
  return { status: 0, json: result };
}

function sourceListCode() { return "source-list-failed"; }
function cliEvidence(observation) {
  return { status: observation.status ?? null, signal: observation.signal ?? null,
    errorCode: observation.errorCode ?? null };
}

function instant(options) { return options.now ?? new Date().toISOString(); }
function dataRoot(options) { return options.dataRoot ?? join(NODE_ROOT, "data"); }
function validOperationId(value) { return typeof value === "string" && /^(?:urn:sha256:[0-9a-f]{64}|ni:\/\/\/sha-256;[A-Za-z0-9_-]{43})$/u.test(value); }
function listRows(json) { return Array.isArray(json) ? json : (json?.sources ?? json?.data?.sources ?? []); }
function artifactRows(json) { return Array.isArray(json) ? json : (json?.artifacts ?? json?.data?.artifacts ?? []); }
function sourceId(value) { return value?.id ?? value?.source_id ?? value?.source?.id ?? value?.source?.source_id ?? null; }
function sourceStatus(value) { return String(value?.status ?? value?.processing_status ?? value?.source?.status ?? "").toLowerCase().replaceAll("-", "_"); }
function sourceReady(value) { return ["ready", "completed", "processed", "available"].includes(sourceStatus(value)); }
function sourceTitlesForIntent(job) {
  const desired = job.request.desiredSources[job.pendingSource.index];
  return new Set([job.pendingSource.title, desired?.title, desired?.path ? basename(desired.path) : null].filter(Boolean));
}
function validSource(source) {
  if (!source || typeof source.path !== "string" || !resolve(source.path) || typeof source.title !== "string" || source.title.trim() === "") return false;
  if (!/^sha256:[0-9a-f]{64}$/u.test(source.digest ?? "") || !existsSync(source.path)) return false;
  try { return lstatSync(source.path).isFile() && !lstatSync(source.path).isSymbolicLink() && sha256Digest(readFileSync(source.path)) === source.digest; } catch { return false; }
}

export async function latestSourceJob(operationId, options = {}) { return (await records(dataRoot(options), "source-jobs", operationId, options)).at(-1) ?? null; }
export async function latestAudioJob(operationId, options = {}) { return (await records(dataRoot(options), "audio-jobs", operationId, options)).at(-1) ?? null; }
export async function latestVideoJob(operationId, options = {}) { return (await records(dataRoot(options), "video-jobs", operationId, options)).at(-1) ?? null; }

async function latestRepair(repairOperationId, options = {}) { return (await records(dataRoot(options), "source-carrier-repairs", repairOperationId, options)).at(-1) ?? null; }

export async function startSourceCarrierRepair(request, options = {}) {
  const now = instant(options); const root = dataRoot(options);
  if (request?.type !== "GeminiNotebookSourceCarrierRepairRequest" || request.manual !== true || request.grounds !== "structured-file-sources-nonterminal-plain-text-works"
    || !validOperationId(request.originalOperationId) || !validOperationId(request.repairOperationId) || request.originalOperationId === request.repairOperationId
    || !Array.isArray(request.expectedCurrentSourceIds) || request.expectedCurrentSourceIds.some((id) => typeof id !== "string" || id.length === 0)
    || new Set(request.expectedCurrentSourceIds).size !== request.expectedCurrentSourceIds.length) return refusal("SourceCarrierRepair", request?.repairOperationId, "invalid-manual-repair-request");
  const prior = await latestRepair(request.repairOperationId, options); if (prior) return prior;
  const original = await latestSourceJob(request.originalOperationId, options);
  if (!original?.request?.desiredSources?.length) return refusal("SourceCarrierRepair", request.repairOperationId, "original-source-job-absent");
  const carrierRoot = join(root, "repair-carriers", contentIdStem(request.repairOperationId)); mkdirSync(carrierRoot, { recursive: true });
  const desiredSources = [];
  for (const [index, source] of original.request.desiredSources.entries()) {
    if (!validSource(source)) return refusal("SourceCarrierRepair", request.repairOperationId, "original-source-bytes-invalid");
    const bytes = readFileSync(source.path); const stem = basename(source.title, extname(source.title)).replaceAll(/[^A-Za-z0-9._-]/gu, "-") || `source-${index + 1}`;
    const path = join(carrierRoot, `${String(index + 1).padStart(2, "0")}-${stem}.txt`);
    if (existsSync(path)) { if (sha256Digest(readFileSync(path)) !== sha256Digest(bytes)) return refusal("SourceCarrierRepair", request.repairOperationId, "existing-repair-carrier-byte-mismatch"); }
    else writeFileSync(path, bytes, { flag: "wx" });
    desiredSources.push({ path, title: `${stem}.txt`, digest: sha256Digest(bytes), originalPath: source.path, originalDigest: source.digest });
  }
  await append(root, "source-carrier-repairs", { type: "GeminiNotebookSourceCarrierRepairState", operationId: request.repairOperationId, originalOperationId: request.originalOperationId, status: "carriers-created", grounds: request.grounds, expectedCurrentSourceIds: [...request.expectedCurrentSourceIds].sort(), desiredSources }, now, options);
  const sourceJob = await submitSourceJob({ type: "GeminiNotebookAsyncSourceJobRequest", operationId: request.repairOperationId, notebookId: original.request.notebookId, expectedCurrentSourceIds: [...request.expectedCurrentSourceIds], desiredSources: desiredSources.map(({ path, title, digest: sourceDigest }) => ({ path, title, digest: sourceDigest })) }, options);
  if (sourceJob.status === "refused") return append(root, "source-carrier-repairs", { type: "GeminiNotebookSourceCarrierRepairState", operationId: request.repairOperationId, originalOperationId: request.originalOperationId, status: "refused", code: sourceJob.code, sourceJob }, now, options);
  const receiptBody = { type: "GeminiNotebookSourceCarrierRepairReceipt", provider: PROVIDER, status: "started", manual: true, grounds: request.grounds, originalOperationId: request.originalOperationId, repairOperationId: request.repairOperationId, notebookId: original.request.notebookId, expectedCurrentSourceIds: [...request.expectedCurrentSourceIds].sort(), carriers: desiredSources.map(({ path, title, digest: carrierDigest, originalDigest }) => ({ path, title, digest: carrierDigest, originalDigest })), recordedAt: now };
  const receipt = { id: semanticId(receiptBody), ...receiptBody };
  return append(root, "source-carrier-repairs", { type: "GeminiNotebookSourceCarrierRepairState", operationId: request.repairOperationId, originalOperationId: request.originalOperationId, status: "started", receipt, sourceJob }, now, options);
}

export async function submitSourceJob(request, options = {}) {
  const now = instant(options); const root = dataRoot(options);
  if (request?.type !== "GeminiNotebookAsyncSourceJobRequest" || !validOperationId(request.operationId)) return refusal("Source", request?.operationId, "invalid-request");
  const existing = await latestSourceJob(request.operationId, options);
  if (existing) return existing;
  if (typeof request.notebookId !== "string" || !Array.isArray(request.desiredSources) || request.desiredSources.length === 0 || !request.desiredSources.every(validSource)) return refusal("Source", request.operationId, "invalid-source-manifest");
  const requestDigest = semanticId(request);
  await append(root, "source-jobs", { type: "GeminiNotebookSourceJobState", operationId: request.operationId, requestDigest, request, status: "source-observing" }, now, options);
  const observation = cli(options, ["source", "list", "--notebook", request.notebookId, "--json"]);
  if (observation.status !== 0 || !Array.isArray(listRows(observation.json))) return append(root, "source-jobs", {
    type: "GeminiNotebookSourceJobState", operationId: request.operationId, requestDigest, request,
    status: "refused", code: sourceListCode(observation), providerObservation: cliEvidence(observation),
  }, now, options);
  const current = listRows(observation.json).map((row) => ({ id: sourceId(row), title: row.title ?? row.name ?? null, status: sourceStatus(row) })).filter((row) => row.id);
  const currentIds = current.map((row) => row.id).sort();
  if (Array.isArray(request.expectedCurrentSourceIds) && semanticId(currentIds) !== semanticId([...request.expectedCurrentSourceIds].sort())) return append(root, "source-jobs", { type: "GeminiNotebookSourceJobState", operationId: request.operationId, requestDigest, request, status: "refused", code: "source-precondition-mismatch", observedSourceIds: currentIds }, now, options);
  return append(root, "source-jobs", { type: "GeminiNotebookSourceJobState", operationId: request.operationId, requestDigest, request, status: "source-uploading", observedSourceIds: currentIds, stagedSources: [], nextSourceIndex: 0 }, now, options);
}

async function resumeSourceUpload(job, options, now, root) {
  const request = job.request; const index = job.nextSourceIndex; const desired = request.desiredSources[index];
  if (!desired) return append(root, "source-jobs", { ...job, id: undefined, status: "source-processing" }, now, options);
  const deterministicTitle = `${desired.title} [${request.operationId.slice(-12)}:${desired.digest.slice(-12)}]`;
  const intent = await append(root, "source-jobs", { ...job, id: undefined, status: "source-upload-intent", pendingSource: { index, digest: desired.digest, title: deterministicTitle }, nextSourceIndex: index }, now, options);
  const result = cli(options, ["source", "add", desired.path, "--type", "file", "--title", deterministicTitle, "--notebook", request.notebookId, "--json"]);
  const id = sourceId(result.json);
  if (result.status !== 0 || !id) return append(root, "source-jobs", { ...intent, id: undefined, status: "refused", code: "source-add-failed-or-ambiguous" }, now, options);
  const stagedSources = [...job.stagedSources, { id, digest: desired.digest, title: deterministicTitle, path: desired.path }];
  return append(root, "source-jobs", { ...job, id: undefined, status: index + 1 < request.desiredSources.length ? "source-uploading" : "source-processing", stagedSources, nextSourceIndex: index + 1, pendingSource: null }, now, options);
}

async function resumeSourceIntent(job, options, now, root) {
  const observation = cli(options, ["source", "list", "--notebook", job.request.notebookId, "--json"]);
  if (observation.status !== 0) return append(root, "source-jobs", { ...job, id: undefined,
    status: "source-upload-intent", code: sourceListCode(observation), providerObservation: cliEvidence(observation) }, now, options);
  const titles = sourceTitlesForIntent(job);
  const match = listRows(observation.json).find((row) => titles.has(row.title ?? row.name));
  if (!match || !sourceId(match)) return append(root, "source-jobs", { ...job, id: undefined, status: "refused", code: "ambiguous-source-upload-not-observed-no-resubmit" }, now, options);
  const stagedSources = [...job.stagedSources, { id: sourceId(match), digest: job.pendingSource.digest, title: job.pendingSource.title, path: job.request.desiredSources[job.pendingSource.index].path }];
  const next = job.pendingSource.index + 1;
  return append(root, "source-jobs", { ...job, id: undefined, status: next < job.request.desiredSources.length ? "source-uploading" : "source-processing", stagedSources, nextSourceIndex: next, pendingSource: null }, now, options);
}

async function recoverCommittedSourceAdd(job, options, now, root) {
  const observation = cli(options, ["source", "list", "--notebook", job.request.notebookId, "--json"]);
  if (observation.status !== 0) return append(root, "source-jobs", { ...job, id: undefined, status: "refused",
    code: "source-add-failed-or-ambiguous", recoveryObservation: sourceListCode(observation),
    providerObservation: cliEvidence(observation) }, now, options);
  const originalTitle = job.request.desiredSources[job.pendingSource.index]?.title;
  const titles = sourceTitlesForIntent(job);
  const alreadyKnown = new Set([...(job.observedSourceIds ?? []), ...(job.stagedSources ?? []).map((source) => source.id)]);
  const matches = listRows(observation.json).filter((row) => {
    const id = sourceId(row); const title = row.title ?? row.name;
    return id && !alreadyKnown.has(id) && titles.has(title);
  });
  if (matches.length !== 1) return append(root, "source-jobs", { ...job, id: undefined, status: "refused", code: "source-add-failed-or-ambiguous", recoveryObservation: matches.length === 0 ? "no-unique-new-source" : "multiple-new-sources", recoveryCandidateIds: matches.map(sourceId).sort() }, now, options);
  const recovered = matches[0]; const next = job.pendingSource.index + 1;
  const stagedSources = [...job.stagedSources, { id: sourceId(recovered), digest: job.pendingSource.digest, title: recovered.title ?? recovered.name ?? originalTitle, path: job.request.desiredSources[job.pendingSource.index].path }];
  return append(root, "source-jobs", { ...job, id: undefined, status: next < job.request.desiredSources.length ? "source-uploading" : "source-processing", code: undefined, stagedSources, nextSourceIndex: next, pendingSource: null, recoveredPostCommitSourceId: sourceId(recovered) }, now, options);
}

export async function resumeSourceJob(operationId, options = {}) {
  const now = instant(options); const root = dataRoot(options); const job = await latestSourceJob(operationId, options);
  if (!job) return refusal("Source", operationId, "job-not-found");
  if (job.status === "completed") return job;
  if (job.status === "refused" && job.code === "source-add-failed-or-ambiguous" && job.pendingSource) return recoverCommittedSourceAdd(job, options, now, root);
  // A previous observation may have missed a provider-normalized carrier title.
  // Re-observe only; resumeSourceIntent never issues an add.
  if (job.status === "refused" && job.code === "ambiguous-source-upload-not-observed-no-resubmit" && job.pendingSource) return resumeSourceIntent(job, options, now, root);
  if (job.status === "refused") return job;
  if (job.status === "source-uploading") return resumeSourceUpload(job, options, now, root);
  if (job.status === "source-upload-intent") return resumeSourceIntent(job, options, now, root);
  if (job.status === "source-processing") {
    const observation = cli(options, ["source", "list", "--notebook", job.request.notebookId, "--json"]);
    if (observation.status !== 0) return append(root, "source-jobs", { ...job, id: undefined,
      code: sourceListCode(observation), providerObservation: cliEvidence(observation) }, now, options);
    const rows = listRows(observation.json); const byId = new Map(rows.map((row) => [sourceId(row), row]));
    if (!job.stagedSources.every((source) => byId.has(source.id))) return append(root, "source-jobs", { ...job, id: undefined, status: "refused", code: "staged-source-disappeared" }, now, options);
    const terminalFailures = job.stagedSources.map((source) => ({ id: source.id, status: sourceStatus(byId.get(source.id)) })).filter((source) => ["error", "failed", "refused"].includes(source.status));
    if (terminalFailures.length > 0) return append(root, "source-jobs", { ...job, id: undefined, status: "refused", code: "source-processing-terminal-failure", terminalFailures }, now, options);
    if (!job.stagedSources.every((source) => sourceReady(byId.get(source.id)))) return append(root, "source-jobs", { ...job, id: undefined, status: "source-processing", observedStagedStatuses: job.stagedSources.map((source) => ({ id: source.id, status: sourceStatus(byId.get(source.id)) })) }, now, options);
    return append(root, "source-jobs", { ...job, id: undefined, status: "source-retiring", remainingRetiredSourceIds: job.observedSourceIds.filter((id) => !job.stagedSources.some((source) => source.id === id)), deletedSourceIds: [] }, now, options);
  }
  if (job.status === "source-retiring") {
    const [target, ...remaining] = job.remainingRetiredSourceIds;
    if (target) {
      // Re-observe before every destructive step. If a prior delete committed
      // but its WitnessJournal append failed, the exact desired set proves the outcome
      // and lets us recover without issuing the delete a second time.
      const observation = cli(options, ["source", "list", "--notebook", job.request.notebookId, "--json"]);
      if (observation.status !== 0) return append(root, "source-jobs", { ...job, id: undefined, status: "source-retiring",
        code: sourceListCode(observation), providerObservation: cliEvidence(observation) }, now, options);
      const observedIds = new Set(listRows(observation.json).map(sourceId).filter(Boolean));
      if (!observedIds.has(target)) {
        const requiredIds = [...job.stagedSources.map((source) => source.id), ...remaining];
        const permittedIds = new Set(requiredIds); const unexpectedIds = [...observedIds].filter((id) => !permittedIds.has(id));
        const missingRequiredIds = requiredIds.filter((id) => !observedIds.has(id));
        if (unexpectedIds.length || missingRequiredIds.length) return append(root, "source-jobs", { ...job, id: undefined, status: "refused",
          code: "source-retirement-target-absent-with-nonexact-observed-set", absentTargetSourceId: target, unexpectedIds, missingRequiredIds }, now, options);
        return append(root, "source-jobs", { ...job, id: undefined, status: "source-retiring", code: undefined,
          remainingRetiredSourceIds: remaining, deletedSourceIds: [...job.deletedSourceIds, target], recoveredPostCommitDeletedSourceId: target }, now, options);
      }
      const result = cli(options, ["source", "delete", target, "--notebook", job.request.notebookId, "--yes", "--json"]);
      if (result.status !== 0) return append(root, "source-jobs", { ...job, id: undefined, status: "refused", code: "source-delete-failed", failedSourceId: target }, now, options);
      return append(root, "source-jobs", { ...job, id: undefined, status: "source-retiring", remainingRetiredSourceIds: remaining, deletedSourceIds: [...job.deletedSourceIds, target] }, now, options);
    }
    const receiptBody = { type: "GeminiNotebookSourceReconciliationReceipt", provider: PROVIDER, notebookId: job.request.notebookId, outcome: "reconciled", previousSourceIds: job.observedSourceIds, stagedSources: job.stagedSources.map(({ id, digest, title }) => ({ id, digest, title })), deletedSourceIds: job.deletedSourceIds, finalSourceIds: job.stagedSources.map((source) => source.id), requestDigest: job.requestDigest, settledAt: now };
    const receipt = { id: semanticId(receiptBody), ...receiptBody };
    await append(root, "receipts", receipt, now, options);
    return append(root, "source-jobs", { ...job, id: undefined, status: "completed", receipt }, now, options);
  }
  return append(root, "source-jobs", { ...job, id: undefined, status: "refused", code: "unknown-source-job-state" }, now, options);
}

export async function cancelSourceJob(request, options = {}) {
  const now = instant(options); const root = dataRoot(options); const operationId = request?.operationId;
  if (request?.type !== "GeminiNotebookSourceJobCancellationRequest" || !validOperationId(operationId)
    || request.grounds !== "downstream-run-refused-before-source-retirement" || typeof request.expectedRequestDigest !== "string") {
    return refusal("SourceCancellation", operationId, "invalid-cancellation-request");
  }
  const job = await latestSourceJob(operationId, options);
  if (!job) return refusal("SourceCancellation", operationId, "job-not-found");
  if (job.requestDigest !== request.expectedRequestDigest) return refusal("SourceCancellation", operationId, "source-job-request-digest-mismatch");
  if (job.status === "cancelled") return job;
  if (job.pendingSource || job.status === "source-upload-intent") return refusal("SourceCancellation", operationId, "ambiguous-upload-intent-cannot-cancel");
  if (["source-retiring", "completed"].includes(job.status)) return refusal("SourceCancellation", operationId, "incumbent-retirement-already-started");
  if (!["source-uploading", "source-processing", "source-cancelling"].includes(job.status)) return refusal("SourceCancellation", operationId, "source-job-not-safely-cancellable", { sourceJobStatus: job.status });
  if (job.status !== "source-cancelling") return append(root, "source-jobs", {
    ...job, id: undefined, status: "source-cancelling", cancellationGrounds: request.grounds,
    remainingStagedSourceIds: (job.stagedSources ?? []).map((source) => source.id), deletedStagedSourceIds: [],
  }, now, options);
  const [target, ...remaining] = job.remainingStagedSourceIds ?? [];
  if (target) {
    const result = cli(options, ["source", "delete", target, "--notebook", job.request.notebookId, "--yes", "--json"]);
    if (result.status !== 0) return append(root, "source-jobs", { ...job, id: undefined, status: "source-cancelling", code: "staged-source-cancellation-delete-failed", failedStagedSourceId: target }, now, options);
    return append(root, "source-jobs", { ...job, id: undefined, status: "source-cancelling", code: undefined, failedStagedSourceId: undefined,
      remainingStagedSourceIds: remaining, deletedStagedSourceIds: [...(job.deletedStagedSourceIds ?? []), target] }, now, options);
  }
  const receiptBody = { type: "GeminiNotebookSourceCancellationReceipt", provider: PROVIDER, operationId, requestDigest: job.requestDigest,
    grounds: request.grounds, preservedIncumbentSourceIds: job.observedSourceIds ?? [], deletedStagedSourceIds: job.deletedStagedSourceIds ?? [], settledAt: now };
  const receipt = { id: semanticId(receiptBody), ...receiptBody }; await append(root, "receipts", receipt, now, options);
  return append(root, "source-jobs", { ...job, id: undefined, status: "cancelled", cancellationReceipt: receipt }, now, options);
}

function audioRequestValid(request) {
  return request?.type === "GeminiNotebookAsyncAudioJobRequest" && validOperationId(request.operationId)
    && typeof request.notebookId === "string" && typeof request.prompt === "string" && request.prompt.trim() !== ""
    && request.sourcePacket?.type === "HarmoniousUnionArtifactSourcePacket" && semanticId(request.sourcePacket) === request.sourcePacketDigest
    && typeof request.notebookSourceReceiptId === "string";
}

export async function submitAudioJob(request, options = {}) {
  const now = instant(options); const root = dataRoot(options);
  if (!audioRequestValid(request)) return refusal("Audio", request?.operationId, "invalid-request");
  const existing = await latestAudioJob(request.operationId, options); if (existing) return existing;
  const requestDigest = semanticId(request);
  await append(root, "audio-jobs", { type: "GeminiNotebookAudioJobState", operationId: request.operationId, requestDigest, request, status: "audio-submitting", submittedAt: now, staleAfter: request.staleAfter ?? new Date(Date.parse(now) + AUDIO_STALE_MS).toISOString() }, now, options);
  const generation = cli(options, ["generate", "audio", request.prompt, "--format", request.format ?? "brief", "--length", request.length ?? "short", "--notebook", request.notebookId, "--no-wait", "--json"]);
  const taskId = generation.json?.task_id ?? generation.json?.taskId ?? generation.json?.id ?? null;
  if (generation.status !== 0 || !taskId) return append(root, "audio-jobs", { type: "GeminiNotebookAudioJobState", operationId: request.operationId, requestDigest, request, status: "refused", code: "audio-submit-failed-or-ambiguous-no-resubmit", submittedAt: now }, now, options);
  return append(root, "audio-jobs", { type: "GeminiNotebookAudioJobState", operationId: request.operationId, requestDigest, request, status: "audio-submitted", taskId, submittedAt: now, staleAfter: request.staleAfter ?? new Date(Date.parse(now) + AUDIO_STALE_MS).toISOString() }, now, options);
}

export async function recoverAudioSubmission(request, options = {}) {
  const now = instant(options); const root = dataRoot(options); const operationId = request?.operationId;
  if (request?.type !== "GeminiNotebookAudioSubmissionRecoveryRequest" || !validOperationId(operationId)
    || request.grounds !== "provider-task-observed-after-post-commit-journal-failure"
    || typeof request.expectedRequestDigest !== "string" || typeof request.taskId !== "string") return refusal("AudioSubmissionRecovery", operationId, "invalid-recovery-request");
  const job = await latestAudioJob(operationId, options);
  if (!job) return refusal("AudioSubmissionRecovery", operationId, "job-not-found");
  if (job.requestDigest !== request.expectedRequestDigest) return refusal("AudioSubmissionRecovery", operationId, "audio-job-request-digest-mismatch");
  if (job.status === "audio-submitted" && job.taskId === request.taskId) return job;
  if (job.status !== "audio-submitting") return refusal("AudioSubmissionRecovery", operationId, "audio-job-not-awaiting-submission-recovery", { audioJobStatus: job.status });
  const observation = cli(options, ["artifact", "list", "--notebook", job.request.notebookId, "--json"]);
  if (observation.status !== 0) return refusal("AudioSubmissionRecovery", operationId, "artifact-list-failed", { providerObservation: cliEvidence(observation) });
  const candidates = artifactRows(observation.json).filter((row) => {
    const id = row?.id ?? row?.artifact_id ?? row?.artifactId; const type = String(row?.type_id ?? row?.type ?? "").toLowerCase();
    const created = Date.parse(row?.created_at ?? row?.createdAt); return id === request.taskId && type === "audio" && Number.isFinite(created) && created >= Date.parse(job.submittedAt);
  });
  if (candidates.length !== 1) return refusal("AudioSubmissionRecovery", operationId, "exact-post-commit-audio-task-not-observed", { observedCandidateCount: candidates.length });
  const providerStatus = String(candidates[0].status ?? "unknown").toLowerCase().replaceAll("-", "_");
  if (["failed", "error", "cancelled", "canceled", "expired"].includes(providerStatus)) return refusal("AudioSubmissionRecovery", operationId, `audio-generation-${providerStatus}`);
  return append(root, "audio-jobs", { ...job, id: undefined, status: "audio-submitted", taskId: request.taskId,
    recoveredPostCommitSubmission: true, recoveryGrounds: request.grounds, recoveredProviderStatus: providerStatus }, now, options);
}

function generationBindings(job, artifactPath) {
  const generationRequest = {
    sources: job.request.sourcePacket.documents.map((document) => ({ path: document.path, digest: sha256Digest(Buffer.from(document.content)), title: document.name })),
    prompt: job.request.prompt, artifactType: "audio", executionMode: "live", corpusMode: "reconciled-notebook", notebookSourceReceiptId: job.request.notebookSourceReceiptId,
  };
  const offer = { type: "Offer", actor: PROVIDER, id: semanticId({ type: "AsyncAudioOffer", operationId: job.operationId, requestDigest: semanticId(generationRequest) }), object: { type: "ExecutableServiceOffer", request: generationRequest, requestDigest: semanticId(generationRequest) } };
  const invocation = { type: "Accept", actor: LMT, target: PROVIDER, id: job.operationId, object: { offer } };
  const bytes = readFileSync(artifactPath);
  const resultObject = { type: "GeminiNotebookServiceResult", requestDigest: offer.object.requestDigest, notebookSourceReceiptId: job.request.notebookSourceReceiptId, artifact: { type: "audio", path: artifactPath, byteLength: bytes.length, audioDigest: sha256Digest(bytes) } };
  const result = { type: "Accept", actor: PROVIDER, inReplyTo: invocation.id, object: resultObject }; result.id = semanticId({ actor: result.actor, type: result.type, inReplyTo: result.inReplyTo, object: result.object });
  return { offer, invocation, result };
}

export async function resumeAudioJob(operationId, options = {}) {
  const now = instant(options); const root = dataRoot(options); const job = await latestAudioJob(operationId, options);
  if (!job) return refusal("Audio", operationId, "job-not-found");
  if (job.status === "completed") return job;
  if (job.status === "refused") {
    // A completed provider task can be settled again after repairing an
    // internal delivery validator.  Reuse only the already-downloaded bytes;
    // never submit or poll another generation task from this recovery path.
    const recoverableDeliveryCodes = new Set(["generation-bindings-mismatch", "provider-local-source-reconciliation-receipt-absent-or-invalid"]);
    if (!recoverableDeliveryCodes.has(job.code)) return job;
    const providerRoot = options.providerRoot ?? NODE_ROOT;
    const artifactPath = join(providerRoot, "data", "artifacts", `${contentIdStem(operationId)}.mp3`);
    if (!existsSync(artifactPath)) return job;
    const bindings = generationBindings(job, artifactPath);
    const witnessBody = { source: PROVIDER, type: "org.emsenn.notebooklm-inference-team.contract.completed", subject: bindings.invocation.id, time: now, data: { activityDigest: semanticId(bindings.invocation), result: bindings.result.id } };
    await append(root, "events", { specversion: "1.0", id: semanticId(witnessBody), operationId, ...witnessBody }, now, options);
    const artifact = await deliverGeminiNotebookAudio({ type: "GeminiNotebookAudioDeliveryRequest", sourcePacket: job.request.sourcePacket, sourcePacketDigest: job.request.sourcePacketDigest, notebookSourceReceiptId: job.request.notebookSourceReceiptId, generationOffer: bindings.offer, generationInvocation: bindings.invocation, generationResult: bindings.result }, { providerRoot, dataRoot: root, witnessJournalAgentUrl: options.witnessJournalAgentUrl });
    if (artifact.type !== "GeminiNotebookAudioArtifact") return job;
    return append(root, "audio-jobs", { ...job, id: undefined, code: undefined, status: "completed", artifactId: job.artifactId ?? job.taskId, artifact, recoveredFrom: job.code }, now, options);
  }
  if (job.status === "audio-submitting") return append(root, "audio-jobs", { ...job, id: undefined, status: "refused", code: "ambiguous-submit-no-resubmit" }, now, options);
  if (Date.parse(now) > Date.parse(job.staleAfter)) return append(root, "audio-jobs", { ...job, id: undefined, status: "refused", code: "audio-task-exceeded-generous-stale-horizon" }, now, options);
  const poll = cli(options, ["artifact", "poll", job.taskId, "--notebook", job.request.notebookId, "--json"]);
  if (poll.status !== 0) return append(root, "audio-jobs", { ...job, id: undefined, status: "audio-in-progress", code: "poll-observation-failed" }, now, options);
  const status = String(poll.json?.status ?? poll.json?.artifact?.status ?? "").toLowerCase().replaceAll("-", "_");
  if (["failed", "error", "cancelled", "canceled", "expired"].includes(status)) return append(root, "audio-jobs", { ...job, id: undefined, status: "refused", code: `audio-generation-${status}` }, now, options);
  if (!["completed", "complete", "ready", "succeeded", "success"].includes(status)) return append(root, "audio-jobs", { ...job, id: undefined, status: "audio-in-progress", lastProviderStatus: status || "unknown" }, now, options);
  const artifactId = poll.json?.artifact_id ?? poll.json?.artifactId ?? poll.json?.id ?? poll.json?.artifact?.id ?? job.taskId;
  const providerRoot = options.providerRoot ?? NODE_ROOT;
  const artifactPath = join(providerRoot, "data", "artifacts", `${contentIdStem(operationId)}.mp3`); mkdirSync(dirname(artifactPath), { recursive: true });
  const download = cli(options, ["download", "audio", artifactPath, "--notebook", job.request.notebookId, "--artifact", artifactId, "--json", "--no-clobber"]);
  if (download.status !== 0 || !existsSync(artifactPath)) return append(root, "audio-jobs", { ...job, id: undefined, status: "refused", code: "audio-download-failed" }, now, options);
  const bindings = generationBindings(job, artifactPath);
  const witnessBody = { source: PROVIDER, type: "org.emsenn.notebooklm-inference-team.contract.completed", subject: bindings.invocation.id, time: now, data: { activityDigest: semanticId(bindings.invocation), result: bindings.result.id } };
  await append(root, "events", { specversion: "1.0", id: semanticId(witnessBody), operationId, ...witnessBody }, now, options);
  const artifact = await deliverGeminiNotebookAudio({ type: "GeminiNotebookAudioDeliveryRequest", sourcePacket: job.request.sourcePacket, sourcePacketDigest: job.request.sourcePacketDigest, notebookSourceReceiptId: job.request.notebookSourceReceiptId, generationOffer: bindings.offer, generationInvocation: bindings.invocation, generationResult: bindings.result }, { providerRoot, dataRoot: root, witnessJournalAgentUrl: options.witnessJournalAgentUrl });
  if (artifact.type !== "GeminiNotebookAudioArtifact") return append(root, "audio-jobs", { ...job, id: undefined, status: "refused", code: artifact.code ?? "audio-delivery-refused" }, now, options);
  return append(root, "audio-jobs", { ...job, id: undefined, status: "completed", artifactId, artifact }, now, options);
}

const VIDEO_STYLES = new Set(["auto", "classic", "whiteboard", "kawaii", "anime", "watercolor", "retro-print", "heritage", "paper-craft"]);
const VIDEO_TERMINAL_FAILURES = new Set(["failed", "error", "cancelled", "canceled", "expired"]);
const VIDEO_TERMINAL_SUCCESS = new Set(["completed", "complete", "ready", "succeeded", "success"]);

async function videoRequestValid(request, root, options = {}) {
  if (request?.type !== "GeminiNotebookAsyncVideoJobRequest" || !validOperationId(request.operationId)
    || typeof request.notebookId !== "string" || request.notebookId.trim() === ""
    || typeof request.prompt !== "string" || request.prompt.trim() === ""
    || !["cinematic", "explainer"].includes(request.videoFormat)
    || typeof request.videoLanguage !== "string" || request.videoLanguage.trim() === ""
    || !isNiUri(request.providerRequestDigest ?? "")
    || typeof request.providerInvocationId !== "string" || request.providerInvocationId.trim() === ""
    || typeof request.notebookSourceReceiptId !== "string") return false;
  const sourceReceipt = await resolveSourceReceipt(root, request.notebookSourceReceiptId, options);
  if (!sourceReceipt || sourceReceipt.notebookId !== request.notebookId) return false;
  if (request.videoFormat === "cinematic") return request.videoStyle === null && request.videoLanguage === "en";
  return VIDEO_STYLES.has(request.videoStyle);
}

function videoGenerateArgs(request) {
  const args = ["generate", "video", request.prompt, "--format", request.videoFormat, "--language", request.videoLanguage, "--notebook", request.notebookId, "--no-wait", "--json"];
  if (request.videoFormat === "explainer") args.splice(7, 0, "--style", request.videoStyle);
  return args;
}

function stableNotebookObservation(request, sourceReceipt, options) {
  const observation = cli(options, ["source", "list", "--notebook", request.notebookId, "--json"]);
  if (observation.status !== 0) return { ok: false, code: sourceListCode(observation), providerObservation: cliEvidence(observation) };
  const rows = listRows(observation.json);
  if (!Array.isArray(rows)) return { ok: false, code: "video-source-observation-invalid" };
  const ids = rows.map(sourceId).filter(Boolean).sort();
  const admittedById = new Map((Array.isArray(sourceReceipt.finalSources) ? sourceReceipt.finalSources : []).map((row) => [sourceId(row), row]));
  const degraded = rows.some((row) => {
    if (sourceReady(row)) return false;
    const admitted = admittedById.get(sourceId(row));
    return !admitted || sourceReady(admitted) || sourceStatus(admitted) !== sourceStatus(row);
  });
  if (semanticId(ids) !== semanticId([...sourceReceipt.finalSourceIds].sort()) || degraded) return { ok: false, code: "stable-notebook-source-set-changed-before-video-submission", observedSourceIds: ids };
  return { ok: true, observedSourceIds: ids };
}

export async function submitVideoJob(request, options = {}) {
  const now = instant(options); const root = dataRoot(options);
  if (!await videoRequestValid(request, root, options)) return refusal("Video", request?.operationId, "invalid-request-or-provider-receipt-binding");
  const existing = await latestVideoJob(request.operationId, options); if (existing) return existing;
  const lockRoot = options.videoLockRoot ?? join(root, "runtime/async-video-job-locks");
  const lock = join(lockRoot, `${contentIdStem(request.operationId)}.lock`); mkdirSync(dirname(lock), { recursive: true });
  try { mkdirSync(lock); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    return await latestVideoJob(request.operationId, options) ?? refusal("Video", request.operationId, "video-submission-in-progress");
  }
  try {
  const afterLock = await latestVideoJob(request.operationId, options); if (afterLock) return afterLock;
  const requestDigest = semanticId(request); const staleAfter = request.staleAfter ?? new Date(Date.parse(now) + VIDEO_STALE_MS).toISOString();
  await append(root, "video-jobs", { type: "GeminiNotebookVideoJobState", operationId: request.operationId, requestDigest, request, status: "video-submitting", submittedAt: now, staleAfter }, now, options);
  const sourceReceipt = await resolveSourceReceipt(root, request.notebookSourceReceiptId, options);
  const observed = stableNotebookObservation(request, sourceReceipt, options);
  if (!observed.ok) return append(root, "video-jobs", { type: "GeminiNotebookVideoJobState", operationId: request.operationId, requestDigest, request, status: "refused", code: observed.code, submittedAt: now, staleAfter, ...observed }, now, options);
  let generation;
  try { generation = cli(options, videoGenerateArgs(request)); }
  catch (error) {
    await append(root, "video-jobs", { type: "GeminiNotebookVideoJobState", operationId: request.operationId, requestDigest, request, status: "video-submitting", code: "video-submit-transport-ambiguous-no-resubmit", submittedAt: now, staleAfter, observedSourceIds: observed.observedSourceIds }, now, options);
    throw error;
  }
  const taskId = generation.json?.task_id ?? generation.json?.taskId ?? generation.json?.artifact_id ?? generation.json?.artifactId ?? generation.json?.id ?? generation.json?.artifact?.id ?? null;
  if (generation.status !== 0 || typeof taskId !== "string" || taskId.length === 0) return append(root, "video-jobs", { type: "GeminiNotebookVideoJobState", operationId: request.operationId, requestDigest, request, status: "video-submitting", code: "video-submit-failed-or-ambiguous-no-resubmit", submittedAt: now, staleAfter, observedSourceIds: observed.observedSourceIds, providerObservation: cliEvidence(generation) }, now, options);
  return append(root, "video-jobs", { type: "GeminiNotebookVideoJobState", operationId: request.operationId, requestDigest, request, status: "video-submitted", taskId, submittedAt: now, staleAfter, observedSourceIds: observed.observedSourceIds }, now, options);
  } finally {
    try { rmdirSync(lock); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export async function recoverVideoSubmission(request, options = {}) {
  const now = instant(options); const root = dataRoot(options); const operationId = request?.operationId;
  if (request?.type !== "GeminiNotebookVideoSubmissionRecoveryRequest" || !validOperationId(operationId)
    || request.grounds !== "provider-task-observed-after-post-commit-journal-failure"
    || typeof request.expectedRequestDigest !== "string" || typeof request.taskId !== "string") return refusal("VideoSubmissionRecovery", operationId, "invalid-recovery-request");
  const job = await latestVideoJob(operationId, options);
  if (!job) return refusal("VideoSubmissionRecovery", operationId, "job-not-found");
  if (job.requestDigest !== request.expectedRequestDigest) return refusal("VideoSubmissionRecovery", operationId, "video-job-request-digest-mismatch");
  if (job.status === "video-submitted" && job.taskId === request.taskId) return job;
  if (job.status !== "video-submitting") return refusal("VideoSubmissionRecovery", operationId, "video-job-not-awaiting-submission-recovery", { videoJobStatus: job.status });
  const observation = cli(options, ["artifact", "list", "--notebook", job.request.notebookId, "--type", "video", "--json"]);
  if (observation.status !== 0) return refusal("VideoSubmissionRecovery", operationId, "artifact-list-failed", { providerObservation: cliEvidence(observation) });
  const candidates = artifactRows(observation.json).filter((row) => {
    const id = row?.id ?? row?.artifact_id ?? row?.artifactId; const type = String(row?.type_id ?? row?.type ?? "").toLowerCase();
    const created = Date.parse(row?.created_at ?? row?.createdAt); return id === request.taskId && type === "video" && Number.isFinite(created) && created >= Date.parse(job.submittedAt);
  });
  if (candidates.length !== 1) return refusal("VideoSubmissionRecovery", operationId, "exact-post-commit-video-task-not-observed", { observedCandidateCount: candidates.length });
  const providerStatus = String(candidates[0].status ?? "unknown").toLowerCase().replaceAll("-", "_");
  if (VIDEO_TERMINAL_FAILURES.has(providerStatus)) return refusal("VideoSubmissionRecovery", operationId, `video-generation-${providerStatus}`);
  return append(root, "video-jobs", { ...job, id: undefined, status: "video-submitted", taskId: request.taskId, code: undefined,
    recoveredPostCommitSubmission: true, recoveryGrounds: request.grounds, recoveredProviderStatus: providerStatus }, now, options);
}

function writeExact(path, bytes) {
  try { writeFileSync(path, bytes, { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST" || !readFileSync(path).equals(bytes)) throw error; }
}

export async function resumeVideoJob(operationId, options = {}) {
  const now = instant(options); const root = dataRoot(options); const job = await latestVideoJob(operationId, options);
  if (!job) return refusal("Video", operationId, "job-not-found");
  if (job.status === "refused" && job.code === "stable-notebook-source-set-changed-before-video-submission") {
    const sourceReceipt = await resolveSourceReceipt(root, job.request.notebookSourceReceiptId, options), observed = stableNotebookObservation(job.request, sourceReceipt, options);
    if (!observed.ok) return job;
    let generation;
    try { generation = cli(options, videoGenerateArgs(job.request)); }
    catch (error) { return append(root, "video-jobs", { ...job, id: undefined, status: "video-submitting", code: "video-submit-transport-ambiguous-no-resubmit", providerObservation: { errorCode: error?.code ?? null, errorName: error?.name ?? "Error" }, recoveredFrom: job.code }, now, options); }
    const taskId = generation.json?.task_id ?? generation.json?.taskId ?? generation.json?.artifact_id ?? generation.json?.artifactId ?? generation.json?.id ?? generation.json?.artifact?.id ?? null;
    if (generation.status !== 0 || typeof taskId !== "string" || taskId.length === 0) return append(root, "video-jobs", { ...job, id: undefined, status: "video-submitting", code: "video-submit-failed-or-ambiguous-no-resubmit", observedSourceIds: observed.observedSourceIds, providerObservation: cliEvidence(generation), recoveredFrom: job.code }, now, options);
    return append(root, "video-jobs", { ...job, id: undefined, status: "video-submitted", taskId, code: undefined, observedSourceIds: observed.observedSourceIds, recoveredFrom: job.code }, now, options);
  }
  if (job.status === "completed" || (job.status === "refused" && !["video-download-failed", "video-metadata-conflict"].includes(job.code))) return job;
  if (job.status === "video-submitting") return refusal("Video", operationId, "ambiguous-video-submit-requires-explicit-recovery", { requestDigest: job.requestDigest });
  if (Date.parse(now) > Date.parse(job.staleAfter)) return append(root, "video-jobs", { ...job, id: undefined, status: "refused", code: "video-task-exceeded-generous-stale-horizon" }, now, options);
  let poll;
  try { poll = cli(options, ["artifact", "poll", job.taskId, "--notebook", job.request.notebookId, "--json"]); }
  catch (error) { return append(root, "video-jobs", { ...job, id: undefined, status: "video-in-progress", code: "poll-transport-exception", providerObservation: { errorCode: error?.code ?? null, errorName: error?.name ?? "Error" } }, now, options); }
  if (poll.status !== 0) return append(root, "video-jobs", { ...job, id: undefined, status: "video-in-progress", code: "poll-observation-failed", providerObservation: cliEvidence(poll) }, now, options);
  const status = String(poll.json?.status ?? poll.json?.artifact?.status ?? "").toLowerCase().replaceAll("-", "_");
  if (VIDEO_TERMINAL_FAILURES.has(status)) return append(root, "video-jobs", { ...job, id: undefined, status: "refused", code: `video-generation-${status}` }, now, options);
  if (!VIDEO_TERMINAL_SUCCESS.has(status)) return append(root, "video-jobs", { ...job, id: undefined, status: "video-in-progress", code: undefined, lastProviderStatus: status || "unknown" }, now, options);
  const artifactId = poll.json?.artifact_id ?? poll.json?.artifactId ?? poll.json?.id ?? poll.json?.artifact?.id ?? job.taskId;
  if (typeof artifactId !== "string" || artifactId.length === 0) return append(root, "video-jobs", { ...job, id: undefined, status: "refused", code: "completed-video-lacks-exact-artifact-id" }, now, options);
  const providerRoot = options.providerRoot ?? NODE_ROOT; const stem = contentIdStem(operationId);
  const artifactPath = join(providerRoot, "content", "exchanges", `${stem}.video.mp4`); mkdirSync(dirname(artifactPath), { recursive: true });
  let recoveredPostCommitDownload = false;
  if (existsSync(artifactPath)) {
    if (!notebookVideoPayload(readFileSync(artifactPath), job.request, artifactId)) return append(root, "video-jobs", { ...job, id: undefined, status: "refused", code: "existing-video-carrier-invalid-no-overwrite" }, now, options);
    recoveredPostCommitDownload = true;
  } else {
    let download;
    try { download = cli(options, ["download", "video", artifactPath, "--notebook", job.request.notebookId, "--artifact", artifactId, "--json", "--no-clobber"]); }
    catch (error) {
      if (!existsSync(artifactPath) || !notebookVideoPayload(readFileSync(artifactPath), job.request, artifactId)) return append(root, "video-jobs", { ...job, id: undefined, status: "refused", code: "video-download-transport-ambiguous-no-redownload", providerObservation: { errorCode: error?.code ?? null, errorName: error?.name ?? "Error" } }, now, options);
      recoveredPostCommitDownload = true;
    }
    if (!recoveredPostCommitDownload && (download.status !== 0 || !existsSync(artifactPath))) {
      if (!existsSync(artifactPath) || !notebookVideoPayload(readFileSync(artifactPath), job.request, artifactId)) return append(root, "video-jobs", { ...job, id: undefined, status: "video-in-progress", code: "video-download-failed", lastProviderStatus: status, providerObservation: cliEvidence(download) }, now, options);
      recoveredPostCommitDownload = true;
    }
  }
  const bytes = readFileSync(artifactPath); const payload = notebookVideoPayload(bytes, job.request, artifactId);
  if (!payload) return append(root, "video-jobs", { ...job, id: undefined, status: "refused", code: "video-artifact-failed-mp4-validation" }, now, options);
  const metadataPath = join(providerRoot, "content", "exchanges", `${stem}.video.json`);
  try { writeExact(metadataPath, Buffer.from(`${JSON.stringify(payload, null, 2)}\n`)); }
  catch (error) { return append(root, "video-jobs", { ...job, id: undefined, status: "refused", code: "video-metadata-conflict", providerObservation: { errorCode: error?.code ?? null, errorName: error?.name ?? "Error" } }, now, options); }
  const artifact = { type: "video", path: artifactPath, payload };
  return append(root, "video-jobs", { ...job, id: undefined, code: undefined, status: "completed", artifactId, artifact, metadataPath,
    sourceReceiptId: job.request.notebookSourceReceiptId, providerRequestDigest: job.request.providerRequestDigest,
    providerInvocationId: job.request.providerInvocationId,
    recoveredPostCommitDownload }, now, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const operation = process.argv[2]; const value = JSON.parse(readFileSync(0, "utf8"));
  const result = operation === "submit-source" ? await submitSourceJob(value) : operation === "resume-source" ? await resumeSourceJob(value.operationId) : operation === "cancel-source" ? await cancelSourceJob(value) : operation === "start-source-carrier-repair" ? await startSourceCarrierRepair(value) : operation === "submit-audio" ? await submitAudioJob(value) : operation === "recover-audio-submission" ? await recoverAudioSubmission(value) : operation === "resume-audio" ? await resumeAudioJob(value.operationId) : operation === "submit-video" ? await submitVideoJob(value) : operation === "recover-video-submission" ? await recoverVideoSubmission(value) : operation === "resume-video" ? await resumeVideoJob(value.operationId) : refusal("Async", value?.operationId, "unknown-operation");
  process.stdout.write(`${JSON.stringify(result)}\n`); if (result.status === "refused" || result.type.endsWith("Refusal")) process.exitCode = 2;
}
