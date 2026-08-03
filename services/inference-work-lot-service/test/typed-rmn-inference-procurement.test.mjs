import assert from "node:assert/strict";
import test from "node:test";
import { checkTy } from "@red-cup-engineering/relation-model-notation-typing";
import { normalizedCarrierBytes, rmnCarrierId } from "../src/modern-rmn-carrier.mjs";
import { DIRECT_WITNESS_ADAPTER } from "../src/consideration.mjs";
import { CHILD_OPERATION_TYPE, compileSelectedInferenceContract, demandCommitment, procureTypedInference, selectTypedInferenceOffer, solicitTypedInferenceOffers, typedInferenceDemand } from "../src/typed-rmn-inference-procurement.mjs";
import * as procurementApi from "../src/typed-rmn-inference-procurement.mjs";

const AT = "2026-07-19T21:00:00.000Z";
async function conform({ term, expectedType }) {
  if (!checkTy([], term, expectedType)) throw new Error("test term does not inhabit its modern RMN type");
  return { term: rmnCarrierId(term), canonicalBytesBase64: Buffer.from(normalizedCarrierBytes(term)).toString("base64"), exchange: { outputNi: rmnCarrierId(["ascribe", expectedType, term]) } };
}
const CREDIT_ASSET = "urn:union:credit:relative-resolution-milliquanta-v1";
const considerationPolicy = { type: "ConsiderationPolicy", acceptableAlternatives: [{ id: "resolution-credit", obligations: [{ kind: "credit", asset: CREDIT_ASSET, maximumAmount: 10, unit: "relative-resolution-milliquanta-v1", settlementAdapters: [DIRECT_WITNESS_ADAPTER] }] }] };
const demand = { type: "TypedRmnInferenceDemand", workType: "classification", requiredCapabilities: ["classification", "json-output"], difficulty: 0.2, maximumOutputTokens: 256, sourceMeasures: { words: 2, characters: 12 }, requestMeasures: { characters: 24 }, considerationPolicy, mode: "dry-run", instruction: "Classify.", input: "finite input", outputContract: { format: "json" }, agentCards: { "urn:ame:cheap": "http://127.0.0.1:17771/.well-known/agent-card.json", "urn:ame:dear": "http://127.0.0.1:17772/.well-known/agent-card.json" } };
const creditAlternative = (amount, asset = CREDIT_ASSET) => ({ id: `credit-${amount}`, obligations: [{ id: "resolution-credit", kind: "credit", asset, amount, unit: "relative-resolution-milliquanta-v1", settlementAdapter: DIRECT_WITNESS_ADAPTER }] });
function supplier(actor, amount, address, extra = {}) { return { actor, async exchange(source) { return { "@context": source["@context"], id: `urn:offer:${actor}`, type: "Offer", actor, target: source.actor, inReplyTo: source.id, object: { type: "TypedRmnInferenceServiceOffer", contract: "ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", providerAccount: `eip155:31337:${address}`, agentCard: demand.agentCards[actor], operationType: CHILD_OPERATION_TYPE, model: "test-model", mode: "dry-run", workTypes: ["classification"], capabilities: ["classification", "json-output"], maximumDifficulty: 1, maximumSourceWords: 100, maximumSourceCharacters: 1000, maximumRequestCharacters: 2000, maximumOutputTokens: 1024, maximumConcurrentLots: 4, considerationAlternatives: [creditAlternative(amount)], requestCommitment: demandCommitment(source.object), availability: "accepted-task-must-still-settle", customerAcceptanceRequired: true, ...extra } }; } }; }

test("a fenced JSON tool-call projection asks the provider for the carrier the customer assays", () => {
  const schema = { type: "object", required: ["action"], properties: { action: { const: "observe" } }, additionalProperties: false };
  const outputContract = { format: "projected", projection: { type: "fenced-json-tool-call", schema }, schema };
  const projected = typedInferenceDemand({ type: "TestResidue" }, {
    workLot: { id: "urn:lot:tool-call", producer: "urn:customer" },
    context: { objective: "expose one customer-assayed action" },
    actuatorTerms: { workType: "classification", requiredCapabilities: ["classification", "json-output"], considerationPolicy, mode: "dry-run", outputContract, agentCards: [] },
  });
  assert.match(projected.instruction, /exactly one fenced JSON object/u);
  assert.doesNotMatch(projected.instruction, /Do not serialize it as JSON/u);
  assert.deepEqual(projected.outputContract, outputContract);
  assert.deepEqual(JSON.parse(projected.input).outputContract, outputContract);
});

