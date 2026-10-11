import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-engineering-services-section/semantic-content-identity";

import { decideWorkPlacement } from "./decide-work-placement.mjs";

export const GLASS_SPONGE_CHAIN = "eip155:5615611";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const IMMUTABLE_REFERENCE = /^(?:ni:\/\/\/sha-256;[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]|urn:sha256:[0-9a-f]{64})$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be one object`);
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be nonempty text`);
  return value;
}

function immutableReference(value, label) {
  if (typeof value !== "string" || !IMMUTABLE_REFERENCE.test(value)) {
    throw new TypeError(`${label} must be an RFC 6920 ni URI or urn:sha256 reference`);
  }
  return value;
}

function address(value, label) {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new TypeError(`${label} must be one EVM address`);
  return value.toLowerCase();
}

function bytes32(value, label) {
  if (typeof value !== "string" || !BYTES32.test(value)) throw new TypeError(`${label} must be one bytes32 value`);
  return value.toLowerCase();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  if (value === undefined || typeof value === "bigint" || typeof value === "function") {
    throw new TypeError("content-addressed values must be JSON values without undefined, bigint, or functions");
  }
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(stable(value)));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function pulseContentAddress(value) {
  return identifyJsonSemanticContent({
    objectKind: `inference-work-lot.${value?.type ?? "autonomic-pulse-material"}`,
    value: stable(value),
    witnessRoot: EMPTY_WITNESS_ROOT,
  }).token;
}

function exactAmount(value, label) {
  object(value, label);
  if (!DECIMAL.test(value.numerator ?? "") || !DECIMAL.test(value.denominator ?? "") || value.denominator === "0") {
    throw new TypeError(`${label} must be an exact nonnegative fraction`);
  }
  return deepFreeze({ numerator: value.numerator, denominator: value.denominator });
}

function exactResources(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return deepFreeze(value.map((entry, index) => {
    object(entry, `${label}[${index}]`);
    return {
      resource: text(entry.resource, `${label}[${index}].resource`),
      unit: text(entry.unit, `${label}[${index}].unit`),
      amount: exactAmount(entry.amount, `${label}[${index}].amount`),
    };
  }));
}

