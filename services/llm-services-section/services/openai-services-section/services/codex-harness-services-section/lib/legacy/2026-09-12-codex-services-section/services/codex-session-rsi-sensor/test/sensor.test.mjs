import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ACTOR, CONTEXT, inspectBoardBoundary, loadPolicy, measureSessionWindow, selectOpportunity } from "../src/sensor.mjs";
import { advanceSensor, memoryLedger } from "../src/service.mjs";

const board = { actor: "urn:ame:customer-board", packageRoot: "/customer/board", nodeId: "board", contract: "board/v3", submitOperation: "submit" };
const policy = { clockActor: "urn:ame:scheduled-activity-delivery-service", deliveryCapabilityId: "urn:cap:sensor", sessionRoot: "/unused", initialLookbackSeconds: 300, premiumModels: ["gpt-5.6-sol"], minimumSelfExecutionActs: 1, maximumMarketActRatio: 0.5, expectedTicks: 12, inquiryBudget: { amount: 13, unit: "relative-resolution-milliquanta-v1" }, requiredCapabilities: ["software-engineering", "json-schema-output"], board };
const pulse = { "@context": CONTEXT, id: "urn:pulse:0", type: "Create", actor: policy.clockActor, target: ACTOR, capability: policy.deliveryCapabilityId, object: { type: "CodexSessionRsiSensorPulse", pulseId: "urn:schedule:sensor#0" } };

