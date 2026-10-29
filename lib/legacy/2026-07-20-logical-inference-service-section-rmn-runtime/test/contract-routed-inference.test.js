import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";
import { evaluateBidCompatibility, evaluateSufficiency, jsonObjectEnvelope, providerFailureDisposition, routeEffects, routePlan, validateInferenceServiceBid, validateRoutedRequest } from "../src/routing-law.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_LMT = resolve(ROOT, "../../../../../board-of-directors/services/executive-office/services/leader-movement-team");
const NOW = "2099-07-17T12:00:00.000Z";
const CONTEXT = "https://www.w3.org/ns/activitystreams";
let base; let lmtRoot;
function cleanup() { for (const type of ["events", "eavt", "routing-attempts"]) rmSync(join(ROOT, "data", "journals", type, "2099"), { recursive: true, force: true }); }
test.beforeEach(() => { cleanup(); base = mkdtempSync(join(tmpdir(), "liss-route-")); lmtRoot = join(base, "leader-movement-team"); cpSync(SOURCE_LMT, lmtRoot, { recursive: true, filter: (path) => !path.startsWith(join(SOURCE_LMT, "data")) }); });
test.afterEach(() => { cleanup(); rmSync(base, { recursive: true, force: true }); });

function request(executionMode = "dry-run") { return { type: "RoutedInferenceRequest", executionMode, messages: [{ role: "user", content: "Reply with exactly ROUTE_READY" }], admissibleTiers: ["free-nim", "leader-claude"], models: { "free-nim": "meta/llama-3.1-8b-instruct", "leader-claude": "claude-sonnet-4-6" }, sufficiency: [{ type: "contains", value: "ROUTE_READY" }], maxTokens: 24 }; }
function activity(id, executionMode = "dry-run", grant = false) {
  const attachment = [request(executionMode)]; if (grant) attachment.push({ type: "ResourceGrant", id: `urn:grant:${id}`, effects: ["external-network", "nvidia-inference-account", "leader-inference-account"], maxRuntimeMs: 1200000 });
  return { "@context": CONTEXT, id: `urn:leader:${id}`, type: "Create", actor: "urn:leader:emsenn", target: "urn:ame:leader-movement-team", object: { type: "Note", content: "Route this inference through the cheapest sufficient tier.", attachment } };
}
function run(value) { return spawnSync(process.execPath, [join(lmtRoot, "src/run-leader-movement.js"), "--now", NOW, "--provider-root", ROOT], { input: JSON.stringify(value), encoding: "utf8", timeout: 120000 }); }
function runSection(operation, value, env = process.env) { return spawnSync(process.execPath, [join(ROOT, "src/contract-routed-inference.js"), "--operation", operation, "--now", NOW], { cwd: ROOT, input: JSON.stringify(value), encoding: "utf8", timeout: 120000, env }); }
function directSolicitation(id, routedRequest) {
  const sourceActivity = { "@context": CONTEXT, id: `urn:leader:${id}:source`, type: "Create", actor: "urn:ame:leader-movement-team", target: "urn:ame:logical-inference-service-section", object: { type: "Note", content: "Route this inference through the cheapest sufficient tier.", attachment: [routedRequest] } };
  return { "@context": CONTEXT, id: `urn:leader:${id}:solicitation`, type: "Offer", actor: "urn:ame:leader-movement-team", target: "urn:ame:logical-inference-service-section", object: { type: "ServiceSolicitation", demand: `urn:demand:${id}`, sourceActivity, requestedEvidence: ["provider-authored-contract", "provider-owned-result"] } };
}
function directContract(id, solicitation, offer) {
  const allowedActions = ["invoke-service", ...offer.object.effects];
  const capability = { id: `urn:capability:${id}`, type: "Capability", issuer: solicitation.actor, holder: offer.actor, invocationTarget: offer.actor, parentOffer: offer.id, allowedActions, attenuation: { sourceActivity: offer.object.sourceActivity, requestDigest: offer.object.requestDigest, providerScope: offer.object.scope }, capTP: { target: offer.actor, method: "invoke-service" } };
  return { "@context": CONTEXT, id: `urn:leader:${id}:contract`, type: "Accept", actor: solicitation.actor, target: offer.actor, inReplyTo: offer.id, object: { type: "ServiceContract", contract: "liss-inference-service", demand: solicitation.object.demand, offer, capability } };
}

