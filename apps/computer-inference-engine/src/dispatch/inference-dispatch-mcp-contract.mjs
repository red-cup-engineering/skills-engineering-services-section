import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchemaInstance } from "@red-cup-engineering/json-schema-services-section/validate-schema-instance";
import { CHAT_COMPLETION_TURN_INPUT_SCHEMA } from "@red-cup-engineering/computer-inference-engine/openai/chat-turn-contract";
import { classifyInferenceDemand } from "./inference-demand-classification.mjs";
import { INFERENCE_WORK_REQUEST_SCHEMA } from "./inference-work-carriers.mjs";
import { CUSTOMER_ACTOR_URI, configuredCustomerToken, loadCustomerActorTokens, loadCustomerAdmissions, resolveConfiguredCustomer } from "./provider-admission.mjs";
import { resolveInferenceCashControl } from "./inference-cash-control.mjs";

const CODEX_CUSTOMER = "actor:WWOM5azg-fTrn1Id0YVbz5AhppbnFny_W5Xl-rKgSs4";
const HERE = dirname(fileURLToPath(import.meta.url));

// Loaded independently of inference-dispatch.mjs to keep this module import-light (see invokeDispatchInference).
const CUSTOMER_ADMISSIONS_PATH = resolve(HERE, "../../content/dispatch/customer-admissions/admitted-customers.json");
const ADMITTED_CUSTOMERS = loadCustomerAdmissions(CUSTOMER_ADMISSIONS_PATH, { market: "urn:ame:inference-work-lot-service" });
export const ACTOR_TOKENS = loadCustomerActorTokens(CUSTOMER_ADMISSIONS_PATH, { market: "urn:ame:inference-work-lot-service" });

/** This process's configured customer actor; unset INFERENCE_WORK_CUSTOMER defaults to Codex. */
export function configuredInferenceCustomer(environment = process.env) {
  return resolveConfiguredCustomer(ADMITTED_CUSTOMERS, { env: environment, fallback: CODEX_CUSTOMER });
}
export const CONFIGURED_CUSTOMER = configuredInferenceCustomer();
const CONFIGURED_CUSTOMER_TOKEN = configuredCustomerToken(CONFIGURED_CUSTOMER, ACTOR_TOKENS) ?? "customer";
const CONFIGURED_CUSTOMER_NAME = CONFIGURED_CUSTOMER_TOKEN.charAt(0).toUpperCase() + CONFIGURED_CUSTOMER_TOKEN.slice(1);

const PACKAGE = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

export const MCP_SERVER_INFO = Object.freeze({
  name: "inference-work-lot-service",
  version: PACKAGE.version,
});

/**
 * @param {string} customerActor
 * @param {string} actorName
 * @returns {string} MCP `instructions` text for the configured actor
 */
export function inferenceDispatchInstructions(customerActor, actorName) {
  return `The stable customer Actor is ${customerActor}; a session is never a customer. ${actorName} owns its routine bounded code decisions, provider purchases under the admitted consideration policy, and assayed delivery outcomes without case-by-case Leader approval. Route mechanical acts to deterministic execution and bounded context-complete derivations to the provider market. Provider failure never silently falls back to ${actorName}. Provider identity is provenance, not acceptance evidence. Do not send secrets or ambient repository access. A later effect on another Actor requires that Actor's induction boundary; it does not change who purchased this work.`;
}

/**
 * @param {string} actorName
 * @param {string} [customerActor]
 * @returns {object} the dispatch_inference tool's JSON Schema
 */
