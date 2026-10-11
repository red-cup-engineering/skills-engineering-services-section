#!/usr/bin/env node
/**
 * fold-token-usage-rows.mjs — one effect: read a JSON array of EAVT
 * token-usage statement rows (as `agentSessionTokenUsageStatementRows`
 * produces) from a file path (argv[2]) or stdin, fold them through
 * `agentSessionTokenUsageObservationsOfRows`, and print the resulting
 * multi-dimensional settlement as JSON on stdout.
 *
 * Usage:
 *   node scripts/fold-token-usage-rows.mjs path/to/rows.json
 *   cat rows.json | node scripts/fold-token-usage-rows.mjs
 */
import { readFileSync } from "node:fs";
import { agentSessionTokenUsageObservationsOfRows } from "../../src/cost/token-usage/observations.mjs";

function readInput() {
  const path = process.argv[2];
  if (path !== undefined) return readFileSync(path, "utf8");
  return readFileSync(0, "utf8");
}

function main() {
  const rows = JSON.parse(readInput());
  if (!Array.isArray(rows)) {
    process.stderr.write("fold-token-usage-rows: input must be a JSON array of [e, a, v, t] rows\n");
    process.exit(2);
  }
  const readout = agentSessionTokenUsageObservationsOfRows(rows);
  process.stdout.write(`${JSON.stringify(readout, null, 2)}\n`);
}

main();
