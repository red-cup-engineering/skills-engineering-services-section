import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { discoverValidatedAgentCard } from "@red-cup-engineering/a2a-services-section/sen-part";
import { cachedProviderCardProbe } from "./provider-card-liveness-cache.mjs";
import { assayTypedInferenceCandidate } from "./customer-assay-typed-inference.mjs";
import { demandCommitment, procureTypedInference, resumePendingTypedInference } from "./typed-inference-procurement.mjs";
import { configuredCustomerToken, loadCustomerActorTokens, loadCustomerAdmissions, loadCustomerServiceAdmissions, loadProviderAdmissions, outcomeSentinelForCustomer, resolveConfiguredCustomer, standingOfferFromAgentCard } from "./provider-admission.mjs";
import { considerationPolicyIsSubpolicy, migrateConsiderationPolicy, resolutionCreditPolicy, validateConsiderationPolicy } from "./consideration.mjs";
import { recordAssayedInferenceConsiderationClose } from "./consideration-close.mjs";
import { pricingRootOf, loadInferencePlacementObservations, observeInferenceOutcome, observeInferenceRefusal, oversizedProviderRequests, registerInferenceDelivery, voidInferenceOutcome } from "./expected-resolution-pricing-client.mjs";
import { incompleteOrders, loadObservations } from "./expected-resolution-pricing.mjs";
import { BOUNDED_INFERENCE_ROUTING_PROFILE, classifyInferenceDemand } from "./inference-demand-classification.mjs";
import { a2aExecutionConfiguration, executionConfigurationIdentity, jsonValueId } from "./sen-carrier.mjs";
import { canonicalJson, formContextPacket } from "./context-packet.mjs";
import { admitInferenceContext } from "./context-packet-demand.mjs";
import { INFERENCE_WORK_OPERATION, admitInferenceWorkRefusal, admitInferenceWorkResult } from "./inference-work-carriers.mjs";
import { bindingsProviders, createComputerPlatform } from "@red-cup-engineering/computer-system-platform";
import { createInferenceSettlementStore, resolveLocalSettlementAccount } from "./witness-journal-settlement-store.mjs";
import { createToolAgentBudget } from "@red-cup-engineering/computer-inference-engine/openai/tool-agent";
import { executeReceiverToolAgent } from "./receiver-agent.mjs";
import { bindMcpTools } from "@red-cup-engineering/mcp-engineering-services-section/tool-binding";
import { projectTypedInferenceCandidate } from "./customer-assay-typed-inference.mjs";
import { directEndpointAdmissionReasons, directEndpointOffer, dispatchDirectEndpointOffer, directEndpointConfigurationIdentity, directEndpointExecutionConfiguration, loadDirectEndpointProviderDescriptors, refreshDirectEndpointProviderDescriptors, measuredExchangeResources, openAiJsonSchemaResponseFormat } from "./direct-endpoint-provider.mjs";
import { decideWorkPlacement } from "./decide-work-placement.mjs";
import { createInferenceResourceReservations } from "./resource-reservation-execution.mjs";
import { optimizeInferenceContext } from "./context-optimization.mjs";
import { applyInferenceCashControl } from "./inference-cash-control.mjs";
import { inferenceDataRootOf } from "./state-root.mjs";

export { BOUNDED_INFERENCE_ROUTING_PROFILE, classifyInferenceDemand } from "./inference-demand-classification.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const CUSTOMER = "urn:ame:inference-work-lot-service";
export const CODEX_CUSTOMER = "actor:WWOM5azg-fTrn1Id0YVbz5AhppbnFny_W5Xl-rKgSs4";

function hasUsableChatCompletion(candidate, tools) {
  if (!Array.isArray(candidate?.choices)) return false;
  const offered = new Set(tools.map((tool) => tool?.function?.name).filter((name) => typeof name === "string"));
  return candidate.choices.some(({ message }) => {
    if (message?.role !== "assistant") return false;
    const content = message.content;
    const text = typeof content === "string" ? content
      : Array.isArray(content) ? content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("")
        : "";
    if (text.trim() !== "") return true;
    // Assistant-turn mode returns proposed tool calls without executing them.
    // FeltOS validates and executes these at the caller's witnessed boundary.
    const proposed = message.tool_calls;
    return offered.size > 0 && Array.isArray(proposed) && proposed.length > 0
      && proposed.every((call) => call?.type === "function"
        && typeof call.id === "string" && call.id.length > 0
        && offered.has(call.function?.name)
        && typeof call.function?.arguments === "string");
  });
}

/** Whether an assistant-turn response proposes tool calls rather than a final message. */
function proposesToolCalls(response) {
  return Array.isArray(response?.choices) && response.choices.some(({ message }) => Array.isArray(message?.tool_calls) && message.tool_calls.length > 0);
}

async function settlementAccount(environment = process.env) {
  return resolveLocalSettlementAccount(ROOT, { actor: CUSTOMER, caip2: environment.SETTLEMENT_CAIP2 }).settlement;
}
const PROVIDER_ADMISSIONS = resolve(ROOT, "content/dispatch/provider-admissions/inference-providers.json");
const SERVICE_ADMISSIONS = resolve(ROOT, "content/dispatch/provider-admissions/semantic-services.json");
const CUSTOMER_ADMISSIONS = resolve(ROOT, "content/dispatch/customer-admissions/admitted-customers.json");
export const ADMITTED_CUSTOMERS = loadCustomerAdmissions(CUSTOMER_ADMISSIONS, { market: "urn:ame:inference-work-lot-service" });
const ACTOR_TOKENS = loadCustomerActorTokens(CUSTOMER_ADMISSIONS, { market: "urn:ame:inference-work-lot-service" });

/** This process's configured customer actor; unset INFERENCE_WORK_CUSTOMER defaults to Codex. */
export const INFERENCE_WORK_CUSTOMER = resolveConfiguredCustomer(ADMITTED_CUSTOMERS, { fallback: CODEX_CUSTOMER });

export const DEFAULT_CONSIDERATION_POLICY = resolutionCreditPolicy();
// Routing profiles describe demand for market observation. They do not impose
// a customer-global capacity ceiling: admitted provider offers determine
// whether the requested finite lot is feasible.

export function providerAgentCardOverrides(environment = process.env) {
  return {
    ...(environment.OPENROUTER_INFERENCE_AGENT_CARD
      ? { "urn:ame:openrouter-inference-team": environment.OPENROUTER_INFERENCE_AGENT_CARD }
      : {}),
  };
}

export const INFERENCE_PROVIDERS = loadProviderAdmissions(PROVIDER_ADMISSIONS, {
  agentCardOverrides: providerAgentCardOverrides(),
});
export const CUSTOMER_SERVICES = loadCustomerServiceAdmissions(SERVICE_ADMISSIONS, {
  requiredRoles: ["witnessJournal"],
  admissionGraph: `${CUSTOMER}:service-admissions`,
  agentCardOverrides: {
    ...(process.env.WITNESS_JOURNAL_RDF_AGENT ? { witnessJournal: process.env.WITNESS_JOURNAL_RDF_AGENT } : {}),
  },
});

function supplier(provider, signal) {
  return Object.freeze({
    actor: provider.actor,
    id: provider.id,
    agentCard: provider.agentCard,
    async exchange(activity) {
      const card = await cachedProviderCardProbe(ROOT, provider.agentCard, () => {
        const origin = new URL(provider.agentCard);
        return discoverValidatedAgentCard(`${origin.protocol}//${origin.host}`, { requireSignature: true, signal });
      });
      return standingOfferFromAgentCard(provider, card, activity, activity.object, demandCommitment);
    },
  });
}

function admitCustomerContext(input) {
  if (input.customer !== undefined && !ADMITTED_CUSTOMERS.has(input.customer)) throw new Error(`inference work lots admit only customers on the addressed admission carrier; ${input.customer} is not admitted`);
  const admittedContext = admitInferenceContext(input, { formContextPacket, canonicalJson });
  if (input.considerationPolicy !== undefined) {
    const policy = migrateConsiderationPolicy(input.considerationPolicy);
    validateConsiderationPolicy(policy);
    if (!considerationPolicyIsSubpolicy(policy, DEFAULT_CONSIDERATION_POLICY)) throw new Error("customer consideration must use an admitted direct-witness relative-resolution credit settlement capability");
  }
  return admittedContext;
}

