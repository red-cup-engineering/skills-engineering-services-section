import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { object, text, instant, validateUniqueDimensions, dimensionKey, addFraction, compareFraction } from "./work-values.mjs";
import { subtractHostRatio } from "@red-cup-engineering/metrologic/number/wire-ratio";
import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

const ZERO = Object.freeze({ numerator: "0", denominator: "1" });
const coordinate = (binding) => [binding.providerIdentity, binding.accountIdentity, binding.windowIdentity];
const same = isDeepStrictEqual;
const resources = (rows) => validateUniqueDimensions(rows, "resources", "resource").map(({ resource, unit, asset, amount }) => ({
  resource, unit, ...(asset === undefined ? {} : { asset }), amount: { ...amount },
})).sort((a, b) => dimensionKey(a).localeCompare(dimensionKey(b)));
const consideration = (rows) => validateUniqueDimensions(rows, "financialControl.consideration", "consideration").map(({ kind, resource, unit, asset, amount }) => ({
  ...(kind === undefined ? {} : { kind }), ...(resource === undefined ? {} : { resource }), unit, ...(asset === undefined ? {} : { asset }), amount: { ...amount },
})).sort((a, b) => dimensionKey(a).localeCompare(dimensionKey(b)));
const positive = (amount) => !amount.numerator.startsWith("-") && amount.numerator !== "0";

/**
 * Admits the financial and metering control for one account/window capacity
 * observation.  A candidate price is deliberately visible but cannot
 * authorize use; a committed nonzero price also needs time-bounded billing
 * authority.  This is operational control evidence, never a ledger posting.
 */
function admitFinancialControl(value) {
  const control = object(value, "resource financial control");
  if (control.type !== "WorkResourceFinancialControl") throw new TypeError("resource financial control type is required");
  if (!["observed", "candidate", "committed"].includes(control.costState)) throw new TypeError("resource financial control costState is invalid");
  for (const field of ["costEvidenceIdentity", "costObservedAt", "costValidUntil", "meterEvidenceIdentity", "meterObservedAt", "meterValidUntil"]) text(control[field], `resource financial control.${field}`);
  const costObservedAt = instant(control.costObservedAt, "resource financial control.costObservedAt");
  const costValidUntil = instant(control.costValidUntil, "resource financial control.costValidUntil");
  const meterObservedAt = instant(control.meterObservedAt, "resource financial control.meterObservedAt");
  const meterValidUntil = instant(control.meterValidUntil, "resource financial control.meterValidUntil");
  if (costObservedAt >= costValidUntil || meterObservedAt >= meterValidUntil) throw new TypeError("resource financial control has an invalid evidence interval");
  const billedConsideration = consideration(control.consideration);
  if (billedConsideration.length === 0) throw new TypeError("resource financial control requires exact consideration dimensions");
  const billing = object(control.billing, "resource financial control.billing");
  if (billing.status === "not-required") {
    if (Object.keys(billing).length !== 1) throw new TypeError("resource financial control not-required billing must be closed");
  } else if (billing.status === "authorized") {
    if (Object.keys(billing).sort().join("\0") !== ["status", "authorityIdentity", "validUntil"].sort().join("\0")) throw new TypeError("resource financial control authorized billing must be closed");
    text(billing.authorityIdentity, "resource financial control.billing.authorityIdentity");
    instant(billing.validUntil, "resource financial control.billing.validUntil");
  } else throw new TypeError("resource financial control billing status is invalid");
  return {
    type: control.type, costState: control.costState, costEvidenceIdentity: control.costEvidenceIdentity,
    costObservedAt: control.costObservedAt, costValidUntil: control.costValidUntil, consideration: billedConsideration,
    billing: { ...billing }, meterEvidenceIdentity: control.meterEvidenceIdentity,
    meterObservedAt: control.meterObservedAt, meterValidUntil: control.meterValidUntil,
  };
}

