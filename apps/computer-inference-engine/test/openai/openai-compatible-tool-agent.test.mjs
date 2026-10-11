import assert from "node:assert/strict";
import test from "node:test";
import { executeOpenAiCompatibleToolAgent } from "../../src/openai/tool-agent.mjs";

const tool = { type: "function", function: { name: "observe", parameters: { type: "object", properties: {}, additionalProperties: false } } };
function response(value) { return async () => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }

test("executes one receiver-owned tool and returns the provider completion", async () => {
  const replies = [
    { model: "free", choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "observe", arguments: "{}" } }] } }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } },
    { model: "free", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "observed" } }], usage: { prompt_tokens: 14, completion_tokens: 2, total_tokens: 16 } },
  ];
  let calls = 0;
  const result = await executeOpenAiCompatibleToolAgent({ provider: "free", endpoint: "https://example.invalid/v1/chat/completions", apiKey: "secret", model: "free", messages: [{ role: "user", content: "observe" }], tools: [tool], toolHandlers: { observe: async () => ({ held: true }) }, fetchImpl: async () => response(replies[calls++])() });
  assert.equal(result.text, "observed");
  assert.equal(result.invocations.length, 1);
  assert.deepEqual(result.invocations[0].result, { held: true });
  assert.equal(result.exchanges.length, 2);
});

test("refuses an offered operation without a receiver-owned handler", async () => {
  await assert.rejects(executeOpenAiCompatibleToolAgent({ provider: "free", endpoint: "https://example.invalid/v1", apiKey: "secret", model: "free", messages: [{ role: "user", content: "x" }], tools: [tool], toolHandlers: {} }), /no receiver-owned handler/u);
});

test("refuses a provider request for an ungranted operation", async () => {
  const reply = { choices: [{ message: { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "shell", arguments: "{}" } }] } }] };
  const result = await executeOpenAiCompatibleToolAgent({ provider: "free", endpoint: "https://example.invalid/v1", apiKey: "secret", model: "free", messages: [{ role: "user", content: "x" }], tools: [tool], toolHandlers: { observe: async () => ({}) }, fetchImpl: response(reply) });
  assert.equal(result.type, "ReceiverOwnedToolAgentResidue");
  assert.equal(result.disposition, "provider-exchange-failed");
  assert.deepEqual(result.cause, { kind: "protocol", reason: "ungranted-tool-request" });
  assert.equal(result.prohibitedEffectsPerformed, false);
});

test("preserves partial evidence when a later provider request times out", async () => {
  const first = { model: "observed-model", choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "observe", arguments: "{}" } }] } }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } };
  let calls = 0;
  const result = await executeOpenAiCompatibleToolAgent({
    provider: "free",
    endpoint: "https://example.invalid/v1",
    apiKey: "secret",
    model: "requested-model",
    messages: [{ role: "user", content: "x" }],
    tools: [tool],
    toolHandlers: { observe: async () => ({ held: true }) },
    fetchImpl: async () => {
      if (calls++ === 0) return response(first)();
      const error = new Error("Bearer secret must never escape");
      error.name = "TimeoutError";
      throw error;
    },
  });
  assert.equal(result.type, "ReceiverOwnedToolAgentResidue");
  assert.equal(result.disposition, "provider-exchange-failed");
  assert.equal(result.model, "observed-model");
  assert.deepEqual(result.cause, { kind: "transport", reason: "timeout" });
  assert.deepEqual(result.invocations[0].result, { held: true });
  assert.deepEqual(result.exchanges[0].usage, { promptTokens: 8, outputTokens: 2, totalTokens: 10 });
  assert.equal(result.prohibitedEffectsPerformed, null);
  assert.doesNotMatch(JSON.stringify(result), /Bearer secret/u);
});

