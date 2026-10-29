import { idOf } from "./semantic-content.mjs";
// codex-inference-market (inference-work-lot-service) is gone; inference-dispatch-service
// is its live successor, and dispatchInference is its contractInferenceWork: an (input,
// options) market dispatch that a caller can always override via options.contractInferenceWork
// (this package's own tests always do, so this default is only exercised in production).
import { dispatchInference as defaultContractInferenceWork } from "@red-cup-engineering/inference-dispatch-service/inference-dispatch";

export const CONTEXT = "https://www.w3.org/ns/activitystreams";
export const ACTOR = "urn:ame:red-cup-engineering:improvement-game-design-supplier";

export function record(body) { return Object.freeze({ id: idOf(body, "improvement-game-design-supplier.record"), ...body }); }
function refusal(award, bid, code, reason, resources = { inferenceAttempts: 0, usefulCompletions: 0 }) {
  return record({ "@context": CONTEXT, type: "Reject", actor: ACTOR, target: award.actor, inReplyTo: award.id, object: { type: "ImprovementGameDesignRefusal", lot: award.object.lot, award: award.id, bid: bid.id, code, reason, resources, customerMutation: false, implementationAuthorized: false, oracleAuthorshipAuthorized: false, strongerModelRequested: false } });
}

export function bidForGameOffer(activity, policy) {
  const lot = activity?.object, quote = activity?.attachment?.find((item) => item?.type === "ImprovementGameBuyerQuote"), terms = lot?.gameTerms;
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Offer" || lot?.type !== "ImprovementGameDesignWorkLot" || quote?.lot !== lot.id) return null;
  if (quote.consideration?.unit !== policy.minimumAsk.unit || quote.consideration.amount < policy.minimumAsk.amount) return null;
  if (!Array.isArray(terms?.requiredCapabilities) || terms.requiredCapabilities.some((capability) => !policy.capabilities.includes(capability))) return null;
  if (terms.customerMutationAuthorized !== false || terms.implementationAuthorized !== false || terms.oracleAuthorshipAuthorized !== false || terms.upwardEscalationAuthorized !== false) return null;
  return record({ "@context": CONTEXT, type: "Offer", actor: ACTOR, target: lot.consumer, inReplyTo: quote.id, object: { type: "ImprovementGameDesignBid", provider: ACTOR, lot: lot.id, quote: quote.id, consideration: policy.minimumAsk, capabilities: policy.capabilities, maximumConcurrentLots: policy.maximumConcurrentLots, estimatedInferenceCalls: 1, deliveryMode: "game-proposal-only", customerMutation: false, implementationAuthorized: false, oracleAuthorshipAuthorized: false, upwardEscalationAuthorized: false, lotSnapshot: lot, executionPolicy: { firstRoute: "deterministic-protected-oracle-envelope-compiler", fallback: "bounded-cheap-inference", refinement: "downward-only" } } });
}

function compileEnvelope(lot) {
  const envelope = lot.sourceObservation?.context?.protectedOracleEnvelope;
  if (!envelope || envelope.type !== "ProtectedOracleImprovementGameEnvelope" || envelope.customer !== lot.consumer || envelope.territory !== lot.gameTerms.territory) return null;
  const required = ["requestedChanges", "ownedTargetRoots", "forbiddenRoots", "sourceDigests", "acceptanceArtifacts", "acceptanceCommands", "economy", "resourceCeilings", "productContract", "requiredCapabilities", "taskClass"];
  if (required.some((field) => envelope[field] === undefined)) return null;
  const sourceDigests = [...new Set([...envelope.sourceDigests, ...lot.sourceObservation.sourceDigests])];
  return record({ type: "ImprovementResidue", customer: lot.consumer, territory: envelope.territory, requestedChanges: envelope.requestedChanges, ownedTargetRoots: envelope.ownedTargetRoots, forbiddenRoots: envelope.forbiddenRoots, sourceDigests, acceptanceArtifacts: envelope.acceptanceArtifacts, acceptanceCommands: envelope.acceptanceCommands, economy: envelope.economy, resourceCeilings: envelope.resourceCeilings, productContract: envelope.productContract, requiredCapabilities: envelope.requiredCapabilities, taskClass: envelope.taskClass });
}

