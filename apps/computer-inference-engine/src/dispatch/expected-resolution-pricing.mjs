import { dirname, join, resolve } from "node:path";
import { openLedgerJournal } from "../media/ledger-journal.mjs";
import { nonnegativeHostRatio as exactNonnegativeAmount } from "@red-cup-engineering/metrologic/number/wire-ratio";
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";
import { executionConfiguration, executionConfigurationIdentity } from "./sen-carrier.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { admitAgencyWorkResult } from "@red-cup-engineering/organizing/work/schema";
import { ORDER_CHANNELS } from "@red-cup-engineering/organizing/work/staffing";

/** Locate pricing state beneath an already selected data directory. */
export const expectedResolutionPricingRoot = (dataDirectory) => resolve(dataDirectory, "state", "expected-resolution-pricing-state");

/**
 * The node's inference pricing root: the deployment's own, else the one beside the node's web data
 * directory, so a process that carries only the node's configuration (a node job's environment file)
 * still records and reads the market's book and never silently loses it.
 */
export const pricingRootOf = (environment = process.env) => {
  const named = environment.EXPECTED_RESOLUTION_PRICING_ROOT;
  if (typeof named === "string" && named.trim() !== "") return named;
  const web = environment.METROPLAT_WEB_DATA_DIR;
  return typeof web === "string" && web.trim() !== "" ? resolve(dirname(web), "inference-pricing") : undefined;
};

