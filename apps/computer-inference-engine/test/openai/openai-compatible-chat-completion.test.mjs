import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runOpenAiCompatibleChatExchange, tokenUsage, validateChatCompletionPacket, selectFreeFirstProvider, isZeroCashProvider, isRateLimitRefusal, resolveFreeFirstAttemptPacket, computePurchasePrice, PURCHASE_PRICE_DENOMINATION, dispatchFreeFirstChatCompletion } from "../../src/openai/openai-compatible-chat-completion.mjs";

const PACKET = { model: "test-model", messages: [{ role: "user", content: "hi" }] };
const CONFIG = { providerId: "test-provider", chatCompletionsUrl: "https://example.invalid/v1/chat/completions", apiKey: "secret" };

function fakeFetch(status, body, statusText = "") {
  return async () => ({ ok: status >= 200 && status < 300, status, statusText, text: async () => JSON.stringify(body) });
}

test("validateChatCompletionPacket accepts a well-formed packet", () => {
  assert.deepEqual(validateChatCompletionPacket(PACKET), []);
});

test("validateChatCompletionPacket rejects a missing model and empty messages", () => {
  const errors = validateChatCompletionPacket({ model: "", messages: [] });
  assert.equal(errors.length, 2);
});

test("a completion response settles to outcome completion with the provider's text", async () => {
  const body = { model: "test-model", choices: [{ message: { content: "hello back" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } };
  const record = await runOpenAiCompatibleChatExchange(PACKET, CONFIG, fakeFetch(200, body));
  assert.equal(record.outcome, "completion");
  assert.equal(record.completion.text, "hello back");
  assert.equal(record.completion["finish-reason"], "stop");
  assert.equal(record.cost.denomination, "test-provider-api-requests");
  assert.deepEqual(record.usage, { input: { quantity: 3, denomination: "test-provider-tokens-in" }, output: { quantity: 2, denomination: "test-provider-tokens-out" } });
});

test("a non-ok HTTP response settles to outcome refusal naming the status", async () => {
  const record = await runOpenAiCompatibleChatExchange(PACKET, CONFIG, fakeFetch(410, { error: "gone" }, "Gone"));
  assert.equal(record.outcome, "refusal");
  assert.match(record.refusal.grounds, /HTTP 410 Gone/);
  assert.deepEqual(record.refusal.unmet, ["http-failure:410"]);
});

test("a response with no choices content settles to outcome refusal", async () => {
  const record = await runOpenAiCompatibleChatExchange(PACKET, CONFIG, fakeFetch(200, { choices: [{ message: {} }] }));
  assert.equal(record.outcome, "refusal");
  assert.deepEqual(record.refusal.unmet, ["missing-completion-content"]);
});

test("a reasoning-only response (empty content, populated reasoning) settles to a distinct refusal", async () => {
  const body = { choices: [{ message: { content: "", reasoning: "thinking about the answer" } }] };
  const record = await runOpenAiCompatibleChatExchange(PACKET, CONFIG, fakeFetch(200, body));
  assert.equal(record.outcome, "refusal");
  assert.deepEqual(record.refusal.unmet, ["reasoning-only-response"]);
});

test("a reasoning-only response using reasoning_content settles to the same distinct refusal", async () => {
  const body = { choices: [{ message: { content: null, reasoning_content: "thinking about the answer" } }] };
  const record = await runOpenAiCompatibleChatExchange(PACKET, CONFIG, fakeFetch(200, body));
  assert.equal(record.outcome, "refusal");
  assert.deepEqual(record.refusal.unmet, ["reasoning-only-response"]);
});

test("content is accepted as the completion even when the message also carries reasoning", async () => {
  const body = { choices: [{ message: { content: "ready", reasoning_content: null }, finish_reason: "stop" }] };
  const record = await runOpenAiCompatibleChatExchange(PACKET, CONFIG, fakeFetch(200, body));
  assert.equal(record.outcome, "completion");
  assert.equal(record.completion.text, "ready");
});

test("a network error settles to outcome refusal without throwing", async () => {
  const throwingFetch = async () => { throw new Error("ECONNREFUSED"); };
  const record = await runOpenAiCompatibleChatExchange(PACKET, CONFIG, throwingFetch);
  assert.equal(record.outcome, "refusal");
  assert.deepEqual(record.refusal.unmet, ["network-error"]);
});

test("tokenUsage is undefined when the response body carries no usage object", () => {
  assert.equal(tokenUsage({}, "test-provider"), undefined);
});

test("the request body carries the caller's bearer key and max-tokens mapping", async () => {
  let observed;
  const capturingFetch = async (url, init) => { observed = { url, init }; return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }) }; };
  await runOpenAiCompatibleChatExchange({ ...PACKET, "max-tokens": 64 }, CONFIG, capturingFetch);
  assert.equal(observed.url, CONFIG.chatCompletionsUrl);
  assert.equal(observed.init.headers.Authorization, "Bearer secret");
  assert.equal(JSON.parse(observed.init.body).max_tokens, 64);
});

