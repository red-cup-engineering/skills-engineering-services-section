
// "consideration" is superseded by "consideration-per-acceptance": best-value
// ranking divides consideration by the posterior acceptance estimate, so the
// two never rank independently; keeping considerationRank's ranking-group
// semantics (below) is the only part of bare "consideration" worth keeping.
// Latency is observed (a placement's measured time is kept with its outcome) but never ranks a
// placement: the market places by what an accepted result costs, not by how soon it comes.
export const WORK_PLACEMENT_CRITERIA = Object.freeze(["consideration-per-acceptance", "resources", "acceptance-probability", "expiring-resource"]);
const requiredCriteria = WORK_PLACEMENT_CRITERIA.filter((criterion) => criterion !== "expiring-resource");
const criterionSet = new Set(WORK_PLACEMENT_CRITERIA);

import { object, text, instant, textSet, normalizedFraction, fraction, exactAmount, compareFraction, addFraction, divideFraction, mean, dimensionKey, sameKeys, validateDimension, validateUniqueDimensions } from './work-placement/work-values.mjs';
import { admitWorkPlacementObservationField } from './work-placement/work-observations.mjs';
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";
import { allocateAttention } from "@red-cup-engineering/metrologic/obstruction/attention-allocation";
export { admitWorkPlacementObservationField, workPlacementObservationRelation, workPlacementObservationType } from './work-placement/work-observations.mjs';

function validatePolicy(value) {
  const policy = object(value, "demand.routePolicy");
  if (!Array.isArray(policy.preferenceOrder) || policy.preferenceOrder.length === 0) throw new TypeError("route policy must contain ordered Pareto groups");
  const seen = [];
  policy.preferenceOrder.forEach((group, index) => {
    textSet(group, "preference group " + index);
    for (const criterion of group) {
      if (!criterionSet.has(criterion)) throw new TypeError("unsupported placement criterion " + criterion);
      if (seen.includes(criterion)) throw new TypeError("placement criterion is repeated: " + criterion);
      seen.push(criterion);
    }
  });
  if (!requiredCriteria.every((criterion) => seen.includes(criterion))) throw new TypeError("route policy must rank every required work-placement criterion exactly once");
  if (!["forbid", "prefer-exact-accepted"].includes(policy.reuse)) throw new TypeError("route reuse policy must be forbid or prefer-exact-accepted");
  const unknownObservations = policy.unknownObservations ?? "choice-required";
  if (!["choice-required", "prefer-observed"].includes(unknownObservations)) throw new TypeError("unknown observation policy must be choice-required or prefer-observed");
  const considerationPreference = policy.considerationPreference ?? [];
  if (!Array.isArray(considerationPreference)) throw new TypeError("considerationPreference must be an ordered array");
  const unknownAvailability = policy.unknownAvailability ?? "permit";
  if (!["permit", "refuse"].includes(unknownAvailability)) throw new TypeError("unknown availability policy must be permit or refuse");
  considerationPreference.forEach((alternative, index) => {
    if (!Array.isArray(alternative) || alternative.length === 0) throw new TypeError("consideration preference " + index + " must contain dimensions");
    validateUniqueDimensions(alternative, "considerationPreference[" + index + "]", "consideration", false);
  });
  const considerationCeilings = validateUniqueDimensions(policy.considerationCeilings ?? [], "considerationCeilings", "consideration");
  const resourceCeilings = validateUniqueDimensions(policy.resourceCeilings ?? [], "resourceCeilings", "resource");
  return { ...policy, unknownObservations, unknownAvailability, considerationPreference, considerationCeilings, resourceCeilings };
}
/**
 * Admits and normalizes one TypedWorkDemand without selecting a provider or performing effects.
 * @param {object} value A TypedWorkDemand candidate.
 * @returns {object} The normalized TypedWorkDemand.
 * @throws {TypeError} When the TypedWorkDemand contract is invalid.
 */
