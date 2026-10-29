import assert from "node:assert/strict";
import test from "node:test";
import {
  executeOllamaToolExchange,
  observeOllamaResource,
} from "../src/ollama-tool-exchange.mjs";
import { createToolAgentBudget } from "@red-cup-engineering/computer-inference-engine/openai/tool-agent";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resourceResponses(chatResponses = []) {
  return async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/version") return jsonResponse({ version: "0.test" });
    if (path === "/api/tags")
      return jsonResponse({ models: [{ name: "llama3.2:3b" }] });
    if (path === "/api/ps")
      return jsonResponse({
        models: [
          { name: "llama3.2:3b", size: 2, size_vram: 0, context_length: 2048 },
        ],
      });
    if (path === "/api/chat") {
      const next = chatResponses.shift();
      assert.ok(next, "unexpected chat round");
      return jsonResponse(
        typeof next === "function" ? next(JSON.parse(options.body)) : next,
      );
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

test("observes held and resident models without asserting accelerator custody", async () => {
  const result = await observeOllamaResource({
    fetchImpl: resourceResponses(),
  });
  assert.deepEqual(result.models, ["llama3.2:3b"]);
  assert.equal(result.residentModels[0].sizeVram, 0);
});

test("executes only an explicitly granted tool and returns the subsequent completion", async () => {
  let calls = 0;
  const fetchImpl = resourceResponses([
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "one",
            function: {
              name: "resource_health",
              arguments: { resource: "local-ollama" },
            },
          },
        ],
      },
      prompt_eval_count: 12,
      eval_count: 3,
    },
    (request) => {
      assert.equal(request.options.num_ctx, 2048);
      assert.deepEqual(request.messages.at(-1), {
        role: "tool",
        content: '{"healthy":true}',
        tool_name: "resource_health",
      });
      return {
        message: { role: "assistant", content: "healthy" },
        prompt_eval_count: 8,
        eval_count: 1,
      };
    },
  ]);
  const result = await executeOllamaToolExchange({
    model: "llama3.2:3b",
    messages: [{ role: "user", content: "Inspect it" }],
    tools: [
      {
        type: "function",
        function: { name: "resource_health", parameters: { type: "object" } },
      },
    ],
    toolHandlers: {
      resource_health: async (args) => {
        calls += 1;
        assert.equal(args.resource, "local-ollama");
        return { healthy: true };
      },
    },
    fetchImpl,
  });
  assert.equal(calls, 1);
  assert.equal(result.text, "healthy");
  assert.equal(result.invocations.length, 1);
  assert.deepEqual(result.usage, { promptTokens: 20, outputTokens: 4 });
});

test("refuses a model-requested tool outside the receiver grant", async () => {
  const fetchImpl = resourceResponses([
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "shell", arguments: { command: "id" } } },
        ],
      },
    },
  ]);
  await assert.rejects(
    () =>
      executeOllamaToolExchange({
        model: "llama3.2:3b",
        messages: [{ role: "user", content: "Do it" }],
        tools: [
          {
            type: "function",
            function: {
              name: "resource_health",
              parameters: { type: "object" },
            },
          },
        ],
        toolHandlers: { resource_health: async () => ({ healthy: true }) },
        fetchImpl,
      }),
    /ungranted tool shell/u,
  );
});

test("refuses to advertise a tool without a receiver-owned handler", async () => {
  await assert.rejects(
    () =>
      executeOllamaToolExchange({
        model: "llama3.2:3b",
        messages: [{ role: "user", content: "Inspect it" }],
        tools: [
          {
            type: "function",
            function: {
              name: "resource_health",
              parameters: { type: "object" },
            },
          },
        ],
        fetchImpl: resourceResponses(),
      }),
    /has no receiver-owned handler/u,
  );
});