const ROWS = [
  { providerId: "ollama-local", chatCompletionsUrl: "http://127.0.0.1:11434/v1/chat/completions", apiKeyEnvVar: "OLLAMA_API_KEY", keyed: true },
  { providerId: "gemini-direct", chatCompletionsUrl: "https://example.invalid/gemini", apiKeyEnvVar: "API_KEY_GOOGLE_GEMINI", keyed: true },
  { providerId: "cerebras", chatCompletionsUrl: "https://example.invalid/cerebras", apiKeyEnvVar: "CEREBRAS_API_KEY", keyed: false },
];
const POLICY = { freeFirstOrder: ["ollama-local", "gemini-direct", "cerebras"] };

test("selectFreeFirstProvider returns the first armed row in policy order", () => {
  assert.equal(selectFreeFirstProvider(ROWS, POLICY).providerId, "ollama-local");
});

test("selectFreeFirstProvider skips excluded and unarmed rows", () => {
  assert.equal(selectFreeFirstProvider(ROWS, POLICY, { excludeProviderIds: ["ollama-local"] }).providerId, "gemini-direct");
  assert.equal(selectFreeFirstProvider(ROWS, POLICY, { excludeProviderIds: ["ollama-local", "gemini-direct"] }), null);
});

test("selectFreeFirstProvider never selects a providerId outside routingPolicy.freeFirstOrder", () => {
  const rowsWithPaid = [...ROWS, { providerId: "some-paid-frontier-provider", chatCompletionsUrl: "https://example.invalid/paid", apiKeyEnvVar: "PAID_KEY", keyed: true }];
  const selected = selectFreeFirstProvider(rowsWithPaid, POLICY, { excludeProviderIds: ["ollama-local", "gemini-direct", "cerebras"] });
  assert.equal(selected, null);
});

test("isRateLimitRefusal recognizes an HTTP 429 refusal and rejects other refusal shapes", () => {
  assert.equal(isRateLimitRefusal({ unmet: ["http-failure:429"] }), true);
  assert.equal(isRateLimitRefusal({ unmet: ["http-failure:404"] }), false);
  assert.equal(isRateLimitRefusal({ unmet: ["network-error"] }), false);
  assert.equal(isRateLimitRefusal(null), false);
  assert.equal(isRateLimitRefusal(undefined), false);
});

test("resolveFreeFirstAttemptPacket prefers the row's own defaultModel over the caller's packet.model", () => {
  const attempt = resolveFreeFirstAttemptPacket(PACKET, { providerId: "groq", defaultModel: "openai/gpt-oss-20b" });
  assert.equal(attempt.model, "openai/gpt-oss-20b");
  assert.deepEqual(attempt.messages, PACKET.messages);
});

test("resolveFreeFirstAttemptPacket falls back to packet.model when the row has no defaultModel", () => {
  const attempt = resolveFreeFirstAttemptPacket(PACKET, { providerId: "cerebras" });
  assert.equal(attempt.model, PACKET.model);
});

test("content/openai/providers/catalog.json's routingPolicy.freeFirstOrder names only rows present in the catalog", () => {
  const catalogPath = fileURLToPath(new URL("../../content/openai/providers/catalog.json", import.meta.url));
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const rowIds = new Set(catalog.rows.map((row) => row.providerId));
  assert.ok(Array.isArray(catalog.routingPolicy?.freeFirstOrder), "catalog.routingPolicy.freeFirstOrder must be an array");
  for (const providerId of catalog.routingPolicy.freeFirstOrder) {
    assert.ok(rowIds.has(providerId), `freeFirstOrder names ${providerId}, which has no catalog row`);
  }
});

