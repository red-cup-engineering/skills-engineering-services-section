import assert from "node:assert/strict";
import test from "node:test";
import { compileJsonSchema } from "@red-cup-engineering/json-schema-services-section/validation";
import { ADMITTED_CUSTOMERS, CODEX_CUSTOMER, dispatchInference, dispatchInferenceAsConfiguredCustomer } from "../../src/dispatch/inference-dispatch.mjs";
import { configuredCustomerToken, outcomeSentinelForCustomer, resolveConfiguredCustomer } from "../../src/dispatch/provider-admission.mjs";

const CLAUDE_CUSTOMER = "actor:bZH6KBOlPVWbYpqp04izN_Xtwykn0XgsMBStm_FkPPw";
const ACTOR_TOKENS = new Map([[CODEX_CUSTOMER, "codex"], [CLAUDE_CUSTOMER, "claude"]]);

function completedProcurement(args, provider = args.suppliers[0]) {
  const consideration = { providerAlternative: "test-credit", policyAlternative: "test-credit", preferenceRank: 0, obligations: [] };
  const offer = { id: `urn:offer:${provider.id}`, object: { model: `${provider.id}-model` } };
  const selected = { provider, offer };
  return {
    type: "TypedSenInferenceProcurement",
    disposition: "candidate-pending-customer-assay",
    demand: { type: "TypedSenInferenceDemand" },
    selection: { selected, selectedConsideration: consideration, ranked: [{ ...selected, consideration }], selectionRule: "test-cheapest-feasible" },
    contract: { compact: { id: "ni:///sha-256;compact" }, proposal: { term: "ni:///sha-256;provider-proposal" } },
    settlement: { candidate: '{"ok":true}', completion: "ni:///sha-256;completion" },
    receipt: { id: "ni:///sha-256;receipt" },
  };
}

test("this is one dispatch engine: every admitted actor resolves to the identical exported dispatchInference", () => {
  // Thin binding, not a second implementation: must call the imported dispatchInference.
  let observedProcure;
  return dispatchInferenceAsConfiguredCustomer(
    { objective: "fixture", context: "fixture" },
    { customerActor: CODEX_CUSTOMER, directDescriptors: [], procure: (args) => { observedProcure = args; return { disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }; } },
  ).then(() => {
    assert.equal(typeof dispatchInference, "function");
    assert.equal(observedProcure.request.workLot.producer, CODEX_CUSTOMER);
  });
});

test("resolveConfiguredCustomer defaults to Codex when INFERENCE_WORK_CUSTOMER is unset, and validates an explicit actor", () => {
  assert.equal(resolveConfiguredCustomer(ADMITTED_CUSTOMERS, { env: {}, fallback: CODEX_CUSTOMER }), CODEX_CUSTOMER);
  assert.equal(resolveConfiguredCustomer(ADMITTED_CUSTOMERS, { env: { INFERENCE_WORK_CUSTOMER: CLAUDE_CUSTOMER }, fallback: CODEX_CUSTOMER }), CLAUDE_CUSTOMER);
  assert.throws(
    () => resolveConfiguredCustomer(ADMITTED_CUSTOMERS, { env: { INFERENCE_WORK_CUSTOMER: "urn:ame:not-an-admitted-actor" }, fallback: CODEX_CUSTOMER }),
    /names an actor not admitted to this market/u,
  );
  assert.throws(() => resolveConfiguredCustomer(ADMITTED_CUSTOMERS, { env: {} }), /no fallback customer actor was supplied/u);
});

test("configuredCustomerToken and outcomeSentinelForCustomer look up each actor's data-declared token, falling back to the generic customer sentinel", () => {
  assert.equal(configuredCustomerToken(CODEX_CUSTOMER, ACTOR_TOKENS), "codex");
  assert.equal(configuredCustomerToken(CLAUDE_CUSTOMER, ACTOR_TOKENS), "claude");
  assert.equal(configuredCustomerToken("urn:ame:metroplat", ACTOR_TOKENS), null);
  assert.equal(outcomeSentinelForCustomer(CODEX_CUSTOMER, ACTOR_TOKENS), "candidate-pending-codex-acceptance");
  assert.equal(outcomeSentinelForCustomer(CLAUDE_CUSTOMER, ACTOR_TOKENS), "candidate-pending-claude-acceptance");
  assert.equal(outcomeSentinelForCustomer("urn:ame:metroplat", ACTOR_TOKENS), "candidate-pending-customer-acceptance");
});

