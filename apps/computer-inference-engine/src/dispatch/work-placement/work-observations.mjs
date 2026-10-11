import { createRelationalField, defineRelation } from "@red-cup-engineering/computer-data-engineering-services-section/type-system/relations";
import { defineType } from "@red-cup-engineering/computer-data-engineering-services-section/type-system";

const text = { type: "string", pattern: "\\S" };
const amount = { type: "object", required: ["numerator", "denominator"], properties: { numerator: text, denominator: text } };
const dimension = { type: "object", required: ["resource", "unit", "amount"], properties: { resource: text, asset: text, unit: text, amount } };
const established = result => {
  if (!result.ok) throw new TypeError(result.refusal.message);
  return result.value;
};
const receipt = established(defineType({ id: "work-placement.receipt", name: "Work placement receipt", description: "An attributable observation identity.", parents: [], schema: text }));

/** One executable declaration shared by local observations and transported field admission. */
export const workPlacementObservationType = established(defineType({
  id: "WorkPlacementObservation", name: "Work placement observation", description: "An observed attempt or a result with explicit reuse authority.", parents: [],
  schema: {
    type: "object", required: ["type", "receipt", "offerId", "taskClass", "kind", "outcome"],
    properties: { type: { const: "WorkPlacementObservation" }, receipt: text, offerId: text, taskClass: text, accountIdentity: text, windowIdentity: text },
    oneOf: [
      { properties: { kind: { const: "attempt" }, outcome: { enum: ["accepted", "refused"] }, latency: { type: "object", required: ["unit", "amount"], properties: { unit: text, amount } }, resources: { type: "array", items: dimension } } },
      { required: ["sourceReceipt", "sourceOfferId", "sourceConfigurationIdentity"], properties: { kind: { const: "quality-prior" }, outcome: { enum: ["accepted", "refused"] }, sourceReceipt: text, sourceOfferId: text, sourceConfigurationIdentity: text } },
      { required: ["demand", "implementationIdentity", "resultReceipt", "reuse"], properties: { kind: { const: "accepted-result" }, outcome: { const: "accepted" }, demand: { type: "object" }, implementationIdentity: text, resultReceipt: text, reuse: { const: "permitted" } } },
    ],
  },
}));

export const workPlacementObservationRelation = established(defineRelation({ id: "work-placement.observed", domain: receipt, codomain: workPlacementObservationType, witness: receipt }));

/** A replayed receipt is one assertion; differing evidence remains in the field. */
export function admitWorkPlacementObservationField(observations) {
  if (!Array.isArray(observations)) throw new TypeError("observations must be an array");
  return established(createRelationalField([workPlacementObservationRelation], observations.map(observation => ({
    subject: observation?.receipt, predicate: workPlacementObservationRelation.id, object: observation, witness: observation?.receipt,
  }))));
}
