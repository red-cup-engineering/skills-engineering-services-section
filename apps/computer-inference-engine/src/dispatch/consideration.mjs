import { jsonValueId } from "./sen-carrier.mjs";
import { compareHostRatio, positiveHostRatio } from "@red-cup-engineering/metrologic/number/wire-ratio";
export { positiveHostRatio as exactAmount } from "@red-cup-engineering/metrologic/number/wire-ratio";

export const CONSIDERATION_KINDS = Object.freeze(["credit", "currency", "resource", "service"]);
export const DIRECT_WITNESS_SETTLEMENT_CAPABILITY = "urn:union:settlement-capability:direct-witness-v1";
export const X402_SETTLEMENT_CAPABILITY = "urn:union:settlement-capability:x402-v2";
// These identifiers are accepted only by the explicit data migrators below.
// They are not emitted by the current consideration law.
export const DIRECT_WITNESS_ADAPTER = "urn:union:settlement-adapter:direct-witness-v1";
export const X402_ADAPTER = "urn:union:settlement-adapter:x402-v2";
export const RESOLUTION_CREDIT_ASSET = "urn:union:credit:relative-resolution-milliquanta-v1";
export const RESOLUTION_CREDIT_UNIT = "relative-resolution-milliquanta-v1";

const kinds = new Set(CONSIDERATION_KINDS);
const identify = (value) => {
  return jsonValueId(value);
};
const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be one object`);
  return value;
};
const text = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be nonempty text`);
  return value;
};
function amount(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an exact fraction`);
  const normalized = positiveHostRatio(value.numerator, value.denominator);
  if (value.numerator !== normalized.numerator || value.denominator !== normalized.denominator) throw new Error(`${label} must be a normalized exact fraction`);
  return value;
}
function compareAmount(left, right) {
  amount(left, "left amount"); amount(right, "right amount");
  return compareHostRatio(left, right);
}
function migrateSettlementCapability(value) {
  if (value === DIRECT_WITNESS_ADAPTER) return DIRECT_WITNESS_SETTLEMENT_CAPABILITY;
  if (value === X402_ADAPTER) return X402_SETTLEMENT_CAPABILITY;
  return value;
}
export function migrateConsiderationAlternative(value) {
  const alternative = object(value, "consideration alternative migration source");
  return Object.freeze({ ...alternative, obligations: Object.freeze((alternative.obligations ?? []).map((obligation) => {
    const { settlementAdapter: _retired, ...current } = obligation;
    return Object.freeze({
      ...current,
      amount: typeof obligation.amount === "number" ? positiveHostRatio(BigInt(obligation.amount)) : positiveHostRatio(obligation.amount?.numerator, obligation.amount?.denominator),
      settlementCapability: migrateSettlementCapability(obligation.settlementCapability ?? obligation.settlementAdapter),
    });
  })) });
}
export function migrateConsiderationPolicy(value) {
  const policy = object(value, "consideration policy migration source");
  return Object.freeze({ ...policy, acceptableAlternatives: Object.freeze((policy.acceptableAlternatives ?? []).map((alternative) => Object.freeze({
    ...alternative,
    obligations: Object.freeze((alternative.obligations ?? []).map((obligation) => Object.freeze({
      kind: obligation.kind,
      asset: obligation.asset,
      unit: obligation.unit,
      settlementCapabilities: Object.freeze((obligation.settlementCapabilities ?? obligation.settlementAdapters ?? []).map(migrateSettlementCapability)),
    }))),
  }))) });
}
const obligationKey = ({ kind, asset, unit }) => `${kind}\u0000${asset}\u0000${unit}`;

export function validateConsiderationAlternative(value) {
  const alternative = object(value, "consideration alternative");
  text(alternative.id, "consideration alternative id");
  if (!Array.isArray(alternative.obligations) || alternative.obligations.length === 0) throw new Error("consideration alternative must contain obligations");
  const ids = new Set(), keys = new Set();
  for (const obligation of alternative.obligations) {
    object(obligation, "consideration obligation");
    text(obligation.id, "consideration obligation id");
    if (ids.has(obligation.id)) throw new Error("consideration alternative repeats an obligation id");
    ids.add(obligation.id);
    if (!kinds.has(obligation.kind)) throw new Error("consideration obligation kind must be credit, currency, resource, or service");
    text(obligation.asset, "consideration obligation asset");
    amount(obligation.amount, "consideration obligation amount");
    text(obligation.unit, "consideration obligation unit");
    if (typeof obligation.settlementCapability !== "string" || !obligation.settlementCapability.startsWith("urn:")) throw new Error("consideration obligation settlementCapability must be one exact URN");
    const key = obligationKey(obligation);
    if (keys.has(key)) throw new Error("consideration alternative repeats an asset obligation");
    keys.add(key);
    if (obligation.kind !== "currency" && obligation.settlementCapability === X402_SETTLEMENT_CAPABILITY) throw new Error("x402 may settle only a currency obligation");
  }
  return alternative;
}

export function validateConsiderationPolicy(value) {
  const policy = object(value, "consideration policy");
  if (policy.type !== "ConsiderationPolicy") throw new Error("consideration policy has the wrong type");
  if (!Array.isArray(policy.acceptableAlternatives) || policy.acceptableAlternatives.length === 0) throw new Error("consideration policy must contain ordered acceptableAlternatives");
  const ids = new Set();
  for (const alternative of policy.acceptableAlternatives) {
    object(alternative, "acceptable consideration alternative");
    text(alternative.id, "acceptable consideration alternative id");
    if (ids.has(alternative.id)) throw new Error("consideration policy repeats an alternative id");
    ids.add(alternative.id);
    if (!Array.isArray(alternative.obligations) || alternative.obligations.length === 0) throw new Error("acceptable consideration alternative must contain obligations");
    const keys = new Set();
    for (const obligation of alternative.obligations) {
      object(obligation, "acceptable consideration obligation");
      if (!kinds.has(obligation.kind)) throw new Error("acceptable obligation kind must be credit, currency, resource, or service");
      text(obligation.asset, "acceptable obligation asset");
      text(obligation.unit, "acceptable obligation unit");
      if (Object.hasOwn(obligation, "maximumAmount")) throw new Error("maximumAmount is retired; market pressure selects among provider-authored exact prices");
      if (!Array.isArray(obligation.settlementCapabilities) || obligation.settlementCapabilities.length === 0 || obligation.settlementCapabilities.some((capability) => typeof capability !== "string" || !capability.startsWith("urn:"))) throw new Error("acceptable obligation settlementCapabilities must be nonempty exact URNs");
      if (obligation.kind !== "currency" && obligation.settlementCapabilities.includes(X402_SETTLEMENT_CAPABILITY)) throw new Error("x402 may be accepted only for a currency obligation");
      const key = obligationKey(obligation);
      if (keys.has(key)) throw new Error("acceptable alternative repeats an asset obligation");
      keys.add(key);
    }
  }
  return policy;
}

export function resolutionCreditPolicy() {
  return Object.freeze({
    type: "ConsiderationPolicy",
    acceptableAlternatives: Object.freeze([Object.freeze({
      id: "resolution-credit",
      obligations: Object.freeze([Object.freeze({
        kind: "credit",
        asset: RESOLUTION_CREDIT_ASSET,
        unit: RESOLUTION_CREDIT_UNIT,
        settlementCapabilities: Object.freeze([DIRECT_WITNESS_SETTLEMENT_CAPABILITY]),
      })]),
    })]),
  });
}

export function considerationPolicyIsSubpolicy(candidateValue, ceilingValue) {
  const candidate = validateConsiderationPolicy(candidateValue);
  const ceiling = validateConsiderationPolicy(ceilingValue);
  return candidate.acceptableAlternatives.every((alternative) => ceiling.acceptableAlternatives.some((allowed) => {
    if (alternative.obligations.length !== allowed.obligations.length) return false;
    const allowedByKey = new Map(allowed.obligations.map((obligation) => [obligationKey(obligation), obligation]));
    return alternative.obligations.every((obligation) => {
      const bound = allowedByKey.get(obligationKey(obligation));
      return bound && obligation.settlementCapabilities.every((capability) => bound.settlementCapabilities.includes(capability));
    });
  }));
}

function matchAlternative(providerAlternative, policyAlternative, preferenceRank) {
  validateConsiderationAlternative(providerAlternative);
  if (providerAlternative.obligations.length !== policyAlternative.obligations.length) return null;
  const accepted = new Map(policyAlternative.obligations.map((obligation) => [obligationKey(obligation), obligation]));
  for (const obligation of providerAlternative.obligations) {
    const ceiling = accepted.get(obligationKey(obligation));
    if (!ceiling || !ceiling.settlementCapabilities.includes(obligation.settlementCapability)) return null;
  }
  return Object.freeze({
    providerAlternative: providerAlternative.id,
    policyAlternative: policyAlternative.id,
    preferenceRank,
    obligations: Object.freeze([...providerAlternative.obligations].sort((left, right) => obligationKey(left).localeCompare(obligationKey(right)))),
  });
}

function dominates(left, right) {
  if (left.preferenceRank !== right.preferenceRank || left.obligations.length !== right.obligations.length) return false;
  const rightAmounts = new Map(right.obligations.map((obligation) => [obligationKey(obligation), obligation.amount]));
  let strictlyLess = false;
  for (const obligation of left.obligations) {
    const other = rightAmounts.get(obligationKey(obligation));
    if (other === undefined || compareAmount(obligation.amount, other) > 0) return false;
    if (compareAmount(obligation.amount, other) < 0) strictlyLess = true;
  }
  return strictlyLess;
}

function sameBundle(left, right) {
  return left.preferenceRank === right.preferenceRank && JSON.stringify(left.obligations) === JSON.stringify(right.obligations);
}

export function chooseConsideration(entries, policyValue) {
  const policy = validateConsiderationPolicy(policyValue);
  const candidates = [], refused = [];
  for (const entry of entries) {
    const alternatives = entry?.offer?.object?.considerationAlternatives;
    if (!Array.isArray(alternatives) || alternatives.length === 0) {
      refused.push({ actor: entry?.provider?.actor ?? "unknown", reason: "provider-offer-has-no-consideration-alternatives" });
      continue;
    }
    const matches = [];
    alternatives.forEach((alternative) => policy.acceptableAlternatives.forEach((acceptable, preferenceRank) => {
      const match = matchAlternative(alternative, acceptable, preferenceRank);
      if (match) matches.push(match);
    }));
    if (matches.length === 0) {
      refused.push({ actor: entry.provider.actor, reason: "no-customer-acceptable-consideration" });
      continue;
    }
    const bestRank = Math.min(...matches.map(({ preferenceRank }) => preferenceRank));
    const ranked = matches.filter(({ preferenceRank }) => preferenceRank === bestRank);
    const frontier = ranked.filter((candidate) => !ranked.some((other) => dominates(other, candidate)));
    if (frontier.length > 1 && !frontier.every((candidate) => sameBundle(candidate, frontier[0]))) {
      refused.push({ actor: entry.provider.actor, reason: "provider-alternatives-require-customer-choice" });
      continue;
    }
    candidates.push({ entry, consideration: [...frontier].sort((left, right) => left.providerAlternative.localeCompare(right.providerAlternative))[0] });
  }
  if (candidates.length === 0) return Object.freeze({ disposition: "no-customer-acceptable-consideration", candidates, refused });
  const bestRank = Math.min(...candidates.map(({ consideration }) => consideration.preferenceRank));
  const preferred = candidates.filter(({ consideration }) => consideration.preferenceRank === bestRank);
  const frontier = preferred.filter((candidate) => !preferred.some((other) => dominates(other.consideration, candidate.consideration)));
  if (frontier.length > 1 && !frontier.every((candidate) => sameBundle(candidate.consideration, frontier[0].consideration))) {
    return Object.freeze({ disposition: "customer-consideration-choice-required", candidates: frontier, refused });
  }
  const ranked = [...preferred].sort((left, right) => {
    if (dominates(left.consideration, right.consideration)) return -1;
    if (dominates(right.consideration, left.consideration)) return 1;
    return left.entry.offer.id.localeCompare(right.entry.offer.id);
  });
  return Object.freeze({ disposition: "consideration-selected", selected: ranked[0], ranked, refused });
}

export function createExchangeCompact({ demand, offer, customer, provider, consideration, createdAt }) {
  text(demand, "compact demand commitment");
  text(offer, "compact offer id");
  object(customer, "compact customer");
  object(provider, "compact provider");
  object(consideration, "compact consideration");
  text(createdAt, "compact createdAt");
  const migrated = migrateConsiderationAlternative({ id: consideration.providerAlternative, obligations: consideration.obligations });
  migrated.obligations.forEach((obligation) => amount(obligation.amount, "compact obligation amount"));
  const compact = {
    type: "InferenceExchangeCompact",
    demand,
    offer,
    customer: { actor: text(customer.actor, "customer actor"), account: text(customer.account, "customer account") },
    provider: { actor: text(provider.actor, "provider actor"), account: text(provider.account, "provider account") },
    consideration: {
      providerAlternative: text(consideration.providerAlternative, "provider alternative"),
      policyAlternative: text(consideration.policyAlternative, "policy alternative"),
      obligations: migrated.obligations.map((obligation) => ({ ...obligation })),
    },
    createdAt,
  };
  return Object.freeze({ id: identify(compact), ...compact });
}

export function createExchangeReceipt(compactValue, settlement) {
  const compact = object(compactValue, "exchange compact");
  if (compact.type !== "InferenceExchangeCompact" || typeof compact.id !== "string") throw new Error("exchange compact is not identified");
  object(settlement, "work settlement");
  const completed = settlement.disposition === "completion";
  const receipt = {
    type: "InferenceExchangeReceipt",
    compact: compact.id,
    work: {
      status: completed ? "fulfilled" : "refused",
      evidence: text(settlement.completion, "work settlement evidence"),
    },
    consideration: compact.consideration.obligations.map((obligation) => ({
      obligation: obligation.id,
      status: completed ? "pending" : "not-due",
      evidence: null,
      settlementCapability: obligation.settlementCapability,
    })),
  };
  return Object.freeze({ id: identify(receipt), ...receipt });
}

export function appendConsiderationEvidence(receiptValue, { obligation, status, evidence }) {
  const receipt = object(receiptValue, "exchange receipt");
  if (receipt.type !== "InferenceExchangeReceipt" || typeof receipt.id !== "string") throw new Error("exchange receipt is not identified");
  if (!["fulfilled", "not-due"].includes(status)) throw new Error("consideration evidence status must be fulfilled or not-due");
  text(evidence, "consideration evidence");
  const current = receipt.consideration.find((entry) => entry.obligation === obligation);
  if (!current) throw new Error("consideration evidence names no compact obligation");
  if (current.status !== "pending") throw new Error("consideration obligation is no longer pending");
  const successor = {
    type: "InferenceExchangeReceipt",
    previous: receipt.id,
    compact: receipt.compact,
    work: receipt.work,
    consideration: receipt.consideration.map((entry) => entry.obligation === obligation ? { ...entry, status, evidence } : entry),
  };
  return Object.freeze({ id: identify(successor), ...successor });
}
