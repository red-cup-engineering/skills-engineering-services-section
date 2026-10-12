import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";

import { logDates, readLog } from "@red-cup-engineering/semiotic-eavt-services-section/store";
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
  // The feed is the `openai-chat-completions` log of the settlement root: one line `{at, e, a, v}` per recorded fact.
  if (![...logDates(binding.dataRoot, "openai-chat-completions")].includes(date)) return undefined;
  const collector = inferenceCostObservationCollector();
  let rows = 0;
  try {
    for (const { line } of readLog(binding.dataRoot, "openai-chat-completions", date)) {
      collector.push([line.e, line.a, line.v]);
      rows += 1;
    }
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
      description: "Domain: { date? }. Folds the openai-chat-completions log into worker, model, total, and conservation cost readouts.",
      run: (input) => readInferenceCostReadout(binding, operationDate(binding, input)) ?? null,
    }),
  ]);
}
