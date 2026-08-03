import assert from "node:assert/strict";
import test from "node:test";
import { CODEX_INFERENCE_PROVIDERS, classifyCodexDemand, contractCodexInferenceWork, recordCodexInferenceOutcome } from "../src/codex-inference-market.mjs";
import { CLASSIFY_CODEX_DEMAND_INPUT_SCHEMA, CODEX_MCP_SERVER_INFO, CONTRACT_INFERENCE_WORK_INPUT_SCHEMA } from "../src/codex-mcp-contract.mjs";
import { DIRECT_WITNESS_ADAPTER, DIRECT_WITNESS_SETTLEMENT_CAPABILITY, RESOLUTION_CREDIT_ASSET, RESOLUTION_CREDIT_UNIT } from "../src/consideration.mjs";

const CONSIDERATION_POLICY = {
  type: "ConsiderationPolicy",
  acceptableAlternatives: [{ id: "test-credit", obligations: [{ kind: "credit", asset: RESOLUTION_CREDIT_ASSET, unit: RESOLUTION_CREDIT_UNIT, settlementCapabilities: [DIRECT_WITNESS_SETTLEMENT_CAPABILITY] }] }],
};

const INPUT = {
  objective: "Identify the smallest operation boundary that should become an provider.",
  context: "The supplied bounded source excerpt advertises normalization and equivalence through one operation.",
  workType: "inquiry",
  difficulty: 0.4,
  considerationPolicy: CONSIDERATION_POLICY,
  outputSchema: {
    type: "object",
    required: ["operation", "basis"],
    properties: { operation: { type: "string" }, basis: { type: "string" } },
    additionalProperties: false,
  },
};

test("the MCP contract derives its version without publishing a customer-global extent ceiling", () => {
  assert.equal(CODEX_MCP_SERVER_INFO.version, "4.2.0");
  assert.equal(CONTRACT_INFERENCE_WORK_INPUT_SCHEMA.difficulty.safeParse(0).success, true);
  assert.equal(CONTRACT_INFERENCE_WORK_INPUT_SCHEMA.difficulty.safeParse(1).success, true);
  assert.equal(CONTRACT_INFERENCE_WORK_INPUT_SCHEMA.difficulty.safeParse(1.1).success, false);
  assert.equal(Object.hasOwn(CONTRACT_INFERENCE_WORK_INPUT_SCHEMA, "maxTokens"), false);
  assert.equal(CONTRACT_INFERENCE_WORK_INPUT_SCHEMA.routingProfile.safeParse("bounded").success, true);
  assert.equal(CONTRACT_INFERENCE_WORK_INPUT_SCHEMA.routingProfile.safeParse("unbounded").success, false);
  assert.equal(CONTRACT_INFERENCE_WORK_INPUT_SCHEMA.workLotId.safeParse("urn:work-lot:test").success, true);
  assert.equal(CONTRACT_INFERENCE_WORK_INPUT_SCHEMA.workLotId.safeParse("work-lot-test").success, false);
  assert.equal(CLASSIFY_CODEX_DEMAND_INPUT_SCHEMA.demandClass.safeParse("mechanical").success, true);
  assert.equal(CLASSIFY_CODEX_DEMAND_INPUT_SCHEMA.demandClass.safeParse("ambient").success, false);
});

test("a Codex lot carries only the customer's explicit cancellation authority", async () => {
  let observed;
  const customer = new AbortController();
  await contractCodexInferenceWork(INPUT, {
    signal: customer.signal,
    procure: async (args) => { observed = args; return { disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }; },
  });
  assert.equal(observed.signal, customer.signal);
  assert.equal(observed.signal.aborted, false);
});

test("demand classification spends no inference and routes every inference class to the market", () => {
  assert.deepEqual(classifyCodexDemand({ demandClass: "mechanical" }), { disposition: "customer-local-deterministic", inferenceCalls: 0, contextAccepted: false, nextAct: "Use a customer-local deterministic command, parser, formatter, test, or exact file operation." });
  assert.equal(classifyCodexDemand({ demandClass: "bounded-derivation", difficulty: 0.4, contextCharacters: 12000 }).disposition, "contract-market-lot");
  const premium = classifyCodexDemand({ demandClass: "premium-review", difficulty: 0.5, contextCharacters: 12000 });
  assert.equal(premium.disposition, "contract-market-lot"); assert.equal(premium.inferenceCalls, 0);
});

