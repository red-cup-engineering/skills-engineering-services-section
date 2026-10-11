import assert from "node:assert/strict";
import test from "node:test";
import { createInferencePlatform, dispatchInferenceAsConfiguredCustomer, CODEX_CUSTOMER } from "../../src/dispatch/inference-dispatch.mjs";
import { directEndpointConfigurationIdentity, loadDirectEndpointProviderDescriptors } from "../../src/dispatch/direct-endpoint-provider.mjs";
import { executeOpenAiCompatibleAssistantTurn } from "@red-cup-engineering/computer-inference-engine/openai/tool-agent";

const TOOL = { type: "function", function: { name: "local_read", parameters: { type: "object", additionalProperties: false } } };
const endpoint = "https://example.invalid/v1/chat/completions";
const descriptor = (provider, considerationNumerator = "1") => ({
  actor: provider, endpoint, apiKey: "fixture-key", model: "selected-model", endpointClass: "openai-compatible", availableCapacity: 1,
  capabilities: ["chat", "inquiry", "tool-calling"], authorityScopes: ["urn:scope:bounded-inference-candidate"],
  effects: ["read-only"], idempotence: ["idempotent"], considerationKind: "quota",
  considerationAsset: "urn:test:turn-quota", considerationUnit: "request", considerationNumerator, considerationDenominator: "1",
  declaredResources: [{ resource: "provider-attention", unit: "bounded-lot", amount: { numerator: "1", denominator: "1" } }],
});
const directDescriptors = (...entries) => loadDirectEndpointProviderDescriptors({ DIRECT_ENDPOINT_PROVIDERS: JSON.stringify(entries) });
const input = (chatCompletion, extra = {}) => ({
  objective: "Return one market-selected model turn.",
  workType: "inquiry", difficulty: 0.2, chatCompletion, ...extra,
});
const completion = (message, usage = { prompt_tokens: 3 }) => ({
  id: "cmpl-turn", object: "chat.completion", created: 1, model: "selected-model",
  choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], usage,
});
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const dispatchTurn = (value, options) => dispatchInferenceAsConfiguredCustomer(value, { customerActor: CODEX_CUSTOMER, pricingRoot: null, ...options });

test("one configured inference platform hosts concurrent model turns and drains them on close", async () => {
  const pending = [];
  let bothStarted;
  const started = new Promise((resolve) => { bothStarted = resolve; });
  const platform = createInferencePlatform({
    pricingRoot: null,
    directDescriptors: directDescriptors(descriptor("urn:ame:platform-provider")),
    directTransport: (call) => executeOpenAiCompatibleAssistantTurn({
      ...call,
      fetchImpl: async () => {
        await new Promise((resolve) => { pending.push(resolve); if (pending.length === 2) bothStarted(); });
        return response(completion({ role: "assistant", content: "platform result" }));
      },
    }),
  });
  const operation = platform.operations()[0];
  const turns = ["first", "second"].map((name) => platform.execute(operation.id, input({
    messages: [{ role: "user", content: name }],
  }, { workLotId: `urn:work-lot:platform:${name}`, customer: CODEX_CUSTOMER }), { allowedEffects: operation.effects }));
  await started;
  const closing = platform.close();
  assert.equal((await platform.execute(operation.id, {})).refusal.code, "platform-closed");
  assert.equal(typeof platform.capabilities()["inference:procure"], "function");
  pending.forEach((resolve) => resolve());
  const results = await Promise.all(turns);
  for (const result of results) {
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.candidate.choices[0].message.content, "platform result");
    assert.equal(result.value.provider, "urn:ame:platform-provider");
    assert.equal(result.value.integrationAccepted, false);
  }
  await closing;
  assert.deepEqual(platform.capabilities(), {});
});

