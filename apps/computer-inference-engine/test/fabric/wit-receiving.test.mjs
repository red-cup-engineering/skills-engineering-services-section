import assert from "node:assert/strict";
import test from "node:test";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-engineering-services-section/semantic-content-identity";
import { agentSenMessage, extractSenPart } from "@red-cup-engineering/a2a-services-section/sen-part";
import { readingOfWire, witFlux } from "@red-cup-engineering/computer-data-engineering-services-section/four";
import { assayWitTransition, decodeWitTransitionAssayReceipt, encodeWitTransitionAssayRequest, witnessWitTransition, textNi } from "../../src/fabric/effect-assay.mjs";

const objectKind = "lenticule-science.wit-transition-assay.json";
const provider = "eip155:31337:0x0aadad1c6a71d34f89dad0cb41a75603433a6071";
const identified = value => identifyJsonSemanticContent({ objectKind, value, witnessRoot: EMPTY_WITNESS_ROOT });
function record(value) { const { id, ...body } = value; return { ...body, id: identified(body).token }; }
const wire = (positiveEvidence, negativeEvidence) => ({ positiveEvidence, negativeEvidence });
function transition(before = wire(false, false), after = wire(true, false)) {
  const proposalCell = {
    caller: "eip155:31337:0x4444444444444444444444444444444444444444",
    provider: "eip155:31337:0x5555555555555555555555555555555555555555",
    law: textNi("law"), operation: textNi("operation"), parent: null,
    precondition: textNi("precondition"), postcondition: textNi("postcondition"), refusal: textNi("refusal"),
    evidenceRoot: textNi("initial evidence"), outcome: before, measures: [],
  };
  const evidence = textNi("independently witnessed evidence");
  const completionCell = { ...proposalCell, outcome: after, evidenceRoot: evidence, measures: [{ dimension: "compute", unit: "microsecond", quantity: 17 }] };
  return { proposalCell, completionCell, evidence };
}
function exchangeWith(transform) {
  return async ({ message, requireSignature }) => {
    assert.equal(requireSignature, true);
    const request = admitJsonSemanticContent({ bytes: extractSenPart(message.parts).bytes, objectKind }).value;
    const receipt = witnessWitTransition(request, { providerAccount: provider });
    const transformed = transform(structuredClone(receipt), request);
    const result = agentSenMessage(identified(transformed).bytes, "wit-transition-receipt.sen.cbor", "witness-reply");
    return { result, outputNi: result.parts[0].metadata.ni };
  };
}
const assay = (input, transform = value => value) => assayWitTransition({ agentUrl: "https://wit.example.test", ...input, send: exchangeWith(transform) });

for (const [before, after] of [
  [wire(false, false), wire(true, false)], [wire(false, false), wire(false, true)],
  [wire(true, false), wire(true, true)], [wire(false, true), wire(true, true)],
]) test(`receive the legitimate ${JSON.stringify(before)} to ${JSON.stringify(after)} cover with changed measures`, async () => {
  const input = transition(before, after);
  const result = await assay(input);
  assert.deepEqual(result.outcome, after);
  assert.equal(result.evidence, input.evidence);
  assert.equal(result.completion, identified(input.completionCell).token);
});

for (const field of ["proposal", "completion", "evidence"]) {
  test(`refuse re-addressed ${field} substitution despite the exact request id`, async () => {
    await assert.rejects(() => assay(transition(), receipt => {
      receipt[field] = textNi(`foreign ${field}`);
      receipt.witnessTerm = record({ ...receipt.witnessTerm, [field]: receipt[field] });
      receipt.witness = receipt.witnessTerm.id;
      return record(receipt);
    }), /request|witness|transition|receipt/u);
  });
}

test("refuse re-addressed false outcome and cover even with matching content identities", async () => {
  await assert.rejects(() => assay(transition(), receipt => {
    receipt.outcome = wire(false, true);
    receipt.witnessTerm = record({ ...receipt.witnessTerm, after: receipt.outcome, articulatedAxis: "negativeEvidence" });
    receipt.witness = receipt.witnessTerm.id;
    return record(receipt);
  }), /request|witness|transition|receipt/u);
});

for (const mutate of [
  receipt => { receipt.witnessTerm = record({ ...receipt.witnessTerm, type: "UnrelatedWitness" }); },
  receipt => { receipt.witnessTerm = record({ ...receipt.witnessTerm, articulatedAxis: "negativeEvidence" }); },
  receipt => { receipt.witnessTerm = record({ ...receipt.witnessTerm, after: wire(true, true) }); receipt.outcome = wire(true, true); },
  receipt => { receipt.outcome = { positiveEvidence: true }; },
  receipt => { receipt.witnessTerm = record({ ...receipt.witnessTerm, evidence: textNi("other evidence") }); },
]) test(`standalone decoding rejects a mathematically malformed receipt: ${mutate}`, () => {
  const receipt = structuredClone(witnessWitTransition(encodeWitTransitionAssayRequest(transition()), { providerAccount: provider }));
  mutate(receipt); receipt.witness = receipt.witnessTerm.id;
  assert.throws(() => decodeWitTransitionAssayReceipt(record(receipt)), /FOUR|WIT|wit|witness|receipt/u);
});

test("two independently returned covers retain contradiction and close the existing WIT flux ledger", async () => {
  const commit = await assay(transition());
  const mint = await assay(transition(wire(true, false), wire(true, true)));
  const pairs = [commit, mint].map(receipt => [readingOfWire(receipt.witnessTerm.before), readingOfWire(receipt.witnessTerm.after)]);
  assert.deepEqual(witFlux(pairs), { commits: 1, mints: 1, jumps: 0, reversible: 2, irreversible: 0, wits: 2 });
  assert.deepEqual(mint.outcome, wire(true, true));
});

test("receipt custody excludes uncontracted payload fields", async () => {
  await assert.rejects(() => assay(transition(), receipt => record({ ...receipt, payload: "private inference payload" })), /only the provider profile/u);
  await assert.rejects(() => assay(transition(), receipt => {
    receipt.witnessTerm = record({ ...receipt.witnessTerm, payload: "private inference payload" });
    receipt.witness = receipt.witnessTerm.id;
    return record(receipt);
  }), /only the provider profile/u);
});

test("admitted receipt is detached and deeply immutable", () => {
  const value = structuredClone(witnessWitTransition(encodeWitTransitionAssayRequest(transition()), { providerAccount: provider }));
  const received = decodeWitTransitionAssayReceipt(value);
  value.witnessTerm.before.positiveEvidence = true;
  assert.equal(received.witnessTerm.before.positiveEvidence, false);
  assert.throws(() => { received.outcome.positiveEvidence = false; }, TypeError);
});