export function dispatchInferenceInputSchema(actorName, customerActor = CONFIGURED_CUSTOMER) {
  if (!ADMITTED_CUSTOMERS.has(customerActor)) throw new Error(`MCP inference surface customer is not admitted: ${customerActor}`);
  return Object.freeze({
    ...INFERENCE_WORK_REQUEST_SCHEMA,
    $id: `${INFERENCE_WORK_REQUEST_SCHEMA.$id}:mcp`,
    properties: {
      ...INFERENCE_WORK_REQUEST_SCHEMA.properties,
      chatCompletion: CHAT_COMPLETION_TURN_INPUT_SCHEMA,
      customer: { ...INFERENCE_WORK_REQUEST_SCHEMA.properties.customer, pattern: CUSTOMER_ACTOR_URI.source,
        enum: [customerActor], description: `The customer Actor configured for this ${actorName} surface; omission uses the same stable Actor.` },
      workLotId: { ...INFERENCE_WORK_REQUEST_SCHEMA.properties.workLotId, pattern: "^urn:" },
      mode: { enum: ["live"], default: "live" },
    },
  });
}

export const MCP_INSTRUCTIONS = inferenceDispatchInstructions(CONFIGURED_CUSTOMER, CONFIGURED_CUSTOMER_NAME);

export const DISPATCH_INFERENCE_INPUT_SCHEMA = dispatchInferenceInputSchema(CONFIGURED_CUSTOMER_NAME);

export const INSPECT_INFERENCE_RESOURCES_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    includeCatalogModels: { type: "boolean", default: false, description: "Explicitly enumerate all provider catalog models. Ordinary placement inspection returns catalog metadata and only the configured model; catalog membership and heuristic classifications do not establish quota or quality." },
    zeroCashOnly: { type: "boolean", description: "Mark configurations without a current zero-cash entitlement as excluded; this does not establish available quota." },
    requiredCapabilities: { type: "array", items: { type: "string", minLength: 1 }, description: "Capabilities required by the intended work; inspection never invokes a provider." },
    requiredQualityTiers: { type: "array", items: { type: "string", minLength: 1 }, description: "Declared provider quality tiers required by the intended work; inspection never invokes a provider or establishes product quality." },
  },
  additionalProperties: false,
});

export async function invokeInspectInferenceResources(input, ports = {}) {
  try {
    if (!validateSchemaInstance({ schema: INSPECT_INFERENCE_RESOURCES_INPUT_SCHEMA, instance: input }).ok) {
      throw new TypeError("input does not admit the inspect-inference-resources schema");
    }
    const request = input;
    const { inspectInferenceResources } = await import("./inference-resource-inspection.mjs");
    const result = await inspectInferenceResources(request, ports);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false };
  } catch {
    const result = { type: "InferenceResourceInspection", disposition: "refused", reason: "invalid-inspection-request-or-runtime" };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: true };
  }
}

export const DISPATCH_INFERENCE_ANNOTATIONS = Object.freeze({
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
  readOnlyHint: false,
});

export const CLASSIFY_INFERENCE_DEMAND_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    demandClass: { type: "string", enum: ["mechanical", "bounded-derivation", "premium-review"], description: "Mechanical work stays deterministic; bounded derivations enter the provider market; premium review is an explicit human-led residual." },
    difficulty: { type: "number", minimum: 0, maximum: 1 },
    contextCharacters: { type: "integer", minimum: 0 },
  },
  required: ["demandClass"],
  additionalProperties: false,
});

export const RECORD_INFERENCE_OUTCOME_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    workLot: { type: "string", minLength: 1, description: "The exact work-lot identifier returned by the market." },
    provider: { type: "string", minLength: 1, description: "The exact provider actor from the fulfilled or refused exchange." },
    taskClass: { type: "string", minLength: 1, description: "The task class used to select that provider." },
    selectedOffer: { type: "string", minLength: 1, description: "The exact selected provider offer returned by the market." },
    receipt: { type: "string", minLength: 1, description: "The fulfilled inference exchange receipt returned by the market." },
    receiver: { type: "string", minLength: 1, description: "The receiving customer actor that issued this disposition." },
    outcome: { type: "string", enum: ["accepted", "refused", "voided"], description: "The receiver's attributable disposition. Voided withdraws an earlier judgment on the same delivery without erasing its audit record." },
    evidence: { type: "string", minLength: 1, description: "An exact receiver decision or behavioral-assay evidence identifier." },
  },
  required: ["workLot", "provider", "taskClass", "selectedOffer", "receipt", "receiver", "outcome", "evidence"],
  additionalProperties: false,
});

