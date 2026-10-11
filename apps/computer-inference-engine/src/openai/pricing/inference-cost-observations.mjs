/** Read recorded call costs by worker and model, preserving exact commodity conservation. */
import { composeCost } from "./cost.mjs";
import { gradedFromParts, gradedNegate, gradedResidual } from "@red-cup-engineering/computer-data-engineering-services-section/number/graded";
import { isJsonRecord } from "@red-cup-engineering/json-services-section";

/** One (worker, model) subtotal. */

const MICRODOLLARS_PER_DOLLAR = 1_000_000;

function microdollars(dollars) {
  return Math.round(dollars * MICRODOLLARS_PER_DOLLAR);
}

/** One recorded call's cost reading, or `undefined` when the row is not a
 *  recognizable `openai.chat-completions.call` claim (an unrelated fact on
 *  the same feed, or a call recorded before this reduction's fields
 *  existed). */
function callReadingOfRow(row) {
  const [, , value] = row;
  if (!isJsonRecord(value) || value["kind"] !== "openai.chat-completions.call") return undefined;
  const request = value["request"];
  const cost = value["cost"];
  if (!isJsonRecord(cost) || typeof cost["model"] !== "string") return undefined;
  const inputTokens = cost["inputTokens"];
  const outputTokens = cost["outputTokens"];
  const dollars = cost["dollars"];
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number" || typeof dollars !== "number") return undefined;
  const worker = isJsonRecord(request) && typeof request["user"] === "string" && request["user"].trim().length > 0
    ? request["user"]
    : "unknown";
  return Object.freeze({
    worker,
    model: cost["model"],
    amount: Object.freeze({ dollars, tokens: Object.freeze({ input: inputTokens, output: outputTokens }) }),
  });
}

function pushInto(map, key, amount) {
  const list = map.get(key);
  if (list === undefined) map.set(key, [amount]);
  else list.push(amount);
}

function foldRecord(amounts) {
  const out = {};
  for (const [key, list] of amounts) out[key] = composeCost(list, "serial");
  return Object.freeze(out);
}

/** Reduce a day's recorded `openai-chat-completions` admit rows to a
 *  per-worker, per-model cost table with a dollar-conservation certificate. */

export function inferenceCostObservationCollector() {
  const byCell = new Map();
  const byWorkerAmounts = new Map();
  const byModelAmounts = new Map();
  const totalAmounts = [];
  const push = (row) => {
    const reading = callReadingOfRow(row);
    if (reading === undefined) return;
    const cellKey = `${reading.worker}\n${reading.model}`;
    const cell = byCell.get(cellKey) ?? { worker: reading.worker, model: reading.model, amounts: [] };
    cell.amounts.push(reading.amount);
    byCell.set(cellKey, cell);
    pushInto(byWorkerAmounts, reading.worker, reading.amount);
    pushInto(byModelAmounts, reading.model, reading.amount);
    totalAmounts.push(reading.amount);
  };
  const read = () => {
    const cells = [...byCell.values()].map((cell) => Object.freeze({
      worker: cell.worker,
      model: cell.model,
      calls: cell.amounts.length,
      cost: composeCost(cell.amounts, "serial"),
    }));
    const total = composeCost(totalAmounts, "serial");
    const byWorkerGrandTotalDollars = [...byWorkerAmounts.values()]
      .reduce((sum, amounts) => sum + composeCost(amounts, "serial").dollars, 0);
    const credit = gradedFromParts(microdollars(byWorkerGrandTotalDollars), MICRODOLLARS_PER_DOLLAR, "USD");
    const debit = gradedFromParts(microdollars(total.dollars), MICRODOLLARS_PER_DOLLAR, "USD");
    const residual = gradedResidual([credit, gradedNegate(debit)]);
    return Object.freeze({
      kind: "metroplat.inference-cost-cut",
      calls: totalAmounts.length,
      cells: Object.freeze(cells),
      byWorker: foldRecord(byWorkerAmounts),
      byModel: foldRecord(byModelAmounts),
      total,
      conservation: Object.freeze({ conserved: residual.length === 0, residual }),
    });
  };
  return Object.freeze({
    push,
    read,
  });
}

export function inferenceCostObservationsOfRows(rows) {
  const collector = inferenceCostObservationCollector();
  for (const row of rows) collector.push(row);
  return collector.read();
}
