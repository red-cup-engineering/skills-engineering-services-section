import { TYPED_INFERENCE_OPERATION_TYPE } from "@red-cup-engineering/computer-inference-engine/fabric/execute-typed-inference-effect";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { a2aResultMetadata, a2aResultParts } from "@red-cup-engineering/a2a-services-section/a2a-client";
import { A2aTaskPendingError, resumeSenTask, senPart, sendSenTask } from "@red-cup-engineering/a2a-services-section/sen-part";
import { textNi } from "@red-cup-engineering/computer-inference-engine/fabric/effect-assay";
import {
  effectBundle,
  effectBundleType,
} from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import {
  validateType,
} from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/typing";
import { conformTerm } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/conformance";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { jsonValueId } from "./sen-carrier.mjs";
import { SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION } from "@red-cup-engineering/a2a-services-section/circuit-interface";
import { createInferenceMarketWitnessStore, createInferenceSettlementStore } from "./witness-journal-settlement-store.mjs";
import { inferenceMarketRoundTrace } from "./market-round-witness.mjs";
import { INFERENCE_MARKET_OFFER_EXTENSION } from "./provider-admission.mjs";
import { chooseConsideration, createExchangeCompact, createExchangeReceipt, migrateConsiderationAlternative, migrateConsiderationPolicy, validateConsiderationAlternative, validateConsiderationPolicy } from "./consideration.mjs";
import { rankInferenceCandidates } from "./expected-resolution-pricing-client.mjs";
import { ACTIVITYSTREAMS_CONTEXT } from "@red-cup-engineering/activitypub-services-section/activitystreams";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTOR = "urn:ame:inference-work-lot-service";
const ROOT = resolve(HERE, "../..");
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

function boundedFailureDetail(error) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown obstruction");
  return message.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim().slice(0, 512) || "unknown obstruction";
}

function boundedTransportDetail(error) {
  const detail = boundedFailureDetail(error);
  if (/no valid signatures|signature verification|invalid signature/iu.test(detail)) return "agent-signature-validation-obstructed";
  return detail.replace(/([?&](?:token|key|secret|signature|credential)=)[^&\s]+/giu, "$1[redacted]");
}

