// Published per-model prices, read from measured-claim records. A price is never defaulted,
// interpolated or inherited from another model: a model, speed or token class with no claim is
// unpriced, and the caller says so.
import { readFileSync } from "node:fs";
import { tokenCostMicros, microsToDecimal } from "./decimal-money.mjs";

export const PRICE_CLAIM_KIND = "published-model-price-claim";
export const PRICE_CLASSES = Object.freeze(["input", "cacheWrite5m", "cacheWrite1h", "cacheRead", "output"]);

export function loadPriceClaims(file) {
  const document = JSON.parse(readFileSync(file, "utf8"));
  const claims = document.claims ?? [];
  for (const claim of claims) {
    if (claim.kind !== PRICE_CLAIM_KIND) throw new TypeError(`${file}: claim ${claim.id} is not a ${PRICE_CLAIM_KIND}`);
    for (const field of ["provider", "model", "speed", "source", "observedAt", "usdPerMillionTokens"]) {
      if (claim[field] === undefined) throw new TypeError(`${file}: claim ${claim.id} lacks ${field}`);
    }
  }
  return claims;
}

/** The latest claim for a model and speed observed on or before `day`; null when there is none (or, with `allowLater`, the earliest later one). */
export function findPriceClaim(claims, { provider, model, speed = "standard", day, allowLater = false }) {
  const matching = claims
    .filter((claim) => claim.provider === provider && claim.model === model && claim.speed === speed)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const current = matching.find((claim) => claim.observedAt.slice(0, 10) <= day);
  // A price observed after the usage day is used only when asked for, and the record says so.
  return current ?? (allowLater ? (matching[matching.length - 1] ?? null) : null);
}

/** Price a token breakdown against one claim. A class with tokens but no published price makes the whole record unpriced. */
export function priceTokens(tokens, claim) {
  if (claim === null) return { priced: false, reason: "no published price claim for this model and speed", costUsd: null, claim: null };
  const components = {};
  let total = 0n;
  for (const kind of PRICE_CLASSES) {
    const count = tokens[kind] ?? 0;
    const price = claim.usdPerMillionTokens[kind];
    if (price === undefined || price === null) {
      if (count > 0) return { priced: false, reason: `claim ${claim.id} publishes no ${kind} price`, costUsd: null, claim: claim.id };
      components[kind] = "0.000000";
      continue;
    }
    const micros = tokenCostMicros(count, price);
    components[kind] = microsToDecimal(micros);
    total += micros;
  }
  return { priced: true, costUsd: { ...components, total: microsToDecimal(total) }, claim: claim.id };
}
