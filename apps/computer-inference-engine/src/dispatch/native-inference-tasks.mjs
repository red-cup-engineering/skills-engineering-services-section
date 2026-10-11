import {createA2aTaskMethods} from "@red-cup-engineering/a2a-services-section/a2a-server";
import {
  TASK_STATE,
  isTerminalTaskState,
  a2aResultParts,
  a2aResultMetadata,
} from "@red-cup-engineering/a2a-services-section/a2a-client";
import {extractSenPart} from "@red-cup-engineering/a2a-services-section/sen-part";
import {requestMessage} from "./client.mjs";
import {decodeJsonValue} from "./sen-carrier.mjs";
import {
  admitInferenceWorkOutput,
  admitInferenceWorkRequest,
} from "./inference-work-carriers.mjs";
import {executeA2aMessage} from "../../scripts/dispatch/execute-a2a-task.mjs";

export function createNativeInferenceTasks({taskStore, customer, dispatch, custody}) {
  const a2aMethods = createA2aTaskMethods(taskStore, {
    "message/send": (message, context) => executeA2aMessage(message, {contract: dispatch, custody}),
  });

  function submit(args) {
    return submitOnce(args);
  }

  async function submitOnce({request, attemptKey}) {
    if (typeof attemptKey !== "string" || attemptKey.trim() === "") throw new TypeError("caller attemptKey is required");
    if (request.customer && request.customer !== customer) {
      throw new Error(`request.customer (${request.customer}) does not match configured customer (${customer})`);
    }
    const {message} = requestMessage({...request, customer}, attemptKey);
    const {ni: inputNi} = extractSenPart(message.parts);
    // One attempt names one owned task. Re-observation cannot buy a second generation.
    message.taskId = message.messageId;
    const claimResult = await taskStore.claim(message.taskId, message.contextId, message);
    if (!claimResult.claimed) {
      const prior = claimResult.task;
      const original = prior.history?.find(entry => entry.role === "ROLE_USER");
      if (!original || extractSenPart(original.parts).ni !== inputNi) throw new Error("attemptKey is already bound to a different request");
      return {taskId: prior.id, inputNi, task: prior};
    }
    const task = await a2aMethods["message/send"](
      {message, configuration: {returnImmediately: true}},
      {}
    );
    if (!task || typeof task.id !== "string") {
      throw new Error("Invalid task returned from A2A");
    }
    return {taskId: task.id, inputNi, task};
  }

  async function observe({taskId, inputNi}) {
    if (!taskId || typeof taskId !== "string") {
      throw new Error("taskId must be a non‑empty string");
    }
    if (!inputNi || typeof inputNi !== "string") {
      throw new Error("inputNi must be a non‑empty string");
    }
    const task = await a2aMethods["tasks/get"]({id: taskId});
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    if (task.id !== taskId) {
      throw new Error(`Returned task id mismatch`);
    }
    const state = task.status?.state;
    if (!Object.values(TASK_STATE).includes(state)) {
      throw new Error(`Invalid task state ${state}`);
    }

    const userEntry = (task.history || []).find(h => h.role === "ROLE_USER");
    if (!userEntry) {
      throw new Error(`Task ${taskId} missing ROLE_USER history`);
    }
    const {ni: requestNi, bytes: requestBytes} = extractSenPart(userEntry.parts);
    if (requestNi !== inputNi) {
      throw new Error(`inputNi mismatch for task ${taskId}`);
    }
    const decodedReq = decodeJsonValue(requestBytes);
    const admittedReq = admitInferenceWorkRequest(decodedReq.value);
    if (!admittedReq || admittedReq.customer !== customer) {
      throw new Error(`Task ${taskId} request customer mismatch`);
    }

    if (!isTerminalTaskState(state)) {
      return {outcome: "provider-task-pending", taskId, inputNi, state};
    }
    if (state !== TASK_STATE.COMPLETED) {
      return {outcome: "provider-task-terminal", taskId, inputNi, state, task};
    }

    const output = extractSenPart(a2aResultParts(task));
    const decodedRes = decodeJsonValue(output.bytes);
    const result = admitInferenceWorkOutput(decodedRes.value);
    const metadata = a2aResultMetadata(task);
    if (!metadata) {
      throw new Error(`Task ${taskId} missing result metadata`);
    }
    if (metadata.requestNi !== inputNi) {
      throw new Error(`Result metadata.requestNi mismatch for task ${taskId}`);
    }
    if (metadata.resultNi !== output.ni) {
      throw new Error(`Result metadata.resultNi mismatch for task ${taskId}`);
    }
    if (decodedRes.token !== output.ni) {
      throw new Error(`Result token does not match result NI for task ${taskId}`);
    }
    if (result.integrationAccepted !== false) {
      throw new Error(`Result integrationAccepted must be false for task ${taskId}`);
    }

    return {
      outcome: "provider-task-delivered",
      taskId,
      inputNi,
      state,
      result,
      resultNi: decodedRes.token,
    };
  }

  return {submit, observe};
}