/**
 * States the customer schema's exact top-level shape as one instruction
 * sentence, then appends the schema itself serialized once. An object
 * schema names its required top-level properties and, when
 * `additionalProperties` is `false`, says no others are allowed; an array
 * schema states `minItems`/`maxItems` when the schema gives them. This is
 * the fact the provider prompt was missing (a wrapped-object or bare-array
 * top level cannot be guessed from the objective alone).
 * @param {object} schema - the customer's JSON Schema
 * @returns {string}
 */
function outputShapeInstruction(schema) {
  const type = schema.type ?? "unspecified";
  const lines = [`Return one JSON value whose top level exactly matches this contract: the top-level type must be ${type}.`];
  if (type === "object") {
    const required = Array.isArray(schema.required) ? schema.required : [];
    lines.push(required.length > 0
      ? `The top-level object must include these required properties: ${required.join(", ")}.`
      : "The top-level object carries no required properties.");
    const declared = Object.keys(schema.properties ?? {});
    lines.push(`Declared top-level properties: ${declared.join(", ")}. Declared properties not listed as required are optional and may be included when the task needs them.`);
    if (schema.additionalProperties === false) lines.push("No properties outside the declared top-level properties are allowed.");
  } else if (type === "array") {
    const bounds = [];
    if (Number.isFinite(schema.minItems)) bounds.push(`minItems ${schema.minItems}`);
    if (Number.isFinite(schema.maxItems)) bounds.push(`maxItems ${schema.maxItems}`);
    lines.push(`The output must be a bare JSON array${bounds.length > 0 ? ` (${bounds.join(", ")})` : ""}, never wrapped in an object.`);
  }
  lines.push(`Output contract schema: ${JSON.stringify(schema)}`);
  return lines.join(" ");
}

/**
 * The re-ask instruction sent back to the same provider after a
 * repairable schema-assay failure
 * (see {@link repairableAssayFailure}): the exact assay errors quoted
 * verbatim, followed by the same shape instruction restated.
 * @param {object} schema
 * @param {string[]} problems - verbatim schemaProblems() entries
 * @returns {string}
 */
function reaskInstruction(schema, problems) {
  const quoted = problems.map((problem) => `- ${problem}`).join("\n");
  return `The previous response failed the required output contract with these exact errors:\n${quoted}\n\n${outputShapeInstruction(schema)} Return only the corrected JSON value, with no surrounding prose.`;
}

/**
 * True when a failed customer-schema-assay projection is worth one repair turn: the candidate
 * parsed as JSON (projection.problem is null, so this is not "not JSON" or "ambiguous") and the
 * validator named what it violates. Any violation, top-level shape or nested field, is quoted back
 * once with the contract restated (the repair loop of every structured-output client); a provider
 * that answered in prose is not asked again, since it shows no JSON to repair.
 * @param {{ problem: string|null, problems?: string[] }} projection
 * @returns {boolean}
 */
function repairableAssayFailure(projection) {
  return projection.problem === null && Array.isArray(projection.problems) && projection.problems.length > 0;
}

function receiverToolName(tool) {
  return tool?.type === "function" && typeof tool.function?.name === "string"
    ? tool.function.name
    : null;
}

/**
 * Materialize receiver-granted MCP tools once, before the market or provider
 * boundary. `directMcp` is deliberately an in-process option: it never enters
 * the work-lot carrier and therefore cannot grant a model an endpoint or a
 * credential.
 */
async function resolveReceiverTools({ directTools, directToolHandlers, directMcp, signal }) {
  if (!directMcp) return { tools: directTools, toolHandlers: directToolHandlers };
  const mcp = await bindMcpTools({ ...directMcp, signal });
  const names = new Set(directTools.map(receiverToolName).filter(Boolean));
  const collision = mcp.tools.map(receiverToolName).find((name) => names.has(name));
  if (collision) throw new TypeError(`receiver tool name collision: ${collision}`);
  return {
    tools: [...directTools, ...mcp.tools],
    toolHandlers: { ...directToolHandlers, ...mcp.toolHandlers },
  };
}

/**
 * Attempt delivery through the customer's configured direct OpenAI-compatible
 * endpoints after the A2A market produced no settled candidate. The direct
 * lane is the thin-adapter primary/fallback (owner-directed 2026-09-01): it
 * carries no signed compact and no chain settlement, and its result says so
 * plainly. Descriptors become normalized offers and the existing route law
 * orders their explicit attempt plan; an outputSchema is always enforced by
 * the customer's own assay. When the customer additionally opts in with
 * enforceProviderSchema and the selected descriptor has proven (advertised
 * as json-schema-output capability) OpenAI-compatible response_format
 * support, the request also carries a provider-side json_schema shaping
 * hint (see openAiJsonSchemaResponseFormat) -- an attempt to improve the
 * odds of a compliant candidate, never a substitute for the customer assay,
 * which still runs unconditionally and alone decides acceptance. Every
 * per-descriptor failure is returned as a refusal rather than thrown.
 * @returns {Promise<{ delivered: object|null, refusals: Array<{ provider: string, reason: string }>, timing: { routeDecisionMs: number, executionMs: number } }>}
 */