test("redacts a later generic transport failure while retaining completed work", async () => {
  const first = { choices: [{ message: { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "observe", arguments: "{}" } }] } }] };
  let calls = 0;
  const result = await executeOpenAiCompatibleToolAgent({
    provider: "free",
    endpoint: "https://example.invalid/v1",
    apiKey: "secret",
    model: "free",
    messages: [{ role: "user", content: "x" }],
    tools: [tool],
    toolHandlers: { observe: async () => ({ held: true }) },
    fetchImpl: async () => {
      if (calls++ === 0) return response(first)();
      throw new Error("https://secret.invalid/?token=do-not-copy");
    },
  });
  assert.deepEqual(result.cause, { kind: "transport", reason: "request-failed" });
  assert.equal(result.invocations.length, 1);
  assert.equal(result.exchanges.length, 1);
  assert.equal(result.prohibitedEffectsPerformed, null);
  assert.doesNotMatch(JSON.stringify(result), /secret\.invalid|do-not-copy/u);
});

test("preserves partial evidence without copying an HTTP refusal body", async () => {
  const first = { choices: [{ message: { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "observe", arguments: "{}" } }] } }] };
  let calls = 0;
  const result = await executeOpenAiCompatibleToolAgent({
    provider: "free",
    endpoint: "https://example.invalid/v1",
    apiKey: "secret",
    model: "free",
    messages: [{ role: "user", content: "x" }],
    tools: [tool],
    toolHandlers: { observe: async () => ({ held: true }) },
    fetchImpl: async () => calls++ === 0 ? response(first)() : new Response(JSON.stringify({ error: { message: "credential=do-not-copy" } }), { status: 503 }),
  });
  assert.deepEqual(result.cause, { kind: "http", reason: "provider-refused", status: 503 });
  assert.equal(result.invocations.length, 1);
  assert.equal(result.exchanges.length, 1);
  assert.equal(result.prohibitedEffectsPerformed, null);
  assert.doesNotMatch(JSON.stringify(result), /credential|do-not-copy/u);
});

test("returns a distinguishable protocol residue with all observed usage", async () => {
  const replies = [
    { model: "observed-model", choices: [{ message: { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "observe", arguments: "{}" } }] } }], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } },
    { model: "observed-model", choices: [], usage: { prompt_tokens: 7, completion_tokens: 0, total_tokens: 7 } },
  ];
  let calls = 0;
  const result = await executeOpenAiCompatibleToolAgent({ provider: "free", endpoint: "https://example.invalid/v1", apiKey: "secret", model: "free", messages: [{ role: "user", content: "x" }], tools: [tool], toolHandlers: { observe: async () => ({ held: true }) }, fetchImpl: async () => response(replies[calls++])() });
  assert.equal(result.type, "ReceiverOwnedToolAgentResidue");
  assert.equal(result.disposition, "provider-exchange-failed");
  assert.deepEqual(result.cause, { kind: "protocol", reason: "missing-assistant-message" });
  assert.equal(result.invocations.length, 1);
  assert.equal(result.exchanges.length, 2);
  assert.deepEqual(result.exchanges[1].usage, { promptTokens: 7, outputTokens: 0, totalTokens: 7 });
  assert.equal(result.prohibitedEffectsPerformed, null);
});

test("returns a receiver handler refusal to the provider so it can revise its request", async () => {
  const replies = [
    { choices: [{ message: { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "observe", arguments: "{}" } }] } }] },
    { choices: [{ message: { role: "assistant", content: "revised" } }] },
  ];
  let calls = 0;
  const requests = [];
  const result = await executeOpenAiCompatibleToolAgent({ provider: "free", endpoint: "https://example.invalid/v1", apiKey: "secret", model: "free", messages: [{ role: "user", content: "x" }], tools: [tool], toolHandlers: { observe: async () => { throw new Error("resource absent"); } }, fetchImpl: async (_url, options) => { requests.push(JSON.parse(options.body)); return response(replies[calls++])(); } });
  assert.equal(result.text, "revised");
  assert.equal(result.invocations[0].result.type, "ReceiverToolRefusal");
  assert.equal(result.invocations[0].result.prohibitedEffectsPerformed, null);
  assert.match(requests[1].messages.at(-1).content, /resource absent/u);
});

