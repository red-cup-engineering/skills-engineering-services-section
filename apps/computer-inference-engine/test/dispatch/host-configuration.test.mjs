import assert from "node:assert/strict";
import test from "node:test";
import { createMcpClient, mcpInProcessTransport } from "@red-cup-engineering/mcp-engineering-services-section/client";
import { createInferencePlatform, dispatchInferenceAsConfiguredCustomer, CODEX_CUSTOMER, recordInferenceOutcome } from "../../src/dispatch/inference-dispatch.mjs";
import { INFERENCE_WORK_OPERATION } from "../../src/dispatch/inference-work-carriers.mjs";
import { ACTOR_TOKENS, invokeRecordInferenceOutcome } from "../../src/dispatch/inference-dispatch-mcp-contract.mjs";
import { openInferenceDispatchMcp } from "../../src/dispatch/inference-dispatch-mcp.mjs";
import { localInferenceWorkLotSource } from "../../src/dispatch/local-inference-work-lot-source.mjs";
import { inferenceCall } from "../../src/dispatch/inference-model.mjs";
import { BOUNDED_INFERENCE_SERVICE_MODEL } from "../../src/dispatch/inference-work-lot-source.mjs";
import { DIRECT_WITNESS_SETTLEMENT_CAPABILITY, RESOLUTION_CREDIT_ASSET, RESOLUTION_CREDIT_UNIT } from "../../src/dispatch/consideration.mjs";

const input = {
  customer: CODEX_CUSTOMER, objective: "Derive one bounded host operation.", context: "Supplied fixture only.",
  workType: "inquiry", difficulty: 0.4, outputSchema: { type: "string" },
  considerationPolicy: { type: "ConsiderationPolicy", acceptableAlternatives: [{ id: "test-credit", obligations: [{ kind: "credit", asset: RESOLUTION_CREDIT_ASSET, unit: RESOLUTION_CREDIT_UNIT, settlementCapabilities: [DIRECT_WITNESS_SETTLEMENT_CAPABILITY] }] }] },
};
const residue = () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } });
function environment(host, customer = CODEX_CUSTOMER) {
  return { INFERENCE_WORK_CUSTOMER: customer, EXPECTED_RESOLUTION_PRICING_ROOT: `/tmp/fixture-${host}-pricing`,
    INFERENCE_WORK_LOT_DATA_ROOT: `/tmp/fixture-${host}-custody`, DIRECT_ENDPOINT_PROVIDER_CONFIG: `/tmp/fixture-${host}-providers.json`,
    OPENROUTER_INFERENCE_AGENT_CARD: `https://${host}.invalid/.well-known/agent-card.json` };
}

test("parallel inference platforms retain their host configuration after the caller changes it", async () => {
  const calls = [];
  const envs = [environment("first"), environment("second")];
  const nodes = envs.map((env) => createInferencePlatform({ environment: env,
    refreshDirectDescriptors: async (snapshot, options) => { calls.push({ snapshot, options }); return []; } }));
  envs.forEach((env) => { env.DIRECT_ENDPOINT_PROVIDER_CONFIG = "/tmp/foreign.json"; });
  try {
    const results = await Promise.all(nodes.map((node) => node.execute(INFERENCE_WORK_OPERATION.id,
      { ...input, zeroCashOnly: true }, { allowedEffects: INFERENCE_WORK_OPERATION.effects })));
    assert.ok(results.every((result) => result.ok), JSON.stringify(results));
    assert.deepEqual(calls.map(({ options }) => options.configPath).sort(), ["/tmp/fixture-first-providers.json", "/tmp/fixture-second-providers.json"]);
    for (const { snapshot, options } of calls) {
      assert.equal(options.pricingRoot, snapshot.EXPECTED_RESOLUTION_PRICING_ROOT);
      assert.ok(Object.isFrozen(snapshot));
    }
  } finally { await Promise.all(nodes.map((node) => node.close())); }
});