async function attemptDirectEndpointLane({ input, workLot, taskClass, customer, descriptors, invoke, tools = [], toolHandlers = {}, execution = {}, pricingRoot, registerDelivery = registerInferenceDelivery }) {
  const refusals = [];
  // An order providers have missed alike is the order's to complete, not another maker's to try.
  const missed = input.order === undefined || !pricingRoot ? undefined : incompleteOrders(loadObservations({ dataRoot: pricingRoot })).get(input.order);
  if (missed !== undefined) return {
    delivered: null, refusals: [{ provider: "unselected", reason: `order-incomplete: missed by ${missed.join(", ")}` }], orderIncomplete: true,
    timing: { routeDecisionMs: 0, executionMs: 0 },
  };
  if (execution.resourcePolicyRefusal) return {
    delivered: null, refusals: [{ provider: "unselected", reason: execution.resourcePolicyRefusal }],
    timing: { routeDecisionMs: 0, executionMs: 0 },
  };
  if (!Array.isArray(descriptors) || descriptors.length === 0) return { delivered: null, refusals, timing: { routeDecisionMs: 0, executionMs: 0 } };
  const eligible = descriptors.filter((descriptor) => {
    const reasons = directEndpointAdmissionReasons(descriptor, input);
    for (const reason of reasons) refusals.push({ provider: descriptor.provider, reason });
    return reasons.length === 0;
  });
  descriptors = eligible;
  const accountBindings = new Map();
  if (execution.resourceReservations) descriptors = descriptors.filter((descriptor) => {
    try { accountBindings.set(descriptor, execution.resourceReservations.bindingFor(descriptor)); return true; }
    catch (error) { refusals.push({ provider: descriptor.provider, reason: error.message }); return false; }
  });
  let childSequence = 0;
  if (input.agentBounds && !input.chatCompletion) execution = { ...execution, delegation: async (child) => {
    const result = await attemptDirectEndpointLane({ input: { ...input, objective: child.objective }, workLot: `${workLot}:child:${++childSequence}`, taskClass, customer, descriptors, invoke, tools: child.tools, toolHandlers: child.toolHandlers, execution: { ...child, pricingRoot, zeroCashOnly: input.zeroCashOnly, ...(execution.resourceReservations ? { resourceReservations: execution.resourceReservations } : {}) }, pricingRoot, registerDelivery });
    return result.delivered ?? { type: "ReceiverToolRefusal", operation: "delegate_inference", reason: "child-route-exhausted", refusals: result.refusals, prohibitedEffectsPerformed: false };
  } };
  const schema = input.outputSchema ?? null;
  const messages = input.chatCompletion?.messages ?? [
    { role: "system", content: "Return one bounded inference product. This compact confers no receiver mutation, execution, integration, truth, or acceptance authority." },
    {
      role: "user",
      content: `${input.objective}${input.context ? `\n\nContext:\n${input.context}` : ""}${
        input.contextPacket ? `\n\nContext:\n${input.contextPacket.segments.map((segment) => segment.content).join("\n")}` : ""
      }${schema ? `\n\n${outputShapeInstruction(schema)}` : ""}`,
    },
  ];
  const demand = {
    type: "TypedWorkDemand",
    id: `${workLot}:direct-endpoint-demand`,
    taskClass,
    principal: customer,
    // A capability is an interface feature the provider exposes; the work type names the outcome
    // sought, which any chat receiver may attempt and the market prices from its accepted results.
    requiredCapabilities: [...new Set(["chat",
      // Bounds make the receiver an agent only where a tool can be offered: its own, or delegation,
      // which needs depth to spend and a tool call to spend it with. A bounded single answer needs none.
      ...(tools.length > 0 || (input.agentBounds && !input.chatCompletion && (execution.maximumDepth ?? 0) > (execution.depth ?? 0) && (execution.maximumToolCalls ?? Infinity) > 0) ? ["tool-calling"] : []),
      ...(input.chatCompletion?.response_format?.type === "json_schema" ? ["json-schema-output"] : []),
      ...(input.requiredCapabilities ?? [])])],
    requiredQualityTiers: input.requiredQualityTiers ?? [],
    requiredEffects: ["read-only"],
    requiredExecutionClasses: [...new Set(descriptors.map((descriptor) => descriptor.endpointClass))],
    idempotence: "idempotent",
    context: {
      identity: jsonValueId({ context: input.context ?? null, contextPacket: input.contextPacket?.id ?? null, ...(input.chatCompletion ? { chatCompletion: input.chatCompletion } : {}) }),
      authorityScope: "urn:scope:bounded-inference-candidate",
      freshnessIdentity: input.contextPacket?.freshnessIdentity ?? "urn:freshness:request-bounded",
      dataConstraints: [],
      custodyConstraints: [],
    },
    outputContract: { identity: jsonValueId(input.chatCompletion ? { protocol: "openai.chat.completion", responseFormat: input.chatCompletion.response_format ?? null } : schema ?? { type: "string" }) },
    measures: {},
    ...(input.workPlacement?.requiredImplementationIdentity === undefined ? {} : { requiredImplementationIdentity: input.workPlacement.requiredImplementationIdentity }),
    routePolicy: {
      // Never by latency: a slow model that is accepted is worth its time; cost per accepted result decides.
      preferenceOrder: [["consideration-per-acceptance"], ["acceptance-probability"], ["resources"]],
      considerationPreference: [],
      reuse: "forbid",
      unknownObservations: "choice-required",
      unknownAvailability: execution.resourceReservations ? "refuse" : input.workPlacement?.unknownAvailability ?? "permit",
      resourceCeilings: input.workPlacement?.resourceCeilings ?? [],
    },
  };
  // Presence of input.workPlacement alone used to signal "this call is
  // account/window-quota-aware", overriding declaredResources with the
  // remaining job budget. excludedOffers carries no such signal: a
  // workPlacement whose only field is excludedOffers must route exactly as
  // an absent workPlacement would, aside from the exclusion itself.
  const workPlacementIsResourceAware = Object.keys(input.workPlacement ?? {}).some((field) => field !== "excludedOffers");
  const offerPairs = descriptors.map((descriptor) => {
    const availabilityEvidence = input.workPlacement?.availabilityEvidence?.find((candidate) => candidate.providerIdentity === descriptor.provider
      && candidate.accountIdentity === input.workPlacement?.accountIdentity && candidate.windowIdentity === input.workPlacement?.windowIdentity);
    const offer = directEndpointOffer(descriptor, demand, execution, accountBindings.get(descriptor) ?? availabilityEvidence ?? descriptor.availabilityEvidence);
    if (!workPlacementIsResourceAware && !execution.resourceReservations) return { descriptor, offer };
    // These are conservative whole-job reservations, including children and
    // retries. They replace an endpoint's single-call quote for these units.
    const remaining = execution.budget.snapshot();
    return { descriptor, offer: { ...offer, declaredResources: [
      ...offer.declaredResources.filter((row) => !((row.resource === "requests" && row.unit === "request" && row.asset === undefined)
        || (row.resource === "output-tokens" && row.unit === "token" && row.asset === undefined))),
      // A Resource the job leaves unbounded reserves nothing here.
      ...(remaining.requests === undefined ? [] : [{ resource: "requests", unit: "request", amount: { numerator: String(remaining.requests), denominator: "1" } }]),
      ...(remaining.outputTokens === undefined ? [] : [{ resource: "output-tokens", unit: "token", amount: { numerator: String(remaining.outputTokens), denominator: "1" } }]),
    ] } };
  });
  // Per-lot exclusion: a customer that assayed and refused a candidate names
  // its offer id here so the market places the same lot with another offer.
  // Excluded offers never reach decideWorkPlacement -- they are removed
  // before placement -- but each exclusion still names itself in refusals.
  const excludedOfferIds = new Set(input.workPlacement?.excludedOffers ?? []);
  const admittedPairs = excludedOfferIds.size === 0 ? offerPairs : offerPairs.filter(({ offer }) => {
    if (!excludedOfferIds.has(offer.id)) return true;
    refusals.push({ provider: offer.provider, reason: `excluded-by-customer:${offer.id}` });
    return false;
  });
  const offers = admittedPairs.map(({ offer }) => offer);
  const routeDecisionStarted = performance.now();
  const observations = pricingRoot && offers.length > 0 ? await loadInferencePlacementObservations(pricingRoot, taskClass,
    admittedPairs.map(({ offer, descriptor }) => ({ offerId: offer.id, configurationIdentity: offer.configurationIdentity,
      configuration: directEndpointExecutionConfiguration(descriptor, execution) })), customer) : [];
  const route = decideWorkPlacement({ demand, offers, observations: input.workPlacement?.observations ?? observations, evaluatedAt: execution.resourceReservations?.evaluatedAt() ?? input.workPlacement?.evaluatedAt });
  const routeDecisionMs = performance.now() - routeDecisionStarted;
  for (const refusal of route.refusals) {
    const offer = offers.find(({ id }) => id === refusal.offerId);
    refusals.push({ provider: offer?.provider ?? "unknown", reason: refusal.reasons.join(",") });
  }
  // A fresh market has no observations, so equal-consideration offers leave a
  // Pareto frontier the placement law cannot order: "choice-required" with an
  // explicit attempt plan whose execution is the customer's sequential
  // authority. This lane IS the customer's own surface, and its choice is the
  // plan's declared order (the catalog's free-first order). The first offer
  // whose candidate passes the customer's assay wins. Without this, a market
  // with no history never makes its first call.
  const customerChoice = route.disposition === "choice-required" && Array.isArray(route.attemptPlan) && route.attemptPlan.length > 0;
  if (route.disposition !== "selected" && !customerChoice) return { delivered: null, refusals, route, timing: { routeDecisionMs, executionMs: 0 } };
  const byOffer = new Map(admittedPairs.map(({ offer, descriptor }) => [offer.id, descriptor]));
  const executionStarted = performance.now();
  const plannedOffers = route.attemptPlan.flatMap((layer) => customerChoice
    ? [...layer.offers].sort((left, right) => offers.findIndex(({ id }) => id === left.offerId) - offers.findIndex(({ id }) => id === right.offerId))
    : layer.offers);
  const oversizedRequests = pricingRoot ? await oversizedProviderRequests(pricingRoot, workLot, taskClass) : [];
  for (const planned of plannedOffers) {
    const remaining = execution.budget?.snapshot();
    if (remaining && ((remaining.requests ?? Infinity) < 1 || (remaining.outputTokens ?? Infinity) < 1)) {
      refusals.push({ provider: "unselected", reason: remaining.requests < 1
        ? "shared-request-budget-exhausted" : "shared-output-token-budget-exhausted" });
      break;
    }
    const descriptor = byOffer.get(planned.offerId);
    if (!descriptor) continue;
    const selectedOffer = offers.find(({ id }) => id === planned.offerId);
    const selectedAvailability = selectedOffer?.availabilityEvidence;
    const reservedInvoke = execution.resourceReservations?.wrap(descriptor, selectedOffer.declaredResources, invoke) ?? invoke;
    const responseFormat = input.chatCompletion?.response_format ?? (schema && input.enforceProviderSchema === true && descriptor.capabilities.includes("json-schema-output")
      ? openAiJsonSchemaResponseFormat(schema, `${taskClass.replace(/[^a-zA-Z0-9_]/gu, "_")}_output_contract`)
      : undefined);
    const accountedOutput = [descriptor.maximumOutputTokens, execution.maximumOutputTokens].filter((value) => Number.isSafeInteger(value) && value > 0);
    const requestIdentity = jsonValueId({ model: descriptor.model, messages,
      tools, responseFormat: responseFormat ?? null, chatCompletion: input.chatCompletion ?? null,
      maximumOutputTokens: accountedOutput.length === 0 ? null : Math.min(...accountedOutput) });
    if (oversizedRequests.some((item) => item.selectedOffer === planned.offerId
      && item.configurationIdentity === selectedOffer.configurationIdentity && item.requestIdentity === requestIdentity)) {
      refusals.push({ provider: descriptor.provider, model: descriptor.model, selectedOffer: planned.offerId,
        reason: "identical-provider-request-previously-refused-as-too-large" });
      continue;
    }
    const receiverAttempt = jsonValueId({ kind: "receiver-inference-attempt", receiver: customer, workLot,
      selectedOffer: planned.offerId, requestIdentity, nonce: randomUUID() });
    let delivery;
    try {
      delivery = await dispatchDirectEndpointOffer(descriptor, { messages, tools, toolHandlers, responseFormat, execution, ...(input.chatCompletion ? { chatCompletion: input.chatCompletion } : {}) }, { invoke: reservedInvoke });
    } catch (error) {
      refusals.push({ provider: descriptor.provider, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (delivery.disposition === "refused") {
      const measuredResources = measuredExchangeResources(delivery.exchanges, {
        provider: descriptor.provider,
        accountIdentity: selectedAvailability?.accountIdentity,
        windowIdentity: selectedAvailability?.windowIdentity,
        durationMs: delivery.durationMs,
        networkBytes: input.workPlacement?.networkBytes,
      });
      const localRefusal = ["local-admission", "resource", "cancelled"].includes(delivery.cause?.kind);
      const receiverAttemptRefusal = delivery.cause?.kind === "protocol" && delivery.exchanges.length > 0;
      if (pricingRoot && !localRefusal && delivery.cause?.kind !== "transport") {
        const refusalWitness = jsonValueId({ kind: receiverAttemptRefusal ? "direct-endpoint-receiver-attempt-refusal" : "direct-endpoint-provider-refusal", provider: descriptor.provider,
          model: delivery.model, reason: delivery.reason, cause: delivery.cause ?? null,
          exchanges: delivery.exchanges.map(({ usage, finishReason }) => ({ usage: usage ?? null, finishReason: finishReason ?? null })) });
        await observeInferenceRefusal(pricingRoot, {
          workLot, provider: descriptor.provider, taskClass, selectedOffer: planned.offerId,
          kind: receiverAttemptRefusal ? "receiver-attempt-refusal" : "provider-refusal",
          disposition: delivery.reason, configurationIdentity: selectedOffer.configurationIdentity,
          refusalReceipt: jsonValueId({ kind: "direct-endpoint-refusal-receipt", workLot, selectedOffer: planned.offerId, requestIdentity, ...(receiverAttemptRefusal ? { receiverAttempt, refusalWitness } : { providerRefusalWitness: refusalWitness }) }),
          refusalWitness, requestIdentity,
          ...(receiverAttemptRefusal ? { receiver: customer, receiverAttempt, configuration: directEndpointExecutionConfiguration(descriptor, execution),
            cause: delivery.cause, resources: measuredResources.resources, measurementScope: measuredResources.scope,
            ...(Number.isSafeInteger(delivery.durationMs) ? { durationMs: delivery.durationMs } : {}) } : {}),
          ...(delivery.requestBytes === undefined ? {} : { requestBytes: delivery.requestBytes }),
          ...(descriptor.credentialSha256 === undefined ? {} : { credentialSha256: descriptor.credentialSha256 }),
          ...(Number.isInteger(delivery.cause?.status) && delivery.cause.status >= 100 && delivery.cause.status <= 599 ? { status: delivery.cause.status } : {}),
        });
      }
      refusals.push({
        provider: descriptor.provider,
        model: delivery.model,
        selectedOffer: planned.offerId,
        reason: localRefusal ? delivery.cause.reason : delivery.reason,
        cause: delivery.cause,
        consideration: [{ kind: descriptor.considerationKind, asset: descriptor.considerationAsset, unit: descriptor.considerationUnit, amount: descriptor.considerationAmount }],
        declaredResources: descriptor.declaredResources,
        durationMs: delivery.durationMs,
        measuredResources,
        providerEvidence: {
          toolInvocations: delivery.toolInvocations,
          exchanges: delivery.exchanges,
          tokenUsage: delivery.exchanges.map(({ usage }) => usage),
          measuredResources,
        },
      });
      if (delivery.cause?.kind === "cancelled") break;
      continue;
    }
    let candidate = input.chatCompletion ? delivery.response : delivery.text;
    const providerOutputs = [candidate];
    let conversation = delivery.messages;
    const outputEvidence = () => ({ outputs: [...providerOutputs], ...(conversation ? { messages: conversation } : {}) });
    let reasks = 0;
    let exchanges = delivery.exchanges;
    let toolInvocations = delivery.toolInvocations;
    let durationMs = delivery.durationMs;
    // In assistant-turn mode the codomain holds the final message, not a turn that proposes tool
    // calls, and the caller reads the wire response, so an assayed turn is kept as that response.
    const assistantTurn = input.chatCompletion !== undefined;
    if (schema && !(assistantTurn && proposesToolCalls(candidate))) {
      let projection = projectTypedInferenceCandidate(delivery.text, schema);
      if ((projection.problem !== null || projection.validCandidateCount !== 1) && repairableAssayFailure(projection)) {
        const reaskMessages = [...(conversation ?? [...messages, { role: "assistant", content: delivery.text }]), { role: "user", content: reaskInstruction(schema, projection.problems) }];
        let reaskDelivery = null;
        try {
          reaskDelivery = await dispatchDirectEndpointOffer(descriptor, { messages: reaskMessages, tools, toolHandlers, responseFormat, execution }, { invoke: reservedInvoke });
        } catch {
          // The re-ask transport failure falls through to the original projection's refusal below.
        }
        if (reaskDelivery) {
          reasks = 1;
          exchanges = [...delivery.exchanges, ...reaskDelivery.exchanges];
          toolInvocations = [...delivery.toolInvocations, ...reaskDelivery.toolInvocations];
          durationMs = (delivery.durationMs ?? 0) + (reaskDelivery.durationMs ?? 0);
          if (reaskDelivery.disposition !== "refused") {
            candidate = assistantTurn ? reaskDelivery.response : reaskDelivery.text;
            providerOutputs.push(candidate);
            conversation = reaskDelivery.messages ?? conversation;
            delivery = { ...delivery, model: reaskDelivery.model };
            projection = projectTypedInferenceCandidate(reaskDelivery.text, schema);
          }
        }
      }
      if (projection.problem !== null || projection.validCandidateCount !== 1) {
        const measuredResources = measuredExchangeResources(exchanges, { provider: descriptor.provider, accountIdentity: selectedAvailability?.accountIdentity, windowIdentity: selectedAvailability?.windowIdentity, durationMs, networkBytes: input.workPlacement?.networkBytes });
        // The customer assayed actual provider output. Bind that refusal to its
        // delivery so later placements can learn from failed schema work.
        if (pricingRoot) {
          const configurationIdentity = directEndpointConfigurationIdentity(descriptor, execution);
          const receipt = jsonValueId({ kind: "direct-endpoint-delivery", workLot, taskClass, selectedOffer: planned.offerId, configurationIdentity, candidate: jsonValueId(candidate), exchanges: exchanges.map(({ usage, finishReason }) => ({ usage: usage ?? null, finishReason: finishReason ?? null })), durationMs });
          await registerDelivery(pricingRoot, { workLot, ...(input.order === undefined ? {} : { order: input.order }), provider: descriptor.provider, taskClass, selectedOffer: planned.offerId, receipt, receiver: customer, configurationIdentity, configuration: directEndpointExecutionConfiguration(descriptor, execution), ...(Number.isSafeInteger(durationMs) ? { durationMs } : {}), resources: measuredResources.resources });
          await observeInferenceOutcome(pricingRoot, {
            workLot, provider: descriptor.provider, taskClass, selectedOffer: planned.offerId,
            receipt, receiver: customer, outcome: "refused",
            evidence: jsonValueId({ kind: "direct-endpoint-schema-assay", receipt, schema: jsonValueId(schema), problem: projection.problem, problems: projection.problems ?? [] }),
            configurationIdentity,
          });
        }
        refusals.push({
          provider: descriptor.provider,
          reason: projection.problem ?? `candidate-failed-customer-schema-assay: ${JSON.stringify(projection.problems ?? [])}`,
          ...(reasks > 0 ? { reasks } : {}),
          measuredResources,
          providerEvidence: { ...outputEvidence(), toolInvocations, exchanges, tokenUsage: exchanges.map(({ usage }) => usage), measuredResources },
        });
        continue;
      }
      if (!assistantTurn) candidate = projection.value;
    } else if (input.chatCompletion && !hasUsableChatCompletion(candidate, tools)) {
      const measuredResources = measuredExchangeResources(exchanges, {
        provider: descriptor.provider,
        accountIdentity: selectedAvailability?.accountIdentity,
        windowIdentity: selectedAvailability?.windowIdentity,
        durationMs,
        networkBytes: input.workPlacement?.networkBytes,
      });
      if (pricingRoot) {
        const configurationIdentity = directEndpointConfigurationIdentity(descriptor, execution);
        const receipt = jsonValueId({ kind: "direct-endpoint-delivery", workLot, taskClass, selectedOffer: planned.offerId, configurationIdentity, candidate: jsonValueId(candidate), exchanges: exchanges.map(({ usage, finishReason }) => ({ usage: usage ?? null, finishReason: finishReason ?? null })), durationMs });
        await registerDelivery(pricingRoot, { workLot, ...(input.order === undefined ? {} : { order: input.order }), provider: descriptor.provider, taskClass, selectedOffer: planned.offerId, receipt, receiver: customer, configurationIdentity, configuration: directEndpointExecutionConfiguration(descriptor, execution), ...(Number.isSafeInteger(durationMs) ? { durationMs } : {}), resources: measuredResources.resources });
        await observeInferenceOutcome(pricingRoot, {
          workLot, provider: descriptor.provider, taskClass, selectedOffer: planned.offerId,
          receipt, receiver: customer, outcome: "refused",
          evidence: jsonValueId({ kind: "direct-endpoint-chat-completion-assay", receipt, problem: "no-usable-assistant-content-or-completed-tool-result" }),
          configurationIdentity,
        });
      }
      refusals.push({
        provider: descriptor.provider,
        model: delivery.model,
        selectedOffer: planned.offerId,
        reason: "chat-completion-candidate-has-no-usable-assistant-content-or-completed-tool-result",
        measuredResources,
        providerEvidence: { ...outputEvidence(), toolInvocations, exchanges, tokenUsage: exchanges.map(({ usage }) => usage), measuredResources },
      });
      continue;
    }
    const configurationIdentity = directEndpointConfigurationIdentity(descriptor, execution);
    const measuredResources = measuredExchangeResources(exchanges, {
      provider: descriptor.provider,
      accountIdentity: selectedAvailability?.accountIdentity,
      windowIdentity: selectedAvailability?.windowIdentity,
      durationMs,
      networkBytes: input.workPlacement?.networkBytes,
    });
    const configuration = directEndpointExecutionConfiguration(descriptor, execution);
    const receipt = jsonValueId({ kind: "direct-endpoint-delivery", workLot, taskClass, selectedOffer: planned.offerId, configurationIdentity, candidate: jsonValueId(candidate), exchanges: exchanges.map(({ usage, finishReason }) => ({ usage: usage ?? null, finishReason: finishReason ?? null })), durationMs });
    if (pricingRoot) await registerDelivery(pricingRoot, { workLot, ...(input.order === undefined ? {} : { order: input.order }), provider: descriptor.provider, taskClass, selectedOffer: planned.offerId, receipt, receiver: customer, configurationIdentity, configuration, ...(Number.isSafeInteger(durationMs) ? { durationMs } : {}), resources: measuredResources.resources });
    return {
      refusals,
      timing: { routeDecisionMs, executionMs: performance.now() - executionStarted },
      delivered: admitInferenceWorkResult({
        outcome: "candidate-pending-customer-acceptance",
        workLot,
        taskClass,
        receiver: customer,
        provider: descriptor.provider,
        model: delivery.model,
        endpointClass: descriptor.endpointClass,
        configurationIdentity,
        configuration,
        selectedOffer: planned.offerId,
        receipt: { id: receipt },
        selectionRule: "direct-endpoint-customer-ordered-pareto-route-after-a2a-market-residue",
        consideration: [{ kind: descriptor.considerationKind, asset: descriptor.considerationAsset, unit: descriptor.considerationUnit, amount: descriptor.considerationAmount }],
        declaredResources: descriptor.declaredResources,
        measuredResources,
        routeDecision: route,
        settlement: "none-direct-endpoint-lane-carries-no-signed-compact-or-chain-settlement",
        durationMs,
        providerEvidence: {
          ...outputEvidence(),
          toolInvocations,
          exchanges,
          tokenUsage: exchanges.map(({ usage }) => usage),
          measuredResources,
          sharedBudgetRemaining: execution.budget?.snapshot() ?? null,
          ...(reasks > 0 ? { reasks } : {}),
        },
        customerAssay: input.chatCompletion ? "chat-completion-turn-accepted" : schema ? "output-schema-accepted" : "text-carrier-accepted",
        providerSchemaEnforcement: responseFormat?.type === "json_schema" ? { attempted: true, strict: responseFormat.json_schema.strict === true } : { attempted: false },
        directLaneRefusals: refusals,
        candidate,
        integrationAccepted: false,
        receiverAcceptanceRequired: true,
        nextAct: "Route the product to executable behavioral assay and the receiving settlement's authorized induction decision boundary; provider identity is provenance, not proof.",
      }),
    };
  }
  return { delivered: null, refusals, route, timing: { routeDecisionMs, executionMs: performance.now() - executionStarted } };
}

function marketResidue(procurement, { workLot, taskClass, receiver }) {
  const selected = procurement.selection?.disposition === "provider-selected"
    ? procurement.selection.selected
    : null;
  const selectedResidue = selected
    ? procurement.settlementResidues?.find((item) => item.provider === selected.provider.actor && item.offer === selected.offer.id) ?? procurement.settlementResidues?.[0]
    : null;
  return admitInferenceWorkRefusal({
    outcome: "market-residue",
    disposition: procurement.disposition,
    workLot,
    taskClass,
    receiver,
    provider: selected?.provider?.actor ?? null,
    selectedOffer: selected?.offer?.id ?? null,
    receipt: selectedResidue?.receipt ?? null,
    selectionRule: procurement.selection?.selectionRule ?? null,
    expectedResolutionPrice: procurement.selection?.selectedExpectedResolutionPrice ?? null,
    rankedFeasibleOffers: (procurement.selection?.ranked ?? []).map(({ provider, offer, consideration, expectedResolutionPrice }) => ({
      provider: provider.actor,
      offer: offer.id,
      model: offer.object.model,
      consideration,
      ...(expectedResolutionPrice ? { expectedResolutionPrice } : {}),
    })),
    refusedOffers: procurement.market?.refused ?? [],
    admittedOffers: (procurement.market?.admitted ?? []).map(({ provider, offer }) => ({
      provider: provider.actor,
      considerationAlternatives: offer.object.considerationAlternatives,
      model: offer.object.model,
    })),
    settlementResidues: procurement.settlementResidues ?? [],
    marketRound: procurement.marketRound ?? null,
    routeDecision: procurement.routeDecision ?? null,
    marketWitnesses: (procurement.marketWitnesses ?? []).map(({ id }) => id),
    providerSettlementAttempts: procurement.providerSettlementAttempts ?? 0,
    frontierInferenceCalls: procurement.frontierInferenceCalls ?? 0,
    integrationAccepted: false,
  });
}

function considerationCloseProjection(procurement) {
  return {
    type: procurement.type,
    disposition: procurement.disposition,
    compact: procurement.contract.compact,
    receipt: procurement.receipt,
    settlement: procurement.settlement.completion,
  };
}

function stableWorkLotId(input) {
  if (input.workLotId) return input.workLotId;
  const demand = Object.fromEntries(Object.entries(input).filter(([field]) => field !== "workLotId"));
  return `urn:work-lot:inference:${jsonValueId(demand).split(";")[1]}`;
}

const PENDING_PROCUREMENT_CATEGORY = "typed-inference.pending-provider-task.v1";

function durableProcurement(procurement) {
  return JSON.parse(JSON.stringify(procurement));
}

export async function createPendingInferenceProcurementCustody({ store: suppliedStore, environment = process.env } = {}) {
  const store = suppliedStore ?? await (async () => {
    const account = await settlementAccount(environment);
    return createInferenceSettlementStore({ settlementRoot: ROOT, actor: CUSTOMER, settlement: account, caip2: environment.SETTLEMENT_CAIP2 });
  })();
  return Object.freeze({
    async load({ parentTaskId, requestNi }) {
      const records = await store.records(PENDING_PROCUREMENT_CATEGORY);
      const matches = records.filter((record) => record?.type === "PendingTypedInferenceProviderTask"
        && record.version === 1 && record.parentTaskId === parentTaskId && record.requestNi === requestNi);
      const latest = matches.sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt))).at(-1)?.procurement;
      return latest?.disposition === "provider-task-pending" ? latest : null;
    },
    async record({ parentTaskId, requestNi, procurement, recordedAt = new Date().toISOString() }) {
      if (typeof parentTaskId !== "string" || parentTaskId.length === 0 || typeof requestNi !== "string" || requestNi.length === 0) throw new Error("pending procurement custody requires exact parent task and request coordinates");
      if (procurement?.type !== "TypedSenInferenceProcurement" || typeof procurement.disposition !== "string") throw new Error("pending procurement custody requires one typed procurement outcome");
      return store.record({
        category: PENDING_PROCUREMENT_CATEGORY,
        recordedAt,
        record: {
          type: "PendingTypedInferenceProviderTask",
          version: 1,
          recordedAt,
          parentTaskId,
          requestNi,
          demand: demandCommitment(procurement.demand),
          procurement: durableProcurement(procurement),
        },
      });
    },
  });
}

