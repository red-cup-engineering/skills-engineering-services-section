import { rankExpectedResolutionPrices } from "@red-cup-engineering/capability-pricing-service";
import { computePurchasePrice, PURCHASE_PRICE_DENOMINATION } from "./openai-compatible-chat-completion.mjs";

/** Nominal request size used only to derive one comparable per-request offer amount from each row's per-token rate; it prices no real exchange. */
const DEFAULT_NOMINAL_TOKENS = Object.freeze({ input: 1000, output: 1000 });

/**
 * Maps one armed, nonzero-rate catalog row to one capability-pricing-service
 * offer, using the row's own pricePerMillionTokensMicroUsd rate against a
 * fixed nominal request size so every row is comparable at the same
 * notional request -- this is a ranking input, never a priced quote for a
 * real exchange.
 *
 * Refuses a row that prices at exactly zero: capability-pricing-service's
 * `rankExpectedResolutionPrices` calls `fraction(offer.consideration.amount,
 * "consideration amount")` with `allowZero` left at its default `false`
 * (`src/pricing.mjs`), so it structurally cannot represent a genuinely free
 * offer. This is a real API mismatch between a fraction-typed marketplace
 * and a $0-heavy free tier, reported here rather than hidden by smuggling a
 * fake positive amount past it.
 * @param {object} row - a catalog row carrying pricePerMillionTokensMicroUsd.
 * @param {{input: number, output: number}} [nominalTokens]
 * @returns {{provider: string, consideration: {kind: string, asset: string, unit: string, amount: {numerator: string, denominator: string}}}}
 * @throws {Error} when the row's rate prices the nominal request at exactly zero.
 */
export function catalogRowToPricingOffer(row, nominalTokens = DEFAULT_NOMINAL_TOKENS) {
  const price = computePurchasePrice(row, { input: { quantity: nominalTokens.input }, output: { quantity: nominalTokens.output } });
  if (price.amount.numerator === "0") {
    throw new Error(`catalog row ${row.providerId} prices at exactly zero; capability-pricing-service's rankExpectedResolutionPrices requires a strictly positive consideration.amount and cannot represent a genuinely free offer`);
  }
  return { provider: row.providerId, consideration: { ...PURCHASE_PRICE_DENOMINATION, amount: price.amount } };
}

/**
 * Maps one recorded inference-purchased event into one
 * capability-pricing-service observation. A completion is treated as a
 * verified delivery (the best evidence this adapter has -- no further
 * receiver-side assay exists for free-first chat completions); a refusal
 * counts as an observed non-verified attempt.
 * @param {{record: {provider: string, outcome: "completion"|"refusal"}}} purchaseRecord - one row from `journal.query({category: "inference-purchased"})`.
 * @param {string} taskClass
 * @returns {{provider: string, taskClass: string, outcome: "verified"|"refused"}}
 */
export function purchaseRecordToObservation(purchaseRecord, taskClass) {
  const event = purchaseRecord.record;
  return { provider: event.provider, taskClass, outcome: event.outcome === "completion" ? "verified" : "refused" };
}

/**
 * Compares the catalog's hardcoded routingPolicy.freeFirstOrder against the
 * order capability-pricing-service's rankExpectedResolutionPrices would
 * choose from the same armed rows and observed history. This never changes
 * live dispatch order (selectFreeFirstProvider still owns that); it returns
 * a citable agreement/divergence basis for a market decision made
 * separately and explicitly.
 *
 * A row priced at exactly zero cannot be turned into a pricing-service
 * offer at all (see catalogRowToPricingOffer); such rows are reported in
 * `unrankable` rather than silently dropped or faked. When every armed
 * candidate is free-tier -- the entire catalog's current state -- `ranked`
 * is empty and `pricingOrder`/`agree` are `null`: there is no price signal
 * among free offers for the pricing service to rank, so the hardcoded
 * order stands unchallenged for lack of a signal, not for lack of wiring.
 * @param {object} catalog - the parsed catalog.json (`rows`, `routingPolicy`).
 * @param {{observations?: object[], taskClass?: string, nominalTokens?: {input: number, output: number}}} [options]
 * @returns {{taskClass: string, hardcodedOrder: string[], unrankable: string[], pricingOrder: string[]|null, agree: boolean|null, ranked: object[]}}
 */
export function justifyFreeFirstOrder(catalog, { observations = [], taskClass = "chat-completion", nominalTokens } = {}) {
  const byId = new Map(catalog.rows.map((row) => [row.providerId, row]));
  const hardcodedOrder = catalog.routingPolicy.freeFirstOrder.filter((providerId) => byId.get(providerId)?.keyed);
  const priceable = [], unrankable = [];
  for (const providerId of hardcodedOrder) {
    const price = computePurchasePrice(byId.get(providerId), { input: { quantity: (nominalTokens ?? DEFAULT_NOMINAL_TOKENS).input }, output: { quantity: (nominalTokens ?? DEFAULT_NOMINAL_TOKENS).output } });
    (price.amount.numerator === "0" ? unrankable : priceable).push(providerId);
  }
  if (priceable.length === 0) {
    return {
      taskClass, hardcodedOrder, unrankable, pricingOrder: null, agree: null, ranked: [],
      basis: "every armed free-first candidate prices at exactly zero; capability-pricing-service's rankExpectedResolutionPrices requires a strictly positive consideration.amount and cannot rank a zero-price offer set",
    };
  }
  const offers = priceable.map((providerId) => catalogRowToPricingOffer(byId.get(providerId), nominalTokens));
  const { ranked } = rankExpectedResolutionPrices({ taskClass, offers, observations });
  const pricingOrder = ranked.map(({ provider }) => provider);
  const agree = priceable.length === hardcodedOrder.length && hardcodedOrder.every((providerId, index) => providerId === pricingOrder[index]);
  return { taskClass, hardcodedOrder, unrankable, pricingOrder, agree, ranked };
}
