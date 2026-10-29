#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { recordInferencePurchase } from "@red-cup-engineering/computer-inference-engine/dispatch/inference-purchase";
import { runMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { computePurchasePrice } from "../../src/openai/openai-compatible-chat-completion.mjs";
import { dispatchFreeFirstChatCompletionCli } from "./dispatch-free-first-chat-completion.mjs";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";

/** This session's stable configured customer Actor (see .mcp.json inference-dispatch server instructions). A session is never itself a customer. */
export const CLAUDE_CUSTOMER_ACTOR = "actor:bZH6KBOlPVWbYpqp04izN_Xtwykn0XgsMBStm_FkPPw";

/**
 * Dispatches one packet through the free-first CLI and, when a real
 * provider exchange occurred (completion or refusal, never for the
 * every-row-unarmed/excluded no-exchange case), writes exactly one
 * purchase-receipt event to the inference purchase journal -- so a caller
 * gets both the exchange and its recorded receipt from one command,
 * never a hand-rolled writer.
 * @param {string[]} argv - `<catalog.json> <packet.json> --receipt-root <dir> --turn <turnId> [--actor <actor>]`.
 * @returns {Promise<object>} the dispatch result, plus `receipt` when one was written.
 */
export async function dispatchFreeFirstChatCompletionWithReceiptCli(argv) {
  const [catalogPath, packetPath] = argv;
  const receiptRoot = argument("--receipt-root", argv) ?? process.env.INFERENCE_PURCHASE_ROOT;
  const turnId = argument("--turn", argv) ?? process.env.HARNESS_LIFECYCLE_TURN;
  const actor = argument("--actor", argv) ?? process.env.HARNESS_LIFECYCLE_ACTOR ?? CLAUDE_CUSTOMER_ACTOR;
  const result = await dispatchFreeFirstChatCompletionCli([catalogPath, packetPath]);
  if (!result.exchange) return result;
  if (!receiptRoot) throw new Error("a dispatched exchange requires --receipt-root (or INFERENCE_PURCHASE_ROOT) to record its purchase receipt");
  if (!turnId) throw new Error("a dispatched exchange requires --turn (or HARNESS_LIFECYCLE_TURN) to record its purchase receipt");
  const catalog = JSON.parse(readFileSync(resolve(catalogPath), "utf8"));
  const row = catalog.rows.find((candidate) => candidate.providerId === result.provider);
  if (!row) throw new Error(`catalog carries no row for dispatched provider ${result.provider}`);
  const price = computePurchasePrice(row, result.exchange.usage);
  const receipt = recordInferencePurchase({
    root: receiptRoot,
    actor,
    turnId,
    provider: result.provider,
    model: result.exchange.completion?.model ?? result.exchange.packet?.model ?? row.defaultModel,
    outcome: result.exchange.outcome,
    latencySeconds: result.exchange.cost["wall-time-seconds"],
    exchangeId: result.exchange.id,
    price,
    ...(result.exchange.usage ? { usage: result.exchange.usage } : {}),
  });
  return { ...result, receipt };
}

runMain(({ argv }) => dispatchFreeFirstChatCompletionWithReceiptCli(argv), {
  moduleUrl: import.meta.url,
  isEntry: (url, entry) => Boolean(entry) && url === pathToFileURL(resolve(entry)).href,
  exitCode: 1,
  formatResult: (result) => `${JSON.stringify(result, null, 2)}\n`,
});
