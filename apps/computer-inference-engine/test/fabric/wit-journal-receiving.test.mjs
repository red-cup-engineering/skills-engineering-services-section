/** Exercise the actual existing standard carriers without external publication,
 * model calls, payment, or durable access. Loopback providers hold test data only.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { jsonToTerm, termToJson } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/json-codec";
import { semanticBytes } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { seavtOfJson } from "@red-cup-engineering/semiotic-eavt-services-section/admit-seavt-row";
import { startWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-document-service/test-provider";
import { resolveWitnessJournalDocument, queryWitnessJournalDocumentsByCategory } from "@red-cup-engineering/witness-journal-document-service";
import { executeTypedInferenceEffect } from "../../src/fabric/execute-typed-inference-effect.mjs";
import { decodeWitTransitionAssayReceipt, serveWitTransitionAssay, textNi } from "../../src/fabric/effect-assay.mjs";

const performer = "eip155:31337:0x5555555555555555555555555555555555555555";
const witnessProvider = "eip155:31337:0x0aadad1c6a71d34f89dad0cb41a75603433a6071";
function proposalMessage() {
  const operation = ["pair", ["mark", "Answer briefly"], ["pair", ["mark", "two plus two"], ["pair", ["mark", "synthetic"], ["mark", "dry-run"]]]];
  const cell = { caller: "eip155:31337:0x4444444444444444444444444444444444444444", provider: performer,
    evidenceRoot: textNi("bottom"), outcome: { positiveEvidence: false, negativeEvidence: false }, measures: [], parent: null };
  return { messageId: "synthetic-inference", role: "ROLE_USER", parts: [{ raw: semanticBytes(["pair", jsonToTerm(cell), operation]).toString("base64"), metadata: {}, filename: "proposal.sen.cbor", mediaType: "application/sen+cbor" }], metadata: {} };
}

for (const disposition of ["completion", "refused"]) test(`actual A2A ${disposition} receipt is retained and recoverable through existing journal and SEAVT`, async () => {
  const wit = await serveWitTransitionAssay({ providerAccount: witnessProvider });
  const journal = await startWitnessJournalProviderProcess();
  const priorWit = process.env.WIT_TRANSITION_ASSAY_AGENT, priorJournal = process.env.WITNESS_JOURNAL_RDF_AGENT;
  process.env.WIT_TRANSITION_ASSAY_AGENT = wit.baseUrl;
  process.env.WITNESS_JOURNAL_RDF_AGENT = journal.baseUrl;
  try {
    const result = await executeTypedInferenceEffect(proposalMessage(), {
      providerLabel: "Synthetic Inference", settlement: performer,
      performInference: async ({ mode }) => { assert.equal(mode, "dry-run"); return { disposition, text: disposition === "completion" ? "four" : "unavailable" }; },
      measures: () => [{ dimension: "provider-request", quantity: "1", unit: "synthetic-request" }],
      documentExtra: { source: "synthetic standards receiving assay" },
    });
    assert.equal(result.metadata.disposition, disposition);
    const stored = await resolveWitnessJournalDocument(result.metadata.witnessJournalDocumentNi, { agentUrl: journal.baseUrl });
    assert.equal(stored.id, result.metadata.witnessJournalDocumentNi);
    const receipt = decodeWitTransitionAssayReceipt(stored.value.witReceipt);
    assert.equal(receipt.id, result.metadata.witReceiptNi);
    assert.equal(receipt.witness, result.metadata.witnessNi);
    assert.equal(receipt.provider, witnessProvider);
    assert.deepEqual(receipt.outcome, { positiveEvidence: disposition === "completion", negativeEvidence: disposition === "refused" });
    assert.equal(stored.value.source, "synthetic standards receiving assay");
    const byReceipt = await queryWitnessJournalDocumentsByCategory(receipt.id, { agentUrl: journal.baseUrl, predicate: "urn:sen:wit-receipt" });
    assert.deepEqual(byReceipt.map(value => value.id), [stored.id]);

    // SEAVT's typed value is the full received receipt, not a numeral called WIT.
    const row = seavtOfJson(receipt.completion, "urn:sen:wit-receipt", receipt, "2099-01-01T00:00:00.000Z");
    assert.deepEqual(termToJson(row.v), receipt);
    assert.equal(termToJson(row.e), receipt.completion);

  } finally {
    if (priorWit === undefined) delete process.env.WIT_TRANSITION_ASSAY_AGENT; else process.env.WIT_TRANSITION_ASSAY_AGENT = priorWit;
    if (priorJournal === undefined) delete process.env.WITNESS_JOURNAL_RDF_AGENT; else process.env.WITNESS_JOURNAL_RDF_AGENT = priorJournal;
    await journal.close(); await wit.close();
  }
});
