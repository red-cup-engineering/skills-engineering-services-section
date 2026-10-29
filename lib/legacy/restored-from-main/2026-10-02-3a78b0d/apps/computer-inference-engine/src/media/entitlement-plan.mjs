/**
 * Recurring account entitlements: a plan states how much of a zero-cash
 * provider product one account receives per usage window, and what each
 * capability costs from that pool. The plan is a prior, not a reading: it
 * projects one AccountArtifactEntitlementObservation per window so planned
 * capacity enters the same reservation ledger as operator UI readings, and a
 * newer reading of the same window (a UI count or a provider refusal)
 * supersedes the projection.
 *
 * A plan's window is an allowance meter (organizing's allowance algebra)
 * under one of the laws that cut time into discrete windows: `period`
 * (every day, week or month, or so many minutes, from an anchor; a billing
 * cycle) or `from-first-spend` (a window of so many hours opens at the first
 * use after the last one reset, the rolling form most consumer AI plans use).
 * A sliding meter has no windows to account into, so it is not a plan.
 * Capacity not spent before a window resets is lost, so
 * allocateEntitlementUnits hands the whole pool out whenever demand exists.
 */
import { admitAllowance, meterWindow } from "@red-cup-engineering/organizing/enterprise";
import { admitAccountArtifactObservation } from "./account-artifact-work.mjs";
import { jsonValueId } from "../dispatch/sen-carrier.mjs";