test("catalog admits the exact OpenRouter free variants whose account and live price evidence supports zero cash", () => {
  const catalogPath = fileURLToPath(new URL("../../content/openai/providers/catalog.json", import.meta.url));
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const eligibleIds = ["openrouter-cohere-north-free", "openrouter-poolside", "openrouter-nemotron"];
  for (const providerId of eligibleIds) {
    const row = catalog.rows.find((candidate) => candidate.providerId === providerId);
    assert.ok(row, `catalog row ${providerId} is present`);
    assert.equal(row.entitlement?.model, row.defaultModel, `${providerId} binds its entitlement to its configured model`);
    assert.equal(isZeroCashProvider(row), true, `${providerId} is eligible for strict zero-cash routing`);
  }
  for (const providerId of ["openrouter", "openrouter-glm"]) {
    const row = catalog.rows.find((candidate) => candidate.providerId === providerId);
    assert.equal(isZeroCashProvider(row), false, `${providerId} remains excluded until its exact configured model is live-priced again`);
  }
});

test("content/openai/providers/catalog.json prices routable rows and keeps unpriced provider data out of automatic routing", () => {
  const catalogPath = fileURLToPath(new URL("../../content/openai/providers/catalog.json", import.meta.url));
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  for (const row of catalog.rows) {
    const rate = row.pricePerMillionTokensMicroUsd;
    if (!rate) {
      assert.ok(["unpriced-provider-data", "subscription-command"].includes(row.classification));
      if (row.classification === "unpriced-provider-data") assert.equal(row.keyed, false);
      assert.equal(catalog.routingPolicy.freeFirstOrder.includes(row.providerId), false);
      continue;
    }
    assert.equal(typeof rate.input, "number");
    assert.equal(typeof rate.output, "number");
  }
  assert.ok(catalog.rows.some((row) => row.pricePerMillionTokensMicroUsd?.input > 0 || row.pricePerMillionTokensMicroUsd?.output > 0), "at least one catalog row must carry a real nonzero paid-frontier rate");
});

test("computePurchasePrice prices a free-tier (0/0 rate) row at exactly zero, with or without usage", () => {
  const freeRow = { providerId: "ollama-local", pricePerMillionTokensMicroUsd: { input: 0, output: 0 } };
  assert.deepEqual(computePurchasePrice(freeRow), { denomination: PURCHASE_PRICE_DENOMINATION, amount: { numerator: "0", denominator: "1" } });
  assert.deepEqual(
    computePurchasePrice(freeRow, { input: { quantity: 19 }, output: { quantity: 1966 } }),
    { denomination: PURCHASE_PRICE_DENOMINATION, amount: { numerator: "0", denominator: "1" } },
  );
});

test("computePurchasePrice computes an exact nonzero price from a paid row's rate and witnessed usage", () => {
  const paidRow = { providerId: "openrouter-gpt-4o-paid-reference", pricePerMillionTokensMicroUsd: { input: 2500000, output: 10000000 } };
  const price = computePurchasePrice(paidRow, { input: { quantity: 100 }, output: { quantity: 50 } });
  assert.equal(price.denomination, PURCHASE_PRICE_DENOMINATION);
  // (100 * 2,500,000 + 50 * 10,000,000) / 1,000,000 = 750,000,000 / 1,000,000 = 750/1 exact.
  assert.deepEqual(price.amount, { numerator: "750", denominator: "1" });
});

test("computePurchasePrice never estimates: a paid row with no witnessed usage throws", () => {
  const paidRow = { providerId: "openrouter-gpt-4o-paid-reference", pricePerMillionTokensMicroUsd: { input: 2500000, output: 10000000 } };
  assert.throws(() => computePurchasePrice(paidRow), /never estimated/u);
  assert.throws(() => computePurchasePrice(paidRow, {}), /never estimated/u);
});

test("computePurchasePrice refuses a row with no rate data", () => {
  assert.throws(() => computePurchasePrice({ providerId: "no-rate" }), /carries no pricePerMillionTokensMicroUsd/u);
});

function withEnv(t, name, value) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
}

test("dispatchFreeFirstChatCompletion takes an in-memory catalog and packet with no file paths or argv", async (t) => {
  withEnv(t, "TEST_FREE_KEY", "any-nonempty-value");
  const catalog = {
    rows: [{ providerId: "test-free", chatCompletionsUrl: "https://example.invalid/v1/chat/completions", apiKeyEnvVar: "TEST_FREE_KEY", keyed: true }],
    routingPolicy: { freeFirstOrder: ["test-free"] },
  };
  const result = await dispatchFreeFirstChatCompletion(
    { catalog, packet: PACKET },
    { request: fakeFetch(200, { model: "test-model", choices: [{ message: { content: "hi back" }, finish_reason: "stop" }] }) },
  );
  assert.equal(result.ok, true);
  assert.equal(result.provider, "test-free");
  assert.equal(result.exchange.completion.text, "hi back");
});