function financialRefusal(binding, evaluatedAt) {
  const control = binding.financialControl;
  const time = Date.parse(evaluatedAt);
  if (time >= Date.parse(control.meterValidUntil)) return "resource-meter-evidence-not-current";
  if (time >= Date.parse(control.costValidUntil)) return "resource-cost-evidence-not-current";
  const hasCost = control.consideration.some(({ amount }) => positive(amount));
  if (control.costState === "candidate") return "resource-cost-is-candidate";
  if (hasCost && control.costState !== "committed") return "resource-cost-not-committed";
  if (hasCost && control.billing.status !== "authorized") return "resource-billing-authority-not-admitted";
  if (control.billing.status === "authorized" && time >= Date.parse(control.billing.validUntil)) return "resource-billing-authority-expired";
  return null;
}

/** Determines whether admitted capacity may authorize an invocation now.
 * Candidate costs remain inspectable, but only current observed zero-cost or
 * committed, billing-authorized capacity is executable.
 */
export function evaluateWorkResourceControl(value, evaluatedAt) {
  const binding = admitWorkResourceBinding(value);
  const instantValue = instant(evaluatedAt, "resource control evaluatedAt");
  const reason = financialRefusal(binding, instantValue);
  return Object.freeze({ type: "WorkResourceControlEvaluation", disposition: reason ? "refused" : "admitted",
    ...(reason ? { reason } : {}), binding });
}

/** Admits capacity furnished by the runtime's account custodian.
 * @param {object} value Account/window availability evidence.
 * @returns {object} An isolated admitted binding.
 */
export function admitWorkResourceBinding(value) {
  object(value, "resource binding");
  for (const field of ["providerIdentity", "accountIdentity", "windowIdentity", "evidenceIdentity"]) text(value[field], field);
  const observedAt = instant(value.observedAt, "observedAt");
  const validFrom = instant(value.validFrom, "validFrom");
  const validUntil = instant(value.validUntil, "validUntil");
  const resetsAt = instant(value.resetsAt, "resetsAt");
  if (validFrom > observedAt || observedAt >= validUntil || validUntil > resetsAt) throw new TypeError("resource binding has an invalid observation/window interval");
  const availableResources = resources(value.availableResources);
  if (availableResources.length === 0) throw new TypeError("resource binding requires available resources");
  const financialControl = admitFinancialControl(value.financialControl);
  return { providerIdentity: value.providerIdentity, accountIdentity: value.accountIdentity, windowIdentity: value.windowIdentity,
    evidenceIdentity: value.evidenceIdentity, observedAt: value.observedAt, validFrom: value.validFrom, validUntil: value.validUntil,
    resetsAt: value.resetsAt, availableResources, financialControl };
}

/** Identifies shared capacity independently of offer/model/demand identity.
 * @param {object} binding An admitted provider/account/window binding.
 * @returns {string} A canonical SHA-256 ni key accepted by transactional stores.
 */
export function workResourceAccountKey(binding) {
  return makeNiUri(Buffer.from(JSON.stringify(coordinate(binding)), "utf8"));
}

/** Reserves finite resources through an injected authoritative compare-and-set store.
 * @param {{store: object, binding: object, maximumConflicts?: number}} options Server-owned storage and account evidence.
 * @returns {{apply: Function}} One schema-shaped reservation transition operation.
 */
