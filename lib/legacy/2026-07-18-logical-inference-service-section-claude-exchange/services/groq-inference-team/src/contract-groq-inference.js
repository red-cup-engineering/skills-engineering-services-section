#!/usr/bin/env node

// ActivityStreams contract face over this settlement's existing Groq harness.
// This follows the proved NVIDIA sibling pattern while retaining Groq-owned
// packet validation, auth custody, exchange records, and refusal semantics.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const NODE_ID = "groq-inference-team";
const ACTOR = `urn:ame:${NODE_ID}`;
const LMT_ACTOR = "urn:ame:leader-movement-team";
const CONTRACT = "groq-inference-service";
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = join(NODE_ROOT, "run-one-exchange.mjs");

function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function digest(value) { return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
function contentId(value) { return `urn:${digest(value)}`; }
function arg(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function operation() { return arg("--operation") ?? "solicit-service"; }
function now() { return arg("--now") ?? new Date().toISOString(); }
function input() { return JSON.parse(readFileSync(arg("--input-file") ?? 0, "utf8")); }
function dataPath(type, instant) { const day = instant.slice(0, 10); const [year, month, date] = day.split("-"); return join(NODE_ROOT, "data", "journals", type, year, month, date, `${day}-${NODE_ID}-${type}.jsonl`); }
function append(type, value, instant) { const path = dataPath(type, instant); mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8"); }
function witness(activity, outcome, instant, details = {}) { const body = { source: ACTOR, type: `org.emsenn.${NODE_ID}.${outcome}`, subject: activity?.id ?? "urn:activity:unidentified", time: instant, data: { activityDigest: digest(activity ?? null), contract: CONTRACT, ...details } }; const event = { specversion: "1.0", id: contentId(body), ...body, datacontenttype: "application/json" }; append("events", event, instant); append("eavt", { e: body.subject, a: "activity/outcome", v: outcome, t: event.id }, instant); }
function response(type, source, object) { return { "@context": CONTEXT, id: contentId({ actor: ACTOR, type, inReplyTo: source?.id ?? null, object }), type, actor: ACTOR, target: source?.actor ?? LMT_ACTOR, inReplyTo: source?.id ?? "urn:activity:unidentified", object }; }
function emit(value, code = 0) { const output = `${JSON.stringify(value, null, 2)}\n`; const path = arg("--output-file"); if (path) writeFileSync(path, output, "utf8"); else process.stdout.write(output); process.exitCode = code; }
function reject(source, reason, instant, details = {}) { const value = response("Reject", source, { type: "Refusal", contract: CONTRACT, reason, ...details }); witness(source, "activity.rejected", instant, { reason }); emit(value, 2); }
function attachments(note) { return Array.isArray(note?.attachment) ? note.attachment : note?.attachment === undefined ? [] : [note.attachment]; }
function normalizedRequest(sourceActivity) { const request = attachments(sourceActivity?.object).find((item) => item?.type === "GroqInferenceRequest"); return request ? { packet: request.packet, executionMode: request.executionMode ?? "live" } : null; }
function requestProblems(request) {
  const problems = []; const packet = request?.packet;
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) problems.push("packet");
  if (!Array.isArray(packet?.messages) || packet.messages.length === 0) problems.push("packet.messages");
  else for (const [index, message] of packet.messages.entries()) if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content.length === 0) problems.push(`packet.messages[${index}]`);
  if (typeof packet?.model !== "string" || packet.model.length === 0) problems.push("packet.model");
  if (packet?.["max-tokens"] !== undefined && (!Number.isInteger(packet["max-tokens"]) || packet["max-tokens"] < 1)) problems.push("packet.max-tokens");
  if (!request || !["dry-run", "live"].includes(request.executionMode)) problems.push("executionMode(dry-run|live)");
  return [...new Set(problems)];
}
function recognizes(sourceActivity) { const content = sourceActivity?.object?.content; return normalizedRequest(sourceActivity) !== null || (typeof content === "string" && /groq/iu.test(content)); }
function solicit(activity, instant) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR || activity.object?.type !== "ServiceSolicitation") { reject(activity, "solicitation must be an ActivityStreams Offer<ServiceSolicitation> addressed to this provider", instant); return; }
  const sourceActivity = activity.object.sourceActivity;
  if (!recognizes(sourceActivity)) { reject(activity, "source intent does not request Groq inference", instant); return; }
  const request = normalizedRequest(sourceActivity); const missing = requestProblems(request);
  if (missing.length) { const question = response("Question", activity, { type: "ServiceTermsRequired", contract: CONTRACT, sourceActivity: sourceActivity?.id, missing }); witness(activity, "terms.requested", instant, { missing }); emit(question); return; }
  const effects = request.executionMode === "live" ? ["external-network", "groq-inference-account"] : [];
  const scope = { packetDigest: digest(request.packet), model: request.packet.model, messageCount: request.packet.messages.length };
  const inferenceServiceBid = { type: "InferenceServiceBid", provider: ACTOR, requestScopeDigest: digest(scope), model: request.packet.model, availability: "locally-admissible", capacity: { unit: "provider-request-slot", remaining: "unknown", period: "unknown" }, consideration: { denomination: "unknown", maxPerRequest: "unknown", monetary: "unknown" }, qualityEvidence: { kind: "provider-local-exchange-record", reference: "unknown" } };
  const object = { type: "ExecutableServiceOffer", contract: CONTRACT, sourceActivity: sourceActivity.id, intentSignature: "urn:service-intent:groq-bounded-chat-inference", request, requestDigest: digest(request), scope, inferenceServiceBid, operation: "invoke-service", effects, requirements: effects.map((effect) => ({ type: "ResourceGrant", effect })), evidence: ["provider-local-exchange-record", "completion-or-refusal", "provider-local-causal-events"] };
  const offer = response("Offer", activity, object); witness(activity, "offer.emitted", instant, { offer: offer.id, requestDigest: object.requestDigest }); emit(offer);
}
function validateInvocation(activity) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR) return "invocation must be an ActivityStreams Accept addressed to this provider";
  const contract = activity.object; if (contract?.type !== "ServiceContract" || contract.contract !== CONTRACT) return `invocation must accept ${CONTRACT}`;
  const offer = contract.offer; if (offer?.type !== "Offer" || offer.actor !== ACTOR || offer.object?.type !== "ExecutableServiceOffer") return "ServiceContract must carry this provider's executable Offer";
  const request = offer.object.request; if (offer.object.requestDigest !== digest(request)) return "accepted request does not match the provider offer digest";
  const changed = requestProblems(request); if (changed.length) return `accepted request no longer satisfies provider terms: ${changed.join(", ")}`;
  const capability = contract.capability; if (capability?.type !== "Capability" || capability.holder !== ACTOR || capability.invocationTarget !== ACTOR) return "accepted contract requires a capability held by this provider";
  if (capability.parentOffer !== offer.id || capability.attenuation?.requestDigest !== offer.object.requestDigest) return "capability is not attenuated to the accepted offer and request";
  if (canonical(capability.attenuation?.providerScope) !== canonical(offer.object.scope)) return "capability does not preserve the provider-authored packet scope";
  if (!Array.isArray(capability.allowedActions) || !capability.allowedActions.includes("invoke-service")) return "capability does not grant invoke-service";
  for (const effect of offer.object.effects ?? []) if (!capability.allowedActions.includes(effect)) return `capability does not grant required effect ${effect}`;
  return null;
}
function runHarness(packet, dryRun) { const temp = mkdtempSync(join(tmpdir(), "groq-inference-contract-")); const packetPath = join(temp, "packet.json"); const outputPath = join(temp, "result.json"); try { writeFileSync(packetPath, `${JSON.stringify(packet)}\n`, "utf8"); const execution = spawnSync(process.execPath, [HARNESS, packetPath, ...(dryRun ? ["--dry-run"] : []), "--output-file", outputPath], { cwd: NODE_ROOT, encoding: "utf8", timeout: dryRun ? 60_000 : 180_000, env: process.env }); let output; try { output = JSON.parse(readFileSync(outputPath, "utf8")); } catch { output = undefined; } return { execution, output }; } finally { rmSync(temp, { recursive: true, force: true }); } }
function invoke(activity, instant) {
  const invalid = validateInvocation(activity); if (invalid) { reject(activity, invalid, instant); return; }
  const offer = activity.object.offer; const request = offer.object.request;
  const preflight = runHarness(request.packet, true); const preflightResult = preflight.output;
  if (preflight.execution.status !== 0 || !preflightResult?.["packet-valid"]) { reject(activity, "Groq harness failed packet preflight", instant, { providerDiagnostic: (preflight.execution.error?.message || preflight.execution.stderr || preflight.execution.stdout || "").slice(0, 500) }); return; }
  if (request.executionMode === "live" && !Object.values(preflightResult["auth-presence"] ?? {}).some(Boolean)) { reject(activity, "the granted Groq account resource has no credential injected into this provider process", instant, { unmet: ["groq-credential-injection"] }); return; }
  if (request.executionMode === "dry-run") { const object = { type: "GroqInferenceResult", contract: CONTRACT, disposition: "ready", sourceActivity: offer.object.sourceActivity, requestDigest: offer.object.requestDigest, providerExchange: null, observations: { networkCalls: 0, recordsWritten: 0, authPresence: preflightResult["auth-presence"] }, dryRun: true }; witness(activity, "contract.validated", instant, { requestDigest: object.requestDigest }); emit(response("Accept", activity, object)); return; }
  const execution = runHarness(request.packet, false); const harnessResult = execution.output;
  if (execution.execution.status !== 0 || harnessResult === undefined) { reject(activity, "Groq harness failed before settling a typed result", instant, { status: execution.execution.status, providerDiagnostic: (execution.execution.error?.message || execution.execution.stderr || execution.execution.stdout || "").slice(0, 500) }); return; }
  if (harnessResult.outcome === "refusal") { reject(activity, harnessResult.refusal?.grounds ?? "Groq refused the exchange", instant, { providerExchange: harnessResult }); return; }
  const object = { type: "GroqInferenceResult", contract: CONTRACT, disposition: "completion", sourceActivity: offer.object.sourceActivity, requestDigest: offer.object.requestDigest, providerExchange: harnessResult, observations: harnessResult.cost, dryRun: false }; witness(activity, "contract.completed", instant, { requestDigest: object.requestDigest, providerExchange: harnessResult.id }); emit(response("Accept", activity, object));
}

const instant = now(); let activity;
try { activity = input(); } catch (error) { reject({}, `invalid JSON input: ${error.message}`, instant); }
if (activity !== undefined) { if (operation() === "solicit-service") solicit(activity, instant); else if (operation() === "invoke-service") invoke(activity, instant); else reject(activity, `unknown provider operation ${operation()}`, instant); }
