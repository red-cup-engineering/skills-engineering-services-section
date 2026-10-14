import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInferenceActivityStreams, INFERENCE_ACTOR, INFERENCE_ACTIVITYSTREAMS_CONTRACT } from "../../src/fabric/inference-activitystreams.mjs";
import { ACTIVITYSTREAMS_CONTEXT } from "@red-cup-engineering/activitypub-services-section/activitystreams";
import { semanticId, semanticHex } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { dataArtifactFiles, clearDataArtifactListings } from "@red-cup-engineering/eavt-services-section/data-artifact-listing";

const at = "2026-10-12T00:00:00.000Z";
const feed = "logical-inference-service-section-activitystreams";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "inference-result-identity-"));
  t.after(() => { clearDataArtifactListings(); rmSync(root, { recursive: true, force: true }); });
  const buyer = "urn:test:buyer", job = { id: "urn:test:identity-job", messages: [{ role: "user", content: "Synthetic request." }], maxTokens: 32 };
  const digest = semanticId(job);
  assert.equal(isNiUri(digest), true);
  const calls = { quote: 0, admit: 0, replay: 0 };
  let result = { id: job.id, jobDigest: digest, text: "synthetic completed result", scheduler: { admitted: true } };
  // Only the adapter's documented broker injection port is substituted. Identity,
  // offer/contract admission, journal writing and replay are genuine owner APIs.
  // The real broker source writes semanticId(job) unchanged to settlement.jobDigest.
  const broker = {
    ready: { registryDigest: "synthetic-registry-v1" },
    quote: () => { calls.quote++; return { plan: [{ expectedResolutionCost: 1, unit: "synthetic-unit" }] }; },
    admit: (value) => { calls.admit++; assert.deepEqual(value, job);
      return { receipt: { type: "InferenceSubmissionReceipt", id: job.id, status: "admitted", jobDigest: digest } }; },
    replay: (id) => { calls.replay++; assert.equal(id, job.id); return result; },
  };
  const adapter = createInferenceActivityStreams({ broker, dataRoot: root, now: () => at });
  const solicitation = { "@context": ACTIVITYSTREAMS_CONTEXT, id: "urn:test:solicitation", type: "Offer",
    actor: buyer, target: INFERENCE_ACTOR,
    object: { type: "ServiceSolicitation", contract: INFERENCE_ACTIVITYSTREAMS_CONTRACT, request: job } };
  const offer = adapter.handle(solicitation);
  assert.equal(offer.type, "Offer"); assert.equal(offer.object.jobDigest, digest);
  const acceptance = { "@context": ACTIVITYSTREAMS_CONTEXT, id: "urn:test:acceptance", type: "Accept", actor: buyer, target: INFERENCE_ACTOR,
    object: { type: "ServiceContract", contract: INFERENCE_ACTIVITYSTREAMS_CONTRACT, offer,
      considerationAcceptance: { termDigest: offer.object.considerationDigest, acceptedBy: buyer },
      capability: { type: "Capability", holder: INFERENCE_ACTOR, invocationTarget: INFERENCE_ACTOR,
        parentOffer: offer.id, attenuation: { jobDigest: digest, buyer },
        capTP: { target: INFERENCE_ACTOR, method: "invoke-service" },
        allowedActions: ["invoke-service", "provider-local-write"] } } };
  const admitted = adapter.handle(acceptance);
  assert.equal(admitted.type, "Accept");
  const query = (id, actor = buyer, jobDigest = digest) => ({ "@context": ACTIVITYSTREAMS_CONTEXT, id, type: "Question", actor, target: INFERENCE_ACTOR,
    object: { type: "InferenceResultQuery", id: job.id, jobDigest } });
  return { root, job, buyer, digest, calls, broker, adapter, acceptance, admitted, query, result: () => result, setResult: (value) => { result = value; } };
}
function assertDigestRefusal(response) {
  assert.equal(response.type, "Reject");
  assert.equal(response.object.refusalType, "settlement-digest-conflict");
  assert.equal(Object.hasOwn(response.object, "result"), false);
}

