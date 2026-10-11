import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileJsonSchema } from "@red-cup-engineering/json-schema-services-section/validation";
import { ADMITTED_CUSTOMERS, CODEX_CUSTOMER, INFERENCE_PROVIDERS, classifyInferenceDemand, dispatchInferenceAsConfiguredCustomer, providerAgentCardOverrides, recordInferenceOutcome } from "../../src/dispatch/inference-dispatch.mjs";
import { CLASSIFY_INFERENCE_DEMAND_INPUT_SCHEMA, MCP_SERVER_INFO, DISPATCH_INFERENCE_INPUT_SCHEMA } from "../../src/dispatch/inference-dispatch-mcp-contract.mjs";
import { DIRECT_WITNESS_ADAPTER, DIRECT_WITNESS_SETTLEMENT_CAPABILITY, RESOLUTION_CREDIT_ASSET, RESOLUTION_CREDIT_UNIT } from "../../src/dispatch/consideration.mjs";
import { formContextPacket, ni } from "../../src/dispatch/context-packet.mjs";

const CONSIDERATION_POLICY = {
  type: "ConsiderationPolicy",
  acceptableAlternatives: [{ id: "test-credit", obligations: [{ kind: "credit", asset: RESOLUTION_CREDIT_ASSET, unit: RESOLUTION_CREDIT_UNIT, settlementCapabilities: [DIRECT_WITNESS_SETTLEMENT_CAPABILITY] }] }],
};
// Provider admission runs on tool turns as well as packet requests. Fixtures
// answer the real catalog/account preflight before exercising completion I/O.
const providerCatalog = JSON.parse(readFileSync(new URL("content/openai/providers/catalog.json", import.meta.resolve("@red-cup-engineering/computer-inference-engine/package.json")), "utf8"));
function withProviderPreflight(complete) {
  return async (url, init) => {
    if (String(url) === "https://openrouter.ai/api/v1/key") return Response.json({ data: { is_free_tier: true, usage: 0 } });
    if (String(url) === "https://openrouter.ai/api/v1/models") return Response.json({ data: [...new Set(providerCatalog.rows.map(row => row.defaultModel).filter(model => model?.endsWith(":free")))].map(id => ({ id, pricing: { prompt: "0", completion: "0", request: "0" } })) });
    return complete(url, init);
  };
}
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

// Pins customerActor explicitly so these assertions ignore the ambient env.
const dispatchAsCodex = (input, options) => dispatchInferenceAsConfiguredCustomer(input, { customerActor: CODEX_CUSTOMER, directDescriptors: [], ...options });

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

test("the public dispatcher refuses missing engine effect authority before procurement", async () => {
  let procurements = 0;
  await assert.rejects(dispatchAsCodex(INPUT, {
    allowedEffects: [],
    procure: async () => { procurements++; throw new Error("unauthorized procurement"); },
  }), /EffectRefused/u);
  assert.equal(procurements, 0);
});

function directEntry(actor, endpoint, model, apiKey, considerationNumerator = "1") {
  return {
    actor, endpoint, model, apiKey,
    capabilities: ["chat", "inquiry"],
    authorityScopes: ["urn:scope:bounded-inference-candidate"],
    effects: ["read-only"],
    idempotence: ["idempotent"],
    considerationKind: "quota",
    considerationAsset: "urn:union:consideration:free-tier-inference",
    considerationUnit: "provider-invocation",
    considerationNumerator,
    considerationDenominator: "1",
    declaredResources: [{ resource: "provider-attention", unit: "bounded-lot", amount: { numerator: "1", denominator: "1" } }],
  };
}

test("the MCP contract derives its version without publishing a customer-global extent ceiling", () => {
  const inputSchema = compileJsonSchema(DISPATCH_INFERENCE_INPUT_SCHEMA);
  assert.equal(MCP_SERVER_INFO.version, PACKAGE_VERSION);
  assert.equal(inputSchema.validate({ objective: "fixture", difficulty: 0 }).valid, true);
  assert.equal(inputSchema.validate({ objective: "fixture", difficulty: 1 }).valid, true);
  assert.equal(inputSchema.validate({ objective: "fixture", difficulty: 1.1 }).valid, false);
  assert.equal(Object.hasOwn(DISPATCH_INFERENCE_INPUT_SCHEMA.properties, "maxTokens"), false);
  assert.equal(inputSchema.validate({ objective: "fixture", routingProfile: "bounded" }).valid, true);
  assert.equal(inputSchema.validate({ objective: "fixture", routingProfile: "unbounded" }).valid, false);
  assert.equal(inputSchema.validate({ objective: "fixture", workLotId: "urn:work-lot:test" }).valid, true);
  assert.equal(inputSchema.validate({ objective: "fixture", workLotId: "work-lot-test" }).valid, false);
  assert.equal(inputSchema.validate({ objective: "fixture", taskClass: "knowledge-vault/term-normalization/v1" }).valid, true);
  const classifyInput = compileJsonSchema(CLASSIFY_INFERENCE_DEMAND_INPUT_SCHEMA);
  assert.equal(classifyInput.validate({ demandClass: "mechanical" }).valid, true);
  assert.equal(classifyInput.validate({ demandClass: "ambient" }).valid, false);
});

test("the active market admits MetroPlat and the OpenRouter provider settlement", () => {
  assert.equal(ADMITTED_CUSTOMERS.has("urn:ame:metroplat"), true);
  const openRouter = INFERENCE_PROVIDERS.find(({ actor }) => actor === "urn:ame:openrouter-inference-team");
  assert.deepEqual(openRouter, {
    id: "openrouter-inference-team",
    actor: "urn:ame:openrouter-inference-team",
    agentCard: "http://127.0.0.1:8808/.well-known/agent-card.json",
  });
});

test("deployment may select an admitted OpenRouter face without changing provider identity", () => {
  assert.deepEqual(providerAgentCardOverrides({
    OPENROUTER_INFERENCE_AGENT_CARD: "http://127.0.0.1:8810/.well-known/agent-card.json",
  }), {
    "urn:ame:openrouter-inference-team": "http://127.0.0.1:8810/.well-known/agent-card.json",
  });
});

test("a Codex lot carries only the customer's explicit cancellation authority", async () => {
  let observed;
  const customer = new AbortController();
  await dispatchAsCodex(INPUT, {
    signal: customer.signal,
    procure: async (args) => { observed = args; return { disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }; },
  });
  assert.equal(observed.signal, customer.signal);
  assert.equal(observed.signal.aborted, false);
});

test("demand classification spends no inference and routes every inference class to the market", () => {
  assert.deepEqual(classifyInferenceDemand({ demandClass: "mechanical" }), { disposition: "customer-local-deterministic", inferenceCalls: 0, contextAccepted: false, nextAct: "Use a customer-local deterministic command, parser, formatter, test, or exact file operation." });
  assert.equal(classifyInferenceDemand({ demandClass: "bounded-derivation", difficulty: 0.4, contextCharacters: 12000 }).disposition, "dispatch-provider-lot");
  const premium = classifyInferenceDemand({ demandClass: "premium-review", difficulty: 0.5, contextCharacters: 12000 });
  assert.equal(premium.disposition, "dispatch-provider-lot"); assert.equal(premium.inferenceCalls, 0);
});

