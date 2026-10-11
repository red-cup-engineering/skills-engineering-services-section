import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { catalogRowToPricingOffer, justifyFreeFirstOrder, purchaseRecordToObservation } from "../../src/openai/free-first-pricing-justification.mjs";

const CATALOG_PATH = fileURLToPath(new URL("../../content/openai/providers/catalog.json", import.meta.url));
const CATALOG = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));

test("catalogRowToPricingOffer refuses a free-tier ($0) row: capability-pricing-service cannot represent a zero-price offer", () => {
  const row = CATALOG.rows.find((candidate) => candidate.providerId === "ollama-local");
  assert.throws(() => catalogRowToPricingOffer(row), /prices at exactly zero/u);
});

test("catalogRowToPricingOffer prices the paid-reference row above zero at the nominal request size", () => {
  const row = CATALOG.rows.find((candidate) => candidate.providerId === "openrouter-gpt-4o-paid-reference");
  const offer = catalogRowToPricingOffer(row);
  assert.equal(offer.provider, "openrouter-gpt-4o-paid-reference");
  assert.notEqual(offer.consideration.amount.numerator, "0");
});

test("purchaseRecordToObservation maps a completion to verified and a refusal to a non-verified outcome", () => {
  const completed = purchaseRecordToObservation({ record: { provider: "ollama-local", outcome: "completion" } }, "chat-completion");
  assert.deepEqual(completed, { provider: "ollama-local", taskClass: "chat-completion", outcome: "verified" });
  const refused = purchaseRecordToObservation({ record: { provider: "groq", outcome: "refusal" } }, "chat-completion");
  assert.deepEqual(refused, { provider: "groq", taskClass: "chat-completion", outcome: "refused" });
});

test("justifyFreeFirstOrder against the real catalog: every armed free-first candidate is free-tier today, so ranking has no price signal (a finding, not a bug)", () => {
  const result = justifyFreeFirstOrder(CATALOG, { observations: [] });
  assert.deepEqual(result.hardcodedOrder, CATALOG.routingPolicy.freeFirstOrder.filter((id) => CATALOG.rows.find((row) => row.providerId === id)?.keyed));
  assert.deepEqual(result.unrankable, result.hardcodedOrder, "every current freeFirstOrder row prices at exactly zero");
  assert.equal(result.pricingOrder, null);
  assert.equal(result.agree, null);
  assert.deepEqual(result.ranked, []);
  assert.match(result.basis, /cannot rank a zero-price offer set/u);
});

test("justifyFreeFirstOrder ranks a synthetic mixed free+paid freeFirstOrder, excluding the free row from ranking and reporting it as unrankable", () => {
  const mixedCatalog = {
    rows: [
      ...CATALOG.rows,
      { providerId: "synthetic-paid-a", keyed: true, pricePerMillionTokensMicroUsd: { input: 1000000, output: 1000000 } },
      { providerId: "synthetic-paid-b", keyed: true, pricePerMillionTokensMicroUsd: { input: 5000000, output: 5000000 } },
    ],
    routingPolicy: { freeFirstOrder: ["ollama-local", "synthetic-paid-b", "synthetic-paid-a"] },
  };
  const result = justifyFreeFirstOrder(mixedCatalog, { observations: [] });
  assert.deepEqual(result.unrankable, ["ollama-local"]);
  assert.deepEqual(new Set(result.pricingOrder), new Set(["synthetic-paid-a", "synthetic-paid-b"]));
  // With no observation history for either offer, capability-pricing-service ties them as
  // "unknown-history" (an interval, not a fabricated point estimate from sticker price alone)
  // and preserves input order -- it does not itself prefer the cheaper untried offer.
  assert.equal(result.pricingOrder[0], "synthetic-paid-b", "untried offers tie and preserve the order they were fed in, not sticker-price order");
  assert.equal(result.agree, false, "the free row (ollama-local) is unrankable at all, so the priced subset can never equal the full hardcoded order length");
});

test("justifyFreeFirstOrder can diverge from the hardcoded order when observed history favors a later, more expensive offer", () => {
  const catalog = {
    rows: [
      { providerId: "cheap", keyed: true, pricePerMillionTokensMicroUsd: { input: 1000000, output: 1000000 } },
      { providerId: "pricier-but-reliable", keyed: true, pricePerMillionTokensMicroUsd: { input: 5000000, output: 5000000 } },
    ],
    routingPolicy: { freeFirstOrder: ["cheap", "pricier-but-reliable"] },
  };
  const observations = [
    { provider: "cheap", taskClass: "chat-completion", outcome: "refused" },
    { provider: "cheap", taskClass: "chat-completion", outcome: "refused" },
    { provider: "pricier-but-reliable", taskClass: "chat-completion", outcome: "verified" },
  ];
  const result = justifyFreeFirstOrder(catalog, { observations });
  assert.equal(result.pricingOrder[0], "pricier-but-reliable", "a provider with observed zero yield ranks behind one with any observed verified delivery, even at a higher sticker price");
  assert.equal(result.agree, false);
});