export async function fulfillGameAward(award, bid = award?.object?.bidSnapshot, options = {}) {
  const policy = options.policy, lot = bid?.object?.lotSnapshot;
  if (award?.["@context"] !== CONTEXT || award.type !== "Accept" || award.target !== ACTOR || award.object?.type !== "ImprovementGameDesignAward" || award.object.bid !== bid?.id || lot?.id !== award.object.lot) return null;
  if (award.object.customerMutationAuthorized !== false || award.object.implementationAuthorized !== false || award.object.oracleAuthorshipAuthorized !== false || lot.gameTerms?.upwardEscalationAuthorized !== false) return refusal(award, bid, "authority-expansion", "award expanded the proposal-only game-design boundary");
  const residue = compileEnvelope(lot);
  if (!residue) return refusal(award, bid, "insufficient-evidence", "finite opportunity packet exposed no compilable customer-controlled protected-oracle envelope");
  const proposal = record({ type: "ImprovementGameProposal", lot: lot.id, award: award.id, supplier: ACTOR, verdict: "propose-game", proposedResidue: residue, resources: { route: "deterministic-envelope-compiler", inferenceAttempts: 0, usefulCompletions: 1 }, customerMutation: false, recordedAt: options.recordedAt ?? new Date().toISOString() });
  if (options.reviewProposal) {
    try {
      const review = await options.reviewProposal({ type: "ImprovementGameProposalAssayRequest", lot, proposal });
      if (review?.type !== "ImprovementGameReview" || review.proposal !== proposal.id || typeof review.actor !== "string" || !review.evidence) return refusal(award, bid, "deterministic-review-boundary", "deterministic assay returned no proposal-bound behavioral evidence");
      if (review.accepted === true) return record({ "@context": CONTEXT, type: "Create", actor: ACTOR, target: lot.consumer, inReplyTo: award.id, object: proposal, attachment: [review] });
      return refusal(award, bid, "deterministic-review-rejected", review.reason ?? "deterministic behavioral assay rejected the proposed game", { inferenceAttempts: 0, usefulCompletions: 1 });
    } catch {
      // A missing assay carrier leaves a bounded review residue and permits the
      // already-priced cheap review market; it never authorizes a larger model.
    }
  }
  const contractInferenceWork = options.contractInferenceWork ?? defaultContractInferenceWork;
  let examined;
  try {
    examined = await contractInferenceWork({
      workType: "code-review", customer: ACTOR,
      objective: "Analyze whether the supplied ImprovementGameProposal is exact, non-vacuous, source-bound, economically conservative, and places every acceptance and baseline artifact outside supplier-writable roots. Explain concrete defects and evidence in natural text.",
      desiredUse: "Supply advisory analysis for a customer-owned behavioral assay; authorship is provenance, not proof.",
      context: JSON.stringify({ lot, proposal }),
      requiredCapabilities: ["software-engineering"], considerationPolicy: policy.reviewConsiderationPolicy,
      difficulty: 0.35,
    });
  } catch (error) { return refusal(award, bid, "review-market-residue", error.message, { inferenceAttempts: 1, usefulCompletions: 0 }); }
  const reviewer = examined?.provider;
  if (examined?.outcome !== "candidate-pending-customer-acceptance" || typeof examined.candidate !== "string" || examined.candidate.length === 0 || typeof reviewer !== "string") return refusal(award, bid, "review-market-residue", "no admissible evidence-bearing advisory analysis", { inferenceAttempts: 1, usefulCompletions: examined?.candidate ? 1 : 0 });
  const review = record({ type: "ImprovementGameReview", actor: reviewer, proposal: proposal.id, accepted: null, reason: examined.candidate, evidence: examined.evidence ?? { state: "unknown-not-zero" }, customerMutation: false, customerBehavioralAssayRequired: true });
  return record({ "@context": CONTEXT, type: "Create", actor: ACTOR, target: lot.consumer, inReplyTo: award.id, object: proposal, attachment: [review] });
}
