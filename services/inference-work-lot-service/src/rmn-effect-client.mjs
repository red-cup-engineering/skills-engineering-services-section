import { createHash } from "node:crypto";
import { conformTerm as requestConformance } from "./rmn-conformance-client.mjs";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";

export function textNi(value) {
  return identifyJsonSemanticContent({ objectKind: "inference-work-lot.effect-coordinate", value, witnessRoot: EMPTY_WITNESS_ROOT }).token;
}

function agentUrl() {
  if (!process.env.RMN_CONFORMANCE_AGENT) throw new Error("RMN_CONFORMANCE_AGENT must name the hired RMN provider's A2A 1.0 Agent Card");
  return process.env.RMN_CONFORMANCE_AGENT;
}
function witAgentUrl() { if (!process.env.WIT_TRANSITION_ASSAY_AGENT) throw new Error("WIT_TRANSITION_ASSAY_AGENT must name the hired WIT transition provider's signed A2A 1.0 Agent Card"); return process.env.WIT_TRANSITION_ASSAY_AGENT; }

export async function conformTerm(_actor, term, expectedType, _now) {
  const result = await requestConformance({ agentUrl: agentUrl(), term, expectedType });
  return Object.freeze({ term: result.term, canonicalBytesBase64: result.canonicalBytesBase64, conformance: result.exchange.outputNi });
}

export async function proposeEffect(actor, cell, now) {
  const response = await conformTerm(actor, ["mark", JSON.stringify(cell)], ["base"], now);
  return { cell, semanticId: response.term, evidence: cell.evidenceRoot, conformance: response.conformance };
}

export async function completeEffect(_actor, proposalCell, completionCell, evidence, _now) {
  const { assayWitTransition } = await import("@lenticule-science/wit-transition-assay/client");
  const response = await assayWitTransition({ agentUrl: witAgentUrl(), proposalCell, completionCell, evidence });
  return { proposal: response.proposal, completion: response.completion, witness: response.witness, outcome: response.outcome, conformance: response.exchange.outputNi };
}
