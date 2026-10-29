#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBidCompatibility, evaluateSufficiency, routePlan, TIER_CATALOG, validateInferenceServiceBid, validateRoutedRequest } from "./routing-law.mjs";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const NODE_ID = "logical-inference-service-section";
const ACTOR = `urn:ame:${NODE_ID}`;
const LMT_ACTOR = "urn:ame:leader-movement-team";
const CONTRACT = "liss-inference-service";
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDERS = Object.freeze({
  "groq-inference-team": resolve(NODE_ROOT, "services/groq-inference-team"),
  "nvidia-inference-team": resolve(NODE_ROOT, "services/nvidia-inference-team"),
  "claude-code-inference-team": resolve(NODE_ROOT, "services/claude-code-inference-team")
});

function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function digest(value) { return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
function contentId(value) { return `urn:${digest(value)}`; }
function arg(flag) { const index = process.argv.indexOf(flag); return index === -1 ? undefined : process.argv[index + 1]; }
function operation() { return arg("--operation") ?? "solicit-service"; }
function now() { return arg("--now") ?? new Date().toISOString(); }
function input() { return JSON.parse(readFileSync(arg("--input-file") ?? 0, "utf8")); }
function attachments(note) { return Array.isArray(note?.attachment) ? note.attachment : note?.attachment === undefined ? [] : [note.attachment]; }
function response(type, source, object) { return { "@context": CONTEXT, id: contentId({ actor: ACTOR, type, inReplyTo: source?.id ?? null, object }), type, actor: ACTOR, target: source?.actor ?? LMT_ACTOR, inReplyTo: source?.id ?? "urn:activity:unidentified", object }; }
function emit(value, code = 0) { const output = `${JSON.stringify(value, null, 2)}\n`; const path = arg("--output-file"); if (path) writeFileSync(path, output, "utf8"); else process.stdout.write(output); process.exitCode = code; }
function datedPath(type, instant) { const day = instant.slice(0, 10); const [year, month, date] = day.split("-"); return join(NODE_ROOT, "data", "journals", type, year, month, date, `${day}-${NODE_ID}-${type}.jsonl`); }
function append(type, value, instant) { const path = datedPath(type, instant); mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8"); }
function witness(activity, outcome, instant, details = {}) {
  const body = { source: ACTOR, type: `org.emsenn.${NODE_ID}.${outcome}`, subject: activity?.id ?? "urn:activity:unidentified", time: instant, data: { activityDigest: digest(activity ?? null), contract: CONTRACT, ...details } };
  const event = { specversion: "1.0", id: contentId(body), ...body, datacontenttype: "application/json" }; append("events", event, instant); append("eavt", { e: body.subject, a: "activity/outcome", v: outcome, t: event.id }, instant); return event;
}
function reject(source, reason, instant, details = {}) { const value = response("Reject", source, { type: "Refusal", contract: CONTRACT, reason, ...details }); witness(source, "activity.rejected", instant, { reason }); emit(value, 2); }
function normalizedRequest(sourceActivity) {
  const supplied = attachments(sourceActivity?.object).find((item) => item?.type === "RoutedInferenceRequest"); if (!supplied) return null;
  return { messages: supplied.messages, admissibleTiers: supplied.admissibleTiers, models: supplied.models ?? {}, sufficiency: supplied.sufficiency, maxTokens: supplied.maxTokens, executionMode: supplied.executionMode ?? "live", ...(supplied.outputSchema === undefined ? {} : { outputSchema: supplied.outputSchema }), ...(supplied.marketConstraints === undefined ? {} : { marketConstraints: supplied.marketConstraints }) };
}
function recognizes(sourceActivity) { return normalizedRequest(sourceActivity) !== null; }
function solicit(activity, instant) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR || activity.object?.type !== "ServiceSolicitation") { reject(activity, "solicitation must be an ActivityStreams Offer<ServiceSolicitation> addressed to this section", instant); return; }
  const sourceActivity = activity.object.sourceActivity; if (!recognizes(sourceActivity)) { reject(activity, "source intent does not carry a RoutedInferenceRequest", instant); return; }
  const request = normalizedRequest(sourceActivity); const missing = validateRoutedRequest(request);
  if (missing.length) { const question = response("Question", activity, { type: "ServiceTermsRequired", contract: CONTRACT, sourceActivity: sourceActivity?.id, missing }); witness(activity, "terms.requested", instant, { missing }); emit(question); return; }
  const requested = routePlan(request); const pseudoOffer = { id: contentId({ source: sourceActivity.id, request }), object: { request } }; const candidates = requested.map((step) => { const source = childSourceActivity(pseudoOffer, step.tier, step); const solicitationObject = { type: "ServiceSolicitation", demand: contentId({ source: source.id }), sourceActivity: source, requestedEvidence: ["provider-authored-contract", "provider-owned-result", "provider-authored-bid"] }; const solicitation = { "@context": CONTEXT, id: contentId({ actor: ACTOR, target: source.target, solicitationObject }), type: "Offer", actor: ACTOR, target: source.target, object: solicitationObject }; const called = invokeProvider(PROVIDERS[step.provider], "solicit-service", solicitation, instant, 30000); const offer = called.output?.type === "Offer" && called.output.actor === `urn:ame:${step.provider}` && called.output.object?.sourceActivity === source.id ? called.output : null; const bid = offer?.object?.inferenceServiceBid; const bidProblems = offer ? validateInferenceServiceBid(step, bid) : ["provider-offer-unavailable"]; const compatibility = bidProblems.length ? { compatible: false, reasons: bidProblems } : evaluateBidCompatibility(bid, request.marketConstraints ?? {}); return { tier: step.tier, provider: step.provider, childSourceActivity: source, childOffer: offer, childOfferDigest: offer ? digest(offer) : null, bid: bid ?? null, bidDigest: bid ? digest(bid) : null, compatibility, refusal: offer ? null : called.output, diagnostic: called.diagnostic }; });
  const plan = candidates.filter((candidate) => candidate.compatibility.compatible).map(({ tier, provider, bid }) => ({ ...requested.find((step) => step.tier === tier), bidDigest: digest(bid) })); if (!plan.length) { const question = response("Question", activity, { type: "NoCompatibleInferenceBid", contract: CONTRACT, candidates }); witness(activity, "terms.unavailable", instant, { candidates: candidates.length }); emit(question); return; }
  const effects = request.executionMode === "live" ? [...new Set(plan.flatMap((step) => step.effects))].sort() : [];
  const object = { type: "ExecutableServiceOffer", contract: CONTRACT, sourceActivity: sourceActivity.id, intentSignature: "urn:service-intent:finite-compatible-forward-inference", request, requestDigest: digest(request), scope: { plan, candidates, sufficiencyDigest: digest(request.sufficiency), frozenChildOfferEvidence: true }, operation: "invoke-service", effects, requirements: effects.map((effect) => ({ type: "ResourceGrant", effect })), evidence: ["finite-forward-route", "provider-authored-bids-frozen-at-solicitation", "frozen-child-offer-invocation", "consideration-not-comparable-no-cheapest-claim", "provider-failure-is-not-sufficiency"] };
  const offer = response("Offer", activity, object); witness(activity, "offer.emitted", instant, { offer: offer.id, requestDigest: object.requestDigest, plan }); emit(offer);
}
function validateInvocation(activity) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR) return "invocation must be an ActivityStreams Accept addressed to this section";
  const contract = activity.object; if (contract?.type !== "ServiceContract" || contract.contract !== CONTRACT) return `invocation must accept ${CONTRACT}`;
  const offer = contract.offer; if (offer?.type !== "Offer" || offer.actor !== ACTOR || offer.object?.type !== "ExecutableServiceOffer") return "ServiceContract must carry this section's executable Offer";
  const request = offer.object.request; if (offer.object.requestDigest !== digest(request)) return "accepted request does not match the section offer digest";
  const problems = validateRoutedRequest(request); if (problems.length) return `accepted request no longer satisfies route terms: ${problems.join(", ")}`;
  const capability = contract.capability; if (capability?.type !== "Capability" || capability.holder !== ACTOR || capability.invocationTarget !== ACTOR) return "accepted contract requires a capability held by this section";
  if (capability.parentOffer !== offer.id || capability.attenuation?.requestDigest !== offer.object.requestDigest) return "capability is not attenuated to the accepted offer and request";
  if (canonical(capability.attenuation?.providerScope) !== canonical(offer.object.scope)) return "capability does not preserve the provider-authored route scope";
  if (!Array.isArray(capability.allowedActions) || !capability.allowedActions.includes("invoke-service")) return "capability does not grant invoke-service";
  for (const effect of offer.object.effects ?? []) if (!capability.allowedActions.includes(effect)) return `capability does not grant required effect ${effect}`;
  return null;
}
function invokeProvider(root, operationName, value, instant, timeout) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); const endpoint = pkg.bin?.[operationName];
  if (typeof endpoint !== "string") return { status: 2, output: null, diagnostic: `${pkg.name} does not advertise ${operationName}` };
  const temp = mkdtempSync(join(tmpdir(), "liss-provider-invocation-")); const inputPath = join(temp, "request.json"); const outputPath = join(temp, "response.json");
  try {
    writeFileSync(inputPath, `${JSON.stringify(value)}\n`, "utf8");
    const execution = spawnSync(process.execPath, [resolve(root, endpoint), "--operation", operationName, "--now", instant, "--input-file", inputPath, "--output-file", outputPath], { cwd: root, encoding: "utf8", timeout, env: process.env });
    let output; try { output = JSON.parse(readFileSync(outputPath, "utf8")); } catch { output = null; }
    return { status: execution.status, output, diagnostic: execution.error?.message || execution.stderr || (output ? null : execution.stdout) };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
function childSourceActivity(parentOffer, tier, step) {
  const catalog = TIER_CATALOG[step.tier]; const packet = { model: step.model, messages: parentOffer.object.request.messages, ...(parentOffer.object.request.maxTokens ? { "max-tokens": parentOffer.object.request.maxTokens } : {}), ...(parentOffer.object.request.outputSchema === undefined ? {} : { params: { outputSchema: parentOffer.object.request.outputSchema } }) };
  const attachment = { type: catalog.requestType, packet, executionMode: parentOffer.object.request.executionMode };
  const object = { type: "Note", content: `Execute routed inference tier ${step.tier} through ${step.provider}.`, attachment };
  return { "@context": CONTEXT, id: contentId({ parentOffer: parentOffer.id, tier, object }), type: "Create", actor: ACTOR, target: `urn:ame:${step.provider}`, object };
}
function childContract(source, step, offer) {
  const allowedActions = ["invoke-service", ...(offer.object.effects ?? [])];
  const capability = { id: contentId({ source: source.id, offer: offer.id, allowedActions }), type: "Capability", issuer: ACTOR, holder: offer.actor, invocationTarget: offer.actor, parentOffer: offer.id, allowedActions, attenuation: { sourceActivity: source.id, requestDigest: offer.object.requestDigest, effects: offer.object.effects, providerScope: offer.object.scope ?? {}, customerTerritoryMutation: false }, capTP: { target: offer.actor, method: offer.object.operation }, grantSource: source.id };
  const object = { type: "ServiceContract", contract: offer.object.contract, demand: contentId({ source: source.id, step }), offer, capability };
  return { "@context": CONTEXT, id: contentId({ actor: ACTOR, target: offer.actor, object }), type: "Accept", actor: ACTOR, target: offer.actor, inReplyTo: offer.id, object };
}
function frozenCandidate(planStep, candidates) { const candidate = candidates?.find((item) => item?.tier === planStep.tier && item?.provider === planStep.provider); if (!candidate || !candidate.childOffer || !candidate.childSourceActivity) return { error: "missing frozen child offer/source" }; if (candidate.childOfferDigest !== digest(candidate.childOffer) || candidate.bidDigest !== digest(candidate.bid)) return { error: "frozen child offer or bid digest mismatch" }; if (candidate.childOffer.actor !== `urn:ame:${planStep.provider}` || candidate.childOffer.object?.sourceActivity !== candidate.childSourceActivity.id) return { error: "frozen child offer identity/source mismatch" }; if (candidate.childSourceActivity.target !== `urn:ame:${planStep.provider}` || candidate.childOffer.object?.scope?.model !== planStep.model) return { error: "frozen child model/provider mismatch" }; const bidProblems = validateInferenceServiceBid(planStep, candidate.bid); if (bidProblems.length || !candidate.compatibility?.compatible) return { error: `frozen child bid incompatible: ${bidProblems.join(",")}` }; if (canonical(candidate.childOffer.object?.effects ?? []) !== canonical(planStep.effects ?? [])) return { error: "frozen child effects mismatch" }; return { candidate }; }
function completionText(providerResult) { return providerResult?.object?.providerExchange?.completion?.text; }
function completionStructuredOutput(providerResult) { return providerResult?.object?.providerExchange?.completion?.structuredOutput; }
function invoke(activity, instant) {
  const invalid = validateInvocation(activity); if (invalid) { reject(activity, invalid, instant); return; }
  const parentOffer = activity.object.offer; const request = parentOffer.object.request; const plan = parentOffer.object.scope.plan; const candidates = parentOffer.object.scope.candidates;
  if (request.executionMode === "dry-run") {
    const object = { type: "RoutedInferenceResult", contract: CONTRACT, disposition: "ready", sourceActivity: parentOffer.object.sourceActivity, requestDigest: parentOffer.object.requestDigest, plan, attempts: [], dryRun: true };
    witness(activity, "contract.validated", instant, { requestDigest: object.requestDigest }); emit(response("Accept", activity, object)); return;
  }
  const attempts = [];
  for (const step of plan) {
    const frozen = frozenCandidate(step, candidates); if (frozen.error) { reject(activity, `frozen provider evidence invalid: ${frozen.error}`, instant); return; }
    const providerRoot = PROVIDERS[step.provider]; const source = frozen.candidate.childSourceActivity; const contract = childContract(source, step, frozen.candidate.childOffer); const invoked = invokeProvider(providerRoot, "invoke-service", contract, instant, step.tier === "leader-claude" ? 1000000 : 180000);
    if (invoked.output?.type !== "Accept" || invoked.output.object?.dryRun === true) {
      const attempt = { tier: step.tier, provider: step.provider, disposition: "provider-refusal", providerResult: invoked.output, diagnostic: invoked.diagnostic };
      attempts.push(attempt); append("routing-attempts", { ...attempt, sourceActivity: parentOffer.object.sourceActivity, requestDigest: parentOffer.object.requestDigest, recordedAt: instant }, instant);
      reject(activity, "a provider refusal or resource failure is not an output-sufficiency observation; automatic escalation is refused", instant, { attempts, failedTier: step.tier }); return;
    }
    const text = completionText(invoked.output); const sufficiency = evaluateSufficiency(text, request.sufficiency); const sufficient = sufficiency.every((item) => item.satisfied);
    const attempt = { tier: step.tier, provider: step.provider, disposition: sufficient ? "sufficient" : "insufficient", providerResult: invoked.output, outputDigest: digest(text), sufficiency };
    attempts.push(attempt); append("routing-attempts", { ...attempt, sourceActivity: parentOffer.object.sourceActivity, requestDigest: parentOffer.object.requestDigest, recordedAt: instant }, instant);
    if (sufficient) {
      const structuredOutput = completionStructuredOutput(invoked.output);
      if (request.outputSchema !== undefined && (!structuredOutput || typeof structuredOutput !== "object" || Array.isArray(structuredOutput))) {
        reject(activity, "the selected provider returned no validated structured tool choice", instant, { attempts, failedTier: step.tier }); return;
      }
      const object = { type: "RoutedInferenceResult", contract: CONTRACT, disposition: "completion", sourceActivity: parentOffer.object.sourceActivity, requestDigest: parentOffer.object.requestDigest, selectedTier: step.tier, selectedProvider: step.provider, text, ...(structuredOutput === undefined ? {} : { structuredOutput }), attempts, dryRun: false };
      witness(activity, "contract.completed", instant, { selectedTier: step.tier, attempts: attempts.length, requestDigest: object.requestDigest }); emit(response("Accept", activity, object)); return;
    }
  }
  reject(activity, "PCS_TIER_ESCALATION_DENIED: no admissible tier satisfied the declared output predicates", instant, { attempts });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const instant = now(); let activity;
  try { activity = input(); } catch (error) { reject({}, `invalid JSON input: ${error.message}`, instant); }
  if (activity !== undefined) {
    if (operation() === "solicit-service") solicit(activity, instant);
    else if (operation() === "invoke-service") invoke(activity, instant);
    else reject(activity, `unknown provider operation ${operation()}`, instant);
  }
}
