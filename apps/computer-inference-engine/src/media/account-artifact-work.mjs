import { readFileSync } from "node:fs";
import { decideWorkPlacement } from "../dispatch/decide-work-placement.mjs";
import { jsonValueId } from "../dispatch/sen-carrier.mjs";
import { completeMediaArtifactWork, createMediaArtifactWorkLot } from "./artifact-work.mjs";

const amount = (value) => ({ numerator: String(value), denominator: "1" });
const nonempty = (value, field) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be nonempty text`);
  return value;
};
const instant = (value, field) => {
  if (!Number.isFinite(Date.parse(nonempty(value, field))) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/u.test(value)) throw new TypeError(`${field} must be an ISO instant with offset`);
  return value;
};

const PROVENANCE = new Set(["operator-ui", "provider-refusal"]);

/** Units one artifact of `capability` draws from the observed pool. */
export const artifactUnits = (observation, capability) => observation.unitsByCapability?.[capability] ?? observation.unitsPerArtifact;

/**
 * One reading of an account's remaining capacity in one window: read from the
 * account UI by an operator, or zeroed by a provider quota refusal. Recurring
 * subscription allowances are not read this way: they are held against in
 * the allowance ledger (allowance-ledger.mjs).
 */
export function admitAccountArtifactObservation(value) {
  if (value?.type !== "AccountArtifactEntitlementObservation") throw new TypeError("account entitlement observation type is invalid");
  for (const field of ["accountIdentity", "providerIdentity", "product", "windowIdentity", "resourceUnit"]) nonempty(value[field], field);
  for (const field of ["observedAt", "validUntil", "expiresAt"]) instant(value[field], field);
  if (Date.parse(value.observedAt) >= Date.parse(value.validUntil) || Date.parse(value.observedAt) >= Date.parse(value.expiresAt)) throw new TypeError("observation validity and expiry must follow observation time");
  if (!Array.isArray(value.capabilities) || !value.capabilities.length || value.capabilities.some((item) => typeof item !== "string" || !item.trim()) || new Set(value.capabilities).size !== value.capabilities.length) throw new TypeError("capabilities must be distinct nonempty text values");
  if (!["operator-mediated", "asynchronous-artifact-provider"].includes(value.executionMode)) throw new TypeError("executionMode is invalid");
  if (value.zeroCash !== true) throw new TypeError("only observed zero-cash entitlement can enter this route");
  if (!Number.isSafeInteger(value.remaining) || value.remaining < 0 || !Number.isSafeInteger(value.unitsPerArtifact) || value.unitsPerArtifact < 1) throw new TypeError("remaining and unitsPerArtifact must be observed nonnegative integers");
  if (value.unitsByCapability !== undefined) {
    const costs = Object.entries(value.unitsByCapability ?? {});
    if (!costs.length || costs.some(([capability, units]) => !value.capabilities.includes(capability) || !Number.isSafeInteger(units) || units < value.unitsPerArtifact)) throw new TypeError("unitsByCapability must price listed capabilities at no less than unitsPerArtifact");
  }
  if (!PROVENANCE.has(value.provenance?.kind) || typeof value.provenance.reference !== "string" || !value.provenance.reference.trim()) throw new TypeError("observation provenance must be an operator UI reading, plan schedule, or provider refusal");
  return Object.freeze({
    type: value.type, accountIdentity: value.accountIdentity, providerIdentity: value.providerIdentity,
    product: value.product, windowIdentity: value.windowIdentity, resourceUnit: value.resourceUnit,
    capabilities: Object.freeze([...value.capabilities]), executionMode: value.executionMode, zeroCash: true,
    observedAt: value.observedAt, validUntil: value.validUntil, expiresAt: value.expiresAt,
    remaining: value.remaining, unitsPerArtifact: value.unitsPerArtifact,
    ...(value.unitsByCapability ? { unitsByCapability: Object.freeze(Object.fromEntries(Object.entries(value.unitsByCapability).sort(([a], [b]) => a.localeCompare(b)))) } : {}),
    provenance: Object.freeze({ kind: value.provenance.kind, reference: value.provenance.reference }),
  });
}

export function loadAccountArtifactObservations(environment = process.env) {
  const path = environment.INFERENCE_ACCOUNT_ENTITLEMENTS_FILE;
  if (!path) return [];
  const document = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(document?.observations)) throw new TypeError("entitlement file must contain observations array");
  return document.observations.map(admitAccountArtifactObservation);
}

export function inspectAccountArtifactResources(observations, { requiredCapabilities = [], zeroCashOnly = true, evaluatedAt = new Date().toISOString() } = {}) {
  const admitted = observations.map(admitAccountArtifactObservation);
  const identities = admitted.map(({ accountIdentity, providerIdentity, product, windowIdentity }) => JSON.stringify([accountIdentity, providerIdentity, product, windowIdentity]));
  if (new Set(identities).size !== identities.length) throw new TypeError("one observation per account, product, and window is required");
  return admitted.map((observation) => {
    const reasons = [];
    if (Date.parse(evaluatedAt) < Date.parse(observation.observedAt) || Date.parse(evaluatedAt) >= Math.min(Date.parse(observation.validUntil), Date.parse(observation.expiresAt))) reasons.push("observation-not-current");
    if (zeroCashOnly && observation.zeroCash !== true) reasons.push("zero-cash-entitlement-not-admitted");
    if (observation.remaining < Math.max(observation.unitsPerArtifact, ...requiredCapabilities.map((capability) => artifactUnits(observation, capability)))) reasons.push("resource-quota-exhausted");
    for (const capability of requiredCapabilities) if (!observation.capabilities.includes(capability)) reasons.push(`missing-capability:${capability}`);
    return Object.freeze({ ...observation, eligibility: reasons.length ? "excluded-by-requested-filters" : "admitted-by-requested-filters", reasons });
  });
}

function offerOf(observation, outputIdentity, capability) {
  const units = artifactUnits(observation, capability);
  const resource = { resource: "account-entitlement", asset: observation.product, unit: observation.resourceUnit };
  const id = jsonValueId({ provider: observation.providerIdentity, account: observation.accountIdentity, window: observation.windowIdentity, product: observation.product, capabilities: observation.capabilities });
  return {
    type: "NormalizedWorkOffer", id, provider: observation.providerIdentity,
    executionClass: observation.executionMode === "operator-mediated" ? "interactive-account-entitlement" : "asynchronous-artifact-provider",
    operation: "prepare-operator-artifact-work", implementationIdentity: `${observation.providerIdentity}/${observation.product}`,
    capabilities: observation.capabilities, qualityTiers: [], authorityScopes: ["urn:scope:public-media-artifact"],
    effects: ["prepare-operator-work-packet"], idempotence: ["idempotent"], dataConstraints: [], custodyConstraints: [],
    outputContractIdentities: [outputIdentity], availability: "available", availableCapacity: Math.floor(observation.remaining / units),
    consideration: [{ kind: "cash", asset: "USD", unit: "USD", amount: amount(0) }],
    declaredResources: [{ ...resource, amount: amount(units) }],
    availabilityEvidence: {
      offerId: id, accountIdentity: observation.accountIdentity, windowIdentity: observation.windowIdentity, providerIdentity: observation.providerIdentity,
      observedAt: observation.observedAt, validUntil: observation.validUntil, expiresAt: observation.expiresAt,
      availableResources: [{ ...resource, amount: amount(observation.remaining) }],
    },
    semantics: { reuse: "none" },
  };
}

/** Select observed capacity by earliest expiry and prepare a packet: reviewable by an operator, or ready for an asynchronous provider. */
export function requestAccountArtifactWork({ workLot, principal, capability, prompt, sources, outputMimeType }, observations, { evaluatedAt = new Date().toISOString() } = {}) {
  const lot = createMediaArtifactWorkLot({ workLot, principal, capability, prompt, sources, outputMimeType });
  const current = inspectAccountArtifactResources(observations, { requiredCapabilities: [capability], evaluatedAt }).filter(({ reasons }) => reasons.length === 0);
  if (!current.length) return Object.freeze({ disposition: "no-current-entitlement", packet: null });
  const outputIdentity = `urn:emsenn:artifact:${capability}:${outputMimeType}`;
  const entries = current.map((observation) => ({ observation, offer: offerOf(observation, outputIdentity, capability) }));
  const offers = entries.map(({ offer }) => offer);
  const demand = {
    type: "TypedWorkDemand", id: workLot, taskClass: `public-media/${capability}`, principal,
    requiredCapabilities: [capability], requiredQualityTiers: [], requiredEffects: ["prepare-operator-work-packet"],
    requiredExecutionClasses: ["interactive-account-entitlement", "asynchronous-artifact-provider"], idempotence: "idempotent",
    context: { identity: lot.id, authorityScope: "urn:scope:public-media-artifact", freshnessIdentity: `urn:freshness:${workLot}`, dataConstraints: [], custodyConstraints: [] },
    outputContract: { identity: outputIdentity }, measures: {},
    routePolicy: { preferenceOrder: [["expiring-resource"], ["consideration-per-acceptance"], ["resources"], ["latency"], ["acceptance-probability"]], reuse: "forbid", unknownObservations: "prefer-observed", unknownAvailability: "refuse", considerationPreference: [], resourceCeilings: [] },
  };
  const route = decideWorkPlacement({ demand, offers, evaluatedAt });
  if (route.disposition !== "selected") return Object.freeze({ disposition: route.disposition, packet: null, route });
  const selected = entries.find(({ offer }) => offer.id === route.selected.offerId).observation;
  const body = {
    type: "AccountArtifactWorkPacket", workLot, principal, capability, prompt, sources: structuredClone(sources), outputMimeType,
    artifactWorkLot: lot.id,
    providerIdentity: selected.providerIdentity, accountIdentity: selected.accountIdentity, product: selected.product,
    executionMode: selected.executionMode, windowIdentity: selected.windowIdentity, resourceUnit: selected.resourceUnit,
    quotedUnits: artifactUnits(selected, capability), entitlement: admitAccountArtifactObservation(selected),
    entitlementObservation: jsonValueId(admitAccountArtifactObservation(selected)), expiresAt: selected.expiresAt,
    preparedAt: evaluatedAt, status: selected.executionMode === "operator-mediated" ? "operator-required" : "provider-ready",
  };
  return Object.freeze({ disposition: body.status, packet: Object.freeze({ id: jsonValueId(body), ...body }), route });
}

/** Record bytes and operator-reported spend before a public artifact is adopted. */
export function completeAccountArtifactWork(packet, { bytes, mimeType, unitsSpent, recordedAt = new Date().toISOString() }) {
  if (packet?.type !== "AccountArtifactWorkPacket" || packet.id !== jsonValueId(Object.fromEntries(Object.entries(packet).filter(([key]) => key !== "id")))) throw new TypeError("work packet identity is invalid");
  const lot = createMediaArtifactWorkLot(packet);
  if (packet.artifactWorkLot && packet.artifactWorkLot !== lot.id) throw new TypeError("packet media work identity is invalid");
  if (!Number.isSafeInteger(unitsSpent) || unitsSpent < 0 || unitsSpent > packet.quotedUnits) throw new TypeError("operator-reported unitsSpent must fit the quoted capacity");
  return completeMediaArtifactWork(lot, {
    providerIdentity: packet.providerIdentity, product: packet.product, executionMode: packet.executionMode,
    bytes, mimeType, packetIdentity: packet.id, accountIdentity: packet.accountIdentity, windowIdentity: packet.windowIdentity,
    resource: { unit: packet.resourceUnit, quoted: packet.quotedUnits, spent: unitsSpent }, recordedAt: instant(recordedAt, "recordedAt"),
  });
}
