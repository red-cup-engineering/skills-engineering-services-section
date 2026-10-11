#!/usr/bin/env node
// Effect assays for the inference fabric: proposing an effect cell under local
// SEN conformance, and the WIT transition assay — the client that
// hires a WIT provider, the provider's judgment (one FOUR knowledge cover
// between two cells of one effect, completed with the named evidence), and a
// served provider. A WIT is never computed locally for one's own effect: the
// transition needs a distinct provider's typed receipt.
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  admitJsonSemanticContent,
  EMPTY_WITNESS_ROOT,
  identifyJsonSemanticContent,
} from "@red-cup-engineering/computer-content-engineering-services-section/semantic-content-identity";
import {
  effectTerm,
} from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import {
  inferTerm,
} from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/typing";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { conformTerm } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/conformance";
import { a2aResultParts, ROLE_AGENT, ROLE_USER } from "@red-cup-engineering/a2a-services-section/a2a-client";
import { createA2aServer } from "@red-cup-engineering/a2a-services-section/a2a-server";
import { ephemeralAgentCardSigning } from "@red-cup-engineering/a2a-services-section/agent-card-signing";
import { extractSenPart, senPart, sendSenTask } from "@red-cup-engineering/a2a-services-section/sen-part";
import { sha256Digest, sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import { witnessBit } from "@red-cup-engineering/computer-data-engineering-services-section/four";

export const artifactChecksum = (bytes) => sha256Digest(bytes);

export function semanticJsonId(objectKind, value) {
  return identifyJsonSemanticContent({ objectKind, value, witnessRoot: EMPTY_WITNESS_ROOT }).token;
}
export function semanticBytesId(objectKind, bytes) {
  return semanticJsonId(objectKind, { mediaType: "application/octet-stream", contentBase64: Buffer.from(bytes).toString("base64") });
}
export function textNi(value, objectKind = "resource-brokerage.effect-coordinate") {
  return semanticJsonId(objectKind, value);
}

/** The hired WIT transition provider's Agent Card URL, named by WIT_TRANSITION_ASSAY_AGENT: a WIT is never assayed by the party whose effect it is. */
export function witTransitionAgentUrl(env = process.env) {
  if (typeof env.WIT_TRANSITION_ASSAY_AGENT !== "string" || env.WIT_TRANSITION_ASSAY_AGENT === "") throw new TypeError("WIT_TRANSITION_ASSAY_AGENT must name the hired WIT transition provider's signed A2A 1.0 Agent Card");
  return env.WIT_TRANSITION_ASSAY_AGENT;
}

/** Propose one effect cell: conform its term locally; the receipt names the ascribed normal form. */
export function proposeEffect(_actor, cell, _now) {
  const term = effectTerm(cell);
  const result = conformTerm({ term, expectedType: inferTerm(term) });
  return { semanticId: result.term, evidence: cell.evidenceRoot, conformance: semanticId(result.response) };
}

export async function completeEffect(_actor, proposalCell, completionCell, evidence, _now) {
  const agentUrl = witTransitionAgentUrl();
  const response = await assayWitTransition({ agentUrl, proposalCell, completionCell, evidence });
  return { proposal: response.proposal, completion: response.completion, witness: response.witness, outcome: response.outcome, conformance: response.exchange.outputNi };
}

// The WIT transition provider speaks addressed semantic JSON records of this
// object kind: the request carries both effect cells and the evidence, the
// receipt binds the exact request and names the provider's CAIP-10 account.
export const WIT_TRANSITION_ASSAY_PROFILE = "org.emsenn.obsmetrology.wit-transition-assay.v2";
const WIT_OBJECT_KIND = "lenticule-science.wit-transition-assay.json";
const CAIP10 = /^eip155:[1-9][0-9]*:0x[0-9a-fA-F]{40}$/u;
const witIdentified = (value) => identifyJsonSemanticContent({ objectKind: WIT_OBJECT_KIND, value, witnessRoot: EMPTY_WITNESS_ROOT });
const witRecord = (value) => Object.freeze({ ...structuredClone(value), id: witIdentified(value).token });
const isWitRecord = (value) => {
  if (value === null || typeof value !== "object" || typeof value.id !== "string") return false;
  const { id, ...body } = value;
  return witIdentified(body).token === id;
};

const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
// Fields one effect keeps across its proposal→completion transition.
const STABLE_CELL_FIELDS = ["caller", "law", "operation", "parent", "postcondition", "precondition", "provider", "refusal"];
function witFail(code, message) { const error = new TypeError(message); error.code = code; throw error; }
function witFour(value, name) {
  if (value === null || typeof value !== "object" || Object.keys(value).sort().join("\0") !== "negativeEvidence\0positiveEvidence" || typeof value.positiveEvidence !== "boolean" || typeof value.negativeEvidence !== "boolean") witFail("malformed-four", `${name} must expose exactly the independent positiveEvidence and negativeEvidence bits`);
  return Object.freeze({ positiveEvidence: value.positiveEvidence, negativeEvidence: value.negativeEvidence });
}
function witCell(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) witFail("malformed-wit-transition", `${name} must be an effect cell`);
  if (!NI.test(value.evidenceRoot ?? "")) witFail("malformed-wit-transition", `${name}.evidenceRoot must be semantic content identity`);
  return Object.freeze({ ...structuredClone(value), outcome: witFour(value.outcome, `${name}.outcome`) });
}