function completedProcurement(args, provider = args.suppliers[0], { expectedResolutionPrice } = {}) {
  const consideration = { providerAlternative: "test-credit", policyAlternative: "test-credit", preferenceRank: 0, obligations: [{ id: "test-credit", kind: "credit", asset: RESOLUTION_CREDIT_ASSET, amount: 7, unit: RESOLUTION_CREDIT_UNIT, settlementAdapter: DIRECT_WITNESS_ADAPTER }] };
  const offer = { id: `urn:offer:${provider.id}`, object: { model: `${provider.id}-model` } };
  const selected = { provider, offer };
  return {
    type: "TypedSenInferenceProcurement",
    disposition: "candidate-pending-customer-assay",
    demand: { type: "TypedSenInferenceDemand" },
    selection: {
      selected, selectedConsideration: consideration,
      ranked: [{ ...selected, consideration, ...(expectedResolutionPrice ? { expectedResolutionPrice } : {}) }],
      selectionRule: "test-cheapest-feasible",
      ...(expectedResolutionPrice ? { selectedExpectedResolutionPrice: expectedResolutionPrice } : {}),
    },
    contract: { compact: { id: "ni:///sha-256;compact" }, proposal: { term: "ni:///sha-256;provider-proposal" } },
    settlement: { candidate: '{"operation":"equivalence","basis":"independently contractible assay"}', completion: "ni:///sha-256;completion" },
    receipt: { id: "ni:///sha-256;receipt" },
  };
}

test("Codex work lots expose all competing providers without prematurely rewarding schema-valid delivery", async () => {
  let observed, closeInput, acceptedOutcomeObservation = null, registeredDelivery;
  const result = await dispatchAsCodex({ ...INPUT, taskClass: "acceptance-artifact/x402-boundary" }, {
    pricingRoot: "http://pricing.example/",
    observe: async (_endpoint, value) => { acceptedOutcomeObservation = value; },
    registerDelivery: async (_endpoint, value) => { registeredDelivery = value; },
    procure: async (args) => { observed = args; return completedProcurement(args); },
    assay: () => ({ accepted: true, id: "ni:///sha-256;assay", problems: [], candidateValue: { operation: "equivalence", basis: "independently contractible assay" } }),
    close: (input) => { closeInput = input; return { id: "ni:///sha-256;consideration-close", disposition: "credit-issued" }; },
  });
  assert.deepEqual(observed.suppliers.map(({ actor }) => actor), INFERENCE_PROVIDERS.map(({ actor }) => actor));
  assert.equal(observed.request.actuatorTerms.agentCards.length, INFERENCE_PROVIDERS.length);
  assert.equal(observed.request.actuatorTerms.taskClass, "acceptance-artifact/x402-boundary");
  assert.deepEqual(observed.request.actuatorTerms.considerationPolicy, INPUT.considerationPolicy);
  assert.equal(result.outcome, "candidate-pending-codex-acceptance");
  assert.equal(result.taskClass, "acceptance-artifact/x402-boundary");
  assert.equal(result.receiver, CODEX_CUSTOMER);
  assert.equal(result.selectedOffer, result.evidence.selectedOffer);
  assert.equal(result.integrationAccepted, false);
  assert.equal(result.acceptanceScope, "delivery-to-codex-customer-office-only");
  assert.equal(result.receiverAcceptanceRequired, true);
  assert.match(result.nextAct, /later effect on another Actor crosses into that Actor's induction boundary/u);
  assert.equal(result.evidence.compact, "ni:///sha-256;compact");
  assert.equal(result.evidence.receipt, "ni:///sha-256;receipt");
  assert.deepEqual(result.candidate, { operation: "equivalence", basis: "independently contractible assay" });
  assert.equal(acceptedOutcomeObservation, null);
  assert.deepEqual(registeredDelivery, { workLot: result.workLot, provider: result.provider, taskClass: "acceptance-artifact/x402-boundary", selectedOffer: result.evidence.selectedOffer, receipt: result.receipt.id, receiver: CODEX_CUSTOMER, configurationIdentity: result.configurationIdentity, configuration: { provider: result.provider, model: result.model, mode: null, agentCard: null, capabilities: [], workTypes: [] } });
  assert.deepEqual(closeInput, { type: "TypedSenInferenceProcurement", disposition: "candidate-pending-customer-assay", compact: { id: "ni:///sha-256;compact" }, receipt: { id: "ni:///sha-256;receipt" }, settlement: "ni:///sha-256;completion" });
});

test("a price-aware market selection carries its computed expected price onto the delivered receipt", async () => {
  const expectedResolutionPrice = { provider: "urn:ame:test-provider", declaredAmount: { numerator: "7", denominator: "1" }, expectedPrice: { numerator: "9", denominator: "1" }, basis: { successfulResolutions: 3, terminalResolutions: 4 } };
  const result = await dispatchAsCodex(INPUT, {
    pricingRoot: "http://pricing.example/",
    registerDelivery: async () => {},
    procure: async (args) => completedProcurement(args, args.suppliers[0], { expectedResolutionPrice }),
    assay: () => ({ accepted: true, id: "ni:///sha-256;assay", problems: [], candidateValue: { operation: "equivalence", basis: "independently contractible assay" } }),
    close: () => ({ id: "ni:///sha-256;consideration-close", disposition: "credit-issued" }),
  });
  assert.deepEqual(result.expectedResolutionPrice, expectedResolutionPrice);
  assert.deepEqual(result.rankedFeasibleOffers[0].expectedResolutionPrice, expectedResolutionPrice);
});

test("only an explicit receiver outcome changes future provider pressure", async () => {
  let observed;
  const input = { workLot: "urn:lot:one", provider: "urn:ame:provider-a", taskClass: "code-review", selectedOffer: "urn:offer:one", receipt: "urn:receipt:one", receiver: "urn:ame:codex", outcome: "accepted", evidence: "urn:receiver-assay:1" };
  const result = await recordInferenceOutcome(input, {
    pricingRoot: "http://pricing.example/",
    observe: async (endpoint, value) => { observed = { endpoint, value }; return { id: "urn:observation:1", ...value }; },
  });
  assert.deepEqual(observed, { endpoint: "http://pricing.example/", value: input });
  assert.equal(result.providerSelectionMayChange, true);
  await assert.rejects(() => recordInferenceOutcome({ workLot: "urn:lot:invalid", provider: "urn:ame:provider-a", taskClass: "code-review", selectedOffer: "urn:offer:invalid", receipt: "urn:receipt:invalid", receiver: "urn:ame:codex", outcome: "schema-valid", evidence: "urn:schema:1" }, { pricingRoot: "http://pricing.example/" }), /accepted or refused/u);
});

test("excluding every advertised provider refuses before procurement", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const directDescriptors = loadDirectEndpointProviderDescriptors();
  let procurementCalled = false;
  await assert.rejects(() => dispatchAsCodex({
    ...INPUT,
    workType: "code-review",
    excludeProviders: [...new Set([...INFERENCE_PROVIDERS.map(({ actor }) => actor), ...directDescriptors.map(({ provider }) => provider)])],
  }, {
    directDescriptors,
    procure: async () => { procurementCalled = true; throw new Error("must not procure"); },
  }), /excluded every advertised provider/u);
  assert.equal(procurementCalled, false);
});

