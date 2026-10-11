#!/usr/bin/env node

import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { spawnSync } from "node:child_process";
import {geminiNotebookPython} from './gemini-notebook-cli.mjs';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argument as arg } from "@red-cup-engineering/javascript-node-services-section/argv";
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";
import { chainWitnessEnabled, createChainWitnessWriter } from "./chain-witness.mjs";
import { identifyRelationalValue } from "./semantic-content.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const NODE_ID = "notebooklm-inference-team";
const ACTOR = `urn:ame:${NODE_ID}`;
const LMT_ACTOR = "urn:ame:leader-movement-team";
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REALIZER = join(NODE_ROOT, "reconcile-notebook-sources.py");
const PYTHON = geminiNotebookPython({root:NODE_ROOT});
const SETTLEMENT_ACCOUNT = "eip155:31337:0xf1c133d8f725af2f4ad00176ff810e32d1d2f6cd";
const MAX_SOURCES = 50;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

function now() { return arg("--now") ?? new Date().toISOString(); }
function operation() { return arg("--operation") ?? "solicit-source-reconciliation"; }
function input() { return JSON.parse(readFileSync(0, "utf8")); }
async function append(type, value, instant) {
  const envelope = { type: "GeminiNotebookJobRecord", category: type, row: value };
  if (chainWitnessEnabled()) {
    const writer = await createChainWitnessWriter({ rpcUrl: process.env.EVM_RPC_URL, keystorePath: process.env.EVM_KEYSTORE_PATH, passwordPath: process.env.EVM_KEYSTORE_PASSWORD_PATH, contractAddress: process.env.ONCHAIN_RESOURCE_CONTRACT });
    return writer({ actor: ACTOR, category: type, envelope: { ...envelope, graph: semanticId(envelope) }, recordedAt: instant });
  }
  const { recordWitnessJournalBatch, relationalWitnessJournalDocument } = await import("@red-cup-engineering/witness-journal-document-service");
  const document = relationalWitnessJournalDocument(envelope);
  const graph = identifyRelationalValue("gemini-notebook.witness-journal-source-record", document).token;
  const agentUrl = process.env.WITNESS_JOURNAL_RDF_AGENT;
  if (!agentUrl) throw new Error("WITNESS_JOURNAL_RDF_AGENT must name the contracted witness-journal RDF provider");
  await recordWitnessJournalBatch({ agentUrl, batch: {
    settlement: SETTLEMENT_ACCOUNT, graph, recordedAt: instant, document,
    assertions: [
      { subject: ACTOR, predicate: "urn:emsenn:gemini-notebook:recorded", object: { kind: "iri", value: graph } },
      { subject: graph, predicate: "urn:emsenn:gemini-notebook:category", object: { kind: "literal", value: type } },
    ],
  } });
}
async function witness(activity, outcome, instant, details = {}) {
  const body = { source: ACTOR, type: `org.emsenn.${NODE_ID}.${outcome}`, subject: activity?.id ?? "urn:activity:unidentified", time: instant, data: { activityDigest: semanticId(activity ?? null), ...details } };
  const event = { specversion: "1.0", id: semanticId(body), ...body, datacontenttype: "application/json" };
  await append("events", event, instant);
  await append("eavt", { operationId: body.subject, e: body.subject, a: "activity/outcome", v: outcome, t: event.id }, instant);
  return event;
}
function response(type, source, object) {
  return { "@context": CONTEXT, id: semanticId({ actor: ACTOR, type, inReplyTo: source?.id ?? null, object }), type, actor: ACTOR, target: source?.actor ?? LMT_ACTOR, inReplyTo: source?.id ?? "urn:activity:unidentified", object };
}
function emit(value, code = 0) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); process.exitCode = code; }
async function reject(source, reason, instant, details = {}) {
  const value = response("Reject", source, { type: "Refusal", reason, ...details });
  await witness(source, "activity.rejected", instant, { reason }); emit(value, 2);
}
function attachments(note) {
  if (Array.isArray(note?.attachment)) return note.attachment;
  return note?.attachment === undefined ? [] : [note.attachment];
}
function normalizedRequest(sourceActivity) {
  const attached = attachments(sourceActivity?.object).find((item) => item?.type === "GeminiNotebookSourceReconciliationRequest");
  if (!attached) return null;
  return {
    notebookId: attached.notebookId,
    policy: attached.policy,
    executionMode: attached.executionMode,
    expectedCurrentSourceIds: attached.expectedCurrentSourceIds ?? null,
    desiredSources: attached.desiredSources ?? [],
  };
}
function requestProblems(request) {
  const problems = [];
  if (!request || typeof request.notebookId !== "string" || request.notebookId.trim() === "") problems.push("notebookId");
  if (!request || !["dry-run", "observe-live", "reconcile-live"].includes(request.executionMode)) problems.push("executionMode(dry-run|observe-live|reconcile-live)");
  if (request?.executionMode === "observe-live" && request.policy !== "observe-only") problems.push("observe-live requires policy observe-only");
  if (["dry-run", "reconcile-live"].includes(request?.executionMode) && !["replace-all-staged", "curated-cumulative-add"].includes(request.policy)) problems.push("dry-run and reconcile-live require policy replace-all-staged or curated-cumulative-add");
  if (request?.maxRuntimeSeconds !== undefined) problems.push("maxRuntimeSeconds is retired; customer cancellation owns termination");
  if (request?.executionMode === "reconcile-live") {
    if (!Array.isArray(request.expectedCurrentSourceIds) || request.expectedCurrentSourceIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{5,}$/u.test(id))) problems.push("expectedCurrentSourceIds(full IDs)");
    else if (new Set(request.expectedCurrentSourceIds).size !== request.expectedCurrentSourceIds.length) problems.push("expectedCurrentSourceIds(unique)");
  }
  if (["dry-run", "reconcile-live"].includes(request?.executionMode)) {
    if (!Array.isArray(request.desiredSources) || request.desiredSources.length === 0) problems.push("desiredSources(non-empty)");
    else {
      if (request.desiredSources.length > MAX_SOURCES) problems.push(`desiredSources(maximum ${MAX_SOURCES})`);
      const identities = request.desiredSources.map((source) => source && typeof source === "object" ? canonical({ digest: source.digest, title: source.title ?? null }) : null);
      if (new Set(identities).size !== identities.length) problems.push("desiredSources(unique digest/title identities)");
      let totalBytes = 0;
      for (const [index, source] of request.desiredSources.entries()) {
      if (!source || typeof source !== "object" || typeof source.path !== "string" || !isAbsolute(source.path)) { problems.push(`desiredSources[${index}].path(absolute)`); continue; }
      if (typeof source.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(source.digest)) problems.push(`desiredSources[${index}].digest(sha256)`);
      if (["reconcile-live"].includes(request.executionMode)) {
        if (!existsSync(source.path)) problems.push(`desiredSources[${index}].path(exists)`);
        else {
          const stats = lstatSync(source.path);
          if (!stats.isFile() || stats.isSymbolicLink()) problems.push(`desiredSources[${index}].path(regular-non-symlink)`);
          else {
            totalBytes += stats.size;
            if (stats.size > MAX_SOURCE_BYTES) problems.push(`desiredSources[${index}].bytes(maximum ${MAX_SOURCE_BYTES})`);
            else if (sha256Digest(readFileSync(source.path)) !== source.digest) problems.push(`desiredSources[${index}].digest(matches-file)`);
          }
        }
      }
      if (source.title !== undefined && (typeof source.title !== "string" || source.title.trim() === "")) problems.push(`desiredSources[${index}].title(non-empty)`);
    }
      if (totalBytes > MAX_TOTAL_BYTES) problems.push(`desiredSources(total bytes maximum ${MAX_TOTAL_BYTES})`);
    }
  }
  return problems;
}
function recognizes(sourceActivity) {
  return normalizedRequest(sourceActivity) !== null || /notebook\s*lm.*source|source.*notebook\s*lm/i.test(sourceActivity?.object?.content ?? "");
}
function effectsFor(mode) {
  if (mode === "observe-live") return ["external-network"];
  if (mode === "reconcile-live") return ["external-network", "source-egress", "notebook-source-mutation"];
  return [];
}

