/** Provider-neutral inference material carried through witnessed RPC. */
import { requireJsonValue } from "@red-cup-engineering/json-services-section";
import { artifactId } from "@red-cup-engineering/semiotic-eavt-services-section/identity";
import { tokenUsageCounts } from "../cost/token-usage/core.mjs";

function jsonRecord(value, label) {
  return value === undefined ? undefined : requireJsonValue(value, label);
}

export function inferenceToolMove(input) {
  return Object.freeze({
    kind: "metroplat.inference.tool-move",
    request: input.request,
    name: input.name,
    input: requireJsonValue(input.input, "inference tool input"),
    ...(input.extensions === undefined ? {} : { extensions: jsonRecord(input.extensions, "inference tool move extensions") }),
  });
}

export function inferenceMessage(input) {
  return Object.freeze({
    kind: "metroplat.inference.message",
    role: input.role,
    content: input.content,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.toolRequest === undefined ? {} : { toolRequest: input.toolRequest }),
    ...(input.toolMoves === undefined ? {} : { toolMoves: Object.freeze(input.toolMoves.map((move) => inferenceToolMove(move))) }),
  });
}

export function inferenceTool(input) {
  return Object.freeze({
    kind: "metroplat.inference.tool",
    name: input.name,
    ...(input.operation === undefined ? {} : { operation: input.operation }),
    ...(input.description === undefined ? {} : { description: input.description }),
    inputSchema: requireJsonValue(input.inputSchema, "inference tool input schema"),
    ...(input.strict === undefined ? {} : { strict: input.strict }),
  });
}

/**
 * A response constraint is provider-neutral: `{ kind: "json-schema", name, schema }`, the codomain a
 * result must be. Each wire states it in its own form (Chat Completions `response_format`, Responses
 * `text.format`, a command provider's schema argument); where a provider cannot decode under a
 * schema, the customer's assay holds the result to it. A constraint admitted from a wire in that
 * wire's own form passes through as it is.
 */
export function jsonSchemaConstraint(schema, name = "result_codomain") {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) throw new TypeError("a response constraint's schema is a JSON Schema object");
  return Object.freeze({ kind: "json-schema", name: String(name).replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 64) || "result_codomain", schema: requireJsonValue(schema, "response constraint schema") });
}

export const isNeutralConstraint = (constraint) => constraint?.kind === "json-schema";

/** The JSON Schema a constraint holds a result to, in whichever form it is stated; none for a bare JSON mode. */
export function constraintSchemaOf(constraint) {
  if (constraint === null || typeof constraint !== "object") return undefined;
  if (isNeutralConstraint(constraint)) return constraint.schema;
  if (constraint.type === "json_schema") return constraint.json_schema?.schema ?? constraint.schema;
  return undefined;
}

/** Seal semantic call identity independently of transport, observation time, and causal placement. */
export function inferenceCall(draft) {
  const messages = Object.freeze(draft.messages.map((message) => inferenceMessage(message)));
  const tools = Object.freeze((draft.tools ?? []).map((tool) => inferenceTool(tool)));
  const responseConstraint = draft.responseConstraint === undefined
    ? undefined
    : requireJsonValue(draft.responseConstraint, "inference response constraint");
  const extensions = jsonRecord(draft.extensions, "inference call extensions");
  const generation = draft.generation === undefined ? undefined : Object.freeze({
    ...(draft.generation.maxOutputTokens === undefined ? {} : { maxOutputTokens: Math.max(0, Math.trunc(draft.generation.maxOutputTokens)) }),
    ...(draft.generation.temperature === undefined ? {} : { temperature: draft.generation.temperature }),
    ...(draft.generation.topP === undefined ? {} : { topP: draft.generation.topP }),
    ...(draft.generation.stopSequences === undefined ? {} : { stopSequences: Object.freeze([...draft.generation.stopSequences]) }),
  });
  const identity = Object.freeze({
    request: draft.request,
    subject: draft.subject,
    model: draft.model,
    messages,
    tools,
    ...(generation === undefined ? {} : { generation }),
    ...(responseConstraint === undefined ? {} : { responseConstraint }),
  });
  return Object.freeze({
    kind: "metroplat.inference.call",
    id: artifactId(identity),
    ...identity,
    ...(extensions === undefined ? {} : { extensions }),
    ...(draft.caller === undefined ? {} : { caller: jsonRecord(draft.caller, "inference caller") }),
    observedAt: draft.observedAt,
    causes: Object.freeze([...(draft.causes ?? [])]),
  });
}

export function inferenceResult(input) {
  const toolMoves = Object.freeze((input.toolMoves ?? []).map((move) => inferenceToolMove(move)));
  const message = input.message === undefined ? undefined : inferenceMessage(input.message);
  const extensions = jsonRecord(input.extensions, "inference result extensions");
  const usage = input.usage === undefined ? undefined : Object.freeze({
    ...tokenUsageCounts(input.usage),
    ...(input.usage.extensions === undefined ? {} : { extensions: jsonRecord(input.usage.extensions, "inference usage extensions") }),
  });
  const identityUsage = usage === undefined ? undefined : tokenUsageCounts(usage);
  const identity = Object.freeze({
    call: input.call,
    model: input.model,
    stop: input.stop,
    ...(message === undefined ? {} : { message }),
    toolMoves,
    ...(identityUsage === undefined ? {} : { usage: identityUsage }),
  });
  return Object.freeze({
    kind: "metroplat.inference.result",
    id: artifactId(identity),
    ...identity,
    ...(usage === undefined ? {} : { usage }),
    ...(extensions === undefined ? {} : { extensions }),
    observedAt: input.observedAt,
    causes: Object.freeze([...(input.causes ?? [])]),
  });
}

export function inferenceObstruction(input) {
  const generator = Object.freeze({ call: input.call, condition: input.condition, reasons: Object.freeze([...input.reasons]), retryable: input.retryable });
  const extensions = jsonRecord(input.extensions, "inference obstruction extensions");
  return Object.freeze({
    kind: "metroplat.inference.obstruction",
    id: artifactId(generator),
    ...generator,
    ...(extensions === undefined ? {} : { extensions }),
    observedAt: input.observedAt,
    causes: Object.freeze([...(input.causes ?? [])]),
  });
}