/**
 * Per-phase wall-clock breakdown of one dispatch, milliseconds, rounded.
 * `solicitation` covers the full `procure`/`resumeProcurement` call (A2A
 * market solicitation, selection, settlement attempt, and its own durable
 * witness-journal record); `routeDecision` and `execution` cover the direct-
 * endpoint lane's route decision and provider invocation; `assay` and
 * `receipt` cover the schema assay and consideration close on a settled A2A
 * candidate. A phase that did not run on this dispatch reads 0.
 * @typedef {{ solicitation: number, routeDecision: number, execution: number, assay: number, receipt: number, total: number }} DispatchTiming
 */

/**
 * An inference node is the shared computer platform with one contracting
 * provider. Machine-owned transports, reservations, and custody remain bound
 * here across its concurrent operations; model requests cannot replace them.
 */
export function createInferencePlatform(options = {}) {
  const configuration = Object.freeze({ ...options, environment: Object.freeze({ ...(options.environment ?? process.env) }) });
  return createComputerPlatform({
    id: "inference-platform",
    operations: [INFERENCE_WORK_OPERATION],
    providers: bindingsProviders({ "inference:procure": (input) => performInferenceDispatch(input, configuration) }),
  });
}

export async function dispatchInference(input, options = {}) {
  const platform = createInferencePlatform(options);
  try {
    const result = await platform.execute(INFERENCE_WORK_OPERATION.id, input, {
      allowedEffects: options.allowedEffects ?? INFERENCE_WORK_OPERATION.effects,
    });
    if (!result.ok) throw new TypeError(result.refusal.code === "InvalidInput"
      ? `inference work request failed schema validation: ${result.refusal.message}`
      : `${result.refusal.code}: ${result.refusal.message}`);
    return result.value;
  } finally { await platform.close(); }
}

