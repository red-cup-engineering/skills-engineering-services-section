#!/usr/bin/env node

// ActivityStreams contract face over the existing Google AI Studio harness.
// The provider owns packet validation, auth presence checks, network use, and
// exchange records; callers receive only a bounded offer or typed settlement.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const NODE_ID = "gemini-inference-team";
const ACTOR = `urn:ame:${NODE_ID}`;
const CONTRACT = "gemini-inference-service";
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = join(NODE_ROOT, "run-one-exchange.mjs");

function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function digest(value) { return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
function id(value) { return `urn:${digest(value)}`; }
function arg(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function attachments(note) { return Array.isArray(note?.attachment) ? note.attachment : note?.attachment === undefined ? [] : [note.attachment]; }
function response(type, source, object) { return { "@context": CONTEXT, id: id({ actor: ACTOR, type, inReplyTo: source?.id ?? null, object }), type, actor: ACTOR, target: source?.actor ?? "urn:actor:unknown", inReplyTo: source?.id ?? "urn:activity:unknown", object }; }
function emit(value, code = 0) { const bytes = `${JSON.stringify(value, null, 2)}\n`; const path = arg("--output-file"); if (path === undefined) process.stdout.write(bytes); else writeFileSync(path, bytes, "utf8"); process.exitCode = code; }
function dataPath(instant) { const day = instant.slice(0, 10); const [year, month, date] = day.split("-"); return join(NODE_ROOT, "data/journals/events", year, month, date, `${day}-${NODE_ID}-events.jsonl`); }
function witness(source, outcome, instant, detail = {}) { const path = dataPath(instant); mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify({ specversion: "1.0", id: id({ source: source?.id, outcome, instant, detail }), source: ACTOR, type: `org.emsenn.${NODE_ID}.${outcome}`, subject: source?.id ?? "urn:activity:unknown", time: instant, data: { contract: CONTRACT, activityDigest: digest(source ?? null), ...detail } })}\n`, "utf8"); }
function reject(source, reason, instant, detail = {}) { const value = response("Reject", source, { type: "Refusal", contract: CONTRACT, reason, ...detail }); witness(source, "activity.rejected", instant, { reason }); emit(value, 2); }
function requestFrom(source) { const found = attachments(source?.object).find((item) => item?.type === "GeminiInferenceRequest"); return found === undefined ? null : { packet: found.packet, executionMode: found.executionMode ?? "live" }; }
function requestProblems(request) { const packet = request?.packet; const problems = []; if (!packet || typeof packet !== "object" || Array.isArray(packet)) problems.push("packet"); if (typeof packet?.model !== "string" || packet.model === "") problems.push("packet.model"); if (!Array.isArray(packet?.messages) || packet.messages.length === 0) problems.push("packet.messages"); else for (const [index, message] of packet.messages.entries()) if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content === "") problems.push(`packet.messages[${index}]`); if (packet?.["max-tokens"] !== undefined && (!Number.isInteger(packet["max-tokens"]) || packet["max-tokens"] < 1)) problems.push("packet.max-tokens"); if (!request || !["dry-run", "live"].includes(request.executionMode)) problems.push("executionMode"); return [...new Set(problems)]; }
function runHarness(packet, dryRun) { const temp = mkdtempSync(join(tmpdir(), "gemini-inference-contract-")); const packetPath = join(temp, "packet.json"); try { writeFileSync(packetPath, `${JSON.stringify(packet)}\n`, "utf8"); const execution = spawnSync(process.execPath, [HARNESS, packetPath, ...(dryRun ? ["--dry-run"] : [])], { cwd: NODE_ROOT, encoding: "utf8", timeout: dryRun ? 60_000 : 180_000, env: process.env }); let output; try { output = JSON.parse(execution.stdout); } catch { output = undefined; } return { execution, output }; } finally { rmSync(temp, { recursive: true, force: true }); } }

function solicit(activity, instant) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR || activity.object?.type !== "ServiceSolicitation") return reject(activity, "solicitation must be an ActivityStreams Offer<ServiceSolicitation> addressed to this provider", instant);
  const source = activity.object.sourceActivity; const request = requestFrom(source); const missing = requestProblems(request);
  if (request === null) return reject(activity, "source intent does not request Gemini inference", instant);
  if (missing.length > 0) return emit(response("Question", activity, { type: "ServiceTermsRequired", contract: CONTRACT, missing }));
  const effects = request.executionMode === "live" ? ["external-network", "gemini-inference-account"] : [];
  const scope = { packetDigest: digest(request.packet), model: request.packet.model, messageCount: request.packet.messages.length };
  const inferenceServiceBid = { type: "InferenceServiceBid", provider: ACTOR, requestScopeDigest: digest(scope), model: request.packet.model, availability: "locally-admissible", capacity: { unit: "provider-request-slot", remaining: "unknown", period: "unknown" }, consideration: { denomination: "unknown", maxPerRequest: "unknown", monetary: "unknown" }, qualityEvidence: { kind: "provider-local-exchange-record", reference: "unknown" } };
  const object = { type: "ExecutableServiceOffer", contract: CONTRACT, sourceActivity: source.id, request, requestDigest: digest(request), scope, inferenceServiceBid, operation: "invoke-service", effects, requirements: effects.map((effect) => ({ type: "ResourceGrant", effect })) };
  const offer = response("Offer", activity, object); witness(activity, "offer.emitted", instant, { offer: offer.id }); emit(offer);
}

function invocationProblem(activity) {
  const contract = activity?.object; const offer = contract?.offer; const capability = contract?.capability;
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR) return "invocation must be an ActivityStreams Accept addressed to this provider";
  if (contract?.type !== "ServiceContract" || contract.contract !== CONTRACT || offer?.actor !== ACTOR || offer.object?.type !== "ExecutableServiceOffer") return `invocation must accept ${CONTRACT}`;
  if (offer.object.requestDigest !== digest(offer.object.request) || requestProblems(offer.object.request).length > 0) return "accepted request changed or is no longer admissible";
  if (capability?.type !== "Capability" || capability.holder !== ACTOR || capability.invocationTarget !== ACTOR || capability.parentOffer !== offer.id || capability.attenuation?.requestDigest !== offer.object.requestDigest || canonical(capability.attenuation?.providerScope) !== canonical(offer.object.scope)) return "accepted contract lacks the exact provider capability";
  for (const effect of offer.object.effects ?? []) if (!capability.allowedActions?.includes(effect)) return `capability does not grant ${effect}`;
  return undefined;
}

function invoke(activity, instant) {
  const problem = invocationProblem(activity); if (problem !== undefined) return reject(activity, problem, instant);
  const offer = activity.object.offer; const request = offer.object.request; const preflight = runHarness(request.packet, true); const preflightResult = preflight.output;
  if (preflight.execution.status !== 0 || preflightResult?.["packet-valid"] !== true) return reject(activity, "Gemini harness failed packet preflight", instant);
  if (request.executionMode === "live" && !Object.values(preflightResult["auth-presence"] ?? {}).some(Boolean)) return reject(activity, "the granted Gemini account resource has no credential injected into this provider process", instant, { unmet: ["gemini-credential-injection"] });
  if (request.executionMode === "dry-run") return emit(response("Accept", activity, { type: "GeminiInferenceResult", contract: CONTRACT, disposition: "ready", sourceActivity: offer.object.sourceActivity, requestDigest: offer.object.requestDigest, providerExchange: null, observations: { networkCalls: 0, recordsWritten: 0, authPresence: preflightResult["auth-presence"] }, dryRun: true }));
  const execution = runHarness(request.packet, false); const result = execution.output;
  if (execution.execution.status !== 0 || result === undefined) return reject(activity, "Gemini harness failed before settling a typed result", instant, { providerDiagnostic: (execution.execution.error?.message || execution.execution.stderr || execution.execution.stdout || "").slice(0, 500) });
  if (result.outcome === "refusal") return reject(activity, result.refusal?.grounds ?? "Gemini refused the exchange", instant, { providerExchange: result });
  const object = { type: "GeminiInferenceResult", contract: CONTRACT, disposition: "completion", sourceActivity: offer.object.sourceActivity, requestDigest: offer.object.requestDigest, providerExchange: result, observations: result.cost, dryRun: false };
  witness(activity, "contract.completed", instant, { providerExchange: result.id }); emit(response("Accept", activity, object));
}

const instant = arg("--now") ?? new Date().toISOString(); let activity;
try { activity = JSON.parse(readFileSync(arg("--input-file") ?? 0, "utf8")); } catch (error) { reject({}, `invalid JSON input: ${error.message}`, instant); }
if (activity !== undefined) { const operation = arg("--operation") ?? "solicit-service"; if (operation === "solicit-service") solicit(activity, instant); else if (operation === "invoke-service") invoke(activity, instant); else reject(activity, `unknown provider operation ${operation}`, instant); }
