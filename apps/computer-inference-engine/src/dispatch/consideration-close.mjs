import { jsonValueId } from "./sen-carrier.mjs";
import { createInferenceSettlementStore } from "./witness-journal-settlement-store.mjs";
import {
  DIRECT_WITNESS_SETTLEMENT_CAPABILITY,
  RESOLUTION_CREDIT_ASSET,
  RESOLUTION_CREDIT_UNIT,
  appendConsiderationEvidence,
} from "./consideration.mjs";

export const CONSIDERATION_CLOSE_CATEGORY = "typed-inference.consideration-close";
export const CONSIDERATION_CLOSE_PROFILE = "org.emsenn.inference-consideration-close.v1";

const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
const identify = (value) => {
  return jsonValueId(value);
};
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be one object`);
  return value;
}
function identified(value, type, label) {
  object(value, label);
  if (value.type !== type || !NI.test(value.id ?? "")) throw new Error(`${label} has the wrong type or identity`);
  const { id, ...body } = value;
  if (identify(body) !== id) throw new Error(`${label} identity does not match its content`);
  return value;
}
function assayIdentity(value) {
  object(value, "customer assay");
  if (value.type !== "CustomerTypedInferenceAssay" || !NI.test(value.id ?? "") || typeof value.accepted !== "boolean") throw new Error("customer assay has the wrong type, identity, or verdict");
  return value;
}
function closureContext(procurementValue, assayValue) {
  const procurement = object(procurementValue, "typed inference procurement");
  if (procurement.type !== "TypedSenInferenceProcurement" || procurement.disposition !== "candidate-pending-customer-assay") throw new Error("consideration close requires one assayed candidate procurement");
  const compact = identified(procurement.compact, "InferenceExchangeCompact", "exchange compact");
  const receipt = identified(procurement.receipt, "InferenceExchangeReceipt", "exchange receipt");
  const assay = assayIdentity(assayValue);
  if (receipt.compact !== compact.id || receipt.work?.evidence !== procurement.settlement || receipt.work?.status !== "fulfilled") throw new Error("exchange receipt is not bound to the compact and provider settlement");
  if (assay.procurement !== procurement.settlement || assay.provider !== compact.provider.actor || assay.customer !== compact.customer.actor) throw new Error("customer assay is not bound to the exact procurement parties and settlement");
  if (!Array.isArray(compact.consideration?.obligations) || compact.consideration.obligations.length !== 1 || !Array.isArray(receipt.consideration) || receipt.consideration.length !== 1) throw new Error("v1 consideration close requires exactly one compact obligation");
  const obligation = compact.consideration.obligations[0], pending = receipt.consideration[0];
  if (pending.obligation !== obligation.id || pending.status !== "pending" || pending.evidence !== null || pending.settlementCapability !== obligation.settlementCapability) throw new Error("exchange receipt does not expose the exact pending compact obligation");
  return { procurement, compact, receipt, assay, obligation };
}

export function closeAssayedInferenceConsideration(procurement, assay, { closedAt } = {}) {
  const context = closureContext(procurement, assay);
  if (!Number.isFinite(Date.parse(closedAt))) throw new Error("consideration close requires one ISO closedAt instant");
  const { compact, receipt, obligation } = context;
  let evidenceCore, status, disposition;
  if (assay.accepted) {
    if (obligation.kind !== "credit" || obligation.asset !== RESOLUTION_CREDIT_ASSET || obligation.unit !== RESOLUTION_CREDIT_UNIT || obligation.settlementCapability !== DIRECT_WITNESS_SETTLEMENT_CAPABILITY) throw new Error("v1 can issue only the contracted direct-witness resolution credit");
    evidenceCore = {
      type: "ResolutionCreditIssuance",
      profile: CONSIDERATION_CLOSE_PROFILE,
      compact: compact.id,
      receipt: receipt.id,
      obligation: obligation.id,
      debtor: compact.customer,
      creditor: compact.provider,
      asset: obligation.asset,
      amount: obligation.amount,
      unit: obligation.unit,
      assay: assay.id,
      issuedAt: closedAt,
      status: "outstanding",
    };
    status = "fulfilled";
    disposition = "credit-issued";
  } else {
    evidenceCore = {
      type: "InferenceConsiderationNonDue",
      profile: CONSIDERATION_CLOSE_PROFILE,
      compact: compact.id,
      receipt: receipt.id,
      obligation: obligation.id,
      customer: compact.customer,
      provider: compact.provider,
      assay: assay.id,
      problems: [...(assay.problems ?? [])],
      determinedAt: closedAt,
      reason: "customer-output-schema-refusal",
    };
    status = "not-due";
    disposition = "consideration-not-due";
  }
  const evidence = Object.freeze({ id: identify(evidenceCore), ...evidenceCore });
  const successor = appendConsiderationEvidence(receipt, { obligation: obligation.id, status, evidence: evidence.id });
  const closeCore = {
    type: "AssayedInferenceConsiderationClose",
    profile: CONSIDERATION_CLOSE_PROFILE,
    procurement: procurement.settlement,
    compact: compact.id,
    initialReceipt: receipt.id,
    finalReceipt: successor.id,
    assay: assay.id,
    disposition,
    evidence,
    successor,
    closedAt,
  };
  return Object.freeze({ id: identify(closeCore), ...closeCore });
}

export async function recordAssayedInferenceConsiderationClose(procurement, assay, {
  customerServices,
  settlementRoot,
  dataRoot,
  store: suppliedStore,
  at = new Date().toISOString(),
} = {}) {
  const witnessJournal = customerServices?.witnessJournal;
  if (!witnessJournal?.actor) throw new Error("consideration close requires one explicitly admitted semantic record journal");
  const { compact, receipt } = closureContext(procurement, assay);
  const store = suppliedStore ?? await createInferenceSettlementStore({ settlementRoot, actor: compact.customer.actor, settlement: compact.customer.account, caip2: process.env.SETTLEMENT_CAIP2 });
  if (store.actor !== compact.customer.actor || store.settlement.toLowerCase() !== compact.customer.account.toLowerCase()) throw new Error("consideration debtor differs from the settlement-owned WitnessJournal plate");
  const existing = (await store.records(CONSIDERATION_CLOSE_CATEGORY)).filter((record) => record?.initialReceipt === receipt.id);
  if (existing.length > 1) throw new Error("multiple consideration closes claim the same initial receipt");
  if (existing.length === 1) {
    const expected = closeAssayedInferenceConsideration(procurement, assay, { closedAt: existing[0].closedAt });
    if (expected.id !== existing[0].id) throw new Error("existing consideration close conflicts with the exact assay or compact");
    return Object.freeze({ ...existing[0], idempotent: true });
  }
  const close = closeAssayedInferenceConsideration(procurement, assay, { closedAt: at });
  const projection = await store.record({ category: CONSIDERATION_CLOSE_CATEGORY, recordedAt: at, record: close });
  return Object.freeze({ ...close, projection: { graph: projection.documentNi, projection: projection.digest, networkReference: projection.reference }, idempotent: false });
}
