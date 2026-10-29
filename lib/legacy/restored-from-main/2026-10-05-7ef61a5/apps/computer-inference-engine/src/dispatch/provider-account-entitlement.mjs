
/** Resolves dated account entitlement against the exact current credential.
 * @param {Array<object>} observations Private, server-owned account observations.
 * @param {{now?: Function}} options Runtime clock.
 * @returns {Function} A resolver returning only credential-free entitlement evidence.
 */
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";

/**
 * Renew a provider admission from its checked-in no-overage policy and the
 * credential currently bound to that sovereign provider. The short lease is
 * recreated whenever descriptors are loaded; no secret or fingerprint leaves
 * the private observation carrier.
 */
export function renewProviderAccountEntitlement({ provider, endpoint, model, apiKey, policy, observedAt = new Date().toISOString() }) {
  if (!policy || policy.cashCost !== "zero" || policy.paidOverage !== "forbidden") return null;
  if (policy.modelSuffix && !String(model).endsWith(policy.modelSuffix)) return null;
  if (Array.isArray(policy.models) && !policy.models.includes(model)) return null;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    if (policy.local !== true) return null;
    apiKey = `local:${provider}`;
  }
  const start = Date.parse(observedAt);
  if (!Number.isFinite(start)) return null;
  return Object.freeze({
    type: "ProviderAccountEntitlementObservation",
    providerIdentity: provider,
    accountIdentity: policy.accountIdentity ?? provider,
    endpoint,
    model,
    credentialSha256: sha256Hex(apiKey),
    observedAt: new Date(start).toISOString(),
    validUntil: new Date(start + 3_600_000).toISOString(),
    evidenceIdentity: policy.evidenceIdentity ?? `urn:policy:${provider}:zero-cash-no-overage`,
    cashCost: "zero",
    paidOverage: "forbidden",
    billingEnabled: false,
    billingAccountBound: false,
  });
}
export function createProviderAccountEntitlementResolver(observations, { now = () => Date.now() } = {}) {
  if (!Array.isArray(observations)) throw new TypeError("provider account entitlements must be an array");
  const evidence = structuredClone(observations);
  return ({ provider, endpoint, model, apiKey }) => {
    if (typeof apiKey !== "string" || apiKey.length === 0) return null;
    const fingerprint = sha256Hex(apiKey);
    const evaluatedAt = Number(now());
    if (!Number.isFinite(evaluatedAt)) return null;
    const admitted = evidence.find((row) => {
      const observedAt = Date.parse(row.observedAt), validUntil = Date.parse(row.validUntil);
      return row.type === "ProviderAccountEntitlementObservation" && row.providerIdentity === provider && row.endpoint === endpoint
        && row.model === model && row.credentialSha256 === fingerprint && typeof row.accountIdentity === "string" && row.accountIdentity.trim() !== ""
        && typeof row.evidenceIdentity === "string" && row.evidenceIdentity.trim() !== ""
        && row.cashCost === "zero" && row.paidOverage === "forbidden" && row.billingEnabled === false && row.billingAccountBound === false
        && Number.isFinite(observedAt) && Number.isFinite(validUntil) && validUntil > observedAt
        && validUntil - observedAt <= 3_600_000 && observedAt <= evaluatedAt && evaluatedAt < validUntil;
    });
    return admitted ? Object.freeze({ providerIdentity: provider, accountIdentity: admitted.accountIdentity, model,
      evidenceIdentity: admitted.evidenceIdentity, observedAt: admitted.observedAt, validUntil: admitted.validUntil,
      cashCost: "zero", paidOverage: "forbidden" }) : null;
  };
}