test("market residue and provider-refused context remain explicit without a customer-global extent ceiling", async () => {
  const residue = await dispatchAsCodex(INPUT, { procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [{ actor: "urn:ame:test", reason: "unavailable" }] } }) });
  assert.equal(residue.outcome, "market-residue");
  assert.equal(residue.integrationAccepted, false);
  const large = await dispatchAsCodex({ ...INPUT, context: "x".repeat(160_001) }, { procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [{ actor: "urn:ame:test", reason: "demand-exceeds-provider-bound" }] } }) });
  assert.equal(large.refusedOffers[0].reason, "demand-exceeds-provider-bound");
  await assert.rejects(() => dispatchAsCodex({ ...INPUT, considerationPolicy: { type: "ConsiderationPolicy", acceptableAlternatives: [] } }), /acceptableAlternatives/u);
  await assert.rejects(() => dispatchAsCodex({ ...INPUT, considerationPolicy: { type: "ConsiderationPolicy", acceptableAlternatives: [{ id: "barter", obligations: [{ kind: "service", asset: "urn:union:service:bounded-inference-reciprocity", unit: "bounded-lot", settlementCapabilities: [DIRECT_WITNESS_SETTLEMENT_CAPABILITY] }] }] } }), /customer consideration/u);
});

test("a purchased selected-provider refusal updates the hired pricing service", async () => {
  let observation;
  const provider = INFERENCE_PROVIDERS[0];
  const consideration = { obligations: [{ amount: 7, unit: RESOLUTION_CREDIT_UNIT }] };
  const residue = await dispatchAsCodex(INPUT, {
    pricingRoot: "http://pricing.example/",
    observeRefusal: async (endpoint, value) => { observation = { endpoint, value }; },
    procure: async () => ({
      disposition: "provider-refusal",
      selection: { disposition: "provider-selected", selected: { provider, offer: { id: "urn:offer:refused", object: { model: "refused-model" } } }, selectionRule: "expected-resolution", ranked: [{ provider, offer: { id: "urn:offer:refused", object: { model: "refused-model" } }, consideration }] },
      settlementResidues: [{ provider: provider.actor, offer: "urn:offer:refused", disposition: "provider-refusal", reason: "provider could not deliver this lot", receipt: "ni:///sha-256;provider-refusal-receipt", providerRefusalWitness: "ni:///sha-256;provider-refusal-witness" }],
      market: { admitted: [], refused: [] },
    }),
  });
  assert.equal(observation.endpoint, "http://pricing.example/");
  assert.equal(observation.value.provider, provider.actor);
  assert.equal(observation.value.taskClass, "inquiry");
  assert.equal(observation.value.selectedOffer, "urn:offer:refused");
  assert.equal(observation.value.disposition, "provider-refusal");
  assert.equal(observation.value.refusalReceipt, "ni:///sha-256;provider-refusal-receipt");
  assert.equal(observation.value.providerRefusalWitness, "ni:///sha-256;provider-refusal-witness");
  assert.equal(residue.provider, provider.actor);
  assert.equal(residue.workLot.startsWith("urn:work-lot:inference:"), true);
  assert.equal(residue.taskClass, "inquiry");
  assert.equal(residue.receiver, CODEX_CUSTOMER);
  assert.equal(residue.selectedOffer, "urn:offer:refused");
  assert.equal(residue.receipt, "ni:///sha-256;provider-refusal-receipt");
  assert.equal(residue.selectionRule, "expected-resolution");
  assert.deepEqual(residue.rankedFeasibleOffers, [{ provider: provider.actor, offer: "urn:offer:refused", model: "refused-model", consideration }]);
});

test("finite context beyond the old controller hint reaches provider feasibility without rerouting", async () => {
  let observed;
  await dispatchAsCodex({ ...INPUT, context: "x".repeat(160_001) }, {
    procure: async (args) => {
      observed = args;
      return { disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } };
    },
  });
  assert.equal(observed.request.context.suppliedContext.length, 160_001);
  assert.equal(observed.request.context.routingProfile, undefined);
});

test("the dispatched direct payload compacts only declared stale tool output and preserves correction and failure evidence", async () => {
  const correction = "Founder correction: preserve this constraint verbatim.";
  const stale = `tool failed: EACCES\n${"stale tool output\n".repeat(7_000)}retry refused: EACCES`;
  const recent = `recent tool output ${"fresh ".repeat(18_000)}`;
  const segments = [
    { mediaType: "text/plain", content: correction },
    { mediaType: "text/plain", content: "Pinned operator constraint." },
    { mediaType: "text/plain", content: stale, compaction: { eligibility: "tool-output", isError: true, exitCode: 1 } },
    { mediaType: "text/plain", content: `${recent} newest` , compaction: { eligibility: "tool-output" } },
    { mediaType: "text/plain", content: `${recent} latest`, compaction: { eligibility: "tool-output" } },
  ];
  const objective = "Return one compact evidence-bound answer.";
  const packet = formContextPacket({ objective, createdBy: "urn:ame:bare-cedar-fog-codex", segments, knowledge: segments.map(({ content }) => ({ ni: ni(content), relation: "supports-objective" })) });
  const descriptors = (await import("../../src/dispatch/direct-endpoint-provider.mjs")).loadDirectEndpointProviderDescriptors({ DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([{ ...directEntry("urn:ame:compact-fixture", "http://127.0.0.1:1/v1", "fixture", "fixture"), capabilities: ["chat", "inquiry", "tool-calling"] }]) });
  let providerMessages;
  const { context: _context, ...packetInput } = INPUT;
  const result = await dispatchAsCodex({ ...packetInput, objective, contextPacket: packet, contextOptimization: { maximumInputTokens: 57_500 } }, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }), directDescriptors: descriptors,
    directTransport: async ({ messages }) => { providerMessages = messages; return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ operation: "compact", basis: "fixture" }), model: "fixture", durationMs: 1, invocations: [], exchanges: [] }; },
  });
  const payload = providerMessages.map(({ content }) => content).join("\n");
  assert.match(payload, /Founder correction: preserve this constraint verbatim/u);
  assert.match(payload, /tool failed: EACCES/u);
  assert.match(payload, /retry refused: EACCES/u);
  assert.doesNotMatch(payload, /stale tool output stale tool output stale tool output/u);
  assert.ok(result.contextOptimization.beforeBytes > result.contextOptimization.afterBytes);
  const rawPayloadBytes = Buffer.byteLength(JSON.stringify([
    { role: "system", content: "Return one bounded inference product. This compact confers no receiver mutation, execution, integration, truth, or acceptance authority." },
    { role: "user", content: `${objective}\n\nContext:\n${segments.map(({ content }) => content).join("\n")}` },
  ]));
  assert.ok(Buffer.byteLength(JSON.stringify(providerMessages)) < rawPayloadBytes, "the actual provider payload is smaller than the held-out raw fixture");
  assert.equal(result.contextOptimization.estimated, true);
  assert.equal(result.contextOptimization.rawRecall[0].span.text, stale);
  const secondCustomer = [...ADMITTED_CUSTOMERS].find((actor) => actor !== CODEX_CUSTOMER);
  const second = await dispatchInferenceAsConfiguredCustomer({ ...packetInput, objective, contextPacket: packet, contextOptimization: { maximumInputTokens: 57_500 } }, {
    customerActor: secondCustomer, pricingRoot: null, procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }), directDescriptors: descriptors,
    directTransport: async () => ({ type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ operation: "compact", basis: "fixture" }), model: "fixture", durationMs: 1, invocations: [], exchanges: [] }),
  });
  assert.equal(second.contextOptimization.afterBytes, result.contextOptimization.afterBytes);
  assert.deepEqual(second.contextOptimization.dropped, result.contextOptimization.dropped);
});

