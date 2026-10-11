import { randomUUID } from "node:crypto";
import { a2aResultMetadata, a2aResultParts } from "@red-cup-engineering/a2a-services-section/a2a-client";
import { senPart, sendSenTask } from "@red-cup-engineering/a2a-services-section/sen-part";
import { conformTerm, conformTermBytes } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/conformance";
import { circuitInterfaceFromAgentCard, SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION } from "@red-cup-engineering/a2a-services-section/circuit-interface";
import { assayWitTransition, witTransitionAgentUrl } from "@red-cup-engineering/computer-inference-engine/fabric/effect-assay";
import { effectBundle, effectBundleType } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import { decodeSemantic } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { ACTIVITYSTREAMS_CONTEXT } from "@red-cup-engineering/activitypub-services-section/activitystreams";

/**
 * meterInference: the typed operation `POST /v1/inference` sells, folded
 * out of the tollbooth's former x402 transport (2026-09-11 founder ruling:
 * one x402 market, market.561.group; no per-compute seller keeps its own
 * transport, facilitator selection, or settlement witness).
 *
 * This module performs conformance, wit-transition assay, and A2A dispatch
 * through the caller-named provider Agent Card only. It never verifies or
 * settles payment, selects a facilitator, or writes a settlement witness
 * journal entry -- market.561.group does all three, uniformly, for every
 * offer in its catalog.
 */

const ACTOR = "urn:ame:metered-inference-tollbooth";
// This settlement's own CAIP-10 account identity on Base mainnet
// (content/evm/accounts/eip155-8453.json's account.caip10), fixed at
// enterprise-account creation. Never read from the request or env: the
// tollbooth is always this one account, regardless of who settles payment.
const ACCOUNT = "eip155:8453:0xe8df91d8cc83c2e1792c6a7b0b8a532365bc2b46";
const INFERENCE_MARKET_OFFER_EXTENSION = "ni:///sha-256;hLCUM4R4uZnPEVaY9Cb6sDwruIVBtw2bjleYGbeATaQ";
const BASE = ["base"];
export const PROVIDER_OPERATION_TYPE = ["prod", BASE, ["prod", BASE, ["prod", BASE, BASE]]];
/** The operation a metered proposal carries is itself the provider's effect bundle. */
export const providerBundleType = (operation) => effectBundleType(operation, PROVIDER_OPERATION_TYPE);
/** The type of a metered bundle: its cell's type times its provider bundle's type. */
export const meteredBundleType = (bundle) => effectBundleType(bundle, providerBundleType(bundle[2]));


function document(value, name) {
  if (value?.type !== "Document" || value.mediaType !== "application/sen+cbor" || typeof value.id !== "string" || typeof value.content !== "string") {
    throw new TypeError(`${name} must be an ActivityStreams Document carrying application/sen+cbor bytes`);
  }
  return value;
}

function conformBundle(value) {
  const doc = document(value, "proposal");
  const bytes = Buffer.from(doc.content, "base64");
  return conformTermBytes({ bytes, expectedType: meteredBundleType(decodeSemantic(bytes)), expectedNi: doc.id });
}

function response(type, source, object) {
  return { "@context": ACTIVITYSTREAMS_CONTEXT, id: `urn:uuid:${randomUUID()}`, type, actor: ACTOR, target: source.actor, inReplyTo: source.id, object };
}

function sameField(proposal, completion, field) {
  if (proposal[field] !== completion[field]) throw new TypeError(`completion changed ${field}`);
}

/**
 * Refuse a malformed metered-inference request body before the market prices
 * it. The market's `validate` binding calls this ahead of any x402 challenge.
 * @param {object} body The candidate request body.
 * @returns {object} The same body, admitted.
 * @throws {TypeError} When the body is not an ActivityStreams
 *   `Accept<ServiceContract>` addressed to this tollbooth, naming a
 *   provider Agent Card and carrying a canonical SEN proposal document.
 */
export function validateMeteredInferenceRequest(body) {
  if (body?.["@context"] !== ACTIVITYSTREAMS_CONTEXT || body?.type !== "Accept" || body?.target !== ACTOR || body?.object?.type !== "ServiceContract") {
    throw new TypeError("metered inference requires an ActivityStreams Accept<ServiceContract> addressed to the tollbooth");
  }
  if (typeof body.object.providerAgentCard !== "string" || !/^https?:\/\//u.test(body.object.providerAgentCard)) {
    throw new TypeError("service contract must name the selected provider's signed A2A Agent Card");
  }
  document(body.object.proposal, "proposal");
  return body;
}

