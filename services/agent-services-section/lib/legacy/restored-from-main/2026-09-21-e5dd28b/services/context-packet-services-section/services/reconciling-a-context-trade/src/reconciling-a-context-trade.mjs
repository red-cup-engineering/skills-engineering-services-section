import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/relation-model-notation-runtime/semantic-content-identity";
import { canonicalJson } from "@red-cup-engineering/computer-data-engine/identity";


function ni(value, objectKind) { return identifyJsonSemanticContent({ objectKind, value, witnessRoot: EMPTY_WITNESS_ROOT }).id; }
function nonempty(value, label) { if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a nonempty string`); return value; }
function gcd(left, right) { while (right !== 0n) [left, right] = [right, left % right]; return left < 0n ? -left : left; }
function natural(value, label) { if (!/^[0-9]+$/u.test(value ?? "")) throw new Error(`${label} must be a canonical natural decimal string`); return BigInt(value); }

export function exactConsideration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("consideration must be an object");
  const numerator = natural(value.numerator, "consideration.numerator"), denominator = natural(value.denominator, "consideration.denominator");
  if (numerator === 0n || denominator === 0n) throw new Error("consideration must be an exact positive quantity");
  const divisor = gcd(numerator, denominator);
  return Object.freeze({ asset: nonempty(value.asset, "consideration.asset"), numerator: String(numerator / divisor), denominator: String(denominator / divisor) });
}

export function contextTradeReceiptClaim({ role, actor, counterparty, caseId, packet, consideration }) {
  if (!new Set(["release", "admission"]).has(role)) throw new Error("receipt role must be release or admission");
  if (packet?.profile !== "org.harmonious-union.context-packet.v1" || !/^ni:\/\/\/sha-256;/u.test(packet.id ?? "")) throw new Error("receipt requires a formed context packet");
  const body = Object.freeze({
    profile: "org.harmonious-union.context-trade-receipt-claim.v1",
    role,
    actor: nonempty(actor, "actor"),
    counterparty: nonempty(counterparty, "counterparty"),
    caseId: nonempty(caseId, "caseId"),
    packet: packet.id,
    knowledge: Object.freeze(packet.knowledge.map(({ ni: address, relation }) => Object.freeze({ ni: address, relation }))),
    consideration: exactConsideration(consideration),
  });
  if (body.actor === body.counterparty) throw new Error("a context trade requires two independent actors");
  return Object.freeze({ id: ni(body, "context-trade.receipt-claim"), ...body });
}

export async function reconcileContextTrade({ packet, receipts, verifyReceipt }) {
  if (!Array.isArray(receipts) || receipts.length !== 2) throw new Error("one context tally requires exactly two WIT receipts");
  if (typeof verifyReceipt !== "function") throw new Error("an independent receipt verifier is required");
  const byRole = new Map(receipts.map((receipt) => [receipt?.claim?.role, receipt]));
  if (byRole.size !== 2 || !byRole.has("release") || !byRole.has("admission")) throw new Error("receipts must contain exactly one release WIT and one admission WIT");
  const release = byRole.get("release"), admission = byRole.get("admission");
  for (const receipt of [release, admission]) {
    const { claim, proof } = receipt;
    if (claim?.id !== ni(Object.fromEntries(Object.entries(claim).filter(([key]) => key !== "id")), "context-trade.receipt-claim")) throw new Error(`${claim?.role ?? "unknown"} receipt claim id differs from its content`);
    if (!proof || typeof proof !== "object") throw new Error(`${claim.role} receipt lacks a proof`);
    if (await verifyReceipt(claim, proof) !== true) throw new Error(`${claim.role} receipt proof was not verified`);
  }
  const same = (field) => canonicalJson(release.claim[field]) === canonicalJson(admission.claim[field]);
  for (const field of ["caseId", "packet", "knowledge", "consideration"]) if (!same(field)) throw new Error(`release and admission receipts disagree on ${field}`);
  if (release.claim.actor !== admission.claim.counterparty || admission.claim.actor !== release.claim.counterparty) throw new Error("release and admission actors do not name each other");
  if (release.claim.packet !== packet?.id) throw new Error("receipts do not settle the supplied context packet");
  const body = Object.freeze({
    profile: "org.harmonious-union.context-trade-tally.v1",
    caseId: release.claim.caseId,
    packet: packet.id,
    knowledge: release.claim.knowledge,
    consideration: release.claim.consideration,
    releaseActor: release.claim.actor,
    admissionActor: admission.claim.actor,
    receipts: Object.freeze([release.claim.id, admission.claim.id].sort()),
    witCount: 2,
  });
  return Object.freeze({ id: ni(body, "context-trade.tally"), ...body });
}