test("protected exact input over the declared estimated budget refuses before procurement or provider invocation", async () => {
  let procured = false;
  const result = await dispatchAsCodex({ ...INPUT, contextOptimization: { mode: "exact", maximumInputTokens: 2 } }, {
    procure: async () => { procured = true; throw new Error("must not procure"); },
    directDescriptors: [{ provider: "urn:ame:must-not-call" }], directTransport: async () => { throw new Error("must not invoke"); },
  });
  assert.equal(result.outcome, "context-overflow");
  assert.equal(procured, false);
  assert.equal(result.contextOptimization.mode, "exact");
  const automatic = await dispatchAsCodex({ ...INPUT, contextOptimization: { maximumInputTokens: 2 } }, {
    procure: async () => { throw new Error("protected content must not reach procurement"); },
    directDescriptors: [{ provider: "urn:ame:must-not-call" }], directTransport: async () => { throw new Error("protected content must not invoke"); },
  });
  assert.equal(automatic.outcome, "context-overflow");
  assert.equal(automatic.contextOptimization.dropped.length, 0);
});

test("an optional customer rationale survives an extended market route", async () => {
  let observed;
  await dispatchAsCodex({ ...INPUT, routingProfile: "extended", extendedRoutingRationale: "The requested output is a multi-file review requiring a supplier that advertises the necessary capacity." }, {
    procure: async (args) => { observed = args; return completedProcurement(args); },
    assay: () => ({ accepted: true, id: "ni:///sha-256;assay", problems: [], candidateValue: { operation: "equivalence", basis: "independently contractible assay" } }),
    close: () => ({ id: "ni:///sha-256;consideration-close", disposition: "credit-issued" }),
  });
  assert.equal(observed.request.context.routingProfile, "extended");
  assert.match(observed.request.context.extendedRoutingRationale, /multi-file review/u);
});

test("provider-side schema enforcement is optional because customer assay remains authoritative", async () => {
  let observed;
  await dispatchAsCodex({ ...INPUT, enforceProviderSchema: false }, {
    procure: async (args) => {
      observed = args;
      return { disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } };
    },
  });
  assert.ok(observed.request.actuatorTerms.requiredCapabilities.includes("inquiry"));
  assert.ok(!observed.request.actuatorTerms.requiredCapabilities.includes("json-schema-output"));
  assert.equal(observed.request.actuatorTerms.outputContract.mode, undefined);
});

test("direct endpoint descriptors load from one JSON array with apiKeyEnv resolution", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([
      directEntry("urn:ame:local-ollama-team", "http://127.0.0.1:11434/v1/chat/completions", "gemma3:4b", "ollama"),
      { ...directEntry("urn:ame:groq-inference-team", "https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile", undefined), apiKeyEnv: "TEST_GROQ_KEY" },
      { actor: "urn:ame:unconfigured-team", endpoint: "https://example.test/v1", model: "m" },
    ]),
    TEST_GROQ_KEY: "k-groq",
  });
  assert.equal(descriptors.length, 2);
  assert.equal(descriptors[0].provider, "urn:ame:local-ollama-team");
  assert.equal(descriptors[1].apiKey, "k-groq");
  assert.throws(() => loadDirectEndpointProviderDescriptors({ DIRECT_ENDPOINT_PROVIDERS: "not json" }));
});

test("an empty A2A market falls through to the direct endpoint lane and assays the candidate against the customer schema", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([{ ...directEntry("urn:ame:stub-direct-team", "http://127.0.0.1:1/v1", "stub-model", "stub"), capabilities: ["chat", "inquiry", "tool-calling"] }]),
  });
  const calls = [];
  const tool = { type: "function", function: { name: "resource_health", parameters: { type: "object", additionalProperties: false } } };
  const toolHandler = async () => ({ ollama: "ready" });
  const result = await dispatchAsCodex(INPUT, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [{ actor: "urn:ame:test", reason: "solicitation-transport-obstructed" }] } }),
    directDescriptors: descriptors,
    directTransport: async (call) => {
      calls.push(call);
      return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ operation: "normalize", basis: "the excerpt's one advertised operation" }), model: "stub-model", durationMs: 5, invocations: [{ id: "call-1", name: "resource_health", arguments: {}, result: { ollama: "ready" } }], exchanges: [{ finishReason: "tool_calls", usage: { promptTokens: 11, outputTokens: 3, totalTokens: 14 } }, { finishReason: "stop", usage: { promptTokens: 15, outputTokens: 5, totalTokens: 20 } }] };
    },
    directTools: [tool],
    directToolHandlers: { resource_health: toolHandler },
  });
  assert.equal(result.outcome, "candidate-pending-codex-acceptance");
  assert.equal(result.provider, "urn:ame:stub-direct-team");
  assert.equal(result.selectionRule, "direct-endpoint-customer-ordered-pareto-route-after-a2a-market-residue");
  assert.equal(result.selectedOffer.includes("urn:ame:stub-direct-team"), true);
  assert.equal(result.customerAssay, "output-schema-accepted");
  assert.deepEqual(result.declaredResources, [{ resource: "provider-attention", unit: "bounded-lot", amount: { numerator: "1", denominator: "1" } }]);
  assert.equal(result.durationMs, 5);
  assert.equal(result.providerEvidence.toolInvocations[0].name, "resource_health");
  assert.equal(result.providerEvidence.exchanges.length, 2);
  assert.deepEqual(result.providerEvidence.tokenUsage, [{ promptTokens: 11, outputTokens: 3, totalTokens: 14 }, { promptTokens: 15, outputTokens: 5, totalTokens: 20 }]);
  assert.deepEqual(result.candidate, { operation: "normalize", basis: "the excerpt's one advertised operation" });
  assert.equal(result.integrationAccepted, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, "http://127.0.0.1:1/v1");
  assert.deepEqual(calls[0].tools, [tool]);
  assert.equal(calls[0].toolHandlers.resource_health, toolHandler);
});

