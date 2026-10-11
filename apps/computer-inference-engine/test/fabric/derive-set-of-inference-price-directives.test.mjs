import assert from "node:assert/strict";
import test from "node:test";
import { deriveSetOfInferencePriceDirectives } from "../../scripts/fabric/derive-set-of-inference-price-directives.mjs";

test("derives one directive per present token class, naming the commodity from the model", () => {
  const result = deriveSetOfInferencePriceDirectives({
    prices: [
      {
        provider: "anthropic",
        model: "claude-sonnet-5",
        date: "2026-09-04",
        sourceUrl: "https://docs.claude.com/en/docs/about-claude/pricing",
        inputUsdPerMillionTokens: "2.00",
        outputUsdPerMillionTokens: "10.00",
        cacheReadUsdPerMillionTokens: "0.20",
        cacheWriteUsdPerMillionTokens: "2.50",
      },
    ],
  });
  assert.equal(result.type, "InferencePriceDirectiveSet");
  assert.equal(result.directiveCount, 4);
  const bySuffix = Object.fromEntries(result.directives.map((d) => [d.commodity, d]));
  assert.ok(bySuffix["CLAUDE-SONNET-5-IN"]);
  assert.equal(bySuffix["CLAUDE-SONNET-5-IN"].price, "2.00");
  assert.equal(bySuffix["CLAUDE-SONNET-5-OUT"].price, "10.00");
  assert.equal(bySuffix["CLAUDE-SONNET-5-CACHE-READ"].price, "0.20");
  assert.equal(bySuffix["CLAUDE-SONNET-5-CACHE-WRITE"].price, "2.50");
  assert.equal(bySuffix["CLAUDE-SONNET-5-IN"].directive, "2026-09-04 price CLAUDE-SONNET-5-IN 2.00 USD\n  provider: \"anthropic\"\n  model: \"claude-sonnet-5\"\n  token_class: \"input\"\n  source: \"https://docs.claude.com/en/docs/about-claude/pricing\"");
});

test("omits a class whose price field is absent or null", () => {
  const result = deriveSetOfInferencePriceDirectives({
    prices: [
      {
        provider: "anthropic",
        model: "claude-fable-5-1",
        date: "2026-09-04",
        sourceUrl: "https://docs.claude.com/en/docs/about-claude/pricing",
        inputUsdPerMillionTokens: "10.00",
        outputUsdPerMillionTokens: "50.00",
        cacheReadUsdPerMillionTokens: "0.25",
        cacheWriteUsdPerMillionTokens: null,
      },
    ],
  });
  assert.equal(result.directiveCount, 3);
  assert.ok(!result.directives.some((d) => d.tokenClass === "cache-write"));
});

test("refuses a malformed entry", () => {
  assert.throws(() => deriveSetOfInferencePriceDirectives({ prices: [{ provider: "anthropic" }] }), /model must be a non-empty string/u);
  assert.throws(() => deriveSetOfInferencePriceDirectives({ prices: "not-an-array" }), /input.prices must be an array/u);
});
