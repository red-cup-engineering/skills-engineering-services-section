import assert from "node:assert/strict";
import test from "node:test";
import { applyInferenceCashControl, resolveInferenceCashControl, ZERO_CASH_INFERENCE_CONTROL } from "../../src/dispatch/inference-cash-control.mjs";
import { dispatchInference } from "../../src/dispatch/inference-dispatch.mjs";
import { configuredInferenceCashControl } from "../../src/dispatch/inference-dispatch-mcp-contract.mjs";

test("the shared node control defaults to a zero-cash, no-overage contract", () => {
  assert.equal(resolveInferenceCashControl({}), ZERO_CASH_INFERENCE_CONTROL);
  assert.equal(resolveInferenceCashControl({ INFERENCE_CASH_CONTROL: "zero-cash-only" }), ZERO_CASH_INFERENCE_CONTROL);
  assert.equal(configuredInferenceCashControl({}), undefined);
  assert.equal(configuredInferenceCashControl({ INFERENCE_CASH_CONTROL: "zero-cash-only" }), ZERO_CASH_INFERENCE_CONTROL);
  assert.deepEqual(applyInferenceCashControl({ objective: "fixture" }), { objective: "fixture", zeroCashOnly: true });
});

test("a caller cannot relax the node's cash boundary", async () => {
  assert.throws(() => applyInferenceCashControl({ objective: "fixture", zeroCashOnly: false }), /caller opt-out/u);
  await assert.rejects(
    () => dispatchInference({ objective: "fixture", zeroCashOnly: false }, { cashControl: ZERO_CASH_INFERENCE_CONTROL }),
    /cash-controlled inference refuses a caller opt-out/u,
  );
  assert.throws(
    () => resolveInferenceCashControl({ INFERENCE_CASH_CONTROL: "paid" }),
    /exact quoted price/u,
  );
});
