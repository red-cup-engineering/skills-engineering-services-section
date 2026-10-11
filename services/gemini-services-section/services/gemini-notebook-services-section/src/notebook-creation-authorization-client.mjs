import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { a2aResultParts, ROLE_USER } from "@red-cup-engineering/a2a-services-section/a2a-client";
import { extractSenPart, senPart, sendSenTask } from "@red-cup-engineering/a2a-services-section/sen-part";
import { termToJson } from "@red-cup-engineering/computer-data-services-section/semiotic-expression-notation/json-codec";
import { admitNormalizedSemanticContent } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import { identifyRelationalValue } from "./semantic-content.mjs";

const POLICY = JSON.parse(readFileSync(new URL("../content/config/notebook-creation-authorizer.json", import.meta.url), "utf8"));
const REQUEST_KIND = "gemini-notebook.notebook-creation-authorization.request";
const RESPONSE_KIND = "gemini-notebook.notebook-creation-authorization.response";
function encode(input) {
  const identity = identifyRelationalValue(REQUEST_KIND, { kind: "org.emsenn.notebook-creation-authorization.request.v1", operation: "verify-notebook-creation-authorization", input });
  return { bytes: Buffer.from(identity.bytes), id: identity.token };
}
function decode(identity) {
  if (identity.envelope.objectKind !== RESPONSE_KIND) throw new TypeError("authorization verification response has the wrong semantic object kind");
  const value = termToJson(identity.envelope.settledBody);
  if (value?.kind !== "org.emsenn.notebook-creation-authorization.response.v1") throw new TypeError("authorization verification response has a foreign kind");
  return value;
}
function verificationExtension(agentCard) { return agentCard?.capabilities?.extensions?.find((row) => row?.uri === POLICY.verificationLaw && row?.params?.profile === POLICY.extensionProfile && row?.params?.actor === POLICY.provider && row?.params?.law === POLICY.verificationLaw); }

export async function verifyNotebookCreationAuthorization(input, options = {}) {
  const agentUrl = options.agentUrl ?? process.env.NOTEBOOK_CREATION_AUTHORIZATION_AGENT;
  if (typeof agentUrl !== "string" || agentUrl.length === 0) throw new TypeError("notebook creation requires the separately hired authorization-verification service");
  const request = encode(input), message = { messageId: randomUUID(), contextId: "", taskId: "", role: ROLE_USER, parts: [senPart(request.bytes, "notebook-authorization-verification-request.sen.cbor")], metadata: {}, extensions: [POLICY.verificationLaw], referenceTaskIds: [] };
  const exchange = await sendSenTask({ agentUrl, requireSignature: POLICY.requireSignedAgentCard, message, ...(options.signal ? { signal: options.signal } : {}) });
  if (!verificationExtension(exchange.agentCard)) throw new TypeError("authorization provider Agent Card does not advertise the exact verification law");
  const part = extractSenPart(a2aResultParts(exchange.result)), admitted = admitNormalizedSemanticContent(part.bytes);
  const response = decode(admitted);
  if (response.request !== request.id || response.disposition !== "accepted") throw new TypeError(response.reason ?? "authorization provider refused verification");
  return response.result;
}
