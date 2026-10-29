import { WORK_PLACEMENT_CRITERIA, decideWorkPlacement } from "@red-cup-engineering/decide-work-placement-service";

export const ROUTE_DECISION_CRITERIA = WORK_PLACEMENT_CRITERIA;

function unique(values) {
  return [...new Set(values)];
}

function placementDemand(demand, offers) {
  if (!demand || typeof demand !== "object" || Array.isArray(demand)) throw new TypeError("typed work demand must be one object");
  if (demand.requiredEffects === undefined && (typeof demand.effect !== "string" || demand.effect.trim() === "")) throw new TypeError("demand.effect must be nonempty text");
  const { effect, ...genericDemand } = demand;
  return {
    ...genericDemand,
    requiredEffects: demand.requiredEffects ?? [effect],
    requiredExecutionClasses: demand.requiredExecutionClasses ?? unique(offers.flatMap((offer) => {
      const executionClass = offer?.executionClass ?? offer?.endpointClass;
      return typeof executionClass === "string" && executionClass.trim() !== "" ? [executionClass] : [];
    })),
    context: {
      ...demand.context,
      dataConstraints: demand.context?.dataConstraints ?? [],
      custodyConstraints: demand.context?.custodyConstraints ?? [],
    },
    routePolicy: {
      ...demand.routePolicy,
      considerationCeilings: demand.routePolicy?.considerationCeilings ?? [],
      resourceCeilings: demand.routePolicy?.resourceCeilings ?? [],
    },
  };
}

function placementOffer(offer, demand) {
  if (!offer || typeof offer !== "object" || Array.isArray(offer)) return offer;
  const { endpointClass, type: _type, ...genericOffer } = offer;
  return {
    ...genericOffer,
    type: "NormalizedWorkOffer",
    executionClass: offer.executionClass ?? endpointClass,
    dataConstraints: offer.dataConstraints ?? [],
    custodyConstraints: offer.custodyConstraints ?? [],
    outputContractIdentities: offer.outputContractIdentities ?? [demand.outputContract.identity],
  };
}

function observedDemand(observation, demand) {
  return {
    ...demand,
    id: observation.demandId,
    taskClass: observation.taskClass,
    principal: observation.principal,
    context: {
      ...demand.context,
      identity: observation.contextIdentity,
      authorityScope: observation.authorityScope,
      freshnessIdentity: observation.freshnessIdentity,
    },
    outputContract: { ...demand.outputContract, identity: observation.outputContractIdentity },
  };
}

function placementObservation(observation, demand) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) return observation;
  if (observation.type === "WorkPlacementObservation") return observation;
  if (observation.kind === "attempt") return { ...observation, type: "WorkPlacementObservation" };
  const {
    demandId: _demandId,
    principal: _principal,
    contextIdentity: _contextIdentity,
    authorityScope: _authorityScope,
    freshnessIdentity: _freshnessIdentity,
    outputContractIdentity: _outputContractIdentity,
    type: _type,
    ...genericObservation
  } = observation;
  return {
    ...genericObservation,
    type: "WorkPlacementObservation",
    demand: observedDemand(observation, demand),
  };
}

function legacyReason(reason) {
  if (reason.startsWith("effect-not-supported:")) return "effect-not-supported";
  if (reason === "invalid-offer:normalized work offer must be one object") return "invalid-offer:normalized endpoint offer must be one object";
  return reason;
}

function legacyRationale(rationale) {
  return rationale.map((reason) => {
    if (reason === "exact-feasibility-produced-no-placement") return "exact-feasibility-produced-no-route";
    if (reason === "exact-accepted-result-reuse-observed") return "exact-accepted-reuse-permitted";
    return reason;
  });
}

function legacyAttemptPlan(plan) {
  return plan.map((layer) => Object.freeze({
    rank: layer.rank,
    relation: layer.relation,
    offers: Object.freeze(layer.offers.map((offer) => Object.freeze({
      offerId: offer.offerId,
      provider: offer.provider,
      endpointClass: offer.executionClass,
      reuseReceipt: offer.reuseReceipt,
      observationBasis: offer.observationBasis,
    }))),
    execution: layer.execution,
    implicitFallbackPermitted: layer.implicitFallbackPermitted,
    speculativeExecutionPermitted: layer.speculativeExecutionPermitted,
    stopCondition: layer.stopCondition,
  }));
}

function legacyDecision(decision) {
  return Object.freeze({
    disposition: decision.disposition,
    selected: decision.selected === null ? null : Object.freeze({
      offerId: decision.selected.offerId,
      provider: decision.selected.provider,
      endpointClass: decision.selected.executionClass,
      mode: decision.selected.mode,
      reuseReceipt: decision.selected.reuseReceipt,
    }),
    attemptPlan: Object.freeze(legacyAttemptPlan(decision.attemptPlan)),
    refused: Object.freeze(decision.refusals.map((refusal) => Object.freeze({
      offerId: refusal.offerId,
      reasons: Object.freeze(refusal.reasons.map(legacyReason)),
    }))),
    rationale: Object.freeze(legacyRationale(decision.rationale)),
  });
}

/**
 * Adapt the inference endpoint vocabulary to the provider-neutral work-placement owner.
 * @param {{demand: object, offers: object[], observations?: object[]}} request
 * @returns {object} The legacy inference route-decision projection.
 */
export function decideWorkRoute({ demand, offers, observations = [] }) {
  if (!Array.isArray(offers)) throw new TypeError("offers must be an array");
  if (!Array.isArray(observations)) throw new TypeError("observations must be an array");
  const genericDemand = placementDemand(demand, offers);
  return legacyDecision(decideWorkPlacement({
    demand: genericDemand,
    offers: offers.map((offer) => placementOffer(offer, genericDemand)),
    observations: observations.map((observation) => placementObservation(observation, genericDemand)),
  }));
}
