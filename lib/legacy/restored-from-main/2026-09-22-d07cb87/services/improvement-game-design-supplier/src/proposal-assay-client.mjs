// requestImprovementGameProposalAssay, recovered local to this package.
//
// @lenticule-science/improvement-game-proposal-assay was deleted 2026-08-26
// as slop. This package's service.mjs is its only remaining caller, and only
// as the lazy default for options.reviewProposal -- a path this package's own
// tests never exercise (fulfillGameAward's one test that reaches the award
// branch always supplies its own reviewProposal, and operatePulse's test
// only ever walks the Offer/bid branch) -- so recovering it means giving
// this package its own client, not restoring a one-file package.
//
// The original's semantic-json.mjs depended on
// @red-cup-engineering/semantic-content-identify-service, which is gone
// entirely with no replacement anywhere in the house. This version carries
// its A2A operation as plain JSON bytes instead, addressed by the RMN part's
// own content-identity (computer-data-engine's ni identity, via
// a2a-services-section's rmnPart/extractRmnPart) rather than a second,
// service-specific semantic-content identity layer.
import { randomUUID } from "node:crypto";
import { a2aResultParts } from "@red-cup-engineering/a2a-services-section/a2a-client";
import { extractRmnPart, sendRmnTask, userRmnMessage } from "@red-cup-engineering/a2a-services-section/rmn-part";

const ACTOR = "urn:ame:improvement-game-proposal-assay";

function operationBytes(operation) {
  return Buffer.from(JSON.stringify(operation), "utf8");
}

function operationFromBytes(bytes) {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

/**
 * Requests one behavioral review of an ImprovementGameProposal from the
 * proposal-assay agent named by `agentCardUrl`.
 * @param {{type: "ImprovementGameProposalAssayRequest", lot: object, proposal: object}} assayRequest
 * @param {{agentCardUrl?: string, send?: Function, signal?: AbortSignal}} [options]
 * @returns {Promise<{review: object, provider: string, exchange: object}>}
 */
export async function requestImprovementGameProposalAssay(assayRequest, { agentCardUrl = process.env.IMPROVEMENT_GAME_PROPOSAL_ASSAY_AGENT_CARD_URL, send = sendRmnTask, signal } = {}) {
  if (typeof agentCardUrl !== "string" || !agentCardUrl) throw new Error("IMPROVEMENT_GAME_PROPOSAL_ASSAY_AGENT_CARD_URL is required");
  const request = { id: randomUUID(), type: "ImprovementGameProposalAssayOperation", provider: ACTOR, assayRequest };
  const message = userRmnMessage(operationBytes(request));
  const exchange = await send({ agentUrl: agentCardUrl, message, requireSignature: true, signal });
  const response = operationFromBytes(extractRmnPart(a2aResultParts(exchange.result)).bytes);
  if (response?.type !== "ImprovementGameProposalAssayResult" || response.provider !== ACTOR || response.request !== request.id || response.proposal !== assayRequest.proposal?.id) {
    throw new Error("game assay returned a foreign result");
  }
  return Object.freeze({ review: response.review, provider: ACTOR, exchange: { inputNi: exchange.inputNi, outputNi: exchange.outputNi, agentCard: exchange.agentCard } });
}
