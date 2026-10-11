import { pricingRootOf } from "./expected-resolution-pricing.mjs";
import { inferenceWorkLotSource } from "./inference-work-lot-source.mjs";
import { localInferenceWorkLotSource } from "./local-inference-work-lot-source.mjs";
import { openAIChatInferenceSource } from "../openai/inference-client.mjs";

function required(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(name + " is required");
  return value.trim();
}

/** Resolve a provider source from an explicit host selection without knowing the hosting product. */
export function selectInferenceSource({ selection, env = process.env, market, now, fetch, descriptors, dataRoot, taskCustody } = {}) {
  const chosen = selection === undefined ? "inference-work-lot.local" : required(selection, "inference source selection");
  if (chosen === "openai.chat-completions") {
    return Object.freeze({
      provider: chosen,
      source: openAIChatInferenceSource({ env, ...(now === undefined ? {} : { now }) }),
    });
  }
  if (chosen === "inference-work-lot.local") {
    // Local delivery does not use the network transport; procurement remains the caller's.
    const { agentUrl, request, ...workLotOptions } = market ?? {};
    return Object.freeze({
      provider: "inference-work-lot.local",
      source: localInferenceWorkLotSource({
        ...workLotOptions,
        environment: env, dataRoot, taskCustody,
        ...(now === undefined ? {} : { now }),
        pricingRoot: pricingRootOf(env),
        serviceModel: env.METROPLAT_AGENT_WORKER_MODEL ?? "metroplat/bounded-inference",
        ...(descriptors === undefined ? {} : { directDescriptors: descriptors }),
      }),
    });
  }
  if (chosen !== "inference-work-lot.market") {
    throw new TypeError("unsupported inference source " + JSON.stringify(chosen));
  }
  if (market === null || typeof market !== "object") throw new TypeError("market policy is required");
  return Object.freeze({
    provider: chosen,
    source: inferenceWorkLotSource({
      ...market,
      agentUrl: required(market.agentUrl, "market agent card"),
      ...(now === undefined ? {} : { now }),
    }),
  });
}