async function performInferenceDispatch(input, {
  environment = process.env, procure = procureTypedInference, resumeProcurement = resumePendingTypedInference, pendingProcurement, captureProcurement, assay = assayTypedInferenceCandidate, close = recordAssayedInferenceConsiderationClose, registerDelivery = registerInferenceDelivery, observeRefusal = observeInferenceRefusal, signal, pricingRoot = pricingRootOf(environment), account, directDescriptors, refreshDirectDescriptors = refreshDirectEndpointProviderDescriptors, directTransport, directTools = [], directToolHandlers = {}, directMcp, resourceReservations, cashControl, zeroCashOnly } = {}) {
  const dispatchStarted = performance.now();
  const dataRoot = inferenceDataRootOf(environment);
  const providers = loadProviderAdmissions(PROVIDER_ADMISSIONS, { agentCardOverrides: providerAgentCardOverrides(environment) });
  const customerServices = loadCustomerServiceAdmissions(SERVICE_ADMISSIONS, {
    requiredRoles: ["witnessJournal"], admissionGraph: `${CUSTOMER}:service-admissions`,
    agentCardOverrides: environment.WITNESS_JOURNAL_RDF_AGENT ? { witnessJournal: environment.WITNESS_JOURNAL_RDF_AGENT } : {},
  });
  // This is node-owned configuration, never an authority a remote caller can
  // relax.  The same contract is consumed by every configured dispatch node.
  if (cashControl !== undefined) input = applyInferenceCashControl(input, cashControl);
  const admittedContext = admitCustomerContext(input);
  if (input.chatCompletion && (directMcp !== undefined || directTools.length > 0 || Object.keys(directToolHandlers).length > 0)) {
    throw new TypeError("a purchased chat turn cannot carry receiver tool execution authority");
  }
  directTransport ??= executeReceiverToolAgent;
  const receiverTools = input.chatCompletion
    ? { tools: input.chatCompletion.tools ?? [], toolHandlers: {} }
    : await resolveReceiverTools({ directTools, directToolHandlers, directMcp, signal });
  const cashEligibility = input.zeroCashOnly === true ? true : zeroCashOnly ?? input.zeroCashOnly;
  if (cashEligibility !== undefined && typeof cashEligibility !== "boolean") throw new TypeError("host cash control must be boolean");
  // A resource budget bounds execution; it is not a purchase eligibility policy.
  // Root and child work inherit the customer's admitted terms and explicit node cash control.
  input = { ...input, zeroCashOnly: cashEligibility ?? Boolean(input.agentBounds && !input.chatCompletion) };
  if (directDescriptors === undefined) {
    directDescriptors = input.zeroCashOnly
      ? await refreshDirectDescriptors(environment, { configPath: environment.DIRECT_ENDPOINT_PROVIDER_CONFIG, pricingRoot })
      : loadDirectEndpointProviderDescriptors(environment, { configPath: environment.DIRECT_ENDPOINT_PROVIDER_CONFIG, pricingRoot });
  }
  const optimizedContext = optimizeInferenceContext(input, admittedContext);
  if (optimizedContext.overflow) return ({
    outcome: "context-overflow", integrationAccepted: false,
    contextOptimization: optimizedContext.evidence,
    reason: "protected-or-exact-context-exceeds-estimated-input-budget",
  });
  // The request and direct lane receive the same compacted view. The original
  // packet remains caller-owned; archive evidence never crosses the provider boundary.
  const { contextPacket: _rawContextPacket, ...providerInput } = input;
  input = { ...providerInput, context: optimizedContext.suppliedContext };
  const bounds = input.agentBounds ?? {};
  const ceilings = input.workPlacement?.resourceCeilings ?? [];
  // Only caller-accounted limits bind; an absent limit is not replaced by a literal.
  const limits = { requests: bounds.maximumRequests, outputTokens: bounds.maximumOutputTokens };
  let resourcePolicyRefusal;
  for (const item of ceilings) {
    const key = item.asset === undefined && item.resource === "requests" && item.unit === "request" ? "requests"
      : item.asset === undefined && item.resource === "output-tokens" && item.unit === "token" ? "outputTokens" : null;
    if (key === null) {
      resourcePolicyRefusal = "resource-ceiling-unenforceable:" + [item.resource, item.asset ?? "", item.unit].join(":");
      continue;
    }
    // Floor exact fractions because these resources are consumed in whole
    // units; clamp as BigInt before conversion so large ceilings stay exact.
    const integral = BigInt(item.amount.numerator) / BigInt(item.amount.denominator);
    limits[key] = Number(limits[key] === undefined || integral < BigInt(limits[key]) ? integral : BigInt(limits[key]));
  }
  const execution = {
    env: environment,
    pricingRoot,
    zeroCashOnly: input.zeroCashOnly,
    ...(input.chatCompletion ? { interaction: "assistant-turn" } : {}),
    budget: createToolAgentBudget({
      ...(limits.requests === undefined ? {} : { maximumRequests: limits.requests }),
      ...(bounds.maximumToolCalls === undefined ? {} : { maximumToolCalls: bounds.maximumToolCalls }),
      ...(limits.outputTokens === undefined ? {} : { maximumOutputTokens: limits.outputTokens }),
    }),
    ...(bounds.maximumTokensPerRequest === undefined && limits.outputTokens === undefined ? {}
      : { maximumOutputTokens: Math.max(1, Math.min(bounds.maximumTokensPerRequest ?? Infinity, limits.outputTokens ?? Infinity)) }),
    ...(resourcePolicyRefusal === undefined ? {} : { resourcePolicyRefusal }),
    ...(bounds.maximumToolCalls === undefined ? {} : { maximumToolCalls: bounds.maximumToolCalls }),
    ...(bounds.maximumToolRounds === undefined ? {} : { maximumToolRounds: bounds.maximumToolRounds }),
    maximumDepth: bounds.maximumDepth ?? 0,
    depth: 0,
    env: environment,
    signal,
  };
  const customer = input.customer ?? CODEX_CUSTOMER;
  const excluded = new Set(input.excludeProviders ?? []);
  const admittedDirect = directDescriptors.filter(({ provider }) => !excluded.has(provider) && !excluded.has(provider.replace(/^urn:ame:/u, "")));
  // A2A offers lack measured-resource evidence, so constrained work, and bounded agent work whose
  // consumption is measured exchange by exchange, fails closed before market contact.
  // Signed offers do not declare quality tiers. A tier-constrained lot may
  // use only direct offers whose declared tiers the placement law can inspect.
  const suppliers = (resourceReservations || input.chatCompletion || input.agentBounds || input.zeroCashOnly || input.workPlacement || input.requiredQualityTiers?.length > 0 || receiverTools.tools.length > 0 ? [] : providers).filter(({ actor, id }) => !excluded.has(actor) && !excluded.has(id)).map((provider) => supplier(provider, signal));
  if (!input.zeroCashOnly && suppliers.length === 0 && admittedDirect.length === 0 && !input.agentBounds && !input.chatCompletion) throw new Error("the work lot excluded every advertised provider");
  const workType = input.workType ?? "inquiry";
  const taskClass = input.taskClass?.trim() || workType;
  const requiredCapabilities = [...new Set([
    "chat",
    ...(receiverTools.tools.length > 0 ? ["tool-calling"] : []),
    // enforceProviderSchema shapes requests to lanes that declare json-schema-output; it never
    // excludes a lane, because the customer's assay alone decides acceptance of any candidate.
    ...(input.requiredCapabilities ?? []),
  ])];
  // A restart is another attempt to settle the same demand, not a new demand.
  // Time and randomness may identify attempts/receipts but never the work lot.
  const workLot = stableWorkLotId(input);
  if (resourceReservations) execution.resourceReservations = createInferenceResourceReservations({ ...resourceReservations, reservationId: workLot });
  const considerationPolicy = input.considerationPolicy ? migrateConsiderationPolicy(input.considerationPolicy) : DEFAULT_CONSIDERATION_POLICY;
  const { rawRecall: _rawRecall, ...providerContextOptimization } = optimizedContext.evidence;
  const request = {
    workLot: { id: workLot, producer: customer },
    context: {
      objective: input.objective,
      ...admittedContext,
      suppliedContext: optimizedContext.suppliedContext,
      contextOptimization: providerContextOptimization,
      desiredUse: input.desiredUse ?? "Return one bounded inference product for routing to separately contracted casting, assay, and receiver-decision boundaries.",
      ...(input.routingProfile ? { routingProfile: input.routingProfile } : {}),
      extendedRoutingRationale: typeof input.extendedRoutingRationale === "string" ? input.extendedRoutingRationale.trim() : null,
      boundary: "This inference compact confers no receiver mutation, execution, integration, truth, or acceptance authority.",
      ...(input.energyProvenance ? { energyProvenance: input.energyProvenance } : {}),
    },
    actuatorTerms: {
      workType,
      taskClass,
      requiredCapabilities,
      ...(input.difficulty == null ? {} : { difficulty: input.difficulty }),
      considerationPolicy,
      mode: input.mode ?? "live",
      outputContract: {
        format: input.outputProjection ? "projected" : input.outputSchema ? "json" : "text",
        ...(input.outputProjection ? { projection: input.outputProjection } : {}),
        ...(!input.outputProjection && input.enforceProviderSchema === true ? { mode: "json_schema" } : {}),
        schema: input.outputSchema ?? { type: "string" },
      },
      agentCards: suppliers.map(({ actor, agentCard }) => ({ actor, url: agentCard })),
    },
  };
  const residue = {
    type: "CodexBoundedInferenceWorkResidue",
    workLot,
    reason: "no deterministic customer-local resolver covered this context-complete bounded derivation",
    customerAcceptanceRequired: true,
  };
  let procurement;
  let solicitationMs = 0;
  if (suppliers.length === 0) {
    procurement = { disposition: "no-admissible-provider-offer", market: { admitted: [], refused: [] } };
  } else {
    const caller = { actor: CUSTOMER, account: account ?? ((procure === procureTypedInference || pendingProcurement) ? await settlementAccount(environment) : null) };
    const procurementArguments = {
      residue,
      request,
      // A substitute procurement function is an in-process assay seam. It has
      // no authority to cross the market boundary, so it does not require an
      // RPC-backed account lookup. The real procurement path always resolves
      // its account from the live chain immediately before the boundary call.
      caller,
      customerServices,
      settlementRoot: ROOT,
      dataRoot,
      signal,
    };
    const solicitationStarted = performance.now();
    procurement = pendingProcurement
      ? await resumeProcurement({ procurement: pendingProcurement, ...procurementArguments })
      : await procure({ ...procurementArguments, suppliers, ...(pricingRoot ? { pricingRoot } : {}) });
    solicitationMs = performance.now() - solicitationStarted;
    await captureProcurement?.(procurement);
  }
  if (procurement.disposition !== "candidate-pending-customer-assay") {
    const selectedProvider = procurement.selection?.disposition === "provider-selected"
      ? procurement.selection.selected?.provider?.actor
      : null;
    if (pricingRoot && procurement.disposition === "provider-refusal" && selectedProvider) {
      const selectedOffer = procurement.selection.selected?.offer?.id;
      const refusal = procurement.settlementResidues?.find((item) => item.provider === selectedProvider && item.offer === selectedOffer) ?? procurement.settlementResidues?.[0];
      await observeRefusal(pricingRoot, {
        workLot, provider: selectedProvider, taskClass, selectedOffer,
        configurationIdentity: executionConfigurationIdentity(a2aExecutionConfiguration({ provider: selectedProvider, offer: procurement.selection.selected.offer })),
        disposition: refusal?.disposition ?? "provider-refusal",
        refusalReceipt: refusal?.receipt,
        providerRefusalWitness: refusal?.providerRefusalWitness,
      });
    }
    let direct, reservationReceipts;
    try {
      direct = await attemptDirectEndpointLane({ input, workLot, taskClass, customer, descriptors: admittedDirect, invoke: directTransport, tools: receiverTools.tools, toolHandlers: receiverTools.toolHandlers, execution, pricingRoot, registerDelivery });
    } finally {
      reservationReceipts = await execution.resourceReservations?.finish();
    }
    /** @type {DispatchTiming} */
    const timing = Object.freeze({
      solicitation: Math.round(solicitationMs),
      routeDecision: Math.round(direct.timing?.routeDecisionMs ?? 0),
      execution: Math.round(direct.timing?.executionMs ?? 0),
      assay: 0,
      receipt: 0,
      total: Math.round(performance.now() - dispatchStarted),
    });
    if (direct.delivered) return ({ ...direct.delivered, contextOptimization: optimizedContext.evidence, ...(reservationReceipts ? { providerEvidence: { ...direct.delivered.providerEvidence, resourceReservations: reservationReceipts } } : {}), timing });
    const residueResult = { ...marketResidue(procurement, { workLot, taskClass, receiver: customer }),
      contextOptimization: optimizedContext.evidence, ...(reservationReceipts ? { providerEvidence: { resourceReservations: reservationReceipts } } : {}) };
    return direct.refusals.length === 0
      ? ({ ...residueResult, timing })
      : ({ ...residueResult, timing, directLaneRefusals: direct.refusals });
  }
  const assayStarted = performance.now();
  const schemaAssay = await assay(procurement, { customer: CUSTOMER, customerServices, settlementRoot: ROOT, dataRoot });
  const assayMs = performance.now() - assayStarted;
  const receiptStarted = performance.now();
  const considerationClose = await close(considerationCloseProjection(procurement), schemaAssay, { customerServices, settlementRoot: ROOT, dataRoot, at: schemaAssay.assayedAt ?? new Date().toISOString() });
  const receiptMs = performance.now() - receiptStarted;
  /** @type {DispatchTiming} */
  const timing = Object.freeze({
    solicitation: Math.round(solicitationMs),
    routeDecision: 0,
    execution: 0,
    assay: Math.round(assayMs),
    receipt: Math.round(receiptMs),
    total: Math.round(performance.now() - dispatchStarted),
  });
  if (!schemaAssay.accepted) return ({
    outcome: "candidate-refused-by-schema-assay",
    provider: procurement.selection.selected.provider.actor,
    problems: schemaAssay.problems,
    schemaAssay: schemaAssay.id,
    considerationClose: considerationClose.id,
    considerationDisposition: considerationClose.disposition,
    marketRound: procurement.marketRound ?? null,
    routeDecision: procurement.routeDecision ?? null,
    marketWitnesses: (procurement.marketWitnesses ?? []).map(({ id }) => id),
    providerSettlementAttempts: procurement.providerSettlementAttempts ?? 1,
    frontierInferenceCalls: procurement.frontierInferenceCalls ?? 1,
    integrationAccepted: false,
    timing,
  });
  const selected = procurement.selection.selected;
  const receiver = customer;
  const configuration = a2aExecutionConfiguration({ provider: selected.provider.actor, offer: selected.offer });
  const configurationIdentity = executionConfigurationIdentity(configuration);
  if (pricingRoot) await registerDelivery(pricingRoot, { workLot, ...(input.order === undefined ? {} : { order: input.order }), provider: selected.provider.actor, taskClass, selectedOffer: selected.offer.id, receipt: procurement.receipt.id, receiver, configurationIdentity, configuration });
  return admitInferenceWorkResult({
    outcome: "candidate-pending-customer-acceptance",
    workLot,
    taskClass,
    receiver,
    provider: selected.provider.actor,
    selectedOffer: selected.offer.id,
    model: selected.offer.object.model,
    configurationIdentity,
    configuration,
    consideration: procurement.selection.selectedConsideration,
    // The computed expected price sits beside the declared price it was ranked
    // against; absent when the market ran on plain declared-amount Pareto
    // dominance (no pricingRoot), never fabricated to fill the field.
    expectedResolutionPrice: procurement.selection.selectedExpectedResolutionPrice ?? null,
    considerationClose: considerationClose.id,
    considerationDisposition: considerationClose.disposition,
    compact: procurement.contract.compact,
    receipt: procurement.receipt,
    selectionRule: procurement.selection.selectionRule,
    rankedFeasibleOffers: procurement.selection.ranked.map(({ provider, offer, consideration, expectedResolutionPrice }) => ({ provider: provider.actor, model: offer.object.model, consideration, ...(expectedResolutionPrice ? { expectedResolutionPrice } : {}) })),
    marketRound: procurement.marketRound ?? null,
    routeDecision: procurement.routeDecision ?? null,
    marketWitnesses: (procurement.marketWitnesses ?? []).map(({ id }) => id),
    providerSettlementAttempts: procurement.providerSettlementAttempts ?? 1,
    frontierInferenceCalls: procurement.frontierInferenceCalls ?? 1,
    candidate: schemaAssay.candidateValue,
    evidence: {
      demand: procurement.demand.type,
      selectedOffer: selected.offer.id,
      compact: procurement.contract.compact.id,
      providerProposal: procurement.contract.proposal.term,
      settlement: procurement.settlement.completion,
      receipt: procurement.receipt.id,
      schemaAssay: schemaAssay.id,
      considerationClose: considerationClose.id,
      ...(input.contextPacket ? { contextPacket: input.contextPacket.id, contextKnowledge: input.contextPacket.knowledge } : {}),
    },
    integrationAccepted: false,
    acceptanceScope: "delivery-to-customer-office-only",
    receiverAcceptanceRequired: true,
    nextAct: "Route the product to executable behavioral assay and the receiving settlement's authorized induction decision boundary; provider identity is provenance, not proof.",
    timing,
    contextOptimization: optimizedContext.evidence,
  });
}

