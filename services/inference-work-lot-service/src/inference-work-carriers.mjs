import { readFileSync } from "node:fs";
import { createSchema, validateInstance } from "@red-cup-engineering/json-schema-services-section";

const load = (name) => createSchema(JSON.parse(readFileSync(new URL(`../schemas/${name}`, import.meta.url), "utf8"))).schema;
export const INFERENCE_WORK_REQUEST_SCHEMA = load("inference-work-request.schema.json");
export const INFERENCE_WORK_RESULT_SCHEMA = load("inference-work-result.schema.json");
export const INFERENCE_WORK_REFUSAL_SCHEMA = load("inference-work-refusal.schema.json");

export const INFERENCE_WORK_OPERATION = Object.freeze({
  verb: "contract-inference-work",
  input: "application/json",
  output: "application/json",
  domain: Object.freeze({ schema: INFERENCE_WORK_REQUEST_SCHEMA.$id }),
  codomain: Object.freeze({ oneOf: Object.freeze([{ schema: INFERENCE_WORK_RESULT_SCHEMA.$id }, { schema: INFERENCE_WORK_REFUSAL_SCHEMA.$id }]) }),
  relating: Object.freeze({ compatibleVersions: Object.freeze(["0.0.1", "0.0.2"]), duplicated: false }),
});

function admitted(value, schema, label) {
  const verdict = validateInstance(value, schema);
  if (!verdict.ok) throw new TypeError(`${label} failed schema validation: ${JSON.stringify(verdict.errors)}`);
  return value;
}
export const admitInferenceWorkRequest = (value) => admitted(value, INFERENCE_WORK_REQUEST_SCHEMA, "inference work request");
export const admitInferenceWorkResult = (value) => admitted(value, INFERENCE_WORK_RESULT_SCHEMA, "inference work result");
export const admitInferenceWorkRefusal = (value) => admitted(value, INFERENCE_WORK_REFUSAL_SCHEMA, "inference work refusal");
export function admitInferenceWorkOutput(value) {
  const result = validateInstance(value, INFERENCE_WORK_RESULT_SCHEMA);
  if (result.ok) return value;
  const refusal = validateInstance(value, INFERENCE_WORK_REFUSAL_SCHEMA);
  if (refusal.ok) return value;
  throw new TypeError(`inference work output failed result and refusal schemas: ${JSON.stringify({ result: result.errors, refusal: refusal.errors })}`);
}
