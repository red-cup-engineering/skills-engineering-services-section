import { Message, Role } from "@a2a-js/sdk";
import { extractRmnPart, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
const semanticId = (value) => identifyJsonSemanticContent({ objectKind: "rsc-quiescent.record", value, witnessRoot: EMPTY_WITNESS_ROOT }).token;
import { ACTOR, position } from "./enterprise.mjs";
import { compileNetworkToolEvidence } from "./tool-evidence.mjs";

const identified = (body) => Object.freeze({ id: semanticId(body), ...body });
const exact = (value) => value?.id === semanticId(Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => key !== "id")));
export const operationBytes = (value) => identifyJsonSemanticContent({ objectKind: "rsc-quiescent.record", value, witnessRoot: EMPTY_WITNESS_ROOT }).bytes;
export function operationFromBytes(bytes) { return admitJsonSemanticContent({ bytes, objectKind: "rsc-quiescent.record" }).value; }
/**
 * A2A is the operation language below the ActivityPub/CloudEvents carrier.
 * This function deliberately accepts the canonical RMN operation, not an
 * HTTP A2A request: public delivery is handled by the ActivityPub inbox.
 */
export function executeA2aOperationBytes(bytes, options = {}) {
  const request = operationFromBytes(bytes);
  if (!exact(request) || request.provider !== ACTOR) throw new TypeError("exact provider-addressed Codex enterprise operation required");
  if (request.type === "CodexEnterprisePositionOperation") return operationBytes(identified({
    type: "CodexEnterprisePositionOperationResult", provider: ACTOR, request: request.id, position: (options.position ?? position)(),
  }));
  if (request.type === "CodexToolEvidenceCompileOperation") {
    const compiled = (options.compileToolEvidence ?? compileNetworkToolEvidence)(request, options);
    return operationBytes(identified({
      type: "CodexToolEvidenceCompileOperationResult", provider: ACTOR, request: request.id,
      receipt: compiled.receipt,
      receiptAddress: compiled.receiptPath,
      premiumContext: compiled.receipt?.premiumContext?.truncated === true ? compiled.modelContext : JSON.parse(compiled.modelContext),
    }));
  }
  throw new TypeError("unsupported Codex enterprise operation");
}
export async function executeA2aMessage(source, options = {}) {
  const message = Message.fromJSON(source); if (message.role !== Role.ROLE_USER) throw new TypeError("Codex enterprise requires an A2A user Message");
  const part = extractRmnPart(message.parts), response = executeA2aOperationBytes(part.bytes, options);
  return Message.toJSON({ messageId: "", contextId: message.contextId ?? "", taskId: message.taskId ?? "", role: Role.ROLE_AGENT, parts: [rmnPart(response)], metadata: { inputNi: part.ni, customerMutation: false }, extensions: [], referenceTaskIds: [] });
}
