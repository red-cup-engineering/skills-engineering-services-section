#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readInferencePurchases } from "@red-cup-engineering/computer-inference-engine/dispatch/inference-purchase";
import { justifyFreeFirstOrder, purchaseRecordToObservation } from "../../src/openai/free-first-pricing-justification.mjs";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";

/**
 * Reports whether capability-pricing-service's expected-consideration
 * ranking agrees with the catalog's hardcoded routingPolicy.freeFirstOrder,
 * using whatever purchase-receipt history exists in the named inference
 * purchase journal root as observations. Read-only: never changes live
 * dispatch order.
 * @param {string[]} argv - `<catalog.json> [--receipt-root <dir>] [--task-class <name>]`.
 * @returns {{taskClass: string, hardcodedOrder: string[], pricingOrder: string[], agree: boolean, ranked: object[]}}
 */
export function justifyFreeFirstOrderCli(argv) {
  const [catalogPath] = argv;
  if (!catalogPath) throw new Error("usage: justify-free-first-order.mjs <catalog.json> [--receipt-root <dir>] [--task-class <name>]");
  const catalog = JSON.parse(readFileSync(resolve(catalogPath), "utf8"));
  const taskClass = argument("--task-class", argv) ?? "chat-completion";
  const receiptRoot = argument("--receipt-root", argv) ?? process.env.INFERENCE_PURCHASE_ROOT;
  const observations = receiptRoot
    ? readInferencePurchases({ root: receiptRoot }).map((record) => purchaseRecordToObservation(record, taskClass))
    : [];
  return justifyFreeFirstOrder(catalog, { observations, taskClass });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(justifyFreeFirstOrderCli(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