/** The addressed request a WIT transition provider assays. */
export function encodeWitTransitionAssayRequest({ proposalCell, completionCell, evidence }) {
  if (!NI.test(evidence ?? "")) witFail("malformed-wit-transition", "transition evidence must be semantic content identity");
  return witRecord({ type: "WitTransitionAssayRequest", proposalCell: witCell(proposalCell, "proposalCell"), completionCell: witCell(completionCell, "completionCell"), evidence });
}

/** A provider's receipt, admitted only when it is exact current semantic content. */
export function decodeWitTransitionAssayReceipt(value) {
  if (!isWitRecord(value) || value.kind !== "WitTransitionAssayReceipt" || value.profile !== WIT_TRANSITION_ASSAY_PROFILE || !CAIP10.test(value.provider ?? "") || !isWitRecord(value.witnessTerm) || value.witness !== value.witnessTerm.id) {
    witFail("malformed-wit-transition", "WIT transition receipt is not exact current semantic content");
  }
  return Object.freeze(value);
}

/** Hires the WIT transition provider at agentUrl to assay one proposal→completion
 * cover; the receipt must bind this exact request. */
export async function assayWitTransition({ agentUrl: url, proposalCell, completionCell, evidence, signal, send = sendSenTask }) {
  const request = encodeWitTransitionAssayRequest({ proposalCell, completionCell, evidence });
  const message = {
    messageId: randomUUID(), contextId: "", taskId: "", role: ROLE_USER,
    parts: [senPart(witIdentified(request).bytes, "wit-transition-request.sen.cbor")], metadata: { request: request.id }, extensions: [], referenceTaskIds: [],
  };
  const exchange = await send({ agentUrl: url, message, requireSignature: true, ...(signal ? { signal } : {}) });
  const output = extractSenPart(a2aResultParts(exchange.result));
  const receipt = decodeWitTransitionAssayReceipt(admitJsonSemanticContent({ bytes: output.bytes, objectKind: WIT_OBJECT_KIND }).value);
  if (receipt.request !== request.id) throw new Error("WIT transition receipt does not bind the exact request");
  return { ...receipt, receipt, receiptNi: receipt.id, exchange };
}

/** The provider's judgment: one exact 0→1 FOUR cover between two cells of the
 * same effect, completed with the named evidence, receipted by providerAccount. */