export async function invokeClassifyInferenceDemand(input) {
  try {
    const result = classifyInferenceDemand(input);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: JSON.stringify({ outcome: "classification-error", reason }, null, 2) }], isError: true };
  }
}

export async function invokeDispatchInference(input, { resourceReservations, dispatch, cashControl, environment = process.env } = {}) {
  try {
    // Lazy import: keeps initialize/classify usable if the provider transport is down.
    const dispatchInferenceAsConfiguredCustomer = dispatch ?? (await import("./inference-dispatch.mjs")).dispatchInferenceAsConfiguredCustomer;
    const result = await dispatchInferenceAsConfiguredCustomer(input, { environment, customerActor: configuredInferenceCustomer(environment), ...(resourceReservations ? { resourceReservations } : {}), ...(cashControl ? { cashControl } : {}) });
    const visible = reviewableDispatchResult(result);
    const { outcome, disposition, workLot, receipt, candidate, selectedOffer } = visible;
    const directLaneRefusals = visible.directLaneRefusals?.map(({ provider, reason, cause }) => ({ provider, reason, status: cause?.status ?? null }));
    const text = JSON.stringify({ outcome, disposition, workLot, receipt, candidate, selectedOffer, directLaneRefusals, evidence: "structuredContent" });
    // A market refusal is a completed dispatch with evidence for the caller's next decision.
    // Reserve MCP tool errors for failures to execute the dispatch boundary itself.
    return { content: [{ type: "text", text }], structuredContent: visible, isError: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: JSON.stringify({ outcome: "dispatch-error", reason }, null, 2) }], isError: true };
  }
}

/** The receiver gets the product first and one copy of each placement offer. */
export function reviewableDispatchResult(result) {
  const { outcome, workLot, taskClass, receiver, provider, model, selectedOffer, receipt, candidate, routeDecision, ...evidence } = result;
  const placement = routeDecision == null ? null : typeof routeDecision === "string"
    ? { identity: routeDecision }
    : placementEvidenceProjection(routeDecision);
  return {
    outcome, workLot, taskClass, receiver, provider, model, selectedOffer, receipt, candidate,
    ...evidence,
    ...(placement === null ? {} : { placement }),
  };
}

function placementEvidenceProjection(decision) {
  const offers = new Map();
  const reference = (candidate) => {
    const { offer, ...facts } = candidate;
    if (offer) offers.set(offer.id, offer);
    return facts;
  };
  const selected = decision.selected ? reference(decision.selected) : null;
  const attemptPlan = (decision.attemptPlan ?? []).map((layer) => ({
    ...layer, offers: (layer.offers ?? []).map(reference),
  }));
  return {
    type: "WorkPlacementEvidenceProjection", version: 1,
    decisionType: decision.type, disposition: decision.disposition,
    selected, attemptPlan, refusals: decision.refusals ?? [], rationale: decision.rationale ?? [],
    offers: [...offers.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

/** Server startup calls this only when its operator has explicitly installed
 * the shared cash-control contract.  Library callers remain parameterized. */
export function configuredInferenceCashControl(environment = process.env) {
  return environment.INFERENCE_CASH_CONTROL === undefined ? undefined : resolveInferenceCashControl(environment);
}

export async function invokeRecordInferenceOutcome(input, { environment = process.env, record } = {}) {
  try {
    if (input?.receiver !== configuredInferenceCustomer(environment)) throw new Error("this inference surface records only its configured customer receiver");
    const recordInferenceOutcome = record ?? (await import("./inference-dispatch.mjs")).recordInferenceOutcome;
    const result = await recordInferenceOutcome(input, { environment });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: JSON.stringify({ outcome: "receiver-outcome-error", reason }, null, 2) }], isError: true };
  }
}