export function admitTypedWorkDemand(value) {
  const demand = object(value, "typed work demand");
  if (demand.type !== "TypedWorkDemand") throw new TypeError("demand.type must be TypedWorkDemand");
  text(demand.id, "demand.id");
  text(demand.taskClass, "demand.taskClass");
  text(demand.principal, "demand.principal");
  textSet(demand.requiredCapabilities, "demand.requiredCapabilities");
  textSet(demand.requiredQualityTiers ?? [], "demand.requiredQualityTiers");
  textSet(demand.requiredEffects, "demand.requiredEffects");
  textSet(demand.requiredExecutionClasses, "demand.requiredExecutionClasses");
  if (demand.requiredImplementationIdentity !== undefined) text(demand.requiredImplementationIdentity, "demand.requiredImplementationIdentity");
  text(demand.idempotence, "demand.idempotence");
  const context = object(demand.context, "demand.context");
  text(context.identity, "demand.context.identity");
  text(context.authorityScope, "demand.context.authorityScope");
  text(context.freshnessIdentity, "demand.context.freshnessIdentity");
  textSet(context.dataConstraints, "demand.context.dataConstraints");
  textSet(context.custodyConstraints, "demand.context.custodyConstraints");
  text(object(demand.outputContract, "demand.outputContract").identity, "demand.outputContract.identity");
  if (demand.difficulty !== undefined) fraction(demand.difficulty, "demand.difficulty");
  const measures = object(demand.measures ?? {}, "demand.measures");
  for (const [name, amount] of Object.entries(measures)) if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError("demand.measures." + name + " must be a nonnegative safe integer");
  return { ...demand, requiredQualityTiers: demand.requiredQualityTiers ?? [], measures, routePolicy: validatePolicy(demand.routePolicy) };
}
function availabilityEvidence(value, offer) {
  if (value === undefined) return null;
  const evidence = object(value, "offer.availabilityEvidence");
  for (const field of ["offerId", "accountIdentity", "windowIdentity", "providerIdentity"]) text(evidence[field], "offer.availabilityEvidence." + field);
  const observedAtEpoch = instant(evidence.observedAt, "offer.availabilityEvidence.observedAt");
  if (evidence.offerId !== offer.id || evidence.providerIdentity !== offer.provider) throw new TypeError("offer availability evidence does not bind this offer and provider");
  const bounds = {};
  for (const field of ["validFrom", "validUntil", "resetsAt", "expiresAt"]) if (evidence[field] !== undefined) bounds[field + "Epoch"] = instant(evidence[field], "offer.availabilityEvidence." + field);
  if (!Array.isArray(evidence.availableResources)) throw new TypeError("offer.availabilityEvidence.availableResources must be an array");
  return { ...evidence, ...bounds, observedAtEpoch, availableResources: validateUniqueDimensions(evidence.availableResources, "offer.availabilityEvidence.availableResources", "resource") };
}
function validateOffer(value) {
  const offer = object(value, "normalized work offer");
  if (offer.type !== "NormalizedWorkOffer") throw new TypeError("offer.type must be NormalizedWorkOffer");
  for (const field of ["id", "provider", "executionClass", "operation", "implementationIdentity"]) text(offer[field], "offer." + field);
  textSet(offer.capabilities, "offer.capabilities");
  textSet(offer.qualityTiers ?? [], "offer.qualityTiers");
  textSet(offer.authorityScopes, "offer.authorityScopes");
  textSet(offer.effects, "offer.effects");
  textSet(offer.idempotence, "offer.idempotence");
  textSet(offer.dataConstraints, "offer.dataConstraints");
  textSet(offer.custodyConstraints, "offer.custodyConstraints");
  textSet(offer.outputContractIdentities, "offer.outputContractIdentities");
  if (offer.availability !== "available") throw new TypeError("offer.availability must be available");
  if (!Number.isSafeInteger(offer.availableCapacity) || offer.availableCapacity < 0) throw new TypeError("offer.availableCapacity must be a nonnegative safe integer");
  const bounds = object(offer.bounds ?? {}, "offer.bounds");
  if (bounds.maximumDifficulty !== undefined) fraction(bounds.maximumDifficulty, "offer.bounds.maximumDifficulty");
  for (const [name, amount] of Object.entries(bounds)) if (name !== "maximumDifficulty" && (!Number.isSafeInteger(amount) || amount < 0)) throw new TypeError("offer.bounds." + name + " must be a nonnegative safe integer");
  const consideration = validateUniqueDimensions(offer.consideration, "offer.consideration", "consideration");
  if (consideration.length === 0) throw new TypeError("offer.consideration must contain exact dimensions, using canonical zero amounts when applicable");
  const declaredResources = validateUniqueDimensions(offer.declaredResources ?? [], "offer.declaredResources", "resource");
  const availableResources = validateUniqueDimensions(offer.availableResources ?? [], "offer.availableResources", "resource");
  const semantics = object(offer.semantics, "offer.semantics");
  if (!["none", "exact-accepted-result"].includes(semantics.reuse)) throw new TypeError("offer.semantics.reuse is invalid");
  const evidence = availabilityEvidence(offer.availabilityEvidence, offer);
  return { ...offer, qualityTiers: offer.qualityTiers ?? [], bounds, consideration, declaredResources, ...(offer.availableResources === undefined ? {} : { availableResources }), ...(evidence ? { availabilityEvidence: evidence } : {}), semantics };
}
function validateObservation(value) {
  const observation = value;
  if (observation.kind === "attempt") {
    if (observation.latency !== undefined) {
      fraction(observation.latency.amount, "observation.latency.amount");
    }
    if (observation.resources !== undefined) validateUniqueDimensions(observation.resources, "observation.resources", "resource");
  } else if (observation.kind === "accepted-result") {
    admitTypedWorkDemand(observation.demand);
  }
  return observation;
}
function feasibility(demand, offer, evaluatedAt) {
  const reasons = [];
  if (offer.availableCapacity < 1) reasons.push("no-available-capacity");
  if (demand.requiredImplementationIdentity !== undefined && offer.implementationIdentity !== demand.requiredImplementationIdentity) reasons.push("implementation-identity-not-required:" + offer.implementationIdentity);
  for (const capability of demand.requiredCapabilities) if (!offer.capabilities.includes(capability)) reasons.push("missing-capability:" + capability);
  for (const tier of demand.requiredQualityTiers) if (!offer.qualityTiers.includes(tier)) reasons.push("missing-quality-tier:" + tier);
  if (!demand.requiredExecutionClasses.includes(offer.executionClass)) reasons.push("execution-class-not-admitted:" + offer.executionClass);
  if (!offer.authorityScopes.includes(demand.context.authorityScope)) reasons.push("authority-scope-not-admitted");
  for (const effect of demand.requiredEffects) if (!offer.effects.includes(effect)) reasons.push("effect-not-supported:" + effect);
  if (!offer.idempotence.includes(demand.idempotence)) reasons.push("idempotence-not-supported");
  for (const constraint of demand.context.dataConstraints) if (!offer.dataConstraints.includes(constraint)) reasons.push("data-constraint-not-satisfied:" + constraint);
  for (const constraint of demand.context.custodyConstraints) if (!offer.custodyConstraints.includes(constraint)) reasons.push("custody-constraint-not-satisfied:" + constraint);
  if (!offer.outputContractIdentities.includes(demand.outputContract.identity)) reasons.push("output-contract-not-supported");
  if (demand.difficulty && offer.bounds.maximumDifficulty && compareFraction(demand.difficulty, offer.bounds.maximumDifficulty) > 0) reasons.push("difficulty-exceeds-bound");
  for (const [name, amount] of Object.entries(demand.measures)) {
    const bound = "maximum" + name[0].toUpperCase() + name.slice(1);
    if (offer.bounds[bound] !== undefined && amount > offer.bounds[bound]) reasons.push(name + "-exceeds-bound");
  }
  const ceilings = new Map(demand.routePolicy.considerationCeilings.map((dimension) => [dimensionKey(dimension), dimension.amount]));
  for (const dimension of offer.consideration) {
    const ceiling = ceilings.get(dimensionKey(dimension));
    if (ceiling && compareFraction(dimension.amount, ceiling) > 0) reasons.push("consideration-exceeds-ceiling:" + dimension.kind + ":" + dimension.asset + ":" + dimension.unit);
  }
  const resourceCeilings = new Map(demand.routePolicy.resourceCeilings.map((dimension) => [dimensionKey(dimension), dimension.amount]));
  const declaredResourceKeys = new Set(offer.declaredResources.map(dimensionKey));
  for (const key of resourceCeilings.keys()) if (!declaredResourceKeys.has(key)) reasons.push("resource-declaration-unknown:" + key.replaceAll("\u0000", ":"));
  const evidence = offer.availabilityEvidence;
  const evaluatedAtEpoch = evaluatedAt === undefined ? null : instant(evaluatedAt, "evaluatedAt");
  if (evidence && (evaluatedAtEpoch === null || evidence.observedAtEpoch > evaluatedAtEpoch || (evidence.validFromEpoch !== undefined && evaluatedAtEpoch < evidence.validFromEpoch) || (evidence.validUntilEpoch !== undefined && evaluatedAtEpoch >= evidence.validUntilEpoch) || (evidence.resetsAtEpoch !== undefined && evaluatedAtEpoch >= evidence.resetsAtEpoch) || (evidence.expiresAtEpoch !== undefined && evaluatedAtEpoch >= evidence.expiresAtEpoch))) reasons.push("availability-evidence-not-current");
  if (!evidence && demand.routePolicy.unknownAvailability === "refuse") reasons.push("availability-evidence-unknown");
  const availableResources = new Map((evidence?.availableResources ?? offer.availableResources ?? []).map((dimension) => [dimensionKey(dimension), dimension.amount]));
  for (const dimension of offer.declaredResources) {
    const key = dimensionKey(dimension);
    const ceiling = resourceCeilings.get(key);
    if (ceiling && compareFraction(dimension.amount, ceiling) > 0) reasons.push("resource-exceeds-ceiling:" + [dimension.resource, dimension.asset ?? "", dimension.unit].join(":"));
    const available = availableResources.get(key);
    if (evidence && available === undefined) reasons.push("resource-availability-unknown:" + [dimension.resource, dimension.asset ?? "", dimension.unit].join(":"));
    else if (available && compareFraction(dimension.amount, available) > 0) reasons.push("resource-quota-exhausted:" + [dimension.resource, dimension.asset ?? "", dimension.unit].join(":"));
  }
  if (demand.routePolicy.considerationPreference.length > 0) {
    const keys = offer.consideration.map(dimensionKey).sort();
    const admitted = demand.routePolicy.considerationPreference.some((alternative) => sameKeys(keys, alternative.map(dimensionKey).sort()));
    if (!admitted) reasons.push("no-customer-acceptable-consideration");
  }
  return reasons;
}
function averageObservedDimensions(attempts, field) {
  if (attempts.length === 0 || attempts.some((observation) => !Array.isArray(observation[field]))) return new Map();
  const keys = attempts[0][field].map(dimensionKey).sort();
  if (attempts.some((observation) => !sameKeys(keys, observation[field].map(dimensionKey).sort()))) return new Map();
  const totals = new Map();
  for (const observation of attempts) for (const dimension of observation[field]) {
    const key = dimensionKey(dimension);
    const prior = totals.get(key);
    totals.set(key, { ...dimension, amount: prior ? addFraction(prior.amount, dimension.amount) : dimension.amount });
  }
  return new Map([...totals].map(([key, dimension]) => [key, { ...dimension, amount: mean(dimension.amount, attempts.length) }]));
}
function observedLatency(attempts) {
  if (attempts.length === 0 || attempts.some((observation) => !observation.latency)) return new Map();
  const units = new Set(attempts.map((observation) => observation.latency.unit));
  if (units.size !== 1) return new Map();
  const total = attempts.reduce((sum, observation) => addFraction(sum, observation.latency.amount), exactAmount(0));
  const dimension = { resource: "latency", unit: attempts[0].latency.unit, amount: mean(total, attempts.length) };
  return new Map([[dimensionKey(dimension), dimension]]);
}
function zeroDimensions(dimensions) {
  return new Map(dimensions.map((dimension) => [dimensionKey(dimension), { ...dimension, amount: exactAmount(0) }]));
}
function metrics(demand, offer, observations, reuse) {
  const attempts = observations.filter((observation) => observation.kind === "attempt" && observation.offerId === offer.id && observation.taskClass === demand.taskClass && (offer.availabilityEvidence === undefined || (observation.accountIdentity === offer.availabilityEvidence.accountIdentity && observation.windowIdentity === offer.availabilityEvidence.windowIdentity)));
  const accepted = attempts.filter((observation) => observation.outcome === "accepted").length;
  const priors = observations.filter((observation) => observation.kind === "quality-prior" && observation.offerId === offer.id && observation.taskClass === demand.taskClass);
  const priorAccepted = priors.filter((observation) => observation.outcome === "accepted").length;
  const consideration = new Map(offer.consideration.map((dimension) => [dimensionKey(dimension), dimension]));
  // Beta(1,1) posterior mean (accepted+1)/(attempts+2): always defined and
  // never zero, so an untried offer reads 1/2, a refusal demotes it below
  // untried, and an acceptance promotes it -- deterministic exploration with
  // no randomness, and safe to divide consideration by below.
  // Related configurations supply at most one effective trial. Exact results
  // retain their full weight, and their receipts are never relabelled as this offer.
  const acceptanceProbability = priors.length === 0
    ? exactAmount(accepted + 1, attempts.length + 2)
    : exactAmount(priors.length * (accepted + 1) + priorAccepted, priors.length * (attempts.length + 3));
  return {
    consideration,
    resources: reuse ? zeroDimensions(offer.declaredResources) : attempts.length === 0 ? new Map(offer.declaredResources.map((dimension) => [dimensionKey(dimension), dimension])) : averageObservedDimensions(attempts, "resources"),
    latency: observedLatency(attempts),
    acceptanceProbability,
    // Best value: consideration per accepted outcome. A zero dimension divides
    // to zero, so such ties fall through to acceptanceProbability.
    considerationPerAcceptance: new Map([...consideration].map(([key, dimension]) => [key, { ...dimension, amount: divideFraction(dimension.amount, acceptanceProbability) }])),
    basis: Object.freeze({ attempts: attempts.length, accepted, receipts: Object.freeze(attempts.map((observation) => observation.receipt).sort()), qualityPrior: Object.freeze({ observations: priors.length, accepted: priorAccepted, sourceReceipts: Object.freeze(priors.map((observation) => observation.sourceReceipt).sort()) }) }),
  };
}
function reusableObservation(demand, offer, observations) {
  if (demand.routePolicy.reuse !== "prefer-exact-accepted" || offer.semantics.reuse !== "exact-accepted-result") return null;
  const demandCoordinates = canonical(demand);
  return observations.find((observation) => observation.kind === "accepted-result" && observation.offerId === offer.id && observation.taskClass === demand.taskClass && canonical(admitTypedWorkDemand(observation.demand)) === demandCoordinates && observation.implementationIdentity === offer.implementationIdentity) ?? null;
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
  if (criterion === "expiring-resource") {
    const a = left.offer.availabilityEvidence?.expiresAtEpoch;
    const b = right.offer.availabilityEvidence?.expiresAtEpoch;
    if (a === undefined || b === undefined) {
      if (a === b) return 0;
      return policy.unknownObservations === "prefer-observed" ? (a === undefined ? 1 : -1) : null;
    }
    return Math.sign(a - b);
  }
  if (criterion === "consideration-per-acceptance") {
    const leftRank = considerationRank(left, policy);
    const rightRank = considerationRank(right, policy);
    if (leftRank !== null && leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
    return vectorRelation(left.metrics.considerationPerAcceptance, right.metrics.considerationPerAcceptance, 1, policy.unknownObservations);
  }
  if (criterion === "resources") return vectorRelation(left.metrics.resources, right.metrics.resources, 1, policy.unknownObservations);
  // acceptanceProbability is the Beta(1,1) posterior mean: always defined, so
  // this criterion orders every pair with no unknownObservations fallback.
  return compareFraction(left.metrics.acceptanceProbability, right.metrics.acceptanceProbability) * -1;
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
function orderedDimensions(dimensions) {
  return Object.freeze([...dimensions.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, dimension]) => Object.freeze(dimension)));
}
function attemptPlan(layers) {
  return Object.freeze(layers.map((layer, rank) => Object.freeze({
    rank,
    relation: layer.relation,
    offers: Object.freeze(layer.candidates.map((candidate) => Object.freeze({
      offerId: candidate.offer.id,
      provider: candidate.offer.provider,
      executionClass: candidate.offer.executionClass,
      offer: candidate.offer,
      mode: candidate.reuse ? "reuse-exact-accepted-result" : "execute",
      reuseReceipt: candidate.reuse?.resultReceipt ?? null,
      plannedResources: orderedDimensions(candidate.metrics.resources),
      observationBasis: candidate.metrics.basis,
    }))),
    execution: "explicit-sequential-authority-required",
    implicitFallbackPermitted: false,
    speculativeExecutionPermitted: false,
    stopCondition: "customer-assayed-acceptance",
  })));
}