export function witnessWitTransition(request, { providerAccount } = {}) {
  if (!CAIP10.test(providerAccount ?? "")) witFail("missing-wit-provider", "WIT transition assay requires the deployed provider's CAIP-10 account");
  if (!isWitRecord(request) || request.type !== "WitTransitionAssayRequest") witFail("malformed-wit-transition", "WIT transition request must be exact addressed semantic JSON");
  const proposal = witCell(request.proposalCell, "proposalCell"), completion = witCell(request.completionCell, "completionCell");
  if (!NI.test(request.evidence ?? "")) witFail("malformed-wit-transition", "transition evidence must be semantic content identity");
  const articulatedAxis = witnessBit(proposal.outcome, completion.outcome);
  for (const field of STABLE_CELL_FIELDS) if (!isDeepStrictEqual(proposal[field], completion[field])) witFail("malformed-effect-transition", `${field} changed across one effect transition`);
  if (completion.evidenceRoot !== request.evidence) witFail("malformed-effect-transition", "completion evidenceRoot must equal the WIT evidence identity");
  const proposalId = witIdentified(proposal).token, completionId = witIdentified(completion).token;
  const witnessTerm = witRecord({ type: "WitTransitionWitness", proposal: proposalId, completion: completionId, evidence: request.evidence, before: proposal.outcome, after: completion.outcome, articulatedAxis });
  return witRecord({ kind: "WitTransitionAssayReceipt", profile: WIT_TRANSITION_ASSAY_PROFILE, provider: providerAccount, request: request.id, proposal: proposalId, completion: completionId, evidence: request.evidence, witness: witnessTerm.id, witnessTerm, outcome: completion.outcome });
}

/** The A2A message/send handler of a WIT transition provider. */
export function witTransitionAssayHandler({ providerAccount }) {
  return (message) => {
    const request = admitJsonSemanticContent({ bytes: extractSenPart(message.parts).bytes, objectKind: WIT_OBJECT_KIND }).value;
    const receipt = witnessWitTransition(request, { providerAccount });
    return {
      messageId: randomUUID(), contextId: message.contextId, taskId: message.taskId, role: ROLE_AGENT,
      parts: [senPart(witIdentified(receipt).bytes, "wit-transition-receipt.sen.cbor")],
      metadata: { disposition: "witnessed-cover", receiptNi: receipt.id, witnessNi: receipt.witness }, extensions: [], referenceTaskIds: [],
    };
  };
}

export const WIT_TRANSITION_AGENT_CARD = Object.freeze({
  name: "WIT Transition Assay",
  description: "Independently verifies one evidence-bound FOUR knowledge-order cover between immutable SEN effect cells.",
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: false, extensions: [], extendedAgentCard: false },
  securitySchemes: {}, securityRequirements: [],
  defaultInputModes: ["application/sen+cbor"], defaultOutputModes: ["application/sen+cbor"],
  skills: [{ id: "assay-wit-transition", name: "Assay one WIT transition", description: "Requires one exact 0-to-1 FOUR cover, active effect identity, and matching evidence root; returns a provider-bound typed WIT receipt.", tags: ["sen", "four", "wit", "obsmetrology"], examples: [], inputModes: ["application/sen+cbor"], outputModes: ["application/sen+cbor"], securityRequirements: [] }],
  signatures: [],
});

/** Serves a WIT transition provider over A2A with a signed Agent Card. Without
 * a signing configuration, an ephemeral Ed25519 key signs the card. */
export function serveWitTransitionAssay({ providerAccount, host = "127.0.0.1", port = 0, signing } = {}) {
  let keys = signing;
  const signer = (baseUrl) => (keys ??= ephemeralAgentCardSigning(baseUrl, "wit-transition-assay"));
  return createA2aServer({
    host, port, handlers: { "message/send": witTransitionAssayHandler({ providerAccount }) },
    agentCard: (baseUrl) => signer(baseUrl).sign({ ...WIT_TRANSITION_AGENT_CARD, supportedInterfaces: [{ url: baseUrl, protocolBinding: "JSONRPC", tenant: "", protocolVersion: "1.0" }] }),
    jwks: (baseUrl) => signer(baseUrl).jwks,
  });
}
