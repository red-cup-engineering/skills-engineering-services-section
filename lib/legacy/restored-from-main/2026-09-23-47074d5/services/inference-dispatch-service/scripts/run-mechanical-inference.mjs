#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchFreeFirstChatCompletion, computePurchasePrice } from "@red-cup-engineering/computer-inference-engine/openai";
import { recordInferencePurchase } from "@red-cup-engineering/agent-harness-computer-system-engineering-services-section";
import { classifyMechanicalSubtask } from "../src/mechanical-subtask-classification.mjs";
import { runMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";

/** This session's stable configured customer Actor (see .mcp.json inference-dispatch server instructions). A session is never itself a customer. */
export const CLAUDE_CUSTOMER_ACTOR = "actor:bZH6KBOlPVWbYpqp04izN_Xtwykn0XgsMBStm_FkPPw";

/** Resolved from the installed openai-compatible-chat-completion-service package root, not a relative repo path -- correct under any consumer's own node_modules layout. */
export const DEFAULT_CATALOG_PATH = fileURLToPath(new URL("./content/providers/catalog.json", import.meta.resolve("@red-cup-engineering/computer-inference-engine/package.json")));

/**
 * Bridges a mechanical subagent-class subtask (classification, extraction,
 * summarization, a boilerplate transform) straight to the free cloud
 * inference tier, so a hook or session can offload gruntwork in one call
 * instead of spending frontier subagent budget on it. Composes three
 * already-published primitives -- classifyMechanicalSubtask (refuses
 * anything that isn't a closed mechanical shape or smells like judgment),
 * dispatchFreeFirstChatCompletion (the free-first retry loop; never falls
 * back to a paid provider), and recordInferencePurchase (the same purchase
 * receipt writer the priced path uses) -- rather than re-implementing any
 * of them.
 * @param {string[]} argv - `--task-type <classification|extraction|summarization|boilerplate-transform> --instructions <text> (--input <text>|--input-file <path>) --receipt-root <dir> --turn <turnId> [--actor <actor>] [--catalog <path>] [--model <id>]`.
 * @returns {Promise<object>} `{admitted, reason?}` on refusal, or `{admitted: true, ...dispatchResult, receipt?}` on an attempted dispatch.
 */
export async function runMechanicalInferenceCli(argv) {
  const taskType = argument("--task-type", argv);
  const instructions = argument("--instructions", argv);
  const classification = classifyMechanicalSubtask({ taskType, instructions });
  if (!classification.admitted) return { admitted: false, reason: classification.reason };

  const inputFile = argument("--input-file", argv);
  const input = inputFile ? readFileSync(resolve(inputFile), "utf8") : (argument("--input", argv) ?? "");
  if (input.trim() === "") throw new Error("one of --input or --input-file must supply nonempty content");

  const catalogPath = argument("--catalog", argv) ?? DEFAULT_CATALOG_PATH;
  const catalog = JSON.parse(readFileSync(resolve(catalogPath), "utf8"));
  const model = argument("--model", argv) ?? "mechanical-inference-bridge";
  const packet = { model, messages: [{ role: "user", content: `${instructions}\n\n${input}` }] };
  const result = await dispatchFreeFirstChatCompletion({ catalog, packet });
  if (!result.exchange) return { admitted: true, ...result };

  const receiptRoot = argument("--receipt-root", argv) ?? process.env.HARNESS_LIFECYCLE_ROOT;
  const turnId = argument("--turn", argv) ?? process.env.HARNESS_LIFECYCLE_TURN;
  if (!receiptRoot) throw new Error("a dispatched exchange requires --receipt-root (or HARNESS_LIFECYCLE_ROOT) to record its purchase receipt");
  if (!turnId) throw new Error("a dispatched exchange requires --turn (or HARNESS_LIFECYCLE_TURN) to record its purchase receipt");
  const actor = argument("--actor", argv) ?? process.env.HARNESS_LIFECYCLE_ACTOR ?? CLAUDE_CUSTOMER_ACTOR;
  const row = catalog.rows.find((candidate) => candidate.providerId === result.provider);
  if (!row) throw new Error(`catalog carries no row for dispatched provider ${result.provider}`);
  const price = computePurchasePrice(row, result.exchange.usage);
  const receipt = recordInferencePurchase({
    root: receiptRoot,
    actor,
    turnId,
    provider: result.provider,
    model: result.exchange.completion?.model ?? row.defaultModel ?? model,
    outcome: result.exchange.outcome,
    latencySeconds: result.exchange.cost["wall-time-seconds"],
    exchangeId: result.exchange.id,
    price,
    ...(result.exchange.usage ? { usage: result.exchange.usage } : {}),
  });
  return { admitted: true, ...result, receipt };
}

runMain(({ argv }) => runMechanicalInferenceCli(argv), {
  moduleUrl: import.meta.url,
  isEntry: () => import.meta.main,
  formatResult: (result) => `${JSON.stringify(result, null, 2)}\n`,
  formatError: (error) => `${error.message}\n`,
  exitCode: 1,
});