export async function recordInferenceOutcome(input, { observe = observeInferenceOutcome, voidOutcome = voidInferenceOutcome, environment = process.env, pricingRoot = pricingRootOf(environment) } = {}) {
  if (!pricingRoot) throw new Error("EXPECTED_RESOLUTION_PRICING_ROOT must name the directory of pricing observations");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("one receiver outcome is required");
  for (const field of ["workLot", "provider", "taskClass", "selectedOffer", "receipt", "receiver", "evidence"]) if (typeof input[field] !== "string" || input[field].trim() === "") throw new Error(`${field} must be nonempty text`);
  if (!["accepted", "refused", "voided"].includes(input.outcome)) throw new Error("outcome must be accepted, refused, or voided");
  if (input.outcome === "voided") {
    const observation = await voidOutcome(pricingRoot, input);
    return Object.freeze({ outcome: "receiver-outcome-voided", observation, providerSelectionMayChange: true });
  }
  const observation = await observe(pricingRoot, {
    workLot: input.workLot, provider: input.provider, taskClass: input.taskClass, selectedOffer: input.selectedOffer,
    receipt: input.receipt, receiver: input.receiver, outcome: input.outcome, evidence: input.evidence,
    ...(input.configurationIdentity ? { configurationIdentity: input.configurationIdentity } : {}),
    ...(Number.isSafeInteger(input.durationMs) && input.durationMs >= 0 ? { durationMs: input.durationMs } : {}),
    ...(input.resources === undefined ? {} : { resources: input.resources }),
  });
  return Object.freeze({ outcome: "receiver-outcome-recorded", observation, providerSelectionMayChange: true });
}

