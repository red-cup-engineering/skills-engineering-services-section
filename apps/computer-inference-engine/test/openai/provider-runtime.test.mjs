import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { providerPacket, performProviderInference, executeProviderMessage, withProviderCapacity, admitRateState } from "../../src/openai/provider-runtime.mjs";

function temporary(t) { const root = mkdtempSync(join(tmpdir(), "shared-provider-")); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }

test("typed inference delivers Groq work directly through one bounded shared request", async (t) => {
  let body;
  const result = await performProviderInference("groq", { instruction: "review", input: JSON.stringify({ executionBounds: { maximumOutputTokens: 128 } }), model: "openai/gpt-oss-20b", mode: "live" }, {
    resourceRoot: temporary(t), env: { API_KEY_GROQ: "fixture-secret", GROQ_INFERENCE_MIN_INTERVAL_MS: "0" },
    request: async (url, options) => { body = JSON.parse(options.body); return Response.json({ choices: [{ message: { content: "review complete" } }], usage: { prompt_tokens: 7, completion_tokens: 9 } }); },
  });
  assert.equal(body.max_tokens, 128);
  assert.deepEqual(result, { disposition: "completion", text: "review complete", usage: { prompt_tokens: 7, completion_tokens: 9 } });
});

test("rate timestamp advances monotonically and malformed state refuses admission", async (t) => {
  const statePath = join(temporary(t), "last-admission"), waits = [];
  const wait = async (ms) => waits.push(ms);
  await admitRateState({ statePath, minimumIntervalMilliseconds: 1000, now: 2000, wait });
  assert.deepEqual(await admitRateState({ statePath, minimumIntervalMilliseconds: 1000, now: 2500, wait }), { admittedAt: 3000, delayMilliseconds: 500 });
  assert.deepEqual(waits, [0, 500]);
  assert.equal(readFileSync(statePath, "utf8"), "3000\n");
  writeFileSync(statePath, "not-a-time");
  await assert.rejects(admitRateState({ statePath, minimumIntervalMilliseconds: 1000 }), /malformed/);
});

test("one kernel lease serializes independent users and releases after an action throws", async (t) => {
  const lock = join(temporary(t), "slot.lock"), order = [];
  let entered, release;
  const ready = new Promise((resolve) => { entered = resolve; });
  const waiting = new Promise((resolve) => { release = resolve; });
  const first = withProviderCapacity(lock, async () => { order.push("first"); entered(); await waiting; order.push("first done"); });
  await ready;
  const second = withProviderCapacity(lock, async () => { order.push("second"); throw new Error("fixture failure"); });
  const rejection = assert.rejects(second, /fixture failure/);
  release();
  await Promise.all([first, rejection]);
  await withProviderCapacity(lock, async () => order.push("third"));
  assert.deepEqual(order, ["first", "first done", "second", "third"]);
});

test("OpenRouter requires a caller output allocation and propagates capacity refusal", async (t) => {
  const marks = { instruction: "work", input: JSON.stringify({ executionBounds: { maximumOutputTokens: 300 } }), model: "example:free", mode: "live" };
  assert.equal(providerPacket("openrouter", marks)["max-tokens"], 300);
  assert.throws(() => providerPacket("openrouter", { ...marks, input: "{}" }), /supplied by the consuming work lot/);
  const result = await performProviderInference("openrouter", marks, {
    resourceRoot: temporary(t), env: { API_KEY_OPENROUTER: "fixture-secret" },
    request: async (url) => url.endsWith("/key") ? Response.json({ data: { is_free_tier: true } }) : url.endsWith("/models") ? Response.json({ data: [{ id: "example:free", pricing: { prompt: "0", completion: "0" } }] }) : new Response("quota", { status: 429 }),
  });
  assert.equal(result.disposition, "refused");
  assert.match(result.text, /HTTP 429/);
});

test("provider runtime loads without settlement credentials; typed settlement still requires them", async (t) => {
  const prior = process.env.EVM_RPC_URL;
  delete process.env.EVM_RPC_URL;
  try { await assert.rejects(executeProviderMessage("groq", {}, { resourceRoot: temporary(t) }), /EVM_RPC_URL must name the settlement chain/); }
  finally { if (prior !== undefined) process.env.EVM_RPC_URL = prior; }
});


test("native tool turns inherit OpenRouter guards by endpoint and preserve raw carriers exactly once", async (t) => {
  const { exchangeOpenAiCompatibleAssistantMessage } = await import("../../src/openai/openai-compatible-chat-completion.mjs");
  const calls = [], tools = [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }];
  const assistant = { content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } }] };
  const result = await exchangeOpenAiCompatibleAssistantMessage({ model: "example:free", messages: [{ role: "user", content: "inspect" }], tools, provider: { allow_fallbacks: true } }, {
    providerId: "caller-alias", chatCompletionsUrl: "https://openrouter.ai/api/v1/chat/completions", apiKey: "fixture-secret", resourceRoot: temporary(t), execution: {},
  }, async (url, options) => {
    calls.push(url);
    if (url.endsWith("/key")) return Response.json({ data: { is_free_tier: true } });
    if (url.endsWith("/models")) return Response.json({ data: [{ id: "example:free", pricing: { prompt: "0", completion: "0" } }] });
    const body = JSON.parse(options.body);
    assert.deepEqual(body.tools, tools);
    assert.equal(body.provider.allow_fallbacks, false);
    return Response.json({ choices: [{ message: assistant, finish_reason: "tool_calls" }], usage: { completion_tokens: 3 } });
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.body.choices[0].message, assistant);
  assert.equal(result.body.usage.completion_tokens, 3);
  assert.equal(calls.filter((url) => url.endsWith("/key")).length, 2);
  assert.equal(calls.filter((url) => url.endsWith("/models")).length, 1);
  assert.equal(calls.filter((url) => url.endsWith("/chat/completions")).length, 1);
});

