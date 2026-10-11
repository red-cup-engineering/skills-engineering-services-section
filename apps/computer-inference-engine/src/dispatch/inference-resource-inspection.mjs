import { createWorkResourceReservations } from "./work-placement/resource-reservations.mjs";
import { directEndpointAdmissionReasons, directEndpointConfigurationIdentity, isDirectEndpointZeroCashEligible, loadDirectEndpointProviderDescriptors } from "./direct-endpoint-provider.mjs";
import { inferenceProviderReadings } from "./provider-availability.mjs";
import { inspectAccountArtifactResources, loadAccountArtifactObservations } from "../media/account-artifact-work.mjs";
import { accountArtifactCapacityStorePath, observeAccountArtifactCapacity } from "../media/account-artifact-capacity.mjs";

/** Observes configured inference supply and its authoritative account capacity without buying work.
 * @param {object} input Optional zero-cash and capability requirements.
 * @param {object} ports Private descriptor loader, reservation authority, and clock.
 * @returns {Promise<object>} Public resource observations; configuration never asserts endpoint liveness.
 */
export async function inspectInferenceResources(input = {}, {
  environment = process.env,
  loadDescriptors = loadDirectEndpointProviderDescriptors,
  resourceReservations,
  observeResources = ({ store, binding, evaluatedAt }) => createWorkResourceReservations({ store, binding }).observe({ evaluatedAt }),
  observeCatalogs,
  loadAccountObservations = loadAccountArtifactObservations,
  now = () => new Date().toISOString(),
} = {}) {
  const evaluatedAt = now();
  let accountEntitlements;
  let accountEntitlementDisposition = environment.INFERENCE_ACCOUNT_ENTITLEMENTS_FILE ? "observed" : "unconfigured";
  try {
    accountEntitlements = inspectAccountArtifactResources(loadAccountObservations(environment), { ...input, evaluatedAt });
    if (accountEntitlements.length) {
      accountEntitlements = await Promise.all(accountEntitlements.map(async (observation) => {
        let reservation;
        try { reservation = await observeAccountArtifactCapacity(observation, { storePath: accountArtifactCapacityStorePath(environment), evaluatedAt }); }
        catch { reservation = { disposition: "refused", reason: "resource-availability-observation-unavailable" }; }
        const reasons = [...observation.reasons];
        if (reservation.disposition !== "observed") reasons.push(reservation.reason ?? "resource-availability-observation-unavailable");
        else if (reservation.availableResources[0] && Number(reservation.availableResources[0].amount.numerator) < observation.unitsPerArtifact) reasons.push("resource-quota-exhausted");
        return { ...observation, reservation, eligibility: reasons.length ? "excluded-by-requested-filters" : "admitted-by-requested-filters", reasons: [...new Set(reasons)] };
      }));
    }
    if (accountEntitlements.length > 0) accountEntitlementDisposition = "observed";
  } catch {
    accountEntitlements = [];
    accountEntitlementDisposition = "refused";
  }
  let descriptors;
  try {
    descriptors = loadDescriptors(environment, { configPath: environment.DIRECT_ENDPOINT_PROVIDER_CONFIG });
  } catch {
    return { type: "InferenceResourceInspection", evaluatedAt, disposition: "refused", reason: "provider-configuration-unavailable", providers: [], accountEntitlements, accountEntitlementDisposition };
  }
  const catalogs = observeCatalogs ? await observeCatalogs(descriptors).catch(() => []) : [];
  const providers = [];
  const accounts = new Map();
  for (const descriptor of descriptors) {
    const zeroCashEligible = isDirectEndpointZeroCashEligible(descriptor);
    const modelCatalog = catalogs.find(({ providerIdentity }) => providerIdentity === descriptor.provider) ?? null;
    const configuredModel = modelCatalog?.models.find(({ id }) => id === descriptor.model) ?? null;
    const catalogEvidence = modelCatalog && {
      ...modelCatalog,
      totalModels: modelCatalog.models.length,
      configuredModelDisposition: modelCatalog.disposition === "observed" ? (configuredModel ? "listed" : "not-listed") : "unknown",
      models: input.includeCatalogModels === true ? modelCatalog.models : (configuredModel ? [configuredModel] : []),
    };
    const reasons = [
      ...directEndpointAdmissionReasons(descriptor, input),
      ...(input.requiredCapabilities ?? []).filter((capability) => !descriptor.capabilities.includes(capability)).map((capability) => `missing-capability:${capability}`),
      ...(input.requiredQualityTiers ?? []).filter((tier) => !descriptor.qualityTiers.includes(tier)).map((tier) => `missing-quality-tier:${tier}`),
    ];
    let reservation = { disposition: "unmanaged", reason: "resource-reservation-authority-not-configured" };
    if (resourceReservations) {
      try {
        const binding = resourceReservations.resolveBinding(descriptor);
        // Reuse the observation for model aliases sharing exactly the same account evidence.
        const key = JSON.stringify(binding);
        if (!accounts.has(key)) accounts.set(key, Promise.resolve(observeResources({ store: resourceReservations.store, binding, evaluatedAt })));
        reservation = await accounts.get(key);
      } catch {
        reservation = { disposition: "refused", reason: "resource-availability-observation-unavailable" };
      }
    }
    providers.push({
      provider: descriptor.provider,
      model: descriptor.model,
      configurationIdentity: descriptor.configurationIdentity ?? directEndpointConfigurationIdentity(descriptor),
      executionClass: descriptor.endpointClass,
      capabilities: [...descriptor.capabilities],
      qualityTiers: [...descriptor.qualityTiers],
      maximumOutputTokens: descriptor.maximumOutputTokens,
      consideration: { kind: descriptor.considerationKind, asset: descriptor.considerationAsset, unit: descriptor.considerationUnit, amount: { ...descriptor.considerationAmount } },
      declaredResources: structuredClone(descriptor.declaredResources),
      configuredCapacity: descriptor.availableCapacity,
      zeroCashEligible,
      eligibility: reasons.length === 0 ? "admitted-by-requested-filters" : "excluded-by-requested-filters",
      reasons,
      reachability: modelCatalog?.disposition === "observed" ? "model-catalog-observed" : "unobserved",
      ...(catalogEvidence ? { modelCatalog: catalogEvidence } : {}),
      reservation,
      ...(descriptor.providerReading ? { providerReading: descriptor.providerReading } : {}),
    });
  }
  return { type: "InferenceResourceInspection", disposition: "observed", evaluatedAt, providers, accountEntitlements, accountEntitlementDisposition,
    configuredProviders: providers.length,
    eligibleProviders: providers.filter(({ reasons }) => reasons.length === 0).length,
    eligibleAccountEntitlements: accountEntitlements.filter(({ reasons }) => reasons.length === 0).length,
    reservationAccountsObserved: accounts.size,
    inferenceRequests: 0,
    providerReadings: inferenceProviderReadings(),
  };
}