test("the route law is a strict finite forward chain with separately declared resource effects", () => {
  const value = request("live"); assert.deepEqual(validateRoutedRequest(value), []);
  assert.deepEqual(routePlan(value).map((step) => step.tier), ["free-nim", "leader-claude"]);
  assert.deepEqual(routeEffects(value), ["external-network", "leader-inference-account", "nvidia-inference-account"]);
  assert.ok(validateRoutedRequest({ ...value, admissibleTiers: ["leader-claude", "free-nim"] }).includes("admissibleTiers(strict forward order)"));
});
test("the section discovers Gemini as a real free inference tier", () => {
  const value = { ...request(), admissibleTiers: ["free-gemini", "leader-claude"], models: { "free-gemini": "gemini-3.1-flash-lite", "leader-claude": "claude-sonnet-4-6" } };
  assert.deepEqual(routePlan(value).map((step) => step.provider), ["gemini-inference-team", "claude-code-inference-team"]);
  const execution = runSection("solicit-service", directSolicitation("gemini-tier", value));
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const output = JSON.parse(execution.stdout);
  assert.equal(output.type, "Offer");
  const gemini = output.object.scope.candidates.find((candidate) => candidate.tier === "free-gemini");
  assert.equal(gemini.provider, "gemini-inference-team");
  assert.equal(gemini.bid.availability, "locally-admissible");
  assert.equal(gemini.compatibility.compatible, true);
});
test("market constraints and provider bids are pure, bounded, and evidence-honest", () => {
  const value = { ...request(), marketConstraints: { requiredAvailability: "locally-admissible", allowedConsiderationDenominations: ["usd"], maxConsiderationPerRequest: 1, minimumRemainingCapacity: 1, requiredQualityEvidenceKinds: ["provider-local-exchange-record"] } }; assert.deepEqual(validateRoutedRequest(value), []); assert.ok(validateRoutedRequest({ ...value, marketConstraints: { maxConsiderationPerRequest: 1 } }).includes("marketConstraints.maxConsiderationPerRequest"));
  const step = routePlan(request())[0]; const bid = { type: "InferenceServiceBid", provider: "urn:ame:nvidia-inference-team", requestScopeDigest: "sha256:test", model: step.model, availability: "unavailable", capacity: { unit: "provider-request-slot", remaining: "unknown", period: "unknown" }, consideration: { denomination: "unknown", maxPerRequest: "unknown", monetary: "unknown" }, qualityEvidence: { kind: "provider-local-exchange-record", reference: "unknown" } }; assert.deepEqual(validateInferenceServiceBid(step, bid), []); assert.equal(evaluateBidCompatibility(bid, {}).compatible, false); assert.ok(evaluateBidCompatibility({ ...bid, availability: "unknown" }, value.marketConstraints).reasons.includes("considerationDenomination:unknown-or-disallowed"));
});

test("sufficiency is explicit, replayable predicate evidence rather than provider success", () => {
  const predicates = [{ type: "min-chars", value: 4 }, { type: "contains", value: "ready" }, { type: "json-object" }];
  const evidence = evaluateSufficiency('{"ready":true}', predicates); assert.deepEqual(evidence.map((item) => item.satisfied), [true, true, true]);
  assert.deepEqual(evaluateSufficiency("provider succeeded", predicates).map((item) => item.satisfied), [true, false, false]);
});

test("a provider-owned refusal advances the accepted route while local grant failures stop", () => {
  const overloaded = { type: "Reject", object: { type: "Refusal", reason: "Groq responded with HTTP 413", providerExchange: { outcome: "refusal", refusal: { unmet: ["http-failure:413"] } } } };
  assert.deepEqual(providerFailureDisposition(overloaded), { action: "continue", classification: "provider-exchange-refusal" });
  const transport = { type: "Reject", object: { type: "Refusal", reason: "Gemini harness failed before settling a typed result" } };
  assert.deepEqual(providerFailureDisposition(transport), { action: "continue", classification: "provider-transport-failure" });
  const missingGrant = { type: "Reject", object: { type: "Refusal", reason: "the granted Groq account resource has no credential injected", unmet: ["groq-credential-injection"] } };
  assert.deepEqual(providerFailureDisposition(missingGrant), { action: "stop", classification: "local-contract-or-resource-failure" });
});

test("a typed JSON result may use one conventional carrier fence but may not contain ambient prose", () => {
  const predicates = [{ type: "json-object-envelope" }];
  const fenced = "```json\n{\"disposition\":\"refuse\"}\n```";
  assert.equal(jsonObjectEnvelope(fenced), '{"disposition":"refuse"}');
  assert.deepEqual(validateRoutedRequest({ ...request(), sufficiency: predicates }), []);
  assert.deepEqual(evaluateSufficiency(fenced, predicates).map((item) => item.satisfied), [true]);
  assert.deepEqual(evaluateSufficiency("Here is the result:\n" + fenced, predicates).map((item) => item.satisfied), [false]);
});

test("validated structured tool choice is admitted only on the Claude route", () => {
  const outputSchema = { type: "object", additionalProperties: false, properties: { tool: { enum: ["accept", "revise", "refuse"] }, report: { type: "string" } }, required: ["tool", "report"] };
  const admitted = { ...request(), admissibleTiers: ["leader-claude"], models: { "leader-claude": "claude-sonnet-4-6" }, outputSchema };
  assert.deepEqual(validateRoutedRequest(admitted), []);
  assert.ok(validateRoutedRequest({ ...admitted, admissibleTiers: ["free-nim", "leader-claude"] }).includes("outputSchema(leader-claude-only)"));
});