function completedProcurement(args, provider = args.suppliers[0]) {
  const consideration = { providerAlternative: "test-credit", policyAlternative: "test-credit", preferenceRank: 0, obligations: [{ id: "test-credit", kind: "credit", asset: RESOLUTION_CREDIT_ASSET, amount: 7, unit: RESOLUTION_CREDIT_UNIT, settlementAdapter: DIRECT_WITNESS_ADAPTER }] };
  const offer = { id: `urn:offer:${provider.id}`, object: { model: `${provider.id}-model` } };
  const selected = { provider, offer };
  return {
    type: "TypedRmnInferenceProcurement",
    disposition: "candidate-pending-customer-assay",
    demand: { type: "TypedRmnInferenceDemand" },
    selection: { selected, selectedConsideration: consideration, ranked: [{ ...selected, consideration }], selectionRule: "test-cheapest-feasible" },
    contract: { compact: { id: "ni:///sha-256;compact" }, proposal: { term: "ni:///sha-256;provider-proposal" } },
    settlement: { candidate: '{"operation":"equivalence","basis":"independently contractible assay"}', completion: "ni:///sha-256;completion" },
    receipt: { id: "ni:///sha-256;receipt" },
  };
}

test("Codex work lots expose all competing providers without prematurely rewarding schema-valid delivery", async () => {
  let observed, closeInput, acceptedOutcomeObservation = null, registeredDelivery;
  const result = await contractCodexInferenceWork({ ...INPUT, taskClass: "acceptance-artifact/x402-boundary" }, {
    pricingService: "http://pricing.example/",
    observe: async (_endpoint, value) => { acceptedOutcomeObservation = value; },
    registerDelivery: async (_endpoint, value) => { registeredDelivery = value; },
    procure: async (args) => { observed = args; return completedProcurement(args); },
    assay: () => ({ accepted: true, id: "ni:///sha-256;assay", problems: [], candidateValue: { operation: "equivalence", basis: "independently contractible assay" } }),
    close: (input) => { closeInput = input; return { id: "ni:///sha-256;consideration-close", disposition: "credit-issued" }; },
  });
  assert.deepEqual(observed.suppliers.map(({ actor }) => actor), CODEX_INFERENCE_PROVIDERS.map(({ actor }) => actor));
  assert.equal(observed.request.actuatorTerms.agentCards.length, CODEX_INFERENCE_PROVIDERS.length);
  assert.equal(observed.request.actuatorTerms.taskClass, "acceptance-artifact/x402-boundary");
  assert.deepEqual(observed.request.actuatorTerms.considerationPolicy, INPUT.considerationPolicy);
  assert.equal(result.outcome, "candidate-pending-codex-acceptance");
  assert.equal(result.integrationAccepted, false);
  assert.equal(result.acceptanceScope, "delivery-to-codex-customer-office-only");
  assert.equal(result.receiverAcceptanceRequired, true);
  assert.match(result.nextAct, /later effect on another Actor crosses into that Actor's induction boundary/u);
  assert.equal(result.evidence.compact, "ni:///sha-256;compact");
  assert.equal(result.evidence.receipt, "ni:///sha-256;receipt");
  assert.deepEqual(result.candidate, { operation: "equivalence", basis: "independently contractible assay" });
  assert.equal(acceptedOutcomeObservation, null);
  assert.deepEqual(registeredDelivery, { workLot: result.workLot, provider: result.provider, taskClass: "acceptance-artifact/x402-boundary", selectedOffer: result.evidence.selectedOffer, receipt: result.receipt.id, receiver: "urn:ame:bare-cedar-fog-codex" });
  assert.deepEqual(closeInput, { type: "TypedRmnInferenceProcurement", disposition: "candidate-pending-customer-assay", compact: { id: "ni:///sha-256;compact" }, receipt: { id: "ni:///sha-256;receipt" }, settlement: "ni:///sha-256;completion" });
});

test("only an explicit receiver outcome changes future provider pressure", async () => {
  let observed;
  const input = { workLot: "urn:lot:one", provider: "urn:ame:provider-a", taskClass: "code-review", selectedOffer: "urn:offer:one", receipt: "urn:receipt:one", receiver: "urn:ame:codex", outcome: "accepted", evidence: "urn:receiver-assay:1" };
  const result = await recordCodexInferenceOutcome(input, {
    pricingService: "http://pricing.example/",
    observe: async (endpoint, value) => { observed = { endpoint, value }; return { id: "urn:observation:1", ...value }; },
  });
  assert.deepEqual(observed, { endpoint: "http://pricing.example/", value: input });
  assert.equal(result.providerSelectionMayChange, true);
  await assert.rejects(() => recordCodexInferenceOutcome({ workLot: "urn:lot:invalid", provider: "urn:ame:provider-a", taskClass: "code-review", selectedOffer: "urn:offer:invalid", receipt: "urn:receipt:invalid", receiver: "urn:ame:codex", outcome: "schema-valid", evidence: "urn:schema:1" }, { pricingService: "http://pricing.example/" }), /accepted or refused/u);
});

test("excluding every advertised provider refuses before procurement", async () => {
  let procurementCalled = false;
  await assert.rejects(() => contractCodexInferenceWork({
    ...INPUT,
    workType: "code-review",
    excludeProviders: CODEX_INFERENCE_PROVIDERS.map(({ actor }) => actor),
  }, {
    procure: async () => { procurementCalled = true; throw new Error("must not procure"); },
  }), /excluded every advertised provider/u);
  assert.equal(procurementCalled, false);
});

test("market residue and provider-refused context remain explicit without a customer-global extent ceiling", async () => {
  const residue = await contractCodexInferenceWork(INPUT, { procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [{ actor: "urn:ame:test", reason: "unavailable" }] } }) });
  assert.equal(residue.outcome, "market-residue");
  assert.equal(residue.integrationAccepted, false);
  const large = await contractCodexInferenceWork({ ...INPUT, context: "x".repeat(160_001) }, { procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [{ actor: "urn:ame:test", reason: "demand-exceeds-provider-bound" }] } }) });
  assert.equal(large.refusedOffers[0].reason, "demand-exceeds-provider-bound");
  await assert.rejects(() => contractCodexInferenceWork({ ...INPUT, considerationPolicy: { type: "ConsiderationPolicy", acceptableAlternatives: [] } }), /acceptableAlternatives/u);
  await assert.rejects(() => contractCodexInferenceWork({ ...INPUT, considerationPolicy: { type: "ConsiderationPolicy", acceptableAlternatives: [{ id: "barter", obligations: [{ kind: "service", asset: "urn:union:service:bounded-inference-reciprocity", unit: "bounded-lot", settlementCapabilities: [DIRECT_WITNESS_SETTLEMENT_CAPABILITY] }] }] } }), /Codex consideration/u);
});