test("a market-selected turn returns native calls, then accepts a separately executed exact-ID continuation", async () => {
  const packets = [];
  let marketCalls = 0;
  const directTransport = async (call) => executeOpenAiCompatibleAssistantTurn({
    ...call,
    fetchImpl: async (_url, init) => {
      packets.push(JSON.parse(init.body));
      const message = packets.length === 1
        ? { role: "assistant", content: null, tool_calls: [{ id: "native-1", type: "function", function: { name: "local_read", arguments: "{}" } }] }
        : { role: "assistant", content: "continued" };
      return response(completion(message, packets.length === 1 ? { prompt_tokens: 3 } : { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }));
    },
  });
  const first = await dispatchTurn(input({ messages: [{ role: "user", content: "read" }], tools: [TOOL] }), {
    directDescriptors: directDescriptors(descriptor("urn:ame:turn-provider")), directTransport,
    procure: async () => { marketCalls += 1; throw new Error("chat turns skip A2A"); },
  });
  assert.equal(first.outcome, "candidate-pending-codex-acceptance", JSON.stringify(first));
  assert.equal(marketCalls, 0);
  assert.equal(first.candidate.choices[0].message.content, null);
  assert.equal(first.candidate.choices[0].message.tool_calls[0].id, "native-1");
  assert.deepEqual(first.providerEvidence.toolInvocations, []);
  assert.deepEqual(first.measuredResources.resources.find(({ resource }) => resource === "requests").amount, { numerator: "1", denominator: "1" });
  assert.ok(first.measuredResources.uncertainty.includes("output-token-usage-incomplete"));

  const second = await dispatchTurn(input({
    messages: [
      { role: "user", content: "read" }, first.candidate.choices[0].message,
      { role: "tool", tool_call_id: "native-1", content: JSON.stringify({ value: "local result" }) },
      { role: "user", content: "continue" },
    ], tools: [TOOL],
  }), { directDescriptors: directDescriptors(descriptor("urn:ame:turn-provider")), directTransport });
  assert.equal(second.candidate.choices[0].message.content, "continued");
  assert.equal(packets.length, 2);
  assert.equal(packets[1].messages[1].tool_calls[0].id, "native-1");
  assert.deepEqual(packets[1].messages[2], { role: "tool", tool_call_id: "native-1", content: JSON.stringify({ value: "local result" }) });
});

test("a purchased turn's execution bounds do not invent a zero-cash purchase restriction", async () => {
  let calls = 0;
  const result = await dispatchTurn(input({ messages: [{ role: "user", content: "bounded turn" }] }, {
    agentBounds: { maximumRequests: 1, maximumOutputTokens: 256, maximumTokensPerRequest: 256 },
  }), {
    directDescriptors: directDescriptors({ ...descriptor("urn:ame:bounded-quota-turn"), capabilities: ["chat", "inquiry", "tool-calling"] }),
    directTransport: async (call) => executeOpenAiCompatibleAssistantTurn({
      ...call, fetchImpl: async () => { calls++; return response(completion({ role: "assistant", content: "bounded candidate" })); },
    }),
  });
  assert.equal(calls, 1, JSON.stringify({ outcome: result.outcome, refusals: result.directLaneRefusals, reason: result.reason }));
  assert.equal(result.provider, "urn:ame:bounded-quota-turn");
  assert.equal(result.candidate.choices[0].message.content, "bounded candidate");
  assert.equal(result.integrationAccepted, false);
});

test("resource ceilings bound fallback attempts and retain separate partial-usage evidence", async () => {
  const calls = [];
  const result = await dispatchTurn(input({ messages: [{ role: "user", content: "turn" }] }, {
    workPlacement: { resourceCeilings: [{ resource: "requests", unit: "request", amount: { numerator: "2", denominator: "1" } }] },
  }), {
    directDescriptors: directDescriptors(descriptor("urn:ame:cheap-turn", "1"), descriptor("urn:ame:backup-turn", "2")),
    directTransport: async (call) => executeOpenAiCompatibleAssistantTurn({
      ...call,
      fetchImpl: async () => {
        calls.push(call.provider);
        return calls.length === 1 ? response({ error: "capacity" }, 429) : response(completion({ role: "assistant", content: "backup" }, { prompt_tokens: 4 }));
      },
    }),
  });
  assert.deepEqual(calls, ["urn:ame:cheap-turn", "urn:ame:backup-turn"]);
  assert.equal(result.provider, "urn:ame:backup-turn");
  assert.equal(result.providerEvidence.sharedBudgetRemaining.requests, 0);
  assert.equal(result.directLaneRefusals[0].provider, "urn:ame:cheap-turn");
  assert.ok(result.directLaneRefusals[0].measuredResources.uncertainty.includes("completed-exchange-count-unknown"));
  assert.ok(result.measuredResources.uncertainty.includes("output-token-usage-incomplete"));
});