test("dispatchFreeFirstChatCompletion retries the next free provider on a rate-limit refusal, never falling back past freeFirstOrder", async (t) => {
  withEnv(t, "TEST_RL_KEY", "any-nonempty-value");
  withEnv(t, "TEST_OK_KEY", "any-nonempty-value");
  const catalog = {
    rows: [
      { providerId: "rate-limited", chatCompletionsUrl: "https://example.invalid/a", apiKeyEnvVar: "TEST_RL_KEY", keyed: true },
      { providerId: "second-free", chatCompletionsUrl: "https://example.invalid/b", apiKeyEnvVar: "TEST_OK_KEY", keyed: true },
    ],
    routingPolicy: { freeFirstOrder: ["rate-limited", "second-free"] },
  };
  let call = 0;
  const request = async (...args) => {
    call += 1;
    if (call === 1) return { ok: false, status: 429, statusText: "Too Many Requests", text: async () => "{}" };
    return fakeFetch(200, { model: "test-model", choices: [{ message: { content: "second answered" } }] })(...args);
  };
  const result = await dispatchFreeFirstChatCompletion({ catalog, packet: PACKET }, { request });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "second-free");
  assert.deepEqual(result.tried.map((attempt) => attempt.providerId), ["rate-limited", "second-free"]);
});

test("dispatchFreeFirstChatCompletion rejects an invalid packet before dispatching", async () => {
  await assert.rejects(
    dispatchFreeFirstChatCompletion({ catalog: { rows: [], routingPolicy: { freeFirstOrder: [] } }, packet: { model: "", messages: [] } }),
    /packet is invalid/u,
  );
});

test("shared assistant transport preserves tool calls, usage, and truncation", async () => {
  const { exchangeOpenAiCompatibleAssistantMessage } = await import("../../src/openai/openai-compatible-chat-completion.mjs");
  const body = { choices: [{ message: { content: null, tool_calls: [{ id: "c", function: { name: "observe", arguments: "{}" } }] }, finish_reason: "length" }], usage: { total_tokens: 7 } };
  const result = await exchangeOpenAiCompatibleAssistantMessage(PACKET, CONFIG, fakeFetch(200, body));
  assert.deepEqual(result, { ok: true, body });
});

test("shared transport keeps retry timing and excludes provider secret-bearing refusal bodies", async () => {
  const { exchangeOpenAiCompatibleAssistantMessage } = await import("../../src/openai/openai-compatible-chat-completion.mjs");
  const result = await exchangeOpenAiCompatibleAssistantMessage(PACKET, CONFIG, async () => new Response("credential=secret", { status: 429, headers: { "retry-after": "45" } }));
  assert.deepEqual(result, { ok: false, cause: { kind: "http", reason: "provider-refused", status: 429, retryAfterSeconds: 45 } });
  assert.doesNotMatch(JSON.stringify(result), /credential|secret/u);
});

test("zero cash selection refuses unknown, paid, overage-enabled, and model-mismatched entitlements", () => {
  const free = { ...ROWS[0], pricePerMillionTokensMicroUsd: { input: 0, output: 0 }, defaultModel: "free", entitlement: { cashCost: "zero", paidOverage: "forbidden", model: "free" } };
  const strict = (row) => selectFreeFirstProvider([row], POLICY, { zeroCashOnly: true });
  assert.equal(strict(free), free);
  assert.equal(strict(ROWS[0]), null);
  assert.equal(strict({ ...free, pricePerMillionTokensMicroUsd: { input: 1, output: 0 } }), null);
  assert.equal(strict({ ...free, entitlement: { ...free.entitlement, paidOverage: "allowed" } }), null);
  assert.equal(strict({ ...free, defaultModel: "paid" }), null);
});

test("shared transport carries caller cancellation into the request", async () => {
  const { exchangeOpenAiCompatibleAssistantMessage } = await import("../../src/openai/openai-compatible-chat-completion.mjs");
  const controller = new AbortController();
  controller.abort();
  const result = await exchangeOpenAiCompatibleAssistantMessage(PACKET, { ...CONFIG, signal: controller.signal }, async (_url, init) => { init.signal.throwIfAborted(); });
  assert.deepEqual(result.cause, { kind: "transport", reason: "timeout" });
});

