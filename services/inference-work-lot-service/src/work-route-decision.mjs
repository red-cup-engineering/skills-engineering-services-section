import { exactAmount } from "./exact-amount.mjs";

export const ROUTE_DECISION_CRITERIA = Object.freeze(["consideration", "resources", "latency", "acceptance-probability"]);
const criterionSet = new Set(ROUTE_DECISION_CRITERIA);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(label + " must be one object");
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(label + " must be nonempty text");
  return value;
}
function textSet(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) throw new TypeError(label + " must be an array of nonempty text");
  if (new Set(value).size !== value.length) throw new TypeError(label + " must not contain duplicates");
  return value;
}
function fraction(value, label) {
  object(value, label);
  const normalized = exactAmount(value.numerator, value.denominator);
  if (normalized.numerator !== value.numerator || normalized.denominator !== value.denominator) throw new TypeError(label + " must be a normalized exact fraction");
  return normalized;
}
function compareFraction(left, right) {
  const difference = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
function addFraction(left, right) {
  return exactAmount(
    (BigInt(left.numerator) * BigInt(right.denominator) + BigInt(right.numerator) * BigInt(left.denominator)).toString(),
    (BigInt(left.denominator) * BigInt(right.denominator)).toString(),
  );
}
function mean(total, count) {
  return exactAmount(total.numerator, (BigInt(total.denominator) * BigInt(count)).toString());
}
function dimensionKey(value) {
  return [value.kind ?? value.resource, value.asset ?? "", value.unit].join("\u0000");
}
function sameKeys(left, right) {
  return left.length === right.length && left.every((key) => right.includes(key));
}
function validateDimension(value, label, category) {
  object(value, label);
  if (category === "consideration") {
    text(value.kind, label + ".kind");
    text(value.asset, label + ".asset");
  } else text(value.resource, label + ".resource");
  text(value.unit, label + ".unit");
  fraction(value.amount, label + ".amount");
  return value;
}
function validatePolicy(value) {
  const policy = object(value, "demand.routePolicy");
  if (!Array.isArray(policy.preferenceOrder) || policy.preferenceOrder.length === 0) throw new TypeError("route policy must contain ordered Pareto groups");
  const seen = [];
  policy.preferenceOrder.forEach((group, index) => {
    textSet(group, "preference group " + index);
    for (const criterion of group) {
      if (!criterionSet.has(criterion)) throw new TypeError("unsupported route criterion " + criterion);
      if (seen.includes(criterion)) throw new TypeError("route criterion is repeated: " + criterion);
      seen.push(criterion);
    }
  });
  if (!sameKeys(seen, ROUTE_DECISION_CRITERIA)) throw new TypeError("route policy must rank every RouteDecision criterion exactly once");
  if (!["forbid", "prefer-exact-accepted"].includes(policy.reuse)) throw new TypeError("route reuse policy must be forbid or prefer-exact-accepted");
  const unknownObservations = policy.unknownObservations ?? "choice-required";
  if (!["choice-required", "prefer-observed"].includes(unknownObservations)) throw new TypeError("unknown observation policy must be choice-required or prefer-observed");
  const considerationPreference = policy.considerationPreference ?? [];
  if (!Array.isArray(considerationPreference)) throw new TypeError("considerationPreference must be an ordered array");
  considerationPreference.forEach((alternative, index) => {
    if (!Array.isArray(alternative) || alternative.length === 0) throw new TypeError("consideration preference " + index + " must contain dimensions");
    alternative.forEach((dimension, dimensionIndex) => {
      object(dimension, "considerationPreference[" + index + "][" + dimensionIndex + "]");
      text(dimension.kind, "consideration preference kind");
      text(dimension.asset, "consideration preference asset");
      text(dimension.unit, "consideration preference unit");
    });
  });
  return { ...policy, unknownObservations, considerationPreference };
}
function validateDemand(value) {
  const demand = object(value, "typed work demand");
  if (demand.type !== "TypedWorkDemand") throw new TypeError("demand.type must be TypedWorkDemand");
  text(demand.id, "demand.id");
  text(demand.taskClass, "demand.taskClass");
  text(demand.principal, "demand.principal");
  textSet(demand.requiredCapabilities, "demand.requiredCapabilities");
  textSet(demand.requiredQualityTiers ?? [], "demand.requiredQualityTiers");
  text(demand.effect, "demand.effect");
  text(demand.idempotence, "demand.idempotence");
  const context = object(demand.context, "demand.context");
  text(context.identity, "demand.context.identity");
  text(context.authorityScope, "demand.context.authorityScope");
  text(context.freshnessIdentity, "demand.context.freshnessIdentity");
  text(object(demand.outputContract, "demand.outputContract").identity, "demand.outputContract.identity");
  if (demand.difficulty !== undefined) fraction(demand.difficulty, "demand.difficulty");
  const measures = object(demand.measures ?? {}, "demand.measures");
  for (const [name, amount] of Object.entries(measures)) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError("demand.measures." + name + " must be a nonnegative safe integer");
  }
  return { ...demand, requiredQualityTiers: demand.requiredQualityTiers ?? [], measures, routePolicy: validatePolicy(demand.routePolicy) };
}
function validateOffer(value) {
  const offer = object(value, "normalized endpoint offer");
  if (offer.type !== "NormalizedEndpointOffer") throw new TypeError("offer.type must be NormalizedEndpointOffer");
  for (const field of ["id", "provider", "endpointClass", "operation", "implementationIdentity"]) text(offer[field], "offer." + field);
  textSet(offer.capabilities, "offer.capabilities");
  textSet(offer.qualityTiers ?? [], "offer.qualityTiers");
  textSet(offer.authorityScopes, "offer.authorityScopes");
  textSet(offer.effects, "offer.effects");
  textSet(offer.idempotence, "offer.idempotence");
  if (offer.availability !== "available") throw new TypeError("offer.availability must be available");
  if (!Number.isSafeInteger(offer.availableCapacity) || offer.availableCapacity < 0) throw new TypeError("offer.availableCapacity must be a nonnegative safe integer");
  const bounds = object(offer.bounds ?? {}, "offer.bounds");
  if (bounds.maximumDifficulty !== undefined) fraction(bounds.maximumDifficulty, "offer.bounds.maximumDifficulty");
  for (const [name, amount] of Object.entries(bounds)) {
    if (name !== "maximumDifficulty" && (!Number.isSafeInteger(amount) || amount < 0)) throw new TypeError("offer.bounds." + name + " must be a nonnegative safe integer");
  }
  if (!Array.isArray(offer.consideration) || offer.consideration.length === 0) throw new TypeError("offer.consideration must contain exact dimensions");
  offer.consideration.forEach((dimension, index) => validateDimension(dimension, "offer.consideration[" + index + "]", "consideration"));
  const considerationKeys = offer.consideration.map(dimensionKey);
  if (new Set(considerationKeys).size !== considerationKeys.length) throw new TypeError("offer.consideration repeats a dimension");
  const declaredResources = offer.declaredResources ?? [];
  if (!Array.isArray(declaredResources)) throw new TypeError("offer.declaredResources must be an array");
  declaredResources.forEach((dimension, index) => validateDimension(dimension, "offer.declaredResources[" + index + "]", "resource"));
  const semantics = object(offer.semantics, "offer.semantics");
  if (!["none", "exact-accepted-result"].includes(semantics.reuse)) throw new TypeError("offer.semantics.reuse is invalid");
  return { ...offer, qualityTiers: offer.qualityTiers ?? [], bounds, declaredResources, semantics };
}
function validateObservation(value) {
  const receipt = object(value, "route observation");
  if (receipt.type !== "RouteReceipt") throw new TypeError("observation.type must be RouteReceipt");
  for (const field of ["receipt", "offerId", "taskClass"]) text(receipt[field], "observation." + field);
  if (receipt.kind === "attempt") {
    if (!["accepted", "refused"].includes(receipt.outcome)) throw new TypeError("attempt outcome must be accepted or refused");
    if (receipt.latency !== undefined) {
      object(receipt.latency, "observation.latency");
      text(receipt.latency.unit, "observation.latency.unit");
      fraction(receipt.latency.amount, "observation.latency.amount");
    }
    if (receipt.resources !== undefined) {
      if (!Array.isArray(receipt.resources)) throw new TypeError("observation.resources must be an array");
      receipt.resources.forEach((dimension, index) => validateDimension(dimension, "observation.resources[" + index + "]", "resource"));
    }
  } else if (receipt.kind === "accepted-result") {
    for (const field of ["demandId", "principal", "contextIdentity", "authorityScope", "freshnessIdentity", "outputContractIdentity", "implementationIdentity", "resultReceipt"]) text(receipt[field], "observation." + field);
    if (receipt.outcome !== "accepted" || receipt.reuse !== "permitted") throw new TypeError("accepted-result reuse must be explicitly permitted and accepted");
  } else throw new TypeError("observation.kind must be attempt or accepted-result");
  return receipt;
}
function feasibility(demand, offer) {
  const reasons = [];
  if (offer.availableCapacity < 1) reasons.push("no-available-capacity");
  for (const capability of demand.requiredCapabilities) if (!offer.capabilities.includes(capability)) reasons.push("missing-capability:" + capability);
  for (const tier of demand.requiredQualityTiers) if (!offer.qualityTiers.includes(tier)) reasons.push("missing-quality-tier:" + tier);
  if (!offer.authorityScopes.includes(demand.context.authorityScope)) reasons.push("authority-scope-not-admitted");
  if (!offer.effects.includes(demand.effect)) reasons.push("effect-not-supported");
  if (!offer.idempotence.includes(demand.idempotence)) reasons.push("idempotence-not-supported");
  if (demand.difficulty && offer.bounds.maximumDifficulty && compareFraction(demand.difficulty, offer.bounds.maximumDifficulty) > 0) reasons.push("difficulty-exceeds-bound");
  for (const [name, amount] of Object.entries(demand.measures)) {
    const bound = "maximum" + name[0].toUpperCase() + name.slice(1);
    if (offer.bounds[bound] !== undefined && amount > offer.bounds[bound]) reasons.push(name + "-exceeds-bound");
  }
  if (demand.routePolicy.considerationPreference.length > 0) {
    const keys = offer.consideration.map(dimensionKey).sort();
    const admitted = demand.routePolicy.considerationPreference.some((alternative) => sameKeys(keys, alternative.map(dimensionKey).sort()));
    if (!admitted) reasons.push("no-customer-acceptable-consideration");
  }
  return reasons;
}
function averageObservedDimensions(attempts, field) {
  if (attempts.length === 0 || attempts.some((receipt) => !Array.isArray(receipt[field]))) return new Map();
  const keys = attempts[0][field].map(dimensionKey).sort();
  if (attempts.some((receipt) => !sameKeys(keys, receipt[field].map(dimensionKey).sort()))) return new Map();
  const totals = new Map();
  for (const receipt of attempts) {
    for (const dimension of receipt[field]) {
      const key = dimensionKey(dimension);
      const prior = totals.get(key);
      totals.set(key, { ...dimension, amount: prior ? addFraction(prior.amount, dimension.amount) : dimension.amount });
    }
  }
  return new Map([...totals].map(([key, dimension]) => [key, { ...dimension, amount: mean(dimension.amount, attempts.length) }]));
}
function observedLatency(attempts) {
  if (attempts.length === 0 || attempts.some((receipt) => !receipt.latency)) return new Map();
  const units = new Set(attempts.map((receipt) => receipt.latency.unit));
  if (units.size !== 1) return new Map();
  const total = attempts.reduce((sum, receipt) => addFraction(sum, receipt.latency.amount), { numerator: "0", denominator: "1" });
  const dimension = { resource: "latency", unit: attempts[0].latency.unit, amount: mean(total, attempts.length) };
  return new Map([[dimensionKey(dimension), dimension]]);
}
function metrics(demand, offer, observations) {
  const attempts = observations.filter((receipt) => receipt.kind === "attempt" && receipt.offerId === offer.id && receipt.taskClass === demand.taskClass);
  const observedResources = averageObservedDimensions(attempts, "resources");
  return {
    consideration: new Map(offer.consideration.map((dimension) => [dimensionKey(dimension), dimension])),
    resources: attempts.length === 0 ? new Map(offer.declaredResources.map((dimension) => [dimensionKey(dimension), dimension])) : observedResources,
    latency: observedLatency(attempts),
    acceptanceProbability: attempts.length === 0 ? null : exactAmount(attempts.filter((receipt) => receipt.outcome === "accepted").length, attempts.length),
    basis: Object.freeze({ attempts: attempts.length, accepted: attempts.filter((receipt) => receipt.outcome === "accepted").length, receipts: Object.freeze(attempts.map((receipt) => receipt.receipt).sort()) }),
  };
}
function reusableReceipt(demand, offer, observations) {
  if (demand.routePolicy.reuse !== "prefer-exact-accepted" || offer.semantics.reuse !== "exact-accepted-result") return null;
  return observations.find((receipt) => receipt.kind === "accepted-result"
    && receipt.offerId === offer.id && receipt.taskClass === demand.taskClass && receipt.demandId === demand.id
    && receipt.principal === demand.principal && receipt.contextIdentity === demand.context.identity
    && receipt.authorityScope === demand.context.authorityScope && receipt.freshnessIdentity === demand.context.freshnessIdentity
    && receipt.outputContractIdentity === demand.outputContract.identity && receipt.implementationIdentity === offer.implementationIdentity) ?? null;
}
function vectorRelation(left, right, direction, unknownPolicy) {
  const leftKeys = [...left.keys()].sort();
  const rightKeys = [...right.keys()].sort();
  if (!sameKeys(leftKeys, rightKeys)) {
    if (unknownPolicy === "prefer-observed" && (leftKeys.length === 0 || rightKeys.length === 0)) return leftKeys.length > rightKeys.length ? -1 : 1;
    return null;
  }
  let leftBetter = false;
  let rightBetter = false;
  for (const key of leftKeys) {
    const compared = compareFraction(left.get(key).amount, right.get(key).amount) * direction;
    leftBetter ||= compared < 0;
    rightBetter ||= compared > 0;
  }
  if (leftBetter && rightBetter) return null;
  return leftBetter ? -1 : rightBetter ? 1 : 0;
}
function considerationRank(candidate, policy) {
  if (policy.considerationPreference.length === 0) return null;
  const candidateKeys = [...candidate.metrics.consideration.keys()].sort();
  return policy.considerationPreference.findIndex((alternative) => sameKeys(candidateKeys, alternative.map(dimensionKey).sort()));
}
function criterionRelation(left, right, criterion, policy) {
  if (criterion === "consideration") {
    const leftRank = considerationRank(left, policy);
    const rightRank = considerationRank(right, policy);
    if (leftRank !== null && leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
    return vectorRelation(left.metrics.consideration, right.metrics.consideration, 1, policy.unknownObservations);
  }
  if (criterion === "resources") return vectorRelation(left.metrics.resources, right.metrics.resources, 1, policy.unknownObservations);
  if (criterion === "latency") return vectorRelation(left.metrics.latency, right.metrics.latency, 1, policy.unknownObservations);
  const leftProbability = left.metrics.acceptanceProbability;
  const rightProbability = right.metrics.acceptanceProbability;
  if (!leftProbability || !rightProbability) {
    if (!leftProbability && !rightProbability) return 0;
    if (policy.unknownObservations === "prefer-observed") return leftProbability ? -1 : 1;
    return null;
  }
  return compareFraction(leftProbability, rightProbability) * -1;
}
function candidateRelation(left, right, policy) {
  for (const group of policy.preferenceOrder) {
    const relations = group.map((criterion) => criterionRelation(left, right, criterion, policy));
    if (relations.some((relation) => relation === null)) return null;
    const leftBetter = relations.some((relation) => relation === -1);
    const rightBetter = relations.some((relation) => relation === 1);
    if (leftBetter && rightBetter) return null;
    if (leftBetter) return -1;
    if (rightBetter) return 1;
  }
  return 0;
}
function paretoLayers(candidates, policy) {
  const remaining = [...candidates];
  const result = [];
  while (remaining.length > 0) {
    const frontier = remaining.filter((candidate) => !remaining.some((other) => other !== candidate && candidateRelation(other, candidate, policy) === -1));
    frontier.sort((left, right) => left.offer.id.localeCompare(right.offer.id));
    const equivalent = frontier.every((left, index) => frontier.slice(index + 1).every((right) => candidateRelation(left, right, policy) === 0));
    result.push({ candidates: frontier, relation: frontier.length === 1 ? "single" : equivalent ? "equivalent" : "incomparable" });
    for (const candidate of frontier) remaining.splice(remaining.indexOf(candidate), 1);
  }
  return result;
}
function attemptPlan(routeLayers) {
  return Object.freeze(routeLayers.map((layer, rank) => Object.freeze({
    rank,
    relation: layer.relation,
    offers: Object.freeze(layer.candidates.map((candidate) => Object.freeze({
      offerId: candidate.offer.id,
      provider: candidate.offer.provider,
      endpointClass: candidate.offer.endpointClass,
      reuseReceipt: candidate.reuse?.resultReceipt ?? null,
      observationBasis: candidate.metrics.basis,
    }))),
    execution: "explicit-sequential-authority-required",
    implicitFallbackPermitted: false,
    speculativeExecutionPermitted: false,
    stopCondition: "customer-assayed-acceptance",
  })));
}

/** Pure endpoint-neutral selection: no invocation, retry, batching, speculative
 * execution, cross-asset scalarization, or provider-name policy. */
export function decideWorkRoute({ demand: demandValue, offers: offerValues, observations: observationValues = [] }) {
  const demand = validateDemand(demandValue);
  if (!Array.isArray(offerValues)) throw new TypeError("offers must be an array");
  if (!Array.isArray(observationValues)) throw new TypeError("observations must be an array");
  const observations = observationValues.map(validateObservation);
  const refused = [];
  const feasible = [];
  for (const value of offerValues) {
    let offer;
    try {
      offer = validateOffer(value);
    } catch (error) {
      refused.push(Object.freeze({ offerId: value?.id ?? "unknown", reasons: Object.freeze(["invalid-offer:" + error.message]) }));
      continue;
    }
    const reasons = feasibility(demand, offer);
    if (reasons.length > 0) {
      refused.push(Object.freeze({ offerId: offer.id, reasons: Object.freeze(reasons) }));
      continue;
    }
    feasible.push({ offer, metrics: metrics(demand, offer, observations), reuse: reusableReceipt(demand, offer, observations) });
  }
  if (feasible.length === 0) {
    return Object.freeze({ disposition: "refused", selected: null, attemptPlan: Object.freeze([]), refused: Object.freeze(refused), rationale: Object.freeze(["exact-feasibility-produced-no-route"]) });
  }
  const reusable = feasible.filter((candidate) => candidate.reuse);
  const candidates = demand.routePolicy.reuse === "prefer-exact-accepted" && reusable.length > 0 ? reusable : feasible;
  const routeLayers = paretoLayers(candidates, demand.routePolicy);
  const top = routeLayers[0];
  const plan = attemptPlan(routeLayers);
  if (top.relation === "incomparable") {
    return Object.freeze({
      disposition: "choice-required",
      selected: null,
      attemptPlan: plan,
      refused: Object.freeze(refused),
      rationale: Object.freeze(["exact-feasibility-first", reusable.length > 0 ? "exact-accepted-reuse-permitted" : "fresh-execution-required", "customer-policy-left-a-non-commensurate-pareto-frontier"]),
    });
  }
  const selected = top.candidates[0];
  return Object.freeze({
    disposition: "selected",
    selected: Object.freeze({ offerId: selected.offer.id, provider: selected.offer.provider, endpointClass: selected.offer.endpointClass, mode: selected.reuse ? "reuse-exact-accepted-result" : "execute", reuseReceipt: selected.reuse?.resultReceipt ?? null }),
    attemptPlan: plan,
    refused: Object.freeze(refused),
    rationale: Object.freeze(["exact-feasibility-first", selected.reuse ? "exact-accepted-reuse-permitted" : "fresh-execution-required", top.relation === "equivalent" ? "equivalent-candidates-stable-offer-id-tie-break" : "customer-ordered-pareto-selection", "provider-and-model-identities-are-provenance-only"]),
  });
}
