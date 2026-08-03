import assert from "node:assert/strict";
import test from "node:test";
import { Message, Role } from "@a2a-js/sdk";
import { extractRmnPart, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { decodeJsonValue, identifyJsonValue } from "../src/modern-rmn-carrier.mjs";
import { executeA2aMessage } from "../scripts/execute-a2a-task.mjs";
import { requestInferenceWorkLot, resumeInferenceWorkLot, submitInferenceWorkLot } from "../src/client.mjs";
import card from "../content/agent-cards/inference-work-lot-market.json" with { type: "json" };

function relationalBytes(value) {
  return identifyJsonValue(value).bytes;
}

function relationalValue(bytes) {
  return decodeJsonValue(bytes).value;
}

test("A2A is a canonical RMN projection of the same bounded market operation", async () => {
  const request = {
    objective: "derive one bounded result",
    context: "finite exact context",
    difficulty: 0.2,
    outputSchema: { type: "object" },
  };
  const expected = { outcome: "market-residue", disposition: "no-admissible-offer", integrationAccepted: false };
  const source = Message.toJSON({
    messageId: "request-1", contextId: "context-1",
    role: Role.ROLE_USER, parts: [rmnPart(relationalBytes(request), "work-lot.rmn.cbor")],
    metadata: {}, extensions: [], referenceTaskIds: [],
  });
  const response = Message.fromJSON(await executeA2aMessage(source, {
    contract: async (observed) => { assert.deepEqual(observed, request); return expected; },
  }));
  assert.equal(response.role, Role.ROLE_AGENT);
  assert.equal(response.metadata.customerAcceptanceRequired, true);
  assert.deepEqual(relationalValue(extractRmnPart(response.parts).bytes), expected);
});

test("market-executor cancellation reaches the contracted downstream task signal", async () => {
  const controller = new AbortController();
  const source = Message.toJSON({
    messageId: "request-cancellation", contextId: "context-cancellation", role: Role.ROLE_USER,
    parts: [rmnPart(relationalBytes({ objective: "derive one bounded result", context: "finite exact context", difficulty: 0.2, outputSchema: { type: "object" } }), "work-lot.rmn.cbor")],
    metadata: {}, extensions: [], referenceTaskIds: [],
  });
  let downstreamCancellation;
  const pending = executeA2aMessage(source, {
    signal: controller.signal,
    contract: async (_request, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => { downstreamCancellation = signal.reason; reject(signal.reason); }, { once: true });
    }),
  });
  const cancellation = new Error("market task cancelled"); cancellation.name = "AbortError";
  controller.abort(cancellation);
  await assert.rejects(pending, /market task cancelled/);
  assert.equal(downstreamCancellation, cancellation);
});

test("the public client binds one signed market face and receives no receiver authority", async () => {
  const request = { objective: "derive one bounded result", context: "finite exact context", difficulty: 0.2, outputSchema: { type: "object" } };
  const result = { outcome: "candidate-pending-codex-acceptance", candidate: { answer: 1 }, integrationAccepted: false };
  const sent = async ({ message }) => {
    const response = await executeA2aMessage(message, { contract: async (observed) => { assert.deepEqual(observed, request); return result; } });
    const parsed = Message.fromJSON(response), input = extractRmnPart(Message.fromJSON(message).parts), output = extractRmnPart(parsed.parts);
    return { agentCard: card, result: parsed, inputNi: input.ni, outputNi: output.ni };
  };
  const observed = await requestInferenceWorkLot({ agentUrl: "https://market.example/.well-known/agent-card.json", request, send: sent });
  assert.deepEqual(observed.result, result);
  assert.equal(observed.provider.account, "eip155:5615610:0x3ffa8ce2459902f2d07cd046359c69dff7841f23");
  assert.equal(observed.result.integrationAccepted, false);
});

test("a market lot returns an opaque durable task identity and later resumes the exact RMN demand", async () => {
  const request = { objective: "derive one durable bounded result", context: "finite exact context", difficulty: 0.2, outputSchema: { type: "object" } };
  const result = { outcome: "candidate-pending-codex-acceptance", candidate: { answer: 1 }, integrationAccepted: false };
  let submittedMessage;
  const submission = await submitInferenceWorkLot({
    agentUrl: "https://market.example/.well-known/agent-card.json",
    request,
    submit: async ({ message }) => {
      submittedMessage = message;
      const input = extractRmnPart(Message.fromJSON(message).parts);
      return {
        task: { id: "opaque-provider-task-7", contextId: "opaque-context-3", status: { state: "TASK_STATE_WORKING" }, artifacts: [], history: [], metadata: {} },
        taskId: "opaque-provider-task-7",
        inputNi: input.ni,
        agentCard: card,
        authentication: { required: true, agentCardSignatureVerified: true },
        extensions: [],
      };
    },
  });
  assert.equal(submission.taskId, "opaque-provider-task-7");
  assert.match(submission.inputNi, /^ni:\/\/\/sha-256;/u);

  const resumed = await resumeInferenceWorkLot({
    agentUrl: submission.agentUrl,
    taskId: submission.taskId,
    inputNi: submission.inputNi,
    resume: async ({ taskId, inputNi }) => {
      assert.equal(taskId, submission.taskId);
      assert.equal(inputNi, submission.inputNi);
      const response = await executeA2aMessage(submittedMessage, { contract: async (observed) => { assert.deepEqual(observed, request); return result; } });
      const parsed = Message.fromJSON(response), output = extractRmnPart(parsed.parts);
      return { agentCard: card, result: parsed, inputNi, outputNi: output.ni };
    },
  });
  assert.deepEqual(resumed.result, result);
  assert.equal(resumed.exchange.inputNi, submission.inputNi);
});
