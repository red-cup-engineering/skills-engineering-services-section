import { homedir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { admitWorkResourceBinding, createWorkResourceReservations, workResourceAccountKey } from "../dispatch/work-placement/resource-reservations.mjs";
import { jsonValueId } from "../dispatch/sen-carrier.mjs";
import { admitAccountArtifactObservation, artifactUnits } from "./account-artifact-work.mjs";
import { openLedgerJournal } from "./ledger-journal.mjs";

const quantity = (value) => ({ numerator: String(value), denominator: "1" });
/** One host-wide store, so every consumer of an account draws from the same windows. */
export function accountArtifactCapacityStorePath(environment = process.env) {
  const path = environment.INFERENCE_ACCOUNT_CAPACITY_FILE
    ?? (environment.INFERENCE_ACCOUNT_ENTITLEMENTS_FILE ? `${environment.INFERENCE_ACCOUNT_ENTITLEMENTS_FILE}.reservations.sqlite` : null)
    ?? join(environment.XDG_STATE_HOME || join(environment.HOME || homedir(), ".local", "state"), "561-group", "computer-inference-engine", "account-capacity.sqlite");
  if (typeof path !== "string" || !path.trim()) throw new TypeError("account capacity store path is required");
  return path;
}
const dimension = (observation, value) => ({
  resource: "account-entitlement", asset: observation.product, unit: observation.resourceUnit, amount: quantity(value),
});
const capacityWindowIdentity = (observation) => jsonValueId({
  product: observation.product, resourceUnit: observation.resourceUnit, windowIdentity: observation.windowIdentity,
});

function bindingOf(value) {
  const observation = admitAccountArtifactObservation(value);
  const validUntil = new Date(Math.min(Date.parse(observation.validUntil), Date.parse(observation.expiresAt))).toISOString();
  const evidenceIdentity = jsonValueId(observation);
  return {
    providerIdentity: observation.providerIdentity, accountIdentity: observation.accountIdentity,
    windowIdentity: capacityWindowIdentity(observation), evidenceIdentity,
    observedAt: observation.observedAt, validFrom: observation.observedAt, validUntil,
    resetsAt: observation.expiresAt, availableResources: [dimension(observation, observation.remaining)],
    financialControl: {
      type: "WorkResourceFinancialControl", costState: "observed", costEvidenceIdentity: evidenceIdentity,
      costObservedAt: observation.observedAt, costValidUntil: validUntil,
      consideration: [{ kind: "cash", asset: "USD", unit: "USD", amount: quantity(0) }],
      billing: { status: "not-required" }, meterEvidenceIdentity: evidenceIdentity,
      meterObservedAt: observation.observedAt, meterValidUntil: validUntil,
    },
  };
}

/**
 * The capacity store is a semantic-record journal of account windows: each compare-and-set that
 * goes through appends the window's next version, and the highest version recorded for a key is the
 * window as it stands. The check and the append run under the journal's writer lock. Historical custody requires explicit offline receiving.
 */
const OBJECT_KIND = "inference.account-capacity";
/** The store one capacity path names: `get(key)` and `compareAndSet(key, expectedVersion, value)`. */
export function openAccountArtifactCapacityStore(path) {
  const journal = openLedgerJournal(path, OBJECT_KIND);
  const current = (key) => journal.read("window").filter((row) => row.key === key).reduce((top, row) => (top === null || row.version > top.version ? row : top), null);
  return {
    close: () => {},
    get: async (key) => {
      const row = current(key);
      return row ? { ...row.value, version: row.version } : null;
    },
    compareAndSet: async (key, expectedVersion, value) => journal.exclusively(() => {
      const version = current(key)?.version ?? null;
      if (version !== expectedVersion) throw new Error("account-capacity-conflict");
      const next = expectedVersion === null ? 1 : expectedVersion + 1;
      journal.record("window", { key, version: next, value: JSON.parse(JSON.stringify(value)) });
      return { version: next };
    }),
  };
}

function observationFor(packet, observations) {
  if (packet?.type !== "AccountArtifactWorkPacket" || packet.id !== jsonValueId(Object.fromEntries(Object.entries(packet).filter(([key]) => key !== "id")))) throw new TypeError("work packet identity is invalid");
  const observation = (packet.entitlement ? [packet.entitlement] : observations).map(admitAccountArtifactObservation).find((candidate) => jsonValueId(candidate) === packet.entitlementObservation);
  if (!observation || observation.providerIdentity !== packet.providerIdentity || observation.accountIdentity !== packet.accountIdentity || observation.windowIdentity !== packet.windowIdentity || observation.product !== packet.product || observation.resourceUnit !== packet.resourceUnit || artifactUnits(observation, packet.capability) !== packet.quotedUnits) throw new TypeError("packet entitlement observation is unavailable or changed");
  return observation;
}

const refusal = (packet, reason) => ({ type: "WorkResourceReservationResult", disposition: "refused", reservationId: packet.id,
  providerIdentity: packet.providerIdentity, accountIdentity: packet.accountIdentity, windowIdentity: packet.windowIdentity, reason });

/** A new UI reading resets the accounting baseline while preserving unresolved holds and packet identities. */
async function currentBinding(store, candidate, action) {
  const key = workResourceAccountKey(candidate);
  for (let conflict = 0; conflict < 5; conflict += 1) {
    const current = await store.get(key);
    if (!current) return { binding: candidate };
    if (current.type !== "WorkResourceAccountWindow" || !Array.isArray(current.reservations)) return { reason: "resource-capacity-anchor-mismatch" };
    const anchored = admitWorkResourceBinding(current.binding);
    if (isDeepStrictEqual(anchored, candidate)) return { binding: anchored };
    if (action !== "reserve") return { binding: anchored };
    if (Date.parse(candidate.observedAt) <= Date.parse(anchored.observedAt)) return { reason: "resource-observation-superseded" };
    if (anchored.availableResources.length !== candidate.availableResources.length ||
      anchored.availableResources.some((row, index) => row.resource !== candidate.availableResources[index].resource || row.asset !== candidate.availableResources[index].asset || row.unit !== candidate.availableResources[index].unit)) return { reason: "resource-capacity-dimension-changed" };
    // Settled spend is already reflected in the fresh UI reading. Outstanding holds
    // still consume capacity until released or measured, even if the UI omits them.
    const reservations = current.reservations.map((entry) => entry.state === "settled"
      ? { ...entry, resources: entry.resources.map((row) => ({ ...row, amount: quantity(0) })) } : entry);
    try {
      await store.compareAndSet(key, current.version, { type: "WorkResourceAccountWindow", binding: candidate, reservations });
      return { binding: candidate };
    } catch { /* Another consumer changed the window; reread it. */ }
  }
  return { reason: "resource-store-transition-unconfirmed" };
}

/** Inspect currently uncommitted account capacity after local holds and settlements. */
export async function observeAccountArtifactCapacity(value, { storePath, evaluatedAt = new Date().toISOString() }) {
  const observation = admitAccountArtifactObservation(value);
  const store = openAccountArtifactCapacityStore(storePath);
  try {
    const selected = await currentBinding(store, admitWorkResourceBinding(bindingOf(observation)), "reserve");
    if (selected.reason) return { disposition: "refused", reason: selected.reason };
    return createWorkResourceReservations({ store, binding: selected.binding }).observe({ evaluatedAt });
  } finally { store.close(); }
}

/** Commit one packet's account/window capacity through the existing reservation contract. */
export async function transitionAccountArtifactCapacity(packet, observations, { storePath, action, unitsSpent, evaluatedAt = new Date().toISOString() }) {
  if (!["reserve", "attempt", "release", "settle"].includes(action)) throw new TypeError("account capacity action is invalid");
  const observation = observationFor(packet, observations);
  if (action === "settle" && (!Number.isSafeInteger(unitsSpent) || unitsSpent < 0 || unitsSpent > packet.quotedUnits)) throw new TypeError("spent units must fit the reserved amount");
  if (["reserve", "attempt"].includes(action) && (Date.parse(evaluatedAt) < Date.parse(observation.observedAt) || Date.parse(evaluatedAt) >= Math.min(Date.parse(observation.validUntil), Date.parse(observation.expiresAt)))) return refusal(packet, "resource-availability-evidence-not-current");
  const store = openAccountArtifactCapacityStore(storePath);
  try {
    const selected = await currentBinding(store, admitWorkResourceBinding(bindingOf(observation)), action);
    if (selected.reason) return refusal(packet, selected.reason);
    const owner = createWorkResourceReservations({ store, binding: selected.binding });
    return await owner.apply({
      type: "WorkResourceReservationRequest", action, reservationId: packet.id,
      providerIdentity: observation.providerIdentity, accountIdentity: observation.accountIdentity,
      windowIdentity: selected.binding.windowIdentity, evaluatedAt,
      ...(action === "reserve" ? { resources: [dimension(observation, packet.quotedUnits)] } : {}),
      ...(action === "attempt" ? { executionIdentity: packet.id } : {}),
      ...(action === "settle" ? { measuredResources: [dimension(observation, unitsSpent)] } : {}),
    });
  } finally { store.close(); }
}
