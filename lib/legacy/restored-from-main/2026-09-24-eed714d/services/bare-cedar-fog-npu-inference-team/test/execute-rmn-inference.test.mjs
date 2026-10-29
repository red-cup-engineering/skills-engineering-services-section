import assert from "node:assert/strict";
import { ty } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation";
import test, { after, before } from "node:test";
import { startWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-document-service/test-provider";
import { startWitTransitionAssayProcess } from "@lenticule-science/wit-transition-assay/test-provider";
import { assay } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import { decodeSemantic, semanticBytes, semanticId } from "@red-cup-engineering/relation-model-notation-cbor-codec";
import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { OPERATION_TYPE, executeMessage } from "../src/execute-rmn-inference.mjs";

const CUSTOMER_ACCOUNT = "eip155:31337:0x3333333333333333333333333333333333333333";
const TEST_PROVIDER_ACCOUNT = "eip155:31337:0x4444444444444444444444444444444444444444";

const id = (value) => makeNiUri(Buffer.from(value, "utf8"));
function completionCell(result) {
  const part = result.parts.find((part) => part.mediaType === "application/sen+cbor");
  const term = decodeSemantic(Buffer.from(part.raw, "base64"));
  assay({ term, expectedType: ty.prod(ty.effect(), OPERATION_TYPE), fuel: 0 });
  assert.equal(semanticId(term), result.metadata.completionNi);
  assert.equal(term[1][1].provider, TEST_PROVIDER_ACCOUNT);
  assert.equal(term[1][1].evidenceRoot, result.parts.find((part) => part.mediaType === "text/plain").metadata.evidenceNi);
  return term[1][1];
}

let witnessJournalServer, witServer;

function invoke(term, expectedType) {
  const result = assay({ term, expectedType, fuel: 0 });
  return { term: semanticId(result.normalizedTerm), canonicalBytesBase64: semanticBytes(result.normalizedTerm).toString("base64") };
}

before(async () => {
  witnessJournalServer = await startWitnessJournalProviderProcess();
  process.env.WITNESS_JOURNAL_RDF_AGENT = witnessJournalServer.agentCardUrl;
  witServer = await startWitTransitionAssayProcess({ witnessJournalAgentUrl: process.env.WITNESS_JOURNAL_RDF_AGENT });
  process.env.WIT_TRANSITION_ASSAY_AGENT = witServer.agentCardUrl;
});
after(async () => {
  delete process.env.WITNESS_JOURNAL_RDF_AGENT; delete process.env.WIT_TRANSITION_ASSAY_AGENT;
  if (witServer) await witServer.close();
  if (witnessJournalServer) await witnessJournalServer.close();
});

test("dry-run settles one typed local-silicon effect as an exact positive FOUR cover", async () => {
  const input = JSON.stringify({ workType: "classification", context: { suppliedContext: "A finite input" }, executionBounds: { maximumOutputTokens: 64, sourceMeasures: { words: 3, characters: 14 } }, outputContract: { format: "json" } });
  const operation = ["pair", ["mark", "Classify briefly."], ["pair", ["mark", input], ["pair", ["mark", "qwen3:1.7b"], ["mark", "dry-run"]]]];
  const cell = { caller: CUSTOMER_ACCOUNT, provider: TEST_PROVIDER_ACCOUNT, evidenceRoot: id("bottom"), outcome: { positiveEvidence: false, negativeEvidence: false }, measures: [], parent: null };
  const bundle = ["pair", ["effect", cell], operation];
  const receipt = invoke(bundle, ty.prod(ty.effect(), OPERATION_TYPE));
    const result = await executeMessage({ messageId: "m", role: "ROLE_USER", parts: [{ raw: receipt.canonicalBytesBase64, metadata: { ni: receipt.term }, filename: "proposal.rmn.cbor", mediaType: "application/sen+cbor" }], metadata: {} }, { settlement: TEST_PROVIDER_ACCOUNT });
    assert.equal(result.role, "ROLE_AGENT"); assert.equal(result.metadata.disposition, "completion");
    assert.equal(result.parts.find((part) => part.mediaType === "text/plain").text, "ready");
    assert.deepEqual(completionCell(result).outcome, { positiveEvidence: true, negativeEvidence: false });
    assert.match(result.metadata.witnessNi, /^ni:\/\/\/sha-256;/u);
});

test("unsupported model is a witnessed refusal rather than an untyped crash", async () => {
  const operation = ["pair", ["mark", "Classify."], ["pair", ["mark", "input"], ["pair", ["mark", "not-offered"], ["mark", "dry-run"]]]];
  const cell = { caller: CUSTOMER_ACCOUNT, provider: TEST_PROVIDER_ACCOUNT, evidenceRoot: id("bottom2"), outcome: { positiveEvidence: false, negativeEvidence: false }, measures: [], parent: null };
  const receipt = invoke(["pair", ["effect", cell], operation], ty.prod(ty.effect(), OPERATION_TYPE));
  const result = await executeMessage({ messageId: "m2", role: "ROLE_USER", parts: [{ raw: receipt.canonicalBytesBase64, metadata: { ni: receipt.term }, mediaType: "application/sen+cbor" }], metadata: {} }, { settlement: TEST_PROVIDER_ACCOUNT }); assert.equal(result.metadata.disposition, "refused");
  assert.deepEqual(completionCell(result).outcome, { positiveEvidence: false, negativeEvidence: true });
});
