#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {geminiNotebookPython} from './gemini-notebook-cli.mjs';
import { mkdirSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { argument as arg } from "@red-cup-engineering/javascript-node-services-section/argv";
import { jsonResource } from "@red-cup-engineering/json-services-section";
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";
import { deliverGeminiNotebookAudio, resolveSourceReceipt } from "./contract-gemini-notebook-audio-delivery.js";
import { latestVideoJob, resumeVideoJob, submitVideoJob } from "./contract-gemini-notebook-async-jobs.js";
import { queryProviderCategory } from "./provider-evidence.mjs";
import { chainWitnessEnabled, createChainWitnessWriter } from "./chain-witness.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const NODE_ID = "notebooklm-inference-team";
const ACTOR = `urn:ame:${NODE_ID}`;
const LMT_ACTOR = "urn:ame:leader-movement-team";
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = join(NODE_ROOT, "run-one-exchange.py");
const PYTHON = geminiNotebookPython({root:NODE_ROOT});
const executionRuntime = new AsyncLocalStorage();

function now() { return arg("--now") ?? new Date().toISOString(); }
function operation() { return arg("--operation") ?? "solicit-service"; }
function input() { return JSON.parse(readFileSync(0, "utf8")); }
async function append(type, value, instant) {
  const envelope = { type: "GeminiNotebookJobRecord", category: type, row: value };
  if (chainWitnessEnabled()) {
    const writer = await createChainWitnessWriter({ rpcUrl: process.env.EVM_RPC_URL, keystorePath: process.env.EVM_KEYSTORE_PATH, passwordPath: process.env.EVM_KEYSTORE_PASSWORD_PATH, contractAddress: process.env.ONCHAIN_RESOURCE_CONTRACT });
    return writer({ actor: ACTOR, category: type, envelope: { ...envelope, graph: semanticId(envelope) }, recordedAt: instant });
  }
  const runtime = executionRuntime.getStore() ?? {};
  if (runtime.testOnlyWitness !== undefined) {
    if (typeof runtime.testOnlyWitness !== "function") throw new TypeError("testOnlyWitness must be a function");
    return runtime.testOnlyWitness({ actor: ACTOR, category: type, envelope, recordedAt: instant });
  }
  throw new Error("Gemini Notebook live witnesses require the canonical eip155:5615610 chain writer");
}
async function witness(activity, outcome, instant, details = {}) {
  const body = jsonResource({ source: ACTOR, type: `org.emsenn.${NODE_ID}.${outcome}`, subject: activity?.id ?? "urn:activity:unidentified", time: instant, data: { activityDigest: semanticId(jsonResource(activity ?? null, "Gemini Notebook witnessed activity")), ...details } }, "Gemini Notebook witness body");
  const event = { specversion: "1.0", id: semanticId(body), ...body, datacontenttype: "application/json" };
  await append("events", event, instant);
  await append("eavt", { operationId: body.subject, e: body.subject, a: "activity/outcome", v: outcome, t: event.id }, instant);
  return event;
}
function response(type, source, object) {
  return { "@context": CONTEXT, id: semanticId({ actor: ACTOR, type, inReplyTo: source?.id ?? null, object }), type, actor: ACTOR, target: source?.actor ?? LMT_ACTOR, inReplyTo: source?.id ?? "urn:activity:unidentified", object };
}
function emit(value, code = 0) { const runtime=executionRuntime.getStore();if(runtime?.capture===true){runtime.result=value;runtime.code=code;return;}process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); process.exitCode = code; }
async function reject(source, reason, instant, details = {}) {
  const value = response("Reject", source, { type: "Refusal", reason, ...details });
  await witness(source, "activity.rejected", instant, { reason }); emit(value, 2);
}
function attachments(note) {
  if (Array.isArray(note?.attachment)) return note.attachment;
  return note?.attachment === undefined ? [] : [note.attachment];
}
async function sourceReceipt(receiptId) {
  if (typeof receiptId !== "string") return null;
  const runtime = executionRuntime.getStore() ?? {};
  const record = await resolveSourceReceipt(runtime.dataRoot ?? join(NODE_ROOT, "data"), receiptId, { witnessJournalAgentUrl: runtime.witnessJournalAgentUrl }); const ids = record?.finalSourceIds;
  return record && record.finalSourceSetDigest === semanticId([...ids].sort()) ? record : null;
}
function stableSourceManifest(sources) {
  return sources.map((source) => ({ digest: source.digest, title: source.title ?? (typeof source.path === "string" ? basename(source.path) : null) }));
}
function resourceBudgetConsideration() {
  const accounting = JSON.parse(readFileSync(join(NODE_ROOT, "content/config/workspace-market.json"), "utf8")).accounting;
  if (accounting?.fixedFee !== null || accounting.markup !== "0" || accounting.monetaryConversion !== "none-without-an-observed-cost-oracle"
      || !Array.isArray(accounting.meters) || accounting.meters.length === 0) throw new Error("Gemini Notebook resource-budget accounting terms are malformed");
  return Object.freeze({
    type: "GeminiNotebookResourceBudgetConsideration",
    fixedFee: null,
    markup: "0",
    monetaryConversion: accounting.monetaryConversion,
    meters: Object.freeze([...accounting.meters]),
    requires: Object.freeze(["resource-budget-authorization", "observed-cost-settlement"]),
  });
}
function normalizedRequest(sourceActivity) {
  const note = sourceActivity?.object;
  const request = attachments(note).find((item) => item?.type === "GeminiNotebookRequest");
  if (!request) return null;
  const artifactType = request.artifactType ?? request["artifact-type"];
  const videoFormat = artifactType === "video" ? (request.videoFormat ?? null) : null;
  return {
    sources: request.sources,
    prompt: request.prompt,
    artifactType,
    executionMode: request.executionMode ?? "live",
    corpusMode: request.corpusMode ?? "ephemeral-upload",
    notebookSourceReceiptId: request.notebookSourceReceiptId ?? null,
    sourcePacket: request.sourcePacket ?? null,
    sourcePacketDigest: request.sourcePacketDigest ?? null,
    resultSchema: artifactType === "json" ? (request.resultSchema ?? null) : null,
    videoFormat,
    videoStyle: artifactType === "video" ? (request.videoStyle ?? (videoFormat === "explainer" ? "auto" : null)) : null,
    videoLanguage: artifactType === "video" ? (request.videoLanguage ?? "en") : null,
  };
}
async function requestProblems(request) {
  const problems = [];
  if (!request || !Array.isArray(request.sources) || request.sources.length === 0) problems.push("sources");
  if (!request || typeof request.prompt !== "string" || request.prompt.trim() === "") problems.push("prompt");
  if (!request || !["report", "mind-map", "infographic", "audio", "video", "code", "json", "data-table"].includes(request.artifactType)) problems.push("artifactType(report|mind-map|infographic|audio|video|code|json|data-table)");
  if (!request || !["dry-run", "live"].includes(request.executionMode)) problems.push("executionMode(dry-run|live)");
  if (!request || !["ephemeral-upload", "reconciled-notebook"].includes(request.corpusMode)) problems.push("corpusMode(ephemeral-upload|reconciled-notebook)");
  if (request?.artifactType === "code" && request.corpusMode !== "ephemeral-upload") problems.push("code corpusMode(ephemeral-upload)");
  if (["json", "data-table"].includes(request?.artifactType) && request.corpusMode !== "ephemeral-upload") problems.push(`${request.artifactType} corpusMode(ephemeral-upload)`);
  if (request?.artifactType === "json" && !/^emsenn\/schema\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(request.resultSchema ?? "")) problems.push("resultSchema(seated emsenn/schema/* class)");
  if (request?.artifactType === "video") {
    const styles = ["auto", "classic", "whiteboard", "kawaii", "anime", "watercolor", "retro-print", "heritage", "paper-craft"];
    if (!["cinematic", "explainer"].includes(request.videoFormat)) problems.push("videoFormat(cinematic|explainer)");
    if (request.videoFormat === "cinematic" && request.videoStyle !== null) problems.push("cinematic videoStyle(null)");
    if (request.videoFormat === "cinematic" && request.videoLanguage !== "en") problems.push("cinematic videoLanguage(en)");
    if (request.videoFormat === "explainer" && !styles.includes(request.videoStyle)) problems.push(`explainer videoStyle(${styles.join("|")})`);
    if (typeof request.videoLanguage !== "string" || request.videoLanguage.trim() === "") problems.push("videoLanguage(non-empty)");
  }
  if (request?.corpusMode === "ephemeral-upload" && request.executionMode === "live" && Array.isArray(request.sources)) {
    const unbound = request.sources.filter((source) => typeof source !== "object" || source === null || typeof source.path !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(source.digest ?? ""));
    if (unbound.length) problems.push("live sources must be {path,digest} records");
    for (const source of request.sources.filter((item) => item && typeof item === "object" && typeof item.path === "string" && /^sha256:[a-f0-9]{64}$/u.test(item.digest ?? ""))) {
      if (/^https?:\/\//u.test(source.path)) continue;
      if (!isAbsolute(source.path)) problems.push(`live local source must use an absolute path: ${source.path}`);
      else if (!existsSync(source.path)) problems.push(`live local source does not exist: ${source.path}`);
      else if (sha256Digest(readFileSync(source.path)) !== source.digest) problems.push(`live local source digest mismatch: ${source.path}`);
    }
  }
  if (request?.corpusMode === "reconciled-notebook" && Array.isArray(request.sources)) {
    if (request.artifactType === "audio") {
      if (!isNiUri(request.sourcePacketDigest ?? "")) problems.push("sourcePacketDigest(exact HarmoniousUnionArtifactSourcePacket digest)");
      else if (!request.sourcePacket || typeof request.sourcePacket !== "object" || semanticId(request.sourcePacket) !== request.sourcePacketDigest) problems.push("sourcePacket(exact HarmoniousUnionArtifactSourcePacket)");
    }
    const unbound = request.sources.filter((source) => typeof source !== "object" || source === null || typeof source.path !== "string" || source.path.trim() === "" || !/^sha256:[a-f0-9]{64}$/u.test(source.digest ?? "") || typeof source.title !== "string" || source.title.trim() === "");
    if (unbound.length) problems.push("reconciled-notebook sources must be {path,digest,title} manifest records");
    if (!/^(?:urn:sha256:[a-f0-9]{64}|ni:\/\/\/sha-256;[A-Za-z0-9_-]{43})$/u.test(request.notebookSourceReceiptId ?? "")) problems.push("notebookSourceReceiptId(provider receipt)");
    else {
      const receipt = await sourceReceipt(request.notebookSourceReceiptId);
      if (!receipt) problems.push("notebookSourceReceiptId(provider-local receipt not found)");
      else {
        if (receipt.outcome !== "reconciled") problems.push("notebookSourceReceiptId(receipt outcome must be reconciled)");
        if (typeof receipt.notebookId !== "string" || !Array.isArray(receipt.finalSourceIds) || receipt.finalSourceIds.length === 0) problems.push("notebookSourceReceiptId(receipt lacks stable notebook/source IDs)");
        if (canonical(receipt.desiredSources) !== canonical(stableSourceManifest(request.sources))) problems.push("sources do not match reconciliation receipt desiredSources");
      }
    }
  }
  return problems;
}
function recognizes(sourceActivity) {
  const content = sourceActivity?.object?.content;
  return typeof content === "string" && /notebook\s*lm/i.test(content);
}

async function solicit(activity, instant) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR || activity.object?.type !== "ServiceSolicitation") {
    await reject(activity, "solicitation must be an ActivityStreams Offer<ServiceSolicitation> addressed to this provider", instant); return;
  }
  const sourceActivity = activity.object.sourceActivity;
  if (!recognizes(sourceActivity) && normalizedRequest(sourceActivity) === null) {
    await reject(activity, "source intent does not request Gemini Notebook service", instant); return;
  }
  const request = normalizedRequest(sourceActivity);
  const missing = await requestProblems(request);
  if (missing.length) {
    const question = response("Question", activity, { type: "ServiceTermsRequired", sourceActivity: sourceActivity?.id, missing });
    await witness(activity, "terms.requested", instant, { missing }); emit(question); return;
  }
  const effects = request.executionMode === "live" ? ["external-network", ...(request.corpusMode === "ephemeral-upload" ? ["source-egress"] : [])] : [];
  const receipt = request.corpusMode === "reconciled-notebook" ? await sourceReceipt(request.notebookSourceReceiptId) : null;
  const object = {
    type: "ExecutableServiceOffer",
    sourceActivity: sourceActivity.id,
    intentSignature: "urn:service-intent:gemini-notebook-source-grounded-artifact",
    request,
    requestDigest: semanticId(request),
    scope: { sources: request.sources, sourceSetDigest: semanticId(request.sources), artifactType: request.artifactType, resultSchema: request.resultSchema, corpusMode: request.corpusMode, notebookSourceReceiptId: request.notebookSourceReceiptId, sourcePacketDigest: request.sourcePacketDigest, notebookId: receipt?.notebookId ?? null, videoFormat: request.videoFormat, videoStyle: request.videoStyle, videoLanguage: request.videoLanguage },
    operation: "invoke-service",
    effects,
    requirements: effects.map((effect) => ({ type: "ResourceGrant", effect })),
    evidence: ["provider-local-exchange-record", "artifact-or-refusal", "provider-local-causal-events"],
    consideration: resourceBudgetConsideration(),
  };
  const offer = response("Offer", activity, object);
  await witness(activity, "offer.emitted", instant, { offer: offer.id, requestDigest: object.requestDigest }); emit(offer);
}