/**
 * Dispatch inference as one admitted customer actor -- a thin label-only
 * wrapper over dispatchInference, never a second implementation.
 * @param {object} input
 * @param {{ customerActor?: string, [key: string]: unknown }} [options]
 * @returns {Promise<object>} the actor-tagged inference work result
 */
export async function dispatchInferenceAsConfiguredCustomer(input, { customerActor = INFERENCE_WORK_CUSTOMER, ...options } = {}) {
  if (input && typeof input === "object" && !Array.isArray(input) && input.customer !== undefined && input.customer !== customerActor) {
    throw new Error(`this inference dispatch surface transacts only as ${customerActor}; ${input.customer} must be dispatched through its own configured surface`);
  }
  const result = await dispatchInference({ ...input, customer: input?.customer ?? customerActor }, options);
  if (result.outcome !== "candidate-pending-customer-acceptance") return result;
  const token = configuredCustomerToken(customerActor, ACTOR_TOKENS);
  if (!token) return result;
  const displayName = token.charAt(0).toUpperCase() + token.slice(1);
  return admitInferenceWorkResult({
    ...result,
    outcome: outcomeSentinelForCustomer(customerActor, ACTOR_TOKENS),
    acceptanceScope: `delivery-to-${token}-customer-office-only`,
    receiverAcceptanceRequired: true,
    nextAct: `${displayName} may decide its own routine purchase and delivery outcome after an executable assay without Leader approval; only a later effect on another Actor crosses into that Actor's induction boundary.`,
  });
}
