import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { serveContractedAgent } from "@emsenn/a2a-services-section/server";
import { assay, semanticBytes, semanticId } from "@emsenn/rmn-semantic-conformance";
import { ACCOUNT, executeMessage } from "../src/execute-rmn-inference.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LISS_ACCOUNT = JSON.parse(readFileSync(resolve(ROOT, "content/evm/accounts/eip155-31337.json"), "utf8")).account.caip10;

const LAW = "ni:///sha-256;h2VIEZwYH__6vRnSgSWYRrFh1AHFcIBFboED8rlsGgo";
const id = (label) => `ni:///sha-256;${createHash("sha256").update(label).digest("base64url")}`;
const OPERATION_TYPE = ["product", ["mark"], ["product", ["mark"], ["product", ["mark"], ["mark"]]]];
const RMN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../../services/lenticule-science/services/obsmetrological-services-section/services/rmn-semantic-conformance");
const RWIL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../../services/lenticule-science/services/obsmetrological-services-section/services/rwil-rdf-services");
let rmnServer, rwilServer;

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
    executor: process.execPath, executorArgs: [resolve(RMN_ROOT, "scripts/execute-a2a-task.mjs")], timeoutMs: 10_000 });
  process.env.RMN_CONFORMANCE_AGENT = `${baseUrl}/.well-known/agent-card.json`;
  const rwilSocket = createServer(); await new Promise((accept) => rwilSocket.listen(0, "127.0.0.1", accept));
  const rwilPort = rwilSocket.address().port; await new Promise((accept) => rwilSocket.close(accept));
  const rwilBase = `http://127.0.0.1:${rwilPort}`;
  rwilServer = await serveContractedAgent({ port: rwilPort, host: "127.0.0.1", baseUrl: rwilBase,
    agentCard: resolve(RWIL_ROOT, "content/agent-cards/rwil-rdf.json"),
    executor: process.execPath, executorArgs: [resolve(RWIL_ROOT, "scripts/execute-a2a-task.mjs")], timeoutMs: 10_000 });
  process.env.RWIL_RDF_AGENT = `${rwilBase}/.well-known/agent-card.json`;
});
after(async () => { delete process.env.RMN_CONFORMANCE_AGENT; delete process.env.RWIL_RDF_AGENT; await new Promise((accept) => rwilServer.server.close(accept)); await new Promise((accept) => rmnServer.server.close(accept)); });

test("dry-run executes one typed effect bundle and returns a witnessed FOUR cover", async () => {
  const operation = ["pair", ["mark", "Answer briefly."], ["pair", ["mark", "What is two plus two?"], ["pair", ["mark", "gemini-3.1-flash-lite"], ["mark", "dry-run"]]]];
  const operationReceipt = invoke(operation, OPERATION_TYPE);
  const cell = { scale: "task", law: LAW, caller: LISS_ACCOUNT, provider: ACCOUNT,
    precondition: id("pre"), operation: operationReceipt.term, postcondition: id("post"), refusal: id("refusal"), evidenceRoot: id("bottom"),
    outcome: { positiveEvidence: false, negativeEvidence: false }, measures: [], parent: null };
  const bundle = ["pair", ["effect", cell], operation];
  const bundleReceipt = invoke(bundle, ["product", ["effect"], OPERATION_TYPE]);
  const prior = process.env.GEMINI_RWIL_ROOT; process.env.GEMINI_RWIL_ROOT = mkdtempSync(join(tmpdir(), "gemini-rwil-"));
  try {
    const result = await executeMessage({ messageId: "m", role: "ROLE_USER", parts: [{ raw: bundleReceipt.canonicalBytesBase64, metadata: { ni: bundleReceipt.term }, filename: "proposal.rmn.cbor", mediaType: "application/rmn+cbor" }], metadata: {} });
    assert.equal(result.role, "ROLE_AGENT"); assert.equal(result.metadata.disposition, "completion");
    assert.equal(result.parts.find((part) => part.mediaType === "text/plain").text, "ready");
    assert.match(result.metadata.witnessNi, /^ni:\/\/\/sha-256;/u);
  } finally { if (prior === undefined) delete process.env.GEMINI_RWIL_ROOT; else process.env.GEMINI_RWIL_ROOT = prior; }
});
