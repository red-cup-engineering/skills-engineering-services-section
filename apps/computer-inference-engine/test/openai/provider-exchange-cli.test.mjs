import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const shared = fileURLToPath(new URL("../", import.meta.url));
const providers = [
  ["groq-inference-team", "groq", "GROQ_API_KEY", "API_KEY_GROQ", "GROQ_INFERENCE_DEFAULT_MODEL"],
  ["openrouter-inference-team", "openrouter", "OPENROUTER_API_KEY", "API_KEY_OPENROUTER", "OPENROUTER_INFERENCE_DEFAULT_MODEL"],
  ["nvidia-inference-team", "nvidia-nim", "NVIDIA_API_KEY", "API_KEY_NVIDIA_NIM"],
  ["github-models-inference-team", "github-models", "GITHUB_MODELS_TOKEN", "GITHUB_TOKEN", "GITHUB_MODELS_INFERENCE_DEFAULT_MODEL"],
  ["llm-services-section/services/openai-services-section", "openai", "OPENAI_API_KEY", "OPENAI_API_KEY", "OPENAI_INFERENCE_DEFAULT_MODEL"],
];
const packet = { model: "example:free", messages: [{ role: "user", content: "hello" }], "max-tokens": 1200, params: { provider: { forbidden: true } } };

function fixture(t, provider) {
  const root = mkdtempSync(join(tmpdir(), "provider-exchange-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(dirname(shared.replace(/\/$/u, "")), provider[0]);
  const relative = provider[1] === "openai" ? "scripts/run-one-exchange.mjs" : "run-one-exchange.mjs";
  const legacy = provider[1] === "openai";
  const script = legacy ? join(root, relative) : join(shared, "scripts/dispatch-chat-completion.mjs");
  if (legacy) { mkdirSync(dirname(script), { recursive: true }); cpSync(join(source, relative), script); }
  mkdirSync(join(root, "content/policies"), { recursive: true });
  writeFileSync(join(root, "content/policies/typed-inference-rate-capacity.json"), '{"minimumLiveExchangeIntervalMilliseconds":0}');
  mkdirSync(join(root, "node_modules/@red-cup-engineering"), { recursive: true });
  symlinkSync(shared, join(root, "node_modules/@red-cup-engineering/computer-inference-engine/openai"), "dir");
  const preload = join(root, "transport.mjs");
  writeFileSync(preload, `import { appendFileSync } from "node:fs";
    globalThis.fetch = async (url, options) => {
      appendFileSync(process.env.CAPTURE, JSON.stringify({url, ...options, signal: options.signal ? "signal" : null}) + "\\n");
      if (url.endsWith("/key")) return Response.json({data:{is_free_tier:process.env.PAID !== "yes"}});
      if (url.endsWith("/models")) return Response.json({data:[{id:"example:free",pricing:{prompt:"0",completion:"0"}}]});
      if (process.env.HTTP_ERROR) return new Response("refused", {status:429});
      if (process.env.BAD_JSON) return new Response("not JSON");
      if (process.env.NETWORK_ERROR) throw new Error("offline");
      return Response.json({model:"witnessed-model",choices:[{message:JSON.parse(process.env.ASSISTANT),finish_reason:"stop"}],usage:{prompt_tokens:7,completion_tokens:9}});
    };`);
  return {
    root, script,
    run(input = packet, env = {}, args = []) {
      const packetFile = join(root, "packet.json"), capture = join(root, "capture.jsonl");
      writeFileSync(packetFile, JSON.stringify(input));
      rmSync(capture, { force: true });
      const result = spawnSync(process.execPath, ["--import", preload, script, ...(legacy ? [] : [provider[1]]), packetFile, ...(legacy ? [] : ["--resource-root", root]), ...args], {
        encoding: "utf8", env: { PATH: process.env.PATH, CAPTURE: capture, ASSISTANT: '{"content":"hello back"}', GROQ_INFERENCE_MIN_INTERVAL_MS: "0", [provider[3]]: "fixture-secret", ...env },
      });
      return { ...result, record: result.stdout ? JSON.parse(result.stdout) : undefined, calls: existsSync(capture) ? readFileSync(capture, "utf8").trim().split("\n").map(JSON.parse) : [] };
    },
  };
}

for (const provider of providers) test(`${provider[1]} runs its actual CLI through the shared exchange`, (t) => {
  const f = fixture(t, provider);
  const dry = f.run(packet, {}, ["--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.record["auth-presence"][provider[3]], true);
  assert.equal(dry.calls.length, 0);
  assert.equal(existsSync(join(f.root, "data")), false);
  assert.equal(f.run({}).status, 2);
  if (provider[4]) assert.equal(f.run({ ...packet, model: null }, { [provider[4]]: "example:free" }, ["--dry-run"]).status, 0);
  const live = f.run();
  assert.equal(live.status, 0, live.stderr);
  assert.equal(live.record.outcome, "completion");
  assert.equal(live.record.completion.model, "witnessed-model");
  assert.deepEqual(live.record.packet, packet);
  assert.equal(live.record.usage.input.denomination, `${provider[1]}-tokens-in`);
  assert.equal(live.record.cost.denomination, `${provider[1]}-api-requests`);
  const post = live.calls.find((call) => call.method === "POST");
  assert.equal(post.headers.Authorization, "Bearer fixture-secret");
  assert.equal(post.signal, null);
  const body = JSON.parse(post.body);
  assert.equal(body.max_tokens, provider[1] === "groq" ? 900 : 1200);
  if (["groq", "github-models"].includes(provider[1])) assert.equal(body.provider, undefined);
  if (provider[1] === "openrouter") {
    assert.deepEqual(body.provider, { allow_fallbacks: false, max_price: { prompt: 0, completion: 0, request: 0, image: 0 } });
    assert.equal(live.calls.filter((call) => call.url.endsWith("/key")).length, 2);
    const paid = f.run(packet, { PAID: "yes" });
    assert.equal(paid.record.outcome, "refusal");
    assert.equal(paid.calls.some((call) => call.method === "POST"), false);
    const tools = f.run(packet, { ASSISTANT: JSON.stringify({ content: null, reasoning: "consider", tool_calls: [{ function: { name: "lookup", arguments: "{}" } }] }) });
    assert.equal(tools.record.completion.text, "consider\n<tool_call>lookup {}</tool_call>");
  }
  if (["openai", "github-models"].includes(provider[1])) assert.ok(existsSync(join(provider[1] === "openai" ? dirname(f.script) : f.root, "content/exchanges", `${live.record.id}.json`)));
  else assert.equal(existsSync(join(f.root, "content/exchanges")), false);
  for (const [flag, unmet] of [["HTTP_ERROR", "http-failure:429"], ["BAD_JSON", "unparseable-response-body"], ["NETWORK_ERROR", "network-error"]]) {
    const failure = f.run(packet, { [flag]: "yes" });
    assert.equal(failure.record.outcome, "refusal");
    assert.deepEqual(failure.record.refusal.unmet, [unmet]);
  }
});


test("the canonical record schema refuses malformed output before persistence", async (t) => {
  const { finalizeProviderExchange } = await import("../../src/openai/provider-runtime.mjs");
  const root = mkdtempSync(join(tmpdir(), "provider-schema-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => finalizeProviderExchange({ id: "invalid-record", packet, outcome: "completion", cost: {} }, { persistExchange: true }, root), /failed schema validation/);
  assert.equal(existsSync(join(root, "content/exchanges")), false);
});
