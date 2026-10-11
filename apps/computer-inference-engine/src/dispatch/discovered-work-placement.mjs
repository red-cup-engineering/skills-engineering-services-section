import { decideWorkPlacement } from "./decide-work-placement.mjs";

export const DISCOVERY_RESULT_KIND = "org.emsenn.capability-offer-discovery.result.v1";
export const CURRENT_PLACEMENT_PROFILE_KIND = "org.emsenn.current-work-placement-profile.v1";
const COORDINATE_RESIDUAL_KIND = "org.emsenn.capability-offer.coordinate-residual.v1";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function refusal(offerId, reason) {
  return Object.freeze({ offerId: nonempty(offerId) ? offerId : "unknown", reasons: Object.freeze([reason]) });
}

function coordinate(candidate, name) {
  const value = candidate?.coordinates?.[name];
  if (!record(value)) return { refusal: refusal(candidate?.offer, `offer-coordinate-missing:${name}`) };
  if (value.kind === COORDINATE_RESIDUAL_KIND) {
    return { refusal: refusal(candidate?.offer, `offer-coordinate-residual:${name}:${value.state ?? "unknown"}`) };
  }
  if (value.kind !== "reference" || !nonempty(value.href)) {
    return { refusal: refusal(candidate?.offer, `offer-coordinate-invalid:${name}`) };
  }
  return { value };
}

function packageOperationCoordinate(candidate) {
  const observed = coordinate(candidate, "packageOperation");
  if (observed.refusal) return observed;
  for (const field of ["operation", "invocation"]) {
    if (!nonempty(observed.value[field])) {
      return { refusal: refusal(candidate.offer, `offer-coordinate-missing:packageOperation.${field}`) };
    }
  }
  if (observed.value.operation !== candidate.operation) {
    return { refusal: refusal(candidate.offer, "offer-coordinate-identity-drift:packageOperation.operation") };
  }
  return observed;
}

function admitDiscoveryCandidates(discovery) {
  if (!nonempty(discovery.operation)) throw new TypeError("discovery.operation must be nonempty text");
  const offerIds = discovery.candidates.map((candidate) => candidate?.offer);
  if (offerIds.some((offerId) => !nonempty(offerId))) {
    throw new TypeError("every discovery candidate must name one offer identity");
  }
  if (new Set(offerIds).size !== offerIds.length) {
    throw new TypeError("discovery candidates must not repeat an offer identity");
  }
}

function exactPackageOperation(value, expected) {
  if (!record(value)) return "packageOperation";
  for (const field of ["href", "operation", "invocation"]) {
    if (value[field] !== expected[field]) return `packageOperation.${field}`;
  }
  return null;
}

function placementProfile(candidate, profile, packageOperation) {
  if (!record(profile) || profile.kind !== CURRENT_PLACEMENT_PROFILE_KIND) {
    return { refusal: refusal(candidate.offer, "invalid-current-placement-profile") };
  }
  for (const field of ["offer", "provider", "operation", "sku", "law"]) {
    if (profile[field] !== candidate[field]) {
      return { refusal: refusal(candidate.offer, `placement-profile-identity-drift:${field}`) };
    }
  }
  const packageDrift = exactPackageOperation(profile.packageOperation, packageOperation);
  if (packageDrift) {
    return { refusal: refusal(candidate.offer, `placement-profile-identity-drift:${packageDrift}`) };
  }
  if (!record(profile.workOffer)) {
    return { refusal: refusal(candidate.offer, "invalid-current-placement-profile:workOffer") };
  }
  for (const [field, expected] of [["id", candidate.offer], ["provider", candidate.provider], ["operation", candidate.operation]]) {
    if (profile.workOffer[field] !== undefined && profile.workOffer[field] !== expected) {
      return { refusal: refusal(candidate.offer, `placement-profile-identity-drift:workOffer.${field}`) };
    }
  }
  return {
    offer: Object.freeze({
      ...profile.workOffer,
      type: "NormalizedWorkOffer",
      id: candidate.offer,
      provider: candidate.provider,
      operation: candidate.operation,
      discoveryOffer: candidate.offer,
      sku: candidate.sku,
      law: candidate.law,
      packageOperation: Object.freeze({
        href: packageOperation.href,
        operation: packageOperation.operation,
        invocation: packageOperation.invocation,
      }),
    }),
  };
}

function withAdapterEvidence(decision, discovery, preflightRefusals, invocationByOffer) {
  const refusals = Object.freeze([...preflightRefusals, ...decision.refusals]);
  const selectedInvocation = decision.selected === null
    ? null
    : invocationByOffer.get(decision.selected.offerId) ?? null;
  return Object.freeze({
    ...decision,
    refusals,
    discoveryProvenance: discovery,
    selectedInvocation,
  });
}

/**
 * Resolve provider-owned current placement profiles for an already-observed
 * capability-offer discovery result, then decide placement without performing
 * an invocation. The resolver owns any fetch; this adapter never starts a
 * daemon, discovers a transport, or guesses a missing coordinate.
 *
 * @param {{demand: object, discovery: object, observations?: object[], resolvePlacementProfile: Function}} request
 * @returns {Promise<object>} a WorkPlacementDecision/Refusal with discovery and invocation evidence
 */
export async function decideDiscoveredWorkPlacement({
  demand,
  discovery,
  observations = [],
  resolvePlacementProfile,
}) {
  if (!record(discovery) || discovery.kind !== DISCOVERY_RESULT_KIND) {
    throw new TypeError(`discovery must be one ${DISCOVERY_RESULT_KIND} record`);
  }
  if (!Array.isArray(discovery.candidates)) throw new TypeError("discovery.candidates must be an array");
  if (typeof resolvePlacementProfile !== "function") {
    throw new TypeError("resolvePlacementProfile must be an injected function");
  }
  admitDiscoveryCandidates(discovery);

  const offers = [];
  const preflightRefusals = [];
  const invocationByOffer = new Map();
  for (const candidate of discovery.candidates) {
    if (candidate.operation !== discovery.operation) {
      preflightRefusals.push(refusal(candidate.offer, "discovery-candidate-identity-drift:operation"));
      continue;
    }
    const packageOperation = packageOperationCoordinate(candidate);
    if (packageOperation.refusal) {
      preflightRefusals.push(packageOperation.refusal);
      continue;
    }
    const resourceMeter = coordinate(candidate, "resourceMeter");
    if (resourceMeter.refusal) {
      preflightRefusals.push(resourceMeter.refusal);
      continue;
    }
    let profile;
    try {
      profile = await resolvePlacementProfile(Object.freeze({
        href: resourceMeter.value.href,
        resourceMeter: resourceMeter.value,
        candidate,
        packageOperation: packageOperation.value,
        discovery,
      }));
    } catch (error) {
      const reason = error instanceof Error && nonempty(error.message) ? error.message : "resolver-refused";
      preflightRefusals.push(refusal(candidate?.offer, `placement-profile-unavailable:${reason}`));
      continue;
    }
    const projected = placementProfile(candidate, profile, packageOperation.value);
    if (projected.refusal) {
      preflightRefusals.push(projected.refusal);
      continue;
    }
    offers.push(projected.offer);
    invocationByOffer.set(candidate.offer, projected.offer.packageOperation);
  }

  const decision = decideWorkPlacement({ demand, offers, observations });
  return withAdapterEvidence(decision, discovery, preflightRefusals, invocationByOffer);
}
