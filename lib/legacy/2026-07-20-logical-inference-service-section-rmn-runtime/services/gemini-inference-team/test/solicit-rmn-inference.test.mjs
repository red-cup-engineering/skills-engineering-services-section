import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT, ACTOR, LAW } from "../src/execute-rmn-inference.mjs";
import { solicit } from "../src/solicit-rmn-inference.mjs";

const request = (workType = "software-engineering", requiredCapabilities = ["software-engineering", "json-schema-output"]) => ({ "@context": "https://www.w3.org/ns/activitystreams", id: "urn:test:gemini-demand", type: "Offer", actor: "urn:test:customer", target: ACTOR, object: { type: "TypedRmnInferenceDemand", workType, requiredCapabilities, difficulty: 0.55, maximumOutputTokens: 900, mode: "dry-run", agentCards: { [ACTOR]: "http://127.0.0.1:17772/.well-known/agent-card.json" } } });

test("provider authors a comparable exact software-engineering offer", () => {
  const result = solicit(request());
  assert.equal(result.type, "Offer");
  assert.equal(result.actor, ACTOR);
  assert.equal(result.object.contract, LAW);
  assert.equal(result.object.providerAccount, ACCOUNT);
  assert.equal(result.object.consideration.unit, "relative-resolution-milliquanta-v1");
  assert.equal(result.object.customerAcceptanceRequired, true);
});

test("provider refuses unsupported capability demands", () => {
  assert.equal(solicit(request("software-engineering", ["formal-proof"])).type, "Reject");
});