async function solicit(activity, instant) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR || activity.object?.type !== "ServiceSolicitation") {
    await reject(activity, "solicitation must be an ActivityStreams Offer<ServiceSolicitation> addressed to this provider", instant); return;
  }
  const sourceActivity = activity.object.sourceActivity;
  if (!recognizes(sourceActivity)) { await reject(activity, "source intent does not request Gemini Notebook source reconciliation", instant); return; }
  const request = normalizedRequest(sourceActivity);
  const missing = requestProblems(request);
  if (missing.length) {
    const question = response("Question", activity, { type: "ServiceTermsRequired", sourceActivity: sourceActivity?.id, missing });
    await witness(activity, "terms.requested", instant, { missing }); emit(question); return;
  }
  const effects = effectsFor(request.executionMode);
  const scope = {
    notebookId: request.notebookId,
    policy: request.policy,
    expectedCurrentSourceSetDigest: request.expectedCurrentSourceIds === null ? null : semanticId([...request.expectedCurrentSourceIds].sort()),
    desiredSourceSetDigest: semanticId(request.desiredSources.map(({ digest: sourceDigest, title }) => ({ digest: sourceDigest, title: title ?? null }))),
  };
  const object = {
    type: "ExecutableServiceOffer", sourceActivity: sourceActivity.id,
    intentSignature: "urn:service-intent:gemini-notebook-stable-source-reconciliation",
    request, requestDigest: semanticId(request), scope, operation: "invoke-source-reconciliation", effects,
    requirements: effects.map((effect) => ({ type: "ResourceGrant", effect })),
    evidence: ["provider-local-reconciliation-receipt", "previous-and-final-source-observations", "mutation-or-refusal-causal-events"],
  };
  const offer = response("Offer", activity, object);
  await witness(activity, "offer.emitted", instant, { offer: offer.id, requestDigest: object.requestDigest }); emit(offer);
}

