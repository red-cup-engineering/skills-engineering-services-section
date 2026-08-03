import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverValidatedAgentCard } from "@red-cup-engineering/a2a-rmn-task-client-service";
import { assayTypedInferenceCandidate } from "./customer-assay-typed-inference.mjs";
import { demandCommitment, procureTypedInference } from "./typed-rmn-inference-procurement.mjs";
import { loadCustomerAdmissions, loadCustomerServiceAdmissions, loadProviderAdmissions, standingOfferFromAgentCard } from "./provider-admission.mjs";
import { considerationPolicyIsSubpolicy, migrateConsiderationPolicy, resolutionCreditPolicy, validateConsiderationPolicy } from "./consideration.mjs";
import { recordAssayedInferenceConsiderationClose } from "./consideration-close.mjs";
import { observeInferenceOutcome, observeInferenceRefusal, registerInferenceDelivery } from "./expected-resolution-pricing-client.mjs";
import { BOUNDED_CODEX_ROUTING_PROFILE, classifyCodexDemand } from "./codex-demand-classification.mjs";
import { jsonValueId } from "./modern-rmn-carrier.mjs";
import { canonicalJson, formContextPacket } from "./context-packet.mjs";
import { admitInferenceContext } from "./context-packet-demand.mjs";
import { admitInferenceWorkRefusal, admitInferenceWorkRequest, admitInferenceWorkResult } from "./inference-work-carriers.mjs";
import { resolveLocalSettlementAccount } from "./witness-journal-settlement-store.mjs";

export { BOUNDED_CODEX_ROUTING_PROFILE, classifyCodexDemand } from "./codex-demand-classification.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DATA_ROOT = resolve(process.env.INFERENCE_WORK_LOT_DATA_ROOT ?? resolve(ROOT, "data"));
const CUSTOMER = "urn:ame:inference-work-lot-service";
export const CODEX_CUSTOMER = "urn:ame:bare-cedar-fog-codex";

async function settlementAccount() {
  return resolveLocalSettlementAccount(ROOT, { actor: CUSTOMER, caip2: process.env.SETTLEMENT_CAIP2 }).settlement;
}
const PROVIDER_ADMISSIONS = resolve(ROOT, "content/provider-admissions/codex-inference-providers.json");
const SERVICE_ADMISSIONS = resolve(ROOT, "content/provider-admissions/semantic-services.json");
const CUSTOMER_ADMISSIONS = resolve(ROOT, "content/customer-admissions/admitted-customers.json");
export const ADMITTED_CUSTOMERS = loadCustomerAdmissions(CUSTOMER_ADMISSIONS, { market: "urn:ame:inference-work-lot-service" });

export const DEFAULT_CODEX_CONSIDERATION_POLICY = resolutionCreditPolicy();
// Routing profiles describe demand for market observation. They do not impose
// a customer-global capacity ceiling: admitted provider offers determine
// whether the requested finite lot is feasible.

export const CODEX_INFERENCE_PROVIDERS = loadProviderAdmissions(PROVIDER_ADMISSIONS);
export const CODEX_CUSTOMER_SERVICES = loadCustomerServiceAdmissions(SERVICE_ADMISSIONS, {
  admissionGraph: `${CUSTOMER}:service-admissions`,
  agentCardOverrides: {
    ...(process.env.RMN_CONFORMANCE_AGENT ? { rmn: process.env.RMN_CONFORMANCE_AGENT } : {}),
    ...(process.env.WITNESS_JOURNAL_RDF_AGENT ? { witnessJournal: process.env.WITNESS_JOURNAL_RDF_AGENT } : {}),
  },
});

function supplier(provider, signal) {
  return Object.freeze({
    actor: provider.actor,
    id: provider.id,
    agentCard: provider.agentCard,
    async exchange(activity) {
      const card = await discoverValidatedAgentCard(provider.agentCard, { requireSignature: true, signal });
      return standingOfferFromAgentCard(provider, card, activity, activity.object, demandCommitment);
    },
  });
}