test("an explicitly granted MCP tool completes one constrained direct dispatch loop", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const { executeOpenAiCompatibleToolAgent } = await import("@red-cup-engineering/computer-inference-engine/openai/tool-agent");
  const descriptors = loadDirectEndpointProviderDescriptors({ API_KEY_OPENROUTER: "fixture-key" }).filter(({ zeroCashEligible }) => zeroCashEligible);
  const toolCalls = [];
  const client = {
    async listTools() { return { tools: [{ name: "agent_work_dispatch", description: "Read admitted work", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } }, additionalProperties: false } }] }; },
    async callTool({ name, arguments: args }) {
      toolCalls.push({ name, arguments: args });
      return { content: [{ type: "text", text: "The work is admitted." }], structuredContent: { status: "admitted" } };
    },
  };
  let exchanges = 0;
  const result = await dispatchAsCodex({ ...INPUT, agentBounds: { maximumRequests: 2, maximumToolCalls: 1, maximumOutputTokens: 64, maximumTokensPerRequest: 32 } }, {
    pricingRoot: null,
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directMcp: { client, allowlist: ["agent_work_dispatch"], maximumPages: 1 },
    directTransport: async (call) => executeOpenAiCompatibleToolAgent({ ...call, fetchImpl: withProviderPreflight(async () => {
      const message = exchanges++ === 0
        ? { role: "assistant", tool_calls: [{ id: "work-1", type: "function", function: { name: "agent_work_dispatch", arguments: JSON.stringify({ id: "federated-compute-resource-placement-2026-09-07" }) } }] }
        : { role: "assistant", content: JSON.stringify({ operation: "agent-work-dispatch", basis: "the admitted work status" }) };
      return new Response(JSON.stringify({ model: call.model, usage: { prompt_tokens: 9, completion_tokens: 7, total_tokens: 16 }, choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] }), { status: 200 });
    }) }),
  });
  assert.equal(result.outcome, "candidate-pending-codex-acceptance");
  assert.deepEqual(toolCalls, [{ name: "agent_work_dispatch", arguments: { id: "federated-compute-resource-placement-2026-09-07" } }]);
  assert.equal(result.providerEvidence.toolInvocations.length, 1);
  assert.equal(result.providerEvidence.toolInvocations[0].result.structuredContent.status, "admitted");
  assert.equal(result.providerEvidence.exchanges.length, 2);
  assert.equal(result.providerEvidence.sharedBudgetRemaining.requests, 0);
});

test("an MCP name collision refuses before procurement, provider, or tool execution", async () => {
  let procured = false;
  let providerCalled = false;
  let handlerCalled = false;
  const client = {
    async listTools() { return { tools: [{ name: "read_work", inputSchema: { type: "object" } }] }; },
    async callTool() { handlerCalled = true; },
  };
  await assert.rejects(dispatchAsCodex(INPUT, {
    directMcp: { client, allowlist: ["read_work"] },
    directTools: [{ type: "function", function: { name: "read_work", parameters: { type: "object" } } }],
    directToolHandlers: { read_work: () => { handlerCalled = true; } },
    procure: async () => { procured = true; },
    directTransport: async () => { providerCalled = true; },
  }), /receiver tool name collision: read_work/u);
  assert.equal(procured, false);
  assert.equal(providerCalled, false);
  assert.equal(handlerCalled, false);
});

test("receiver tools require tool-calling provider capability and discovery failure reaches no inference", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({ API_KEY_OPENROUTER: "fixture-key" })
    .filter(({ zeroCashEligible }) => zeroCashEligible)
    .map((descriptor) => ({ ...descriptor, capabilities: descriptor.capabilities.filter((capability) => capability !== "tool-calling") }));
  const client = { async listTools() { return { tools: [{ name: "read_work", inputSchema: { type: "object" } }] }; }, async callTool() { assert.fail("provider capability refusal must precede tool invocation"); } };
  let providerCalls = 0;
  const result = await dispatchAsCodex({ ...INPUT, agentBounds: { maximumRequests: 1, maximumToolCalls: 1, maximumOutputTokens: 16 } }, {
    pricingRoot: null,
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directMcp: { client, allowlist: ["read_work"] },
    directTransport: async () => { providerCalls += 1; },
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.outcome, "market-residue");
  assert.match(result.directLaneRefusals[0].reason, /tool-calling/u);

  let procured = false;
  await assert.rejects(dispatchAsCodex(INPUT, {
    directMcp: { client: { async listTools() { throw new Error("discovery unavailable"); }, async callTool() {} }, allowlist: ["read_work"] },
    procure: async () => { procured = true; },
    directTransport: async () => { assert.fail("inference must not run after discovery failure"); },
  }), /discovery unavailable/u);
  assert.equal(procured, false);
});

test("excludeProviders bars a provider on the direct lane too, not only in the A2A market", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([
      directEntry("urn:ame:cheap-team", "http://127.0.0.1:1/v1", "m1", "a", "1"),
      directEntry("urn:ame:dear-team", "http://127.0.0.1:2/v1", "m2", "b", "5"),
    ]),
  });
  const calls = [];
  const result = await dispatchAsCodex({ ...INPUT, excludeProviders: ["urn:ame:cheap-team"] }, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async (call) => {
      calls.push(call);
      return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ operation: "normalize", basis: "b" }), model: call.model, durationMs: 1, invocations: [], exchanges: [{ finishReason: "stop", usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 } }] };
    },
  });
  assert.equal(result.provider, "urn:ame:dear-team");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, "http://127.0.0.1:2/v1");
});

test("direct lane selects the lower-consideration adequate provider without a provider name in demand", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([
      directEntry("urn:ame:expensive-team", "http://127.0.0.1:1/v1", "m1", "a", "5"),
      directEntry("urn:ame:cheap-team", "http://127.0.0.1:2/v1", "m2", "b", "1"),
    ]),
  });
  const result = await dispatchAsCodex(INPUT, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async (call) => {
      return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ operation: "o", basis: "b" }), model: "m2", durationMs: 2 };
    },
  });
  assert.equal(result.provider, "urn:ame:cheap-team");
  assert.equal(result.consideration[0].amount.numerator, "1");
  assert.equal(result.directLaneRefusals.length, 0);
});

test("direct lane follows the route attempt plan when the cheapest adequate offer fails", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([
      directEntry("urn:ame:backup-team", "http://127.0.0.1:2/v1", "backup", "b", "2"),
      directEntry("urn:ame:free-team", "http://127.0.0.1:1/v1", "free", "a", "1"),
    ]),
  });
  const calls = [];
  const result = await dispatchAsCodex(INPUT, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async (call) => {
      calls.push(call.provider);
      if (call.provider === "urn:ame:free-team") throw new Error("free capacity exhausted");
      return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ operation: "o", basis: "b" }), model: "backup", durationMs: 4 };
    },
  });
  assert.deepEqual(calls, ["urn:ame:free-team", "urn:ame:backup-team"]);
  assert.equal(result.provider, "urn:ame:backup-team");
  assert.deepEqual(result.directLaneRefusals, [{ provider: "urn:ame:free-team", reason: "free capacity exhausted" }]);
});

test("a schema-invalid direct candidate returns the market residue carrying the direct lane refusal", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry("urn:ame:sloppy-team", "http://127.0.0.1:3/v1", "m", "k")]),
  });
  const result = await dispatchAsCodex(INPUT, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async () => ({ type: "ReceiverOwnedToolAgentCompletion", text: "not json at all", model: "m", durationMs: 1 }),
  });
  assert.equal(result.outcome, "market-residue");
  assert.equal(result.directLaneRefusals.length, 1);
  assert.ok(typeof result.directLaneRefusals[0].reason === "string" && result.directLaneRefusals[0].reason.length > 0);
});

