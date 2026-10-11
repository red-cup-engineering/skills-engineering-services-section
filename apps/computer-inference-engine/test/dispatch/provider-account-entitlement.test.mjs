import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createProviderAccountEntitlementResolver } from "../../src/dispatch/provider-account-entitlement.mjs";
import { loadDirectEndpointProviderDescriptors, isDirectEndpointZeroCashEligible, dispatchDirectEndpointOffer } from "../../src/dispatch/direct-endpoint-provider.mjs";

const secret = "synthetic-credential-for-unit-test";
const environment = { DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([{ actor: "urn:fixture:account-provider", endpoint: "https://fixture.invalid/completions", model: "fixture-model", apiKey: secret }]) };
const plain = loadDirectEndpointProviderDescriptors(environment).find(row => row.provider === "urn:fixture:account-provider");
assert.ok(plain);
const start = Date.parse("2026-09-07T05:00:00Z");
const observation = { type: "ProviderAccountEntitlementObservation", providerIdentity: plain.provider, accountIdentity: "accounts/fixture",
  endpoint: plain.endpoint, model: plain.model, credentialSha256: createHash("sha256").update(secret).digest("hex"),
  observedAt: new Date(start).toISOString(), validUntil: new Date(start + 3_600_000).toISOString(), evidenceIdentity: "urn:fixture:billing-observation",
  cashCost: "zero", paidOverage: "forbidden", billingEnabled: false, billingAccountBound: false };

test("account-dependent free admission requires matching private credential and current billing evidence", () => {
  assert.equal(isDirectEndpointZeroCashEligible(plain), false);
  const resolve = createProviderAccountEntitlementResolver([observation], { now: () => start });
  const result = resolve(plain);
  assert.equal(result.accountIdentity, "accounts/fixture");
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(observation.credentialSha256), false);
  for (const patch of [{ apiKey: "rotated" }, { endpoint: "https://other.invalid" }, { model: "paid-override" }, { provider: "provider:other" }]) {
    assert.equal(resolve({ ...plain, ...patch }), null);
  }
});
test("billing attachment, unknown billing, future evidence and expiry all fail closed", () => {
  for (const patch of [{ billingEnabled: true }, { billingEnabled: undefined }, { billingAccountBound: true },
    { paidOverage: "permitted" }, { observedAt: new Date(start + 1).toISOString() },
    { validUntil: new Date(start).toISOString() }, { validUntil: new Date(start + 3_600_001).toISOString() }]) {
    assert.equal(createProviderAccountEntitlementResolver([{ ...observation, ...patch }], { now: () => start })(plain), null);
  }
});

test("loaded account entitlement expires without reconnect and cannot survive a changed credential", async () => {
  let clock = start;
  const admitted = loadDirectEndpointProviderDescriptors(environment, { accountEntitlements: [observation], now: () => clock }).find(x => x.provider === plain.provider);
  assert.equal(isDirectEndpointZeroCashEligible(admitted), true);
  assert.equal(admitted.accountEntitlement.accountIdentity, "accounts/fixture");
  const rotated = loadDirectEndpointProviderDescriptors({ DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([{ actor: plain.provider, endpoint: plain.endpoint, model: plain.model, apiKey: "rotated" }]) }, { accountEntitlements: [observation], now: () => clock }).find(x => x.provider === plain.provider);
  assert.equal(isDirectEndpointZeroCashEligible(rotated), false);
  assert.equal(isDirectEndpointZeroCashEligible({ ...admitted, apiKey: "rotated" }), false);
  let invokeCalls = 0, fetchCalls = 0;
  await dispatchDirectEndpointOffer(admitted, { messages: [{ role: "user", content: "fixture" }], execution: {
    zeroCashOnly: true, fetchImpl: async () => { fetchCalls += 1; return new Response("{}"); },
  } }, { invoke: async (call) => {
    invokeCalls += 1;
    clock = start + 3_600_000;
    await assert.rejects(call.fetchImpl("https://fixture.invalid"), /zero-cash-entitlement-not-admitted/);
    return { type: "ReceiverOwnedToolAgentCompletion", provider: call.provider, model: call.model, text: "fixture", invocations: [], exchanges: [], durationMs: 0 };
  } });
  assert.equal(invokeCalls, 1);
  assert.equal(fetchCalls, 0);
  assert.equal(isDirectEndpointZeroCashEligible(admitted), false);
  await assert.rejects(dispatchDirectEndpointOffer(admitted, { messages: [{ role: "user", content: "fixture" }], execution: { zeroCashOnly: true } }, { invoke: async () => { invokeCalls += 1; } }), /zero-cash-entitlement-not-admitted/);
  assert.equal(invokeCalls, 1);
});
