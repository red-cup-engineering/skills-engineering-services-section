import requestSchema from "../../content/dispatch/schemas/inference-work-request.schema.json" with { type: "json" };
import resultSchema from "../../content/dispatch/schemas/inference-work-result.schema.json" with { type: "json" };
import refusalSchema from "../../content/dispatch/schemas/inference-work-refusal.schema.json" with { type: "json" };
import { COMPUTER_ENGINEERING_SPECIFICATION_ID } from "@red-cup-engineering/computer-system-engine/specification";
import { admit, defineType } from "@red-cup-engineering/computer-data-engineering-services-section/type-system";
import { admitOperation } from "@red-cup-engineering/computer-code-engineering-services-section/typed-operation";
import { CHAT_COMPLETION_TURN_INPUT_SCHEMA } from "@red-cup-engineering/computer-inference-engine/openai/chat-turn-contract";
import { executionConfiguration, executionConfigurationIdentity } from "./sen-carrier.mjs";

function declared(result) {
  if (!result.ok) throw new TypeError(JSON.stringify(result.refusal));
  return result.value;
}
function carrier(name, schema, references = []) {
  return declared(defineType({ id: schema.$id, name, description: name, parents: [], schema, references }));
}

export const INFERENCE_WORK_REQUEST_TYPE = carrier("inference-work-request", requestSchema, [CHAT_COMPLETION_TURN_INPUT_SCHEMA]);
export const INFERENCE_WORK_RESULT_TYPE = carrier("inference-work-result", resultSchema);
export const INFERENCE_WORK_REFUSAL_TYPE = carrier("inference-work-refusal", refusalSchema);
export const INFERENCE_WORK_REQUEST_SCHEMA = INFERENCE_WORK_REQUEST_TYPE.schema;
export const INFERENCE_WORK_RESULT_SCHEMA = INFERENCE_WORK_RESULT_TYPE.schema;
export const INFERENCE_WORK_REFUSAL_SCHEMA = INFERENCE_WORK_REFUSAL_TYPE.schema;
export const INFERENCE_WORK_OUTPUT_TYPE = declared(defineType({
  id: "urn:red-cup-engineering:schema:inference-work-output:1", name: "inference-work-output", description: "An inference result or refusal.", parents: [],
  schema: { oneOf: [{ $ref: INFERENCE_WORK_RESULT_TYPE.id }, { $ref: INFERENCE_WORK_REFUSAL_TYPE.id }] },
  references: [INFERENCE_WORK_RESULT_SCHEMA, INFERENCE_WORK_REFUSAL_SCHEMA],
}));
export const INFERENCE_WORK_OPERATION = declared(admitOperation({
  specification: COMPUTER_ENGINEERING_SPECIFICATION_ID,
  id: "contract-inference-work", domain: INFERENCE_WORK_REQUEST_TYPE, codomain: INFERENCE_WORK_OUTPUT_TYPE,
  effects: ["inference:procure"], body: { kind: "capability-effect", capability: "inference:procure" },
}));

function admitted(type, value, label) {
  const verdict = admit(type, value);
  if (!verdict.ok) throw new TypeError(`${label} failed schema validation: ${JSON.stringify(verdict.refusal.issues)}`);
  return verdict.value;
}
export const admitInferenceWorkRequest = (value) => admitted(INFERENCE_WORK_REQUEST_TYPE, value, "inference work request");
export function admitInferenceWorkResult(value) {
  const result = admitted(INFERENCE_WORK_RESULT_TYPE, value, "inference work result");
  const configuration = executionConfiguration(result.configuration);
  if (executionConfigurationIdentity(configuration) !== result.configurationIdentity) {
    throw new TypeError("inference delivery configuration does not match its content identity");
  }
  if (configuration.provider !== result.provider) {
    throw new TypeError("inference delivery configuration does not name its provider");
  }
  return result;
}
export const admitInferenceWorkRefusal = (value) => admitted(INFERENCE_WORK_REFUSAL_TYPE, value, "inference work refusal");
export function admitInferenceWorkOutput(value) {
  const output = admitted(INFERENCE_WORK_OUTPUT_TYPE, value, "inference work output (result and refusal)");
  return output.outcome.startsWith("candidate-pending-") ? admitInferenceWorkResult(output) : output;
}