test("a typed direct-provider residue reaches the market residue with its completed exchange evidence", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry("urn:ame:residue-team", "http://127.0.0.1:4/v1", "residue-model", "k")]),
  });
  const cause = { kind: "http", reason: "provider-refused", status: 429 };
  const invocations = [{ id: "call-1", name: "resource_health", arguments: {}, result: { ready: true } }];
  const exchanges = [{ finishReason: "tool_calls", usage: { promptTokens: 11, outputTokens: 3, totalTokens: 14 } }];
  const result = await dispatchAsCodex(INPUT, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async () => ({
      type: "ReceiverOwnedToolAgentResidue",
      disposition: "provider-exchange-failed",
      provider: "urn:ame:residue-team",
      model: "residue-model",
      cause,
      invocations,
      exchanges,
      durationMs: 8,
    }),
  });
  assert.equal(result.outcome, "market-residue");
  assert.equal(result.integrationAccepted, false);
  const measuredResources = {
    scope: { providerIdentity: "urn:ame:residue-team", accountIdentity: null, windowIdentity: null, measurementCoverage: "completed-exchanges" },
    resources: [
      { resource: "requests", unit: "request", amount: { numerator: "1", denominator: "1" } },
      { resource: "input-tokens", unit: "token", amount: { numerator: "11", denominator: "1" } },
      { resource: "output-tokens", unit: "token", amount: { numerator: "3", denominator: "1" } },
      { resource: "duration", unit: "millisecond", amount: { numerator: "8", denominator: "1" } },
    ],
    partialResources: [], callerObservedResources: [], uncertainty: ["account-window-identity-unknown"],
  };
  assert.deepEqual(result.directLaneRefusals, [{
    provider: "urn:ame:residue-team",
    model: "residue-model",
    selectedOffer: result.directLaneRefusals[0].selectedOffer,
    reason: "provider-exchange-failed",
    cause,
    consideration: [{ kind: "quota", asset: "urn:union:consideration:free-tier-inference", unit: "provider-invocation", amount: { numerator: "1", denominator: "1" } }],
    declaredResources: [{ resource: "provider-attention", unit: "bounded-lot", amount: { numerator: "1", denominator: "1" } }],
    durationMs: 8,
    measuredResources,
    providerEvidence: { toolInvocations: invocations, exchanges, tokenUsage: [exchanges[0].usage], measuredResources },
  }]);
});

const ROWS_SCHEMA = { type: "object", required: ["rows"], properties: { rows: { type: "array" } }, additionalProperties: false };

function stubExchange() {
  return { finishReason: "stop", usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 } };
}

test("the direct-lane instruction states the exact top-level shape and carries the schema, for an object-wrapped and an array output contract", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry("urn:ame:shape-team", "http://127.0.0.1:20/v1", "m", "k")]),
  });
  let objectCall;
  await dispatchAsCodex({ ...INPUT, outputSchema: ROWS_SCHEMA }, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async (call) => {
      objectCall = call;
      return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ rows: [] }), model: "m", durationMs: 1, invocations: [], exchanges: [stubExchange()] };
    },
  });
  const objectInstruction = objectCall.messages.at(-1).content;
  assert.match(objectInstruction, /top-level type must be object/u);
  assert.match(objectInstruction, /required properties: rows/u);
  assert.match(objectInstruction, /No other top-level properties are allowed/u);
  assert.ok(objectInstruction.includes(JSON.stringify(ROWS_SCHEMA)));

  const arraySchema = { type: "array", minItems: 1, maxItems: 3 };
  let arrayCall;
  await dispatchAsCodex({ ...INPUT, outputSchema: arraySchema }, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async (call) => {
      arrayCall = call;
      return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify([1]), model: "m", durationMs: 1, invocations: [], exchanges: [stubExchange()] };
    },
  });
  const arrayInstruction = arrayCall.messages.at(-1).content;
  assert.match(arrayInstruction, /top-level type must be array/u);
  assert.match(arrayInstruction, /bare JSON array \(minItems 1, maxItems 3\)/u);
  assert.ok(arrayInstruction.includes(JSON.stringify(arraySchema)));
});

test("a direct-lane provider that first returns an unwrapped row is re-asked once and the wrapped candidate is accepted with reasks:1 in evidence", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry("urn:ame:reask-team", "http://127.0.0.1:21/v1", "m", "k")]),
  });
  const calls = [];
  const result = await dispatchAsCodex({ ...INPUT, outputSchema: ROWS_SCHEMA }, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async (call) => {
      calls.push(call);
      if (calls.length === 1) {
        return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ column1: "a", column2: "b" }), model: "m", durationMs: 2, invocations: [], exchanges: [stubExchange()] };
      }
      return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ rows: [{ column1: "a", column2: "b" }] }), model: "m", durationMs: 3, invocations: [], exchanges: [stubExchange()] };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages.length, calls[0].messages.length + 2);
  assert.equal(calls[1].messages.at(-2).role, "assistant");
  assert.match(calls[1].messages.at(-1).content, /previous response failed the required output contract/u);
  assert.match(calls[1].messages.at(-1).content, /\$:required:/u);
  assert.equal(result.outcome, "candidate-pending-codex-acceptance");
  assert.deepEqual(result.candidate, { rows: [{ column1: "a", column2: "b" }] });
  assert.equal(result.providerEvidence.reasks, 1);
  assert.equal(result.providerEvidence.exchanges.length, 2);
  assert.equal(result.durationMs, 5);
});

test("a direct-lane provider that fails the customer schema assay twice, once after a re-ask, is refused exactly as an unre-asked failure is", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry("urn:ame:stubborn-team", "http://127.0.0.1:22/v1", "m", "k")]),
  });
  const calls = [];
  const result = await dispatchAsCodex({ ...INPUT, outputSchema: ROWS_SCHEMA }, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async (call) => {
      calls.push(call);
      return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ column1: "a" }), model: "m", durationMs: 1, invocations: [], exchanges: [stubExchange()] };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.outcome, "market-residue");
  assert.equal(result.directLaneRefusals.length, 1);
  assert.equal(result.directLaneRefusals[0].provider, "urn:ame:stubborn-team");
  assert.match(result.directLaneRefusals[0].reason, /candidate-failed-customer-schema-assay/u);
  assert.equal(result.directLaneRefusals[0].reasks, 1);
});

test("a parsed candidate with a nested-field violation is repaired once and the repaired candidate is accepted", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry("urn:ame:nested-team", "http://127.0.0.1:24/v1", "m", "k")]),
  });
  const schema = { type: "object", required: ["draft"], additionalProperties: false,
    properties: { draft: { type: "object", required: ["title", "claims"], additionalProperties: false,
      properties: { title: { type: "string" }, claims: { type: "array", items: { type: "string" } } } } } };
  const calls = [];
  const result = await dispatchAsCodex({ ...INPUT, outputSchema: schema }, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async (call) => {
      calls.push(call);
      const value = calls.length === 1 ? { draft: { title: "t" } } : { draft: { title: "t", claims: ["c"] } };
      return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify(value), model: "m", durationMs: 1, invocations: [], exchanges: [stubExchange()] };
    },
  });
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[1].messages.at(-1)), /claims/u);
  assert.notEqual(result.outcome, "market-residue");
  assert.equal(result.providerEvidence.reasks, 1);
});

test("a candidate that is not JSON at all is never re-asked", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry("urn:ame:non-json-team", "http://127.0.0.1:23/v1", "m", "k")]),
  });
  const calls = [];
  const result = await dispatchAsCodex({ ...INPUT, outputSchema: ROWS_SCHEMA }, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async (call) => {
      calls.push(call);
      return { type: "ReceiverOwnedToolAgentCompletion", text: "not json at all", model: "m", durationMs: 1, invocations: [], exchanges: [stubExchange()] };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.outcome, "market-residue");
  assert.equal(result.directLaneRefusals[0].reasks, undefined);
});

