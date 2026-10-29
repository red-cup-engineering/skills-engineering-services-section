import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createExpectedResolutionPricingServer } from "../scripts/serve-expected-resolution-pricing.mjs";
import { CODEX_CUSTOMER, dispatchInferenceAsConfiguredCustomer, recordInferenceOutcome } from "../src/inference-dispatch.mjs";
import { directEndpointConfigurationIdentity } from "../src/direct-endpoint-provider.mjs";
import { appendDelivery, appendObservation } from "../src/expected-resolution-pricing.mjs";
import { loadInferencePlacementObservations, rankInferenceCandidates } from "../src/expected-resolution-pricing-client.mjs";
import { a2aExecutionConfiguration, executionConfigurationIdentity } from "../src/modern-rmn-carrier.mjs";
import { DIRECT_WITNESS_SETTLEMENT_CAPABILITY, RESOLUTION_CREDIT_ASSET, RESOLUTION_CREDIT_UNIT } from "../src/consideration.mjs";

const policy = { type: "ConsiderationPolicy", acceptableAlternatives: [{ id: "test", obligations: [{ kind: "credit", asset: RESOLUTION_CREDIT_ASSET, unit: RESOLUTION_CREDIT_UNIT, settlementCapabilities: [DIRECT_WITNESS_SETTLEMENT_CAPABILITY] }] }] };
const input = { objective: "Return one bounded result.", context: "bounded test context", workType: "inquiry", considerationPolicy: policy, outputSchema: { type: "object", required: ["answer"], properties: { answer: { type: "string" } }, additionalProperties: false } };
const descriptor = (model, endpoint, apiKey) => ({ provider: "urn:ame:one-provider", model, endpoint, apiKey, capabilities: ["inquiry"], qualityTiers: [], authorityScopes: ["urn:scope:bounded-inference-candidate"], effects: ["read-only"], idempotence: ["idempotent"], availableCapacity: 1, declaredResources: [], considerationKind: "credit", considerationAsset: "urn:test:credit", considerationUnit: "call", considerationAmount: { numerator: "1", denominator: "1" }, maximumOutputTokens: 64, endpointClass: "direct-openai-compatible-endpoint" });

test("the real observer binds same-provider direct results to exact public configurations", async () => {
  const root = mkdtempSync(join(tmpdir(), "model-routing-feedback-"));
  const server = createExpectedResolutionPricingServer({ dataRoot: root }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const pricingService = `http://127.0.0.1:${server.address().port}`;
    const alpha = descriptor("alpha", "http://127.0.0.1:11001/v1", "key-a"), beta = descriptor("beta", "http://127.0.0.1:11002/v1", "key-b");
    const calls = [];
    const options = { customerActor: CODEX_CUSTOMER, pricingService, directDescriptors: [alpha, beta], procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }), directTransport: async (call) => { calls.push(call); return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ answer: call.model }), model: call.model, durationMs: 7, invocations: [], exchanges: [{ finishReason: "stop", usage: { promptTokens: 2, outputTokens: 3 } }] }; } };
    const first = await dispatchInferenceAsConfiguredCustomer(input, options);
    assert.equal(["alpha", "beta"].includes(calls[0].model), true);
    assert.notEqual(directEndpointConfigurationIdentity(alpha), directEndpointConfigurationIdentity(beta));
    assert.equal(directEndpointConfigurationIdentity(alpha), directEndpointConfigurationIdentity({ ...alpha, apiKey: "key-rotated" }));
    const observation = await recordInferenceOutcome({ workLot: first.workLot, provider: first.provider, taskClass: first.taskClass, selectedOffer: first.selectedOffer, receipt: first.receipt.id, receiver: first.receiver, configurationIdentity: first.configurationIdentity, outcome: "refused", evidence: "urn:test:receiver-refusal" }, { pricingService });
    assert.equal(observation.observation.configurationIdentity, first.configurationIdentity);
    await assert.rejects(recordInferenceOutcome({ workLot: first.workLot, provider: first.provider, taskClass: first.taskClass, selectedOffer: first.selectedOffer, receipt: first.receipt.id, receiver: first.receiver, configurationIdentity: directEndpointConfigurationIdentity(beta), outcome: "accepted", evidence: "urn:test:contradiction" }, { pricingService }), /pricing service refused/u);
    const second = await dispatchInferenceAsConfiguredCustomer({ ...input, objective: "Return another bounded result." }, options);
    assert.equal(second.provider, "urn:ame:one-provider"); assert.equal(calls.every((call) => ["alpha", "beta"].includes(call.model)), true);
  } finally { server.close(); await once(server, "close"); rmSync(root, { recursive: true, force: true }); }
});