test("the installed sensor policy names the board's currently advertised ingress contract", () => {
  assert.doesNotThrow(() => inspectBoardBoundary(loadPolicy().board));
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "codex-rsi-sensor-")), directory = join(root, "2026", "07", "21"); mkdirSync(directory, { recursive: true });
  const secret = "TRANSCRIPT-TEXT-MUST-NOT-EGRESS";
  const rows = [
    { timestamp: "2026-07-21T12:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol", userInstructions: secret } },
    { timestamp: "2026-07-21T12:00:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10, reasoning_output_tokens: 5 } } } },
    { timestamp: "2026-07-21T12:03:00.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "exec_command", input: `tools.exec_command({cmd:${JSON.stringify(secret)}})` } },
    { timestamp: "2026-07-21T12:04:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 200, output_tokens: 50, reasoning_output_tokens: 25 } } } },
  ];
  writeFileSync(join(directory, "rollout-test.jsonl"), `${rows.map(JSON.stringify).join("\n")}\n`);
  return { root, secret };
}

test("exact interval measurement exposes only structural counts and token deltas", () => {
  const { root, secret } = fixture();
  const measured = measureSessionWindow({ sessionRoot: root, fromExclusive: "2026-07-21T12:00:00.000Z", toInclusive: "2026-07-21T12:05:00.000Z", premiumModels: policy.premiumModels });
  assert.equal(measured.length, 1); assert.equal(measured[0].baseline, 320); assert.equal(measured[0].selfExecutionActs, 1);
  assert.equal(JSON.stringify(measured).includes(secret), false); assert.match(measured[0].sourceDigest, /^sha256:[0-9a-f]{64}$/u);
});

test("uses the pre-window counter and accumulates a reset inside the window", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-rsi-reset-")), directory = join(root, "2026", "07", "21"); mkdirSync(directory, { recursive: true });
  const rows = [
    { timestamp: "2026-07-21T12:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol" } },
    { timestamp: "2026-07-21T12:00:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 4 } } } },
    { timestamp: "2026-07-21T12:01:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 130, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 8 } } } },
    "{malformed",
    { timestamp: "2026-07-21T12:02:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 3, reasoning_output_tokens: 1 } } } },
  ];
  writeFileSync(join(directory, "rollout-reset.jsonl"), `${rows.map((row) => typeof row === "string" ? row : JSON.stringify(row)).join("\n")}\n`);
  const [measurement] = measureSessionWindow({ sessionRoot: root, fromExclusive: "2026-07-21T12:00:00.000Z", toInclusive: "2026-07-21T12:03:00.000Z", premiumModels: policy.premiumModels });
  assert.deepEqual(measurement.tokens, { uncachedInput: 35, output: 8, reasoning: 5 }); assert.equal(measurement.baseline, 48); assert.equal(measurement.malformedRows, 1);
});

test("tool names count market and self-execution acts without inspecting their arguments", () => {
  const { root, secret } = fixture();
  const file = join(root, "2026", "07", "21", "name-only.jsonl");
  const rows = [
    { timestamp: "2026-07-21T12:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol" } },
    { timestamp: "2026-07-21T12:00:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } } } },
    { timestamp: "2026-07-21T12:02:00.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: secret } },
    { timestamp: "2026-07-21T12:03:00.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "mcp__inference-work-lot-market__contract_inference_work", input: secret } },
    { timestamp: "2026-07-21T12:03:30.000Z", type: "event_msg", payload: { type: "thread_goal_updated", threadId: "urn:private-thread", goal: { objective: secret } } },
    { timestamp: "2026-07-21T12:04:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 10 } } } },
  ];
  writeFileSync(file, `${rows.map(JSON.stringify).join("\n")}\n`);
  const measured = measureSessionWindow({ sessionRoot: root, fromExclusive: "2026-07-21T12:00:00.000Z", toInclusive: "2026-07-21T12:05:00.000Z", premiumModels: policy.premiumModels });
  const nameOnly = measured.find((item) => item.counts.marketActs === 1);
  assert.equal(nameOnly.counts.shellActs, 1); assert.equal(nameOnly.selfExecutionActs, 1);
  assert.equal(nameOnly.counts.goalUpdates, 1);
  assert.equal(JSON.stringify(nameOnly).includes(secret), false);
});

test("hostile tool arguments are never coerced while measuring structural acts", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-rsi-sensor-")), directory = join(root, "2026", "07", "21"); mkdirSync(directory, { recursive: true });
  const rows = [
    { timestamp: "2026-07-21T12:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol" } },
    { timestamp: "2026-07-21T12:00:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } } } },
    { timestamp: "2026-07-21T12:02:00.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: "customer-private-tool-argument" } },
    { timestamp: "2026-07-21T12:04:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0 } } } },
  ];
  writeFileSync(join(directory, "hostile.jsonl"), `${rows.map(JSON.stringify).join("\n")}\n`);
  const stringify = JSON.stringify;
  JSON.stringify = (value, ...rest) => {
    if (value && typeof value === "object" && (Object.hasOwn(value, "input") || Object.hasOwn(value, "arguments"))) throw new Error("tool arguments must not be stringified");
    return stringify(value, ...rest);
  };
  try {
    const measured = measureSessionWindow({ sessionRoot: root, fromExclusive: "2026-07-21T12:00:00.000Z", toInclusive: "2026-07-21T12:05:00.000Z", premiumModels: policy.premiumModels });
    assert.equal(measured[0].counts.shellActs, 1);
  } finally { JSON.stringify = stringify; }
});

test("the sensor forms a discovery opportunity, never an implementation residue", () => {
  const measurement = { session: "sha256:session", interval: { fromExclusive: "2026-07-21T12:00:00.000Z", toInclusive: "2026-07-21T12:05:00.000Z" }, models: ["gpt-5.6-sol"], tokens: { uncachedInput: 280, output: 20, reasoning: 20 }, baseline: 320, counts: { patchActs: 1, shellActs: 0, marketActs: 0, toolActs: 1, completedTurns: 0, compactions: 0 }, selfExecutionActs: 1, malformedRows: 0, sourceDigest: `sha256:${"1".repeat(64)}` };
  const opportunity = selectOpportunity([measurement], policy, "2026-07-21T12:05:00.000Z");
  assert.equal(opportunity.type, "ImprovementOpportunityObservation"); assert.equal(opportunity.customer, board.actor);
  assert.equal(opportunity.resourceObservation.baselinePerTick.amount, 320); assert.equal(opportunity.context.structuralActs.toolActs, 1);
  assert.equal(opportunity.type === "ImprovementResidue", false);
});

test("a contracted pulse publishes through the board boundary and records a zero-inference tick", async () => {
  const measurement = { session: "sha256:session", interval: { fromExclusive: "2026-07-21T12:00:00.000Z", toInclusive: "2026-07-21T12:05:00.000Z" }, models: ["gpt-5.6-sol"], tokens: { uncachedInput: 280, output: 20, reasoning: 20 }, baseline: 320, counts: { patchActs: 1, shellActs: 0, marketActs: 0, toolActs: 1, completedTurns: 0, compactions: 0 }, selfExecutionActs: 1, malformedRows: 0, sourceDigest: `sha256:${"1".repeat(64)}` };
  const ledger = memoryLedger(), publications = [];
  const result = await advanceSensor(pulse, { policy, ledger, recordedAt: "2026-07-21T12:05:00.000Z", measure: () => [measurement], publish: async (_board, activity) => { publications.push(activity); return { id: "urn:receipt:board", type: "Accept" }; } });
  assert.equal(result.type, "Accept"); assert.equal(result.object.disposition, "published"); assert.equal(result.object.inferenceCalls, 0); assert.equal(result.object.customerTerritoryMutation, false);
  assert.equal(publications.length, 1); assert.equal(publications[0].actor, ACTOR); assert.equal(publications[0].object.type, "ImprovementOpportunityObservation");
  assert.equal(ledger.read()[0].transcriptDisclosed, false);
});

test("a foreign pulse reaches neither session measurement nor the customer board", async () => {
  let acts = 0;
  const result = await advanceSensor({ ...pulse, actor: "urn:foreign" }, { policy, ledger: memoryLedger(), measure: () => { acts += 1; }, publish: () => { acts += 1; } });
  assert.equal(result.type, "Reject"); assert.equal(acts, 0);
});