const resultParts = a2aResultParts;

/**
 * Meter one SEN inference contract, after the market has already priced and
 * settled payment for it: conform the caller's proposal, dispatch exactly
 * one A2A task to the caller-named provider, assay the resulting
 * transition, and conform the completion -- returning the ActivityStreams
 * `Accept`/`Reject` response body the market answers with. A contract-level
 * failure (a refused provider task, a conformance mismatch) is reported as a
 * `Reject` object, not thrown, because payment has already settled by the
 * time this runs.
 *
 * @param {object} body A metered-inference request body (see
 *   `validateMeteredInferenceRequest`).
 * @param {{WIT_TRANSITION_ASSAY_AGENT: string}} env
 *   The deployment's hired wit-transition Agent Card URL.
 * @returns {Promise<object>} The ActivityStreams response body.
 */
export async function meterInference(body, env = {}) {
  const source = validateMeteredInferenceRequest(body);
  try {
    const witUrl = witTransitionAgentUrl(env);
    const proposal = conformBundle(source.object.proposal);
    const cell = proposal.effectCell;
    if (cell.provider !== ACCOUNT) throw new TypeError("proposal is not addressed to the tollbooth account and service scale");
    if (source.object.callerAccount !== cell.caller) throw new TypeError("ActivityStreams callerAccount does not match the SEN caller");
    if (cell.outcome?.positiveEvidence !== false || cell.outcome?.negativeEvidence !== false) throw new TypeError("proposal must enter at FOUR-bottom");
    const operation = proposal.normalForm[2];
    const providerProposal = conformTerm({ term: operation, expectedType: providerBundleType(operation) });
    const providerCell = providerProposal.effectCell;
    if (!providerCell || providerCell.caller !== ACCOUNT) throw new TypeError("embedded provider effect must name the tollbooth smart account as caller");
    const exchange = await sendSenTask({
      agentUrl: source.object.providerAgentCard,
      requireSignature: true,
      message: {
        messageId: randomUUID(),
        role: "ROLE_USER",
        parts: [senPart(Buffer.from(providerProposal.canonicalBytesBase64, "base64"), "proposal.sen.cbor")],
        metadata: { parentNi: proposal.term },
        extensions: [SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, INFERENCE_MARKET_OFFER_EXTENSION],
      },
    });
    const providerInterface = circuitInterfaceFromAgentCard(exchange.agentCard);
    if (providerInterface.account !== providerCell.provider) throw new TypeError("selected provider Agent Card does not inhabit the embedded SEN effect");
    const providerSettlement = {
      protocol: "A2A",
      protocolVersion: "1.0",
      provider: providerInterface.account,
      law: providerInterface.component.law,
      proposal: exchange.inputNi,
      completion: exchange.outputNi,
      disposition: a2aResultMetadata(exchange.result).disposition ?? "refused",
      candidate: resultParts(exchange.result).find((part) => part?.content?.$case === "text")?.content?.value ?? "",
    };
    const accepted = providerSettlement.disposition === "completion";
    const completionCell = {
      ...cell,
      evidenceRoot: providerSettlement.completion,
      outcome: { positiveEvidence: accepted, negativeEvidence: !accepted },
      measures: [...cell.measures.filter(({ dimension }) => dimension !== "provider-settlement-attempt"), { dimension: "provider-settlement-attempt", quantity: "1", unit: "direct-a2a-contract" }],
    };
    for (const field of ["caller", "parent", "provider"]) sameField(cell, completionCell, field);
    const transition = await assayWitTransition({ agentUrl: witUrl, proposalCell: cell, completionCell, evidence: providerSettlement.completion });
    const completionTerm = effectBundle(completionCell, operation);
    const completion = conformTerm({ term: completionTerm, expectedType: meteredBundleType(completionTerm) });
    return response(accepted ? "Accept" : "Reject", source, {
      type: "SenMeteredInferenceSettlement",
      disposition: accepted ? "completion" : "refused",
      proposal: proposal.term,
      completion: completion.term,
      witness: transition.witness,
      inference: providerSettlement,
      attachment: [{ type: "Document", id: completion.term, mediaType: "application/sen+cbor", content: completion.canonicalBytesBase64 }],
    });
  } catch (error) {
    return response("Reject", source, { type: "Refusal", reason: "contract-refused", message: error instanceof Error ? error.message : String(error) });
  }
}

export { ACCOUNT, ACTOR };