test("a completed settlement with the exact genuine NI job identity is delivered", (t) => {
  const f = fixture(t), result = f.result(), response = f.adapter.handle(f.query("urn:test:query:complete"));
  assert.equal(response.type, "Accept");
  assert.equal(response.object.type, "InferenceSettlementResult");
  assert.equal(response.object.jobDigest, f.digest);
  assert.deepEqual(response.object.result, result);
  assert.equal(response.object.customerTerritoryMutation, false);
  assert.equal(f.calls.replay, 1);
});

test("restored offer and ownership custody accepts the same settled identity without readmission", (t) => {
  const f = fixture(t), restored = createInferenceActivityStreams({ broker: f.broker, dataRoot: f.root, now: () => at });
  assert.deepEqual(restored.snapshot(), { offers: 1, contracts: 1, ownedJobs: 1 });
  assert.deepEqual(restored.handle(f.acceptance), f.admitted); assert.equal(f.calls.admit, 1);
  const response = restored.handle(f.query("urn:test:query:restored"));
  assert.equal(response.type, "Accept"); assert.deepEqual(response.object.result, f.result());
});

test("missing, malformed, legacy and different canonical settlement identities refuse without exposing results", (t) => {
  const f = fixture(t), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(f.digest.at(-1)), noncanonical = f.digest.slice(0, -1)+alphabet[(last+1)%64];
  assert.equal(isNiUri(noncanonical), false);
  const bad = [undefined, null, "", false, 0, 1, [], [f.digest], {}, "ni:///sha-256;bad", noncanonical,
    f.digest+"?ct=application/json", "sha256:"+semanticHex(f.job), semanticHex(f.job),
    semanticId({ ...f.job, messages: [{ role: "user", content: "Different job." }] })];
  for (const [index, jobDigest] of bad.entries()) {
    f.setResult({ id: f.job.id, jobDigest, text: "must not be disclosed" });
    assertDigestRefusal(f.adapter.handle(f.query("urn:test:query:bad:"+index)));
  }
});

test("buyer or accepted-job mismatch refuses before broker result access", (t) => {
  const f = fixture(t);
  for (const query of [f.query("urn:test:query:wrong-buyer", "urn:test:other-buyer"), f.query("urn:test:query:wrong-job", f.buyer, semanticId({ id: "other" }))]) {
    const response = f.adapter.handle(query);
    assert.equal(response.type, "Reject"); assert.equal(response.object.refusalType, "query-not-authorized");
    assert.equal(Object.hasOwn(response.object, "result"), false);
  }
  assert.equal(f.calls.replay, 0);
});

test("a genuinely unsettled result keeps its typed retryable refusal", (t) => {
  const f = fixture(t); f.setResult(null);
  const response = f.adapter.handle(f.query("urn:test:query:pending"));
  assert.equal(response.type, "Reject"); assert.equal(response.object.refusalType, "result-not-settled");
  assert.equal(response.object.retryable, true);
});

test("matching malformed retained ownership and result identities cannot bypass canonical admission", (t) => {
  const f = fixture(t), malformed = "sha256:legacy-not-a-content-name";
  const [file] = dataArtifactFiles(f.root, "log", { subject: feed, match: name => name.endsWith(".jsonl") });
  const records = readFileSync(file.path, "utf8").trim().split("\n").map(JSON.parse);
  const contract = records.find((record) => record.kind === "contract");
  contract.jobDigest = malformed;
  writeFileSync(file.path, records.map((record) => JSON.stringify(record)+"\n").join(""));
  f.setResult({ id: f.job.id, jobDigest: malformed, text: "must not be disclosed" });
  const restored = createInferenceActivityStreams({ broker: f.broker, dataRoot: f.root, now: () => at });
  assertDigestRefusal(restored.handle(f.query("urn:test:query:malformed-owned", f.buyer, malformed)));
});

