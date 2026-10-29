import assert from "node:assert/strict";
import test from "node:test";
import { classifyMechanicalSubtask, MECHANICAL_TASK_TYPES } from "../src/mechanical-subtask-classification.mjs";

test("admits every taskType in MECHANICAL_TASK_TYPES with plain instructions", () => {
  for (const taskType of MECHANICAL_TASK_TYPES) {
    assert.deepEqual(classifyMechanicalSubtask({ taskType, instructions: "Extract the named entities from the text." }), { admitted: true });
  }
});

test("refuses a taskType outside the allowlist", () => {
  const result = classifyMechanicalSubtask({ taskType: "software-engineering", instructions: "Fix the bug." });
  assert.equal(result.admitted, false);
  assert.match(result.reason, /taskType must be one of/u);
});

test("refuses a missing or non-string taskType", () => {
  assert.equal(classifyMechanicalSubtask({ instructions: "x" }).admitted, false);
  assert.equal(classifyMechanicalSubtask({ taskType: 5, instructions: "x" }).admitted, false);
});

test("refuses empty or missing instructions", () => {
  assert.equal(classifyMechanicalSubtask({ taskType: "extraction", instructions: "" }).admitted, false);
  assert.equal(classifyMechanicalSubtask({ taskType: "extraction" }).admitted, false);
});

test("refuses instructions carrying a judgment-smell term", () => {
  const result = classifyMechanicalSubtask({ taskType: "summarization", instructions: "Recommend which architecture we should decide on." });
  assert.equal(result.admitted, false);
  assert.match(result.reason, /judgment-smell term/u);
});

test("rejects a non-object input", () => {
  assert.equal(classifyMechanicalSubtask(null).admitted, false);
  assert.equal(classifyMechanicalSubtask("classification").admitted, false);
});
