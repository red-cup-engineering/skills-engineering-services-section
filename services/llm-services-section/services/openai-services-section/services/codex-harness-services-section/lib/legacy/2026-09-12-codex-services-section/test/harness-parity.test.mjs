import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assertHarnessParityClosable, evaluateHarnessParity, loadHarnessParityBaseline } from "../src/harness-parity.mjs";

test("the parity baseline binds every preserved attempt and every capability to a distinct economic actuator", () => {
  const baseline = loadHarnessParityBaseline();
  const position = evaluateHarnessParity(baseline);
  assert.equal(position.capabilityCount, baseline.capabilities.length);
  assert.equal(position.sourceSetCount, baseline.sourceSets.length);
  assert.deepEqual(position.duplicateCapabilities, []);
  assert.deepEqual(position.duplicateActors, []);
  assert.deepEqual(position.invalidActuators, []);
  assert.deepEqual(position.invalidRules, []);
  assert.deepEqual(position.sourceDrift, []);
  assert.deepEqual(position.uncoveredSources, []);
  for (const capability of baseline.capabilities) {
    assert.ok(capability.contract);
    assert.ok(capability.parityAssay);
    assert.ok(capability.currentSources.length > 0);
    assert.equal(capability.actuator.actor.startsWith("urn:ame:"), true);
    assert.equal(capability.actuator.offer.startsWith("urn:offer:"), true);
    for (const source of capability.currentSources) assert.equal(existsSync(join(new URL("..", import.meta.url).pathname, source)), true, `${capability.id}: ${source}`);
  }
  assert.equal(baseline.actuatorDefaults.consideration.unknownIsZero, false);
  assert.equal(baseline.deprecationPolicy.removalRequiresExplicitLeaderAct, true);
});

test("the parity demand stays mechanically open until every actuator has receipts, observed completion, and Morgan's outcome", () => {
  const baseline = loadHarnessParityBaseline();
  const position = evaluateHarnessParity(baseline);
  assert.equal(position.disposition, "demand-open");
  assert.equal(position.unclosableCapabilities.length, baseline.capabilities.length);
  assert.deepEqual(position.deprecationEligibleSourceSets, []);
  assert.equal(position.sourceSetDeprecation.length, baseline.sourceSets.length);
  assert.ok(position.sourceSetDeprecation.every(({ disposition, removalAuthorized }) => disposition === "preserve-source-evidence" && removalAuthorized === false));
  assert.ok(position.sourceSetDeprecation.every(({ blockingCapabilities }) => blockingCapabilities.length > 0));
  assert.throws(() => assertHarnessParityClosable(baseline), /not closable/u);
});

test("each exact backup tree earns only eligibility after all mapped capability receipts and Morgan outcomes exist", () => {
  const baseline = structuredClone(loadHarnessParityBaseline());
  for (const capability of baseline.capabilities) {
    capability.actuator.implementationState = "receiver-accepted";
    capability.evidence = {
      providerReceipt: `urn:receipt:${capability.id}`,
      exactCandidateDigest: `urn:candidate:${capability.id}`,
      completionObservationReceipt: `urn:completion:${capability.id}`,
      customerOutcomeReceipt: `urn:outcome:${capability.id}`,
    };
  }
  const position = evaluateHarnessParity(baseline);
  assert.deepEqual(position.deprecationEligibleSourceSets, baseline.sourceSets.map(({ root }) => root));
  assert.ok(position.sourceSetDeprecation.every(({ disposition, removalAuthorized }) => disposition === "eligible-for-leader-authorized-deprecation" && removalAuthorized === false));
  delete baseline.capabilities[0].evidence.customerOutcomeReceipt;
  const withheld = evaluateHarnessParity(baseline);
  assert.ok(withheld.sourceSetDeprecation.filter(({ mappedCapabilities }) => mappedCapabilities.includes(baseline.capabilities[0].id)).every(({ eligible }) => eligible === false));
});

test("the parity monitor is callable through the real Codex enterprise MCP face", () => {
  const server = new URL("../src/mcp-server.mjs", import.meta.url);
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "observe_codex_harness_parity", arguments: {} } }
  ];
  const run = spawnSync(process.execPath, [server.pathname], { input: `${requests.map(JSON.stringify).join("\n")}\n`, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const replies = run.stdout.trim().split("\n").map(JSON.parse);
  assert.ok(replies[0].result.tools.some(({ name }) => name === "observe_codex_harness_parity"));
  assert.equal(replies[1].result.structuredContent.type, "CodexHarnessParityPosition");
  assert.equal(replies[1].result.structuredContent.disposition, "demand-open");
});