test("body reading distinguishes invalid JSON, a deadline and receiver cancellation after HTTP 200", async () => {
  const { exchangeOpenAiCompatibleAssistantMessage } = await import("../../src/openai/openai-compatible-chat-completion.mjs");
  const malformed = await exchangeOpenAiCompatibleAssistantMessage(PACKET, CONFIG, async () => new Response("not JSON", { status: 200 }));
  assert.deepEqual(malformed.cause, { kind: "protocol", reason: "invalid-json-response", phase: "response-body", status: 200 });
  const deadline = await exchangeOpenAiCompatibleAssistantMessage(PACKET, { ...CONFIG, timeoutMs: 5 }, async (_url, init) => ({
    ok: true, status: 200,
    json: () => new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("deadline did not abort")), 1000);
      init.signal.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal.reason); }, { once: true });
    }),
  }));
  assert.deepEqual(deadline.cause, { kind: "transport", reason: "timeout", phase: "response-body", status: 200 });
  const controller = new AbortController();
  const cancelled = await exchangeOpenAiCompatibleAssistantMessage(PACKET, { ...CONFIG, signal: controller.signal }, async () => ({
    ok: true, status: 200, json: async () => { controller.abort(); throw controller.signal.reason; },
  }));
  assert.deepEqual(cancelled.cause, { kind: "cancelled", reason: "receiver-cancelled", phase: "response-body", status: 200 });
});

test("strict free requests reject hidden model fallback and billable extensions before network", async () => {
  for (const params of [{ model: "paid" }, { models: ["paid"] }, { plugins: [{ id: "web" }] }, { provider: { allow_fallbacks: true } }]) {
    let calls = 0;
    await assert.rejects(dispatchFreeFirstChatCompletion({ catalog: { rows: [], routingPolicy: { freeFirstOrder: [] } }, packet: { ...PACKET, params }, zeroCashOnly: true }, { request: async () => { calls += 1; } }), /zero-cash-request-parameter-not-admitted/u);
    assert.equal(calls, 0);
  }
});

test("strict free cost boundary rejects native tools, malformed functions, and native selectors", async () => {
  const catalog = { rows: [], routingPolicy: { freeFirstOrder: [] } };
  for (const params of [{ tools: [{ type: "web_search" }] }, { tools: [{ type: "code_interpreter" }] }, { tools: [{ type: "function", function: { name: "lookup" } }] }, { tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } }, plugins: ["web"] }] }, { tools: null }, { tool_choice: { type: "web_search" } }, { tool_choice: { type: "function", function: { name: "unoffered" } } }]) {
    let calls = 0;
    await assert.rejects(dispatchFreeFirstChatCompletion({ catalog, packet: { ...PACKET, params }, zeroCashOnly: true }, { request: async () => { calls += 1; } }), /zero-cash-tool/u);
    assert.equal(calls, 0);
  }
});

test("strict free cost boundary admits explicitly offered function tools and their selector", async () => {
  const functionTool = { type: "function", function: { name: "observe", parameters: { type: "object", properties: {}, additionalProperties: false } } };
  const row = { providerId: "free", keyed: true, apiKeyEnvVar: "TEST_FREE_KEY", chatCompletionsUrl: CONFIG.chatCompletionsUrl, defaultModel: "free", pricePerMillionTokensMicroUsd: { input: 0, output: 0 }, entitlement: { cashCost: "zero", paidOverage: "forbidden", model: "free" } };
  const result = await dispatchFreeFirstChatCompletion({ catalog: { rows: [row], routingPolicy: { freeFirstOrder: ["free"] } }, packet: { ...PACKET, params: { tools: [functionTool], tool_choice: { type: "function", function: { name: "observe" } } } }, zeroCashOnly: true }, { env: { TEST_FREE_KEY: "secret" }, request: fakeFetch(200, { choices: [{ message: { content: "done" } }] }) });
  assert.equal(result.ok, true);
});


test("free-first dispatch admits explicit unauthenticated loopback and still skips cloud without credentials", async () => {
  const rows = [
    { providerId: "cloud", keyed: true, apiKeyEnvVar: "CLOUD_KEY", chatCompletionsUrl: "https://example.com/v1/chat/completions" },
    { providerId: "local", keyed: true, auth: { mode: "none" }, chatCompletionsUrl: "http://127.0.0.1:11434/v1/chat/completions" },
  ];
  const result = await dispatchFreeFirstChatCompletion({
    catalog: { rows, routingPolicy: { freeFirstOrder: ["cloud", "local"] } },
    packet: { model: "fixture", messages: [{ role: "user", content: "hello" }] },
  }, { env: {}, request: async (url, options) => {
    assert.equal(url, rows[1].chatCompletionsUrl);
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ choices: [{ message: { content: "local reply" } }] });
  } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.tried.map(({ providerId, outcome }) => [providerId, outcome]), [["cloud", "misconfigured"], ["local", "completion"]]);
});