async function validateInvocation(activity) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR) return "invocation must be an ActivityStreams Accept addressed to this provider";
  const contract = activity.object;
  if (contract?.type !== "ServiceContract") return "invocation must accept a ServiceContract";
  const offer = contract.offer;
  if (offer?.type !== "Offer" || offer.actor !== ACTOR || offer.object?.type !== "ExecutableServiceOffer") return "ServiceContract must carry this provider's executable Offer";
  const request = offer.object.request;
  if (offer.object.requestDigest !== semanticId(request)) return "accepted request does not match the provider offer digest";
  const changedTerms = await requestProblems(request);
  if (changedTerms.length) return `accepted request no longer satisfies provider terms: ${changedTerms.join(", ")}`;
  const capability = contract.capability;
  if (capability?.type !== "Capability" || capability.holder !== ACTOR || capability.invocationTarget !== ACTOR) return "accepted contract requires a capability held by this provider";
  if (capability.parentOffer !== offer.id || capability.attenuation?.requestDigest !== offer.object.requestDigest) return "capability is not attenuated to the accepted offer and request";
  if (canonical(capability.attenuation?.providerScope) !== canonical(offer.object.scope)) return "capability does not preserve the provider-authored source and artifact scope";
  if (!Array.isArray(capability.allowedActions) || !capability.allowedActions.includes("invoke-service")) return "capability does not grant invoke-service";
  for (const effect of offer.object.effects ?? []) if (!capability.allowedActions.includes(effect)) return `capability does not grant required effect ${effect}`;
  return null;
}

