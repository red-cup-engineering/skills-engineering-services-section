// Unit-level coverage for the canonical typed-inference effect executor.
//
// Conformance runs on the local SEN runtime; the WIT assay and journal
// boundaries remain mocked here. Provider
// integration tests exercise the subprocess A2A boundaries.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { mock } from "node:test";
import { assay } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import { jsonToTerm } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/json-codec";
import { semanticBytes } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

const PROVIDER_ACCOUNT = "eip155:31337:0x4444444444444444444444444444444444444444";
const identity = (value) => `ni:///sha-256;${createHash("sha256").update(JSON.stringify(value)).digest("base64url")}`;

const witnessJournalCalls = [];

mock.module("@red-cup-engineering/computer-inference-engine/fabric/effect-assay", {
  exports: { async assayWitTransition() { return { witness: "ni:///sha-256;witness" }; } },
});
mock.module("@red-cup-engineering/witness-journal-document-service", {
  exports: {
    relationalWitnessJournalDocument(fields) { return fields; },
    async recordWitnessJournalBatch(call) { witnessJournalCalls.push(call); return { recorded: true }; },
  },
});

const { TYPED_INFERENCE_OPERATION_TYPE, executeTypedInferenceEffect, typedInferenceOperationMarks, rawInferencePart, requiredAgentUrl } = await import("../../src/fabric/execute-typed-inference-effect.mjs");

process.env.WIT_TRANSITION_ASSAY_AGENT = "mock://wit-transition-assay-agent";
process.env.WITNESS_JOURNAL_RDF_AGENT = "mock://witness-journal-agent";

function proposalMessage({ instruction, input, model, mode, law, provider = PROVIDER_ACCOUNT }) {
  const operation = ["pair", ["mark", instruction], ["pair", ["mark", input], ["pair", ["mark", model], ["mark", mode]]]];
  const cell = { ...(law === undefined ? {} : { law }), caller: "eip155:31337:0x3333333333333333333333333333333333333333", provider, evidenceRoot: identity("bottom"), outcome: { positiveEvidence: false, negativeEvidence: false }, measures: [], parent: null };
  const raw = semanticBytes(["pair", jsonToTerm(cell), operation]).toString("base64");
  return { messageId: "m", role: "ROLE_USER", parts: [{ raw, metadata: {}, filename: "proposal.sen.cbor", mediaType: "application/sen+cbor" }], metadata: {} };
}

function measures(prior, performed) {
  const byDimension = new Map((prior ?? []).map((measure) => [measure.dimension, measure]));
  byDimension.set("provider-request", { dimension: "provider-request", quantity: "1", unit: "test-provider-request" });
  if (Number.isInteger(performed.usage?.prompt_tokens)) byDimension.set("input-token", { dimension: "input-token", quantity: String(performed.usage.prompt_tokens), unit: "token" });
  return [...byDimension.values()];
}

test("the shared operation type is accepted by the SEN runtime", () => {
  const operation = ["pair", ["mark", "instruction"], ["pair", ["mark", "input"], ["pair", ["mark", "model"], ["mark", "dry-run"]]]];
  assert.doesNotThrow(() => assay({ term: operation, expectedType: TYPED_INFERENCE_OPERATION_TYPE, fuel: 0 }));
});

test("typedInferenceOperationMarks extracts instruction/input/model/mode from the FOUR-bottom term shape", () => {
  const marks = typedInferenceOperationMarks(["pair", ["mark", "instr"], ["pair", ["mark", "in"], ["pair", ["mark", "model-x"], ["mark", "dry-run"]]]]);
  assert.deepEqual(marks, { instruction: "instr", input: "in", model: "model-x", mode: "dry-run" });
});

test("typedInferenceOperationMarks rejects a term that is not instruction/input/model/mode Marks", () => {
  assert.throws(() => typedInferenceOperationMarks(["mark", "not-an-operation"]), /instruction\/input\/model\/mode Marks/u);
});

test("rawInferencePart requires exactly one application/sen+cbor part", () => {
  assert.throws(() => rawInferencePart({ parts: [] }, "Test Provider"), /Test Provider inference requires exactly one/u);
  const part = { mediaType: "application/sen+cbor", raw: "aGk=" };
  assert.equal(rawInferencePart({ parts: [part] }, "Test Provider"), part);
});

test("requiredAgentUrl throws when the named env var is unset", () => {
  delete process.env.SOME_TEST_AGENT_ENV;
  assert.throws(() => requiredAgentUrl("SOME_TEST_AGENT_ENV"), /SOME_TEST_AGENT_ENV must name the hired provider/u);
});