function nonempty(value, label) { if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be nonempty text`); return value; }

/**
 * The pricing book: a ledger journal at `<dataRoot>/pricing-book.journal` (the one log),
 * with deliveries and observations kept as held records in append order.
 */
function pricingBook(dataRoot) {
  return openLedgerJournal(join(resolve(nonempty(dataRoot, "pricing dataRoot")), "pricing-book"));
}
const appendTo = (dataRoot, category, record) => { pricingBook(dataRoot).record(category, record); return record; };

export function appendDelivery(delivery, { dataRoot } = {}) {
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) throw new Error("delivery must be one object");
  const configurationIdentity = delivery.configurationIdentity === undefined ? null : nonempty(delivery.configurationIdentity, "delivery.configurationIdentity");
  const configuration = delivery.configuration === undefined ? undefined : executionConfiguration(delivery.configuration);
  if ((configurationIdentity === null) !== (configuration === undefined)) throw new Error("delivery configuration and identity must appear together");
  if (configuration && executionConfigurationIdentity(configuration) !== configurationIdentity) throw new Error("delivery configuration identity does not match its public facts");
  if (configuration && configuration.provider !== delivery.provider) throw new Error("delivery configuration.provider must match delivery.provider");
  if (delivery.durationMs !== undefined && (!Number.isSafeInteger(delivery.durationMs) || delivery.durationMs < 0)) throw new Error("delivery.durationMs must be one observed nonnegative integer");
  if (delivery.resources !== undefined && !Array.isArray(delivery.resources)) throw new Error("delivery.resources must be observed resource rows");
  // The order a delivery answered (organizing work/schema orderOfItem): misses are counted by it.
  const order = delivery.order === undefined ? undefined : nonempty(delivery.order, "delivery.order");
  const body = { kind: "inference-delivery", workLot: nonempty(delivery.workLot, "delivery.workLot"), provider: nonempty(delivery.provider, "delivery.provider"), taskClass: nonempty(delivery.taskClass, "delivery.taskClass"), selectedOffer: nonempty(delivery.selectedOffer, "delivery.selectedOffer"), receipt: nonempty(delivery.receipt, "delivery.receipt"), receiver: nonempty(delivery.receiver, "delivery.receiver"), ...(configurationIdentity ? { configurationIdentity, configuration } : {}), ...(delivery.durationMs === undefined ? {} : { durationMs: delivery.durationMs }), ...(delivery.resources === undefined ? {} : { resources: delivery.resources }), ...(order === undefined ? {} : { order }) };
  const record = Object.freeze({ id: semanticId(body), observedAt: new Date().toISOString(), ...body });
  const deliveries = loadDeliveries({ dataRoot });
  const coordinate = deliveries.find((item) => ["workLot", "provider", "taskClass", "selectedOffer", "receipt", "receiver"].every((field) => item[field] === record[field]));
  if (coordinate && canonical(Object.fromEntries(Object.entries(coordinate).filter(([key]) => !["id", "observedAt", "durationMs", "resources"].includes(key)))) !== canonical(Object.fromEntries(Object.entries(record).filter(([key]) => !["id", "observedAt", "durationMs", "resources"].includes(key))))) throw new Error("inference delivery coordinate is already bound to conflicting public configuration");
  if (coordinate) return coordinate;
  const existing = deliveries.find((item) => item.id === record.id);
  if (existing) return existing;
  return appendTo(dataRoot, "delivery", record);
}
export function loadDeliveries({ dataRoot } = {}) { return pricingBook(dataRoot).read("delivery"); }

/** Append one observation. Preserves the caller's outcome and evidence
 * verbatim; never estimates or drops a field to force a shape. */
export function appendObservation(observation, { dataRoot } = {}) {
  if (!observation || typeof observation !== "object") throw new Error("observation must be one object");
  const { provider, taskClass, outcome } = observation;
  if (typeof provider !== "string" || provider.trim() === "") throw new Error("observation.provider must be nonempty text");
  if (typeof taskClass !== "string" || taskClass.trim() === "") throw new Error("observation.taskClass must be nonempty text");
  if (!["accepted", "refused"].includes(outcome)) throw new Error("observation.outcome must be accepted or refused");
  const body = { kind: "receiver-outcome", workLot: nonempty(observation.workLot, "observation.workLot"), provider, taskClass, selectedOffer: nonempty(observation.selectedOffer, "observation.selectedOffer"), receipt: nonempty(observation.receipt, "observation.receipt"), receiver: nonempty(observation.receiver, "observation.receiver"), outcome, evidence: nonempty(observation.evidence, "observation.evidence") };
  const delivery = loadDeliveries({ dataRoot }).find((item) => ["workLot", "provider", "taskClass", "selectedOffer", "receipt", "receiver"].every((field) => item[field] === body[field]));
  if (!delivery) throw new Error("receiver outcome is not bound to a registered inference delivery");
  if (observation.configurationIdentity !== undefined && observation.configurationIdentity !== delivery.configurationIdentity) throw new Error("receiver outcome cannot change the registered delivery configuration");
  if (delivery.configurationIdentity) body.configurationIdentity = delivery.configurationIdentity;
  if (delivery.durationMs !== undefined) body.durationMs = delivery.durationMs;
  if (delivery.resources !== undefined) body.resources = delivery.resources;
  if (delivery.order !== undefined) body.order = delivery.order;
  const priorDeliveryOutcome = loadObservations({ dataRoot }).find((item) => item.kind === "receiver-outcome" && item.delivery === delivery.id);
  if (priorDeliveryOutcome) {
    if (priorDeliveryOutcome.outcome !== body.outcome || priorDeliveryOutcome.evidence !== body.evidence) throw new Error("registered inference delivery already has one receiver disposition");
    return priorDeliveryOutcome;
  }
  // Evidence explains a judgment; the delivery identifies what was judged.
  // The same explanation can recur for distinct paid provider completions.
  const record = Object.freeze({ id: semanticId({ delivery: delivery.id, ...body }), observedAt: new Date().toISOString(), delivery: delivery.id, ...body });
  return appendTo(dataRoot, "observation", record);
}

/** Retain an attributable refusal before delivery. Completed receiver protocol
 * refusals carry their observed costs; neither kind fabricates a delivery. */
export function appendInferenceRefusal(refusal, { dataRoot } = {}) {
  if (!refusal || typeof refusal !== "object" || Array.isArray(refusal)) throw new Error("provider refusal must be one object");
  const body = {
    kind: refusal.kind ?? "provider-refusal",
    workLot: nonempty(refusal.workLot, "refusal.workLot"),
    provider: nonempty(refusal.provider, "refusal.provider"),
    taskClass: nonempty(refusal.taskClass, "refusal.taskClass"),
    selectedOffer: nonempty(refusal.selectedOffer, "refusal.selectedOffer"),
    disposition: nonempty(refusal.disposition, "refusal.disposition"),
    refusalReceipt: nonempty(refusal.refusalReceipt, "refusal.refusalReceipt"),
    [refusal.kind === "receiver-attempt-refusal" ? "refusalWitness" : "providerRefusalWitness"]: nonempty(refusal.refusalWitness, "refusal.refusalWitness"),
    ...(refusal.requestIdentity === undefined ? {} : { requestIdentity: nonempty(refusal.requestIdentity, "refusal.requestIdentity") }),
    ...(refusal.status === undefined ? {} : { status: refusal.status }),
    ...(refusal.requestBytes === undefined ? {} : { requestBytes: refusal.requestBytes }),
    ...(refusal.credentialSha256 === undefined ? {} : { credentialSha256: nonempty(refusal.credentialSha256, "refusal.credentialSha256") }),
    ...(refusal.configurationIdentity === undefined ? {} : { configurationIdentity: nonempty(refusal.configurationIdentity, "refusal.configurationIdentity") }),
  };
  if (!["provider-refusal", "receiver-attempt-refusal"].includes(body.kind)) throw new TypeError("refusal.kind is invalid");
  if (body.kind === "receiver-attempt-refusal") {
    const configuration = executionConfiguration(refusal.configuration);
    if (configuration.provider !== body.provider || executionConfigurationIdentity(configuration) !== body.configurationIdentity) throw new TypeError("receiver refusal requires its exact public configuration");
    if (refusal.cause?.kind !== "protocol") throw new TypeError("receiver attempt refusal requires a protocol refusal");
    if (!Array.isArray(refusal.resources)) throw new TypeError("receiver refusal requires completed-exchange resources");
    const resources = refusal.resources.map(row => ({ resource: nonempty(row.resource, "resource"),
      ...(row.asset === undefined ? {} : { asset: nonempty(row.asset, "asset") }), unit: nonempty(row.unit, "unit"),
      amount: exactNonnegativeAmount(row.amount.numerator, row.amount.denominator) }));
    const requestCount = resources.find(row => row.resource === "requests" && row.unit === "request");
    if (!requestCount || BigInt(requestCount.amount.numerator) === 0n) throw new TypeError("receiver refusal requires an observed completed exchange");
    if (refusal.measurementScope?.providerIdentity !== body.provider || refusal.measurementScope?.measurementCoverage !== "completed-exchanges") throw new TypeError("receiver refusal requires its observed measurement scope");
    Object.assign(body, { receiver: nonempty(refusal.receiver, "receiver"), receiverAttempt: nonempty(refusal.receiverAttempt, "receiverAttempt"), configuration, cause: refusal.cause,
      resources, measurementScope: refusal.measurementScope });
    if (refusal.durationMs !== undefined) {
      if (!Number.isSafeInteger(refusal.durationMs) || refusal.durationMs < 0) throw new TypeError("refusal.durationMs must be an observed nonnegative integer");
      body.durationMs = refusal.durationMs;
    }
  }
  if (body.status !== undefined && (!Number.isInteger(body.status) || body.status < 100 || body.status > 599)) throw new TypeError("refusal.status must be an HTTP status");
  if (body.requestBytes !== undefined && (!Number.isSafeInteger(body.requestBytes) || body.requestBytes < 0)) throw new TypeError("refusal.requestBytes must be a nonnegative byte count");
  const observations = loadObservations({ dataRoot });
  const coordinate = observations.find((item) => item.kind === body.kind && item.refusalReceipt === body.refusalReceipt);
  if (coordinate) {
    const prior = Object.fromEntries(Object.entries(coordinate).filter(([key]) => !["id", "observedAt"].includes(key)));
    if (canonical(prior) !== canonical(body)) throw new Error("selected provider refusal is already bound to conflicting evidence");
    return coordinate;
  }
  const record = Object.freeze({ id: semanticId(body), observedAt: new Date().toISOString(), ...body });
  return appendTo(dataRoot, "observation", record);
}

/** Load every observation recorded so far. Absence of the file is absence of
 * observations, never an error: no observations have landed yet. */
export function loadObservations({ dataRoot } = {}) {
  return pricingBook(dataRoot).read("observation");
}

/** Provider HTTP and transport evidence share the existing private observation carrier. */
export function appendProviderAvailability(reading, credentialSha256, { dataRoot } = {}) {
  if (credentialSha256 !== null && !/^[a-f0-9]{64}$/u.test(credentialSha256)) throw new TypeError("credential fingerprint must be exact or explicitly absent");
  const body = {
    kind: "provider-availability", provider: nonempty(reading.providerIdentity, "reading.providerIdentity"),
    credentialSha256,
    ...(reading.status === undefined ? {} : { status: reading.status }),
    state: reading.state, quota: reading.quota, backoffUntil: reading.backoffUntil,
    ...(reading.lastHiredAt === undefined ? {} : { lastHiredAt: reading.lastHiredAt }),
    ...(reading.reason === undefined ? {} : { reason: reading.reason }),
  };
  if (body.status !== undefined && (!Number.isInteger(body.status) || body.status < 100 || body.status > 599)) throw new TypeError("provider HTTP status must be observed");
  if (body.status === undefined) nonempty(body.reason, "non-HTTP availability reason");
  const record = Object.freeze({ id: semanticId({ ...body, observedAt: reading.observedAt }), observedAt: reading.observedAt, ...body });
  return appendTo(dataRoot, "observation", record);
}

export function latestProviderAvailability(provider, credentialSha256, { dataRoot, observations = loadObservations({ dataRoot }) } = {}) {
  return observations.findLast((item) => item.kind === "provider-availability"
    && item.provider === provider && item.credentialSha256 === credentialSha256) ?? null;
}

/** Retire one receiver acceptance when later evidence shows its product was unusable. */
export function appendReceiverOutcomeRetraction({ observationId, evidence }, { dataRoot } = {}) {
  const observations = loadObservations({ dataRoot });
  const original = observations.find((item) => item.id === nonempty(observationId, "retraction.observationId") && item.kind === "receiver-outcome");
  if (!original || original.outcome !== "accepted") throw new Error("retraction requires one recorded receiver acceptance");
  const reason = nonempty(evidence, "retraction.evidence");
  const prior = observations.find((item) => item.kind === "receiver-outcome-retraction" && item.originalOutcome === original.id);
  if (prior) {
    if (prior.evidence !== reason) throw new Error("receiver acceptance already has a different retraction");
    return prior;
  }
  const body = { kind: "receiver-outcome-retraction", originalOutcome: original.id, delivery: original.delivery, outcome: "refused", evidence: reason };
  const record = Object.freeze({ id: semanticId(body), observedAt: new Date().toISOString(), ...body });
  return appendTo(dataRoot, "observation", record);
}

/** Withdraw a receiver judgment caused by the customer's own invalid demand or state. */
export function appendReceiverOutcomeVoid({ observationId, evidence }, { dataRoot } = {}) {
  const observations = loadObservations({ dataRoot });
  const original = observations.find((item) => item.id === nonempty(observationId, "void.observationId") && item.kind === "receiver-outcome");
  if (!original) throw new Error("void requires one recorded receiver outcome");
  const reason = nonempty(evidence, "void.evidence");
  const prior = observations.find((item) => item.kind === "receiver-outcome-void" && item.originalOutcome === original.id);
  if (prior) {
    if (prior.evidence !== reason) throw new Error("receiver outcome already has a different void");
    return prior;
  }
  const body = { kind: "receiver-outcome-void", originalOutcome: original.id, delivery: original.delivery, evidence: reason };
  const record = Object.freeze({ id: semanticId(body), observedAt: new Date().toISOString(), ...body });
  return appendTo(dataRoot, "observation", record);
}

/** Original events remain readable; consumers price each delivery by its latest valid disposition. */
export function effectiveReceiverObservations(observations) {
  const accepted = new Map(observations.filter((item) => item.kind === "receiver-outcome" && item.outcome === "accepted").map((item) => [item.id, item]));
  const outcomes = new Map(observations.filter((item) => item.kind === "receiver-outcome").map((item) => [item.id, item]));
  const voided = new Set(observations.filter((item) => item.kind === "receiver-outcome-void")
    .filter((item) => outcomes.get(item.originalOutcome)?.delivery === item.delivery).map((item) => item.originalOutcome));
  const retractions = new Map();
  for (const item of observations) {
    if (item.kind !== "receiver-outcome-retraction") continue;
    const original = accepted.get(item.originalOutcome);
    if (!original || original.delivery !== item.delivery || item.outcome !== "refused" || retractions.has(original.id)) continue;
    retractions.set(original.id, item);
  }
  return observations.filter((item) => item.kind !== "receiver-outcome-retraction" && item.kind !== "receiver-outcome-void" && !voided.has(item.id)).map((item) => {
    const correction = retractions.get(item.id);
    return correction === undefined ? item : Object.freeze({ ...item, id: correction.id, observedAt: correction.observedAt, outcome: "refused", evidence: correction.evidence, originalOutcome: item.id });
  });
}

/**
 * The receiver outcomes routing learns from, with the judgments other registers made of the same
 * deliveries (organizing's one outcome path: an editor's verdict on a draft, a customer's payment,
 * an assay on the work arena). A standing judgment that names an inference delivery by its market
 * coordinate (`market.receipt`, a registered delivery's receipt) is the latest word on it: where it
 * rejects a delivery the receiver accepted, it retracts that acceptance; where the receiver never
 * judged the delivery, it is the delivery's outcome. The inference market's own outcomes are these
 * observations already, so they are not read twice.
 * @param {object[]} observations - the pricing root's observations
 * @param {object[]} judgments - standing outcomes (voids applied, latest per judge; organizing
 *   `standingOutcomes`), each `{id, source, verdict, at, market: {receipt, ...}}`
 * @param {object[]} deliveries - the pricing root's registered deliveries
 * @returns {object[]} the observations with the other registers' judgments joined
 */
export function withRegisterJudgments(observations, judgments, deliveries) {
  const byReceipt = new Map(deliveries.map((delivery) => [delivery.receipt, delivery]));
  const latest = new Map();
  for (const outcome of judgments) {
    if (outcome.source === "inference-market" || !byReceipt.has(outcome.market?.receipt)) continue;
    const held = latest.get(outcome.market.receipt);
    if (held === undefined || held.at < outcome.at || (held.at === outcome.at && held.id < outcome.id)) latest.set(outcome.market.receipt, outcome);
  }
  const judged = new Map(observations.filter((item) => item.kind === "receiver-outcome").map((item) => [item.receipt, item]));
  const joined = [];
  const enriched = new Map();
  for (const [receipt, outcome] of latest) {
    const delivery = byReceipt.get(receipt);
    const prior = judged.get(receipt);
    const observedAt = outcome.at;
    // A received execution report has its own verdict. Keep the typed report so accepting an
    // error cannot be priced as completed work, or rewritten into a receiver/provider refusal.
    const report = outcome.reportedResult === undefined ? {} : {
      reportedResult: admitAgencyWorkResult(outcome.reportedResult),
      reportVerdict: outcome.verdict, reportJudgment: outcome.id,
    };
    if (prior !== undefined) {
      if (outcome.reportedResult !== undefined) enriched.set(prior, Object.freeze({ ...prior, ...report }));
      if (report.reportedResult?.kind === "skill-error") continue;
      if (prior.outcome === "accepted" && outcome.verdict === "rejected") {
        joined.push(Object.freeze({ kind: "receiver-outcome-retraction", id: outcome.id, observedAt, originalOutcome: prior.id, delivery: prior.delivery, outcome: "refused", evidence: outcome.id, register: outcome.source }));
      }
      continue;
    }
    joined.push(Object.freeze({
      kind: "receiver-outcome", id: outcome.id, observedAt, delivery: delivery.id, workLot: delivery.workLot, provider: delivery.provider, taskClass: delivery.taskClass,
      selectedOffer: delivery.selectedOffer, receipt, receiver: delivery.receiver, outcome: outcome.verdict === "accepted" ? "accepted" : "refused", evidence: outcome.id, register: outcome.source,
      ...report,
      ...(delivery.configurationIdentity === undefined ? {} : { configurationIdentity: delivery.configurationIdentity }),
      ...(delivery.durationMs === undefined ? {} : { durationMs: delivery.durationMs }), ...(delivery.resources === undefined ? {} : { resources: delivery.resources }),
      ...(delivery.order === undefined ? {} : { order: delivery.order }),
    }));
  }
  return joined.length === 0 && enriched.size === 0 ? observations : [...observations.map(item => enriched.get(item) ?? item), ...joined];
}

const isExecutionFailure = observation => observation.reportedResult?.kind === "skill-error";

/**
 * The orders providers have missed alike: refused by `orderChannels` or more distinct providers
 * (organizing work/staffing `ORDER_CHANNELS`, the default of the order-channels axis). A miss is then
 * the order's, not its makers', so its refusals teach routing nothing about any provider, and
 * dispatch reports the order incomplete instead of trying another maker.
 */
export function incompleteOrders(observations, { orderChannels = ORDER_CHANNELS } = {}) {
  const missedBy = new Map();
  for (const o of effectiveReceiverObservations(observations)) {
    if (isExecutionFailure(o) || typeof o.order !== "string" || !((o.kind === "receiver-outcome" && o.outcome === "refused") || o.kind === "receiver-attempt-refusal")) continue;
    if (!missedBy.has(o.order)) missedBy.set(o.order, new Set());
    missedBy.get(o.order).add(o.provider);
  }
  return new Map([...missedBy].filter(([, providers]) => providers.size >= orderChannels).map(([order, providers]) => [order, Object.freeze([...providers].sort())]));
}

/** Terminal outcomes for one provider and task class, preserving their
 * provider-versus-receiver provenance. */
export function terminalResolutionCounts(provider, taskClass, observations, configurationIdentity = null) {
  const incomplete = incompleteOrders(observations);
  const censored = (o) => !isExecutionFailure(o) && typeof o.order === "string" && incomplete.has(o.order) && o.outcome !== "accepted";
  const relevant = effectiveReceiverObservations(observations).filter((o) => !censored(o) && o.provider === provider && o.taskClass === taskClass && (configurationIdentity === null ? !o.configurationIdentity : o.configurationIdentity === configurationIdentity) && ((o.kind === "receiver-outcome" && ["accepted", "refused"].includes(o.outcome)) || ["provider-refusal", "receiver-attempt-refusal"].includes(o.kind)));
  const receiverAcceptances = relevant.filter((o) => !isExecutionFailure(o) && o.kind === "receiver-outcome" && o.outcome === "accepted").length;
  const receiverRefusals = relevant.filter((o) => !isExecutionFailure(o) && ((o.kind === "receiver-outcome" && o.outcome === "refused") || o.kind === "receiver-attempt-refusal")).length;
  const providerRefusals = relevant.filter((o) => o.kind === "provider-refusal").length;
  const executionFailures = relevant.filter(isExecutionFailure).length;
  return { receiverAcceptances, receiverRefusals, providerRefusals, ...(executionFailures === 0 ? {} : { executionFailures }), successfulResolutions: receiverAcceptances, terminalResolutions: relevant.length };
}

/** Compatibility projection for callers using the older ambiguous names. */
export function reliabilityCounts(provider, taskClass, observations) {
  const counts = terminalResolutionCounts(provider, taskClass, observations);
  return { successes: counts.successfulResolutions, total: counts.terminalResolutions };
}

/**
 * Expected resolution price for one declared amount, as an exact fraction:
 * `declaredAmount * (terminalResolutions + 2) / (successfulResolutions + 1)`,
 * a Laplace-smoothed accepted-resolution rate inverted into a price
 * multiplier. No provider declares a real-dollar price (the admitted
 * inference providers price in relative-resolution-milliquanta-v1, an
 * internal credit unit with no stated currency exchange rate); a declared
 * amount alone does not capture terminal resolution — a cheap provider that
 * refuses, or whose delivery the receiver refuses, costs more per
 * receiver-accepted resolution than its declared amount says. Provider-
 * authored pre-delivery refusal and receiver-owned post-delivery refusal
 * stay separate provenance classes though each consumes a terminal attempt;
 * transport obstruction, pending work, and cancellation are censored, not
 * counted, since none is an observed provider outcome. A provider with no
 * observations prices at 2x its declared amount (50% prior reliability); one
 * observed to always succeed converges toward its declared amount; one
 * observed to often refuse prices higher, with no hand-set penalty constant.
 * A $0 declared amount (a free-tier or quota offer) prices at exactly 0
 * regardless of reliability -- the multiplier scales nothing -- so it is
 * accepted here rather than rejected; rankOffers breaks the resulting price
 * tie against other $0 offers on observed reliability instead.
 * @param {{numerator: string|number, denominator: string|number}} amount - the provider's declared amount
 * @param {string} provider - the provider identifier
 * @param {string} taskClass - the task class the amount was declared for
 * @param {ReturnType<typeof loadObservations>} observations - prior observations to price against
 * @returns {{numerator: string, denominator: string, basis: ReturnType<typeof terminalResolutionCounts>}} the expected price as an exact fraction, with its basis counts
 */
export function expectedResolutionPrice(amount, provider, taskClass, observations, configurationIdentity = null) {
  const declared = exactNonnegativeAmount(amount.numerator, amount.denominator);
  const basis = terminalResolutionCounts(provider, taskClass, observations, configurationIdentity);
  const numerator = BigInt(declared.numerator) * BigInt(basis.terminalResolutions + 2);
  const denominator = BigInt(declared.denominator) * BigInt(basis.successfulResolutions + 1);
  return { ...exactNonnegativeAmount(numerator.toString(), denominator.toString()), basis };
}

function compareExactAmount(left, right) {
  const difference = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** Free-goods rule: price alone cannot order two offers whose expected price
 * is a tie (every $0 declared amount prices at exactly 0 regardless of
 * reliability, since the multiplier scales a zero declared amount). Break
 * the tie by the same Laplace-smoothed accepted-resolution rate the price
 * multiplier already inverts: (successfulResolutions+1)/(terminalResolutions+2),
 * compared exactly by cross-multiplication. Higher observed reliability sorts
 * first. A remaining tie (equal or absent observations on both sides) falls
 * back to provider actor order for a deterministic result; latency joins this
 * ladder once the observation carrier records it -- no observation here
 * carries latency today, so it is not fabricated as a criterion. */
function compareSmoothedRate(left, right) {
  const leftRate = (left.basis.successfulResolutions + 1) * (right.basis.terminalResolutions + 2);
  const rightRate = (right.basis.successfulResolutions + 1) * (left.basis.terminalResolutions + 2);
  return rightRate - leftRate;
}

/** Rank offers ascending by expected resolution price, tied offers broken by
 * observed reliability then provider order (see compareSmoothedRate). Each
 * offer names one provider and one already-selected consideration (this
 * market narrows to a single asset ladder, via chooseConsideration's
 * alternative-order selection, before ranking ever runs -- ranking never
 * converts across assets). */
export function rankOffers(taskClass, offers, observations) {
  if (typeof taskClass !== "string" || taskClass.trim() === "") throw new Error("taskClass must be nonempty text");
  if (!Array.isArray(offers) || offers.length === 0) throw new Error("offers must be one nonempty array");
  const priced = offers.map((offer) => {
    const { provider, consideration } = offer;
    if (typeof provider !== "string" || provider.trim() === "") throw new Error("offer.provider must be nonempty text");
    const declaredAmount = exactNonnegativeAmount(consideration.amount.numerator, consideration.amount.denominator);
    const price = expectedResolutionPrice(declaredAmount, provider, taskClass, observations, offer.configurationIdentity ?? null);
    return {
      provider,
      ...(offer.offerId ? { offerId: offer.offerId } : {}),
      ...(offer.configurationIdentity ? { configurationIdentity: offer.configurationIdentity } : {}),
      declaredAmount,
      asset: consideration.asset,
      unit: consideration.unit,
      expectedPrice: { numerator: price.numerator, denominator: price.denominator },
      basis: price.basis,
    };
  });
  return priced.sort((a, b) => compareExactAmount(a.expectedPrice, b.expectedPrice) || compareSmoothedRate(a, b) || a.provider.localeCompare(b.provider));
}
