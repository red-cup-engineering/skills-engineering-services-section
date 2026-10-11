import assert from "node:assert/strict";
import test from "node:test";
import { compileJsonSchema } from "@red-cup-engineering/json-schema-services-section/validation";
import { executeOperation } from "@red-cup-engineering/computer-code-engineering-services-section/typed-operation";
import {
  INFERENCE_WORK_OPERATION,
  admitInferenceWorkOutput,
  admitInferenceWorkRefusal,
  admitInferenceWorkRequest,
  admitInferenceWorkResult,
} from "../../src/dispatch/inference-work-carriers.mjs";
import { decodeJsonValue, identifyJsonValue } from "../../src/dispatch/sen-carrier.mjs";
import { DISPATCH_INFERENCE_INPUT_SCHEMA } from "../../src/dispatch/inference-dispatch-mcp-contract.mjs";

test("the modern SEN carrier losslessly preserves ordinary JSON leaves", () => {
  const value = { accepted: false, chargeLookingText: "denied", list: [true, "held", null, 7] };
  const identified = identifyJsonValue(value);
  const decoded = decodeJsonValue(identified.bytes);
  assert.deepEqual(decoded.value, value);
  assert.equal(decoded.token, identified.token);
});

test("the modern SEN carrier identifies the exact non-JSON boundary", () => {
  assert.throws(
    () => identifyJsonValue({ contract: { obligations: [{ amount: undefined }] } }),
    /invalid value at \$\.contract\.obligations\[0\]\.amount/u,
  );
});

test("request, result, and refusal are explicit Draft 2020-12 carrier gates", () => {
  const request = { objective: "derive one bounded result", difficulty: 0.5 };
  assert.equal(admitInferenceWorkRequest(request), request);
  assert.deepEqual(admitInferenceWorkResult({ outcome: "candidate-pending-customer-acceptance", integrationAccepted: false }), { outcome: "candidate-pending-customer-acceptance", integrationAccepted: false });
  const refusal = { outcome: "market-residue", disposition: "no-admissible-offer", integrationAccepted: false };
  assert.equal(admitInferenceWorkOutput(refusal), refusal);
  assert.equal(admitInferenceWorkRefusal(refusal), refusal);
  assert.throws(() => admitInferenceWorkRequest({ objective: "x", maxTokens: 128 }), /schema validation/u);
  assert.throws(() => admitInferenceWorkOutput({ outcome: "market-residue", integrationAccepted: true }), /result and refusal/u);
});

test("the result schema admits the additive expectedResolutionPrice field beside the declared consideration", () => {
  const result = {
    outcome: "candidate-pending-customer-acceptance",
    integrationAccepted: false,
    consideration: { obligations: [{ id: "test-credit", amount: { numerator: "7", denominator: "1" } }] },
    expectedResolutionPrice: { provider: "urn:ame:test-provider", expectedPrice: { numerator: "9", denominator: "1" }, basis: { successfulResolutions: 3, terminalResolutions: 4 } },
  };
  assert.equal(admitInferenceWorkResult(result), result);
});

test("the concrete operation admits requests and outputs before and after the authorized provider effect", async () => {
  let calls = 0;
  const output = { outcome: "candidate-pending-customer-acceptance", integrationAccepted: false };
  const options = { allowedEffects: INFERENCE_WORK_OPERATION.effects, resolveHost: () => () => { calls++; return output; } };
  for (const input of [{ objective: "   " }, { objective: "x", outputProjection: { type: "unknown" } },
    { objective: "x", chatCompletion: { messages: [{ role: "user", content: "x" }] }, outputSchema: {} }]) {
    assert.equal((await executeOperation(INFERENCE_WORK_OPERATION, input, options)).refusal.code, "InvalidInput");
  }
  assert.equal((await executeOperation(INFERENCE_WORK_OPERATION, { objective: "x" }, { ...options, allowedEffects: [] })).refusal.code, "EffectRefused");
  assert.equal(calls, 0);
  const result = await executeOperation(INFERENCE_WORK_OPERATION, { objective: "x" }, options);
  assert.equal(result.value, output);
  assert.equal(calls, 1);
  const malformed = await executeOperation(INFERENCE_WORK_OPERATION, { objective: "x" }, { ...options, resolveHost: () => () => ({ outcome: "invented" }) });
  assert.equal(malformed.refusal.code, "InvalidOutput");
});

test("market and MCP admit the same shared chat turn schema without provider overrides", () => {
  const request = { objective: "continue the caller's tool loop", chatCompletion: {
    messages: [{ role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call-1", content: "observed" }],
    tools: [{ type: "function", function: { name: "read", parameters: { type: "object", additionalProperties: false } } }],
    response_format: { type: "json_schema", json_schema: { name: "answer", schema: { type: "object", additionalProperties: false } } },
  } };
  assert.equal(admitInferenceWorkRequest(request), request);
  const mcpSchema = compileJsonSchema(DISPATCH_INFERENCE_INPUT_SCHEMA);
  assert.equal(mcpSchema.validate(request).valid, true);
  for (const extra of [{ model: "caller-selected" }, { max_tokens: 999 }, { endpoint: "https://elsewhere.invalid" },
    { response_format: { type: "json_schema" } }]) {
    const invalid = { ...request, chatCompletion: { ...request.chatCompletion, ...extra } };
    assert.throws(() => admitInferenceWorkRequest(invalid), /schema validation/u);
    assert.equal(mcpSchema.validate(invalid).valid, false);
  }
});

test("market and MCP admit one nonempty implementation affinity and reject malformed bindings", () => {
  const request = {
    objective: "continue an exact provider-bound tool turn",
    workPlacement: { requiredImplementationIdentity: "ni:///sha-256;exact-configuration" },
  };
  assert.equal(admitInferenceWorkRequest(request), request);
  const mcpSchema = compileJsonSchema(DISPATCH_INFERENCE_INPUT_SCHEMA);
  assert.equal(mcpSchema.validate(request).valid, true);
  for (const requiredImplementationIdentity of ["", 1]) {
    assert.throws(() => admitInferenceWorkRequest({
      objective: "refuse malformed affinity",
      workPlacement: { requiredImplementationIdentity },
    }));
    assert.equal(mcpSchema.validate({
      objective: "refuse malformed affinity",
      workPlacement: { requiredImplementationIdentity },
    }).valid, false);
  }
});


test("MCP preserves the complete conditional contract and refuses undeclared fields", () => {
  const schema = compileJsonSchema(DISPATCH_INFERENCE_INPUT_SCHEMA);
  const turn = { objective: "one turn", chatCompletion: { messages: [{ role: "user", content: "hello" }] } };
  assert.equal(schema.validate(turn).valid, true);
  for (const extra of [{ context: "source fact hidden from the provider" }, { contextPacket: {} },
    { outputSchema: {} }, { outputProjection: { type: "fenced-json-tool-call" } }, { enforceProviderSchema: true }, { maxTokens: 128 }]) {
    assert.equal(schema.validate({ ...turn, ...extra }).valid, false);
    assert.throws(() => admitInferenceWorkRequest({ ...turn, ...extra }), /schema validation/u);
  }
});