function terminalProviderRefusalEvidence(error, coordinates = {}) {
  const result = error?.result;
  const primitive = (value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
  return {
    type: "A2ATerminalProviderRefusal",
    ...coordinates,
    result: {
      taskId: primitive(error?.taskId ?? result?.id),
      state: primitive(result?.status?.state),
      reason: boundedTransportDetail(error),
    },
  };
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
    type: "TypedSenInferenceDemand", workType: terms.workType, taskClass: terms.taskClass ?? terms.workType,
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
  return { "@context": ACTIVITYSTREAMS_CONTEXT, id: ni(core), ...core };
}
function validateOffer(provider, source, offer, demand) {
  const object = offer?.object;
  if (offer?.["@context"] !== ACTIVITYSTREAMS_CONTEXT || offer.type !== "Offer" || offer.actor !== provider.actor || offer.target !== ACTOR || offer.inReplyTo !== source.id || object?.type !== "TypedSenInferenceServiceOffer") return "not-an-exact-provider-authored-offer";
  if (!caip10(object.providerAccount) || !/^ni:\/\/\/sha-256;/u.test(object.contract ?? "") || typeof object.agentCard !== "string" || !/^https?:\/\//u.test(object.agentCard)) return "provider-boundary-fields-invalid";
  if (object.requestCommitment !== ni(demand)) return "request-commitment-drift";
  try {
    if (JSON.stringify(validateType(object.operationType)) !== JSON.stringify(TYPED_INFERENCE_OPERATION_TYPE)) return "operation-type-incompatible";
  } catch { return "operation-type-incompatible"; }
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

export async function solicitTypedInferenceOffers(demand, suppliers, { observe } = {}) {
  const admitted = [], refused = [];
  await Promise.all([...suppliers].sort((left, right) => left.actor.localeCompare(right.actor)).map(async (provider) => {
    const source = solicitation(provider, demand);
    observe?.("offer-solicited", { provider: provider.actor, solicitation: source.id, ...(provider.agentCard ? { agentCard: provider.agentCard } : {}) });
    let offer;
    try { offer = await provider.exchange(source); }
    catch {
      const refusal = { actor: provider.actor, solicitation: source.id, reason: "solicitation-transport-obstructed" };
      refused.push(refusal); observe?.("offer-refused", { provider: provider.actor, solicitation: source.id, reason: refusal.reason }); return;
    }
    if (offer?.type === "Reject") {
      const refusal = { actor: provider.actor, solicitation: source.id, reason: offer.object?.reason ?? "provider-refused" };
      refused.push(refusal); observe?.("offer-refused", { provider: provider.actor, solicitation: source.id, reason: refusal.reason }); return;
    }
    if (Array.isArray(offer?.object?.considerationAlternatives)) {
      offer = { ...offer, object: { ...offer.object, considerationAlternatives: offer.object.considerationAlternatives.map(migrateConsiderationAlternative) } };
    }
    const problem = validateOffer(provider, source, offer, demand);
    if (problem) {
      refused.push({ actor: provider.actor, solicitation: source.id, reason: problem });
      observe?.("offer-refused", { provider: provider.actor, solicitation: source.id, reason: problem });
    } else {
      admitted.push({ provider, solicitation: source, offer });
      observe?.("offer-admitted", { provider: provider.actor, offer: offer.id, model: offer.object.model, considerationAlternatives: offer.object.considerationAlternatives });
      observe?.("provider-capacity-observed", { provider: provider.actor, offer: offer.id, source: "declared", capacity: offer.object.maximumConcurrentLots, meaning: "maximum concurrent lots declared in the signed offer", evidence: offer.id });
    }
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

export async function selectTypedInferenceOfferByExpectedResolution(market, considerationPolicy, { pricingRoot, taskClass }) {
  if (!market?.admitted?.length) return Object.freeze({ disposition: "no-admissible-provider-offer", market });
  const choice = chooseConsideration(market.admitted, migrateConsiderationPolicy(considerationPolicy));
  if (choice.disposition !== "consideration-selected") return Object.freeze({ ...choice, market });
  const ranked = await rankInferenceCandidates(pricingRoot, taskClass, choice.ranked);
  const selected = ranked[0];
  return Object.freeze({
    disposition: "provider-selected",
    // selected stays the exact market.admitted reference (settleSelectedTypedInference
    // asserts market.admitted.includes(selection.selected)); the winning entry's
    // computed expected price beside its declared price is carried as a sibling
    // field instead of merged into that identity-checked object.
    selected: selected.entry,
    selectedConsideration: selected.consideration,
    selectedExpectedResolutionPrice: selected.expectedResolutionPrice,
    ranked: ranked.map(({ entry, consideration, expectedResolutionPrice }) => ({ ...entry, consideration, expectedResolutionPrice })),
    considerationRefusals: choice.refused,
    market,
    selectionRule: "contracted-expected-consideration-per-verified-result-without-cross-asset-conversion",
  });
}

function effect({ caller, provider, evidenceRoot, measures, parent = null }) {
  return { caller, provider, evidenceRoot, outcome: { positiveEvidence: false, negativeEvidence: false }, measures, parent };
}

function admittedService(customerServices, role) {
  const admission = customerServices?.[role];
  if (!admission?.actor) throw new Error(`customer must admit exactly one contracted ${role} service`);
  return admission;
}

/** Conform one customer term locally; the receipt names the ascribed normal form. */
async function conformCustomerTerm(term, expectedType, conform = conformTerm) {
  const result = await conform({ term, expectedType });
  return Object.freeze({ term: result.term, canonicalBytesBase64: result.canonicalBytesBase64, conformance: semanticId(result.response) });
}

export async function compileSelectedInferenceContract(selection, demand, caller, now = new Date().toISOString(), { conform } = {}) {
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
  const operationReceipt = await conformCustomerTerm(operation, TYPED_INFERENCE_OPERATION_TYPE, conform);
  const measures = compact.consideration.obligations.map((obligation) => ({
    dimension: obligation.asset,
    quantity: obligation.amount.numerator,
    unit: `${obligation.kind}:${obligation.unit};exact-denominator=${obligation.amount.denominator}`,
  }));
  const proposalCell = effect({
    caller: caller.account, provider: terms.providerAccount,
    evidenceRoot: textNi("FOUR-bottom", "inference-work-lot.effect-coordinate"), measures,
  });
  const proposalBundle = effectBundle(proposalCell, operation);
  const proposal = await conformCustomerTerm(proposalBundle, effectBundleType(proposalBundle, TYPED_INFERENCE_OPERATION_TYPE), conform);
  const message = {
    messageId: randomUUID(), role: "ROLE_USER",
    parts: [senPart(Buffer.from(proposal.canonicalBytesBase64, "base64"), "proposal.sen.cbor")],
    metadata: { lawNi: terms.contract, callerAccount: caller.account, providerAccount: terms.providerAccount, selectedOffer: selection.selected.offer.id, compact: compact.id },
  };
  return Object.freeze({ message, proposal, operation: operationReceipt, selectedOffer: selection.selected.offer, compact, demand, frontierInferenceCalls: 0 });
}

const resultParts = a2aResultParts;

// provider-admission.mjs requires every declared agentCard to name a
// "/.well-known/..." resource; a2a-services-section's discovery instead
// takes the provider's bare origin and appends its own well-known path, so
// the admitted URL is trimmed back to its origin at the two points that
// actually place an A2A wire call. Everywhere a dependency's full agentCard
// URL is recorded or compared against the selected offer, it is kept
// unconverted.
function agentCardOrigin(url) {
  const { protocol, host } = new URL(url);
  return `${protocol}//${host}`;
}

async function defaultProviderInvoke(message, agentUrl, signal) {
  if (typeof agentUrl !== "string" || !/^https?:\/\//u.test(agentUrl)) throw new Error("the selected provider's A2A Agent Card URL is required");
  const providerExecutionSignal = signal ?? new AbortController().signal;
  let exchange;
  try {
    exchange = await sendSenTask({
      agentUrl: agentCardOrigin(agentUrl),
      requireSignature: true,
      message: { ...message, extensions: [SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, INFERENCE_MARKET_OFFER_EXTENSION] },
      signal: providerExecutionSignal,
    });
  } catch (error) {
    if (!(error instanceof A2aTaskPendingError)) throw error;
    return Object.freeze({
      protocol: "A2A", protocolVersion: "1.0", disposition: "pending",
      dependency: Object.freeze({ agentUrl, taskId: error.taskId, inputNi: message.parts[0].metadata.ni, task: error.task }),
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

export async function recordTypedInferenceProcurement(result, { caller, customerServices, settlementRoot = ROOT, dataRoot = resolve(settlementRoot, "data"), at = new Date().toISOString(), store: suppliedStore, witnessStore: suppliedWitnessStore } = {}) {
  if (!result?.demand || typeof result.disposition !== "string") throw new Error("a typed inference procurement outcome is required");
  if (!caller?.actor || !caip10(caller.account)) throw new Error("recording requires the sovereign customer actor and account");
  const witnessJournal = admittedService(customerServices, "witnessJournal");
  const store = suppliedStore ?? await createInferenceSettlementStore({ settlementRoot, actor: caller.actor, settlement: caller.account, caip2: process.env.SETTLEMENT_CAIP2 });
  const witnessStore = suppliedWitnessStore ?? await createInferenceMarketWitnessStore({ settlementRoot, actor: caller.actor, settlement: caller.account, caip2: process.env.SETTLEMENT_CAIP2 });
  if (store.actor !== caller.actor || store.settlement.toLowerCase() !== caller.account.toLowerCase()) throw new Error("customer account differs from its settlement-owned WitnessJournal plate");
  if (witnessStore.actor !== caller.actor || witnessStore.settlement.toLowerCase() !== caller.account.toLowerCase()) throw new Error("customer account differs from its market-witness store");
  const selected = result.selection?.disposition === "provider-selected" ? result.selection.selected : null;
  const settlement = result.settlement ?? null;
  const graph = settlement?.completion ?? ni({ demand: demandCommitment(result.demand), disposition: result.disposition, offer: selected?.offer.id ?? null, at });
  const record = {
    type: "TypedSenInferenceProcurement", graph, demand: demandCommitment(result.demand), disposition: result.disposition,
    providerSettlementAttempts: result.providerSettlementAttempts ?? (selected ? 1 : 0), frontierInferenceCalls: result.frontierInferenceCalls,
    selected: selected ? { offer: selected.offer.id, provider: selected.provider.actor, consideration: result.selection.selectedConsideration } : null,
    compact: result.contract?.compact ?? null,
    proposal: result.contract?.proposal?.term ?? null, settlement: settlement?.completion ?? null, receipt: result.receipt ?? null,
    customerAssay: result.disposition === "candidate-pending-customer-assay" ? "pending" : null,
    settlementResidues: (result.settlementResidues ?? []).map((residue) => ({ id: ni(residue), ...residue })),
    marketRound: result.marketRound ?? null,
    routeDecision: result.routeDecision ?? null,
    marketWitnesses: (result.marketWitnesses ?? []).map(({ id }) => id),
    providers: { witnessJournal: witnessJournal.actor },
  };
  const witnessProjections = [];
  for (const witness of result.marketWitnesses ?? []) {
    witnessProjections.push(await witnessStore.record({
      category: "inference-market.witness.v2",
      recordedAt: witness.recordedAt,
      record: witness,
      relation: witness.prior ? { subject: witness.id, predicate: "inference-market:prior", object: witness.prior } : undefined,
    }));
  }
  let projection;
  try {
    projection = await store.record({ category: "typed-inference.procurement", recordedAt: at, record });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`customer WitnessJournal service ${witnessJournal.actor} at ${witnessJournal.agentCard} failed: ${reason}`, { cause: error });
  }
  if (projection.disposition === "pending") {
    return Object.freeze({ type: "TypedInferenceProcurementWitnessJournalProjectionPending", graph: projection.graph, dependency: projection.dependency, marketWitnesses: Object.freeze(witnessProjections.map(({ documentNi }) => documentNi)) });
  }
  return Object.freeze({
    type: "TypedInferenceProcurementWitnessJournalProjection",
    graph: projection.documentNi,
    projection: projection.digest,
    networkReference: projection.reference,
    marketWitnesses: Object.freeze(witnessProjections.map(({ documentNi }) => documentNi)),
  });
}

export async function procureTypedInference({ residue, request, suppliers, caller, customerServices, settlementRoot, invokeProvider, now, record = true, dataRoot, signal, pricingRoot, conform, marketRound = 0 }) {
  const demand = typedInferenceDemand(residue, request);
  const demandId = demandCommitment(demand);
  const observedAt = () => now ?? new Date().toISOString();
  const trace = inferenceMarketRoundTrace({ workLot: request.workLot.id, round: marketRound, demand: demandId, recordedAt: observedAt });
  trace.append("round-opened", {
    policy: pricingRoot ? "contracted-expected-resolution-pricing" : "customer-consideration-pareto",
    providers: Object.freeze(suppliers.map(({ actor }) => actor).sort()),
    directProviderContracts: true,
    implicitFallbackPermitted: false,
  });
  const market = await solicitTypedInferenceOffers(demand, suppliers, { observe: (kind, evidence) => trace.append(kind, evidence) });
  const selection = pricingRoot
    ? await selectTypedInferenceOfferByExpectedResolution(market, demand.considerationPolicy, { pricingRoot, taskClass: demand.taskClass })
    : selectTypedInferenceOffer(market, demand.considerationPolicy);
  const decision = Object.freeze({
    type: "TypedSenInferenceSelectionDecision",
    version: 2,
    workLot: request.workLot.id,
    round: marketRound,
    demand: demandId,
    disposition: selection.disposition,
    selected: selection.disposition === "provider-selected"
      ? Object.freeze({ provider: selection.selected.provider.actor, offer: selection.selected.offer.id })
      : null,
    ranked: Object.freeze((selection.ranked ?? []).map(({ provider, offer }) => Object.freeze({ provider: provider.actor, offer: offer.id }))),
    refused: Object.freeze(market.refused.map(({ actor, reason }) => Object.freeze({ provider: actor, reason }))),
    selectionRule: selection.selectionRule ?? null,
    executionAuthority: Object.freeze({
      sequential: false,
      implicitFallbackPermitted: false,
      speculativeExecutionPermitted: false,
      maximumProviderAttempts: selection.disposition === "provider-selected" ? 1 : 0,
    }),
  });
  const routeDecision = ni(decision);
  trace.append("route-decided", decision, { routeDecision });
  if (selection.disposition !== "provider-selected") {
    trace.append("round-exhausted", { reason: selection.disposition, witnesses: trace.read().map(({ id }) => id) }, { routeDecision });
    const result = {
      type: "TypedSenInferenceProcurement", disposition: selection.disposition, demand, market, selection,
      marketRound, routeDecision, marketWitnesses: trace.read(),
      providerSettlementAttempts: 0, frontierInferenceCalls: 0,
    };
    if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
    return Object.freeze(result);
  }
  try {
    return await settleSelectedTypedInference({
      demand, market, selection, caller, customerServices, settlementRoot, invokeProvider, now, record, dataRoot, signal, conform,
      marketRound, routeDecision, trace,
    });
  } catch (error) {
    if (error?.condition === "contract-boundary-obstructed") {
      const detail = boundedFailureDetail(error.cause);
      trace.append("contract-boundary-obstructed", {
        customer: caller.actor,
        reason: "selected-contract-compilation-obstructed",
        detail,
        ...(error.dependency ? { dependency: error.dependency } : {}),
      }, { routeDecision });
      const settlementResidues = Object.freeze([{
        provider: selection.selected.provider.actor,
        offer: selection.selected.offer.id,
        disposition: "contract-boundary-obstruction",
        detail,
        ...(error.dependency ? { dependency: error.dependency } : {}),
      }]);
      const result = {
        type: "TypedSenInferenceProcurement", disposition: "contract-boundary-obstructed", demand, market, selection,
        settlementResidues, marketRound, routeDecision, marketWitnesses: trace.read(),
        providerSettlementAttempts: 0, frontierInferenceCalls: 0,
      };
      if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
      return Object.freeze(result);
    }
    const dependency = pendingDependency(error);
    if (dependency) {
      trace.append("provider-task-pending", {
        provider: selection.selected.provider.actor,
        offer: selection.selected.offer.id,
        dependency,
      }, { routeDecision });
      const settlementResidues = Object.freeze([{
        provider: selection.selected.provider.actor,
        offer: selection.selected.offer.id,
        disposition: "dependency-pending",
        dependency,
      }]);
      const result = {
        type: "TypedSenInferenceProcurement", disposition: "contract-dependency-pending", demand, market, selection,
        settlementResidues, marketRound, routeDecision, marketWitnesses: trace.read(),
        providerSettlementAttempts: 1, frontierInferenceCalls: 1,
      };
      if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
      return Object.freeze(result);
    }
    const detail = boundedTransportDetail(error);
    trace.append("provider-transport-obstructed", {
      provider: selection.selected.provider.actor,
      offer: selection.selected.offer.id,
      reason: signal?.aborted ? "customer-cancelled" : "settlement-transport-obstructed",
      detail,
    }, { routeDecision });
    trace.append("round-exhausted", {
      reason: signal?.aborted ? "customer-cancelled" : "selected-attempt-transport-obstructed",
      witnesses: trace.read().map(({ id }) => id),
    }, { routeDecision });
    const settlementResidues = Object.freeze([{
      provider: selection.selected.provider.actor,
      offer: selection.selected.offer.id,
      disposition: signal?.aborted ? "customer-cancelled" : "settlement-transport-obstruction",
      detail,
    }]);
    const result = {
      type: "TypedSenInferenceProcurement", disposition: "selected-provider-transport-obstructed", demand, market, selection,
      settlementResidues, marketRound, routeDecision, marketWitnesses: trace.read(),
      providerSettlementAttempts: 1, frontierInferenceCalls: 1,
    };
    if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
    return Object.freeze(result);
  }
}

export async function settleSelectedTypedInference({ demand, market, selection, caller, customerServices, settlementRoot, invokeProvider, now, record = true, dataRoot, signal, conform, marketRound = 0, routeDecision = null, trace: suppliedTrace }) {
  if (selection?.disposition !== "provider-selected" || !market?.admitted?.includes(selection.selected)) throw new Error("settlement requires one provider offer selected from the supplied solicited market");
  const trace = suppliedTrace ?? inferenceMarketRoundTrace({
    workLot: demandCommitment(demand),
    round: marketRound,
    demand: demandCommitment(demand),
    recordedAt: () => now ?? new Date().toISOString(),
  });
  let contract;
  try {
    contract = await compileSelectedInferenceContract(selection, demand, caller, now, { conform });
  } catch (error) {
    const boundary = new Error("selected inference contract could not cross the customer compilation boundary", { cause: error });
    boundary.condition = "contract-boundary-obstructed";
    const dependency = pendingDependency(error);
    if (dependency) boundary.dependency = dependency;
    throw boundary;
  }
  trace.append("provider-attempted", {
    provider: selection.selected.provider.actor,
    offer: selection.selected.offer.id,
    compact: contract.compact.id,
    proposal: contract.proposal.term,
    message: contract.message.messageId,
  }, { routeDecision });
  let settlement;
  try {
    settlement = invokeProvider ? await invokeProvider(contract.message, selection.selected, signal) : await defaultProviderInvoke(contract.message, selection.selected.offer.object.agentCard, signal);
  } catch (error) {
    if (!error?.result) throw error;
    const metadata = a2aResultMetadata(error.result);
    settlement = Object.freeze({
      protocol: "A2A", protocolVersion: "1.0", result: error.result,
      proposal: error.inputNi ?? contract.proposal.term,
      completion: metadata.resultNi ?? ni(terminalProviderRefusalEvidence(error, { provider: selection.selected.provider.actor, offer: selection.selected.offer.id })),
      disposition: "refusal",
      reason: error instanceof Error ? error.message : "provider terminal task failure",
    });
  }
  const disposition = settlement?.disposition === "completion"
    ? "candidate-pending-customer-assay"
    : settlement?.disposition === "pending"
      ? "provider-task-pending"
      : "provider-refusal";
  const receipt = settlement?.disposition === "pending" ? null : createExchangeReceipt(contract.compact, settlement);
  let terminalWitness = null;
  if (disposition === "candidate-pending-customer-assay") {
    trace.append("provider-delivered-candidate", {
      provider: selection.selected.provider.actor,
      offer: selection.selected.offer.id,
      compact: contract.compact.id,
      settlement: settlement.completion,
      receipt: receipt.id,
      candidate: ni(settlement.candidate),
    }, { routeDecision });
  } else if (disposition === "provider-task-pending") {
    trace.append("provider-task-pending", {
      provider: selection.selected.provider.actor,
      offer: selection.selected.offer.id,
      dependency: settlement.dependency,
    }, { routeDecision });
  } else {
    terminalWitness = trace.append("provider-refused", {
      provider: selection.selected.provider.actor,
      offer: selection.selected.offer.id,
      reason: settlement?.reason ?? "provider-authored-refusal",
      ...(receipt ? { receipt: receipt.id } : {}),
    }, { routeDecision });
    trace.append("round-exhausted", { reason: "selected-provider-refused", witnesses: trace.read().map(({ id }) => id) }, { routeDecision });
  }
  const settlementResidues = disposition === "candidate-pending-customer-assay"
    ? Object.freeze([])
    : Object.freeze([{
      provider: selection.selected.provider.actor,
      offer: selection.selected.offer.id,
      disposition,
      settlement: settlement?.completion ?? null,
      ...(receipt ? { receipt: receipt.id } : {}),
      ...(terminalWitness ? { providerRefusalWitness: terminalWitness.id } : {}),
    }]);
  const result = {
    type: "TypedSenInferenceProcurement", disposition, demand, market, selection, contract, settlement, receipt,
    settlementResidues, marketRound, routeDecision, marketWitnesses: trace.read(),
    providerSettlementAttempts: 1, frontierInferenceCalls: 1,
  };
  if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
  return Object.freeze(result);
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be nonempty text`);
  return value;
}

function pendingResumeContext(procurement, residue, request, caller) {
  if (!procurement || typeof procurement !== "object" || Array.isArray(procurement)) throw new TypeError("one prior pending typed inference procurement is required");
  if (procurement.type !== "TypedSenInferenceProcurement" || procurement.disposition !== "provider-task-pending") {
    throw new Error("resume requires one provider-task-pending typed inference procurement");
  }
  const demand = typedInferenceDemand(residue, request);
  if (demandCommitment(demand) !== demandCommitment(procurement.demand)) throw new Error("resume demand does not match the pending procurement demand");
  const selection = procurement.selection;
  const selected = selection?.disposition === "provider-selected" ? selection.selected : null;
  if (!selected?.provider?.actor || !selected?.offer?.id || !selected?.offer?.object) throw new Error("pending procurement omitted its exact selected provider offer");
  const contract = procurement.contract;
  if (!contract?.compact || !contract?.proposal?.term || !contract?.message) throw new Error("pending procurement omitted its exact compiled compact");
  if (contract.demand && demandCommitment(contract.demand) !== demandCommitment(demand)) throw new Error("pending compact demand does not match the supplied exact demand");
  if (contract.compact.demand !== demandCommitment(demand) || contract.compact.offer !== selected.offer.id) throw new Error("pending compact does not bind the exact demand and selected offer");
  if (!caller?.actor || !caip10(caller.account) || contract.compact.customer?.actor !== caller.actor || contract.compact.customer?.account?.toLowerCase() !== caller.account.toLowerCase()) {
    throw new Error("resume caller does not match the pending compact customer");
  }
  if (contract.compact.provider?.actor !== selected.provider.actor || contract.compact.provider?.account?.toLowerCase() !== selected.offer.object.providerAccount?.toLowerCase()) {
    throw new Error("pending compact provider does not match the selected offer");
  }
  const dependency = procurement.settlement?.dependency;
  if (!dependency || typeof dependency !== "object") throw new Error("pending procurement omitted its durable provider dependency");
  const agentUrl = text(dependency.agentUrl, "pending dependency agentUrl");
  const taskId = text(dependency.taskId, "pending dependency taskId");
  if (agentUrl !== selected.offer.object.agentCard) throw new Error("pending dependency agent card does not match the selected offer");
  const inputNi = dependency.inputNi ?? contract.proposal.term;
  if (dependency.inputNi !== undefined && dependency.inputNi !== contract.proposal.term) throw new Error("pending dependency input coordinate does not match the compiled proposal");
  text(inputNi, "pending dependency inputNi");
  const previousWitnesses = Array.isArray(procurement.marketWitnesses) ? procurement.marketWitnesses : [];
  if (previousWitnesses.some((witness) => !witness || typeof witness.id !== "string")) throw new Error("pending procurement market witnesses are malformed");
  return Object.freeze({ demand, selection, selected, contract, dependency, agentUrl, taskId, inputNi, previousWitnesses });
}

function pendingSuccessor({ context, procurement, settlement, disposition, trace }) {
  const result = {
    type: "TypedSenInferenceProcurement",
    disposition,
    demand: context.demand,
    market: procurement.market,
    selection: context.selection,
    contract: context.contract,
    settlement,
    marketRound: procurement.marketRound ?? 0,
    routeDecision: procurement.routeDecision ?? null,
    marketWitnesses: Object.freeze([...context.previousWitnesses, ...trace.read()]),
    providerSettlementAttempts: procurement.providerSettlementAttempts ?? 1,
    frontierInferenceCalls: procurement.frontierInferenceCalls ?? 1,
  };
  if (disposition === "provider-task-pending") {
    result.settlementResidues = Object.freeze([{
      provider: context.selected.provider.actor, offer: context.selected.offer.id, disposition,
      dependency: settlement.dependency,
    }]);
  } else if (disposition === "provider-task-outcome-unknown") {
    result.settlementResidues = Object.freeze([{
      provider: context.selected.provider.actor, offer: context.selected.offer.id, disposition,
      dependency: context.dependency,
    }]);
  } else {
    result.receipt = createExchangeReceipt(context.contract.compact, settlement);
    result.settlementResidues = disposition === "provider-refusal" ? Object.freeze([{
      provider: context.selected.provider.actor, offer: context.selected.offer.id, disposition,
      settlement: settlement.completion, receipt: result.receipt.id,
    }]) : Object.freeze([]);
  }
  return result;
}

/** Resume exactly one already-contracted provider task. This operation never
 * solicits, selects, recompiles, or retries a provider; unknown transport
 * state remains explicit and carries no receipt. */
export async function resumePendingTypedInference({ procurement, residue, request, caller, customerServices, settlementRoot, dataRoot, signal, now, record = true, resume = resumeSenTask }) {
  const context = pendingResumeContext(procurement, residue, request, caller);
  const trace = inferenceMarketRoundTrace({
    workLot: request.workLot.id,
    round: procurement.marketRound ?? 0,
    demand: demandCommitment(context.demand),
    recordedAt: () => now ?? new Date().toISOString(),
    prior: context.previousWitnesses.at(-1)?.id ?? null,
    ordinal: context.previousWitnesses.length,
  });
  let settlement;
  try {
    const exchange = await resume({
      agentUrl: agentCardOrigin(context.agentUrl), taskId: context.taskId,
      requireSignature: true,
      ...(signal ? { signal } : {}),
    });
    const candidate = resultParts(exchange.result).find((part) => part?.content?.$case === "text")?.content?.value ?? "";
    settlement = Object.freeze({
      protocol: "A2A", protocolVersion: "1.0", result: exchange.result,
      proposal: context.inputNi, completion: exchange.outputNi, disposition: "completion", candidate,
    });
    const result = pendingSuccessor({ context, procurement, settlement, disposition: "candidate-pending-customer-assay", trace });
    trace.append("provider-delivered-candidate", {
      provider: context.selected.provider.actor, offer: context.selected.offer.id,
      compact: context.contract.compact.id, settlement: settlement.completion,
      receipt: result.receipt.id, candidate: ni(candidate),
    }, { routeDecision: result.routeDecision });
    result.marketWitnesses = Object.freeze([...context.previousWitnesses, ...trace.read()]);
    if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof A2aTaskPendingError) {
      settlement = Object.freeze({ protocol: "A2A", protocolVersion: "1.0", disposition: "pending", dependency: Object.freeze({ agentUrl: context.agentUrl, taskId: error.taskId, inputNi: context.inputNi, task: error.task }) });
      trace.append("provider-task-pending", { provider: context.selected.provider.actor, offer: context.selected.offer.id, dependency: settlement.dependency }, { routeDecision: procurement.routeDecision ?? null });
      const result = pendingSuccessor({ context, procurement, settlement, disposition: "provider-task-pending", trace });
      if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
      return Object.freeze(result);
    }
    if (error?.result) {
      const metadata = a2aResultMetadata(error.result);
      settlement = Object.freeze({
        protocol: "A2A", protocolVersion: "1.0", result: error.result,
        proposal: error.inputNi ?? context.inputNi,
        completion: metadata.resultNi ?? ni(terminalProviderRefusalEvidence(error, { agentUrl: context.agentUrl, taskId: context.taskId })),
        disposition: "refusal", reason: error instanceof Error ? error.message : "provider terminal task failure",
      });
      const result = pendingSuccessor({ context, procurement, settlement, disposition: "provider-refusal", trace });
      trace.append("provider-refused", { provider: context.selected.provider.actor, offer: context.selected.offer.id, reason: settlement.reason, receipt: result.receipt.id }, { routeDecision: result.routeDecision });
      trace.append("round-exhausted", { reason: "resumed-provider-terminal-refusal", witnesses: [...context.previousWitnesses, ...trace.read()].map(({ id }) => id) }, { routeDecision: result.routeDecision });
      result.marketWitnesses = Object.freeze([...context.previousWitnesses, ...trace.read()]);
      if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
      return Object.freeze(result);
    }
    trace.append("provider-transport-obstructed", { provider: context.selected.provider.actor, offer: context.selected.offer.id, reason: signal?.aborted ? "customer-cancelled" : "resumed-task-outcome-unknown" }, { routeDecision: procurement.routeDecision ?? null });
    const result = pendingSuccessor({ context, procurement, settlement: null, disposition: "provider-task-outcome-unknown", trace });
    if (record) result.projection = await recordTypedInferenceProcurement(result, { caller, customerServices, ...(settlementRoot ? { settlementRoot } : {}), ...(dataRoot ? { dataRoot } : {}), ...(now ? { at: now } : {}) });
    return Object.freeze(result);
  }
}