const HOUR = 3_600_000;
const text = (value, field) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be nonempty text`);
  return value;
};
const count = (value, field, minimum = 1) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${field} must be an integer of at least ${minimum}`);
  return value;
};
const epoch = (value, field) => {
  const parsed = Date.parse(text(value, field));
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be an ISO instant`);
  return parsed;
};
const iso = (milliseconds) => new Date(milliseconds).toISOString();

/** The provider/account/product pool a plan describes, stable across plan revisions. */
export const entitlementLineIdentity = ({ providerIdentity, accountIdentity, product, resourceUnit }) =>
  jsonValueId({ type: "AccountEntitlementLine", providerIdentity, accountIdentity, product, resourceUnit });

export function admitRecurringEntitlementPlan(value) {
  if (value?.type !== "RecurringEntitlementPlan") throw new TypeError("recurring entitlement plan type is invalid");
  for (const field of ["providerIdentity", "accountIdentity", "product", "resourceUnit"]) text(value[field], field);
  if (!["operator-mediated", "asynchronous-artifact-provider"].includes(value.executionMode)) throw new TypeError("executionMode is invalid");
  if (value.zeroCash !== true) throw new TypeError("only zero-cash entitlement plans are admitted");
  if (!["period", "from-first-spend"].includes(value.window?.law)) throw new TypeError("window.law must be period or from-first-spend");
  count(value.capacity, "capacity");
  const costs = Object.entries(value.unitsByCapability ?? {});
  if (!costs.length) throw new TypeError("unitsByCapability must price at least one capability");
  for (const [capability, units] of costs) { text(capability, "capability"); count(units, `unitsByCapability.${capability}`); }
  if (value.provenance?.kind !== "plan-statement") throw new TypeError("plan provenance must be a plan statement");
  text(value.provenance.reference, "provenance.reference");
  epoch(value.provenance.statedAt, "provenance.statedAt");
  const { id: _id, budget: _budget, ...window } = admitAllowance({
    id: value.product, account: value.accountIdentity, product: value.product, unit: value.resourceUnit, because: value.provenance.reference,
    meters: [{ ...value.window, id: "window", budget: value.capacity }], costs: value.unitsByCapability,
  }).meters[0];
  const body = {
    type: value.type, providerIdentity: value.providerIdentity, accountIdentity: value.accountIdentity,
    product: value.product, resourceUnit: value.resourceUnit, executionMode: value.executionMode, zeroCash: true,
    window, capacity: value.capacity, unitsByCapability: Object.fromEntries(costs.sort(([a], [b]) => a.localeCompare(b))),
    provenance: { kind: "plan-statement", reference: value.provenance.reference, statedAt: value.provenance.statedAt },
  };
  return Object.freeze({ id: jsonValueId(body), line: entitlementLineIdentity(body), ...body });
}

/** The plan's window as the allowance meter it is, for reading its spends against. */
export const entitlementMeter = (plan) => Object.freeze({ id: plan.id, ...plan.window, budget: plan.capacity });

/**
 * The window containing `at`. A from-first-spend plan continues `previous`
 * (the latest opened window) until it resets; after that the next window
 * would open at `at`, so nothing is opened by looking.
 */
export function entitlementWindowAt(plan, at, { previous } = {}) {
  const now = epoch(at, "at");
  const window = meterWindow(entitlementMeter(plan), previous ? [Date.parse(previous.opensAt)] : [], now);
  const opensAt = window.opensAt ?? now;
  const resetsAt = window.resetsAt ?? now + plan.window.hours * HOUR;
  return Object.freeze({ windowIdentity: `${plan.line}@${iso(opensAt)}`, opensAt: iso(opensAt), resetsAt: iso(resetsAt) });
}

const observationOf = (plan, window, { observedAt, remaining, provenance }) => admitAccountArtifactObservation({
  type: "AccountArtifactEntitlementObservation",
  accountIdentity: plan.accountIdentity, providerIdentity: plan.providerIdentity, product: plan.product,
  windowIdentity: window.windowIdentity, resourceUnit: plan.resourceUnit,
  capabilities: Object.keys(plan.unitsByCapability), unitsByCapability: plan.unitsByCapability,
  unitsPerArtifact: Math.min(...Object.values(plan.unitsByCapability)),
  executionMode: plan.executionMode, zeroCash: true,
  observedAt, validUntil: window.resetsAt, expiresAt: window.resetsAt, remaining, provenance,
});

/** The plan's full capacity for one window, as of the moment it opens. */
export const projectEntitlementObservation = (plan, window) =>
  observationOf(plan, window, { observedAt: window.opensAt, remaining: plan.capacity, provenance: { kind: "plan-schedule", reference: plan.id } });

/** A count read from the provider's account UI for this window. */
export function readEntitlementObservation(plan, window, { observedAt, remaining, reference }) {
  count(remaining, "remaining", 0);
  return observationOf(plan, window, { observedAt, remaining, provenance: { kind: "operator-ui", reference: text(reference, "reference") } });
}

/** The provider refused work for quota: nothing remains until this window resets. */
export const refusalEntitlementObservation = (plan, window, { observedAt, reference }) =>
  observationOf(plan, window, { observedAt, remaining: 0, provenance: { kind: "provider-refusal", reference: text(reference, "reference") } });

/**
 * Divide `available` units among demands, one artifact at a time: highest
 * priority first, then the consumer least served per unit of weight (units
 * already `served` over the caller's horizon plus units granted here), then
 * identity order. It is work-conserving: a demand whose capability no longer
 * fits is skipped while a cheaper one still does, because unspent units are
 * lost at reset.
 *
 * @param {{available: number, unitsByCapability: object, demands: Array<{consumer: string, capability: string, wanted: number, weight?: number, priority?: number, served?: number}>}} input
 * @returns {{grants: Array<object>, allocatedUnits: number, unallocatedUnits: number}}
 */
export function allocateEntitlementUnits({ available, unitsByCapability, demands }) {
  count(available, "available", 0);
  if (!Array.isArray(demands)) throw new TypeError("demands must be an array");
  const rows = demands.map((demand) => {
    text(demand.consumer, "consumer");
    const units = count(unitsByCapability?.[text(demand.capability, "capability")], `unitsByCapability.${demand.capability}`);
    const weight = demand.weight ?? 1;
    if (!(typeof weight === "number" && weight > 0 && Number.isFinite(weight))) throw new TypeError("weight must be a positive number");
    return { consumer: demand.consumer, capability: demand.capability, units, weight, wanted: count(demand.wanted, "wanted", 0),
      priority: Number.isSafeInteger(demand.priority) ? demand.priority : 0, served: count(demand.served ?? 0, "served", 0), artifacts: 0 };
  });
  const keys = rows.map(({ consumer, capability }) => `${consumer}\u0000${capability}`);
  if (new Set(keys).size !== keys.length) throw new TypeError("one demand per consumer and capability is required");
  const servedBy = new Map(rows.map(({ consumer }) => [consumer, 0]));
  for (const row of rows) servedBy.set(row.consumer, Math.max(servedBy.get(row.consumer), row.served));
  let remaining = available;
  for (;;) {
    const open = rows.filter((row) => row.artifacts < row.wanted && row.units <= remaining);
    if (!open.length) break;
    open.sort((a, b) => b.priority - a.priority
      || servedBy.get(a.consumer) / a.weight - servedBy.get(b.consumer) / b.weight
      || a.consumer.localeCompare(b.consumer) || a.capability.localeCompare(b.capability));
    const chosen = open[0];
    chosen.artifacts += 1;
    remaining -= chosen.units;
    servedBy.set(chosen.consumer, servedBy.get(chosen.consumer) + chosen.units);
  }
  const grants = rows.filter(({ artifacts }) => artifacts > 0).map(({ consumer, capability, artifacts, units }) =>
    Object.freeze({ consumer, capability, artifacts, units: artifacts * units }));
  return Object.freeze({ grants: Object.freeze(grants), allocatedUnits: available - remaining, unallocatedUnits: remaining });
}
