// Pure logic for the expected-resolution pricing service. No provider ever
// declares a real-dollar price for its work (the six admitted inference
// providers price themselves in relative-resolution-milliquanta-v1, an
// internal credit unit with no stated exchange rate to any currency). What
// each provider's declared amount does NOT capture is reliability: a cheap
// provider that refuses half the time costs more per completed task than its
// declared amount says. This module turns observed refusal/acceptance history
// into an expected price, in the same exact-fraction arithmetic the rest of
// this service uses, so ranking never introduces floating-point drift or an
// invented cross-asset exchange rate.
//
// expectedResolutionPrice = declaredAmount * (total + 2) / (successes + 1)
//
// This is Laplace-smoothed reliability (successes+1)/(total+2) inverted into
// a price multiplier. A provider with no observations yet prices at 2x its
// declared amount (50% prior reliability); a provider observed to succeed
// every time converges toward its declared amount; a provider observed to
// refuse often prices higher than its declared amount, without ever needing
// a hand-set penalty constant.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { exactAmount } from "./exact-amount.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_ROOT = resolve(HERE, "../data/expected-resolution-pricing");
export const OBSERVATIONS_FILE = "observations.jsonl";
export const DELIVERIES_FILE = "deliveries.jsonl";

function observationsPath(dataRoot) {
  return resolve(dataRoot ?? DEFAULT_DATA_ROOT, OBSERVATIONS_FILE);
}
function deliveriesPath(dataRoot) { return resolve(dataRoot ?? DEFAULT_DATA_ROOT, DELIVERIES_FILE); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function identity(value) { return `urn:sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
function nonempty(value, label) { if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be nonempty text`); return value; }
function readJsonl(path) { return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []; }

export function appendDelivery(delivery, { dataRoot } = {}) {
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) throw new Error("delivery must be one object");
  const body = { kind: "inference-delivery", workLot: nonempty(delivery.workLot, "delivery.workLot"), provider: nonempty(delivery.provider, "delivery.provider"), taskClass: nonempty(delivery.taskClass, "delivery.taskClass"), selectedOffer: nonempty(delivery.selectedOffer, "delivery.selectedOffer"), receipt: nonempty(delivery.receipt, "delivery.receipt"), receiver: nonempty(delivery.receiver, "delivery.receiver") };
  const record = Object.freeze({ id: identity(body), observedAt: new Date().toISOString(), ...body });
  const existing = loadDeliveries({ dataRoot }).find((item) => item.id === record.id);
  if (existing) return existing;
  const path = deliveriesPath(dataRoot); mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(record)}\n`);
  return record;
}
export function loadDeliveries({ dataRoot } = {}) { return readJsonl(deliveriesPath(dataRoot)); }

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
  const priorEvidence = loadObservations({ dataRoot }).find((item) => item.evidence === body.evidence);
  if (priorEvidence) {
    if (canonical(Object.fromEntries(Object.entries(priorEvidence).filter(([key]) => !["id", "observedAt"].includes(key)))) !== canonical(body)) throw new Error("receiver evidence is already bound to a conflicting outcome");
    return priorEvidence;
  }
  const record = Object.freeze({ id: identity({ kind: body.kind, evidence: body.evidence }), observedAt: new Date().toISOString(), ...body });
  const path = observationsPath(dataRoot);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
  return record;
}

/** Record a selected supplier's refusal before delivery. This is not a
 * receiver outcome and cannot masquerade as one: it has its own event kind
 * and does not require a fabricated delivery receipt or receiver. */
export function appendProviderRefusal(refusal, { dataRoot } = {}) {
  if (!refusal || typeof refusal !== "object" || Array.isArray(refusal)) throw new Error("provider refusal must be one object");
  const body = {
    kind: "provider-refusal",
    workLot: nonempty(refusal.workLot, "refusal.workLot"),
    provider: nonempty(refusal.provider, "refusal.provider"),
    taskClass: nonempty(refusal.taskClass, "refusal.taskClass"),
    selectedOffer: nonempty(refusal.selectedOffer, "refusal.selectedOffer"),
    disposition: nonempty(refusal.disposition, "refusal.disposition"),
    evidence: nonempty(refusal.evidence, "refusal.evidence"),
  };
  const observations = loadObservations({ dataRoot });
  const coordinate = observations.find((item) => item.kind === body.kind && item.workLot === body.workLot && item.provider === body.provider && item.selectedOffer === body.selectedOffer);
  if (coordinate) {
    const prior = Object.fromEntries(Object.entries(coordinate).filter(([key]) => !["id", "observedAt"].includes(key)));
    if (canonical(prior) !== canonical(body)) throw new Error("selected provider refusal is already bound to conflicting evidence");
    return coordinate;
  }
  const record = Object.freeze({ id: identity(body), observedAt: new Date().toISOString(), ...body });
  const path = observationsPath(dataRoot); mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(record)}\n`);
  return record;
}

/** Load every observation recorded so far. Absence of the file is absence of
 * observations, never an error: no observations have landed yet. */
export function loadObservations({ dataRoot } = {}) {
  return readJsonl(observationsPath(dataRoot));
}

/** {successes, total} for one provider within one taskClass. Only exact,
 * admitted receiver outcomes enter reliability. */
export function reliabilityCounts(provider, taskClass, observations) {
  const relevant = observations.filter((o) => o.provider === provider && o.taskClass === taskClass && ((o.kind === "receiver-outcome" && ["accepted", "refused"].includes(o.outcome)) || o.kind === "provider-refusal"));
  const successes = relevant.filter((o) => o.outcome === "accepted").length;
  return { successes, total: relevant.length };
}

/** Expected resolution price for one declared amount, as an exact fraction. */
export function expectedResolutionPrice(amount, provider, taskClass, observations) {
  const declared = exactAmount(amount.numerator, amount.denominator);
  const { successes, total } = reliabilityCounts(provider, taskClass, observations);
  const numerator = BigInt(declared.numerator) * BigInt(total + 2);
  const denominator = BigInt(declared.denominator) * BigInt(successes + 1);
  return { ...exactAmount(numerator.toString(), denominator.toString()), basis: { successes, total } };
}

function compareExactAmount(left, right) {
  const difference = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** Rank offers ascending by expected resolution price. Each offer names one
 * provider and one already-selected consideration (this market narrows to a
 * single asset ladder, via chooseConsideration's alternative-order selection,
 * before ranking ever runs -- ranking never converts across assets). */
export function rankOffers(taskClass, offers, observations) {
  if (typeof taskClass !== "string" || taskClass.trim() === "") throw new Error("taskClass must be nonempty text");
  if (!Array.isArray(offers) || offers.length === 0) throw new Error("offers must be one nonempty array");
  const priced = offers.map((offer) => {
    const { provider, consideration } = offer;
    if (typeof provider !== "string" || provider.trim() === "") throw new Error("offer.provider must be nonempty text");
    const declaredAmount = exactAmount(consideration.amount.numerator, consideration.amount.denominator);
    const price = expectedResolutionPrice(declaredAmount, provider, taskClass, observations);
    return {
      provider,
      declaredAmount,
      asset: consideration.asset,
      unit: consideration.unit,
      expectedPrice: { numerator: price.numerator, denominator: price.denominator },
      basis: price.basis,
    };
  });
  return priced.sort((a, b) => compareExactAmount(a.expectedPrice, b.expectedPrice));
}
