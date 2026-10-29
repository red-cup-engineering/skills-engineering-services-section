import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test, { after, before } from "node:test";
import { serveContractedAgent } from "@red-cup-engineering/a2a-contracted-agent-service";
import { ephemeralAgentCardSigning } from "@red-cup-engineering/a2a-agent-card-key-service/testing";
import { startWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-document-service/test-provider";
import { startWitTransitionAssayProcess } from "@lenticule-science/wit-transition-assay/test-provider";
import { assay } from "@red-cup-engineering/relation-model-notation-runtime";
import { semanticBytes, semanticId } from "@red-cup-engineering/relation-model-notation-cbor-codec";
import { makeNiUri } from "@red-cup-engineering/computer-data-engine/identity";
import { executeMessage, providerRequest, OPERATION_TYPE } from "../src/execute-rmn-inference.mjs";

const CUSTOMER_ACCOUNT = "eip155:31337:0x3333333333333333333333333333333333333333";
const PROVIDER_ACCOUNT = "eip155:31337:0x4444444444444444444444444444444444444444";

const LAW = "ni:///sha-256;h2VIEZwYH__6vRnSgSWYRrFh1AHFcIBFboED8rlsGgo";
const id = (value) => makeNiUri(Buffer.from(value, "utf8"));
const require = createRequire(import.meta.url);
// Locate each contracted service's package root through node module
// resolution (its exported face's package.json), never by relative
// traversal across a package boundary.
const packageRoot = (specifier) => dirname(require.resolve(`${specifier}/package.json`));
const RMN_ROOT = packageRoot("@red-cup-engineering/relation-model-notation-conformance");
const EXCHANGES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../content/exchanges");
let rmnServer, witnessJournalServer, witServer;

function memoryTaskSource() {
  const records = new Map();
  const key = (taskId, tenant = "") => `${tenant}\u0000${taskId}`;
  return Object.freeze({
    async put(record) { records.set(key(record.taskId, record.tenant), structuredClone(record)); return structuredClone(record); },
    async get({ taskId, tenant = "" }) { const record = records.get(key(taskId, tenant)); return record === undefined ? null : structuredClone(record); },
    async list({ tenant = "" } = {}) { return [...records.values()].filter((record) => record.tenant === tenant).map((record) => structuredClone(record)); },
  });
}

function memoryCoordinationSource() {
  const records = new Map();
  const coordinate = ({ namespace, tenant = "", key }) => `${namespace}\u0000${tenant}\u0000${key}`;
  return Object.freeze({
    async put(record) { const stored = { ...structuredClone(record), contentSha256: "memory", etag: randomUUID() }; records.set(coordinate(record), stored); return structuredClone(stored); },
    async get(record) { const stored = records.get(coordinate(record)); return stored === undefined ? null : structuredClone(stored); },
    async list({ namespace, tenant = "" }) { return [...records.values()].filter((record) => record.namespace === namespace && record.tenant === tenant).map((record) => structuredClone(record)); },
    async remove(record) { return records.delete(coordinate(record)); },
  });
}

function invoke(term, expectedType) {
  const result = assay({ term, expectedType, fuel: 0 });
  return { term: semanticId(result.normalizedTerm), canonicalBytesBase64: semanticBytes(result.normalizedTerm).toString("base64") };
}

before(async () => {
  const socket = createServer(); await new Promise((accept) => socket.listen(0, "127.0.0.1", accept));
  const port = socket.address().port; await new Promise((accept) => socket.close(accept));
  const baseUrl = `http://127.0.0.1:${port}`;
  rmnServer = await serveContractedAgent({ port, host: "127.0.0.1", baseUrl,
    agentCard: resolve(RMN_ROOT, "content/agent-cards/rmn-semantic-conformance.json"),
    executor: process.execPath, executorArgs: [resolve(RMN_ROOT, "scripts/execute-a2a-task.mjs")],
    taskSource: memoryTaskSource(), coordinationSource: memoryCoordinationSource(),
    ...ephemeralAgentCardSigning(baseUrl, "gemini-rmn-test") });
  process.env.RMN_CONFORMANCE_AGENT = `${baseUrl}/.well-known/agent-card.json`;
  witnessJournalServer = await startWitnessJournalProviderProcess();
  process.env.WITNESS_JOURNAL_RDF_AGENT = witnessJournalServer.agentCardUrl;
  witServer = await startWitTransitionAssayProcess({ witnessJournalAgentUrl: process.env.WITNESS_JOURNAL_RDF_AGENT });
  process.env.WIT_TRANSITION_ASSAY_AGENT = witServer.agentCardUrl;
});
after(async () => { delete process.env.RMN_CONFORMANCE_AGENT; delete process.env.WITNESS_JOURNAL_RDF_AGENT; delete process.env.WIT_TRANSITION_ASSAY_AGENT; await witServer?.close(); await witnessJournalServer?.close(); if (rmnServer?.server) await new Promise((accept) => rmnServer.server.close(accept)); });

test("dry-run executes one typed effect bundle and returns a witnessed FOUR cover", async () => {
  const operation = ["pair", ["mark", "Answer briefly."], ["pair", ["mark", "What is two plus two?"], ["pair", ["mark", "gemini-3.1-flash-lite"], ["mark", "dry-run"]]]];
  const operationReceipt = invoke(operation, OPERATION_TYPE);
  const cell = { caller: CUSTOMER_ACCOUNT, provider: PROVIDER_ACCOUNT, evidenceRoot: id("bottom"),
    outcome: { positiveEvidence: false, negativeEvidence: false }, measures: [], parent: null };
  const bundle = ["pair", ["effect", cell], operation];
  const bundleReceipt = invoke(bundle, ["product", ["effect"], OPERATION_TYPE]);
  const prior = process.env.GEMINI_WITNESS_JOURNAL_ROOT; process.env.GEMINI_WITNESS_JOURNAL_ROOT = mkdtempSync(join(tmpdir(), "gemini-witness-journal-"));
  try {
    const result = await executeMessage({ messageId: "m", role: "ROLE_USER", parts: [{ raw: bundleReceipt.canonicalBytesBase64, metadata: { ni: bundleReceipt.term }, filename: "proposal.rmn.cbor", mediaType: "application/rmn+cbor" }], metadata: {} }, { settlement: PROVIDER_ACCOUNT });
    assert.equal(result.role, "ROLE_AGENT"); assert.equal(result.metadata.disposition, "completion");
    assert.equal(result.parts.find((part) => part.mediaType === "text/plain").text, "ready");
    assert.match(result.metadata.witnessNi, /^ni:\/\/\/sha-256;/u);
  } finally { if (prior === undefined) delete process.env.GEMINI_WITNESS_JOURNAL_ROOT; else process.env.GEMINI_WITNESS_JOURNAL_ROOT = prior; }
});

test("live completion returns complete exchange evidence without seating package content", async () => {
  const operation = ["pair", ["mark", "Return one answer."], ["pair", ["mark", "What is two plus two?"], ["pair", ["mark", "gemini-3.1-flash-lite"], ["mark", "live"]]]];
  const operationReceipt = invoke(operation, OPERATION_TYPE);
  const cell = { caller: CUSTOMER_ACCOUNT, provider: PROVIDER_ACCOUNT, evidenceRoot: id("live-bottom"),
    outcome: { positiveEvidence: false, negativeEvidence: false }, measures: [], parent: null };
  const bundleReceipt = invoke(["pair", ["effect", cell], operation], ["product", ["effect"], OPERATION_TYPE]);
  const before = readdirSync(EXCHANGES_ROOT).sort();
  const prior = process.env.GEMINI_WITNESS_JOURNAL_ROOT; process.env.GEMINI_WITNESS_JOURNAL_ROOT = mkdtempSync(join(tmpdir(), "gemini-witness-journal-"));
  try {
    const result = await executeMessage(
      { messageId: "live", role: "ROLE_USER", parts: [{ raw: bundleReceipt.canonicalBytesBase64, metadata: { ni: bundleReceipt.term }, filename: "proposal.rmn.cbor", mediaType: "application/rmn+cbor" }], metadata: {} },
      { settlement: PROVIDER_ACCOUNT, performInference: async () => ({ disposition: "completion", text: "four", usage: { promptTokenCount: 3, candidatesTokenCount: 1 }, finishReason: "STOP" }) },
    );
    assert.deepEqual(readdirSync(EXCHANGES_ROOT).sort(), before);
    const part = result.parts.find((item) => item.mediaType === "application/json" && item.filename === "exchange-evidence.json");
    assert.ok(part);
    const exchange = JSON.parse(part.text);
    assert.equal(exchange.outcome, "completion");
    assert.equal(exchange.completion.text, "four");
    assert.equal(exchange.completion.model, "gemini-3.1-flash-lite");
    assert.equal(exchange.usage.input.quantity, 3);
    assert.equal(result.metadata.exchangeEvidenceId, exchange.id);
  } finally { if (prior === undefined) delete process.env.GEMINI_WITNESS_JOURNAL_ROOT; else process.env.GEMINI_WITNESS_JOURNAL_ROOT = prior; }
});

test("the advertised schema and token bounds reach Gemini's native request", () => {
  const schema = { type: "object", required: ["action"], properties: {
    action: { const: "edit" },
    reason: { type: "string", minLength: 5, maxLength: 100 },
    search: { type: "string", enum: Array.from({ length: 17 }, (_, index) => `source-line-${index}`) },
  }, additionalProperties: false };
  const request = providerRequest({
    instruction: "Return the contracted candidate.",
    input: JSON.stringify({
      context: { suppliedContext: JSON.stringify({ messages: [
        { role: "system", content: "Operate one coding process node." },
        { role: "user", content: "Use these exact current source bytes." },
      ] }) },
      executionBounds: { maximumOutputTokens: 2400 },
      outputContract: { format: "json", mode: "json_schema", schema },
    }),
    model: "gemini-3.1-flash-lite",
  });
  assert.equal(request.config.responseMimeType, "application/json");
  assert.deepEqual(request.config.responseJsonSchema, {
    type: "object", required: ["action"], properties: { action: { enum: ["edit"] }, reason: { type: "string" }, search: { type: "string" } }, additionalProperties: false,
  });
  assert.equal(request.config.maxOutputTokens, 2400);
  assert.match(request.config.systemInstruction, /Operate one coding process node/u);
  assert.deepEqual(request.contents, [{ role: "user", parts: [{ text: "Use these exact current source bytes." }] }]);
});

test("customer-assayed JSON reaches Gemini without transferring schema authority", () => {
  const request = providerRequest({
    instruction: "Return one JSON candidate for independent customer assay.",
    input: JSON.stringify({
      outputContract: {
        format: "json",
        schema: { type: "object", required: ["classification"], properties: { classification: { type: "string" } } },
      },
    }),
    model: "gemini-3.1-flash-lite",
  });
  assert.equal(request.config.responseMimeType, "application/json");
  assert.equal(request.config.responseJsonSchema, undefined);
});

test("a host-projected source carrier reaches Gemini without probabilistic JSON serialization", () => {
  const request = providerRequest({
    instruction: "Conclude with one fenced source block.",
    input: JSON.stringify({
      executionBounds: { maximumOutputTokens: 4000 },
      outputContract: {
        format: "projected",
        projection: { type: "single-source-artifact", path: "union-acceptance/example.test.mjs" },
        schema: { type: "object" },
      },
    }),
    model: "gemini-3.1-flash-lite",
  });
  assert.equal(request.config.maxOutputTokens, 4000);
  assert.equal(request.config.responseMimeType, undefined);
  assert.equal(request.config.responseJsonSchema, undefined);
});

test("natural text work reaches Gemini without probabilistic JSON serialization or a host ceiling", () => {
  const request = providerRequest({
    instruction: "Return the reasoning product in natural text.",
    input: JSON.stringify({ outputContract: { format: "text", schema: { type: "string" } } }),
    model: "gemini-3.1-flash-lite",
  });
  assert.equal(request.config.responseMimeType, undefined);
  assert.equal(request.config.responseJsonSchema, undefined);
  assert.equal(request.config.maxOutputTokens, undefined);
});
