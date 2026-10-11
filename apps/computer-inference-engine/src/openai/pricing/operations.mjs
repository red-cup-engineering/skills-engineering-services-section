import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";

import { journal } from "@red-cup-engineering/computer-system-engine/journal/journal";
import { inferenceCostObservationCollector } from "@red-cup-engineering/computer-inference-engine/openai/pricing/inference-cost-observations";

function operationDate(binding, input) {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const date = (input)["date"];
    if (typeof date === "string" && date.length > 0) return date;
  }
  return binding.now().slice(0, 10);
}

export function readInferenceCostReadout(
  binding,
  date,
) {
  const logPath = journal.feed(binding.dataRoot, "openai-chat-completions", date, { subject: "openai-chat-completions" });
  if (!journal.sourceStatus(logPath).exists) return undefined;
  const collector = inferenceCostObservationCollector();
  let rows = 0;
  try {
    const folded = journal.scan(logPath, undefined, (_accum, row) => {
      collector.push(row);
      return undefined;
    });
    rows = folded.rows;
  } catch {
    return undefined;
  }
  if (rows === 0) return undefined;
  return Object.freeze({
    ...collector.read(),
    kind: "metroplat.holography.inference-cost-settlement",
    date,
  });
}

export function openAIPricingOperations(binding) {
  return Object.freeze([
    operation({
      verb: "inference-cost",
      inputFormat: "json",
      outputFormat: "json",
      summary: "Settle recorded OpenAI chat-completion inference cost.",
      description: "Domain: { date? }. Folds the openai-chat-completions statement feed into worker, model, total, and conservation cost readouts.",
      run: (input) => readInferenceCostReadout(binding, operationDate(binding, input)) ?? null,
    }),
  ]);
}