test("native Groq turns share credential aliases and cannot widen the advertised output ceiling", async (t) => {
  const { exchangeOpenAiCompatibleAssistantMessage } = await import("../../src/openai/openai-compatible-chat-completion.mjs");
  const result = await exchangeOpenAiCompatibleAssistantMessage({ model: "example", messages: [{ role: "user", content: "inspect" }], max_tokens: 9999, provider: {} }, {
    providerId: "groq", chatCompletionsUrl: "https://api.groq.com/openai/v1/chat/completions", resourceRoot: temporary(t), env: { API_KEY_GROQ: "fixture-secret", GROQ_INFERENCE_MIN_INTERVAL_MS: "0" },
  }, async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, 900);
    assert.equal(body.provider, undefined);
    assert.equal(options.headers.Authorization, "Bearer fixture-secret");
    return Response.json({ choices: [{ message: { content: "bounded" } }] });
  });
  assert.equal(result.ok, true);
});

test("fail-fast capacity refuses a second process holder and tolerates leftover sentinel files", async (t) => {
  const lock = join(temporary(t), "slot.lock");
  writeFileSync(lock, "dead-process-sentinel\n");
  let enter, release;
  const ready = new Promise(resolve => { enter = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const first = withProviderCapacity(lock, async () => { enter(); await held; }, { wait: false });
  await ready;
  try {
    await assert.rejects(withProviderCapacity(lock, () => assert.fail("occupied capacity must not execute"), { wait: false }), /concurrency bound is occupied/);
  } finally { release(); await first; }
  assert.equal(await withProviderCapacity(lock, () => "reacquired", { wait: false }), "reacquired");
});

test("kernel capacity is released when its owning runtime dies", { timeout: 5000 }, async (t) => {
  const lock = join(temporary(t), "slot.lock");
  const runtime = new URL("../../src/openai/provider-runtime.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import { withProviderCapacity } from ${JSON.stringify(runtime)}; await withProviderCapacity(${JSON.stringify(lock)}, async () => { process.stdout.write("ready\\n"); await new Promise(() => {}); });`], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  const closed = once(child, "close");
  await once(child.stdout, "data");
  child.kill("SIGKILL");
  await closed;
  assert.equal(await withProviderCapacity(lock, () => "released", { signal: AbortSignal.timeout(2000) }), "released");
});

test("catalog policy refusal survives both native and packet boundaries without inference", async (t) => {
  const { exchangeOpenAiCompatibleAssistantMessage, runOpenAiCompatibleChatExchange } = await import("../../src/openai/openai-compatible-chat-completion.mjs");
  const config = { providerId: "openrouter", chatCompletionsUrl: "https://openrouter.ai/api/v1/chat/completions", apiKey: "fixture-secret", resourceRoot: temporary(t) };
  let calls = 0;
  const request = async (url) => { calls++; assert.ok(!url.endsWith("/chat/completions")); return Response.json(url.endsWith("/key") ? { data: { is_free_tier: true } } : { data: [] }); };
  const packet = { model: "missing:free", messages: [{ role: "user", content: "inspect" }] };
  const native = await exchangeOpenAiCompatibleAssistantMessage(packet, config, request);
  assert.deepEqual(native, { ok: false, cause: { kind: "policy", reason: "model-not-listed", phase: "preflight" } });
  const record = await runOpenAiCompatibleChatExchange(packet, config, request);
  assert.equal(record.outcome, "refusal");
  assert.deepEqual(record.refusal.unmet, ["provider-policy:model-not-listed"]);
  assert.equal(calls, 4);
});

test("postflight policy drift is distinguished from network failure and raw errors stay private", async (t) => {
  const { exchangeOpenAiCompatibleAssistantMessage } = await import("../../src/openai/openai-compatible-chat-completion.mjs");
  const config = { providerId: "openrouter", chatCompletionsUrl: "https://openrouter.ai/api/v1/chat/completions", apiKey: "fixture-secret", resourceRoot: temporary(t) };
  const body = { model: "example:free", messages: [{ role: "user", content: "inspect" }] };
  let keys = 0;
  const drift = await exchangeOpenAiCompatibleAssistantMessage(body, config, async (url) => Response.json(url.endsWith("/key") ? { data: { is_free_tier: ++keys === 1 } } : url.endsWith("/models") ? { data: [{ id: "example:free", pricing: { prompt: "0", completion: "0" } }] } : { choices: [{ message: { content: "candidate" } }] }));
  assert.deepEqual(drift.cause, { kind: "policy", reason: "account-not-free-tier", phase: "postflight" });
  const failed = await exchangeOpenAiCompatibleAssistantMessage(body, config, async () => { throw new Error("sensitive credential fixture-secret"); });
  assert.deepEqual(failed.cause, { kind: "transport", reason: "request-failed", phase: "preflight" });
  assert.ok(!JSON.stringify(failed).includes("fixture-secret"));
});
