import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-engineering-services-section/semantic-content-identity";
import { tally } from "@red-cup-engineering/computer-data-engineering-services-section/tally";
import { CONTEXT_PACKET_PROFILE } from "./packet.mjs";

function ni(value, objectKind) {
  return identifyJsonSemanticContent({ objectKind, value, witnessRoot: EMPTY_WITNESS_ROOT }).id;
}

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be a nonempty string`);
  return value;
}

function natural(value, label) {
  if (!/^[0-9]+$/u.test(value ?? "")) throw new TypeError(`${label} must be a canonical natural decimal string`);
  return BigInt(value);
}

function gcd(left, right) {
  while (right !== 0n) [left, right] = [right, left % right];
  return left < 0n ? -left : left;
}

/** Normalize an exact, positive asset consideration without decimal rounding. */
export function exactConsideration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("consideration must be an object");
  const numerator = natural(value.numerator, "consideration.numerator");
  const denominator = natural(value.denominator, "consideration.denominator");
  if (numerator === 0n || denominator === 0n) throw new TypeError("consideration must be an exact positive quantity");
  const divisor = gcd(numerator, denominator);
  return Object.freeze({ asset: nonempty(value.asset, "consideration.asset"), numerator: String(numerator / divisor), denominator: String(denominator / divisor) });
}

/** State one independently witnessed side of a context-packet trade. */
export function contextTradeReceiptClaim({ role, actor, counterparty, caseId, packet, consideration }) {
  if (!new Set(["release", "admission"]).has(role)) throw new TypeError("receipt role must be release or admission");
  if (packet?.profile !== CONTEXT_PACKET_PROFILE || !/^ni:\/\/\/sha-256;/u.test(packet.id ?? "")) throw new TypeError("receipt requires a formed context packet");
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
  if (body.actor === body.counterparty) throw new TypeError("a context trade requires two independent actors");
  return Object.freeze({ id: ni(body, "context-trade.receipt-claim"), ...body });
}

/** Reconcile exactly one release and one admission proof into a settled tally. */
export async function reconcileContextTrade({ packet, receipts, verifyReceipt }) {
  if (!Array.isArray(receipts) || receipts.length !== 2) throw new TypeError("one context tally requires exactly two WIT receipts");
  if (typeof verifyReceipt !== "function") throw new TypeError("an independent receipt verifier is required");
  const byRole = new Map(receipts.map((receipt) => [receipt?.claim?.role, receipt]));
  if (byRole.size !== 2 || !byRole.has("release") || !byRole.has("admission")) throw new TypeError("receipts must contain exactly one release WIT and one admission WIT");
  const release = byRole.get("release");
  const admission = byRole.get("admission");
  for (const { claim, proof } of [release, admission]) {
    const body = Object.fromEntries(Object.entries(claim ?? {}).filter(([key]) => key !== "id"));
    if (claim?.id !== ni(body, "context-trade.receipt-claim")) throw new TypeError(`${claim?.role ?? "unknown"} receipt claim id differs from its content`);
    if (!proof || typeof proof !== "object") throw new TypeError(`${claim.role} receipt lacks a proof`);
    if (await verifyReceipt(claim, proof) !== true) throw new TypeError(`${claim.role} receipt proof was not verified`);
  }
  const reconciled = tally({ release: release.claim, admission: admission.claim, fields: ["caseId", "packet", "knowledge", "consideration"] });
  if (reconciled.status !== "settled") throw new TypeError(`release and admission receipts disagree on ${reconciled.mismatches.join(", ")}`);
  if (release.claim.packet !== packet?.id) throw new TypeError("receipts do not settle the supplied context packet");
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
