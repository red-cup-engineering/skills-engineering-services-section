# derive-set-of-inference-price-directives
## Requirements
- `price-directive-per-token-class`: For each provider price-list entry, one Beancount `price` directive is rendered per present token class (input, output, cache-read, cache-write), naming the commodity `<MODEL>-<CLASS>` uppercased with non-alphanumeric characters collapsed to a single hyphen, so one commodity unit prices one million tokens in USD.
- `absent-class-omitted`: A token class whose price field is absent or null on an entry yields no directive for that class, and is never a refusal.
- `source-and-model-in-metadata`: Every rendered price directive carries the entry's `provider`, `model`, `token_class`, and `sourceUrl` in its Beancount metadata.
- `exact-decimal-price`: Every rendered price is the entry's own plain decimal string, validated through the ledger section's decimal primitives, never a floating-point number.
## Prohibitions
- `no-network-io`: The operation performs no network call, file read, or file write; it is a pure function of its input.
- `no-float-money`: No price value is parsed or computed with a native floating-point arithmetic operator.
- `no-malformed-entry-silent-pass`: A price-list entry missing `provider`, `model`, `date`, `sourceUrl`, or either required price field is refused with a `TypeError` naming the missing field, never silently dropped or defaulted.
## Laws
- `pure-data-transformation-law` | The language law (asserted 2026-08-30) | v1 | .claude/rules/org-layering.md | Applies to deriveSetOfInferencePriceDirectives as data transformation, never I/O. | I/O with a system is written in Node; a decision that is only data transformation performs no I/O of its own.
- `standards-first-data-law` | Standards-first data, networking, and deployment (specified 2026-09-04) | v1 | .claude/rules/org-layering.md | Applies to the inference price directives as a plain-text double-entry account primitive. | An existing open standard is preferred over a house format every time one fits; plain-text double-entry accounting (Beancount) is named as one of the preferred standards.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation, its import.meta.main guard, and downstream package-birth assays. | The package uses one executable ESM operation source file eligible for downstream staged package-birth assays.
- `iso-8601-date` | ISO 8601 | 2019 | https://www.iso.org/iso-8601-date-and-time-format.html | Applies to every price-list entry's effective date. | Dates are YYYY-MM-DD calendar-date strings.
- `beancount-double-entry-syntax` | Beancount | v3.2 | https://beancount.github.io/docs/beancount_language_syntax.html | Applies to every rendered `price` directive. | Directives use Beancount's plain-text `price` directive syntax; conformance is verified by `bean-check`.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/derive-set-of-inference-price-directives-service","packageVersion":"0.1.0","license":"UNLICENSED","dependencies":{"@red-cup-engineering/computer-ledger-system-services-section":"0.2.0"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/derive-set-of-inference-price-directives.mjs
#!/usr/bin/env node
import { parseDecimal } from "@red-cup-engineering/computer-ledger-system-services-section/src/decimal.mjs";
import { renderPriceDirective } from "@red-cup-engineering/computer-ledger-system-services-section/src/beancount-render.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TOKEN_CLASSES = [
  { field: "inputUsdPerMillionTokens", suffix: "IN", tokenClass: "input" },
  { field: "outputUsdPerMillionTokens", suffix: "OUT", tokenClass: "output" },
  { field: "cacheReadUsdPerMillionTokens", suffix: "CACHE-READ", tokenClass: "cache-read" },
  { field: "cacheWriteUsdPerMillionTokens", suffix: "CACHE-WRITE", tokenClass: "cache-write" },
];

function requireString(value, context) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`derive-set-of-inference-price-directives: ${context} must be a non-empty string`);
  return value;
}

function requireDate(value, context) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw new TypeError(`derive-set-of-inference-price-directives: ${context} must be a YYYY-MM-DD date string`);
  return value;
}

function requireDecimalString(value, context) {
  if (typeof value !== "string") throw new TypeError(`derive-set-of-inference-price-directives: ${context} must be a plain decimal string`);
  try {
    parseDecimal(value);
  } catch {
    throw new TypeError(`derive-set-of-inference-price-directives: ${context} must be a plain decimal string`);
  }
  return value;
}

