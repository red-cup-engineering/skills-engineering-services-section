import assert from "node:assert/strict";
import test from "node:test";
import { executeBoundedToolAgent, createToolAgentBudget } from "../../src/openai/tool-agent.mjs";

const tool = { type: "function", function: { name: "read", parameters: { type: "object", additionalProperties: false } } };
const call = (id, name = "read", args = "{}") => ({ id, type: "function", function: { name, arguments: args } });
const reply = (calls) => ({ ok: true, message: { role: "assistant", content: null, tool_calls: calls }, usage: { promptTokens: 3, outputTokens: 2, totalTokens: 5 } });
const base = { provider: "native", model: "native", messages: [{ role: "user", content: "read" }], tools: [tool], maximumOutputTokens: 16 };

test("normalized transport needs no HTTP endpoint, credentials, or OpenAI response envelope", async () => {
  let rounds = 0;
  const result = await executeBoundedToolAgent({
    ...base, toolHandlers: { read: async () => ({ observed: true }) },
    exchangeAssistantMessage: async ({ messages }) => {
      if (rounds++ === 0) return reply([call("1")]);
      assert.equal(messages.at(-1).tool_call_id, "1");
      return { ok: true, message: { role: "assistant", content: "Observed" } };
    },
  });
  assert.equal(result.text, "Observed");
  assert.equal(result.invocations[0].executed, true);
  assert.deepEqual(result.exchanges[1].usage, { promptTokens: null, outputTokens: null, totalTokens: null });
});

for (const calls of [[call("1"), call("2", "ungranted")], [call("1"), call("1")]]) {
  test("an unauthorized or ambiguous batch executes no valid prefix", async () => {
    let effects = 0;
    const result = await executeBoundedToolAgent({ ...base, toolHandlers: { read: async () => { effects += 1; } }, exchangeAssistantMessage: async () => reply(calls) });
    assert.equal(effects, 0);
    assert.equal(result.type, "ReceiverOwnedToolAgentResidue");
    assert.equal(result.prohibitedEffectsPerformed, false);
  });
}

test("invalid arguments withhold the whole batch and return feedback for model repair", async () => {
  let effects = 0;
  let requests = 0;
  const result = await executeBoundedToolAgent({
    ...base, toolHandlers: { read: async () => { effects += 1; } },
    exchangeAssistantMessage: async ({ messages }) => {
      if (requests++ === 0) return reply([call("1"), call("2", "read", '{"extra":true}')]);
      if (requests === 2) {
        assert.equal(effects, 0);
        const feedback = JSON.parse(messages.at(-1).content);
        assert.equal(feedback.toolRefusals.length, 1);
        assert.equal(feedback.toolRefusals[0].id, "2");
        assert.equal(feedback.toolRefusals[0].operation, "read");
        assert.equal(feedback.toolRefusals[0].refusal.typeId, "tool:read:input");
        assert.ok(feedback.toolRefusals[0].refusal.issues.some(issue => issue.keyword === "additionalProperties"));
        return reply([call("3")]);
      }
      return { ok: true, message: { role: "assistant", content: "Schema corrected" } };
    },
  });
  assert.equal(effects, 1);
  assert.equal(requests, 3);
  assert.equal(result.invocations.length, 3);
  assert.ok(result.invocations.slice(0, 2).every((entry) => entry.executed === false && entry.result.reason === "tool-input-schema-refusal"));
  assert.equal(result.invocations[2].id, "3");
  assert.equal(result.invocations[2].executed, true);
});

test("cancellation after provider response preserves usage and executes no tool", async () => {
  const controller = new AbortController();
  let effects = 0;
  const result = await executeBoundedToolAgent({
    ...base, signal: controller.signal, toolHandlers: { read: async () => { effects += 1; } },
    exchangeAssistantMessage: async () => { controller.abort(); return reply([call("1")]); },
  });
  assert.equal(effects, 0);
  assert.equal(result.cause.kind, "cancelled");
  assert.equal(result.exchanges[0].usage.totalTokens, 5);
});

test("a reused call ID cannot repeat an effect across rounds", async () => {
  let effects = 0;
  const result = await executeBoundedToolAgent({
    ...base, toolHandlers: { read: async () => { effects += 1; return {}; } },
    exchangeAssistantMessage: async () => reply([call("same")]),
  });
  assert.equal(effects, 1);
  assert.equal(result.cause.reason, "invalid-or-duplicate-tool-call-id");
  assert.equal(result.toolHandlersStarted, 1);
  assert.equal(result.prohibitedEffectsPerformed, null);
});

test("cancelled work spends no request reservation", async () => {
  const controller = new AbortController();
  controller.abort();
  const budget = createToolAgentBudget({ maximumRequests: 1, maximumToolCalls: 1, maximumOutputTokens: 16 });
  const result = await executeBoundedToolAgent({
    ...base, budget, signal: controller.signal, toolHandlers: { read() {} },
    exchangeAssistantMessage() { throw new Error("transport must not be called"); },
  });
  assert.equal(result.cause.kind, "cancelled");
  assert.equal(budget.snapshot().requests, 1);
});

for (const [label, maximumDepth, maximumToolCalls, maximumRequests, expected] of [
  ["depth exhausted", 0, 1, 2, false],
  ["tool allowance exhausted", 1, 0, 2, false],
  ["request allowance exhausted after parent", 1, 1, 1, false],
  ["one available child", 1, 1, 2, true],
]) {
  test("delegation is advertised only when executable: " + label, async () => {
    let effects = 0;
    const result = await executeBoundedToolAgent({
      provider: "fixture", model: "fixture", messages: [{ role: "user", content: "return one answer" }],
      maximumDepth, maximumToolCalls, maximumOutputTokens: 16,
      budget: createToolAgentBudget({ maximumRequests, maximumToolCalls, maximumOutputTokens: 64 }),
      delegation: async () => { effects += 1; },
      exchangeAssistantMessage: async ({ tools }) => {
        assert.equal(tools.some(tool => tool.function.name === "delegate_inference"), expected);
        return { ok: true, message: { role: "assistant", content: "answered" } };
      },
    });
    assert.equal(result.text, "answered");
    assert.equal(effects, 0);
  });
}

test("assistant-turn tool names remain caller-owned when no receiver delegation is installed", async () => {
  const declared = { ...tool, function: { ...tool.function, name: "delegate_inference" } };
  await executeBoundedToolAgent({ ...base, tools: [declared], returnAssistantTurn: true, maximumDepth: 0,
    exchangeAssistantMessage: async ({ tools }) => {
      assert.deepEqual(tools, [declared]);
      return { ok: true, message: { role: "assistant", content: "answered" }, response: {} };
    },
  });
});