/**
 * Decides one provider-neutral work placement from exact demand, finite resource and quota, offer, policy, and observation evidence without performing effects.
 * @param {object} request A demand, offers, and observations record.
 * @returns {object} A WorkPlacementDecision or typed WorkPlacementRefusal with an explicit attempt plan.
 * @throws {TypeError} When the demand or observation contract is invalid.
 */
export function decideWorkPlacement({ demand: demandValue, offers: offerValues, observations: observationValues = [], evaluatedAt }) {
  const demand = admitTypedWorkDemand(demandValue);
  if (!Array.isArray(offerValues)) throw new TypeError("offers must be an array");
  const observationField = admitWorkPlacementObservationField(observationValues);
  const observations = observationField.statements.map(item => validateObservation(item.statement.object));
  const byReceipt = new Map();
  for (const item of observationField.statements) {
    const observation = item.statement.object;
    const key = JSON.stringify([observation.kind, observation.receipt]);
    const group = byReceipt.get(key) ?? [];
    group.push(item);
    byReceipt.set(key, group);
  }
  const contested = [...byReceipt.values()].filter(group => group.length > 1).flat();
  const refusals = [];
  const feasible = [];
  for (const value of offerValues) {
    let offer;
    try {
      offer = validateOffer(value);
    } catch (error) {
      refusals.push(Object.freeze({ offerId: value?.id ?? "unknown", reasons: Object.freeze(["invalid-offer:" + error.message]) }));
      continue;
    }
    const reasons = feasibility(demand, offer, evaluatedAt);
    const conflict = contested.filter(item => item.statement.object.offerId === offer.id && item.statement.object.taskClass === demand.taskClass);
    if (conflict.length > 0) reasons.push(...conflict.map(item => "contested-observation:" + item.id));
    if (reasons.length > 0) {
      refusals.push(Object.freeze({ offerId: offer.id, reasons: Object.freeze(reasons) }));
      continue;
    }
    const reuse = reusableObservation(demand, offer, observations);
    feasible.push({ offer, metrics: metrics(demand, offer, observations, reuse), reuse });
  }
  if (feasible.length === 0) return Object.freeze({ type: "WorkPlacementRefusal", version: 1, disposition: "refused", selected: null, attemptPlan: Object.freeze([]), refusals: Object.freeze(refusals), rationale: Object.freeze(["exact-feasibility-produced-no-placement"]) });
  const reusable = feasible.filter((candidate) => candidate.reuse);
  const candidates = demand.routePolicy.reuse === "prefer-exact-accepted" && reusable.length > 0 ? reusable : feasible;
  const layers = paretoLayers(candidates, demand.routePolicy);
  const top = layers[0];
  const plan = attemptPlan(layers);
  if (top.relation === "incomparable") return Object.freeze({ type: "WorkPlacementDecision", version: 1, disposition: "choice-required", selected: null, attemptPlan: plan, refusals: Object.freeze(refusals), rationale: Object.freeze(["exact-feasibility-first", reusable.length > 0 ? "exact-accepted-result-reuse-observed" : "fresh-execution-required", "customer-policy-left-a-non-commensurate-pareto-frontier"]) });
  const selected = top.candidates[0];
  return Object.freeze({
    type: "WorkPlacementDecision",
    version: 1,
    disposition: "selected",
    selected: Object.freeze({ offerId: selected.offer.id, provider: selected.offer.provider, executionClass: selected.offer.executionClass, offer: selected.offer, mode: selected.reuse ? "reuse-exact-accepted-result" : "execute", reuseReceipt: selected.reuse?.resultReceipt ?? null, plannedResources: orderedDimensions(selected.metrics.resources), observationBasis: selected.metrics.basis }),
    attemptPlan: plan,
    refusals: Object.freeze(refusals),
    rationale: Object.freeze(["exact-feasibility-first", selected.reuse ? "exact-accepted-result-reuse-observed" : "fresh-execution-required", top.relation === "equivalent" ? "equivalent-candidates-stable-offer-id-tie-break" : "customer-ordered-pareto-selection", demand.requiredImplementationIdentity === undefined ? "provider-and-model-identities-are-provenance-only" : "required-implementation-identity-is-an-exact-feasibility-constraint"]),
  });
}

