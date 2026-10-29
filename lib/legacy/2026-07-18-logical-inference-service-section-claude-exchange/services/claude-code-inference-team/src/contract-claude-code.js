#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const NODE_ID = "claude-code-inference-team";
const ACTOR = `urn:ame:${NODE_ID}`;
const LMT_ACTOR = "urn:ame:leader-movement-team";
const CONTRACT = "claude-code-inference-service";
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = join(NODE_ROOT, "run-one-exchange.mjs");
const EXCHANGES_ROOT = resolve(NODE_ROOT, "content/exchanges");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value) { return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
function contentId(value) { return `urn:${digest(value)}`; }
function arg(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function operation() { return arg("--operation") ?? "solicit-service"; }
function now() { return arg("--now") ?? new Date().toISOString(); }
function input() { return JSON.parse(readFileSync(arg("--input-file") ?? 0, "utf8")); }
function dataPath(type, instant) {
  const day = instant.slice(0, 10); const [year, month, date] = day.split("-");
  return join(NODE_ROOT, "data", "journals", type, year, month, date, `${day}-${NODE_ID}-${type}.jsonl`);
}
function append(type, value, instant) {
  const path = dataPath(type, instant); mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}
function witness(activity, outcome, instant, details = {}) {
  const body = { source: ACTOR, type: `org.emsenn.${NODE_ID}.${outcome}`, subject: activity?.id ?? "urn:activity:unidentified", time: instant, data: { activityDigest: digest(activity ?? null), contract: CONTRACT, ...details } };
  const event = { specversion: "1.0", id: contentId(body), ...body, datacontenttype: "application/json" };
  append("events", event, instant);
  append("eavt", { e: body.subject, a: "activity/outcome", v: outcome, t: event.id }, instant);
  return event;
}
function response(type, source, object) {
  return { "@context": CONTEXT, id: contentId({ actor: ACTOR, type, inReplyTo: source?.id ?? null, object }), type, actor: ACTOR, target: source?.actor ?? LMT_ACTOR, inReplyTo: source?.id ?? "urn:activity:unidentified", object };
}
function emit(value, code = 0) {
  const output = `${JSON.stringify(value, null, 2)}\n`;
  const outputPath = arg("--output-file");
  if (outputPath) writeFileSync(outputPath, output, "utf8"); else process.stdout.write(output);
  process.exitCode = code;
}
function reject(source, reason, instant, details = {}) {
  const value = response("Reject", source, { type: "Refusal", contract: CONTRACT, reason, ...details });
  witness(source, "activity.rejected", instant, { reason }); emit(value, 2);
}
function attachments(note) {
  if (Array.isArray(note?.attachment)) return note.attachment;
  return note?.attachment === undefined ? [] : [note.attachment];
}
function normalizedRequest(sourceActivity) {
  const request = attachments(sourceActivity?.object).find((item) => item?.type === "ClaudeCodeInferenceRequest");
  if (!request) return null;
  return { packet: request.packet, executionMode: request.executionMode ?? "live" };
}
function requestProblems(request) {
  const problems = [];
  const packet = request?.packet;
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) problems.push("packet");
  if (!Array.isArray(packet?.messages) || packet.messages.length === 0) problems.push("packet.messages");
  else for (const [index, message] of packet.messages.entries()) {
    if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content.length === 0) problems.push(`packet.messages[${index}]`);
  }
  if (packet?.model !== undefined && (typeof packet.model !== "string" || packet.model.length === 0)) problems.push("packet.model");
  if (packet?.["max-tokens"] !== undefined && (!Number.isInteger(packet["max-tokens"]) || packet["max-tokens"] < 1)) problems.push("packet.max-tokens");
  if (packet?.params !== undefined && (!packet.params || typeof packet.params !== "object" || Array.isArray(packet.params))) problems.push("packet.params");
  if (packet?.params?.outputSchema !== undefined && (!packet.params.outputSchema || typeof packet.params.outputSchema !== "object" || Array.isArray(packet.params.outputSchema))) problems.push("packet.params.outputSchema");
  else if (packet?.params?.outputSchema !== undefined && Buffer.byteLength(JSON.stringify(packet.params.outputSchema), "utf8") > 32_768) problems.push("packet.params.outputSchema(max-32768-bytes)");
  if (!["dry-run", "live"].includes(request?.executionMode)) problems.push("executionMode(dry-run|live)");
  return [...new Set(problems)];
}
function recognizes(sourceActivity) {
  const content = sourceActivity?.object?.content;
  return typeof content === "string" && /claude|sonnet|opus|haiku/iu.test(content);
}

