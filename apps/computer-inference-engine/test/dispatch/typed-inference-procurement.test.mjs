import { TYPED_INFERENCE_OPERATION_TYPE } from "@red-cup-engineering/computer-inference-engine/fabric/execute-typed-inference-effect";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A2aTaskPendingError } from "@red-cup-engineering/a2a-services-section/sen-part";
import { effectCellOfTerm } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import { conformTerm } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/conformance";
import { DIRECT_WITNESS_ADAPTER } from "../../src/dispatch/consideration.mjs";
import { compileSelectedInferenceContract, demandCommitment, procureTypedInference, resumePendingTypedInference, selectTypedInferenceOffer, selectTypedInferenceOfferByExpectedResolution, solicitTypedInferenceOffers, typedInferenceDemand } from "../../src/dispatch/typed-inference-procurement.mjs";
import * as procurementApi from "../../src/dispatch/typed-inference-procurement.mjs";

const AT = "2026-07-19T21:00:00.000Z";
const conform = conformTerm;
const CREDIT_ASSET = "urn:union:credit:relative-resolution-milliquanta-v1";
const considerationPolicy = { type: "ConsiderationPolicy", acceptableAlternatives: [{ id: "resolution-credit", obligations: [{ kind: "credit", asset: CREDIT_ASSET, maximumAmount: 10, unit: "relative-resolution-milliquanta-v1", settlementAdapters: [DIRECT_WITNESS_ADAPTER] }] }] };
const demand = { type: "TypedSenInferenceDemand", workType: "classification", requiredCapabilities: ["classification", "json-output"], difficulty: 0.2, maximumOutputTokens: 256, sourceMeasures: { words: 2, characters: 12 }, requestMeasures: { characters: 24 }, considerationPolicy, mode: "dry-run", instruction: "Classify.", input: "finite input", outputContract: { format: "json" }, agentCards: { "urn:ame:cheap": "http://127.0.0.1:17771/.well-known/agent-card.json", "urn:ame:dear": "http://127.0.0.1:17772/.well-known/agent-card.json" } };
const creditAlternative = (amount, asset = CREDIT_ASSET) => ({ id: `credit-${amount}`, obligations: [{ id: "resolution-credit", kind: "credit", asset, amount, unit: "relative-resolution-milliquanta-v1", settlementAdapter: DIRECT_WITNESS_ADAPTER }] });
function supplier(actor, amount, address, extra = {}) { return { actor, async exchange(source) { return { "@context": source["@context"], id: `urn:offer:${actor}`, type: "Offer", actor, target: source.actor, inReplyTo: source.id, object: { type: "TypedSenInferenceServiceOffer", contract: "ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", providerAccount: `eip155:31337:${address}`, agentCard: demand.agentCards[actor], operationType: TYPED_INFERENCE_OPERATION_TYPE, model: "test-model", mode: "dry-run", workTypes: ["classification"], capabilities: ["classification", "json-output"], maximumDifficulty: 1, maximumSourceWords: 100, maximumSourceCharacters: 1000, maximumRequestCharacters: 2000, maximumOutputTokens: 1024, maximumConcurrentLots: 4, considerationAlternatives: [creditAlternative(amount)], requestCommitment: demandCommitment(source.object), availability: "accepted-task-must-still-settle", customerAcceptanceRequired: true, ...extra } }; } }; }