test("the same parameterized function tags a successful candidate for whichever actor it is configured with", async () => {
  const forCodex = await dispatchInferenceAsConfiguredCustomer(
    { objective: "fixture", context: "fixture" },
    { customerActor: CODEX_CUSTOMER, directDescriptors: [], procure: async (args) => completedProcurement(args), assay: () => ({ accepted: true, id: "ni:///sha-256;assay", candidateValue: { ok: true } }), close: () => ({ id: "ni:///sha-256;close", disposition: "closed" }) },
  );
  const forClaude = await dispatchInferenceAsConfiguredCustomer(
    { objective: "fixture", context: "fixture" },
    { customerActor: CLAUDE_CUSTOMER, procure: async (args) => completedProcurement(args), assay: () => ({ accepted: true, id: "ni:///sha-256;assay", candidateValue: { ok: true } }), close: () => ({ id: "ni:///sha-256;close", disposition: "closed" }) },
  );
  assert.equal(forCodex.outcome, "candidate-pending-codex-acceptance");
  assert.equal(forCodex.receiver, CODEX_CUSTOMER);
  assert.equal(forClaude.outcome, "candidate-pending-claude-acceptance");
  assert.equal(forClaude.receiver, CLAUDE_CUSTOMER);
  assert.notEqual(forCodex.outcome, forClaude.outcome);
});

test("cross-actor misuse is rejected: a caller cannot transact under another actor's identity through this surface", async () => {
  await assert.rejects(
    () => dispatchInferenceAsConfiguredCustomer({ objective: "fixture", customer: CODEX_CUSTOMER }, { customerActor: CLAUDE_CUSTOMER }),
    /transacts only as actor:bZH6KBOlPVWbYpqp04izN_Xtwykn0XgsMBStm_FkPPw/u,
  );
  await assert.rejects(
    () => dispatchInferenceAsConfiguredCustomer({ objective: "fixture", customer: CLAUDE_CUSTOMER }, { customerActor: CODEX_CUSTOMER }),
    /transacts only as actor:WWOM5azg-fTrn1Id0YVbz5AhppbnFny_W5Xl-rKgSs4/u,
  );
});

test("an explicit customerActor always wins over the ambient INFERENCE_WORK_CUSTOMER default", async () => {
  const previous = process.env.INFERENCE_WORK_CUSTOMER;
  process.env.INFERENCE_WORK_CUSTOMER = CLAUDE_CUSTOMER;
  try {
    let observed;
    const result = await dispatchInferenceAsConfiguredCustomer(
      { objective: "fixture", context: "fixture" },
      { customerActor: CODEX_CUSTOMER, directDescriptors: [], procure: async (args) => { observed = args; return { disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }; } },
    );
    assert.equal(observed.request.workLot.producer, CODEX_CUSTOMER);
    assert.equal(result.receiver, CODEX_CUSTOMER);
  } finally {
    if (previous === undefined) delete process.env.INFERENCE_WORK_CUSTOMER;
    else process.env.INFERENCE_WORK_CUSTOMER = previous;
  }
});

test("the MCP contract module binds its schema, instructions, and outcome check to whichever actor INFERENCE_WORK_CUSTOMER names at load time", async () => {
  const previous = process.env.INFERENCE_WORK_CUSTOMER;
  process.env.INFERENCE_WORK_CUSTOMER = CLAUDE_CUSTOMER;
  try {
    const contract = await import(`../../src/dispatch/inference-dispatch-mcp-contract.mjs?actor=claude-${Date.now()}`);
    assert.equal(contract.CONFIGURED_CUSTOMER, CLAUDE_CUSTOMER);
    // A customer-specific surface cannot submit work for another admitted customer.
    assert.equal(compileJsonSchema(contract.DISPATCH_INFERENCE_INPUT_SCHEMA).validate({ objective: "fixture", customer: CLAUDE_CUSTOMER }).valid, true);
    assert.equal(compileJsonSchema(contract.DISPATCH_INFERENCE_INPUT_SCHEMA).validate({ objective: "fixture", customer: CODEX_CUSTOMER }).valid, false);
    assert.equal(compileJsonSchema(contract.DISPATCH_INFERENCE_INPUT_SCHEMA).validate({ objective: "fixture", customer: "urn:ame:not-an-admitted-actor" }).valid, false);
    assert.match(contract.MCP_INSTRUCTIONS, /The stable customer Actor is actor:bZH6KBOlPVWbYpqp04izN_Xtwykn0XgsMBStm_FkPPw/u);
    assert.match(contract.MCP_INSTRUCTIONS, /Claude owns its routine bounded code decisions/u);
  } finally {
    if (previous === undefined) delete process.env.INFERENCE_WORK_CUSTOMER;
    else process.env.INFERENCE_WORK_CUSTOMER = previous;
  }
});

test("an unset INFERENCE_WORK_CUSTOMER keeps the MCP contract module bound to Codex, unchanged from before generalization", async () => {
  const previous = process.env.INFERENCE_WORK_CUSTOMER;
  delete process.env.INFERENCE_WORK_CUSTOMER;
  try {
    const contract = await import(`../../src/dispatch/inference-dispatch-mcp-contract.mjs?actor=codex-${Date.now()}`);
    assert.equal(contract.CONFIGURED_CUSTOMER, CODEX_CUSTOMER);
    assert.match(contract.MCP_INSTRUCTIONS, /The stable customer Actor is actor:WWOM5azg-fTrn1Id0YVbz5AhppbnFny_W5Xl-rKgSs4/u);
  } finally {
    if (previous === undefined) delete process.env.INFERENCE_WORK_CUSTOMER;
    else process.env.INFERENCE_WORK_CUSTOMER = previous;
  }
});