function projectExchange(record, recordPath) {
  return {
    id: record.id,
    outcome: record.outcome,
    recordPath,
    packetDigest: digest(record.packet),
    cost: record.cost,
    ...(record.refusal === undefined ? {} : { refusal: record.refusal }),
    ...(record.completion === undefined ? {} : { completion: {
      model: record.completion.model,
      text: record.completion.text,
      "finish-reason": record.completion["finish-reason"],
      ...(record.completion.raw?.structured_output === undefined ? {} : { structuredOutput: record.completion.raw.structured_output }),
      usage: record.completion.raw?.usage,
      modelUsage: record.completion.raw?.modelUsage,
      terminalReason: record.completion.raw?.terminal_reason,
    } }),
  };
}

function settledCompletion(packet) {
  const expected = digest(packet);
  if (!readdirSync(EXCHANGES_ROOT, { withFileTypes: true }).some((entry) => entry.isFile())) return undefined;
  for (const entry of readdirSync(EXCHANGES_ROOT, { withFileTypes: true }).filter((item) => item.isFile() && item.name.endsWith(".json")).sort((a, b) => b.name.localeCompare(a.name))) {
    const recordPath = join(EXCHANGES_ROOT, entry.name);
    try {
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      if (record.outcome === "completion" && digest(record.packet) === expected) return projectExchange(record, recordPath);
    } catch { /* an unreadable record is not reusable evidence */ }
  }
  return undefined;
}

function solicit(activity, instant) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR || activity.object?.type !== "ServiceSolicitation") {
    reject(activity, "solicitation must be an ActivityStreams Offer<ServiceSolicitation> addressed to this provider", instant); return;
  }
  const sourceActivity = activity.object.sourceActivity;
  if (!recognizes(sourceActivity) && normalizedRequest(sourceActivity) === null) {
    reject(activity, "source intent does not request Claude Code inference", instant); return;
  }
  const request = normalizedRequest(sourceActivity);
  const missing = requestProblems(request);
  if (missing.length) {
    const question = response("Question", activity, { type: "ServiceTermsRequired", contract: CONTRACT, sourceActivity: sourceActivity?.id, missing });
    witness(activity, "terms.requested", instant, { missing }); emit(question); return;
  }
  const effects = request.executionMode === "live" ? ["external-network", "leader-inference-account"] : [];
  const scope = { packetDigest: digest(request.packet), model: request.packet.model ?? "claude-opus-4-8", messageCount: request.packet.messages.length };
  const inferenceServiceBid = { type: "InferenceServiceBid", provider: ACTOR, requestScopeDigest: digest(scope), model: scope.model, availability: "unknown", capacity: { unit: "provider-request-slot", remaining: "unknown", period: "unknown" }, consideration: { denomination: "unknown", maxPerRequest: "unknown", monetary: "unknown" }, qualityEvidence: { kind: "provider-local-exchange-record", reference: "unknown" } };
  const object = {
    type: "ExecutableServiceOffer",
    contract: CONTRACT,
    sourceActivity: sourceActivity.id,
    intentSignature: "urn:service-intent:claude-code-bounded-text-inference",
    request,
    requestDigest: digest(request),
    scope, inferenceServiceBid,
    operation: "invoke-service",
    effects,
    requirements: effects.map((effect) => ({ type: "ResourceGrant", effect })),
    evidence: ["provider-local-exchange-record", "completion-or-refusal", "provider-local-causal-events"],
  };
  const offer = response("Offer", activity, object);
  witness(activity, "offer.emitted", instant, { offer: offer.id, requestDigest: object.requestDigest }); emit(offer);
}

function validateInvocation(activity) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR) return "invocation must be an ActivityStreams Accept addressed to this provider";
  const contract = activity.object;
  if (contract?.type !== "ServiceContract" || contract.contract !== CONTRACT) return `invocation must accept ${CONTRACT}`;
  const offer = contract.offer;
  if (offer?.type !== "Offer" || offer.actor !== ACTOR || offer.object?.type !== "ExecutableServiceOffer") return "ServiceContract must carry this provider's executable Offer";
  const request = offer.object.request;
  if (offer.object.requestDigest !== digest(request)) return "accepted request does not match the provider offer digest";
  const changedTerms = requestProblems(request);
  if (changedTerms.length) return `accepted request no longer satisfies provider terms: ${changedTerms.join(", ")}`;
  const capability = contract.capability;
  if (capability?.type !== "Capability" || capability.holder !== ACTOR || capability.invocationTarget !== ACTOR) return "accepted contract requires a capability held by this provider";
  if (capability.parentOffer !== offer.id || capability.attenuation?.requestDigest !== offer.object.requestDigest) return "capability is not attenuated to the accepted offer and request";
  if (canonical(capability.attenuation?.providerScope) !== canonical(offer.object.scope)) return "capability does not preserve the provider-authored packet scope";
  if (!Array.isArray(capability.allowedActions) || !capability.allowedActions.includes("invoke-service")) return "capability does not grant invoke-service";
  for (const effect of offer.object.effects ?? []) if (!capability.allowedActions.includes(effect)) return `capability does not grant required effect ${effect}`;
  return null;
}