export function createWorkResourceReservations({ store, binding: candidate, maximumConflicts = 4 }) {
  if (typeof store?.get !== "function" || typeof store?.compareAndSet !== "function") throw new TypeError("reservations require an authoritative get/compareAndSet store");
  if (!Number.isSafeInteger(maximumConflicts) || maximumConflicts < 0 || maximumConflicts > 16) throw new TypeError("maximumConflicts must be an integer from zero through sixteen");
  const binding = admitWorkResourceBinding(candidate);
  const key = workResourceAccountKey(binding);
  const answer = (request, disposition, reason, version) => ({
    type: "WorkResourceReservationResult", disposition, reservationId: request.reservationId,
    providerIdentity: binding.providerIdentity, accountIdentity: binding.accountIdentity, windowIdentity: binding.windowIdentity,
    ...(reason ? { reason } : {}), ...(version ? { version } : {}),
  });
  const observation = (evaluatedAt, disposition, reason, version, availableResources) => ({
    type: "WorkResourceAvailabilityObservation", disposition,
    providerIdentity: binding.providerIdentity, accountIdentity: binding.accountIdentity, windowIdentity: binding.windowIdentity,
    evidenceIdentity: binding.evidenceIdentity, evaluatedAt,
    ...(version ? { version } : {}), ...(availableResources ? { availableResources } : {}), ...(reason ? { reason } : {}),
  });
  return Object.freeze({
    /** Reads remaining capacity without changing the authoritative reservation record.
     * @param {{ evaluatedAt: string }} request The observation time within the admitted evidence window.
     * @returns {Promise<object>} A typed capacity observation or explicit refusal.
     */
    async observe(request) {
      object(request, "resource availability observation request");
      const evaluatedAtEpoch = instant(request.evaluatedAt, "evaluatedAt");
      if (evaluatedAtEpoch < Date.parse(binding.observedAt) || evaluatedAtEpoch < Date.parse(binding.validFrom)
        || evaluatedAtEpoch >= Date.parse(binding.validUntil) || evaluatedAtEpoch >= Date.parse(binding.resetsAt)) {
        return observation(request.evaluatedAt, "refused", "resource-availability-evidence-not-current");
      }
      const financial = financialRefusal(binding, request.evaluatedAt);
      if (financial) return observation(request.evaluatedAt, "refused", financial);
      let current;
      try { current = await store.get(key); } catch { return observation(request.evaluatedAt, "refused", "resource-store-read-unavailable"); }
      if (current && (current.type !== "WorkResourceAccountWindow" || !same(current.binding, binding) || !Array.isArray(current.reservations))) {
        return observation(request.evaluatedAt, "refused", "resource-capacity-anchor-mismatch");
      }
      const totals = new Map();
      for (const entry of current?.reservations ?? []) {
        if (entry.state === "released") continue;
        for (const row of entry.resources ?? []) {
          const dimension = dimensionKey(row);
          totals.set(dimension, addFraction(totals.get(dimension) ?? ZERO, row.amount));
        }
      }
      const availableResources = binding.availableResources.map((capacity) => {
        const held = totals.get(dimensionKey(capacity)) ?? ZERO;
        const amount = subtractHostRatio(capacity.amount, held);
        if (amount.numerator.startsWith("-")) throw new Error("resource reservation state exceeds admitted capacity");
        return { resource: capacity.resource, unit: capacity.unit, ...(capacity.asset === undefined ? {} : { asset: capacity.asset }), amount };
      });
      return observation(request.evaluatedAt, "observed", undefined, current?.version, availableResources);
    },
    /** Applies one idempotent hold, attempt, or release transition.
     * @param {object} request A WorkResourceReservationRequest.
     * @returns {Promise<object>} The committed transition or explicit refusal.
     */
    async apply(request) {
      object(request, "reservation request");
      if (request.type !== "WorkResourceReservationRequest") throw new TypeError("reservation request type is required");
      text(request.reservationId, "reservationId");
      if (!["reserve", "attempt", "release", "settle"].includes(request.action)) throw new TypeError("reservation action must be reserve, attempt, release, or settle");
      const evaluatedAt = instant(request.evaluatedAt, "evaluatedAt");
      if (!same(coordinate(request), coordinate(binding))) return answer(request, "refused", "resource-account-binding-mismatch");
      const measured = request.action === "settle" ? resources(request.measuredResources) : undefined;
      const executionIdentity = request.action === "attempt" ? text(request.executionIdentity ?? randomUUID(), "executionIdentity") : undefined;
      const requested = request.action === "reserve" ? resources(request.resources) : undefined;
      if (requested?.length === 0) throw new TypeError("reservation requires at least one resource dimension");
      if (["reserve", "attempt"].includes(request.action) && (evaluatedAt < Date.parse(binding.observedAt) || evaluatedAt < Date.parse(binding.validFrom)
        || evaluatedAt >= Date.parse(binding.validUntil) || evaluatedAt >= Date.parse(binding.resetsAt))) {
        return answer(request, "refused", "resource-availability-evidence-not-current");
      }
      if (["reserve", "attempt"].includes(request.action)) {
        const financial = financialRefusal(binding, request.evaluatedAt);
        if (financial) return answer(request, "refused", financial);
      }
      for (let conflict = 0; conflict <= maximumConflicts; conflict += 1) {
        let current;
        try { current = await store.get(key); } catch { return answer(request, "refused", "resource-store-read-unavailable"); }
        if (current && (current.type !== "WorkResourceAccountWindow" || !same(current.binding, binding) || !Array.isArray(current.reservations))) {
          return answer(request, "refused", "resource-capacity-anchor-mismatch");
        }
        const entries = current?.reservations ?? [];
        const prior = entries.find(({ reservationId }) => reservationId === request.reservationId);
        let next;
        if (request.action === "reserve") {
          if (prior) return prior.state === "released" || !same(prior.reservedResources ?? prior.resources, requested)
            ? answer(request, "refused", "resource-reservation-id-reused", current.version)
            : answer(request, prior.state, undefined, current.version);
          for (const demand of requested) {
            const capacity = binding.availableResources.find((row) => dimensionKey(row) === dimensionKey(demand));
            if (!capacity) return answer(request, "refused", "resource-dimension-not-admitted", current?.version);
            let total = demand.amount;
            for (const held of entries.filter(({ state }) => state !== "released")) {
              const row = held.resources.find((row) => dimensionKey(row) === dimensionKey(demand));
              total = addFraction(total, row?.amount ?? ZERO);
            }
            if (compareFraction(total, capacity.amount) > 0) return answer(request, "refused", "resource-quota-exhausted", current?.version);
          }
          next = { reservationId: request.reservationId, resources: requested, state: "held", reservedAt: request.evaluatedAt };
        } else {
          if (!prior) return answer(request, "refused", "resource-reservation-unknown", current?.version);
          if (request.action === "attempt" && prior.state === "attempted") return prior.executionIdentity === executionIdentity
            ? answer(request, "attempted", undefined, current.version) : answer(request, "refused", "resource-execution-already-claimed", current.version);
          if (request.action === "release" && ["attempted", "settled"].includes(prior.state)) return answer(request, "refused", "resource-attempt-conservatively-charged", current.version);
          if (request.action === "attempt" && prior.state === "released") return answer(request, "refused", "resource-reservation-released", current.version);
          const state = request.action === "attempt" ? "attempted" : request.action === "settle" ? "settled" : "released";
          if (prior.state === "settled") return state === "settled" && same(prior.measuredResources, measured)
            ? answer(request, "settled", undefined, current.version) : answer(request, "refused", "resource-reservation-already-settled", current.version);
          if (state === "settled") {
            if (prior.state !== "attempted") return answer(request, "refused", "resource-settlement-requires-attempt", current.version);
            for (const row of measured) {
              const reserved = prior.resources.find((value) => dimensionKey(value) === dimensionKey(row));
              if (!reserved || compareFraction(row.amount, reserved.amount) > 0) return answer(request, "refused", "resource-measurement-outside-reservation", current.version);
            }
          }
          if (prior.state === state) return answer(request, state, undefined, current.version);
          next = { ...prior, state, updatedAt: request.evaluatedAt, ...(state === "attempted" ? { executionIdentity } : {}), ...(state === "settled" ? {
            reservedResources: prior.resources, measuredResources: measured,
            resources: prior.resources.map((row) => measured.find((value) => dimensionKey(value) === dimensionKey(row)) ?? row),
          } : {}) };
        }
        const record = { type: "WorkResourceAccountWindow", binding, reservations: [...entries.filter(({ reservationId }) => reservationId !== request.reservationId), next] };
        try {
          const written = await store.compareAndSet(key, current?.version ?? null, record);
          return answer(request, next.state, undefined, written.version);
        } catch {
          // Reread after conflict or uncertain response; execution requires a confirmed committed hold.
        }
      }
      return answer(request, "refused", "resource-store-transition-unconfirmed");
    },
  });
}