test("a direct-only eligible route skips A2A procurement, resumption, settlement capture, and delivers", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const directDescriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry("urn:ame:direct-only-team", "http://127.0.0.1:31/v1", "m", "k")]),
  });
  const result = await dispatchAsCodex({ ...INPUT, excludeProviders: INFERENCE_PROVIDERS.map(({ actor }) => actor) }, {
    directDescriptors,
    pendingProcurement: { disposition: "candidate-pending-customer-assay" },
    procure: async () => { throw new Error("A2A procurement must not run"); },
    resumeProcurement: async () => { throw new Error("A2A resumption must not run"); },
    captureProcurement: async () => { throw new Error("A2A capture must not run"); },
    directTransport: async () => ({
      type: "ReceiverOwnedToolAgentCompletion",
      text: JSON.stringify({ operation: "extract", basis: "direct-only" }),
      model: "m",
      durationMs: 1,
      invocations: [],
      exchanges: [stubExchange()],
    }),
  });
  assert.equal(result.outcome, "candidate-pending-codex-acceptance");
  assert.equal(result.provider, "urn:ame:direct-only-team");
  assert.equal(result.timing.solicitation, 0);
});

test("a direct-only provider refusal returns market residue without A2A procurement", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const directDescriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry("urn:ame:direct-refusal-team", "http://127.0.0.1:32/v1", "m", "k")]),
  });
  const result = await dispatchAsCodex({ ...INPUT, excludeProviders: INFERENCE_PROVIDERS.map(({ actor }) => actor) }, {
    directDescriptors,
    procure: async () => { throw new Error("A2A procurement must not run"); },
    directTransport: async () => ({
      type: "ReceiverOwnedToolAgentResidue",
      disposition: "provider-exchange-failed",
      provider: "urn:ame:direct-refusal-team",
      model: "m",
      cause: { kind: "http", reason: "provider-refused", status: 429 },
      invocations: [],
      exchanges: [],
      durationMs: 1,
    }),
  });
  assert.equal(result.outcome, "market-residue");
  assert.equal(result.directLaneRefusals[0].provider, "urn:ame:direct-refusal-team");
  assert.equal(result.timing.solicitation, 0);
});

test("excluding every A2A and direct provider refuses before either transport", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const directDescriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry("urn:ame:excluded-direct-team", "http://127.0.0.1:33/v1", "m", "k")]),
  });
  await assert.rejects(
    dispatchAsCodex({ ...INPUT, excludeProviders: [...INFERENCE_PROVIDERS.map(({ actor }) => actor), "urn:ame:excluded-direct-team"] }, {
      directDescriptors,
      procure: async () => { throw new Error("A2A procurement must not run"); },
      directTransport: async () => { throw new Error("direct transport must not run"); },
    }),
    /excluded every advertised provider/u,
  );
});

test("a fresh market with equal-consideration direct offers and no observations takes the plan's declared order as the customer's choice instead of stalling on choice-required", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([
      directEntry("urn:ame:first-free-team", "http://127.0.0.1:1/v1", "first-model", "stub"),
      directEntry("urn:ame:second-free-team", "http://127.0.0.1:2/v1", "second-model", "stub"),
    ]),
  });
  const attempted = [];
  const result = await dispatchAsCodex(INPUT, {
    procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
    directDescriptors: descriptors,
    directTransport: async (call) => {
      attempted.push(call.endpoint);
      assert.equal(call.maximumOutputTokens, 8192, "a direct offer carries the supplier's advertised output budget, never the transport's 512 chat default");
      if (call.endpoint === "http://127.0.0.1:1/v1") throw new Error("first provider down");
      return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ operation: "normalize", basis: "second answered" }), model: "second-model", durationMs: 3, invocations: [], exchanges: [{ finishReason: "stop", usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 } }] };
    },
  });
  assert.deepEqual(attempted, ["http://127.0.0.1:1/v1", "http://127.0.0.1:2/v1"]);
  assert.equal(result.outcome, "candidate-pending-codex-acceptance");
  assert.equal(result.provider, "urn:ame:second-free-team");
  assert.deepEqual(result.candidate, { operation: "normalize", basis: "second answered" });
});

test("strict zero cash refuses unpriced descriptors without buying from the A2A market", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const directDescriptors = loadDirectEndpointProviderDescriptors({ DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry("urn:ame:unpriced", "https://example.invalid/v1", "paid", "secret")]) });
  let calls = 0;
  const result = await dispatchAsCodex({ ...INPUT, zeroCashOnly: true }, { directDescriptors, procure: async () => { calls += 1; }, directTransport: async () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(result.directLaneRefusals[0].reason, "zero-cash-entitlement-not-admitted");
});

test("bounded children re-enter the same free route and retain the parent's schema and budget", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const { executeOpenAiCompatibleToolAgent } = await import("@red-cup-engineering/computer-inference-engine/openai/tool-agent");
  const directDescriptors = loadDirectEndpointProviderDescriptors({ API_KEY_OPENROUTER: "fixture-key" });
  const calls = [];
  let exchanges = 0;
  const directTransport = async (call) => {
    calls.push(call);
    return executeOpenAiCompatibleToolAgent({ ...call, fetchImpl: withProviderPreflight(async () => {
      const message = exchanges++ === 0
        ? { role: "assistant", tool_calls: [{ id: "child", type: "function", function: { name: "delegate_inference", arguments: JSON.stringify({ objective: "Find the operation in the supplied excerpt", tools: [] }) } }] }
        : { role: "assistant", content: JSON.stringify({ operation: "normalize", basis: "supplied source" }) };
      return new Response(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] }), { status: 200 });
    }) });
  };
  const result = await dispatchAsCodex({ ...INPUT, agentBounds: { maximumRequests: 3, maximumToolCalls: 1, maximumOutputTokens: 300, maximumTokensPerRequest: 100, maximumDepth: 1 } }, { directDescriptors, directTransport, procure: async () => { throw new Error("must not buy a paid-market offer"); } });
  assert.equal(result.outcome, "candidate-pending-codex-acceptance", JSON.stringify(result));
  assert.equal(exchanges, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].budget, calls[1].budget);
  assert.equal(calls[1].depth, 1);
  assert.equal(result.providerEvidence.toolInvocations[0].result.customerAssay, "output-schema-accepted");
  assert.deepEqual(calls[0].budget.snapshot(), { requests: 0, toolCalls: 0, outputTokens: 0 });
  assert.equal(calls[0].model, "cohere/north-mini-code:free");
});

test("zero cash descriptor binding refuses paid model or endpoint overrides", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  for (const override of [{ model: "openai/gpt-4o" }, { endpoint: "https://example.invalid/paid" }]) {
    const descriptors = loadDirectEndpointProviderDescriptors({ DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([{ ...directEntry("urn:ame:spoofed", undefined, undefined, "secret"), providerId: "openrouter-cohere-north-free", ...override }]) });
    assert.equal(descriptors[0].zeroCashEligible, false);
  }
});