function invoke(activity, instant) {
  const invalid = validateInvocation(activity);
  if (invalid) { reject(activity, invalid, instant); return; }
  const offer = activity.object.offer;
  const request = offer.object.request;
  if (request.executionMode === "live") {
    const reused = settledCompletion(request.packet);
    if (reused !== undefined) {
      const object = {
        type: "ClaudeCodeInferenceResult", contract: CONTRACT, disposition: "completion",
        sourceActivity: offer.object.sourceActivity, requestDigest: offer.object.requestDigest,
        providerExchange: reused,
        observations: { "fuel-consumed": 0, "wall-time-seconds": 0, denomination: "claude-code-cli-invocations", reused: true },
        dryRun: false,
      };
      const result = response("Accept", activity, object);
      witness(activity, "contract.completed", instant, { result: result.id, disposition: object.disposition, reusedExchange: reused.id }); emit(result); return;
    }
  }
  const temp = mkdtempSync(join(tmpdir(), "claude-code-contract-"));
  const packetPath = join(temp, "packet.json");
  const harnessOutputPath = join(temp, "harness-response.json");
  writeFileSync(packetPath, `${JSON.stringify(request.packet)}\n`, "utf8");
  const args = [HARNESS, packetPath, "--output-file", harnessOutputPath, ...(request.executionMode === "dry-run" ? ["--dry-run"] : [])];
  const execution = spawnSync(process.execPath, args, { cwd: NODE_ROOT, encoding: "utf8", timeout: request.executionMode === "dry-run" ? 60_000 : 920_000, env: process.env });
  let harnessResult;
  try { harnessResult = JSON.parse(readFileSync(harnessOutputPath, "utf8")); } catch { harnessResult = undefined; }
  rmSync(temp, { recursive: true, force: true });
  if (execution.status !== 0 || harnessResult === undefined) {
    reject(activity, "Claude Code harness failed before settling a typed provider result", instant, { status: execution.status, providerDiagnostic: (execution.stderr || "").slice(0, 500) }); return;
  }
  let providerExchange = harnessResult;
  if (request.executionMode === "live") {
    const recordPath = typeof harnessResult.recordPath === "string" ? resolve(harnessResult.recordPath) : "";
    if (!recordPath.startsWith(`${EXCHANGES_ROOT}/`)) {
      reject(activity, "Claude Code harness returned no provider-owned exchange locator", instant); return;
    }
    let record;
    try { record = JSON.parse(readFileSync(recordPath, "utf8")); }
    catch { reject(activity, "Claude Code provider could not read its settled exchange record", instant); return; }
    providerExchange = projectExchange(record, recordPath);
  }
  if (request.executionMode === "live" && providerExchange.outcome === "refusal") {
    reject(activity, providerExchange.refusal?.grounds ?? "Claude Code refused the exchange", instant, { providerExchange }); return;
  }
  const object = {
    type: "ClaudeCodeInferenceResult",
    contract: CONTRACT,
    disposition: request.executionMode === "dry-run" ? "ready" : "completion",
    sourceActivity: offer.object.sourceActivity,
    requestDigest: offer.object.requestDigest,
    providerExchange: request.executionMode === "dry-run" ? null : providerExchange,
    observations: request.executionMode === "dry-run" ? { networkCalls: 0, recordsWritten: 0 } : providerExchange.cost,
    dryRun: request.executionMode === "dry-run",
  };
  const result = response("Accept", activity, object);
  witness(activity, "contract.completed", instant, { result: result.id, disposition: object.disposition }); emit(result);
}

const instant = now();
let activity;
try { activity = input(); } catch (error) { reject({}, `invalid JSON input: ${error.message}`, instant); }
if (activity !== undefined) {
  if (operation() === "solicit-service") solicit(activity, instant);
  else if (operation() === "invoke-service") invoke(activity, instant);
  else reject(activity, `unknown provider operation ${operation()}`, instant);
}