function conditions(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new TypeError(`${label} must contain at least one nonempty condition`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${label} must not repeat a condition`);
  return deepFreeze([...value]);
}

function workflow(value) {
  const input = object(value, "workflow");
  if (input.chain !== GLASS_SPONGE_CHAIN) throw new TypeError(`workflow.chain must be ${GLASS_SPONGE_CHAIN}`);
  return deepFreeze({
    chain: GLASS_SPONGE_CHAIN,
    semioticExchange: address(input.semioticExchange, "workflow.semioticExchange"),
    demand: bytes32(input.demand, "workflow.demand"),
    glassPoreRegistry: address(input.glassPoreRegistry, "workflow.glassPoreRegistry"),
    pore: bytes32(input.pore, "workflow.pore"),
  });
}

/**
 * Admit one inert pulse from exactly one immutable origin. The returned NI URI
 * is a derivation over the supplied GLASS_SPONGE_CHAIN workflow coordinates,
 * not a local queue identifier and not an assertion that any work was performed.
 */
export function admitAutonomicPulse({ origin: originValue, workflow: workflowValue, demand: demandValue } = {}) {
  const joinedWorkflow = workflow(workflowValue);
  const demand = clone(object(demandValue, "demand"));
  if (demand.type !== "TypedWorkDemand") throw new TypeError("demand.type must be TypedWorkDemand");
  text(demand.id, "demand.id");
  text(demand.taskClass, "demand.taskClass");

  const input = object(originValue, "origin");
  let origin;
  let completionConditions;
  if (input.kind === "user-prompt-metabolism") {
    completionConditions = conditions(input.completionConditions, "origin.completionConditions");
    origin = {
      kind: input.kind,
      admission: immutableReference(input.admission, "origin.admission"),
      promptEvent: immutableReference(input.promptEvent, "origin.promptEvent"),
      promptDigest: immutableReference(input.promptDigest, "origin.promptDigest"),
    };
  } else if (input.kind === "unsatisfied-prior-outcome") {
    completionConditions = conditions(input.unsatisfiedConditions, "origin.unsatisfiedConditions");
    origin = {
      kind: input.kind,
      predecessorPulse: immutableReference(input.predecessorPulse, "origin.predecessorPulse"),
      outcomeReceipt: immutableReference(input.outcomeReceipt, "origin.outcomeReceipt"),
    };
  } else {
    throw new TypeError("origin.kind must be user-prompt-metabolism or unsatisfied-prior-outcome");
  }

  const body = deepFreeze({
    type: "GlassSpongeAutonomicPulse",
    version: 1,
    workflow: joinedWorkflow,
    origin: deepFreeze(origin),
    completionConditions,
    demand,
  });
  return deepFreeze({ id: pulseContentAddress(body), ...body });
}

function pulse(value) {
  const admitted = object(value, "pulse");
  const { id, ...body } = admitted;
  immutableReference(id, "pulse.id");
  if (admitted.type !== "GlassSpongeAutonomicPulse" || admitted.version !== 1 || pulseContentAddress(body) !== id) {
    throw new TypeError("pulse must be an intact content-addressed GlassSpongeAutonomicPulse");
  }
  workflow(admitted.workflow);
  conditions(admitted.completionConditions, "pulse.completionConditions");
  return admitted;
}

function coordinate(value, label) {
  const input = object(value, label);
  if (!Number.isSafeInteger(input.blockNumber) || input.blockNumber < 0) throw new TypeError(`${label}.blockNumber must be nonnegative`);
  if (!Number.isSafeInteger(input.logIndex) || input.logIndex < 0) throw new TypeError(`${label}.logIndex must be nonnegative`);
  return deepFreeze({
    blockNumber: input.blockNumber,
    blockHash: bytes32(input.blockHash, `${label}.blockHash`),
    transactionHash: bytes32(input.transactionHash, `${label}.transactionHash`),
    logIndex: input.logIndex,
  });
}

function sameWorkflow(left, right) {
  return left?.chain === right.chain
    && left?.semioticExchange?.toLowerCase() === right.semioticExchange
    && left?.demand?.toLowerCase() === right.demand
    && left?.glassPoreRegistry?.toLowerCase() === right.glassPoreRegistry
    && left?.pore?.toLowerCase() === right.pore;
}

function finalizedWitness(value, admitted) {
  const receipt = object(value, "chain transition receipt");
  if (receipt.type !== "FinalizedChainIndexReceipt") throw new TypeError("chain transition receipt has the wrong type");
  immutableReference(receipt.id, "chain transition receipt.id");
  if (receipt.chain !== GLASS_SPONGE_CHAIN) throw new TypeError("chain transition receipt has the wrong chain");
  if (receipt.subject !== admitted.id) throw new TypeError("chain transition receipt has the wrong pulse subject");
  if (!sameWorkflow(receipt.workflow, admitted.workflow)) throw new TypeError("chain transition receipt has forged workflow coordinates");
  const observed = coordinate(receipt.coordinate, "chain transition receipt.coordinate");
  if (receipt.finality?.status !== "finalized" || !Number.isSafeInteger(receipt.finality.observedAtBlock)
    || receipt.finality.observedAtBlock < observed.blockNumber || receipt.finality.positiveEvidence !== true
    || receipt.finality.negativeEvidence === true) {
    throw new TypeError("chain transition receipt lacks independently positive finality");
  }
  return deepFreeze({ ...clone(receipt), coordinate: observed });
}

function result(admitted, nextAction, fields = {}) {
  return deepFreeze({
    type: "GlassSpongeAutonomicPulseResult",
    version: 1,
    pulse: admitted.id,
    workflow: admitted.workflow,
    nextAction,
    replay: false,
    chainWitness: null,
    attemptPlan: null,
    attempts: [],
    receipt: null,
    successor: null,
    reasons: [],
    ...fields,
  });
}

function providerReceipt(value, entry, admitted) {
  const receipt = object(value, "provider receipt");
  if (!["ProviderDeliveryReceipt", "ProviderRefusalReceipt"].includes(receipt.type)) {
    throw new TypeError("provider receipt must be a delivery or refusal receipt");
  }
  immutableReference(receipt.id, "provider receipt.id");
  if (receipt.pulse !== admitted.id || receipt.offerId !== entry.offerId || receipt.provider !== entry.provider
    || receipt.executionClass !== entry.executionClass) throw new TypeError("provider receipt provenance does not match the ordered attempt");
  const endpoint = text(receipt.endpoint, "provider receipt.endpoint");
  const resources = exactResources(receipt.resources, "provider receipt.resources");
  const latency = receipt.latency === undefined ? null : deepFreeze({
    unit: text(receipt.latency?.unit, "provider receipt.latency.unit"),
    amount: exactAmount(receipt.latency?.amount, "provider receipt.latency.amount"),
  });
  if (receipt.type === "ProviderRefusalReceipt") {
    return deepFreeze({ ...clone(receipt), endpoint, resources, latency, reason: text(receipt.reason, "provider receipt.reason") });
  }
  immutableReference(receipt.result, "provider receipt.result");
  if (resources.length === 0) throw new TypeError("provider delivery must include exact resource observations");
  return deepFreeze({ ...clone(receipt), endpoint, resources, latency });
}

function assayBundle(value, delivery, admitted) {
  const bundle = object(value, "assay bundle");
  const assay = object(bundle.assayReceipt, "assayReceipt");
  if (assay.type !== "AssayReceipt") throw new TypeError("assayReceipt has the wrong type");
  immutableReference(assay.id, "assayReceipt.id");
  if (assay.deliveryReceipt !== delivery.id) throw new TypeError("assayReceipt does not assay this delivery");
  text(assay.assayer, "assayReceipt.assayer");
  immutableReference(assay.evidence, "assayReceipt.evidence");
  if (!Array.isArray(assay.completionConditions) || assay.completionConditions.length !== admitted.completionConditions.length) {
    throw new TypeError("assayReceipt must settle exactly the pulse completion conditions");
  }
  const seen = new Set();
  const settled = assay.completionConditions.map((entry, index) => {
    object(entry, `assayReceipt.completionConditions[${index}]`);
    const condition = text(entry.condition, `assayReceipt.completionConditions[${index}].condition`);
    if (!admitted.completionConditions.includes(condition) || seen.has(condition)) throw new TypeError("assayReceipt has a foreign or repeated condition");
    if (typeof entry.satisfied !== "boolean") throw new TypeError("assayReceipt condition satisfaction must be boolean");
    immutableReference(entry.evidence, `assayReceipt.completionConditions[${index}].evidence`);
    seen.add(condition);
    return clone(entry);
  });
  for (const condition of admitted.completionConditions) if (!seen.has(condition)) throw new TypeError("assayReceipt omitted a completion condition");

  const customerOutcome = object(bundle.customerOutcomeReceipt, "customerOutcomeReceipt");
  if (customerOutcome.type !== "CustomerOutcomeReceipt") throw new TypeError("customerOutcomeReceipt has the wrong type");
  immutableReference(customerOutcome.id, "customerOutcomeReceipt.id");
  if (customerOutcome.deliveryReceipt !== delivery.id || customerOutcome.assayReceipt !== assay.id) {
    throw new TypeError("customerOutcomeReceipt does not join the delivery and assay");
  }
  text(customerOutcome.customer, "customerOutcomeReceipt.customer");
  if (!["accepted", "rejected"].includes(customerOutcome.disposition)) throw new TypeError("customer outcome must be accepted or rejected");

  let completion = null;
  if (bundle.completionReceipt !== null && bundle.completionReceipt !== undefined) {
    completion = object(bundle.completionReceipt, "completionReceipt");
    if (completion.type !== "CompletionReceipt") throw new TypeError("completionReceipt has the wrong type");
    immutableReference(completion.id, "completionReceipt.id");
    if (completion.deliveryReceipt !== delivery.id || completion.customerOutcomeReceipt !== customerOutcome.id
      || completion.customer !== customerOutcome.customer) throw new TypeError("completionReceipt does not join the accepted customer outcome");
    if (customerOutcome.disposition !== "accepted" || settled.some((entry) => entry.satisfied !== true)) {
      throw new TypeError("completionReceipt cannot exist before acceptance and condition satisfaction");
    }
  }

  return deepFreeze({
    assayReceipt: { ...clone(assay), completionConditions: settled },
    customerOutcomeReceipt: clone(customerOutcome),
    completionReceipt: completion ? clone(completion) : null,
    considerationEvidence: bundle.considerationEvidence === undefined ? null : clone(bundle.considerationEvidence),
    paymentReceipt: bundle.paymentReceipt === undefined ? null : clone(bundle.paymentReceipt),
    settlementReceipt: bundle.settlementReceipt === undefined ? null : clone(bundle.settlementReceipt),
  });
}

function candidate(admitted, chainWitness, delivery, bundle, attempts) {
  const body = deepFreeze({
    type: "AutonomicPulseOutcomeCandidate",
    version: 1,
    pulse: admitted.id,
    workflow: admitted.workflow,
    coordinate: chainWitness.coordinate,
    delivery,
    assay: bundle.assayReceipt,
    customerOutcome: bundle.customerOutcomeReceipt,
    completion: bundle.completionReceipt,
    considerationEvidence: bundle.considerationEvidence,
    payment: bundle.paymentReceipt,
    settlement: bundle.settlementReceipt,
    attempts,
    authority: "candidate-only; does not impersonate a provider, assayer, customer, payment rail, settlement, or chain indexer",
  });
  return deepFreeze({ id: pulseContentAddress(body), ...body });
}

function outcomeIndexReceipt(value, admitted, expectedCandidate = null) {
  const receipt = object(value, "outcome index receipt");
  if (receipt.type !== "FinalizedAutonomicPulseOutcomeReceipt") throw new TypeError("outcome index receipt has the wrong type");
  immutableReference(receipt.id, "outcome index receipt.id");
  if (receipt.chain !== GLASS_SPONGE_CHAIN || receipt.pulse !== admitted.id || !sameWorkflow(receipt.workflow, admitted.workflow)) {
    throw new TypeError("outcome index receipt has forged workflow coordinates");
  }
  const indexedCandidate = object(receipt.candidate, "outcome index receipt.candidate");
  const { id, ...body } = indexedCandidate;
  if (indexedCandidate.type !== "AutonomicPulseOutcomeCandidate" || pulseContentAddress(body) !== id) {
    throw new TypeError("outcome index receipt candidate is not content-addressed");
  }
  if (expectedCandidate && indexedCandidate.id !== expectedCandidate.id) throw new TypeError("outcome index receipt records a different candidate");
  const indexedCoordinate = coordinate(receipt.coordinate, "outcome index receipt.coordinate");
  if (receipt.finality?.status !== "finalized" || receipt.finality?.positiveEvidence !== true
    || receipt.finality?.negativeEvidence === true || !Number.isSafeInteger(receipt.finality?.observedAtBlock)
    || receipt.finality.observedAtBlock < indexedCoordinate.blockNumber) throw new TypeError("outcome index receipt is not finalized");
  return deepFreeze({ ...clone(receipt), coordinate: indexedCoordinate });
}

function settle(admitted, chainWitness, indexed, { replay, attempts = [] }) {
  const outcome = indexed.candidate;
  const unsatisfied = outcome.assay.completionConditions.filter((entry) => entry.satisfied !== true).map((entry) => entry.condition);
  const accepted = outcome.customerOutcome.disposition === "accepted";
  if (accepted && unsatisfied.length === 0 && outcome.completion !== null) {
    return result(admitted, "completed", { replay, chainWitness, attempts, receipt: indexed });
  }
  if (unsatisfied.length === 0) {
    return result(admitted, "obstructed", {
      replay, chainWitness, attempts, receipt: indexed,
      reasons: [accepted ? "completion-receipt-not-finalized" : "customer-outcome-rejected-without-unsatisfied-condition"],
    });
  }
  const successor = admitAutonomicPulse({
    origin: {
      kind: "unsatisfied-prior-outcome",
      predecessorPulse: admitted.id,
      outcomeReceipt: indexed.id,
      unsatisfiedConditions: unsatisfied,
    },
    workflow: admitted.workflow,
    demand: admitted.demand,
  });
  return result(admitted, "next-pulse-proposed", { replay, chainWitness, attempts, receipt: indexed, successor });
}

async function call(adapter, input) {
  try {
    return { ok: true, value: await adapter(input) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Advance one pulse. All effects are injected. The function reads no clock,
 * filesystem, network, provider, or local queue. Restart uses only supplied
 * finalized index receipts and therefore re-derives the same successor NI.
 */
export async function advanceAutonomicPulse({ pulse: pulseValue, offers = [], indexedReceipts = [], adapters = {} } = {}) {
  const admitted = pulse(pulseValue);
  if (!Array.isArray(offers)) throw new TypeError("offers must be an array");
  if (!Array.isArray(indexedReceipts)) throw new TypeError("indexedReceipts must be an array");
  if (typeof adapters.transitionChain !== "function") throw new TypeError("adapters.transitionChain must be an injected function");

  const transition = await call(adapters.transitionChain, deepFreeze({ pulse: admitted.id, workflow: admitted.workflow }));
  if (!transition.ok) return result(admitted, "obstructed", { reasons: [`chain-transition-adapter-failed:${transition.reason}`] });
  let chainWitness;
  try {
    chainWitness = finalizedWitness(transition.value, admitted);
  } catch (error) {
    return result(admitted, "refused", { reasons: [error instanceof Error ? error.message : String(error)] });
  }

  const priorValues = [];
  for (const value of indexedReceipts) {
    if (value?.type !== "FinalizedAutonomicPulseOutcomeReceipt" || value?.pulse !== admitted.id) continue;
    try { priorValues.push(outcomeIndexReceipt(value, admitted)); } catch (error) {
      return result(admitted, "refused", { chainWitness, reasons: [error instanceof Error ? error.message : String(error)] });
    }
  }
  if (priorValues.length > 1 && new Set(priorValues.map((entry) => entry.id)).size > 1) {
    return result(admitted, "refused", { chainWitness, reasons: ["multiple-finalized-outcomes-for-one-pulse"] });
  }
  if (priorValues.length > 0) return settle(admitted, chainWitness, priorValues[0], { replay: true });

  const routeObservations = indexedReceipts
    .filter((value) => value?.type === "FinalizedRouteObservation" && value.chain === GLASS_SPONGE_CHAIN && value.finality?.status === "finalized")
    .map((value) => value.receipt);
  const route = decideWorkPlacement({ demand: admitted.demand, offers, observations: routeObservations });
  if (route.disposition === "refused") {
    return result(admitted, "refused", { chainWitness, attemptPlan: route.attemptPlan, reasons: [...route.rationale] });
  }
  if (route.disposition === "choice-required") {
    return result(admitted, "choice-required", { chainWitness, attemptPlan: route.attemptPlan, reasons: [...route.rationale] });
  }
  if (route.selected.mode === "reuse-exact-accepted-result") {
    return result(admitted, "obstructed", {
      chainWitness, attemptPlan: route.attemptPlan,
      reasons: ["exact-result-reuse-requires-a-finalized-autonomic-outcome-receipt"],
    });
  }
  if (typeof adapters.dispatchProvider !== "function" || typeof adapters.assayDelivery !== "function"
    || typeof adapters.recordReceipt !== "function") {
    return result(admitted, "obstructed", { chainWitness, attemptPlan: route.attemptPlan, reasons: ["effect-adapters-missing"] });
  }

  const offersById = new Map(offers.map((offer) => [offer?.id, offer]));
  const attempts = [];
  let delivered = null;
  for (const layer of route.attemptPlan) {
    if (layer.relation === "incomparable") {
      return result(admitted, "choice-required", {
        chainWitness, attemptPlan: route.attemptPlan, attempts,
        reasons: ["ordered-attempt-plan-reached-incomparable-layer"],
      });
    }
    for (const entry of layer.offers) {
      const dispatched = await call(adapters.dispatchProvider, deepFreeze({
        pulse: admitted.id,
        workflow: admitted.workflow,
        demand: admitted.demand,
        offer: offersById.get(entry.offerId),
        orderedAttempt: entry,
        priorRefusals: attempts.map(({ receipt }) => receipt.id),
      }));
      if (!dispatched.ok) {
        return result(admitted, "obstructed", {
          chainWitness, attemptPlan: route.attemptPlan, attempts,
          reasons: [`provider-dispatch-adapter-failed:${dispatched.reason}`],
        });
      }
      let receipt;
      try { receipt = providerReceipt(dispatched.value, entry, admitted); } catch (error) {
        return result(admitted, "obstructed", {
          chainWitness, attemptPlan: route.attemptPlan, attempts,
          reasons: [error instanceof Error ? error.message : String(error)],
        });
      }
      attempts.push(deepFreeze({ offerId: entry.offerId, provider: entry.provider, executionClass: entry.executionClass, receipt }));
      if (receipt.type === "ProviderDeliveryReceipt") { delivered = receipt; break; }
    }
    if (delivered) break;
  }
  if (!delivered) {
    return result(admitted, "obstructed", {
      chainWitness, attemptPlan: route.attemptPlan, attempts,
      reasons: ["explicit-ordered-attempt-plan-exhausted-by-provider-refusals"],
    });
  }

  const assayed = await call(adapters.assayDelivery, deepFreeze({
    pulse: admitted.id,
    workflow: admitted.workflow,
    demand: admitted.demand,
    deliveryReceipt: delivered,
    completionConditions: admitted.completionConditions,
  }));
  if (!assayed.ok) return result(admitted, "obstructed", {
    chainWitness, attemptPlan: route.attemptPlan, attempts,
    reasons: [`assay-adapter-failed:${assayed.reason}`],
  });
  let bundle;
  try { bundle = assayBundle(assayed.value, delivered, admitted); } catch (error) {
    return result(admitted, "obstructed", {
      chainWitness, attemptPlan: route.attemptPlan, attempts,
      reasons: [error instanceof Error ? error.message : String(error)],
    });
  }

  const proposed = candidate(admitted, chainWitness, delivered, bundle, attempts);
  const recorded = await call(adapters.recordReceipt, deepFreeze({ candidate: proposed, chainWitness }));
  if (!recorded.ok) return result(admitted, "obstructed", {
    chainWitness, attemptPlan: route.attemptPlan, attempts,
    reasons: [`receipt-adapter-failed:${recorded.reason}`],
  });
  let indexed;
  try { indexed = outcomeIndexReceipt(recorded.value, admitted, proposed); } catch (error) {
    return result(admitted, "obstructed", {
      chainWitness, attemptPlan: route.attemptPlan, attempts,
      reasons: [error instanceof Error ? error.message : String(error)],
    });
  }
  return settle(admitted, chainWitness, indexed, { replay: false, attempts });
}
