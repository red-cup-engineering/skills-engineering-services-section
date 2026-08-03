import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { A2aTaskPendingError, a2aResultMetadata, a2aResultParts, sendRmnTask } from "@red-cup-engineering/a2a-rmn-task-client-service";
import { conformTerm as requestConformance } from "./rmn-conformance-client.mjs";
import { jsonValueId, rmnCarrierId } from "./modern-rmn-carrier.mjs";
import { SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION } from "./sovereign-provider-interface.mjs";
import { createInferenceSettlementStore } from "./witness-journal-settlement-store.mjs";
import { INFERENCE_MARKET_OFFER_EXTENSION } from "./provider-admission.mjs";
import { chooseConsideration, createExchangeCompact, createExchangeReceipt, migrateConsiderationAlternative, migrateConsiderationPolicy, validateConsiderationAlternative, validateConsiderationPolicy } from "./consideration.mjs";
import { rankInferenceCandidates } from "./expected-resolution-pricing-client.mjs";
import { textNi } from "./rmn-effect-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CHILD_OPERATION_TYPE = ["prod", ["base"], ["prod", ["base"], ["prod", ["base"], ["base"]]]];
const CONTEXT = "https://www.w3.org/ns/activitystreams";
const ACTOR = "urn:ame:inference-work-lot-service";
const ROOT = resolve(HERE, "..");
const ni = jsonValueId;
export const demandCommitment = ni;
const caip10 = (value) => /^eip155:[1-9][0-9]*:0x[0-9a-fA-F]{40}$/u.test(value ?? "");
function pendingDependency(error) {
  let current = error;
  while (current) {
    if (current.name === "A2aTaskPendingError" && typeof current.taskId === "string") {
      return Object.freeze({ agentUrl: current.agentUrl, taskId: current.taskId, task: current.task });
    }
    current = current.cause;
  }
  return null;
}

export function typedInferenceDemand(residue, request) {
  const terms = request?.actuatorTerms;
  if (!terms || typeof terms.workType !== "string" || !Array.isArray(terms.requiredCapabilities) || (terms.difficulty != null && !Number.isFinite(terms.difficulty))) throw new Error("typed inference residue requires typed actuatorTerms");
  if (terms.maxTokens != null) throw new Error("customer-authored maxTokens is retired; providers advertise output capacity and customers buy a suitable offer");
  const considerationPolicy = migrateConsiderationPolicy(terms.considerationPolicy);
  validateConsiderationPolicy(considerationPolicy);
  const context = { workLot: request.workLot, context: request.context, residue };
  const source = typeof request.context?.suppliedContext === "string" ? request.context.suppliedContext : JSON.stringify(request.context ?? {});
  const sourceMeasures = Object.freeze({ words: source.trim() === "" ? 0 : source.trim().split(/\s+/u).length, characters: source.length });
  const executionBounds = Object.freeze({ sourceMeasures });
  const projection = terms.outputContract?.projection;
  const instruction = ["single-file-create", "single-source-artifact"].includes(projection?.type)
    ? `Return the complete source bytes for the single declared file ${projection.path}. Do not return JSON. Reason as needed, then conclude with exactly one fenced source block; the customer deterministically extracts that block, constructs the declared typed carrier for the fixed path, and performs the authoritative schema assay. Do not claim customer acceptance, execution, or truth.`
    : projection?.type === "fenced-json-tool-call"
      ? "Reason as needed, then conclude with exactly one fenced JSON object matching the customer-declared tool-call schema. Do not include any other fenced blocks. The customer deterministically extracts that one block and performs the authoritative schema assay; do not claim customer acceptance, execution, or truth."
      : "Return the requested reasoning product in your natural text carrier. Do not serialize it as JSON. The customer deterministically projects the response into its typed carrier and performs the authoritative assay; do not claim customer acceptance, execution, or truth.";
  const input = JSON.stringify({ ...context, workType: terms.workType, taskClass: terms.taskClass ?? terms.workType, executionBounds, outputContract: terms.outputContract });
  const requestMeasures = Object.freeze({ characters: instruction.length + input.length });
  return Object.freeze({
    type: "TypedRmnInferenceDemand", workType: terms.workType, taskClass: terms.taskClass ?? terms.workType,
    requiredCapabilities: [...terms.requiredCapabilities], ...(terms.difficulty == null ? {} : { difficulty: terms.difficulty }),
    maximumOutputTokens: null, outputCompletion: "complete-declared-artifact", mode: terms.mode ?? "live",
    sourceMeasures, requestMeasures, considerationPolicy,
    instruction, input,
    outputContract: terms.outputContract,
    agentCards: Object.fromEntries((terms.agentCards ?? []).map(({ actor, url }) => [actor, url]))
  });
}