test("customer-side market selects the cheapest capability-complete provider-authored comparable quote", async () => {
  const market = await solicitTypedInferenceOffers(demand, [supplier("urn:ame:dear", 9, "0x2222222222222222222222222222222222222222"), supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111")]);
  const selection = selectTypedInferenceOffer(market, considerationPolicy);
  assert.equal(selection.disposition, "provider-selected"); assert.equal(selection.selected.provider.actor, "urn:ame:cheap");
  assert.deepEqual(selection.ranked.map(({ consideration }) => consideration.obligations[0].amount), [{ numerator: "3", denominator: "1" }, { numerator: "9", denominator: "1" }]);
});

test("selected offer compiles into one direct provider RMN bundle carried by one A2A 1.0 Message", async () => {
  const market = await solicitTypedInferenceOffers(demand, [supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111")]);
  const selection = selectTypedInferenceOffer(market, considerationPolicy);
  const compiled = await compileSelectedInferenceContract(selection, demand, { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" }, { rmn: { actor: "urn:ame:test-rmn", agentCard: "https://rmn.invalid/.well-known/agent-card.json" } }, AT, { conform });
  assert.equal(compiled.message.role, "ROLE_USER"); assert.equal(compiled.message.parts.length, 1);
  assert.equal(compiled.message.parts[0].mediaType, "application/rmn+cbor"); assert.equal(compiled.message.parts[0].metadata.ni, compiled.proposal.term);
  assert.equal(compiled.message.metadata.lawNi, compiled.selectedOffer.object.contract); assert.equal(compiled.message.metadata.callerAccount, "eip155:31337:0x3333333333333333333333333333333333333333");
  assert.equal(compiled.message.metadata.providerAccount, compiled.selectedOffer.object.providerAccount);
  assert.equal(compiled.message.metadata.compact, compiled.compact.id);
  assert.deepEqual(compiled.compact.consideration.obligations[0].amount, { numerator: "3", denominator: "1" });
  assert.match(compiled.proposal.term, /^ni:\/\/\/sha-256;/u);
  assert.equal(compiled.frontierInferenceCalls, 0);
});

test("one invalid selected provider boundary becomes residue without implicit provider escalation", async () => {
  const cheap = supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111"), dear = supplier("urn:ame:dear", 9, "0x2222222222222222222222222222222222222222");
  const result = await procureTypedInference({
    residue: { type: "TestResidue" },
    request: { workLot: { id: "urn:lot:refusal", producer: "urn:customer" }, context: { objective: "test selected refusal" }, actuatorTerms: { workType: "classification", requiredCapabilities: ["classification", "json-output"], difficulty: 0.2, considerationPolicy, mode: "dry-run", outputContract: { format: "json" }, agentCards: [] } },
    suppliers: [cheap, dear], caller: { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" }, customerServices: { rmn: { actor: "urn:ame:test-rmn", agentCard: "https://rmn.invalid/.well-known/agent-card.json" } }, record: false, now: AT, conform,
    invokeProvider: async (message) => { if (message.metadata.providerAccount.endsWith("1111111111111111111111111111111111111111")) throw new Error("No valid signatures found on agent card."); return { id: "urn:settlement:dear", completion: "ni:///sha-256;BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", disposition: "completion", candidate: "{}" }; },
  });
  assert.equal(result.disposition, "selected-provider-refused");
  assert.equal(result.selection.selected.provider.actor, "urn:ame:cheap");
  assert.deepEqual(result.settlementResidues, [{ provider: "urn:ame:cheap", offer: "urn:offer:urn:ame:cheap", disposition: "settlement-transport-refusal", reason: "No valid signatures found on agent card." }]);
});

test("explicit customer cancellation reaches the selected provider and preserves a transport refusal", async () => {
  const cheap = supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111");
  const controller = new AbortController(); controller.abort(new Error("customer canceled settlement"));
  const result = await procureTypedInference({
    residue: { type: "TestResidue" },
    request: { workLot: { id: "urn:lot:cancellation", producer: "urn:customer" }, context: { objective: "test customer cancellation" }, actuatorTerms: { workType: "classification", requiredCapabilities: ["classification", "json-output"], difficulty: 0.2, considerationPolicy, mode: "dry-run", outputContract: { format: "json" }, agentCards: [] } },
    suppliers: [cheap], caller: { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" }, customerServices: { rmn: { actor: "urn:ame:test-rmn", agentCard: "https://rmn.invalid/.well-known/agent-card.json" } }, record: false, now: AT, signal: controller.signal, conform,
    invokeProvider: async (_message, _selected, signal) => { assert.equal(signal.aborted, true); throw signal.reason; },
  });
  assert.equal(result.disposition, "selected-provider-refused");
  assert.match(result.settlementResidues[0].reason, /customer canceled/u);
});

test("an unaccepted typed asset remains residue instead of being silently normalized", async () => {
  const market = await solicitTypedInferenceOffers(demand, [supplier("urn:ame:dear", 1, "0x2222222222222222222222222222222222222222", { considerationAlternatives: [creditAlternative(1, "urn:union:credit:different-credit")] })]);
  const selection = selectTypedInferenceOffer(market, considerationPolicy);
  assert.equal(selection.disposition, "no-customer-acceptable-consideration");
  assert.deepEqual(selection.refused, [{ actor: "urn:ame:dear", reason: "no-customer-acceptable-consideration" }]);
});

test("provider-authored prices compete without a customer-global ceiling", async () => {
  const market = await solicitTypedInferenceOffers(demand, [supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111"), supplier("urn:ame:dear", 9, "0x2222222222222222222222222222222222222222")]);
  const selection = selectTypedInferenceOffer(market, considerationPolicy);
  assert.equal(selection.selected.provider.actor, "urn:ame:cheap");
  assert.deepEqual(selection.ranked.map(({ provider }) => provider.actor), ["urn:ame:cheap", "urn:ame:dear"]);
});

test("provider capacity remains an honest admission bound", async () => {
  const market = await solicitTypedInferenceOffers(demand, [supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111", { maximumConcurrentLots: 0 })]);
  assert.deepEqual(market.admitted, []);
  assert.deepEqual(market.refused, [{ actor: "urn:ame:cheap", reason: "provider-capacity-invalid" }]);
});

test("the direct contracting boundary exports no global batch allocator", () => {
  assert.equal(Object.hasOwn(procurementApi, "allocateTypedInferenceBatch"), false);
});
