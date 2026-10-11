import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CODEX_CUSTOMER, dispatchInferenceAsConfiguredCustomer, recordInferenceOutcome } from "../../src/dispatch/inference-dispatch.mjs";
import { directEndpointConfigurationIdentity } from "../../src/dispatch/direct-endpoint-provider.mjs";
import { appendDelivery, appendObservation, appendInferenceRefusal, loadDeliveries, loadObservations } from "../../src/dispatch/expected-resolution-pricing.mjs";
import { loadInferencePlacementObservations, rankInferenceCandidates } from "../../src/dispatch/expected-resolution-pricing-client.mjs";
import { a2aExecutionConfiguration, executionConfigurationIdentity } from "../../src/dispatch/sen-carrier.mjs";
import { DIRECT_WITNESS_SETTLEMENT_CAPABILITY, RESOLUTION_CREDIT_ASSET, RESOLUTION_CREDIT_UNIT } from "../../src/dispatch/consideration.mjs";

const policy = { type: "ConsiderationPolicy", acceptableAlternatives: [{ id: "test", obligations: [{ kind: "credit", asset: RESOLUTION_CREDIT_ASSET, unit: RESOLUTION_CREDIT_UNIT, settlementCapabilities: [DIRECT_WITNESS_SETTLEMENT_CAPABILITY] }] }] };
const input = { objective: "Return one bounded result.", context: "bounded test context", workType: "inquiry", considerationPolicy: policy, outputSchema: { type: "object", required: ["answer"], properties: { answer: { type: "string" } }, additionalProperties: false } };
const descriptor = (model, endpoint, apiKey) => ({ provider: "urn:ame:one-provider", model, endpoint, apiKey, capabilities: ["chat", "inquiry"], qualityTiers: [], authorityScopes: ["urn:scope:bounded-inference-candidate"], effects: ["read-only"], idempotence: ["idempotent"], availableCapacity: 1, declaredResources: [], considerationKind: "credit", considerationAsset: "urn:test:credit", considerationUnit: "call", considerationAmount: { numerator: "1", denominator: "1" }, maximumOutputTokens: 64, endpointClass: "direct-openai-compatible-endpoint" });