function solicitation(provider, demand) {
  const core = { type: "Offer", actor: ACTOR, target: provider.actor, object: demand };
  return { "@context": CONTEXT, id: ni(core), ...core };
}
function validateOffer(provider, source, offer, demand) {
  const object = offer?.object;
  if (offer?.["@context"] !== CONTEXT || offer.type !== "Offer" || offer.actor !== provider.actor || offer.target !== ACTOR || offer.inReplyTo !== source.id || object?.type !== "TypedRmnInferenceServiceOffer") return "not-an-exact-provider-authored-offer";
  if (!caip10(object.providerAccount) || !/^ni:\/\/\/sha-256;/u.test(object.contract ?? "") || typeof object.agentCard !== "string" || !/^https?:\/\//u.test(object.agentCard)) return "provider-boundary-fields-invalid";
  if (object.requestCommitment !== ni(demand)) return "request-commitment-drift";
  if (rmnCarrierId(object.operationType) !== rmnCarrierId(CHILD_OPERATION_TYPE)) return "operation-type-incompatible";
  if (!Array.isArray(object.capabilities) || demand.requiredCapabilities.some((capability) => !object.capabilities.includes(capability))) return "missing-required-capability";
  if (!Array.isArray(object.workTypes) || !object.workTypes.includes(demand.workType)) return "unsupported-work-type";
  if (!Number.isSafeInteger(object.maximumOutputTokens) || object.maximumOutputTokens < 1) return "provider-output-capacity-invalid";
  if ((demand.difficulty != null && object.maximumDifficulty < demand.difficulty) || (demand.maximumOutputTokens != null && object.maximumOutputTokens < demand.maximumOutputTokens) || object.maximumSourceWords < demand.sourceMeasures.words || object.maximumSourceCharacters < demand.sourceMeasures.characters || object.maximumRequestCharacters < demand.requestMeasures.characters) return "demand-exceeds-provider-bound";
  if (!Array.isArray(object.considerationAlternatives) || object.considerationAlternatives.length === 0) return "consideration-invalid";
  try { object.considerationAlternatives.forEach(validateConsiderationAlternative); }
  catch { return "consideration-invalid"; }
  if (!Number.isSafeInteger(object.maximumConcurrentLots) || object.maximumConcurrentLots < 1) return "provider-capacity-invalid";
  if (object.customerAcceptanceRequired !== true || object.availability !== "accepted-task-must-still-settle") return "offer-conflates-quote-with-outcome";
  return null;
}

export async function solicitTypedInferenceOffers(demand, suppliers) {
  const admitted = [], refused = [];
  await Promise.all(suppliers.map(async (provider) => {
    const source = solicitation(provider, demand);
    let offer;
    try { offer = await provider.exchange(source); }
    catch (error) { refused.push({ actor: provider.actor, reason: `solicitation-refused:${error.message}` }); return; }
    if (offer?.type === "Reject") { refused.push({ actor: provider.actor, reason: offer.object?.reason ?? "provider-refused" }); return; }
    if (Array.isArray(offer?.object?.considerationAlternatives)) {
      offer = { ...offer, object: { ...offer.object, considerationAlternatives: offer.object.considerationAlternatives.map(migrateConsiderationAlternative) } };
    }
    const problem = validateOffer(provider, source, offer, demand);
    if (problem) refused.push({ actor: provider.actor, reason: problem }); else admitted.push({ provider, solicitation: source, offer });
  }));
  admitted.sort((left, right) => left.offer.id.localeCompare(right.offer.id));
  refused.sort((left, right) => left.actor.localeCompare(right.actor));
  return Object.freeze({ admitted, refused });
}

export function selectTypedInferenceOffer(market, considerationPolicy) {
  if (!market?.admitted?.length) return Object.freeze({ disposition: "no-admissible-provider-offer", market });
  const choice = chooseConsideration(market.admitted, migrateConsiderationPolicy(considerationPolicy));
  if (choice.disposition !== "consideration-selected") return Object.freeze({ ...choice, market });
  return Object.freeze({
    disposition: "provider-selected",
    selected: choice.selected.entry,
    selectedConsideration: choice.selected.consideration,
    ranked: choice.ranked.map(({ entry, consideration }) => ({ ...entry, consideration })),
    considerationRefusals: choice.refused,
    market,
    selectionRule: "customer-authored-alternative-order-then-pareto-dominance-without-cross-asset-conversion",
  });
}

export async function selectTypedInferenceOfferByExpectedResolution(market, considerationPolicy, { endpoint, taskClass }) {
  if (!market?.admitted?.length) return Object.freeze({ disposition: "no-admissible-provider-offer", market });
  const choice = chooseConsideration(market.admitted, migrateConsiderationPolicy(considerationPolicy));
  if (choice.disposition !== "consideration-selected") return Object.freeze({ ...choice, market });
  const ranked = await rankInferenceCandidates(endpoint, taskClass, choice.ranked);
  const selected = ranked[0];
  return Object.freeze({
    disposition: "provider-selected",
    selected: selected.entry,
    selectedConsideration: selected.consideration,
    ranked: ranked.map(({ entry, consideration, expectedResolutionPrice }) => ({ ...entry, consideration, expectedResolutionPrice })),
    considerationRefusals: choice.refused,
    market,
    selectionRule: "contracted-expected-consideration-per-verified-result-without-cross-asset-conversion",
  });
}

function effect({ law, caller, provider, operation, precondition, postcondition, refusal, evidenceRoot, measures, parent = null }) {
  return { law, caller, provider, operation, precondition, postcondition, refusal, evidenceRoot, outcome: { positiveEvidence: false, negativeEvidence: false }, measures, parent };
}

function admittedService(customerServices, role, { endpoint = false } = {}) {
  const admission = customerServices?.[role];
  if (!admission?.actor || (endpoint && typeof admission.agentCard !== "string")) throw new Error(`customer must admit exactly one contracted ${role} service`);
  return admission;
}

async function conformCustomerTerm(customerServices, term, expectedType, conform = requestConformance) {
  const admission = admittedService(customerServices, "rmn", { endpoint: true });
  let result;
  try {
    result = await conform({ agentUrl: admission.agentCard, term, expectedType });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`customer RMN service ${admission.actor} at ${admission.agentCard} failed: ${reason}`, { cause: error });
  }
  return Object.freeze({ term: result.term, canonicalBytesBase64: result.canonicalBytesBase64, conformance: result.exchange.outputNi, provider: admission.actor });
}

