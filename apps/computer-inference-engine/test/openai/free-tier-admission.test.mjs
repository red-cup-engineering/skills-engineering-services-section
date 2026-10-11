import assert from "node:assert/strict";
import test from "node:test";
import { admitOpenRouterFreeInvocation, OPENROUTER_ZERO_CASH_PROVIDER, verifyOpenRouterFreeAccount } from "../../src/openai/free-tier-admission.mjs";

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("admits only an exact zero-priced :free model under a free-tier key", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return url.endsWith("/key") ? response({ data: { is_free_tier: true, usage: 0 } }) : response({ data: [{ id: "example/model:free", pricing: { prompt: "0", completion: "0", request: "0" } }] }); };
  const result = await admitOpenRouterFreeInvocation({ apiKey: "test-key-value", model: "example/model:free", fetchImpl });
  assert.equal(result.account.isFreeTier, true);
  assert.equal(calls.length, 2);
});

test("refuses a non-free key before reading the model catalog", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response({ data: { is_free_tier: false } }); };
  await assert.rejects(admitOpenRouterFreeInvocation({ apiKey: "test-key-value", model: "example/model:free", fetchImpl }), /not machine-reported as free tier/u);
  assert.equal(calls, 1);
});

test("refuses price drift and a model without the exact free suffix", async () => {
  const fetchImpl = async (url) => url.endsWith("/key") ? response({ data: { is_free_tier: true } }) : response({ data: [{ id: "example/model:free", pricing: { prompt: "0.1", completion: "0" } }] });
  await assert.rejects(admitOpenRouterFreeInvocation({ apiKey: "test-key-value", model: "example/model:free", fetchImpl }), /not zero-priced/u);
  await assert.rejects(admitOpenRouterFreeInvocation({ apiKey: "test-key-value", model: "example/model", fetchImpl }), /exact :free/u);
  await assert.rejects(verifyOpenRouterFreeAccount({ apiKey: "", fetchImpl }), /credential is absent/u);
});

test("carries an immutable zero price ceiling at the provider billing boundary", () => {
  assert.deepEqual(OPENROUTER_ZERO_CASH_PROVIDER, { allow_fallbacks: false, max_price: { prompt: 0, completion: 0, request: 0, image: 0 } });
  assert.equal(Object.isFrozen(OPENROUTER_ZERO_CASH_PROVIDER), true);
  assert.equal(Object.isFrozen(OPENROUTER_ZERO_CASH_PROVIDER.max_price), true);
});

test("does not coerce null or empty catalog prices into zero", async () => {
  const fetchImpl = async (url) => url.endsWith("/key") ? response({ data: { is_free_tier: true } }) : response({ data: [{ id: "example/model:free", pricing: { prompt: null, completion: "" } }] });
  await assert.rejects(admitOpenRouterFreeInvocation({ apiKey: "test-key-value", model: "example/model:free", fetchImpl }), /not zero-priced/u);
});
