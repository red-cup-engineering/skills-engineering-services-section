import assert from "node:assert/strict";
import test from "node:test";
import { ROLE_AGENT, ROLE_USER } from "@red-cup-engineering/a2a-services-section/a2a-client";
import { extractSenPart, senPart } from "@red-cup-engineering/a2a-services-section/sen-part";
import { decodeJsonValue, identifyJsonValue } from "../../src/dispatch/sen-carrier.mjs";
import { executeA2aMessage } from "../../scripts/dispatch/execute-a2a-task.mjs";
import { createPendingInferenceProcurementCustody } from "../../src/dispatch/inference-dispatch.mjs";
import { requestInferenceWorkLot, resumeInferenceWorkLot, submitInferenceWorkLot } from "../../src/dispatch/client.mjs";
import card from "../../content/dispatch/agent-cards/inference-work-lot-market.json" with { type: "json" };

function relationalBytes(value) {
  return identifyJsonValue(value).bytes;
}

function relationalValue(bytes) {
  return decodeJsonValue(bytes).value;
}

test("A2A is a canonical SEN projection of the same bounded market operation", async () => {
  const request = {
    objective: "derive one bounded result",
    context: "finite exact context",
    difficulty: 0.2,
    outputSchema: { type: "object" },
  };
  const expected = { outcome: "market-residue", disposition: "no-admissible-offer", integrationAccepted: false };
  const source = {
    messageId: "request-1", contextId: "context-1",
    role: ROLE_USER, parts: [senPart(relationalBytes(request), "work-lot.sen.cbor")],
    metadata: {}, extensions: [], referenceTaskIds: [],
  };
  const response = await executeA2aMessage(source, {
    contract: async (observed) => { assert.deepEqual(observed, request); return expected; },
  });
  assert.equal(response.role, ROLE_AGENT);
  assert.equal(response.metadata.customerAcceptanceRequired, true);
  assert.deepEqual(relationalValue(extractSenPart(response.parts).bytes), expected);
});

test("market-executor cancellation reaches the contracted downstream task signal", async () => {
  const controller = new AbortController();
  const source = {
    messageId: "request-cancellation", contextId: "context-cancellation", role: ROLE_USER,
    parts: [senPart(relationalBytes({ objective: "derive one bounded result", context: "finite exact context", difficulty: 0.2, outputSchema: { type: "object" } }), "work-lot.sen.cbor")],
    metadata: {}, extensions: [], referenceTaskIds: [],
  };
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
    const input = extractSenPart(message.parts), output = extractSenPart(response.parts);
    return { agentCard: card, result: response, inputNi: input.ni, outputNi: output.ni };
  };
  const observed = await requestInferenceWorkLot({ agentUrl: "https://market.example", request, send: sent });
  assert.deepEqual(observed.result, result);
  assert.equal(observed.provider.account, "eip155:5615610:0x3ffa8ce2459902f2d07cd046359c69dff7841f23");
  assert.equal(observed.result.integrationAccepted, false);
});

test("a transport attempt key stabilizes the A2A message without changing the SEN demand", async () => {
  const request = { objective: "derive one bounded result", context: "finite exact context" };
  const result = { outcome: "candidate-pending-codex-acceptance", candidate: "cedar", integrationAccepted: false };
  const observed = [];
  const sent = async ({ message }) => {
    const input = extractSenPart(message.parts);
    observed.push({ messageId: message.messageId, inputNi: input.ni });
    const response = await executeA2aMessage(message, { contract: async () => result });
    const output = extractSenPart(response.parts);
    return { agentCard: card, result: response, inputNi: input.ni, outputNi: output.ni };
  };
  for (const attemptKey of ["attempt-one", "attempt-one", "attempt-two"]) {
    await requestInferenceWorkLot({ agentUrl: "https://market.example", request, attemptKey, send: sent });
  }
  assert.equal(observed[0].messageId, observed[1].messageId);
  assert.notEqual(observed[0].messageId, observed[2].messageId);
  assert.equal(observed[0].inputNi, observed[1].inputNi);
  assert.equal(observed[0].inputNi, observed[2].inputNi);
});