export async function compileSelectedInferenceContract(selection, demand, caller, customerServices, now = new Date().toISOString(), { conform } = {}) {
  if (selection?.disposition !== "provider-selected") throw new Error("one selected provider offer is required");
  if (!caller?.actor || !caip10(caller.account)) throw new Error("customer actor and sovereign CAIP-10 account are required");
  const terms = selection.selected.offer.object;
  const compact = createExchangeCompact({
    demand: demandCommitment(demand),
    offer: selection.selected.offer.id,
    customer: caller,
    provider: { actor: selection.selected.provider.actor, account: terms.providerAccount },
    consideration: selection.selectedConsideration,
    createdAt: now,
  });
  let selectedInput;
  try { selectedInput = JSON.parse(demand.input); }
  catch { selectedInput = { suppliedInput: demand.input, executionBounds: { sourceMeasures: demand.sourceMeasures } }; }
  selectedInput.executionBounds = {
    ...selectedInput.executionBounds,
    maximumOutputTokens: demand.maximumOutputTokens ?? terms.maximumOutputTokens,
    outputBoundSource: demand.maximumOutputTokens == null ? "selected-provider-offer" : "customer-limit",
  };
  const operation = ["pair", ["mark", demand.instruction], ["pair", ["mark", JSON.stringify(selectedInput)], ["pair", ["mark", terms.model], ["mark", terms.mode]]]];
  const operationReceipt = await conformCustomerTerm(customerServices, operation, CHILD_OPERATION_TYPE, conform);
  const measures = compact.consideration.obligations.map((obligation) => ({
    dimension: obligation.asset,
    quantity: obligation.amount.numerator,
    unit: `${obligation.kind}:${obligation.unit};exact-denominator=${obligation.amount.denominator}`,
  }));
  const proposalCell = effect({ law: terms.contract, caller: caller.account, provider: terms.providerAccount, operation: operationReceipt.term, precondition: compact.id, postcondition: textNi("WitnessedInferenceCandidate"), refusal: textNi("WitnessedInferenceRefusal"), evidenceRoot: textNi("FOUR-bottom"), measures });
  const proposal = await conformCustomerTerm(customerServices, ["pair", ["mark", JSON.stringify(proposalCell)], operation], ["prod", ["base"], CHILD_OPERATION_TYPE], conform);
  const message = {
    messageId: randomUUID(), role: "ROLE_USER",
    parts: [{ raw: proposal.canonicalBytesBase64, metadata: { ni: proposal.term }, filename: "proposal.rmn.cbor", mediaType: "application/rmn+cbor" }],
    metadata: { lawNi: terms.contract, callerAccount: caller.account, providerAccount: terms.providerAccount, selectedOffer: selection.selected.offer.id, compact: compact.id },
  };
  return Object.freeze({ message, proposal, operation: operationReceipt, selectedOffer: selection.selected.offer, compact, demand, frontierInferenceCalls: 0 });
}