function validateInvocation(activity) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR) return "invocation must be an ActivityStreams Accept addressed to this provider";
  const contract = activity.object;
  if (contract?.type !== "ServiceContract") return "invocation must accept a ServiceContract";
  const offer = contract.offer;
  if (offer?.type !== "Offer" || offer.actor !== ACTOR || offer.object?.type !== "ExecutableServiceOffer") return "ServiceContract must carry this provider's source-reconciliation Offer";
  const request = offer.object.request;
  if (offer.object.requestDigest !== semanticId(request)) return "accepted request does not match the provider offer digest";
  const changedTerms = requestProblems(request);
  if (changedTerms.length) return `accepted request no longer satisfies provider terms: ${changedTerms.join(", ")}`;
  const capability = contract.capability;
  if (capability?.type !== "Capability" || capability.holder !== ACTOR || capability.invocationTarget !== ACTOR) return "accepted contract requires a capability held by this provider";
  if (capability.parentOffer !== offer.id || capability.attenuation?.requestDigest !== offer.object.requestDigest) return "capability is not attenuated to the accepted offer and request";
  if (canonical(capability.attenuation?.providerScope) !== canonical(offer.object.scope)) return "capability does not preserve the provider-authored reconciliation scope";
  if (!Array.isArray(capability.allowedActions) || !capability.allowedActions.includes("invoke-source-reconciliation")) return "capability does not grant invoke-source-reconciliation";
  for (const effect of offer.object.effects ?? []) if (!capability.allowedActions.includes(effect)) return `capability does not grant required effect ${effect}`;
  return null;
}

async function invoke(activity, instant) {
  const invalid = validateInvocation(activity);
  if (invalid) { await reject(activity, invalid, instant); return; }
  const offer = activity.object.offer;
  const request = offer.object.request;
  const temporary = mkdtempSync(join(tmpdir(), "gemini-notebook-source-contract-"));
  const planPath = join(temporary, "plan.json");
  writeFileSync(planPath, `${JSON.stringify({ ...request, requestDigest: offer.object.requestDigest }, null, 2)}\n`);
  const args = [REALIZER, planPath, "--now", instant, ...(request.executionMode === "dry-run" ? ["--dry-run"] : [])];
  const execution = spawnSync(PYTHON, args, { cwd: NODE_ROOT, encoding: "utf8", maxBuffer: Number.POSITIVE_INFINITY, env: process.env });
  rmSync(temporary, { recursive: true, force: true });
  let realized;
  try { realized = JSON.parse(execution.stdout); } catch { realized = undefined; }
  if (execution.status !== 0 || !realized?.ok) {
    await reject(activity, "source reconciler failed before settling a typed provider result", instant, { status: execution.status, providerDiagnostic: realized?.problems ?? "reconciler-untyped-failure" }); return;
  }
  if (realized.outcome === "refusal") {
    if (realized.receipt) await append("receipts", realized.receipt, instant);
    await reject(activity, realized.receipt?.grounds ?? "Gemini Notebook source reconciliation refused", instant, { reconciliationReceipt: realized.receipt }); return;
  }
  const object = {
    type: "GeminiNotebookSourceReconciliationResult",
    disposition: realized.outcome, sourceActivity: offer.object.sourceActivity,
    requestDigest: offer.object.requestDigest, dryRun: request.executionMode === "dry-run",
    receipt: realized.receipt ?? null,
    observations: request.executionMode === "dry-run" ? { networkCalls: 0, recordsWritten: 0 } : realized.receipt?.cost ?? {},
  };
  const result = response("Accept", activity, object);
  if (realized.receipt) await append("receipts", realized.receipt, instant);
  await witness(activity, "contract.completed", instant, { result: result.id, disposition: object.disposition }); emit(result);
}

const instant = now();
let activity;
try { activity = input(); } catch (error) { await reject({}, `invalid JSON input: ${error.message}`, instant); }
if (activity !== undefined) {
  if (operation() === "solicit-source-reconciliation") await solicit(activity, instant);
  else if (operation() === "invoke-source-reconciliation") await invoke(activity, instant);
  else await reject(activity, `unknown provider operation ${operation()}`, instant);
}
