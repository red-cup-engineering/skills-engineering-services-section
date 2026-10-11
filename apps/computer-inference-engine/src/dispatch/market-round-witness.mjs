import { jsonValueId } from "./sen-carrier.mjs";

export const INFERENCE_MARKET_WITNESS_VERSION = 2;
export const INFERENCE_MARKET_WITNESS_KINDS = Object.freeze([
  "round-opened",
  "offer-solicited",
  "offer-admitted",
  "offer-refused",
  "route-decided",
  "contract-boundary-obstructed",
  "provider-attempted",
  "provider-refused",
  "provider-transport-obstructed",
  "provider-task-pending",
  "provider-delivered-candidate",
  "provider-capacity-observed",
  "round-exhausted",
  "receiver-outcome-recorded",
]);
const kinds = new Set(INFERENCE_MARKET_WITNESS_KINDS);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be one object`);
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be nonempty text`);
  return value;
}

function exactInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a nonnegative safe integer`);
  return value;
}

function validateKind(kind, evidence) {
  if (!kinds.has(kind)) throw new TypeError(`unsupported inference market witness kind ${String(kind)}`);
  const providerKinds = new Set([
    "offer-solicited", "offer-admitted", "offer-refused", "provider-attempted",
    "provider-refused", "provider-transport-obstructed", "provider-task-pending", "provider-delivered-candidate",
    "provider-capacity-observed",
  ]);
  if (providerKinds.has(kind)) text(evidence.provider, `${kind}.provider`);
  if (["offer-solicited", "offer-refused"].includes(kind)) text(evidence.solicitation, `${kind}.solicitation`);
  if (["offer-admitted", "provider-attempted", "provider-refused", "provider-transport-obstructed", "provider-task-pending", "provider-delivered-candidate"].includes(kind)) {
    text(evidence.offer, `${kind}.offer`);
  }
  if (kind === "offer-admitted") text(evidence.model, "offer-admitted.model");
  if (["offer-refused", "provider-refused", "provider-transport-obstructed"].includes(kind)) text(evidence.reason, `${kind}.reason`);
  if (kind === "provider-transport-obstructed" && evidence.detail !== undefined) text(evidence.detail, "provider-transport-obstructed.detail");
  if (kind === "route-decided") {
    text(evidence.disposition, "route-decided.disposition");
    object(evidence.executionAuthority, "route-decided.executionAuthority");
    if (evidence.executionAuthority.sequential !== false || evidence.executionAuthority.implicitFallbackPermitted !== false || evidence.executionAuthority.speculativeExecutionPermitted !== false) {
      throw new TypeError("the current direct route decision must deny sequential, implicit fallback, and speculative execution authority");
    }
    if (![0, 1].includes(evidence.executionAuthority.maximumProviderAttempts)) throw new TypeError("the current direct route decision permits at most one provider attempt");
  }
  if (kind === "contract-boundary-obstructed") {
    text(evidence.customer, "contract-boundary-obstructed.customer");
    text(evidence.reason, "contract-boundary-obstructed.reason");
    text(evidence.detail, "contract-boundary-obstructed.detail");
  }
  if (kind === "provider-attempted") {
    text(evidence.compact, "provider-attempted.compact");
    text(evidence.proposal, "provider-attempted.proposal");
    text(evidence.message, "provider-attempted.message");
  }
  if (kind === "provider-delivered-candidate") {
    text(evidence.compact, "provider-delivered-candidate.compact");
    text(evidence.settlement, "provider-delivered-candidate.settlement");
    text(evidence.receipt, "provider-delivered-candidate.receipt");
    text(evidence.candidate, "provider-delivered-candidate.candidate");
  }
  if (kind === "receiver-outcome-recorded") {
    text(evidence.receiver, "receiver-outcome-recorded.receiver");
    text(evidence.deliveryReceipt, "receiver-outcome-recorded.deliveryReceipt");
    if (!["accepted", "refused"].includes(evidence.outcome)) throw new TypeError("receiver outcome must be accepted or refused");
  } else if (Object.hasOwn(evidence, "receiverOutcome") || Object.hasOwn(evidence, "receiverAcceptance")) {
    throw new TypeError(`${kind} cannot assert a receiver outcome`);
  }
  if (kind === "provider-capacity-observed") {
    if (!["declared", "observed"].includes(evidence.source)) throw new TypeError("capacity evidence source must be declared or observed");
    exactInteger(evidence.capacity, "provider capacity");
    text(evidence.meaning, "provider capacity meaning");
    text(evidence.evidence, "provider capacity evidence");
  }
  if (kind === "round-exhausted") {
    text(evidence.reason, "round exhaustion reason");
    if (!Array.isArray(evidence.witnesses) || evidence.witnesses.some((value) => typeof value !== "string")) {
      throw new TypeError("round exhaustion must list its witness identities");
    }
  }
}

export function inferenceMarketWitness(input) {
  object(input, "inference market witness");
  const evidence = object(input.evidence, "inference market witness evidence");
  const body = Object.freeze({
    type: "InferenceMarketWitness",
    version: INFERENCE_MARKET_WITNESS_VERSION,
    workLot: text(input.workLot, "inference market witness workLot"),
    round: exactInteger(input.round, "inference market witness round"),
    ordinal: exactInteger(input.ordinal, "inference market witness ordinal"),
    kind: text(input.kind, "inference market witness kind"),
    recordedAt: text(input.recordedAt, "inference market witness recordedAt"),
    demand: text(input.demand, "inference market witness demand"),
    ...(input.routeDecision === undefined || input.routeDecision === null ? {} : { routeDecision: text(input.routeDecision, "inference market witness routeDecision") }),
    ...(input.prior === undefined || input.prior === null ? {} : { prior: text(input.prior, "inference market witness prior") }),
    evidence: Object.freeze({ ...evidence }),
  });
  validateKind(body.kind, body.evidence);
  return Object.freeze({ id: jsonValueId(body), ...body });
}

/** Build one deterministic in-memory round chain. Persistence remains an
 * injected customer WitnessJournal concern. */
export function inferenceMarketRoundTrace({ workLot, round = 0, demand, recordedAt, prior = null, ordinal = 0 }) {
  if (prior !== null) text(prior, "inference market witness prior");
  exactInteger(ordinal, "inference market witness ordinal");
  const witnesses = [];
  let predecessor = prior;
  return Object.freeze({
    append(kind, evidence, { routeDecision } = {}) {
      const witness = inferenceMarketWitness({
        workLot, round, ordinal: ordinal + witnesses.length, kind,
        recordedAt: typeof recordedAt === "function" ? recordedAt() : recordedAt,
        demand, prior: predecessor, evidence, ...(routeDecision ? { routeDecision } : {}),
      });
      witnesses.push(witness);
      predecessor = witness.id;
      return witness;
    },
    read() { return Object.freeze([...witnesses]); },
  });
}