const resultParts = a2aResultParts;

async function defaultProviderInvoke(message, agentUrl, signal) {
  if (typeof agentUrl !== "string" || !/^https?:\/\//u.test(agentUrl)) throw new Error("the selected provider's A2A Agent Card URL is required");
  const providerExecutionSignal = signal ?? new AbortController().signal;
  let exchange;
  try {
    exchange = await sendRmnTask({
      agentUrl,
      extensions: [SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, INFERENCE_MARKET_OFFER_EXTENSION],
      requireSignature: true,
      message,
      signal: providerExecutionSignal,
    });
  } catch (error) {
    if (!(error instanceof A2aTaskPendingError)) throw error;
    return Object.freeze({
      protocol: "A2A", protocolVersion: "1.0", disposition: "pending",
      dependency: Object.freeze({ agentUrl, taskId: error.taskId, task: error.task }),
    });
  }
  const parts = resultParts(exchange.result);
  const candidate = parts.find((part) => part?.content?.$case === "text")?.content?.value ?? "";
  return Object.freeze({
    protocol: "A2A", protocolVersion: "1.0", result: exchange.result,
    proposal: exchange.inputNi, completion: exchange.outputNi,
    disposition: a2aResultMetadata(exchange.result).disposition ?? "refused", candidate,
  });
}

export async function recordTypedInferenceProcurement(result, { caller, customerServices, settlementRoot = ROOT, dataRoot = resolve(settlementRoot, "data"), at = new Date().toISOString(), store: suppliedStore } = {}) {
  if (!result?.demand || typeof result.disposition !== "string") throw new Error("a typed inference procurement outcome is required");
  if (!caller?.actor || !caip10(caller.account)) throw new Error("recording requires the sovereign customer actor and account");
  const witnessJournal = admittedService(customerServices, "witnessJournal");
  const store = suppliedStore ?? await createInferenceSettlementStore({ settlementRoot, actor: caller.actor, settlement: caller.account, caip2: process.env.SETTLEMENT_CAIP2 });
  if (store.actor !== caller.actor || store.settlement.toLowerCase() !== caller.account.toLowerCase()) throw new Error("customer account differs from its settlement-owned WitnessJournal plate");
  const selected = result.selection?.disposition === "provider-selected" ? result.selection.selected : null;
  const settlement = result.settlement ?? null;
  const graph = settlement?.completion ?? ni({ demand: demandCommitment(result.demand), disposition: result.disposition, offer: selected?.offer.id ?? null, at });
  const record = {
    type: "TypedRmnInferenceProcurement", graph, demand: demandCommitment(result.demand), disposition: result.disposition,
    providerSettlementAttempts: result.providerSettlementAttempts ?? (selected ? 1 : 0), frontierInferenceCalls: result.frontierInferenceCalls,
    selected: selected ? { offer: selected.offer.id, provider: selected.provider.actor, consideration: result.selection.selectedConsideration } : null,
    compact: result.contract?.compact ?? null,
    proposal: result.contract?.proposal?.term ?? null, settlement: settlement?.completion ?? null, receipt: result.receipt ?? null,
    customerAssay: result.disposition === "candidate-pending-customer-assay" ? "pending" : null,
    settlementResidues: (result.settlementResidues ?? []).map((residue) => ({ id: ni(residue), ...residue })),
    providers: { rmn: customerServices.rmn.actor, witnessJournal: witnessJournal.actor },
  };
  let projection;
  try {
    projection = await store.record({ category: "typed-inference.procurement", recordedAt: at, record });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`customer WitnessJournal service ${witnessJournal.actor} at ${witnessJournal.agentCard} failed: ${reason}`, { cause: error });
  }
  if (projection.disposition === "pending") {
    return Object.freeze({ type: "TypedInferenceProcurementWitnessJournalProjectionPending", graph: projection.graph, dependency: projection.dependency });
  }
  return Object.freeze({ type: "TypedInferenceProcurementWitnessJournalProjection", graph: projection.documentNi, projection: projection.digest, networkReference: projection.reference });
}

