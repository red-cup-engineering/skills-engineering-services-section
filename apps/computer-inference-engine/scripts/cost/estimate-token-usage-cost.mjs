#!/usr/bin/env node
/**
 * estimate-token-usage-cost.mjs — one effect: read a JSON object
 * `{ usage: TokenUsageCounts, rates: TokenUsageCostRates }` from a file
 * path (argv[2]) or stdin, price the usage against the rates via
 * `tokenUsageCostEstimate`, and print the exact-rational cost estimate as
 * JSON on stdout.
 *
 * Usage:
 *   node scripts/estimate-token-usage-cost.mjs path/to/pricing-request.json
 *   echo '{"usage":{"inputTokens":1000,"outputTokens":200},"rates":{"inputMicrodollarsPerMillionTokens":3000000,"outputMicrodollarsPerMillionTokens":15000000}}' | node scripts/estimate-token-usage-cost.mjs
 */
import { readFileSync } from "node:fs";
import { tokenUsageCostEstimate, tokenUsageCounts } from "../../src/cost/token-usage/core.mjs";

function readInput() {
  const path = process.argv[2];
  if (path !== undefined) return readFileSync(path, "utf8");
  return readFileSync(0, "utf8");
}

function main() {
  const request = JSON.parse(readInput());
  if (request === null || typeof request !== "object" || request.rates === undefined) {
    process.stderr.write("estimate-token-usage-cost: input must be a JSON object with usage and rates\n");
    process.exit(2);
  }
  const usage = tokenUsageCounts(request.usage ?? {});
  const estimate = tokenUsageCostEstimate(usage, request.rates);
  process.stdout.write(`${JSON.stringify(estimate, null, 2)}\n`);
}

main();