export async function settleGeminiNotebookAudio(request, harnessResult, options = {}) {
  const record = harnessResult?.record;
  const generationOffer = options.generationOffer;
  const generationInvocation = options.generationInvocation;
  const generationResult = {
    type: "GeminiNotebookServiceResult",
    requestDigest: generationOffer?.object?.requestDigest,
    notebookSourceReceiptId: record?.notebookSourceReceiptId ?? request.notebookSourceReceiptId,
    artifact: record?.artifact ?? null,
  };
  const generationEnvelope = response("Accept", generationInvocation, generationResult);
  if (typeof options.recordGenerationWitness === "function") await options.recordGenerationWitness(generationEnvelope);
  return deliverGeminiNotebookAudio({
    type: "GeminiNotebookAudioDeliveryRequest",
    sourcePacket: request.sourcePacket,
    sourcePacketDigest: request.sourcePacketDigest,
    notebookSourceReceiptId: request.notebookSourceReceiptId,
    generationOffer,
    generationInvocation,
    generationResult: generationEnvelope,
  }, { providerRoot: options.providerRoot ?? NODE_ROOT, dataRoot: options.dataRoot ?? join(NODE_ROOT, "data"), readFile: options.readFile, witnessJournalAgentUrl: options.witnessJournalAgentUrl });
}