test("admits an empty argument carrier as the empty object", async () => {
  const replies = [
    { choices: [{ message: { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "observe", arguments: "" } }] } }] },
    { choices: [{ message: { role: "assistant", content: "done" } }] },
  ];
  let calls = 0;
  const result = await executeOpenAiCompatibleToolAgent({ provider: "free", endpoint: "https://example.invalid/v1", apiKey: "secret", model: "free", messages: [{ role: "user", content: "x" }], tools: [tool], toolHandlers: { observe: async (args) => args }, fetchImpl: async () => response(replies[calls++])() });
  assert.deepEqual(result.invocations[0].arguments, {});
});

test("returns partial evidence as typed residue when the tool-round bound is exhausted", async () => {
  const reply = { model: "free", choices: [{ message: { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "observe", arguments: "{}" } }] } }] };
  const result = await executeOpenAiCompatibleToolAgent({ provider: "free", endpoint: "https://example.invalid/v1", apiKey: "secret", model: "free", messages: [{ role: "user", content: "x" }], tools: [tool], toolHandlers: { observe: async () => ({ held: true }) }, maximumToolRounds: 0, fetchImpl: response(reply) });
  assert.equal(result.type, "ReceiverOwnedToolAgentResidue");
  assert.equal(result.disposition, "tool-round-bound-exhausted");
  assert.equal(result.invocations.length, 0);
  assert.equal(result.prohibitedEffectsPerformed, false);
});

test("refuses a batch that would cross the total tool-call bound", async () => {
  const reply = { model: "free", choices: [{ message: { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "observe", arguments: "{}" } }, { id: "call-2", function: { name: "observe", arguments: "{}" } }] } }] };
  const result = await executeOpenAiCompatibleToolAgent({ provider: "free", endpoint: "https://example.invalid/v1", apiKey: "secret", model: "free", messages: [{ role: "user", content: "x" }], tools: [tool], toolHandlers: { observe: async () => ({}) }, maximumToolCalls: 1, fetchImpl: response(reply) });
  assert.equal(result.disposition, "tool-call-bound-exhausted");
  assert.equal(result.invocations.length, 0);
  assert.equal(result.refusedCalls.length, 2);
});

test("permits plain HTTP for a loopback endpoint (a locally-run provider such as Ollama)", async () => {
  const reply = { model: "local", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "observed locally" } }] };
  const result = await executeOpenAiCompatibleToolAgent({ provider: "local-ollama", endpoint: "http://127.0.0.1:11434/v1/chat/completions", apiKey: "unused-by-ollama", model: "local", messages: [{ role: "user", content: "x" }], fetchImpl: response(reply) });
  assert.equal(result.text, "observed locally");
});

for (const endpoint of [
  "http://127.0.0.1:11434/v1/chat/completions",
  "http://localhost:11434/v1/chat/completions",
  "http://[::1]:11434/v1/chat/completions",
]) {
  test(`omits authorization for explicit unauthenticated loopback access at ${endpoint}`, async () => {
    const reply = { model: "local", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "local" } }] };
    let observedHeaders;
    const result = await executeOpenAiCompatibleToolAgent({
      provider: "local-ollama",
      endpoint,
      auth: { mode: "none" },
      model: "local",
      messages: [{ role: "user", content: "x" }],
      fetchImpl: async (_url, options) => {
        observedHeaders = options.headers;
        return response(reply)();
      },
    });
    assert.equal(result.text, "local");
    assert.equal("authorization" in observedHeaders, false);
    assert.equal(new Headers(observedHeaders).get("content-type"), "application/json");
  });
}

test("refuses unauthenticated access to a non-loopback endpoint", async () => {
  await assert.rejects(executeOpenAiCompatibleToolAgent({ provider: "free", endpoint: "https://api.example.invalid/v1", auth: { mode: "none" }, model: "free", messages: [{ role: "user", content: "x" }] }), /only to a loopback host/u);
});

