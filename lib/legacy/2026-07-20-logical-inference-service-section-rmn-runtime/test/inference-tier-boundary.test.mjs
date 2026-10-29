import assert from "node:assert/strict";
import test from "node:test";

import { quotePlan, validateJobs } from "../src/inference-fabric.mjs";

const profile = Object.freeze({
  capabilities: Object.freeze(["chat"]),
  expectedLatencyMs: 1,
  cost: Object.freeze({ unit: "test", dispatch: 0, inference: 1, verification: 0, scarcity: 0 }),
  successPrior: 0.9,
});
const endpoints = Object.freeze([
  Object.freeze({ id: "free-nim", model: "meta/llama-3.1-8b-instruct", profile }),
  Object.freeze({ id: "leader-sonnet", model: "claude-sonnet-4-6", profile }),
]);

test("the cheapest-sufficient fabric quotes only models inside the buyer's admissible tiers", () => {
  const job = {
    id: "urn:test:leader-only",
    messages: [{ role: "user", content: "Rewrite this manuscript." }],
    requiredCapabilities: ["chat"],
    admissibleTiers: ["leader-claude"],
    models: { "leader-claude": "claude-sonnet-4-6" },
  };
  const quote = quotePlan(job, endpoints);
  assert.deepEqual(quote.plan.map((candidate) => candidate.endpoint), ["leader-sonnet"]);
  assert.deepEqual(quote.filtered, [{ endpoint: "free-nim", reasons: ["model-not-admissible:meta/llama-3.1-8b-instruct"] }]);
});

test("an admissible tier without an exact model mapping is refused at ingress", () => {
  assert.throws(() => validateJobs([{
    id: "urn:test:unbound-tier",
    messages: [{ role: "user", content: "Do work." }],
    admissibleTiers: ["leader-claude"],
    models: {},
  }]), /invalid admissible tier-model boundary/u);
});
