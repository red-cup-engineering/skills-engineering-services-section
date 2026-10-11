import assert from "node:assert/strict";
import test from "node:test";
import { completedUserMessage, executeUserMessage, userMessageWorkLot } from "../../src/dispatch/user-swarm.mjs";

function completedMarketResult() {
  return {
    outcome: "candidate-pending-codex-acceptance",
    workLot: "urn:work-lot:test",
    provider: "urn:ame:gemini-inference-team",
    model: "gemini-test",
    candidate: "A provider-authored answer.",
    receiverAcceptanceRequired: true,
    acceptanceScope: "delivery-to-codex-customer-office-only",
    evidence: {
      receipt: "ni:///sha-256;receipt",
      compact: "ni:///sha-256;compact",
      schemaAssay: "ni:///sha-256;assay",
      considerationClose: "ni:///sha-256;close",
      settlement: "ni:///sha-256;settlement",
    },
  };
}

test("a plain user message becomes one live chat work lot", () => {
  assert.deepEqual(userMessageWorkLot("  What grows in fog?  "), {
    objective: "What grows in fog?",
    context: "What grows in fog?",
    workType: "chat",
    taskClass: "user-swarm-message",
    desiredUse: "Return one direct answer to the user who supplied this message.",
    enforceProviderSchema: false,
    mode: "live",
  });
  assert.throws(() => userMessageWorkLot("  "), /must contain text/u);
});

test("a completed envelope preserves non-Codex provenance and receipt coordinates", () => {
  const envelope = completedUserMessage(completedMarketResult(), "message-1");
  assert.equal(envelope.status, "completed");
  assert.equal(envelope.execution, "non-codex");
  assert.equal(envelope.provider, "urn:ame:gemini-inference-team");
  assert.equal(envelope.result, "A provider-authored answer.");
  assert.equal(envelope.receipt.receipt, "ni:///sha-256;receipt");
  assert.equal(envelope.receiverAcceptanceRequired, true);
});

test("the loopback boundary delegates one plain message and returns the terminal envelope", async () => {
  let observed;
  const body = await executeUserMessage({ message: "Name one cedar." }, {
    messageId: "message-2",
    contract: async (input) => { observed = input; return completedMarketResult(); },
  });
  assert.equal(body.status, "completed");
  assert.equal(body.provider, "urn:ame:gemini-inference-team");
  assert.equal(body.messageId, "message-2");
  assert.equal(observed.objective, "Name one cedar.");
  await assert.rejects(() => executeUserMessage({ message: "" }, { contract: async () => completedMarketResult() }), /must contain text/u);
});