test("keeps bearer authentication as the default", async () => {
  const reply = { choices: [{ message: { role: "assistant", content: "done" } }] };
  let observedHeaders;
  await executeOpenAiCompatibleToolAgent({
    provider: "free",
    endpoint: "https://example.invalid/v1",
    apiKey: "secret",
    model: "free",
    messages: [{ role: "user", content: "x" }],
    fetchImpl: async (_url, options) => {
      observedHeaders = options.headers;
      return response(reply)();
    },
  });
  assert.equal(new Headers(observedHeaders).get("authorization"), "Bearer secret");
});

test("preserves the receiver-owned tool exchange without provider authentication", async () => {
  const replies = [
    { choices: [{ message: { role: "assistant", tool_calls: [{ id: "call-1", function: { name: "observe", arguments: "{}" } }] } }] },
    { choices: [{ message: { role: "assistant", content: "observed locally" } }] },
  ];
  let calls = 0;
  const result = await executeOpenAiCompatibleToolAgent({
    provider: "local-ollama",
    endpoint: "http://127.0.0.1:11434/v1/chat/completions",
    auth: { mode: "none" },
    model: "local",
    messages: [{ role: "user", content: "observe" }],
    tools: [tool],
    toolHandlers: { observe: async () => ({ held: true }) },
    fetchImpl: async () => response(replies[calls++])(),
  });
  assert.equal(result.text, "observed locally");
  assert.deepEqual(result.invocations[0].result, { held: true });
  assert.equal(result.exchanges.length, 2);
});

test("still refuses plain HTTP to a non-loopback host", async () => {
  await assert.rejects(executeOpenAiCompatibleToolAgent({ provider: "free", endpoint: "http://api.example.invalid/v1", apiKey: "secret", model: "free", messages: [{ role: "user", content: "x" }] }), /must use HTTPS/u);
});

test("response_format is merged into the request body verbatim when supplied", async () => {
  const reply = { model: "free", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "{\"classification\":\"ok\"}" } }] };
  let observedBody = null;
  const responseFormat = { type: "json_schema", json_schema: { name: "customer_output_contract", schema: { type: "object", additionalProperties: false, required: ["classification"], properties: { classification: { type: "string" } } }, strict: true } };
  const result = await executeOpenAiCompatibleToolAgent({
    provider: "free",
    endpoint: "https://example.invalid/v1/chat/completions",
    apiKey: "secret",
    model: "free",
    messages: [{ role: "user", content: "classify" }],
    responseFormat,
    fetchImpl: async (_url, init) => { observedBody = JSON.parse(init.body); return response(reply)(); },
  });
  assert.equal(result.text, "{\"classification\":\"ok\"}");
  assert.deepEqual(observedBody.response_format, responseFormat);
});

test("no response_format field is sent when the caller supplies none", async () => {
  const reply = { model: "free", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "plain text" } }] };
  let observedBody = null;
  await executeOpenAiCompatibleToolAgent({
    provider: "free",
    endpoint: "https://example.invalid/v1/chat/completions",
    apiKey: "secret",
    model: "free",
    messages: [{ role: "user", content: "x" }],
    fetchImpl: async (_url, init) => { observedBody = JSON.parse(init.body); return response(reply)(); },
  });
  assert.equal("response_format" in observedBody, false);
});

test("a non-object responseFormat is refused before dispatch", async () => {
  await assert.rejects(
    executeOpenAiCompatibleToolAgent({ provider: "free", endpoint: "https://example.invalid/v1", apiKey: "secret", model: "free", messages: [{ role: "user", content: "x" }], responseFormat: "json_schema" }),
    /responseFormat must be one OpenAI-compatible response_format object/u,
  );
});

const BASE = { provider: "free", endpoint: "https://example.invalid/v1", apiKey: "secret", model: "free", messages: [{ role: "user", content: "parent" }], maximumOutputTokens: 10 };
const toolCall = (name, args, id = "call") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const callsResponse = (calls) => response({ choices: [{ message: { role: "assistant", tool_calls: calls } }] })();