test("LMT discovers the whole section and validates a dry route without invoking a child", () => {
  const execution = run(activity("dry")); assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const output = JSON.parse(execution.stdout); assert.equal(output.type, "Accept"); assert.equal(output.object.provider, "urn:ame:logical-inference-service-section");
  const result = output.object.result.object; assert.equal(result.type, "RoutedInferenceResult"); assert.equal(result.dryRun, true); assert.deepEqual(result.attempts, []);
});

test("the maximum possible tier trajectory is authorized before live execution", () => {
  const execution = run(activity("grant", "live")); assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const output = JSON.parse(execution.stdout); assert.equal(output.type, "Question"); assert.equal(output.object.type, "ResourceGrantRequired");
  assert.deepEqual(output.object.offers[0].effects, ["external-network", "leader-inference-account"]);
});

test("unconstrained solicitation freezes provider-authored candidates and filters exhausted NVIDIA", () => {
  const routed = { ...request(), admissibleTiers: ["free-groq", "free-nim", "leader-claude"], models: { "free-groq": "llama-3.1-8b-instant", "free-nim": "meta/llama-3.1-8b-instruct", "leader-claude": "claude-sonnet-4-6" } }; const output = JSON.parse(runSection("solicit-service", directSolicitation("frozen", routed)).stdout); assert.equal(output.type, "Offer"); assert.deepEqual(output.object.scope.plan.map((step) => step.provider), ["groq-inference-team", "claude-code-inference-team"]); assert.equal(output.object.scope.candidates.length, 3); const nvidia = output.object.scope.candidates.find((candidate) => candidate.provider === "nvidia-inference-team"); assert.equal(nvidia.bid.availability, "unavailable"); assert.equal(nvidia.compatibility.compatible, false); for (const candidate of output.object.scope.candidates) { assert.match(candidate.childOfferDigest, /^sha256:/); assert.match(candidate.bidDigest, /^sha256:/); assert.equal(JSON.stringify(candidate).includes("API_KEY"), false); }
});

test("market constraints filter unknown availability and refuse unknown consideration", () => {
  const base = { ...request(), admissibleTiers: ["free-groq", "leader-claude"], models: { "free-groq": "llama-3.1-8b-instant", "leader-claude": "claude-sonnet-4-6" } }; const available = JSON.parse(runSection("solicit-service", directSolicitation("availability", { ...base, marketConstraints: { requiredAvailability: "locally-admissible" } })).stdout); assert.equal(available.type, "Offer"); assert.deepEqual(available.object.scope.plan.map((step) => step.provider), ["groq-inference-team"]); const unavailable = JSON.parse(runSection("solicit-service", directSolicitation("price", { ...base, marketConstraints: { allowedConsiderationDenominations: ["usd"], maxConsiderationPerRequest: 1 } })).stdout); assert.equal(unavailable.type, "Question"); assert.equal(unavailable.object.type, "NoCompatibleInferenceBid");
});

test("tampered frozen child evidence rejects before provider invocation", () => {
  const routed = { ...request("live"), admissibleTiers: ["free-groq"], models: { "free-groq": "llama-3.1-8b-instant" } }; const solicitation = directSolicitation("tamper", routed); const offered = JSON.parse(runSection("solicit-service", solicitation).stdout); offered.object.scope.candidates[0].bid.model = "tampered"; const contract = directContract("tamper", solicitation, offered); contract.object.capability.attenuation.providerScope = offered.object.scope; const invoked = runSection("invoke-service", contract); assert.equal(invoked.status, 2); assert.match(JSON.parse(invoked.stdout).object.reason, /frozen provider evidence invalid/);
});

test("the section reaches Groq's own contract face and stops on missing credential without spending upward", () => {
  const routedRequest = { ...request("live"), admissibleTiers: ["free-groq", "leader-claude"], models: { "free-groq": "llama-3.1-8b-instant", "leader-claude": "claude-sonnet-4-6" } };
  const solicitation = directSolicitation("groq-no-key", routedRequest);
  const solicited = runSection("solicit-service", solicitation);
  assert.equal(solicited.status, 0, solicited.stderr || solicited.stdout);
  const offer = JSON.parse(solicited.stdout);
  assert.equal(offer.type, "Offer");
  assert.deepEqual(offer.object.scope.plan.map((step) => step.provider), ["groq-inference-team", "claude-code-inference-team"]);

  const contract = directContract("groq-no-key", solicitation, offer);
  const env = { ...process.env };
  env.GROQ_INFERENCE_PILOT_CAP = "100";
  delete env.GROQ_API_KEY;
  delete env.API_KEY_GROQ_GROQCLOUD;
  const invoked = runSection("invoke-service", contract, env);
  assert.equal(invoked.status, 2, invoked.stderr || invoked.stdout);
  const outcome = JSON.parse(invoked.stdout);
  assert.equal(outcome.type, "Reject");
  assert.equal(outcome.object.failedTier, "free-groq");
  assert.equal(outcome.object.attempts.length, 1);
  assert.equal(outcome.object.attempts[0].provider, "groq-inference-team");
  assert.equal(outcome.object.attempts[0].providerResult.type, "Reject");
  assert.match(outcome.object.attempts[0].providerResult.object.reason, /no credential injected/);
});
