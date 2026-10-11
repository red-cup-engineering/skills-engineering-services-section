import assert from "node:assert/strict";
import test from "node:test";
import { createToolAgentBudget, executeOpenAiCompatibleAssistantTurn } from "../../src/openai/tool-agent.mjs";

const endpoint = "https://example.invalid/v1/chat/completions";
const tool = { type: "function", function: { name: "read", parameters: { type: "object", additionalProperties: false } } };
const turn = (extra = {}) => ({ messages: [{ role: "user", content: "read" }], tools: [tool], ...extra });
const completion = (message, usage) => ({ id: "cmpl-1", object: "chat.completion", created: 1, model: "provider-model", choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], ...(usage ? { usage } : {}) });
const response = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const options = (chatCompletion, extra = {}) => ({ provider: "market-provider", endpoint, apiKey: "secret", model: "selected-model", chatCompletion, ...extra });

test("one assistant turn returns a null-content native tool request without executing it", async () => {
  let requests = 0;
  const body = completion({ role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "read", arguments: "{}" } }] }, { prompt_tokens: 3 });
  const result = await executeOpenAiCompatibleAssistantTurn(options(turn(), { fetchImpl: async () => { requests += 1; return response(body); } }));
  assert.equal(requests, 1);
  assert.equal(result.type, "ReceiverOwnedAssistantTurn");
  assert.equal(result.message.content, null);
  assert.equal(result.message.tool_calls[0].function.name, "read");
  assert.equal(result.response.id, "cmpl-1");
  assert.deepEqual(result.exchanges[0].usage, { promptTokens: 3, outputTokens: null, totalTokens: null });
  assert.deepEqual(result.invocations, []);
});

test("one assistant text turn forwards admitted transcript controls while provider owns model and cap", async () => {
  let packet;
  const result = await executeOpenAiCompatibleAssistantTurn(options(turn({ messages: [{ role: "assistant", content: null, tool_calls: [{ id: "old", type: "function", function: { name: "read", arguments: "{}" } }] }, { role: "tool", tool_call_id: "old", content: "{}" }, { role: "user", content: "finish" }], response_format: { type: "json_object" }, temperature: 0.2, stop: ["END"], reasoning_effort: "medium", reasoning_budget: 4, chat_template_kwargs: { force_nonempty_content: true } }), { maximumOutputTokens: 9, fetchImpl: async (_url, init) => { packet = JSON.parse(init.body); return response(completion({ role: "assistant", content: "done" })); } }));
  assert.equal(result.message.content, "done");
  assert.equal(packet.model, "selected-model");
  assert.equal(packet.max_tokens, 9);
  assert.deepEqual(packet.response_format, { type: "json_object" });
  assert.equal(packet.temperature, 0.2);
  assert.equal(packet.reasoning_effort, "medium");
  assert.equal(packet.reasoning_budget, 4);
  assert.deepEqual(packet.chat_template_kwargs, { force_nonempty_content: true });
  assert.deepEqual(packet.messages.at(-1), { role: "user", content: "finish" });
});

test("invalid tool calls and caller overrides refuse before transport", async () => {
  const invalid = [
    turn({ tools: [tool], messages: [{ role: "user", content: "x" }, { role: "assistant", content: null, tool_calls: [{ id: "", type: "function", function: { name: "read", arguments: "{}" } }] }] }),
    turn({ tools: [tool], messages: [{ role: "user", content: "x" }, { role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "missing", arguments: "{}" } }] }] }),
    turn({ tools: [tool], messages: [{ role: "user", content: "x" }, { role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: "{" } }] }] }),
    turn({ tools: [tool], messages: [{ role: "user", content: "x" }, { role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: "{}" } }] }] }),
    { ...turn(), model: "caller-model" },
    turn({ reasoning_budget: -1 }),
    turn({ reasoning_effort: "invented" }),
    turn({ chat_template_kwargs: { endpoint: "https://other.invalid" } }),
  ];
  for (const chatCompletion of invalid) {
    let requests = 0;
    await assert.rejects(executeOpenAiCompatibleAssistantTurn(options(chatCompletion, { fetchImpl: async () => { requests += 1; throw new Error("must not call"); } })), /chatCompletion/u);
    assert.equal(requests, 0);
  }
  await assert.rejects(executeOpenAiCompatibleAssistantTurn(options(turn(), { toolHandlers: { read() {} } })), /does not admit receiver handlers/u);
  await assert.rejects(executeOpenAiCompatibleAssistantTurn(options(turn(), { delegation() {} })), /does not admit delegation/u);
});

test("a unary provider tool request is admitted without executing an ungranted, duplicate, or malformed call", async () => {
  const replies = [
    completion({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "missing", arguments: "{}" } }] }),
    completion({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: "{}" } }, { id: "x", type: "function", function: { name: "read", arguments: "{}" } }] }),
    completion({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read", arguments: "{" } }] }),
  ];
  for (const body of replies) {
    let requests = 0;
    const result = await executeOpenAiCompatibleAssistantTurn(options(turn(), { fetchImpl: async () => { requests += 1; return response(body); } }));
    assert.equal(requests, 1);
    assert.equal(result.type, "ReceiverOwnedToolAgentResidue");
    assert.equal(result.prohibitedEffectsPerformed, false);
    assert.deepEqual(result.invocations, []);
  }
});

test("shared request bounds refuse before transport and retain a failed exchange cause", async () => {
  const budget = createToolAgentBudget({ maximumRequests: 0, maximumToolCalls: 0, maximumOutputTokens: 16 });
  let requests = 0;
  const exhausted = await executeOpenAiCompatibleAssistantTurn(options(turn(), { budget, fetchImpl: async () => { requests += 1; throw new Error("must not call"); } }));
  assert.equal(exhausted.cause.reason, "shared-request-budget-exhausted");
  assert.equal(requests, 0);
  const failed = await executeOpenAiCompatibleAssistantTurn(options(turn(), { fetchImpl: async () => new Response("no", { status: 429 }) }));
  assert.deepEqual(failed.cause, { kind: "http", reason: "provider-refused", status: 429 });
  assert.deepEqual(failed.exchanges, []);
});