test("child requests spend one shared tree budget and preserve the parent output contract", async () => {
  const { createToolAgentBudget } = await import("../../src/openai/tool-agent.mjs");
  const budget = createToolAgentBudget({ maximumRequests: 3, maximumToolCalls: 2, maximumOutputTokens: 30 });
  const format = { type: "json_schema", json_schema: { name: "answer", schema: { type: "string" } } };
  const children = [];
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return requests === 1 ? callsResponse([toolCall("delegate_inference", { objective: "child1" }, "c1"), toolCall("delegate_inference", { objective: "child2" }, "c2")]) : response({ choices: [{ message: { content: "child" } }] })();
  };
  const delegation = async (child) => { children.push(child); return executeOpenAiCompatibleToolAgent({ ...BASE, ...child, delegation, fetchImpl, messages: [{ role: "user", content: child.objective }] }); };
  const result = await executeOpenAiCompatibleToolAgent({ ...BASE, budget, maximumDepth: 1, delegation, responseFormat: format, fetchImpl });
  assert.equal(requests, 3);
  assert.equal(children.length, 2);
  assert.equal(children[0].budget, budget);
  assert.deepEqual(children[0].responseFormat, format);
  assert.equal(result.cause.reason, "shared-request-budget-exhausted");
  assert.deepEqual(budget.snapshot(), { requests: 0, toolCalls: 0, outputTokens: 0 });
});

test("depth and capability refusals never call the child route", async () => {
  for (const [maximumDepth, requested, expected] of [[0, [], "ungranted-tool-request"], [1, ["shell"], "child-capability-not-granted"]]) {
    let delegated = 0;
    let requests = 0;
    const result = await executeOpenAiCompatibleToolAgent({ ...BASE, tools: [tool], toolHandlers: { observe: async () => ({}) }, maximumDepth, delegation: async () => { delegated += 1; }, fetchImpl: async () => requests++ === 0 ? callsResponse([toolCall("delegate_inference", { objective: "child", tools: requested })]) : response({ choices: [{ message: { content: "done" } }] })() });
    assert.equal(delegated, 0);
    assert.equal(maximumDepth === 0 ? result.cause.reason : result.invocations[0].result.reason, expected);
  }
});

test("tool arguments and declared results are validated at the receiver boundary", async () => {
  for (const invalidInput of [true, false]) {
    let effects = 0;
    let requests = 0;
    const result = await executeOpenAiCompatibleToolAgent({ ...BASE, tools: [tool], toolHandlers: { observe: async () => { effects += 1; return "wrong"; } }, toolResultSchemas: { observe: { type: "object" } }, fetchImpl: async () => requests++ === 0 ? callsResponse([toolCall("observe", invalidInput ? { unauthorized: true } : {})]) : response({ choices: [{ message: { content: "done" } }] })() });
    assert.equal(effects, invalidInput ? 0 : 1);
    assert.equal(result.invocations[0].result.reason, invalidInput ? "tool-input-schema-refusal" : "tool-result-schema-refusal");
  }
});

test("shared reservations are atomic across competing callers", async () => {
  const { createToolAgentBudget } = await import("../../src/openai/tool-agent.mjs");
  const budget = createToolAgentBudget({ maximumRequests: 1, maximumToolCalls: 0, maximumOutputTokens: 10 });
  let requests = 0;
  const results = await Promise.all([1, 2].map(() => executeOpenAiCompatibleToolAgent({ ...BASE, budget, fetchImpl: async () => { requests += 1; return response({ choices: [{ message: { content: "done" } }] })(); } })));
  assert.equal(requests, 1);
  assert.equal(results.filter((r) => r.type === "ReceiverOwnedToolAgentCompletion").length, 1);
  assert.equal(results.filter((r) => r.cause?.reason === "shared-request-budget-exhausted").length, 1);
});
