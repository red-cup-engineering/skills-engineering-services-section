import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";

/** Resolves dated account entitlement against the exact current credential.
 * @param {Array<object>} observations Private, server-owned account observations.
 * @param {{now?: Function}} options Runtime clock.
 * @returns {Function} A resolver returning only credential-free entitlement evidence.
 */
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