function requireOptionalDecimalString(value, context) {
  if (value === null || value === undefined) return null;
  return requireDecimalString(value, context);
}

/**
 * Derives the per-million-token Beancount commodity root for one model id, e.g.
 * `claude-sonnet-5` becomes `CLAUDE-SONNET-5`.
 * @param {string} model
 * @returns {string}
 */
function commodityRoot(model) {
  return model.toUpperCase().replace(/[^A-Z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function validatePriceListEntry(entry, index) {
  const context = `prices[${index}]`;
  if (entry === null || typeof entry !== "object") throw new TypeError(`derive-set-of-inference-price-directives: ${context} must be an object`);
  requireString(entry.provider, `${context}.provider`);
  requireString(entry.model, `${context}.model`);
  requireDate(entry.date, `${context}.date`);
  requireString(entry.sourceUrl, `${context}.sourceUrl`);
  requireDecimalString(entry.inputUsdPerMillionTokens, `${context}.inputUsdPerMillionTokens`);
  requireDecimalString(entry.outputUsdPerMillionTokens, `${context}.outputUsdPerMillionTokens`);
  requireOptionalDecimalString(entry.cacheReadUsdPerMillionTokens ?? null, `${context}.cacheReadUsdPerMillionTokens`);
  requireOptionalDecimalString(entry.cacheWriteUsdPerMillionTokens ?? null, `${context}.cacheWriteUsdPerMillionTokens`);
}

/**
 * @typedef {Object} InferenceProviderPriceListEntry
 * @property {string} provider
 * @property {string} model
 * @property {string} date
 * @property {string} sourceUrl
 * @property {string} inputUsdPerMillionTokens
 * @property {string} outputUsdPerMillionTokens
 * @property {string|null} [cacheReadUsdPerMillionTokens]
 * @property {string|null} [cacheWriteUsdPerMillionTokens]
 * @typedef {Object} InferencePriceListInput
 * @property {InferenceProviderPriceListEntry[]} prices
 * @typedef {Object} InferencePriceDirective
 * @property {string} commodity
 * @property {"input"|"output"|"cache-read"|"cache-write"} tokenClass
 * @property {string} provider
 * @property {string} model
 * @property {string} date
 * @property {string} price
 * @property {string} directive
 * @typedef {Object} InferencePriceDirectiveSet
 * @property {"InferencePriceDirectiveSet"} type
 * @property {1} version
 * @property {number} directiveCount
 * @property {InferencePriceDirective[]} directives
 */

/**
 * Derives one Beancount `price` directive per present token class (input, output, cache-read, cache-write) for each provider price-list entry, naming each commodity `<MODEL>-<CLASS>` uppercased so one commodity unit prices one million tokens in USD; a token class whose price field is absent or null on an entry yields no directive for that class.
 * @param {InferencePriceListInput} input A record with the provider price-list entries.
 * @returns {InferencePriceDirectiveSet} The rendered price directives, one per present token class.
 * @throws {TypeError} When the input or a price-list entry is malformed.
 */
export function deriveSetOfInferencePriceDirectives(input) {
  if (input === null || typeof input !== "object") throw new TypeError("derive-set-of-inference-price-directives: input must be an object");
  if (!Array.isArray(input.prices)) throw new TypeError("derive-set-of-inference-price-directives: input.prices must be an array");
  input.prices.forEach((entry, index) => validatePriceListEntry(entry, index));

  const directives = [];
  for (const entry of input.prices) {
    const root = commodityRoot(entry.model);
    for (const { field, suffix, tokenClass } of TOKEN_CLASSES) {
      const price = entry[field] ?? null;
      if (price === null) continue;
      const commodity = `${root}-${suffix}`;
      directives.push({
        commodity,
        tokenClass,
        provider: entry.provider,
        model: entry.model,
        date: entry.date,
        price,
        directive: renderPriceDirective({
          date: entry.date,
          symbol: commodity,
          price,
          metadata: { provider: entry.provider, model: entry.model, token_class: tokenClass, source: entry.sourceUrl },
        }),
      });
    }
  }

  return Object.freeze({
    type: "InferencePriceDirectiveSet",
    version: 1,
    directiveCount: directives.length,
    directives: Object.freeze(directives),
  });
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write("deriveSetOfInferencePriceDirectives — Derives one Beancount `price` directive per present token class (input, output, cache-read, cache-write) for each provider price-list entry, naming each commodity `<MODEL>-<CLASS>` uppercased so one commodity unit prices one million tokens in USD; a token class whose price field is absent or null on an entry yields no directive for that class.\n");
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) process.stdout.write(`${JSON.stringify(deriveSetOfInferencePriceDirectives(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/derive-set-of-inference-price-directives.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { deriveSetOfInferencePriceDirectives } from "../scripts/derive-set-of-inference-price-directives.mjs";

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
```
## Examples
```json name="derive-set-of-inference-price-directives example"
{"input":{"prices":[{"provider":"anthropic","model":"claude-haiku-4-5","date":"2026-09-04","sourceUrl":"https://docs.claude.com/en/docs/about-claude/pricing","inputUsdPerMillionTokens":"1.00","outputUsdPerMillionTokens":"5.00","cacheReadUsdPerMillionTokens":"0.10","cacheWriteUsdPerMillionTokens":"1.25"}]},"output":{"type":"InferencePriceDirectiveSet","version":1,"directiveCount":4,"directives":[{"commodity":"CLAUDE-HAIKU-4-5-IN","tokenClass":"input","provider":"anthropic","model":"claude-haiku-4-5","date":"2026-09-04","price":"1.00","directive":"2026-09-04 price CLAUDE-HAIKU-4-5-IN 1.00 USD\n  provider: \"anthropic\"\n  model: \"claude-haiku-4-5\"\n  token_class: \"input\"\n  source: \"https://docs.claude.com/en/docs/about-claude/pricing\""},{"commodity":"CLAUDE-HAIKU-4-5-OUT","tokenClass":"output","provider":"anthropic","model":"claude-haiku-4-5","date":"2026-09-04","price":"5.00","directive":"2026-09-04 price CLAUDE-HAIKU-4-5-OUT 5.00 USD\n  provider: \"anthropic\"\n  model: \"claude-haiku-4-5\"\n  token_class: \"output\"\n  source: \"https://docs.claude.com/en/docs/about-claude/pricing\""},{"commodity":"CLAUDE-HAIKU-4-5-CACHE-READ","tokenClass":"cache-read","provider":"anthropic","model":"claude-haiku-4-5","date":"2026-09-04","price":"0.10","directive":"2026-09-04 price CLAUDE-HAIKU-4-5-CACHE-READ 0.10 USD\n  provider: \"anthropic\"\n  model: \"claude-haiku-4-5\"\n  token_class: \"cache-read\"\n  source: \"https://docs.claude.com/en/docs/about-claude/pricing\""},{"commodity":"CLAUDE-HAIKU-4-5-CACHE-WRITE","tokenClass":"cache-write","provider":"anthropic","model":"claude-haiku-4-5","date":"2026-09-04","price":"1.25","directive":"2026-09-04 price CLAUDE-HAIKU-4-5-CACHE-WRITE 1.25 USD\n  provider: \"anthropic\"\n  model: \"claude-haiku-4-5\"\n  token_class: \"cache-write\"\n  source: \"https://docs.claude.com/en/docs/about-claude/pricing\""}]}}
```
## Traceability
- `price-directive-per-token-class` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`, `standards-first-data-law`, `node-esm-operation`, `beancount-double-entry-syntax`
- `absent-class-omitted` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `source-and-model-in-metadata` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `beancount-double-entry-syntax`
- `exact-decimal-price` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `no-network-io` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `no-float-money` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `no-malformed-entry-silent-pass` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