async function pendingProcurement() {
  const residue = { type: "TestResidue" };
  const request = { workLot: { id: "urn:lot:pending", producer: "urn:customer" }, context: { objective: "test resumable provider task" }, actuatorTerms: { workType: "classification", requiredCapabilities: ["classification", "json-output"], difficulty: 0.2, considerationPolicy, mode: "dry-run", outputContract: { format: "json" }, agentCards: [] } };
  const caller = { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" };
  const customerServices = {};
  const procurement = await procureTypedInference({
    residue, request, suppliers: [supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111")],
    caller, customerServices, record: false, now: AT, conform,
    invokeProvider: async () => ({ disposition: "pending", dependency: { agentUrl: demand.agentCards["urn:ame:cheap"], taskId: "opaque-pending-task" } }),
  });
  return { procurement, residue, request, caller, customerServices };
}

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

test("expected-resolution selection ranks by the pricing observations and carries the computed price beside the declared one", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "typed-sen-procurement-pricing-test-"));
  try {
    const market = await solicitTypedInferenceOffers(demand, [supplier("urn:ame:dear", 9, "0x2222222222222222222222222222222222222222"), supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111")]);
    const selection = await selectTypedInferenceOfferByExpectedResolution(market, considerationPolicy, { pricingRoot: dataRoot, taskClass: "classification" });
    assert.equal(selection.disposition, "provider-selected");
    // settleSelectedTypedInference asserts market.admitted.includes(selection.selected);
    // the price-aware path must keep that exact reference, not a spread copy.
    assert.equal(market.admitted.includes(selection.selected), true);
    assert.equal(selection.selected.provider.actor, "urn:ame:cheap");
    // both providers are unobserved: price = declared amount * 2.
    assert.deepEqual(selection.selectedExpectedResolutionPrice.expectedPrice, { numerator: "6", denominator: "1" });
    assert.deepEqual(selection.ranked.map(({ provider, expectedResolutionPrice }) => ({ provider: provider.actor, price: expectedResolutionPrice.expectedPrice })), [
      { provider: "urn:ame:cheap", price: { numerator: "6", denominator: "1" } },
      { provider: "urn:ame:dear", price: { numerator: "18", denominator: "1" } },
    ]);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("selected offer compiles into one direct provider SEN bundle carried by one A2A 1.0 Message", async () => {
  const market = await solicitTypedInferenceOffers(demand, [supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111")]);
  const selection = selectTypedInferenceOffer(market, considerationPolicy);
  const compiled = await compileSelectedInferenceContract(selection, demand, { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" }, AT, { conform });
  assert.equal(compiled.message.role, "ROLE_USER"); assert.equal(compiled.message.parts.length, 1);
  assert.equal(compiled.message.parts[0].mediaType, "application/sen+cbor"); assert.equal(compiled.message.parts[0].metadata.ni, compiled.proposal.term);
  assert.equal(compiled.message.metadata.lawNi, compiled.selectedOffer.object.contract); assert.equal(compiled.message.metadata.callerAccount, "eip155:31337:0x3333333333333333333333333333333333333333");
  assert.equal(compiled.message.metadata.providerAccount, compiled.selectedOffer.object.providerAccount);
  assert.equal(compiled.message.metadata.compact, compiled.compact.id);
  assert.deepEqual(compiled.compact.consideration.obligations[0].amount, { numerator: "3", denominator: "1" });
  assert.match(compiled.proposal.term, /^ni:\/\/\/sha-256;/u);
  assert.equal(compiled.frontierInferenceCalls, 0);
});

test("local SEN conformance receives one canonical effect cell", async () => {
  const market = await solicitTypedInferenceOffers(demand, [supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111")]);
  const selection = selectTypedInferenceOffer(market, considerationPolicy);
  const terms = [];
  const compiled = await compileSelectedInferenceContract(selection, demand, { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" }, AT, { conform: async ({ term, expectedType }) => {
    terms.push(term);
    return conformTerm({ term, expectedType });
  } });
  const bundle = terms[1];
  assert.deepEqual(Object.keys(effectCellOfTerm(bundle[1])).sort(), ["caller", "evidenceRoot", "measures", "outcome", "parent", "provider"].sort());
  assert.equal(bundle[2][0], "pair");
  assert.match(compiled.proposal.term, /^ni:\/\/\/sha-256;/u);
});

test("one obstructed selected provider transport becomes residue without impersonating provider refusal or escalating", async () => {
  const cheap = supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111"), dear = supplier("urn:ame:dear", 9, "0x2222222222222222222222222222222222222222");
  const result = await procureTypedInference({
    residue: { type: "TestResidue" },
    request: { workLot: { id: "urn:lot:refusal", producer: "urn:customer" }, context: { objective: "test selected refusal" }, actuatorTerms: { workType: "classification", requiredCapabilities: ["classification", "json-output"], difficulty: 0.2, considerationPolicy, mode: "dry-run", outputContract: { format: "json" }, agentCards: [] } },
    suppliers: [cheap, dear], caller: { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" }, customerServices: {}, record: false, now: AT, conform,
    invokeProvider: async (message) => { if (message.metadata.providerAccount.endsWith("1111111111111111111111111111111111111111")) throw new Error("No valid signatures found on agent card."); return { id: "urn:settlement:dear", completion: "ni:///sha-256;BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", disposition: "completion", candidate: "{}" }; },
  });
  assert.equal(result.disposition, "selected-provider-transport-obstructed");
  assert.equal(result.selection.selected.provider.actor, "urn:ame:cheap");
  assert.deepEqual(result.settlementResidues, [{ provider: "urn:ame:cheap", offer: "urn:offer:urn:ame:cheap", disposition: "settlement-transport-obstruction", detail: "agent-signature-validation-obstructed" }]);
  assert.equal(JSON.stringify(result).includes("No valid signatures"), false);
  assert.equal(result.marketWitnesses.find(({ kind }) => kind === "provider-transport-obstructed").evidence.detail, "agent-signature-validation-obstructed");
  assert.equal(result.marketWitnesses.some(({ kind }) => kind === "provider-refused"), false);
  assert.equal(result.marketWitnesses.some(({ kind }) => kind === "provider-transport-obstructed"), true);
  assert.equal(result.routeDecision, result.marketWitnesses.find(({ kind }) => kind === "route-decided").routeDecision);
  assert.deepEqual(result.marketWitnesses.find(({ kind }) => kind === "route-decided").evidence.executionAuthority, {
    sequential: false, implicitFallbackPermitted: false, speculativeExecutionPermitted: false, maximumProviderAttempts: 1,
  });
});

test("explicit customer cancellation reaches the selected provider and remains customer-owned transport evidence", async () => {
  const cheap = supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111");
  const controller = new AbortController(); controller.abort(new Error("customer canceled settlement"));
  const result = await procureTypedInference({
    residue: { type: "TestResidue" },
    request: { workLot: { id: "urn:lot:cancellation", producer: "urn:customer" }, context: { objective: "test customer cancellation" }, actuatorTerms: { workType: "classification", requiredCapabilities: ["classification", "json-output"], difficulty: 0.2, considerationPolicy, mode: "dry-run", outputContract: { format: "json" }, agentCards: [] } },
    suppliers: [cheap], caller: { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" }, customerServices: {}, record: false, now: AT, signal: controller.signal, conform,
    invokeProvider: async (_message, _selected, signal) => { assert.equal(signal.aborted, true); throw signal.reason; },
  });
  assert.equal(result.disposition, "selected-provider-transport-obstructed");
  assert.deepEqual(result.settlementResidues, [{ provider: "urn:ame:cheap", offer: "urn:offer:urn:ame:cheap", disposition: "customer-cancelled", detail: "customer canceled settlement" }]);
  assert.equal(result.marketWitnesses.find(({ kind }) => kind === "provider-transport-obstructed").evidence.reason, "customer-cancelled");
  assert.equal(result.marketWitnesses.some(({ kind }) => kind === "provider-refused"), false);
});

test("a provider-authored refusal is distinct evidence and enters expected-resolution pressure", async () => {
  const cheap = supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111");
  const result = await procureTypedInference({
    residue: { type: "TestResidue" },
    request: { workLot: { id: "urn:lot:provider-refusal", producer: "urn:customer" }, context: { objective: "test provider-authored refusal" }, actuatorTerms: { workType: "classification", requiredCapabilities: ["classification", "json-output"], difficulty: 0.2, considerationPolicy, mode: "dry-run", outputContract: { format: "json" }, agentCards: [] } },
    suppliers: [cheap], caller: { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" }, customerServices: {}, record: false, now: AT, conform,
    invokeProvider: async () => ({ disposition: "refusal", completion: "urn:provider-signed:settlement-refusal", reason: "declined-after-contract" }),
  });
  assert.equal(result.disposition, "provider-refusal");
  assert.equal(result.receipt.work.status, "refused");
  assert.equal(result.marketWitnesses.some(({ kind }) => kind === "provider-transport-obstructed"), false);
  const refusal = result.marketWitnesses.find(({ kind }) => kind === "provider-refused");
  assert.equal(refusal.evidence.reason, "declined-after-contract");
  assert.equal(refusal.evidence.receipt, result.receipt.id);
});

test("a terminal provider task error is provider-authored refusal evidence on its first settlement attempt", async () => {
  const terminal = new Error("provider rejected the submitted compact");
  terminal.inputNi = "ni:///sha-256;DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
  terminal.result = { metadata: { resultNi: "ni:///sha-256;EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE" }, parts: [{ content: { $case: "text", value: terminal.message } }] };
  const result = await procureTypedInference({
    residue: { type: "TestResidue" },
    request: { workLot: { id: "urn:lot:first-terminal-refusal", producer: "urn:customer" }, context: { objective: "test first-attempt provider terminal refusal" }, actuatorTerms: { workType: "classification", requiredCapabilities: ["classification", "json-output"], difficulty: 0.2, considerationPolicy, mode: "dry-run", outputContract: { format: "json" }, agentCards: [] } },
    suppliers: [supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111")],
    caller: { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" }, customerServices: {}, record: false, now: AT, conform,
    invokeProvider: async () => { throw terminal; },
  });
  assert.equal(result.disposition, "provider-refusal");
  assert.equal(result.receipt.work.status, "refused");
  assert.equal(result.marketWitnesses.some(({ kind }) => kind === "provider-transport-obstructed"), false);
  assert.equal(result.marketWitnesses.find(({ kind }) => kind === "provider-refused").evidence.reason, terminal.message);
});

test("a terminal SDK result without resultNi is committed through bounded refusal evidence", async () => {
  const terminal = new Error("provider returned a terminal SDK result");
  const sdkPart = Object.assign(Object.create({ sdkPrototype: true }), { content: { $case: "text", value: terminal.message } });
  terminal.result = { status: { message: { parts: [sdkPart] } } };
  const result = await procureTypedInference({
    residue: { type: "TestResidue" },
    request: { workLot: { id: "urn:lot:sdk-terminal-refusal", producer: "urn:customer" }, context: { objective: "test SDK result projection" }, actuatorTerms: { workType: "classification", requiredCapabilities: ["classification", "json-output"], difficulty: 0.2, considerationPolicy, mode: "dry-run", outputContract: { format: "json" }, agentCards: [] } },
    suppliers: [supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111")],
    caller: { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" }, customerServices: {}, record: false, now: AT, conform,
    invokeProvider: async () => { throw terminal; },
  });
  assert.equal(result.disposition, "provider-refusal");
  assert.equal(result.receipt.work.status, "refused");
  assert.match(result.settlement.completion, /^ni:\/\/\/sha-256;/u);
});

test("customer contract compilation obstruction is never attributed to an uncontacted provider", async () => {
  let invoked = false;
  const result = await procureTypedInference({
    residue: { type: "TestResidue" },
    request: { workLot: { id: "urn:lot:compile-obstruction", producer: "urn:customer" }, context: { objective: "test customer compilation boundary" }, actuatorTerms: { workType: "classification", requiredCapabilities: ["classification", "json-output"], difficulty: 0.2, considerationPolicy, mode: "dry-run", outputContract: { format: "json" }, agentCards: [] } },
    suppliers: [supplier("urn:ame:cheap", 3, "0x1111111111111111111111111111111111111111")],
    caller: { actor: "urn:ame:customer", account: "eip155:31337:0x3333333333333333333333333333333333333333" }, customerServices: {}, record: false, now: AT,
    conform: async () => { throw new Error("customer conformance service unavailable"); },
    invokeProvider: async () => { invoked = true; },
  });
  assert.equal(invoked, false);
  assert.equal(result.disposition, "contract-boundary-obstructed");
  assert.equal(result.providerSettlementAttempts, 0);
  assert.equal(result.marketWitnesses.some(({ kind }) => kind === "provider-attempted" || kind === "provider-transport-obstructed"), false);
  const obstruction = result.marketWitnesses.find(({ kind }) => kind === "contract-boundary-obstructed");
  assert.equal(obstruction.evidence.detail, "customer conformance service unavailable");
  assert.equal(result.settlementResidues[0].detail, obstruction.evidence.detail);
  assert.equal(JSON.stringify(result).includes("typed-inference-procurement.mjs"), false);
});

test("a durable pending provider task resumes the exact compact without another offer solicitation or selection", async () => {
  const pending = await pendingProcurement();
  let resumed = 0;
  const result = await resumePendingTypedInference({
    ...pending, record: false, now: "2026-07-19T21:01:00.000Z",
    resume: async ({ agentUrl, taskId, requireSignature }) => {
      resumed += 1;
      // sendSenTask/resumeSenTask address a provider by its bare origin, not
      // its declared "/.well-known/agent-card.json" admission URL.
      assert.equal(agentUrl, new URL(demand.agentCards["urn:ame:cheap"]).origin);
      assert.equal(taskId, "opaque-pending-task");
      assert.equal(requireSignature, true);
      return { outputNi: "ni:///sha-256;BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", result: { metadata: { resultNi: "ni:///sha-256;BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" }, parts: [{ content: { $case: "text", value: "candidate bytes" } }] } };
    },
  });
  assert.equal(resumed, 1);
  assert.equal(result.disposition, "candidate-pending-customer-assay");
  assert.equal(result.contract.compact.id, pending.procurement.contract.compact.id);
  assert.equal(result.selection.selected.offer.id, pending.procurement.selection.selected.offer.id);
  assert.equal(result.receipt.work.status, "fulfilled");
  assert.equal(result.marketWitnesses.at(-1).kind, "provider-delivered-candidate");
  assert.equal(result.marketWitnesses.at(-1).prior, pending.procurement.marketWitnesses.at(-1).id);
  assert.equal(result.marketWitnesses.some(({ kind }) => kind === "offer-solicited"), true);
  await assert.rejects(() => resumePendingTypedInference({
    ...pending, record: false,
    request: { ...pending.request, context: { objective: "tampered demand" } },
    resume: async () => { throw new Error("must not poll a mismatched compact"); },
  }), /resume demand does not match/u);
});

test("a resumed task that remains pending advances only its durable task coordinate", async () => {
  const pending = await pendingProcurement();
  const error = new Error("still pending");
  Object.setPrototypeOf(error, A2aTaskPendingError.prototype);
  error.taskId = "opaque-pending-task";
  error.task = { id: "opaque-pending-task", status: { state: "working" } };
  const result = await resumePendingTypedInference({
    ...pending, record: false,
    resume: async () => { throw error; },
  });
  assert.equal(result.disposition, "provider-task-pending");
  assert.equal(result.receipt, undefined);
  assert.equal(result.settlement.dependency.inputNi, pending.procurement.contract.proposal.term);
  assert.equal(result.marketWitnesses.at(-1).kind, "provider-task-pending");
});

test("a terminal A2A provider failure is receipted as provider refusal while an unknown transport remains unreceipted", async () => {
  const pending = await pendingProcurement();
  const terminal = new Error("provider rejected resumed task");
  terminal.result = { metadata: { resultNi: "ni:///sha-256;CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" }, parts: [{ content: { $case: "text", value: "provider rejected resumed task" } }] };
  const refused = await resumePendingTypedInference({ ...pending, record: false, resume: async () => { throw terminal; } });
  assert.equal(refused.disposition, "provider-refusal");
  assert.equal(refused.receipt.work.status, "refused");
  assert.equal(refused.marketWitnesses.at(-1).kind, "round-exhausted");
  const unknown = await resumePendingTypedInference({ ...pending, record: false, resume: async () => { throw new Error("network lost"); } });
  assert.equal(unknown.disposition, "provider-task-outcome-unknown");
  assert.equal(unknown.receipt, undefined);
  assert.equal(unknown.marketWitnesses.at(-1).kind, "provider-transport-obstructed");
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
  assert.equal(market.refused.length, 1);
  assert.equal(market.refused[0].actor, "urn:ame:cheap");
  assert.equal(market.refused[0].reason, "provider-capacity-invalid");
  assert.match(market.refused[0].solicitation, /^ni:\/\/\/sha-256;/u);
});

test("the direct contracting boundary exports no global batch allocator", () => {
  assert.equal(Object.hasOwn(procurementApi, "allocateTypedInferenceBatch"), false);
});