function validateInput(input) {
  admitInferenceWorkRequest(input);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("one inference work-lot object is required");
  if (input.customer !== undefined && !ADMITTED_CUSTOMERS.has(input.customer)) throw new Error(`inference work lots admit only customers on the addressed admission carrier; ${input.customer} is not admitted`);
  if (typeof input.objective !== "string" || input.objective.trim().length === 0) throw new Error("objective must contain text");
  const admittedContext = admitInferenceContext(input, { formContextPacket, canonicalJson });
  if (input.outputSchema !== undefined && (typeof input.outputSchema !== "object" || Array.isArray(input.outputSchema))) throw new Error("outputSchema must be an object when supplied");
  if (input.outputProjection !== undefined) {
    const projection = input.outputProjection;
    const sourceProjection = ["single-file-create", "single-source-artifact"].includes(projection?.type)
      && typeof projection.path === "string" && projection.path.length > 0;
    const toolProjection = projection?.type === "fenced-json-tool-call";
    if (!sourceProjection && !toolProjection) throw new Error("outputProjection must name one supported deterministic customer projection");
  }
  if (input.difficulty != null && (!Number.isFinite(input.difficulty) || input.difficulty < 0 || input.difficulty > 1)) throw new Error("difficulty must be between 0 and 1 when the customer supplies one");
  if (input.taskClass != null && (typeof input.taskClass !== "string" || input.taskClass.trim().length === 0)) throw new Error("taskClass must contain text when supplied");
  if (input.maxTokens !== undefined) throw new Error("maxTokens is retired; suppliers advertise capacity and may refuse lots they cannot economically complete");
  if (input.routingProfile !== undefined && !["bounded", "extended"].includes(input.routingProfile)) throw new Error("routingProfile must be bounded or extended when supplied");
  if (input.extendedRoutingRationale !== undefined && (typeof input.extendedRoutingRationale !== "string" || input.extendedRoutingRationale.trim().length === 0)) {
    throw new Error("extendedRoutingRationale, when supplied, must contain text");
  }
  if (input.considerationPolicy !== undefined) {
    const policy = migrateConsiderationPolicy(input.considerationPolicy);
    validateConsiderationPolicy(policy);
    if (!considerationPolicyIsSubpolicy(policy, DEFAULT_CODEX_CONSIDERATION_POLICY)) throw new Error("Codex consideration must use an admitted direct-witness relative-resolution credit settlement capability");
  }
  return admittedContext;
}