test("projects native object arguments and tool names across rounds while retaining local controls", async () => {
  const fetchImpl = resourceResponses([
    {
      message: {
        role: "assistant",
        tool_calls: [{ function: { name: "health", arguments: { ok: true } } }],
      },
    },
    (request) => {
      assert.equal(request.keep_alive, "1m");
      assert.equal(request.format, "json");
      assert.equal(request.options.num_ctx, 512);
      assert.deepEqual(request.messages.at(-1), {
        role: "tool",
        tool_name: "health",
        content: '{"ok":true}',
      });
      return { message: { role: "assistant", content: "done" } };
    },
  ]);
  const result = await executeOllamaToolExchange({
    model: "llama3.2:3b",
    messages: [{ role: "user", content: "x" }],
    tools: [
      {
        type: "function",
        function: { name: "health", parameters: { type: "object" } },
      },
    ],
    toolHandlers: { health: async (args) => args },
    fetchImpl,
    contextTokens: 512,
    keepAlive: "1m",
    format: "json",
  });
  assert.deepEqual(result.usage, { promptTokens: null, outputTokens: null });
});

test("two native tool rounds retain object arguments and generate distinct receiver-provenanced ids", async () => {
  const requests = [];
  const fetchImpl = resourceResponses([
    (request) => {
      requests.push(request);
      return {
        message: {
          role: "assistant",
          tool_calls: [
            { function: { name: "health", arguments: { round: 1 } } },
          ],
        },
      };
    },
    (request) => {
      requests.push(request);
      return {
        message: {
          role: "assistant",
          tool_calls: [
            { function: { name: "health", arguments: { round: 2 } } },
          ],
        },
      };
    },
    (request) => {
      requests.push(request);
      return { message: { role: "assistant", content: "done" } };
    },
  ]);
  const result = await executeOllamaToolExchange({
    model: "llama3.2:3b",
    messages: [{ role: "user", content: "x" }],
    tools: [
      {
        type: "function",
        function: { name: "health", parameters: { type: "object" } },
      },
    ],
    toolHandlers: { health: async (args) => args },
    fetchImpl,
  });
  assert.equal(result.generatedCallIds.length, 2);
  assert.notEqual(result.generatedCallIds[0].id, result.generatedCallIds[1].id);
  assert.deepEqual(
    requests[1].messages.find((message) => message.role === "assistant")
      .tool_calls[0].function.arguments,
    { round: 1 },
  );
  assert.deepEqual(
    requests[2].messages
      .filter((message) => message.role === "assistant")
      .at(-1).tool_calls[0].function.arguments,
    { round: 2 },
  );
});

test("a preaborted receiver signal prevents native discovery and chat I/O", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    () =>
      executeOllamaToolExchange({
        model: "llama3.2:3b",
        messages: [{ role: "user", content: "x" }],
        fetchImpl: async () => {
          calls += 1;
          throw new Error("must not run");
        },
        signal: controller.signal,
      }),
    /cancelled/u,
  );
  assert.equal(calls, 0);
});

test("one shared request reservation suppresses a second native chat", async () => {
  let chats = 0;
  const fetchImpl = resourceResponses([
    {
      message: {
        role: "assistant",
        tool_calls: [{ function: { name: "health", arguments: {} } }],
      },
    },
    () => {
      chats += 1;
      return { message: { role: "assistant", content: "unexpected" } };
    },
  ]);
  await assert.rejects(
    () =>
      executeOllamaToolExchange({
        model: "llama3.2:3b",
        messages: [{ role: "user", content: "x" }],
        tools: [
          {
            type: "function",
            function: { name: "health", parameters: { type: "object" } },
          },
        ],
        toolHandlers: { health: async () => ({}) },
        fetchImpl,
        budget: createToolAgentBudget({
          maximumRequests: 1,
          maximumToolCalls: 2,
          maximumOutputTokens: 512,
        }),
      }),
    (error) =>
      error.residue?.cause?.reason === "shared-request-budget-exhausted",
  );
  assert.equal(chats, 0);
});
