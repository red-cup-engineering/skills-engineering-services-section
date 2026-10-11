/** Project one independently admitted work result into its exact inference delivery. */
import { recordInferenceOutcome } from "./inference-dispatch.mjs";
import { loadDeliveries, loadObservations } from "./expected-resolution-pricing.mjs";
import { METROPLAT_INFERENCE_MARKET_CUSTOMER, officeWorkInferenceTaskClass } from "./inference-work-lot-source.mjs";

export async function recordAcceptedWorkInferenceOutcome({
  proposal, discharge, pricingRoot, workProvider,
  customer = METROPLAT_INFERENCE_MARKET_CUSTOMER,
}) {
  if (!pricingRoot || proposal.producer.id !== workProvider || proposal.result.kind !== "skill-result") return 0;
  // The adapter carries the terminal source's exact delivery coordinate.
  // Custody addresses and incidental citations cannot identify an accepted product.
  const reference = proposal.result.value?.inferenceDelivery;
  if (reference === undefined || !proposal.providerEvidence.includes(proposal.execution)
    || !proposal.providerEvidence.includes(reference.receipt)) return 0;
  const taskClass = officeWorkInferenceTaskClass(proposal.work);
  if (reference.receiver !== customer || reference.taskClass !== taskClass) return 0;
  const delivery = loadDeliveries({ dataRoot: pricingRoot }).find((item) =>
    ["workLot", "provider", "taskClass", "selectedOffer", "receipt", "receiver", "configurationIdentity"]
      .every((field) => item[field] === reference[field]));
  if (delivery === undefined) return 0;
  if (loadObservations({ dataRoot: pricingRoot }).some((item) =>
    item.kind === "receiver-outcome" && item.delivery === delivery.id)) return 0;
  await recordInferenceOutcome({
    workLot: delivery.workLot, provider: delivery.provider, taskClass: delivery.taskClass,
    selectedOffer: delivery.selectedOffer, receipt: delivery.receipt, receiver: delivery.receiver,
    outcome: "accepted", evidence: `work-discharge:${discharge.id}`,
    ...(delivery.configurationIdentity ? { configurationIdentity: delivery.configurationIdentity } : {}),
  }, { pricingRoot });
  return 1;
}
