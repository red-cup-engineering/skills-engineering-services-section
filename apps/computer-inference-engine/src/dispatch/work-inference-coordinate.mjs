/** Resolve supplier provenance; only the independent receiver supplies a judgment. */
import { loadDeliveries } from "./expected-resolution-pricing.mjs";
import { METROPLAT_INFERENCE_MARKET_CUSTOMER, officeWorkInferenceTaskClass } from "./inference-work-lot-source.mjs";

export function workInferenceCoordinate({
  proposal, pricingRoot, workProvider,
  customer = METROPLAT_INFERENCE_MARKET_CUSTOMER,
}) {
  if (!pricingRoot || !workProvider || proposal?.producer?.id !== workProvider
    || proposal.result?.kind !== "skill-result") return undefined;
  const reference = proposal.result.value?.inferenceDelivery;
  if (reference === undefined || !proposal.providerEvidence?.includes(proposal.execution)
    || !proposal.providerEvidence.includes(reference.receipt)) return undefined;
  if (reference.receiver !== customer || reference.taskClass !== officeWorkInferenceTaskClass(proposal.work)) return undefined;
  const delivery = loadDeliveries({ dataRoot: pricingRoot }).find(item =>
    ["workLot", "provider", "taskClass", "selectedOffer", "receipt", "receiver", "configurationIdentity"]
      .every(field => item[field] === reference[field]));
  if (delivery === undefined) return undefined;
  return Object.freeze({
    provider: delivery.provider, offer: delivery.selectedOffer,
    taskClass: delivery.taskClass, receipt: delivery.receipt,
    ...(delivery.configurationIdentity === undefined ? {} : { configuration: delivery.configurationIdentity }),
  });
}