/**
 * Admit a finite measured work frontier, preserve each demand's existing Pareto
 * provider decision, and allocate attention only to demands with a selected
 * placement. This is a readout, not execution, quota reservation or acceptance.
 *
 * Attention cost is in one explicitly named natural-count unit. Benefit is the
 * cardinality of explicitly identified, pairwise disjoint held obstructions.
 * Evidence identities attribute the supplied measurements; they do not prove a
 * promised removal has occurred. Provider money/resources are never converted
 * into this unit. Existing receiver observations change provider placement by
 * the established posterior/consideration law, not by inventing benefit.
 * @param {object} request An attributed attention budget and ordered typed work candidates.
 * @returns {object} An effect-free AttentionWorkPlacement with prospective counts and complete placement decisions.
 */
export function decideAttentionWorkPlacement({ budget, candidates, evaluatedAt }) {
  object(budget, "attention budget");
  text(budget.unit, "attention budget.unit");
  text(budget.evidence, "attention budget.evidence");
  const count = (value, label) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(label + " must be a nonnegative safe integer");
    return value;
  };
  count(budget.amount, "attention budget.amount");
  if (!Array.isArray(candidates)) throw new TypeError("attention candidates must be an array");
  const ids = new Set(), held = new Map();
  let totalCost = 0;
  const admitted = candidates.map((candidate) => {
    object(candidate, "attention candidate");
    const demand = admitTypedWorkDemand(candidate.demand);
    if (ids.has(demand.id)) throw new TypeError("attention candidates repeat demand " + demand.id);
    ids.add(demand.id);
    const attention = object(candidate.attention, "candidate.attention");
    const cost = object(attention.cost, "candidate.attention.cost");
    if (cost.unit !== budget.unit) throw new TypeError("attention cost unit differs from budget; no denomination conversion is defined");
    text(cost.evidence, "candidate.attention.cost.evidence");
    totalCost += count(cost.amount, "candidate.attention.cost.amount");
    if (!Number.isSafeInteger(totalCost)) throw new TypeError("attention total cost exceeds safe natural-count arithmetic");
    const obstructions = object(attention.held, "candidate.attention.held");
    text(obstructions.evidence, "candidate.attention.held.evidence");
    textSet(obstructions.atoms, "candidate.attention.held.atoms");
    for (const atom of obstructions.atoms) {
      text(atom, "candidate.attention.held.atoms item");
      if (held.has(atom)) throw new TypeError(`attention benefit is not additive: obstruction ${atom} belongs to both ${held.get(atom)} and ${demand.id}`);
      held.set(atom, demand.id);
    }
    return { candidate, demand, attention, obstruction: { id: demand.id, cost: cost.amount, benefit: obstructions.atoms.length } };
  });
  const eligible = [], deferred = [];
  for (const entry of admitted) {
    const placement = decideWorkPlacement({ demand: entry.demand, offers: entry.candidate.offers,
      observations: entry.candidate.observations ?? [], evaluatedAt });
    const measured = Object.freeze({ demand: entry.demand.id, attention: structuredClone(entry.attention), placement });
    if (placement.disposition === "selected") eligible.push({ ...entry, measured });
    else deferred.push(measured);
  }
  // Do not sort this list: its original order is the handed exact solver's
  // declared tie policy. readNext is the allocator's subsequent reading order.
  const allocation = allocateAttention({ budget: budget.amount, obstructions: eligible.map((entry) => entry.obstruction) });
  const byId = new Map(eligible.map((entry) => [entry.demand.id, entry.measured]));
  const selected = new Set(allocation.readNext);
  const unavailableBenefit = admitted.filter((entry) => !byId.has(entry.demand.id))
    .reduce((sum, entry) => sum + entry.obstruction.benefit, 0);
  return Object.freeze({
    type: "AttentionWorkPlacement",
    budget: Object.freeze({ ...budget }),
    candidateOrder: Object.freeze(admitted.map((entry) => entry.demand.id)),
    allocation,
    planned: Object.freeze(allocation.readNext.map((id) => byId.get(id))),
    deferred: Object.freeze(deferred),
    unfunded: Object.freeze(eligible.filter((entry) => !selected.has(entry.demand.id)).map((entry) => entry.measured)),
    unselected: Object.freeze({ eligible: allocation.residual, unavailable: unavailableBenefit,
      total: allocation.residual + unavailableBenefit, interpretation: "declared-held-mass-not-yet-selected; removal-requires-receiver-evidence" }),
    execution: "explicit-sequential-authority-and-current-resource-admission-required",
    observedRemoval: null,
    sharedResourcesReserved: false,
    customerMutation: false,
    assetSettlementClaimed: false,
  });
}
