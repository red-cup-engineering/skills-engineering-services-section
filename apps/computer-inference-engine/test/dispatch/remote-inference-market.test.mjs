import assert from "node:assert/strict";
import test from "node:test";
import { remoteInferenceMarket, DISPATCH_TOOL, OUTCOME_TOOL } from "../../src/dispatch/remote-inference-market.mjs";

test("fabrication uses native placement terms and returns the same lot for receiving", async () => {
  const calls = [];
  const delivered = { workLot: "urn:work:fixture", provider: "urn:provider:subscription",
    selectedOffer: "urn:offer:fixture", receipt: { id: "urn:receipt:fixture" },
    receiver: "urn:receiver:fixture", model: "fixture-model", configurationIdentity: "urn:configuration:fixture",
    measuredResources: { scope: "fixture-exchange", resources: [{ resource: "output-tokens", unit: "token", amount: { numerator: "12", denominator: "1" } }] },
    consideration: [{ kind: "fixture-declared-consideration", amount: "3", unit: "USD" }],
    settlement: "fixture-not-settled",
    candidate: { choices: [{ message: { content: "export const result = 1;" } }] } };
  const market = remoteInferenceMarket({ call: async (call) => {
    calls.push(call);
    return call.tool === DISPATCH_TOOL ? delivered : { recorded: true };
  } });
  const workPlacement = { resourceCeilings: [{ resource: "output-tokens", unit: "token", amount: { numerator: "512", denominator: "1" } }] };
  const considerationPolicy = { type: "ConsiderationPolicy", acceptableAlternatives: [] };
  const agentBounds = { maximumRequests: 1, maximumOutputTokens: 512 };
  const schema = { type: "object", properties: { source: { type: "string" } }, required: ["source"], additionalProperties: false };
  const result = await market.chat({ taskClass: "bounded-code", objective: "Fixture source proposal",
    messages: [{ role: "user", content: "Produce the fixture module." }],
    requiredCapabilities: ["code"], requiredQualityTiers: ["qualified-fixture"],
    workPlacement, considerationPolicy, agentBounds, schema, reasoning_effort: "medium", reasoning_budget: 128, chat_template_kwargs: { force_nonempty_content: true } });
  assert.equal(Object.hasOwn(calls[0].input, "zeroCashOnly"), false);
  assert.equal(Object.hasOwn(calls[0].input, "timeoutMs"), false);
  assert.equal(Object.hasOwn(calls[0].input.chatCompletion, "response_format"), false);
  assert.equal(calls[0].input.chatCompletion.messages.at(-1).content, "Return precisely one JSON document satisfying this data contract, without prose or fences: " + JSON.stringify(schema));
  assert.deepEqual(calls[0].input.workPlacement, workPlacement);
  assert.deepEqual(calls[0].input.considerationPolicy, considerationPolicy);
  assert.deepEqual(calls[0].input.agentBounds, agentBounds);
  assert.equal(calls[0].input.chatCompletion.reasoning_effort, "medium");
  assert.equal(calls[0].input.chatCompletion.reasoning_budget, 128);
  assert.deepEqual(calls[0].input.chatCompletion.chat_template_kwargs, { force_nonempty_content: true });
  assert.deepEqual(calls[0].input.requiredQualityTiers, ["qualified-fixture"]);
  assert.equal(result.text, delivered.candidate.choices[0].message.content);
  assert.deepEqual(result.lot.delivery, delivered, "fabrication retains native measurements and their scope, not an estimated cost");
  assert.equal(calls.length, 1, "a delivered candidate is not automatically received");
  await market.judge(result.lot, "refused", "fixture:independent-consumer-obstruction");
  assert.equal(calls[1].tool, OUTCOME_TOOL);
  for (const key of ["workLot", "provider", "selectedOffer", "receiver"]) assert.equal(calls[1].input[key], delivered[key]);
  assert.equal(calls[1].input.receipt, delivered.receipt.id);
  assert.equal(calls[1].input.configurationIdentity, delivered.configurationIdentity);
  assert.equal(Object.hasOwn(calls[1].input, "delivery"), false, "provenance does not extend the judgment command");
});

test("explicit eligibility restrictions remain explicit and a native refusal is never silently retried", async () => {
  let calls = 0;
  const market = remoteInferenceMarket({ call: async ({ input }) => {
    calls++;
    assert.deepEqual(input.requiredQualityTiers, ["qualified-fixture"]);
    return { outcome: "refused" };
  } });
  await assert.rejects(market.chat({ taskClass: "fixture", objective: "fixture", requiredQualityTiers: ["qualified-fixture"], messages: [{ role: "user", content: "fixture" }] }), (error) => {
    assert.match(error.message, /delivered no text/);
    assert.deepEqual(error.cause, { outcome: "refused" });
    return true;
  });
  assert.equal(calls, 1);
});
