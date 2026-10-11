/** Native and signed remote delivery share the existing A2A task owner. */
import { validateSchemaInstance } from "@red-cup-engineering/json-schema-services-section/validate-schema-instance";
import { configuredInferenceCustomer, dispatchInferenceInputSchema } from "./inference-dispatch-mcp-contract.mjs";

export function submitInferenceInputSchema(actorName, customer) {
  return {
    type: "object",
    properties: {
      attemptKey: { type: "string", minLength: 1, description: "Caller attempt identity. Does not authorize automatic retry." },
      request: dispatchInferenceInputSchema(actorName, customer),
    },
    required: ["attemptKey", "request"],
    additionalProperties: false,
  };
}

export const RECEIVE_INFERENCE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: { taskId: { type: "string", minLength: 1 }, inputNi: { type: "string", minLength: 1 } },
  required: ["taskId", "inputNi"],
  additionalProperties: false,
});

function endpoint(environment) {
  const value = environment.INFERENCE_WORK_LOT_AGENT;
  if (typeof value !== "string" || !/^https?:\/\//u.test(value))
    throw new Error("INFERENCE_WORK_LOT_AGENT must explicitly name the machine's inference task endpoint");
  return value;
}

function response(value, isError = false) {
  const { outcome, taskId, inputNi, state, reason } = value;
  return { content: [{ type: "text", text: JSON.stringify({ outcome, taskId, inputNi, state, reason }) }],
    structuredContent: value, isError };
}

export async function invokeSubmitInference(input, { environment = process.env, submit, nativeTasks } = {}) {
  let submitted = false;
  try {
    const customer = configuredInferenceCustomer(environment);
    if (!validateSchemaInstance({ schema: submitInferenceInputSchema("configured customer", customer), instance: input }).ok)
      throw new TypeError("input does not admit the configured customer's task submission");
    const agentUrl = nativeTasks ? undefined : endpoint(environment);
    const purchase = { ...input.request, customer };
    const submitWork = nativeTasks?.submit ?? submit ?? (await import("./client.mjs")).submitInferenceWorkLot;
    submitted = true;
    const task = await submitWork({ agentUrl, request: purchase, attemptKey: input.attemptKey });
    if (typeof task.taskId !== "string" || task.taskId.length === 0)
      return response({ outcome: "inference-task-submission-unknown", inputNi: task.inputNi,
        reason: "submission returned no durable task handle; do not repeat generation" }, true);
    return response({ outcome: "inference-task-submitted", taskId: task.taskId, inputNi: task.inputNi,
      provider: task.provider, state: task.task?.status?.state, customer,
      receiverAcceptanceRequired: true, integrationAccepted: false });
  } catch (error) {
    return response({ outcome: submitted ? "inference-task-submission-unknown" : "inference-task-error",
      reason: error instanceof Error ? error.message : String(error) }, true);
  }
}

export async function invokeReceiveInference(input, { environment = process.env, observe, nativeTasks } = {}) {
  try {
    if (!validateSchemaInstance({ schema: RECEIVE_INFERENCE_INPUT_SCHEMA, instance: input }).ok)
      throw new TypeError("input does not admit the inference task receipt coordinates");
    const customer = configuredInferenceCustomer(environment);
    const agentUrl = nativeTasks ? undefined : endpoint(environment);
    const readWork = nativeTasks?.observe ?? observe ?? (await import("./client.mjs")).observeInferenceWorkLot;
    return response(await readWork({ agentUrl, taskId: input.taskId, inputNi: input.inputNi, customer }));
  } catch (error) {
    return response({ outcome: "inference-task-read-error", taskId: input?.taskId, inputNi: input?.inputNi,
      reason: error instanceof Error ? error.message : String(error) }, true);
  }
}