test("a required implementation identity invokes only its exact direct configuration", async () => {
  const packets = [];
  const transport = async (call) => executeOpenAiCompatibleAssistantTurn({
    ...call,
    fetchImpl: async (_url, init) => {
      packets.push({ provider: call.provider, body: JSON.parse(init.body) });
      return response(completion({ role: "assistant", content: call.provider }));
    },
  });
  const exact = descriptor("urn:ame:exact-turn", "9");
  const requiredImplementationIdentity = directEndpointConfigurationIdentity(
    directDescriptors(exact)[0],
    { interaction: "assistant-turn", maximumOutputTokens: 8192 },
  );
  const selected = await dispatchTurn(input({ messages: [{ role: "user", content: "continue" }] }, {
    workPlacement: { requiredImplementationIdentity },
  }), {
    directDescriptors: directDescriptors(descriptor("urn:ame:cheaper-foreign-turn", "1"), exact),
    directTransport: transport,
  });
  assert.equal(selected.configurationIdentity, requiredImplementationIdentity);
  assert.deepEqual(packets.map(({ provider }) => provider), ["urn:ame:exact-turn"]);
  assert.match(selected.directLaneRefusals[0].reason, /implementation-identity-not-required/u);

  packets.length = 0;
  const unavailable = await dispatchTurn(input({ messages: [{ role: "user", content: "continue" }] }, {
    workPlacement: { requiredImplementationIdentity },
  }), {
    directDescriptors: directDescriptors(descriptor("urn:ame:cheaper-foreign-turn", "1")),
    directTransport: transport,
  });
  assert.equal(unavailable.outcome, "market-residue");
  assert.equal(packets.length, 0);
  assert.match(unavailable.directLaneRefusals[0].reason, /implementation-identity-not-required/u);
});

test("a purchased turn refuses receiver authority and caller-owned transport overrides before effects", async () => {
  let marketCalls = 0;
  let transportCalls = 0;
  const chatCompletion = { messages: [{ role: "user", content: "turn" }], tools: [TOOL] };
  await assert.rejects(dispatchTurn(input(chatCompletion), {
    directDescriptors: directDescriptors(descriptor("urn:ame:turn-provider")),
    directMcp: { client: { async listTools() { throw new Error("must not discover"); } }, allowlist: ["local_read"] },
    procure: async () => { marketCalls += 1; },
    directTransport: async () => { transportCalls += 1; },
  }), /cannot carry receiver tool execution authority/u);
  await assert.rejects(dispatchTurn(input({ ...chatCompletion, model: "caller-selected" }), {
    directDescriptors: directDescriptors(descriptor("urn:ame:turn-provider")),
    directTransport: async () => { transportCalls += 1; },
  }), /chatCompletion/u);
  assert.equal(marketCalls, 0);
  assert.equal(transportCalls, 0);
});


test("a refused assistant turn carries the exact shared type refusal without executing or reasking", async () => {
  let requests = 0;
  const read = { type: "function", function: { name: "workspace_file_slice", parameters: {
    type: "object", additionalProperties: false, required: ["lineCount"],
    properties: { lineCount: { type: "integer", minimum: 1, maximum: 20 } },
  } } };
  const result = await dispatchTurn(input({ messages: [{ role: "user", content: "read" }], tools: [read] }, {
    workLotId: "urn:work-lot:refused-tool-turn", zeroCashOnly: false,
    agentBounds: { maximumRequests: 1, maximumOutputTokens: 64, maximumTokensPerRequest: 64, maximumToolCalls: 0, maximumToolRounds: 0 },
  }), {
    directDescriptors: directDescriptors(descriptor("urn:ame:refused-turn")),
    directTransport: async (call) => executeOpenAiCompatibleAssistantTurn({ ...call, fetchImpl: async () => {
      requests += 1;
      return response(completion({ role: "assistant", content: null, tool_calls: [{
        id: "refused-native-call", type: "function",
        function: { name: "workspace_file_slice", arguments: '{"lineCount":"20"}' },
      }] }));
    } }),
  });
  assert.equal(requests, 1, JSON.stringify({outcome:result.outcome,directLaneRefusals:result.directLaneRefusals}));
  assert.equal(result.receipt, null);
  assert.equal(result.provider, null);
  assert.equal(result.candidate, undefined);
  const refusal = result.directLaneRefusals[0];
  assert.equal(refusal.cause.reason, "tool-input-schema-refusal");
  assert.equal(refusal.cause.toolRefusals.length, 1);
  const typed = refusal.cause.toolRefusals[0];
  assert.equal(typed.id, "refused-native-call");
  assert.equal(typed.operation, "workspace_file_slice");
  assert.equal(typed.refusal.kind, "not-admitted");
  assert.equal(typed.refusal.typeId, "tool:workspace_file_slice:input");
  assert.ok(typed.refusal.issues.some(issue => issue.path === "/lineCount" && issue.keyword === "type"));
  assert.deepEqual(refusal.providerEvidence.toolInvocations, []);
  assert.equal(refusal.providerEvidence.exchanges[0].usage.promptTokens, 3);
  assert.equal(refusal.providerEvidence.exchanges[0].usage.totalTokens, null);
});