test("dry-run settles one typed effect as an exact positive FOUR cover", async () => {
  const message = proposalMessage({ instruction: "Answer briefly.", input: "2+2", model: "test-model", mode: "dry-run" });
  const result = await executeTypedInferenceEffect(message, {
    providerLabel: "Test Provider", settlement: PROVIDER_ACCOUNT,
    performInference: async ({ mode }) => (mode === "dry-run" ? { disposition: "completion", text: "ready", usage: {} } : assert.fail("live perform should not run")),
    measures,
  });
  assert.equal(result.role, "ROLE_AGENT");
  assert.equal(result.metadata.disposition, "completion");
  assert.equal(result.parts.find((part) => part.mediaType === "text/plain").text, "ready");
  assert.match(result.metadata.witnessNi, /^ni:\/\/\/sha-256;/u);
  assert.equal(witnessJournalCalls.at(-1).batch.settlement, PROVIDER_ACCOUNT);
});

test("a provider-refused exchange settles as a witnessed refusal, not a crash", async () => {
  const message = proposalMessage({ instruction: "Answer.", input: "in", model: "not-offered", mode: "dry-run" });
  const result = await executeTypedInferenceEffect(message, {
    providerLabel: "Test Provider", settlement: PROVIDER_ACCOUNT,
    performInference: ({ model }) => { if (model === "not-offered") throw new Error("Test Provider does not offer model not-offered"); return { disposition: "completion", text: "ready" }; },
    measures,
  });
  assert.equal(result.metadata.disposition, "refused");
  assert.match(result.parts.find((part) => part.mediaType === "text/plain").text, /does not offer model/u);
});

test("a proposal addressed to a different account is refused before any performInference call", async () => {
  const message = proposalMessage({ instruction: "Answer.", input: "in", model: "test-model", mode: "dry-run", provider: "eip155:31337:0xdead" });
  await assert.rejects(
    executeTypedInferenceEffect(message, { providerLabel: "Test Provider", settlement: PROVIDER_ACCOUNT, performInference: () => assert.fail("must not be called"), measures }),
    /not addressed to the Test Provider team's account/u,
  );
});

test("a lazy settlement thunk and a per-call performInference override compose (the tested Gemini DI contract)", async () => {
  const message = proposalMessage({ instruction: "Answer.", input: "2+2", model: "test-model", mode: "live" });
  const result = await executeTypedInferenceEffect(
    message,
    { providerLabel: "Test Provider", settlement: () => PROVIDER_ACCOUNT, measures, performInference: async () => assert.fail("static performInference should be overridden") },
    { performInference: async () => ({ disposition: "completion", text: "four", usage: { prompt_tokens: 3 } }) },
  );
  assert.equal(result.metadata.disposition, "completion");
  assert.equal(result.parts.find((part) => part.mediaType === "text/plain").text, "four");
});

test("noncanonical cell fields are refused by grammar admission before inference", async () => {
  const message = proposalMessage({ instruction: "Answer.", input: "in", model: "test-model", mode: "dry-run", law: "obsolete" });
  await assert.rejects(executeTypedInferenceEffect(message, {
    providerLabel: "Test Provider", settlement: PROVIDER_ACCOUNT, measures,
    performInference: () => assert.fail("must not run after failed admission"),
  }), /effect cell must expose exactly/u);
});

test("an optional extra-evidence builder attaches its own message part and reaches an evidence sink", async () => {
  const message = proposalMessage({ instruction: "Answer.", input: "2+2", model: "test-model", mode: "live" });
  let sunk;
  const result = await executeTypedInferenceEffect(message, {
    providerLabel: "Test Provider", settlement: PROVIDER_ACCOUNT, measures,
    performInference: async () => ({ disposition: "completion", text: "four", usage: {} }),
    buildExtraEvidence: ({ performed }) => ({ id: "exchange-1", outcome: performed.disposition, completion: { text: performed.text } }),
    evidenceSink: async (record) => { sunk = record; },
  });
  const part = result.parts.find((item) => item.mediaType === "application/json" && item.filename === "exchange-evidence.json");
  assert.ok(part);
  assert.equal(JSON.parse(part.text).completion.text, "four");
  assert.equal(result.metadata.exchangeEvidenceId, "exchange-1");
  assert.equal(sunk.id, "exchange-1");
});

test("documentExtra reaches the witness-journal document (the OpenRouter zeroCashGuard shape)", async () => {
  const message = proposalMessage({ instruction: "Answer.", input: "2+2", model: "test-model", mode: "dry-run" });
  await executeTypedInferenceEffect(message, {
    providerLabel: "Test Provider", settlement: PROVIDER_ACCOUNT, measures,
    performInference: async () => ({ disposition: "completion", text: "ready" }),
    documentExtra: { zeroCashGuard: "free-key-and-zero-price-preflight" },
  });
  assert.equal(witnessJournalCalls.at(-1).batch.document.zeroCashGuard, "free-key-and-zero-price-preflight");
});
