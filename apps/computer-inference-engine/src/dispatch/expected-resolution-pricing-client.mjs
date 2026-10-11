// Dispatch's reading and writing of expected-resolution pricing: ranking feasible offers by the
// price each is expected to resolve at, reading placement observations, and recording deliveries,
// outcomes and refusals. The observations live under a pricing data root, read and written in
// process through ./expected-resolution-pricing.mjs.
import { pricingRootOf, appendDelivery, appendObservation, appendInferenceRefusal, appendReceiverOutcomeVoid, effectiveReceiverObservations, loadDeliveries, loadObservations, rankOffers, withRegisterJudgments } from "./expected-resolution-pricing.mjs";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
export { expectedResolutionPricingRoot, pricingRootOf } from "./expected-resolution-pricing.mjs";
import { a2aExecutionConfiguration, executionConfigurationIdentity, jsonValueId } from "./sen-carrier.mjs";
import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";

/**
 * The market coordinate of one delivery an inference call registered (`{provider, offer, taskClass,
 * receipt, configuration?}`, what an outcome record carries as `market`), found by its work lot and
 * receipt; undefined when the root holds no such delivery.
 */
export function marketCoordinateOfDelivery(pricingRoot, { workLot, receipt }) {
  if (typeof pricingRoot !== "string" || pricingRoot === "") return undefined;
  const delivery = loadDeliveries({ dataRoot: pricingRoot }).find((item) => item.workLot === workLot && item.receipt === receipt);
  return delivery === undefined ? undefined : Object.freeze({
    provider: delivery.provider, offer: delivery.selectedOffer, taskClass: delivery.taskClass, receipt: delivery.receipt,
    ...(delivery.configurationIdentity ? { configuration: delivery.configurationIdentity } : {}),
  });
}

function candidateConfigurationIdentity(candidate) {
  return executionConfigurationIdentity(a2aExecutionConfiguration({ provider: candidate.entry.provider.actor, offer: candidate.entry.offer }));
}

function singleObligation(candidate) {
  const obligations = candidate.consideration?.obligations;
  if (!Array.isArray(obligations) || obligations.length !== 1) throw new Error("expected-resolution pricing requires one consideration obligation per feasible offer");
  return obligations[0];
}

/** Where the other registers' standing judgments of inference deliveries are indexed: the file the
 *  daily acceptance readout folds the outcome journal into once, so routing never folds the journal. */
export const marketJudgmentsPath = (environment = process.env) => environment.INFERENCE_MARKET_JUDGMENTS_FILE
  ?? (environment.METROPLAT_WEB_DATA_DIR ? join(environment.METROPLAT_WEB_DATA_DIR, "records", "acceptance", "market-judgments.json") : undefined);

/** The index's judgments, re-read only when the file changes; a missing or unreadable index is none. */
const heldJudgments = new Map();
function indexedJudgments(path) {
  let modified;
  try { modified = statSync(path).mtimeMs; } catch { return []; }
  const held = heldJudgments.get(path);
  if (held?.modified === modified) return held.judgments;
  let judgments = [];
  try {
    const index = JSON.parse(readFileSync(path, "utf8"));
    judgments = Array.isArray(index) ? index : Array.isArray(index?.judgments) ? index.judgments : [];
  } catch (error) { console.error(`[inference-pricing] market judgments at ${path} unread: ${error instanceof Error ? error.message : String(error)}`); }
  heldJudgments.set(path, { modified, judgments });
  return judgments;
}

/**
 * What routing learns from: the pricing root's observations with the judgments other registers made
 * of the same deliveries, from the market-judgments index (`marketJudgmentsPath`). With no index,
 * the observations alone.
 */
export function loadRoutingObservations(pricingRoot, { judgmentsPath = marketJudgmentsPath() } = {}) {
  const observations = loadObservations({ dataRoot: pricingRoot });
  if (typeof judgmentsPath !== "string" || judgmentsPath.trim() === "") return observations;
  const judgments = indexedJudgments(judgmentsPath);
  return judgments.length === 0 ? observations : withRegisterJudgments(observations, judgments, loadDeliveries({ dataRoot: pricingRoot }));
}

/** The candidates in order of expected resolution price, each carrying its price. */
export async function rankInferenceCandidates(pricingRoot, taskClass, candidates) {
  if (new Set(candidates.map((candidate) => candidate?.entry?.offer?.id)).size !== candidates.length) throw new Error("expected-resolution pricing candidates must have unique offer identities");
  const byOffer = new Map(candidates.map((candidate) => [candidate.entry.offer.id, candidate]));
  const offers = candidates.map((candidate) => {
    const { kind, asset, unit, amount } = singleObligation(candidate);
    return { provider: candidate.entry.provider.actor, offerId: candidate.entry.offer.id, configurationIdentity: candidateConfigurationIdentity(candidate), consideration: { kind, asset, unit, amount } };
  });
  return rankOffers(taskClass, offers, loadRoutingObservations(pricingRoot))
    .map((price) => ({ ...byOffer.get(price.offerId), expectedResolutionPrice: price }));
}

/**
 * Receiver judgments stay bound to their exact delivery. A nearby output cap
 * on the same public configuration supplies only a weak placement prior.
 * @param {string} pricingRoot
 * @param {string} taskClass
 * @param {{offerId: string, configurationIdentity: string, configuration: object}[]} offers
 * @param {string} receiver
 * @returns {Promise<object[]>}
 */