test("a market lot returns an opaque durable task identity and later resumes the exact SEN demand", async () => {
  const request = { objective: "derive one durable bounded result", context: "finite exact context", difficulty: 0.2, outputSchema: { type: "object" } };
  const result = { outcome: "candidate-pending-codex-acceptance", candidate: { answer: 1 }, integrationAccepted: false };
  let submittedMessage;
  const submission = await submitInferenceWorkLot({
    agentUrl: "https://market.example",
    request,
    submit: async ({ message }) => {
      submittedMessage = message;
      const input = extractSenPart(message.parts);
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
    resume: async ({ taskId }) => {
      assert.equal(taskId, submission.taskId);
      const response = await executeA2aMessage(submittedMessage, { contract: async (observed) => { assert.deepEqual(observed, request); return result; } });
      const output = extractSenPart(response.parts);
      return { agentCard: card, result: response, outputNi: output.ni };
    },
  });
  assert.deepEqual(resumed.result, result);
  assert.equal(resumed.exchange.inputNi, submission.inputNi);
});

test("dependency replay resumes the parent-bound procurement without opening a fresh market", async () => {
  const request = { objective: "derive one durable bounded result", context: "finite exact context" };
  const parts = [senPart(relationalBytes(request), "work-lot.sen.cbor")];
  const initial = {
    messageId: "initial-message", contextId: "parent-context", taskId: "parent-task",
    role: ROLE_USER, parts, metadata: {}, extensions: [], referenceTaskIds: [],
  };
  const replay = {
    messageId: "replay-message", contextId: "parent-context", taskId: "parent-task",
    role: ROLE_USER, parts,
    metadata: { dependencyEventAccepted: true, replayOfMessageId: "initial-message" },
    extensions: [], referenceTaskIds: [],
  };
  const records = [];
  const store = {
    records: async () => records.map(({ record }) => record),
    record: async (entry) => { records.push(entry); return { digest: `record-${records.length}` }; },
  };
  let custody = await createPendingInferenceProcurementCustody({ store });
  const pendingProcurement = {
    type: "TypedSenInferenceProcurement",
    disposition: "provider-task-pending",
    demand: { type: "TypedSenInferenceDemand", id: "demand-1" },
    settlementResidues: [{ dependency: { agentUrl: "https://provider.example/agent-card.json", taskId: "child-task", inputNi: "ni:///sha-256;child-input" } }],
  };
  let freshMarkets = 0;
  let resumedTasks = 0;
  const contract = async (_request, options) => {
    if (!options.pendingProcurement) {
      freshMarkets += 1;
      await options.captureProcurement(pendingProcurement);
      return { outcome: "market-residue", disposition: "provider-task-pending", settlementResidues: pendingProcurement.settlementResidues, integrationAccepted: false };
    }
    resumedTasks += 1;
    assert.deepEqual(options.pendingProcurement, pendingProcurement);
    await options.captureProcurement({ ...pendingProcurement, disposition: "candidate-pending-customer-assay" });
    return { outcome: "candidate-pending-codex-acceptance", candidate: "cedar", integrationAccepted: false };
  };

  const first = await executeA2aMessage(initial, { contract, custody, parentTaskId: "parent-task" });
  assert.equal(first.metadata.suspension.taskId, "child-task");
  custody = await createPendingInferenceProcurementCustody({ store });
  const completed = await executeA2aMessage(replay, { contract, custody, parentTaskId: "parent-task" });
  assert.equal(relationalValue(extractSenPart(completed.parts).bytes).candidate, "cedar");
  assert.equal(freshMarkets, 1);
  assert.equal(resumedTasks, 1);
  await assert.rejects(
    executeA2aMessage(replay, { contract, custody, parentTaskId: "parent-task" }),
    /no exact pending provider task/,
  );
});

test("dependency replay fails closed when its parent-bound procurement is absent", async () => {
  const request = { objective: "derive one durable bounded result", context: "finite exact context" };
  const replay = {
    messageId: "orphan-replay", contextId: "parent-context", taskId: "parent-task",
    role: ROLE_USER, parts: [senPart(relationalBytes(request), "work-lot.sen.cbor")],
    metadata: { dependencyEventAccepted: true, replayOfMessageId: "lost-initial-message" },
    extensions: [], referenceTaskIds: [],
  };
  let called = false;
  await assert.rejects(
    executeA2aMessage(replay, {
      parentTaskId: "parent-task",
      custody: { load: async () => null },
      contract: async () => { called = true; },
    }),
    /no exact pending provider task/,
  );
  assert.equal(called, false);
});
