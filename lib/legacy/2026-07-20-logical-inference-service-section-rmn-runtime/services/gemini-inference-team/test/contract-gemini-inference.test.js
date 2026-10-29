import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2099-07-19T12:00:00.000Z";
const CONTEXT = "https://www.w3.org/ns/activitystreams";
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const digest = (value) => `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;

function cleanup() { rmSync(join(ROOT, "data/journals/events/2099"), { recursive: true, force: true }); }
test.beforeEach(cleanup);
test.afterEach(cleanup);

function source(id, executionMode) {
  return { "@context": CONTEXT, id: `urn:test:${id}:source`, type: "Create", actor: "urn:ame:logical-inference-service-section", target: "urn:ame:gemini-inference-team", object: { type: "Note", content: "Use Gemini inference.", attachment: [{ type: "GeminiInferenceRequest", executionMode, packet: { model: "gemini-3.1-flash-lite", messages: [{ role: "user", content: "Return ready." }], "max-tokens": 16 } }] } };
}
function solicitation(id, executionMode) {
  const sourceActivity = source(id, executionMode);
  return { "@context": CONTEXT, id: `urn:test:${id}:solicitation`, type: "Offer", actor: sourceActivity.actor, target: sourceActivity.target, object: { type: "ServiceSolicitation", sourceActivity } };
}
function cleanEnv() {
  const env = { ...process.env };
  for (const name of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "API_KEY_GOOGLE_GEMINI", "GEMINI_INFERENCE_PILOT_CAP"]) delete env[name];
  return env;
}
function run(operation, value) {
  return spawnSync(process.execPath, [join(ROOT, "src/contract-gemini-inference.js"), "--operation", operation, "--now", NOW], { input: JSON.stringify(value), encoding: "utf8", env: cleanEnv() });
}
function contractFor(offer) {
  return { "@context": CONTEXT, id: "urn:test:contract", type: "Accept", actor: "urn:ame:logical-inference-service-section", target: offer.actor, inReplyTo: offer.id, object: { type: "ServiceContract", contract: offer.object.contract, offer, capability: { type: "Capability", holder: offer.actor, invocationTarget: offer.actor, parentOffer: offer.id, allowedActions: ["invoke-service", ...offer.object.effects], attenuation: { requestDigest: offer.object.requestDigest, providerScope: offer.object.scope } } } };
}

test("Gemini offers and settles a dry-run contract without network or auth", () => {
  const offered = run("solicit-service", solicitation("dry", "dry-run"));
  assert.equal(offered.status, 0, offered.stderr || offered.stdout);
  const offer = JSON.parse(offered.stdout);
  assert.equal(offer.type, "Offer");
  assert.deepEqual(offer.object.effects, []);
  assert.equal(offer.object.inferenceServiceBid.type, "InferenceServiceBid");
  assert.equal(offer.object.inferenceServiceBid.provider, "urn:ame:gemini-inference-team");
  assert.equal(offer.object.inferenceServiceBid.requestScopeDigest, digest(offer.object.scope));
  assert.equal(offer.object.inferenceServiceBid.model, "gemini-3.1-flash-lite");
  assert.equal(JSON.stringify(offer).includes("API_KEY"), false);

  const invoked = run("invoke-service", contractFor(offer));
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  const result = JSON.parse(invoked.stdout);
  assert.equal(result.type, "Accept");
  assert.equal(result.object.type, "GeminiInferenceResult");
  assert.equal(result.object.dryRun, true);
  assert.equal(result.object.observations.networkCalls, 0);
});

test("live Gemini declares its effects and refuses before network without a credential", () => {
  const offered = run("solicit-service", solicitation("live", "live"));
  assert.equal(offered.status, 0, offered.stderr || offered.stdout);
  const offer = JSON.parse(offered.stdout);
  assert.deepEqual(offer.object.effects, ["external-network", "gemini-inference-account"]);

  const invoked = run("invoke-service", contractFor(offer));
  assert.equal(invoked.status, 2, invoked.stderr || invoked.stdout);
  const refusal = JSON.parse(invoked.stdout);
  assert.equal(refusal.type, "Reject");
  assert.deepEqual(refusal.object.unmet, ["gemini-credential-injection"]);
});
