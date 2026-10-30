import assert from "node:assert/strict";
import test from "node:test";
import { runHarnessEfficiencyAssay } from "../src/harness-efficiency.mjs";

test("the harness is cheaper and faster than raw carrier injection on representative workloads", { timeout: 30_000 }, () => {
  const result = runHarnessEfficiencyAssay();
  assert.equal(result.passed, true, JSON.stringify(result, null, 2));
  assert.ok(result.harness.injectedBytes < result.baseline.injectedBytes);
  assert.ok(result.harness.endToEndWallMs < result.baseline.endToEndWallMs);
  assert.equal(result.duplicateRecords, 0);
  assert.equal(result.statusObservations, 1);
});
