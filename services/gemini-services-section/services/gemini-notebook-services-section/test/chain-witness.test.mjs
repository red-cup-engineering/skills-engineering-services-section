import assert from "node:assert/strict";
import test from "node:test";
import { chainWitnessBody, chainWitnessEnabled, chainWitnessResource } from "../src/chain-witness.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

test("chain witness is a content-addressable Semiotic Exchange Chain resource", () => {
  const envelope = { type: "GeminiNotebookJobRecord", category: "events", row: { status: "completed" } };
  const body = chainWitnessBody({ category: "events", envelope, recordedAt: "2096-07-28T12:00:00.000Z" });
  assert.equal(body.chain, "eip155:5615610");
  assert.deepEqual(chainWitnessResource({ category: "events", graph: "sha256:" + "a".repeat(64) }), [
    "semiotic-exchange", "witness-journal", "urn:ame:notebooklm-inference-team", "events", "sha256:" + "a".repeat(64),
  ]);
});

test("chain mode is opt-in and never inferred from a missing local service", () => {
  assert.equal(chainWitnessEnabled({ SEMIOTIC_EXCHANGE_CHAIN: "1" }), true);
  assert.equal(chainWitnessEnabled({}), false);
});

test("chain witness graph is stable without the legacy WitnessJournal projection", () => {
  assert.equal(semanticId({ b: [2, 1], a: "value" }), semanticId({ a: "value", b: [2, 1] }));
});
