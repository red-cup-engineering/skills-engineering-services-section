import assert from "node:assert/strict";
import test from "node:test";
import {
  INFERENCE_WORK_OPERATION,
  admitInferenceWorkOutput,
  admitInferenceWorkRefusal,
  admitInferenceWorkRequest,
  admitInferenceWorkResult,
} from "../src/inference-work-carriers.mjs";
import { decodeJsonValue, identifyJsonValue } from "../src/modern-rmn-carrier.mjs";

test("the modern RMN carrier losslessly preserves ordinary JSON leaves", () => {
  const value = { accepted: false, chargeLookingText: "denied", list: [true, "held", null, 7] };
  const identified = identifyJsonValue(value);
  const decoded = decodeJsonValue(identified.bytes);
  assert.deepEqual(decoded.value, value);
  assert.equal(decoded.token, identified.token);
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

test("operation metadata references Relating without duplicating it", () => {
  assert.deepEqual(INFERENCE_WORK_OPERATION.relating, { compatibleVersions: ["0.0.1", "0.0.2"], duplicated: false });
  assert.equal(INFERENCE_WORK_OPERATION.domain.schema, "urn:red-cup-engineering:schema:inference-work-request:1");
  assert.deepEqual(INFERENCE_WORK_OPERATION.codomain.oneOf.map(({ schema }) => schema), [
    "urn:red-cup-engineering:schema:inference-work-result:1",
    "urn:red-cup-engineering:schema:inference-work-refusal:1",
  ]);
});