test("a purchased selected-provider refusal updates the hired pricing service", async () => {
  let observation;
  const provider = CODEX_INFERENCE_PROVIDERS[0];
  const consideration = { obligations: [{ amount: 7, unit: RESOLUTION_CREDIT_UNIT }] };
  const residue = await contractCodexInferenceWork(INPUT, {
    pricingService: "http://pricing.example/",
    observeRefusal: async (endpoint, value) => { observation = { endpoint, value }; },
    procure: async () => ({
      disposition: "selected-provider-refused",
      selection: { disposition: "provider-selected", selected: { provider, offer: { id: "urn:offer:refused", object: { model: "refused-model" } } }, selectionRule: "expected-resolution", ranked: [{ provider, offer: { id: "urn:offer:refused", object: { model: "refused-model" } }, consideration }] },
      settlementResidues: [{ provider: provider.actor, offer: "urn:offer:refused", disposition: "provider-refusal", reason: "provider could not deliver this lot" }],
      market: { admitted: [], refused: [] },
    }),
  });
  assert.equal(observation.endpoint, "http://pricing.example/");
  assert.equal(observation.value.provider, provider.actor);
  assert.equal(observation.value.taskClass, "inquiry");
  assert.equal(observation.value.selectedOffer, "urn:offer:refused");
  assert.equal(observation.value.disposition, "provider-refusal");
  assert.match(observation.value.evidence, /^ni:\/\/\/sha-256;/u);
  assert.equal(residue.provider, provider.actor);
  assert.equal(residue.selectedOffer, "urn:offer:refused");
  assert.equal(residue.selectionRule, "expected-resolution");
  assert.deepEqual(residue.rankedFeasibleOffers, [{ provider: provider.actor, offer: "urn:offer:refused", model: "refused-model", consideration }]);
});

test("finite context beyond the old controller hint reaches provider feasibility without rerouting", async () => {
  let observed;
  await contractCodexInferenceWork({ ...INPUT, context: "x".repeat(160_001) }, {
    procure: async (args) => {
      observed = args;
      return { disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } };
    },
  });
  assert.equal(observed.request.context.suppliedContext.length, 160_001);
  assert.equal(observed.request.context.routingProfile, undefined);
});

test("an optional customer rationale survives an extended market route", async () => {
  let observed;
  await contractCodexInferenceWork({ ...INPUT, routingProfile: "extended", extendedRoutingRationale: "The requested output is a multi-file review requiring a supplier that advertises the necessary capacity." }, {
    procure: async (args) => { observed = args; return completedProcurement(args); },
    assay: () => ({ accepted: true, id: "ni:///sha-256;assay", problems: [], candidateValue: { operation: "equivalence", basis: "independently contractible assay" } }),
    close: () => ({ id: "ni:///sha-256;consideration-close", disposition: "credit-issued" }),
  });
  assert.equal(observed.request.context.routingProfile, "extended");
  assert.match(observed.request.context.extendedRoutingRationale, /multi-file review/u);
});

test("provider-side schema enforcement is optional because customer assay remains authoritative", async () => {
  let observed;
  await contractCodexInferenceWork({ ...INPUT, enforceProviderSchema: false }, {
    procure: async (args) => {
      observed = args;
      return { disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } };
    },
  });
  assert.ok(observed.request.actuatorTerms.requiredCapabilities.includes("inquiry"));
  assert.ok(!observed.request.actuatorTerms.requiredCapabilities.includes("json-schema-output"));
  assert.equal(observed.request.actuatorTerms.outputContract.mode, undefined);
});