test("the real observer binds same-provider direct results to exact public configurations", async () => {
  const root = mkdtempSync(join(tmpdir(), "model-routing-feedback-"));
  try {
    const pricingRoot = root;
    const alpha = descriptor("alpha", "http://127.0.0.1:11001/v1", "key-a"), beta = descriptor("beta", "http://127.0.0.1:11002/v1", "key-b");
    const calls = [];
    const options = { customerActor: CODEX_CUSTOMER, pricingRoot, directDescriptors: [alpha, beta], procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }), directTransport: async (call) => { calls.push(call); return { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ answer: call.model }), model: call.model, durationMs: 7, invocations: [], exchanges: [{ finishReason: "stop", usage: { promptTokens: 2, outputTokens: 3 } }] }; } };
    const first = await dispatchInferenceAsConfiguredCustomer(input, options);
    assert.equal(["alpha", "beta"].includes(calls[0].model), true);
    assert.notEqual(directEndpointConfigurationIdentity(alpha), directEndpointConfigurationIdentity(beta));
    assert.equal(directEndpointConfigurationIdentity(alpha), directEndpointConfigurationIdentity({ ...alpha, apiKey: "key-rotated" }));
    const observation = await recordInferenceOutcome({ workLot: first.workLot, provider: first.provider, taskClass: first.taskClass, selectedOffer: first.selectedOffer, receipt: first.receipt.id, receiver: first.receiver, configurationIdentity: first.configurationIdentity, outcome: "refused", evidence: "urn:test:receiver-refusal" }, { pricingRoot });
    assert.equal(observation.observation.configurationIdentity, first.configurationIdentity);
    await assert.rejects(recordInferenceOutcome({ workLot: first.workLot, provider: first.provider, taskClass: first.taskClass, selectedOffer: first.selectedOffer, receipt: first.receipt.id, receiver: first.receiver, configurationIdentity: directEndpointConfigurationIdentity(beta), outcome: "accepted", evidence: "urn:test:contradiction" }, { pricingRoot }), /cannot change the registered delivery configuration/u);
    const second = await dispatchInferenceAsConfiguredCustomer({ ...input, objective: "Return another bounded result." }, options);
    assert.equal(second.provider, "urn:ame:one-provider"); assert.equal(calls.every((call) => ["alpha", "beta"].includes(call.model)), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("observer pages exact configuration evidence and preserves native delivery measurements", async () => {
  const root = mkdtempSync(join(tmpdir(), "model-routing-pages-"));
  try {
    const pricingRoot = root;
    const configuration = Object.freeze({ provider: "urn:ame:native", model: "claude-sonnet-5", machine: "bare-cedar-fog", executionClass: "native-claude-code", runtimeVersion: "test", contextIdentity: "urn:context:test" });
    const configurationIdentity = executionConfigurationIdentity(configuration);
    const offers = Array.from({ length: 32 }, (_, index) => ({ offerId: `urn:offer:${index}`, configurationIdentity, configuration }));
    for (let index = 0; index < 96; index += 1) {
      const selectedOffer = offers[index % offers.length].offerId;
      const delivery = appendDelivery({ workLot: `urn:lot:${index}`, provider: configuration.provider, taskClass: "inquiry", selectedOffer, receipt: `urn:receipt:${index}`, receiver: CODEX_CUSTOMER, configuration, configurationIdentity, durationMs: index, resources: [{ resource: "requests", asset: configuration.provider, unit: "request", amount: { numerator: "1", denominator: "1" } }] }, { dataRoot: root });
      const outcome = appendObservation({ workLot: delivery.workLot, provider: delivery.provider, taskClass: delivery.taskClass, selectedOffer, receipt: delivery.receipt, receiver: delivery.receiver, outcome: "accepted", evidence: `urn:evidence:${index}` }, { dataRoot: root });
      assert.equal(outcome.durationMs, index); assert.deepEqual(outcome.resources, delivery.resources);
    }
    const rows = await loadInferencePlacementObservations(pricingRoot, "inquiry", offers, CODEX_CUSTOMER);
    assert.equal(rows.length, 96); assert.equal(new Set(rows.map(({ receipt }) => receipt)).size, 96);
    const legacy = appendDelivery({ workLot: "urn:legacy", provider: configuration.provider, taskClass: "inquiry", selectedOffer: "urn:offer:legacy", receipt: "urn:receipt:legacy", receiver: CODEX_CUSTOMER }, { dataRoot: root });
    appendObservation({ workLot: legacy.workLot, provider: legacy.provider, taskClass: legacy.taskClass, selectedOffer: legacy.selectedOffer, receipt: legacy.receipt, receiver: legacy.receiver, outcome: "accepted", evidence: "urn:evidence:legacy" }, { dataRoot: root });
    const alternate = { ...configuration, model: "alternate" }; const alternateIdentity = executionConfigurationIdentity(alternate);
    const mismatched = appendDelivery({ workLot: "urn:mismatch-config", provider: configuration.provider, taskClass: "inquiry", selectedOffer: offers[0].offerId, receipt: "urn:receipt:mismatch-config", receiver: CODEX_CUSTOMER, configuration: alternate, configurationIdentity: alternateIdentity }, { dataRoot: root });
    appendObservation({ workLot: mismatched.workLot, provider: mismatched.provider, taskClass: mismatched.taskClass, selectedOffer: mismatched.selectedOffer, receipt: mismatched.receipt, receiver: mismatched.receiver, outcome: "accepted", evidence: "urn:evidence:mismatch-config" }, { dataRoot: root });
    assert.equal((await loadInferencePlacementObservations(pricingRoot, "inquiry", offers, CODEX_CUSTOMER)).length, 96);
    assert.throws(() => appendDelivery({ workLot: "urn:bad", provider: configuration.provider, taskClass: "inquiry", selectedOffer: "urn:offer:bad", receipt: "urn:receipt:bad", receiver: CODEX_CUSTOMER, configuration: { ...configuration, apiKey: "secret" }, configurationIdentity }, { dataRoot: root }), /credential-free|not admitted/u);
    assert.throws(() => appendDelivery({ workLot: "urn:mismatch", provider: "urn:ame:other", taskClass: "inquiry", selectedOffer: "urn:offer:mismatch", receipt: "urn:receipt:mismatch", receiver: CODEX_CUSTOMER, configuration, configurationIdentity }, { dataRoot: root }), /must match/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("placement reads refuse requests that name no offers or more than 32", async () => {
  const configurationIdentity = "urn:configuration";
  await assert.rejects(loadInferencePlacementObservations(tmpdir(), "inquiry", []), /one to 32/u);
  await assert.rejects(loadInferencePlacementObservations(tmpdir(), "inquiry", Array.from({ length: 33 }, (_, index) => ({ offerId: `urn:offer:${index}`, configurationIdentity }))), /one to 32/u);
});

test("completed protocol refusal changes the next exact provider choice without inventing delivery", async () => {
  const root = mkdtempSync(join(tmpdir(), "protocol-refusal-routing-"));
  try {
    const alpha = descriptor("alpha", "http://127.0.0.1:11001/v1", "key-a");
    const beta = descriptor("beta", "http://127.0.0.1:11002/v1", "key-b");
    const calls = [];
    const options = { customerActor: CODEX_CUSTOMER, pricingRoot: root, directDescriptors: [alpha],
      procure: async () => ({ disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } }),
      directTransport: async call => {
        calls.push(call.model);
        return call.model === "alpha"
          ? { type: "ReceiverOwnedToolAgentResidue", disposition: "provider-exchange-failed", model: call.model,
            cause: { kind: "protocol", reason: "tool-input-schema-refusal" }, durationMs: 7, invocations: [],
            exchanges: [{ finishReason: "tool_calls", usage: { promptTokens: 3, outputTokens: 2, totalTokens: null } }] }
          : { type: "ReceiverOwnedToolAgentCompletion", text: JSON.stringify({ answer: "beta" }), model: call.model,
            durationMs: 7, invocations: [], exchanges: [{ finishReason: "stop", usage: { promptTokens: 3, outputTokens: 2 } }] };
      } };
    const refused = await dispatchInferenceAsConfiguredCustomer(input, options);
    assert.equal(refused.outcome, "market-residue");
    assert.deepEqual(loadDeliveries({ dataRoot: root }), []);
    const observation = loadObservations({ dataRoot: root }).find(row => row.kind === "receiver-attempt-refusal");
    assert.equal(observation.receiver, CODEX_CUSTOMER);
    assert.equal(observation.cause.reason, "tool-input-schema-refusal");
    assert.equal(observation.resources.find(row => row.resource === "input-tokens").amount.numerator, "3");
    assert.equal(observation.resources.some(row => row.resource === "total-tokens"), false);
    assert.equal(appendInferenceRefusal(observation, { dataRoot: root }).id, observation.id);
    await dispatchInferenceAsConfiguredCustomer(input, options);
    const distinctFailures = loadObservations({ dataRoot: root }).filter(row => row.kind === "receiver-attempt-refusal");
    assert.equal(distinctFailures.length, 2);
    assert.notEqual(distinctFailures[0].receiverAttempt, distinctFailures[1].receiverAttempt);
    const offer = { offerId: observation.selectedOffer, configurationIdentity: observation.configurationIdentity,
      configuration: observation.configuration };
    const projected = await loadInferencePlacementObservations(root, observation.taskClass, [offer], CODEX_CUSTOMER);
    assert.equal(projected.length, 2);
    assert.equal(projected[0].outcome, "refused");
    assert.equal(projected[0].latency.amount.numerator, "7");
    assert.deepEqual(await loadInferencePlacementObservations(root, observation.taskClass, [offer], "urn:another-receiver"), []);
    assert.deepEqual(await loadInferencePlacementObservations(root, "another-task", [offer], CODEX_CUSTOMER), []);
    const next = await dispatchInferenceAsConfiguredCustomer({ ...input, objective: "Return another bounded result." },
      { ...options, directDescriptors: [alpha, beta] });
    assert.deepEqual(calls, ["alpha", "alpha", "beta"]);
    assert.equal(next.model, "beta");
    assert.equal(loadDeliveries({ dataRoot: root }).length, 1);
    const transportRoot = join(root, "transport");
    await dispatchInferenceAsConfiguredCustomer(input, { ...options, pricingRoot: transportRoot,
      directTransport: async () => ({ type: "ReceiverOwnedToolAgentResidue", disposition: "provider-exchange-failed",
        cause: { kind: "transport", reason: "request-failed" }, durationMs: 7, invocations: [], exchanges: [] }) });
    assert.deepEqual(loadObservations({ dataRoot: transportRoot }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
