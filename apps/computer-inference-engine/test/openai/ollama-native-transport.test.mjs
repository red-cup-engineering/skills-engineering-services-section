import assert from "node:assert/strict";
import test from "node:test";
import { executeOpenAiCompatibleAssistantTurn } from "../../src/openai/tool-agent.mjs";
import { executeOllamaToolExchange } from "../../src/ollama/ollama-exchange.mjs";
import { measuredExchangeResources } from "../../src/dispatch/direct-endpoint-provider.mjs";
import { runProviderExchange } from "../../src/openai/provider-runtime.mjs";

const tools = [{ type: "function", function: { name: "read", parameters: {
  type: "object", additionalProperties: false, required: ["lineCount"],
  properties: { lineCount: { type: "integer", minimum: 1, maximum: 20 } },
} } }];
const response = message => new Response(JSON.stringify({ model: "fixture", done_reason: "stop",
  message, prompt_eval_count: 3, eval_count: 2 }), { headers: { "content-type": "application/json" } });
const nativeCall = { role: "assistant", content: "", tool_calls: [{ function: { name: "read", arguments: { lineCount: 20 } } }] };

test("purchased local assistant turns honor the native catalog transport and preserve provider arguments", async () => {
  const requests = [];
  const result = await executeOpenAiCompatibleAssistantTurn({
    provider: "urn:ame:bare-cedar-fog-npu-inference-team", model: "fixture",
    endpoint: "http://127.0.0.1:11434/v1/chat/completions", auth: { mode: "none" },
    maximumOutputTokens: 64, chatCompletion: { messages: [{ role: "user", content: "read" }], tools, temperature: 0 },
    fetchImpl: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return response(nativeCall); },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:11434/api/chat");
  assert.equal(requests[0].body.think, false);
  assert.equal(requests[0].body.stream, false);
  assert.equal(requests[0].body.options.num_predict, 64);
  assert.equal(requests[0].body.options.temperature, 0);
  assert.deepEqual(requests[0].body.tools, tools);
  assert.equal(result.type, "ReceiverOwnedAssistantTurn");
  assert.deepEqual(JSON.parse(result.message.tool_calls[0].function.arguments), { lineCount: 20 });
  assert.deepEqual(result.invocations, []);
  assert.equal(result.response.receiverGeneratedCallIds[0].source, "receiver");
  assert.equal(result.response.receiverGeneratedCallIds[0].id, result.message.tool_calls[0].id);
  assert.equal(result.exchanges[0].usage.totalTokens, null);
});

test("native tool loops use the same binding with no implicit resource scan and no argument coercion", async () => {
  let effects = 0;
  const requests = [];
  const result = await executeOllamaToolExchange({ model: "fixture", messages: [{ role: "user", content: "read" }], tools,
    maximumOutputTokens: 64, maximumToolCalls: 1, maximumToolRounds: 1,
    toolHandlers: { read: async ({ lineCount }) => { effects += 1; return { observed: lineCount }; } },
    fetchImpl: async (url, init) => {
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(init.body); requests.push(body);
      if (requests.length === 1) return response(nativeCall);
      assert.equal(body.messages.at(-1).role, "tool");
      assert.equal(body.messages.at(-1).tool_name, "read");
      assert.deepEqual(JSON.parse(body.messages.at(-1).content), { observed: 20 });
      assert.deepEqual(body.messages.at(-2).tool_calls[0].function.arguments, { lineCount: 20 });
      return response({ role: "assistant", content: "observed" });
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(effects, 1);
  assert.equal(result.text, "observed");
  assert.equal(result.generatedCallIds[0].source, "receiver");
  assert.deepEqual(result.usage, { promptTokens: 6, outputTokens: 4 });

  await assert.rejects(executeOllamaToolExchange({ model: "fixture", messages: [{ role: "user", content: "read" }], tools,
    maximumToolCalls: 1, maximumToolRounds: 1,
    toolHandlers: { read: async () => { throw new Error("invalid arguments must never execute"); } },
    fetchImpl: async () => response({ ...nativeCall, tool_calls: [{ function: { name: "read", arguments: { lineCount: "20" } } }] }),
  }), error => error.residue.invocations.every(entry => entry.executed === false)
    && error.residue.invocations[0].result.toolRefusals[0].refusal.issues.some(issue => issue.keyword === "type"));
});

test("ordinary provider chat forwards its actual transport and cancellation without discovery I/O", async () => {
  let requests = 0;
  const result = await runProviderExchange("ollama-local", { model: "fixture", messages: [{ role: "user", content: "hello" }], "max-tokens": 64 }, {
    env: {}, request: async (url, init) => {
      requests += 1; assert.equal(url, "http://127.0.0.1:11434/api/chat");
      assert.equal(JSON.parse(init.body).options.num_predict, 64);
      return response({ role: "assistant", content: "hello" });
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.outcome, "completion");
  assert.equal(result.completion.text, "hello");
  const controller = new AbortController(); controller.abort();
  const cancelled = await runProviderExchange("ollama-local", { model: "fixture", messages: [{ role: "user", content: "hello" }] }, {
    env: {}, signal: controller.signal, request: async () => { throw new Error("cancelled work must perform no I/O"); },
  });
  assert.equal(cancelled.outcome, "refusal");
});

test("refused native assistant payloads retain completed exchange costs without executing tools", async () => {
  const provider = "urn:ame:bare-cedar-fog-npu-inference-team";
  const invoke = (fetchImpl, chatCompletion = {}) => executeOpenAiCompatibleAssistantTurn({
    provider, model: "fixture", endpoint: "http://127.0.0.1:11434/v1/chat/completions", auth: { mode: "none" },
    maximumOutputTokens: 64, chatCompletion: { messages: [{ role: "user", content: "read" }], tools, ...chatCompletion }, fetchImpl,
  });
  for (const [message, policy, reason] of [
    [null, {}, "missing-assistant-message"],
    [{ ...nativeCall, tool_calls: [...nativeCall.tool_calls, ...nativeCall.tool_calls] },
      { parallel_tool_calls: false }, "parallel-tool-calls-refused"],
  ]) {
    let requests = 0;
    const result = await invoke(async () => { requests += 1; return response(message); }, policy);
    assert.equal(requests, 1);
    assert.equal(result.type, "ReceiverOwnedToolAgentResidue");
    assert.equal(result.cause.reason, reason);
    assert.deepEqual(result.invocations, []);
    assert.equal(result.exchanges.length, 1);
    assert.deepEqual(result.exchanges[0].usage, { promptTokens: 3, outputTokens: 2, totalTokens: null });
    const measured = measuredExchangeResources(result.exchanges, { provider });
    assert.deepEqual(measured.resources.map(({ resource, amount }) => [resource, amount.numerator]),
      [["requests", "1"], ["input-tokens", "3"], ["output-tokens", "2"]]);
    assert.ok(measured.uncertainty.includes("total-token-usage-incomplete"));
  }
  const partial = await invoke(async () => new Response(JSON.stringify({ message: null, prompt_eval_count: 3 })));
  assert.deepEqual(partial.exchanges[0].usage, { promptTokens: 3, outputTokens: null, totalTokens: null });
  const unavailable = await invoke(async () => { throw new Error("connection refused"); });
  assert.deepEqual(unavailable.exchanges, []);
  await assert.rejects(executeOllamaToolExchange({ model: "fixture", messages: [{ role: "user", content: "read" }], tools,
    toolHandlers: { read: async () => { throw new Error("refused payload must never execute"); } },
    fetchImpl: async () => response(null),
  }), error => error.residue.cause.reason === "missing-assistant-message"
    && error.residue.exchanges.length === 1 && error.residue.exchanges[0].usage.outputTokens === 2
    && error.residue.invocations.length === 0);
});
