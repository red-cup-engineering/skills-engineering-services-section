#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { ROLE_AGENT, ROLE_USER } from "@red-cup-engineering/a2a-services-section/a2a-client";
import { extractSenPart, senPart } from "@red-cup-engineering/a2a-services-section/sen-part";
import { decodeJsonValue, identifyJsonValue } from "../../src/dispatch/sen-carrier.mjs";
import { admitInferenceWorkOutput, admitInferenceWorkRequest } from "../../src/dispatch/inference-work-carriers.mjs";
import { dispatchInference, createPendingInferenceProcurementCustody } from "../../src/dispatch/inference-dispatch.mjs";
import { resolveInferenceCashControl } from "../../src/dispatch/inference-cash-control.mjs";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

function decodeRequest(bytes) {
  return admitInferenceWorkRequest(decodeJsonValue(bytes).value);
}

function encodeResult(value) {
  const identified = identifyJsonValue(admitInferenceWorkOutput(value));
  return { bytes: identified.bytes, id: identified.token };
}

function suspensionFromResult(result) {
  const dependency = result?.settlementResidues?.find(({ dependency }) => dependency)?.dependency;
  if (!dependency || typeof dependency.agentUrl !== "string" || typeof dependency.taskId !== "string") return undefined;
  return {
    type: "A2aTaskDependency",
    protocol: "A2A",
    protocolVersion: "1.0",
    agentUrl: dependency.agentUrl,
    taskId: dependency.taskId,
  };
}

export async function executeA2aMessage(message, { contract = dispatchInference, custody: suppliedCustody, parentTaskId: suppliedParentTaskId, signal, resourceReservations, cashControl = process.env.INFERENCE_CASH_CONTROL === undefined ? undefined : resolveInferenceCashControl() } = {}) {
  if (message.role !== ROLE_USER) throw new Error("inference work contracting requires an A2A ROLE_USER message");
  const input = extractSenPart(message.parts);
  const request = decodeRequest(input.bytes);
  const replay = message.metadata?.dependencyEventAccepted === true || typeof message.metadata?.replayOfMessageId === "string";
  const activeResourceReservations = resourceReservations;
  const parentTaskId = suppliedParentTaskId ?? process.env.A2A_TASK_ID ?? message.taskId;
  let custody = suppliedCustody;
  if ((replay || parentTaskId) && !custody && contract === dispatchInference) custody = await createPendingInferenceProcurementCustody();
  let pendingProcurement;
  if (replay) {
    if (typeof parentTaskId !== "string" || parentTaskId.length === 0) throw new Error("dependency replay requires its durable parent task identity");
    if (!custody) throw new Error("dependency replay requires pending procurement custody");
    pendingProcurement = await custody.load({ parentTaskId, requestNi: input.ni });
    if (!pendingProcurement) throw new Error("dependency replay has no exact pending provider task bound to this parent task and SEN request");
  }
  const result = await contract(request, {
    signal,
    resourceReservations: activeResourceReservations,
    ...(cashControl ? { cashControl } : {}),
    ...(pendingProcurement ? { pendingProcurement } : {}),
    ...(custody && parentTaskId ? {
      captureProcurement: async (procurement) => {
        if (pendingProcurement || procurement?.disposition === "provider-task-pending") {
          await custody.record({ parentTaskId, requestNi: input.ni, procurement });
        }
      },
    } : {}),
  });
  const output = encodeResult(result);
  return {
    messageId: randomUUID(),
    contextId: message.contextId,
    taskId: message.taskId,
    role: ROLE_AGENT,
    parts: [senPart(output.bytes, "inference-work-lot-result.sen.cbor")],
    metadata: {
      disposition: result.disposition ?? result.outcome,
      requestNi: input.ni,
      resultNi: output.id,
      customerAcceptanceRequired: true,
      ...(suspensionFromResult(result) ? { suspension: suspensionFromResult(result) } : {}),
    },
    extensions: [],
    referenceTaskIds: [],
  };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "execute-a2a-task", description: "executeA2aMessage — the execute-a2a-task operation.", operation: executeA2aMessage }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