export async function loadInferencePlacementObservations(pricingRoot, taskClass, offers, receiver) {
  if (!Array.isArray(offers) || offers.length === 0 || offers.length > 32) throw new Error("placement observation requests require one to 32 exact offers");
  if (typeof receiver !== "string" || receiver.trim() === "") throw new TypeError("placement observation receiver is required");
  const expected = new Map(offers.map((offer) => [offer.offerId, offer]));
  if (expected.size !== offers.length || offers.some((offer) => typeof offer.offerId !== "string"
    || typeof offer.configurationIdentity !== "string"
    || executionConfigurationIdentity(offer.configuration) !== offer.configurationIdentity)) {
    throw new Error("placement observation requests require exact offer and configuration identities");
  }
  const family = (configuration) => {
    const { maximumOutputTokens: _cap, ...stable } = configuration;
    return canonicalJson(stable);
  };
  const deliveries = new Map(loadDeliveries({ dataRoot: pricingRoot }).map((delivery) => [delivery.id, delivery]));
  const observations = [];
  for (const item of effectiveReceiverObservations(loadRoutingObservations(pricingRoot))) {
    if (!["receiver-outcome", "receiver-attempt-refusal"].includes(item.kind) || item.taskClass !== taskClass || item.receiver !== receiver) continue;
    const exact = expected.get(item.selectedOffer);
    if (exact && exact.configurationIdentity === item.configurationIdentity) {
      observations.push({
        type: "WorkPlacementObservation", kind: "attempt", receipt: item.id, offerId: item.selectedOffer, configurationIdentity: item.configurationIdentity, taskClass, outcome: item.kind === "receiver-attempt-refusal" ? "refused" : item.outcome,
        ...(typeof item.measurementScope?.accountIdentity === "string" ? { accountIdentity: item.measurementScope.accountIdentity } : {}),
        ...(typeof item.measurementScope?.windowIdentity === "string" ? { windowIdentity: item.measurementScope.windowIdentity } : {}),
        ...(Number.isSafeInteger(item.durationMs) ? { latency: { unit: "millisecond", amount: { numerator: String(item.durationMs), denominator: "1" } } } : {}),
        ...(item.resources ? { resources: item.resources } : {}),
      });
    }
    // A failed protocol attempt supplies exact evidence, not a delivered product
    // or transferable quality judgment about a different configuration.
    if (item.kind === "receiver-attempt-refusal") continue;
    const source = deliveries.get(item.delivery);
    if (!source?.configuration || source.configurationIdentity !== item.configurationIdentity) continue;
    const sourceCap = source.configuration.maximumOutputTokens;
    if (!Number.isSafeInteger(sourceCap) || sourceCap < 1) continue;
    const sourceFamily = family(source.configuration);
    for (const offer of offers) {
      if (offer.configurationIdentity === item.configurationIdentity
        || family(offer.configuration) !== sourceFamily) continue;
      const targetCap = offer.configuration.maximumOutputTokens;
      if (!Number.isSafeInteger(targetCap) || targetCap < 1
        || BigInt(Math.max(sourceCap, targetCap)) * 4n > BigInt(Math.min(sourceCap, targetCap)) * 5n) continue;
      observations.push({
        type: "WorkPlacementObservation", kind: "quality-prior",
        receipt: jsonValueId({ sourceReceipt: item.id, offerId: offer.offerId }),
        offerId: offer.offerId, configurationIdentity: offer.configurationIdentity, taskClass, outcome: item.outcome,
        sourceReceipt: item.id, sourceOfferId: item.selectedOffer, sourceConfigurationIdentity: item.configurationIdentity,
      });
    }
  }
  return observations;
}

/** Exact offers whose products this receiver refused for the same content-addressed work. */
export async function refusedInferenceOffers(pricingRoot, workLotId, taskClass) {
  return [...new Set(effectiveReceiverObservations(loadObservations({ dataRoot: pricingRoot }))
    .filter((item) => item.kind === "receiver-outcome" && item.workLot === workLotId
      && item.taskClass === taskClass && item.outcome === "refused"
      && typeof item.selectedOffer === "string")
    .map((item) => item.selectedOffer))];
}

/** A provider's payload-too-large refusal applies only to the identical request and offer. */
export async function oversizedProviderRequests(pricingRoot, workLotId, taskClass) {
  return loadObservations({ dataRoot: pricingRoot }).filter((item) => item.kind === "provider-refusal"
    && item.workLot === workLotId && item.taskClass === taskClass && item.status === 413
    && typeof item.requestIdentity === "string" && typeof item.selectedOffer === "string");
}

export async function observeInferenceOutcome(pricingRoot, observation) {
  return appendObservation(observation, { dataRoot: pricingRoot });
}

export async function voidInferenceOutcome(pricingRoot, observation) {
  const original = loadObservations({ dataRoot: pricingRoot }).find((item) => item.kind === "receiver-outcome"
    && ["workLot", "provider", "taskClass", "selectedOffer", "receipt", "receiver"].every((field) => item[field] === observation[field]));
  if (!original) throw new Error("void requires the exact recorded receiver outcome");
  return appendReceiverOutcomeVoid({ observationId: original.id, evidence: observation.evidence }, { dataRoot: pricingRoot });
}

export async function registerInferenceDelivery(pricingRoot, delivery) {
  return appendDelivery(delivery, { dataRoot: pricingRoot });
}

export async function observeInferenceRefusal(pricingRoot, refusal) {
  return appendInferenceRefusal(refusal, { dataRoot: pricingRoot });
}