export async function procureTypedInference({ residue, request, suppliers, caller, customerServices, settlementRoot, invokeProvider, now, record = true, dataRoot, signal, pricingService, conform }) {
  const demand = typedInferenceDemand(residue, request);
  const market = await solicitTypedInferenceOffers(demand, suppliers);
  const selection = pricingService
    ? await selectTypedInferenceOfferByExpectedResolution(market, demand.considerationPolicy, { endpoint: pricingService, taskClass: demand.taskClass })
    : selectTypedInferenceOffer(market, demand.considerationPolicy);
  if (selection.disposition !== "provider-selected") {
    const result = { type: "TypedRmnInferenceProcurement", disposition: selection.disposition, demand, market, selection, providerSettlementAttempts: 0, frontierInferenceCalls: 0 };
    if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
    return Object.freeze(result);
  }
  try {
    const result = await settleSelectedTypedInference({ demand, market, selection, caller, customerServices, settlementRoot, invokeProvider, now, record, dataRoot, signal, conform });
    if (result.disposition === "candidate-pending-customer-assay") return Object.freeze({ ...result, providerSettlementAttempts: 1, settlementResidues: Object.freeze([]) });
    return Object.freeze({ ...result, providerSettlementAttempts: 1, settlementResidues: Object.freeze([{ provider: selection.selected.provider.actor, offer: selection.selected.offer.id, disposition: result.disposition, settlement: result.settlement?.completion ?? null }]) });
  } catch (error) {
    const dependency = pendingDependency(error);
    if (dependency) {
      const settlementResidues = Object.freeze([{
        provider: selection.selected.provider.actor,
        offer: selection.selected.offer.id,
        disposition: "dependency-pending",
        dependency,
      }]);
      const result = { type: "TypedRmnInferenceProcurement", disposition: "contract-dependency-pending", demand, market, selection, settlementResidues, providerSettlementAttempts: 0, frontierInferenceCalls: 0 };
      if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
      return Object.freeze(result);
    }
    const settlementResidues = Object.freeze([{ provider: selection.selected.provider.actor, offer: selection.selected.offer.id, disposition: "settlement-transport-refusal", reason: error instanceof Error ? error.message : String(error) }]);
    const result = { type: "TypedRmnInferenceProcurement", disposition: "selected-provider-refused", demand, market, selection, settlementResidues, providerSettlementAttempts: 1, frontierInferenceCalls: 0 };
    if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
    return Object.freeze(result);
  }
}

export async function settleSelectedTypedInference({ demand, market, selection, caller, customerServices, settlementRoot, invokeProvider, now, record = true, dataRoot, signal, conform }) {
  if (selection?.disposition !== "provider-selected" || !market?.admitted?.includes(selection.selected)) throw new Error("settlement requires one provider offer selected from the supplied solicited market");
  const contract = await compileSelectedInferenceContract(selection, demand, caller, customerServices, now, { conform });
  const settlement = invokeProvider ? await invokeProvider(contract.message, selection.selected, signal) : await defaultProviderInvoke(contract.message, selection.selected.offer.object.agentCard, signal);
  const disposition = settlement?.disposition === "completion"
    ? "candidate-pending-customer-assay"
    : settlement?.disposition === "pending"
      ? "provider-task-pending"
      : "provider-refusal";
  const receipt = settlement?.disposition === "pending" ? null : createExchangeReceipt(contract.compact, settlement);
  const result = { type: "TypedRmnInferenceProcurement", disposition, demand, market, selection, contract, settlement, receipt, providerSettlementAttempts: 1, frontierInferenceCalls: 1 };
  if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
  return Object.freeze(result);
}
