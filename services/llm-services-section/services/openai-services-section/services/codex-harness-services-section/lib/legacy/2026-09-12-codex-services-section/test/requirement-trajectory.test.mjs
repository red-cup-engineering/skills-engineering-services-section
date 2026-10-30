import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { integrateRequirementBoundActuationPlan, providerPlanCandidate, requirementSet } from "../src/requirement-trajectory.mjs";

const ACTOR = "urn:ame:bare-cedar-fog-codex";
const MARKET = "urn:ame:inference-work-lot-service";
const CLAUDE = "urn:ame:claude-code-inference-team";
const stages = ["software-architecture-specification", "high-level-design", "low-level-design", "bounded-work-lots"];

function fixture() {
  const requirements = requirementSet([
    { desiredOutcome: "preserve prior harness behavior", completionConditions: ["exact digest remains bound", "fresh consumer assay passes"] },
    { desiredOutcome: "retain network economics", completionConditions: ["offer and receipt remain distinct", "unknown cost is not zero"] },
  ]);
  const bindings = requirements.requirements.map(({ id, completionConditions }) => ({ requirement: id, completionConditions }));
  const candidates = [];
  let predecessor = "urn:evidence:requirements-assayed";
  for (const [index, stage] of stages.entries()) {
    const candidate = providerPlanCandidate({
      stage, provider: index < 2 ? CLAUDE : `urn:ame:bounded-provider-${index}`, market: MARKET,
      requirementSet: requirements.id, requirements: bindings, predecessor,
      offer: `urn:offer:${stage}`, marketReceipt: `urn:market-receipt:${stage}`, providerReceipt: `urn:provider-receipt:${stage}`,
      consideration: { denomination: "relative-resolution-milliquanta-v1", amount: { numerator: String(10 + index), denominator: "1" }, source: `urn:offer:${stage}` },
    });
    candidates.push(candidate); predecessor = candidate.id;
  }
  return { requirements, candidates };
}

function input(requirements, candidates) {
  return { actor: ACTOR, demand: "urn:demand:runtime-skill-parity", requirementSet: requirements, evidenceReceipt: "urn:evidence:requirements-assayed", providerCandidates: candidates };
}

test("tiered provider candidates preserve every completion condition, receipt, and no-authority boundary", () => {
  const { requirements, candidates } = fixture();
  const plan = integrateRequirementBoundActuationPlan(input(requirements, candidates));
  assert.equal(plan.stages.length, 4);
  assert.deepEqual(plan.requirements, requirements.requirements.map(({ id, completionConditions }) => ({ requirement: id, completionConditions })));
  assert.equal(plan.mutationAuthorized, false);
  assert.equal(plan.acceptanceAuthorized, false);
  assert.deepEqual(plan.conveys, []);
  assert.ok(plan.stages.every(({ offer, marketReceipt, providerReceipt }) => offer && marketReceipt && providerReceipt));
});

test("silent requirement weakening, collapsed predecessors, credentials, wrong SAS provider, and authority are refused", () => {
  const { requirements, candidates } = fixture();
  const weakened = structuredClone(candidates);
  weakened[2] = providerPlanCandidate({ ...weakened[2], requirements: weakened[2].requirements.map((binding, index) => index === 0 ? { ...binding, completionConditions: [binding.completionConditions[0]] } : binding) });
  assert.throws(() => integrateRequirementBoundActuationPlan(input(requirements, weakened)), /silently changed completion conditions/u);
  const collapsed = structuredClone(candidates);
  collapsed[3] = providerPlanCandidate({ ...collapsed[3], predecessor: collapsed[1].id });
  assert.throws(() => integrateRequirementBoundActuationPlan(input(requirements, collapsed)), /predecessor receipt mismatch/u);
  const credentialed = structuredClone(candidates);
  credentialed[2] = providerPlanCandidate({ ...credentialed[2], credentialsIncluded: true });
  assert.throws(() => integrateRequirementBoundActuationPlan(input(requirements, credentialed)), /credential or ambient-repository membrane/u);
  const wrong = structuredClone(candidates);
  wrong[0] = providerPlanCandidate({ ...wrong[0], provider: "urn:ame:generic-provider" });
  assert.throws(() => integrateRequirementBoundActuationPlan(input(requirements, wrong)), /requires urn:ame:claude-code-inference-team/u);
  assert.throws(() => providerPlanCandidate({ ...candidates[0], conveys: ["mutation-authority"] }), /cannot convey/u);
});

test("provider absence becomes a receipted no-fallback obstruction", () => {
  const { requirements } = fixture();
  const result = integrateRequirementBoundActuationPlan({ actor: ACTOR, demand: "urn:demand:x", requirementSet: requirements, evidenceReceipt: "urn:evidence:req", providerRefusal: { stage: "high-level-design", receipt: "urn:refusal:no-claude-offer" } });
  assert.equal(result.type, "RequirementBoundPlanningObstructionK");
  assert.equal(result.fallbackAuthorized, false);
  assert.equal(result.requiredProvider, CLAUDE);
  assert.deepEqual(result.conveys, []);
});

test("a fresh MAPE MCP process executes requirement-preserving integration", () => {
  const { requirements, candidates } = fixture();
  const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "integrate_requirement_bound_actuation_plan", arguments: input(requirements, candidates) } };
  const server = new URL("../src/mape-office-mcp.mjs", import.meta.url);
  const run = spawnSync(process.execPath, [server.pathname], { input: `${JSON.stringify(request)}\n`, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const response = JSON.parse(run.stdout).result.structuredContent;
  assert.equal(response.type, "RequirementBoundActuationPlanK");
  assert.equal(response.stages.length, 4);
  assert.deepEqual(response.conveys, []);
});