test("typed procurement receives each host's supplier placement and custody root", async () => {
  const calls = [];
  await Promise.all(["first", "second"].map((host) => dispatchInferenceAsConfiguredCustomer(input, {
    customerActor: CODEX_CUSTOMER, environment: environment(host), directDescriptors: [],
    procure: async (args) => { calls.push(args); return residue(); },
  })));
  assert.equal(calls.length, 2);
  for (const args of calls) {
    const host = args.dataRoot.includes("first") ? "first" : "second";
    assert.equal(args.dataRoot, `/tmp/fixture-${host}-custody`);
    assert.ok(JSON.stringify(args.request).includes(`https://${host}.invalid/.well-known/agent-card.json`));
    assert.ok(!JSON.stringify(args.request).includes(`https://${host === "first" ? "second" : "first"}.invalid`));
  }
});

test("MCP hosts advertise and enforce their own configured principal", async () => {
  const other = [...ACTOR_TOKENS.keys()].find((actor) => actor !== CODEX_CUSTOMER);
  assert.ok(other);
  for (const customer of [CODEX_CUSTOMER, other]) {
    const env = environment("mcp", customer);
    const host = openInferenceDispatchMcp({ environment: env });
    env.INFERENCE_WORK_CUSTOMER = customer === CODEX_CUSTOMER ? other : CODEX_CUSTOMER;
    const client = createMcpClient({ transport: mcpInProcessTransport(host.handle), clientInfo: { name: "host-isolation", version: "1" } });
    try {
      const initialized = await client.initialize();
      assert.ok(initialized.instructions.includes(customer));
      const foreign = await client.callTool({ name: "dispatch_inference", arguments: { ...input, customer: env.INFERENCE_WORK_CUSTOMER } });
      assert.equal(foreign.isError, true);
      const outcome = await client.callTool({ name: "record_inference_outcome", arguments: {
        workLot: "urn:work-lot:fixture", provider: "urn:provider:fixture", taskClass: "fixture",
        selectedOffer: "urn:offer:fixture", receipt: "urn:receipt:fixture", receiver: env.INFERENCE_WORK_CUSTOMER,
        outcome: "accepted", evidence: "urn:evidence:fixture",
      } });
      assert.equal(outcome.isError, true);
    } finally { await client.close(); }
  }
});

test("receiver observations and the FeltOS source retain the selected host and its bounds", async () => {
  const env = environment("office");
  const observed = [];
  const record = (value, ports) => recordInferenceOutcome(value, { ...ports, observe: async (root, observation) => { observed.push({ root, observation }); return { fixture: true }; } });
  const outcome = { workLot: "urn:work-lot:fixture", provider: "urn:provider:fixture", taskClass: "fixture", selectedOffer: "urn:offer:fixture",
    receipt: "urn:receipt:fixture", receiver: CODEX_CUSTOMER, outcome: "accepted", evidence: "urn:evidence:fixture" };
  assert.equal((await invokeRecordInferenceOutcome(outcome, { environment: env, record })).isError, false);
  assert.equal(observed[0].root, env.EXPECTED_RESOLUTION_PRICING_ROOT);
  assert.equal((await invokeRecordInferenceOutcome({ ...outcome, receiver: "actor:foreign" }, { environment: env, record })).isError, true);
  assert.equal(observed.length, 1);
  const calls = [];
  const source = localInferenceWorkLotSource({ environment: env, dispatch: async (request, ports) => { calls.push({ request, ports }); return { outcome: "market-residue", disposition: "fixture" }; } });
  env.EXPECTED_RESOLUTION_PRICING_ROOT = "/tmp/foreign";
  const call = inferenceCall({ request: "urn:request:fixture", subject: "urn:subject:fixture", model: BOUNDED_INFERENCE_SERVICE_MODEL,
    messages: [{ role: "user", content: "Use the supplied source only." }], observedAt: "2026-09-30T00:00:00.000Z", generation: { maxOutputTokens: 32 } });
  const signal = new AbortController().signal;
  for await (const unused of source(call, { signal })) { /* Consume the actual source protocol. */ }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ports.environment.EXPECTED_RESOLUTION_PRICING_ROOT, "/tmp/fixture-office-pricing");
  assert.equal(calls[0].ports.signal, signal);
  assert.equal(calls[0].request.zeroCashOnly, true);
  assert.equal(calls[0].request.agentBounds.maximumRequests, 1);
});
