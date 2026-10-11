#!/usr/bin/env node
import { parseDecimal } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TOKEN_CLASSES = [
  { field: "inputUsdPerMillionTokens", suffix: "IN", tokenClass: "input" },
  { field: "outputUsdPerMillionTokens", suffix: "OUT", tokenClass: "output" },
  { field: "cacheReadUsdPerMillionTokens", suffix: "CACHE-READ", tokenClass: "cache-read" },
  { field: "cacheWriteUsdPerMillionTokens", suffix: "CACHE-WRITE", tokenClass: "cache-write" },
];

function renderPriceDirective({ date, symbol, price, quoteCommodity = "USD", metadata = {} }) {
  const lines = [`${date} price ${symbol} ${price} ${quoteCommodity}`];
  for (const [key, value] of Object.entries(metadata)) lines.push(`  ${key}: "${value}"`);
  return lines.join("\n");
}

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
  const result = await runJavascriptNodeOperation({ name: "derive-set-of-inference-price-directives", description: "Derives one Beancount `price` directive per present token class (input, output, cache-read, cache-write) for each provider price-list entry, naming each commodity `<MODEL>-<CLASS>` uppercased so one commodity unit prices one million tokens in USD; a token class whose price field is absent or null on an entry yields no directive for that class.", operation: deriveSetOfInferencePriceDirectives }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