test("observer pages exact configuration evidence and preserves native delivery measurements", async () => {
  const root = mkdtempSync(join(tmpdir(), "model-routing-pages-"));
  const server = createExpectedResolutionPricingServer({ dataRoot: root }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const pricingService = `http://127.0.0.1:${server.address().port}`;
    const configuration = Object.freeze({ provider: "urn:ame:native", model: "claude-sonnet-5", machine: "bare-cedar-fog", executionClass: "native-claude-code", runtimeVersion: "test", contextIdentity: "urn:context:test" });
    const configurationIdentity = executionConfigurationIdentity(configuration);
    const offers = Array.from({ length: 32 }, (_, index) => ({ offerId: `urn:offer:${index}`, configurationIdentity }));
    for (let index = 0; index < 96; index += 1) {
      const selectedOffer = offers[index % offers.length].offerId;
      const delivery = appendDelivery({ workLot: `urn:lot:${index}`, provider: configuration.provider, taskClass: "inquiry", selectedOffer, receipt: `urn:receipt:${index}`, receiver: CODEX_CUSTOMER, configuration, configurationIdentity, durationMs: index, resources: [{ resource: "requests", asset: configuration.provider, unit: "request", amount: { numerator: "1", denominator: "1" } }] }, { dataRoot: root });
      const outcome = appendObservation({ workLot: delivery.workLot, provider: delivery.provider, taskClass: delivery.taskClass, selectedOffer, receipt: delivery.receipt, receiver: delivery.receiver, outcome: "accepted", evidence: `urn:evidence:${index}` }, { dataRoot: root });
      assert.equal(outcome.durationMs, index); assert.deepEqual(outcome.resources, delivery.resources);
    }
    const rows = await loadInferencePlacementObservations(pricingService, "inquiry", offers);
    assert.equal(rows.length, 96); assert.equal(new Set(rows.map(({ receipt }) => receipt)).size, 96);
    const legacy = appendDelivery({ workLot: "urn:legacy", provider: configuration.provider, taskClass: "inquiry", selectedOffer: "urn:offer:legacy", receipt: "urn:receipt:legacy", receiver: CODEX_CUSTOMER }, { dataRoot: root });
    appendObservation({ workLot: legacy.workLot, provider: legacy.provider, taskClass: legacy.taskClass, selectedOffer: legacy.selectedOffer, receipt: legacy.receipt, receiver: legacy.receiver, outcome: "accepted", evidence: "urn:evidence:legacy" }, { dataRoot: root });
    const alternate = { ...configuration, model: "alternate" }; const alternateIdentity = executionConfigurationIdentity(alternate);
    const mismatched = appendDelivery({ workLot: "urn:mismatch-config", provider: configuration.provider, taskClass: "inquiry", selectedOffer: offers[0].offerId, receipt: "urn:receipt:mismatch-config", receiver: CODEX_CUSTOMER, configuration: alternate, configurationIdentity: alternateIdentity }, { dataRoot: root });
    appendObservation({ workLot: mismatched.workLot, provider: mismatched.provider, taskClass: mismatched.taskClass, selectedOffer: mismatched.selectedOffer, receipt: mismatched.receipt, receiver: mismatched.receiver, outcome: "accepted", evidence: "urn:evidence:mismatch-config" }, { dataRoot: root });
    assert.equal((await loadInferencePlacementObservations(pricingService, "inquiry", offers)).length, 96);
    assert.throws(() => appendDelivery({ workLot: "urn:bad", provider: configuration.provider, taskClass: "inquiry", selectedOffer: "urn:offer:bad", receipt: "urn:receipt:bad", receiver: CODEX_CUSTOMER, configuration: { ...configuration, apiKey: "secret" }, configurationIdentity }, { dataRoot: root }), /credential-free|not admitted/u);
    assert.throws(() => appendDelivery({ workLot: "urn:mismatch", provider: "urn:ame:other", taskClass: "inquiry", selectedOffer: "urn:offer:mismatch", receipt: "urn:receipt:mismatch", receiver: CODEX_CUSTOMER, configuration, configurationIdentity }, { dataRoot: root }), /must match/u);
  } finally { server.close(); await once(server, "close"); rmSync(root, { recursive: true, force: true }); }
});

test("rank client refuses hostile exact-offer replies while A2A offer nonce leaves configuration stable", async () => {
  const provider = "urn:ame:provider";
  const candidate = (id, model = "model") => ({ entry: { provider: { actor: provider }, offer: { id, object: { model, mode: "chat", capabilities: ["inquiry"], workTypes: ["inquiry"] } } }, consideration: { obligations: [{ kind: "credit", asset: "urn:test:credit", unit: "call", amount: { numerator: "1", denominator: "1" } }] } });
  const first = candidate("urn:offer:first"), second = candidate("urn:offer:second");
  assert.equal(executionConfigurationIdentity(a2aExecutionConfiguration({ provider, offer: first.entry.offer })), executionConfigurationIdentity(a2aExecutionConfiguration({ provider, offer: second.entry.offer })));
  const configurationIdentity = executionConfigurationIdentity(a2aExecutionConfiguration({ provider, offer: first.entry.offer }));
  const replies = [
    [],
    [{ provider, offerId: first.entry.offer.id, configurationIdentity }, { provider, offerId: first.entry.offer.id, configurationIdentity }],
    [{ provider, offerId: "urn:offer:unrequested", configurationIdentity }],
    [{ provider: "urn:ame:other", offerId: first.entry.offer.id, configurationIdentity }],
    [{ provider, offerId: first.entry.offer.id, configurationIdentity: "urn:wrong" }],
  ];
  const nativeFetch = globalThis.fetch;
  let ranked = replies[0];
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, result: { ranked } }) });
  try {
    for (const reply of replies) {
      ranked = reply;
      await assert.rejects(rankInferenceCandidates("http://pricing.invalid", "inquiry", [first]), /incomplete|unrequested|ambiguous|mismatched|duplicate/u);
    }
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, observations: [{ receipt: "urn:legacy", taskClass: "inquiry", outcome: "accepted" }], matchedCount: 1, nextCursor: null }) });
    await assert.rejects(loadInferencePlacementObservations("http://pricing.invalid", "inquiry", [{ offerId: first.entry.offer.id, configurationIdentity }]), /unrequested|duplicate|mismatched/u);
    await assert.rejects(loadInferencePlacementObservations("http://pricing.invalid", "inquiry", []), /one to 32/u);
    await assert.rejects(loadInferencePlacementObservations("http://pricing.invalid", "inquiry", Array.from({ length: 33 }, () => ({ offerId: "urn:offer", configurationIdentity }))), /one to 32/u);
  } finally { globalThis.fetch = nativeFetch; }
});