test("a child route cannot request a paid scope or copy a larger budget", async () => {
  await assert.rejects(dispatchAsCodex({ ...INPUT, zeroCashOnly: false, agentBounds: {} }), /requires zeroCashOnly/u);
  await assert.rejects(dispatchAsCodex({ ...INPUT, agentBounds: { maximumRequests: 129 } }), /schema validation/u);
});

test("free route refuses exhausted provider capacity before transport", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const descriptors = loadDirectEndpointProviderDescriptors({ API_KEY_OPENROUTER: "secret" }).filter((row) => row.zeroCashEligible).map((row) => ({ ...row, availableCapacity: 0 }));
  let calls = 0;
  const result = await dispatchAsCodex({ ...INPUT, zeroCashOnly: true }, { directDescriptors: descriptors, directTransport: async () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(result.outcome, "market-residue");
  assert.match(result.directLaneRefusals[0].reason, /capacity/u);
});

test("a caller resource ceiling and account-window availability evidence refuse a direct offer before transport", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const provider = "urn:ame:quota-bound-provider";
  const descriptors = loadDirectEndpointProviderDescriptors({ DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([directEntry(provider, "http://127.0.0.1:1/v1", "quota-model", "stub")]) });
  let calls = 0;
  const result = await dispatchAsCodex({ ...INPUT, workPlacement: {
    evaluatedAt: "2026-09-07T03:23:00Z",
    accountIdentity: "urn:account:fixture-a",
    windowIdentity: "urn:window:fixture-a",
    unknownAvailability: "refuse",
    resourceCeilings: [{ resource: "provider-attention", unit: "bounded-lot", amount: { numerator: "0", denominator: "1" } }],
    availabilityEvidence: [{
      providerIdentity: provider, accountIdentity: "urn:account:fixture-a", windowIdentity: "urn:window:fixture-a", observedAt: "2026-09-07T03:22:00Z", validUntil: "2026-09-07T04:00:00Z",
      availableResources: [{ resource: "provider-attention", unit: "bounded-lot", amount: { numerator: "1", denominator: "1" } }],
    }],
  } }, { directDescriptors: descriptors, directTransport: async () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(result.outcome, "market-residue");
  assert.match(result.directLaneRefusals[0].reason, /resource-ceiling-unenforceable/u);
});

async function constrainedExchange(resourceCeilings, message) {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const { executeOpenAiCompatibleToolAgent } = await import("@red-cup-engineering/computer-inference-engine/openai/tool-agent");
  const descriptors = loadDirectEndpointProviderDescriptors({ API_KEY_OPENROUTER: "fixture-key" }).filter((row) => row.zeroCashEligible);
  const calls = [];
  const budgets = [];
  const result = await dispatchAsCodex({
    ...INPUT,
    workPlacement: { resourceCeilings },
    agentBounds: { maximumRequests: 3, maximumOutputTokens: 300, maximumTokensPerRequest: 100, maximumToolCalls: 1, maximumDepth: 1 },
  }, {
    pricingRoot: null,
    directDescriptors: descriptors,
    procure: async () => { assert.fail("a resource constrained job must not contact the unmeasured market"); },
    directTransport: (call) => {
      budgets.push(call.budget);
      return executeOpenAiCompatibleToolAgent({ ...call, fetchImpl: withProviderPreflight(async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return new Response(JSON.stringify({
          model: call.model,
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
          choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
        }), { status: 200 });
      }) });
    },
  });
  return { result, calls, budgets };
}

const resourceCeiling = (resource, unit, numerator, denominator = "1") => ({ resource, unit, amount: { numerator, denominator } });

test("whole-job request ceiling withholds child delegation when no request remains", async () => {
  const { calls, budgets, result } = await constrainedExchange([resourceCeiling("requests", "request", "1")], {
    role: "assistant", tool_calls: [{ id: "child", type: "function", function: {
      name: "delegate_inference", arguments: JSON.stringify({ objective: "Find the operation", tools: [] }),
    } }],
  });
  assert.equal(calls.length, 1);
  assert.equal(budgets.length, 1, "an unavailable child operation must not be invoked");
  assert.equal(calls[0].tools?.some(tool => tool.function.name === "delegate_inference") ?? false, false);
  assert.ok(budgets.every((budget) => budget === budgets[0]));
  assert.equal(budgets[0].snapshot().requests, 0);
  assert.equal(result.outcome, "market-residue");
});

test("whole-job reservation floors rational ceilings and bounds provider output", async () => {
  const { calls, result } = await constrainedExchange([
    resourceCeiling("requests", "request", "3", "2"),
    resourceCeiling("output-tokens", "token", "20"),
  ], { role: "assistant", content: "{}" });
  assert.equal(calls.length, 1, "schema reask and fallback cannot reserve a second call");
  assert.equal(calls[0].max_tokens, 20);
  const measured = result.directLaneRefusals.find((row) => row.measuredResources?.resources.some((dimension) => dimension.resource === "input-tokens"));
  assert.ok(measured, "schema rejection must retain spent tokens");
  assert.equal(measured.measuredResources.resources.find((row) => row.resource === "input-tokens").amount.numerator, "11");
});

test("unknown or asset-scoped hard ceilings refuse before provider I/O", async () => {
  for (const row of [
    resourceCeiling("network-bytes", "byte", "1024"),
    { ...resourceCeiling("requests", "request", "1"), asset: "urn:account:other" },
    resourceCeiling("requests", "request", "1", "2"),
  ]) {
    const { calls, result } = await constrainedExchange([row], { role: "assistant", content: "{}" });
    assert.equal(calls.length, 0);
    assert.equal(result.outcome, "market-residue");
  }
});

test("strict free empty offers return typed residue without calling pricing or provider transport", async () => {
  let calls = 0;
  const result = await dispatchAsCodex({ ...INPUT, zeroCashOnly: true }, {
    directDescriptors: [],
    pricingRoot: "http://127.0.0.1:1/",
    procure: async () => { calls += 1; throw new Error("unexpected purchase"); },
    directTransport: async () => { calls += 1; throw new Error("unexpected transport"); },
  });
  assert.equal(result.outcome, "market-residue");
  assert.equal(calls, 0);
  assert.equal(result.provider, null);
});

test("zero-depth bounded dispatcher offers no child tool to the actual shared receiver transport", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const { executeOpenAiCompatibleToolAgent } = await import("@red-cup-engineering/computer-inference-engine/openai/tool-agent");
  const directDescriptors = loadDirectEndpointProviderDescriptors({ API_KEY_OPENROUTER: "fixture-only" });
  let requests = 0;
  const result = await dispatchAsCodex({ ...INPUT, zeroCashOnly: true,
    agentBounds: { maximumRequests: 1, maximumToolCalls: 0, maximumDepth: 0, maximumOutputTokens: 128, maximumTokensPerRequest: 128, maximumToolRounds: 1 },
  }, { directDescriptors, directTransport: call => executeOpenAiCompatibleToolAgent({ ...call, fetchImpl: withProviderPreflight(async (_url, init) => {
    requests += 1;
    assert.deepEqual(JSON.parse(init.body).tools ?? [], []);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify({ operation: "normalize", basis: "bounded fixture" }) }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }), { status: 200 });
  }) }) });
  assert.equal(requests, 1);
  assert.equal(result.outcome, "candidate-pending-codex-acceptance");
  assert.deepEqual(result.candidate, { operation: "normalize", basis: "bounded fixture" });
});