async function invoke(activity, instant) {
  const invalid = await validateInvocation(activity);
  if (invalid) { await reject(activity, invalid, instant); return; }
  const offer = activity.object.offer;
  const request = offer.object.request;
  if (request.executionMode === "live" && request.artifactType === "video" && request.corpusMode !== "reconciled-notebook") {
    // A durable intent makes an ambiguous ephemeral generation require recovery,
    // independently of the channel schedule or provider quota.
    const runtime = executionRuntime.getStore() ?? {};
    const root = runtime.dataRoot ?? join(NODE_ROOT, "data");
    const operation = semanticId({ invocation: activity.id });
    const records = await queryProviderCategory("ephemeral-video-intents", { witnessJournalAgentUrl: runtime.witnessJournalAgentUrl });
    if (records.some(({ value }) => value?.row?.invocation === activity.id)) {
      await reject(activity, "video-invocation-already-started-recovery-required", instant); return;
    }
    const intentRoot = join(root, "runtime/ephemeral-video-intents");
    mkdirSync(intentRoot, { recursive: true });
    try { writeFileSync(join(intentRoot, operation.slice(7)), JSON.stringify({ invocation: activity.id, requestDigest: offer.object.requestDigest }), { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; await reject(activity, "video-invocation-already-started-recovery-required", instant); return; }
    await append("ephemeral-video-intents", { invocation: activity.id, requestDigest: offer.object.requestDigest, startedAt: instant }, instant);
  }
  if (request.executionMode === "live" && request.artifactType === "video" && request.corpusMode === "reconciled-notebook") {
    const receipt = await sourceReceipt(request.notebookSourceReceiptId);
    const operationId = semanticId({ type: "GeminiNotebookAsyncVideoOperation", providerInvocation: activity.id, requestDigest: offer.object.requestDigest });
    const asyncRequest = {
      type: "GeminiNotebookAsyncVideoJobRequest", operationId, notebookId: receipt.notebookId,
      prompt: request.prompt, videoFormat: request.videoFormat, videoStyle: request.videoStyle, videoLanguage: request.videoLanguage,
      notebookSourceReceiptId: request.notebookSourceReceiptId, providerRequestDigest: offer.object.requestDigest,
      providerInvocationId: activity.id,
    };
    const witnessJournalAgentUrl = (executionRuntime.getStore() ?? {}).witnessJournalAgentUrl;
    const prior = await latestVideoJob(operationId, { dataRoot: join(NODE_ROOT, "data"), witnessJournalAgentUrl });
    const job = prior
      ? await resumeVideoJob(operationId, { dataRoot: join(NODE_ROOT, "data"), providerRoot: NODE_ROOT, now: instant, witnessJournalAgentUrl })
      : await submitVideoJob(asyncRequest, { dataRoot: join(NODE_ROOT, "data"), providerRoot: NODE_ROOT, now: instant, witnessJournalAgentUrl });
    if (job?.type?.endsWith("Refusal") || job?.status === "refused") {
      await reject(activity, job.code ?? "async-video-job-refused", instant, { asyncVideoJob: job }); return;
    }
    if (job?.status === "completed") {
      const object = {
        type: "GeminiNotebookServiceResult", disposition: "artifact",
        sourceActivity: offer.object.sourceActivity, requestDigest: offer.object.requestDigest,
        providerExchange: null, artifact: job.artifact, sourcePacketDigest: request.sourcePacketDigest,
        observations: { async: true, operationId, taskId: job.taskId, status: job.status }, dryRun: false,
        corpusMode: request.corpusMode, notebookSourceReceiptId: request.notebookSourceReceiptId
      };
      const result = response("Accept", activity, object);
      await witness(activity, "contract.completed", instant, { result: result.id, disposition: object.disposition, ...(operationId === undefined ? {} : { asyncVideoOperation: operationId }) }); emit(result); return;
    }
    const object = {
      type: "GeminiNotebookVideoJobResult", disposition: "in-progress",
      sourceActivity: offer.object.sourceActivity, requestDigest: offer.object.requestDigest,
      operationId, taskId: job.taskId ?? null, status: job.status,
      notebookSourceReceiptId: request.notebookSourceReceiptId
    };
    const result = response("Accept", activity, object);
    await witness(activity, "contract.in-progress", instant, { result: result.id, disposition: object.disposition, asyncVideoOperation: operationId, status: job.status }); emit(result); return;
  }
  const temp = mkdtempSync(join(tmpdir(), "gemini-notebook-contract-"));
  const packetPath = join(temp, "packet.json");
  const receipt = request.corpusMode === "reconciled-notebook" ? await sourceReceipt(request.notebookSourceReceiptId) : null;
  const notebookContext = receipt ? { notebookId: receipt.notebookId, sourceReceiptId: receipt.id, finalSourceIds: receipt.finalSourceIds, finalSourceSetDigest: receipt.finalSourceSetDigest } : undefined;
  const videoOptions = request.artifactType === "video" ? { format: request.videoFormat, style: request.videoStyle, language: request.videoLanguage } : undefined;
  writeFileSync(packetPath, `${JSON.stringify({ sources: request.sources, prompt: request.prompt, "artifact-type": request.artifactType, ...(request.artifactType === "json" ? { "result-schema": request.resultSchema } : {}), ...(videoOptions ? { "video-options": videoOptions } : {}), ...(notebookContext ? { "notebook-context": notebookContext } : {}) }, null, 2)}\n`);
  const args = [HARNESS, packetPath, ...(request.executionMode === "dry-run" ? ["--dry-run"] : [])];
  const execution = spawnSync(PYTHON, args, { cwd: NODE_ROOT, encoding: "utf8", maxBuffer: Number.POSITIVE_INFINITY, env: {...process.env,GEMINI_NOTEBOOK_PYTHON:PYTHON} });
  rmSync(temp, { recursive: true, force: true });
  let harnessResult;
  try { harnessResult = JSON.parse(execution.stdout); } catch { harnessResult = undefined; }
  if (execution.status !== 0 || !harnessResult?.ok) {
    await reject(activity, "Gemini Notebook harness failed before settling a typed provider result", instant, { status: execution.status, providerDiagnostic: harnessResult ?? "harness-untyped-failure", providerStderr: execution.stderr?.slice(0, 1000) || null }); return;
  }
  if (harnessResult.outcome === "refusal") {
    await reject(activity, harnessResult.record?.refusal?.grounds ?? "Gemini Notebook refused the exchange", instant, { providerExchange: harnessResult.record }); return;
  }
  const settledAudio = request.artifactType === "audio" && request.executionMode === "live"
    ? await settleGeminiNotebookAudio(request, harnessResult, {
      generationOffer: offer,
      generationInvocation: activity,
      witnessJournalAgentUrl: (executionRuntime.getStore() ?? {}).witnessJournalAgentUrl,
      recordGenerationWitness: (generationResult) => witness(activity, "contract.completed", instant, { result: generationResult.id, disposition: "artifact", phase: "provider-local-generation" }),
    })
    : null;
  if (settledAudio?.type === "GeminiNotebookAudioDeliveryRefusal") {
    await reject(activity, settledAudio.code, instant, { audioDeliveryRefusal: settledAudio }); return;
  }
  const object = {
    type: "GeminiNotebookServiceResult",
    disposition: request.executionMode === "dry-run" ? "ready" : "artifact",
    sourceActivity: offer.object.sourceActivity,
    requestDigest: offer.object.requestDigest,
    providerExchange: request.executionMode === "dry-run" || settledAudio ? null : harnessResult.record,
    artifact: settledAudio ?? harnessResult.record?.artifact ?? null,
    sourcePacketDigest: request.sourcePacketDigest,
    observations: request.executionMode === "dry-run" ? { networkCalls: 0, recordsWritten: 0 } : harnessResult.record?.cost ?? {},
    dryRun: request.executionMode === "dry-run",
    corpusMode: request.corpusMode,
    notebookSourceReceiptId: request.notebookSourceReceiptId,
    ephemeralCleanup: harnessResult.ephemeral_cleanup ?? null
  };
  const result = response("Accept", activity, object);
  await witness(activity, "contract.completed", instant, { result: result.id, disposition: object.disposition }); emit(result);
}

export async function executeGeminiNotebookContract(requestedOperation, activity, options = {}) {
  if(!["solicit-service","invoke-service"].includes(requestedOperation))throw new TypeError(`unknown provider operation ${requestedOperation}`);
  const runtime={capture:true,result:undefined,code:0,testOnlyWitness:options.testOnlyWitness,dataRoot:options.dataRoot,witnessJournalAgentUrl:options.witnessJournalAgentUrl??process.env.WITNESS_JOURNAL_RDF_AGENT};
  await executionRuntime.run(runtime,()=>requestedOperation==="solicit-service"?solicit(activity,options.instant??new Date().toISOString()):invoke(activity,options.instant??new Date().toISOString()));
  if(runtime.result===undefined)throw new Error("Gemini Notebook contract completed without a provider response");
  return Object.freeze({response:runtime.result,status:runtime.code});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instant = now();
  let activity;
  try { activity = input(); } catch (error) { await reject({}, `invalid JSON input: ${error.message}`, instant); }
  if (activity !== undefined) {
    if (operation() === "solicit-service") await solicit(activity, instant);
    else if (operation() === "invoke-service") await invoke(activity, instant);
    else await reject(activity, `unknown provider operation ${operation()}`, instant);
  }
}