function marketResidue(procurement) {
  const selected = procurement.selection?.disposition === "provider-selected"
    ? procurement.selection.selected
    : null;
  return admitInferenceWorkRefusal({
    outcome: "market-residue",
    disposition: procurement.disposition,
    provider: selected?.provider?.actor ?? null,
    selectedOffer: selected?.offer?.id ?? null,
    selectionRule: procurement.selection?.selectionRule ?? null,
    rankedFeasibleOffers: (procurement.selection?.ranked ?? []).map(({ provider, offer, consideration }) => ({
      provider: provider.actor,
      offer: offer.id,
      model: offer.object.model,
      consideration,
    })),
    refusedOffers: procurement.market?.refused ?? [],
    admittedOffers: (procurement.market?.admitted ?? []).map(({ provider, offer }) => ({
      provider: provider.actor,
      considerationAlternatives: offer.object.considerationAlternatives,
      model: offer.object.model,
    })),
    settlementResidues: procurement.settlementResidues ?? [],
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

export async function contractInferenceWork(input, { procure = procureTypedInference, assay = assayTypedInferenceCandidate, close = recordAssayedInferenceConsiderationClose, registerDelivery = registerInferenceDelivery, observeRefusal = observeInferenceRefusal, signal, pricingService = process.env.EXPECTED_RESOLUTION_PRICE_URL, account } = {}) {
  const admittedContext = validateInput(input);
  const customer = input.customer ?? CODEX_CUSTOMER;
  const excluded = new Set(input.excludeProviders ?? []);
  const suppliers = CODEX_INFERENCE_PROVIDERS.filter(({ actor, id }) => !excluded.has(actor) && !excluded.has(id)).map((provider) => supplier(provider, signal));
  if (suppliers.length === 0) throw new Error("the work lot excluded every advertised provider");
  const workType = input.workType ?? "inquiry";
  const taskClass = input.taskClass?.trim() || workType;
  const requiredCapabilities = [...new Set([
    workType,
    ...(input.enforceProviderSchema === true ? ["json-schema-output"] : []),
    ...(input.requiredCapabilities ?? []),
  ])];
  // A restart is another attempt to settle the same demand, not a new demand.
  // Time and randomness may identify attempts/receipts but never the work lot.
  const workLot = stableWorkLotId(input);
  const considerationPolicy = input.considerationPolicy ? migrateConsiderationPolicy(input.considerationPolicy) : DEFAULT_CODEX_CONSIDERATION_POLICY;
  const request = {
    workLot: { id: workLot, producer: customer },
    context: {
      objective: input.objective,
      ...admittedContext,
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
  const procurement = await procure({
    residue,
    request,
    suppliers,
    // A substitute procurement function is an in-process assay seam. It has
    // no authority to cross the market boundary, so it does not require an
    // RPC-backed account lookup. The real procurement path always resolves
    // its account from the live chain immediately before the boundary call.
    caller: { actor: CUSTOMER, account: account ?? (procure === procureTypedInference ? await settlementAccount() : null) },
    customerServices: CODEX_CUSTOMER_SERVICES,
    settlementRoot: ROOT,
    dataRoot: DATA_ROOT,
    signal,
    ...(pricingService ? { pricingService } : {}),
  });
  if (procurement.disposition !== "candidate-pending-customer-assay") {
    const selectedProvider = procurement.selection?.disposition === "provider-selected"
      ? procurement.selection.selected?.provider?.actor
      : null;
    if (pricingService && procurement.disposition === "selected-provider-refused" && selectedProvider) {
      const selectedOffer = procurement.selection.selected?.offer?.id;
      const refusal = procurement.settlementResidues?.find((item) => item.provider === selectedProvider && item.offer === selectedOffer) ?? procurement.settlementResidues?.[0];
      await observeRefusal(pricingService, {
        workLot, provider: selectedProvider, taskClass, selectedOffer,
        disposition: refusal?.disposition ?? "provider-refusal",
        evidence: jsonValueId({ workLot, selectedProvider, selectedOffer, refusal }),
      });
    }
    return marketResidue(procurement);
  }
  const schemaAssay = await assay(procurement, { customer: CUSTOMER, customerServices: CODEX_CUSTOMER_SERVICES, settlementRoot: ROOT, dataRoot: DATA_ROOT });
  const considerationClose = await close(considerationCloseProjection(procurement), schemaAssay, { customerServices: CODEX_CUSTOMER_SERVICES, settlementRoot: ROOT, dataRoot: DATA_ROOT, at: schemaAssay.assayedAt ?? new Date().toISOString() });
  if (!schemaAssay.accepted) return admitInferenceWorkRefusal({
    outcome: "candidate-refused-by-schema-assay",
    provider: procurement.selection.selected.provider.actor,
    problems: schemaAssay.problems,
    schemaAssay: schemaAssay.id,
    considerationClose: considerationClose.id,
    considerationDisposition: considerationClose.disposition,
    integrationAccepted: false,
  });
  const selected = procurement.selection.selected;
  const receiver = customer;
  if (pricingService) await registerDelivery(pricingService, { workLot, provider: selected.provider.actor, taskClass, selectedOffer: selected.offer.id, receipt: procurement.receipt.id, receiver });
  return admitInferenceWorkResult({
    outcome: "candidate-pending-customer-acceptance",
    workLot,
    provider: selected.provider.actor,
    model: selected.offer.object.model,
    consideration: procurement.selection.selectedConsideration,
    considerationClose: considerationClose.id,
    considerationDisposition: considerationClose.disposition,
    compact: procurement.contract.compact,
    receipt: procurement.receipt,
    selectionRule: procurement.selection.selectionRule,
    rankedFeasibleOffers: procurement.selection.ranked.map(({ provider, offer, consideration }) => ({ provider: provider.actor, model: offer.object.model, consideration })),
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
  });
}

export async function recordCodexInferenceOutcome(input, { observe = observeInferenceOutcome, pricingService = process.env.EXPECTED_RESOLUTION_PRICE_URL } = {}) {
  if (!pricingService) throw new Error("EXPECTED_RESOLUTION_PRICE_URL must name the hired pricing observer");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("one receiver outcome is required");
  for (const field of ["workLot", "provider", "taskClass", "selectedOffer", "receipt", "receiver", "evidence"]) if (typeof input[field] !== "string" || input[field].trim() === "") throw new Error(`${field} must be nonempty text`);
  if (!["accepted", "refused"].includes(input.outcome)) throw new Error("outcome must be accepted or refused");
  const observation = await observe(pricingService, {
    workLot: input.workLot, provider: input.provider, taskClass: input.taskClass, selectedOffer: input.selectedOffer,
    receipt: input.receipt, receiver: input.receiver, outcome: input.outcome, evidence: input.evidence,
  });
  return Object.freeze({ outcome: "receiver-outcome-recorded", observation, providerSelectionMayChange: true });
}

export async function contractCodexInferenceWork(input, options = {}) {
  const result = await contractInferenceWork(input, options);
  if (result.outcome !== "candidate-pending-customer-acceptance") return result;
  return admitInferenceWorkResult({
    ...result,
    outcome: "candidate-pending-codex-acceptance",
    acceptanceScope: "delivery-to-codex-customer-office-only",
    receiverAcceptanceRequired: true,
    nextAct: "Codex may decide its own routine purchase and delivery outcome after an executable assay without Leader approval; only a later effect on another Actor crosses into that Actor's induction boundary.",
  });
}
