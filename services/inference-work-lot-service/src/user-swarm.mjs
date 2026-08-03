import { randomUUID } from "node:crypto";
import { contractCodexInferenceWork } from "./codex-inference-market.mjs";

export const MAXIMUM_USER_MESSAGE_BYTES = 64 * 1024;
const NON_CODEX_PROVIDER = /^urn:ame:(?!bare-cedar-fog-codex$|codex$).+/u;

/** The deterministic GUI compiler; transport belongs to the sovereign MUD pore. */
export function userMessageWorkLot(message) {
  if (typeof message !== "string" || message.trim() === "") {
    throw new TypeError("message must contain text");
  }
  if (Buffer.byteLength(message, "utf8") > MAXIMUM_USER_MESSAGE_BYTES) {
    throw new TypeError(`message must not exceed ${MAXIMUM_USER_MESSAGE_BYTES} bytes`);
  }
  return Object.freeze({
    objective: message.trim(),
    context: message.trim(),
    workType: "chat",
    taskClass: "user-swarm-message",
    desiredUse: "Return one direct answer to the user who supplied this message.",
    enforceProviderSchema: false,
    mode: "live",
  });
}

export function completedUserMessage(result, messageId = randomUUID()) {
  if (result?.outcome !== "candidate-pending-codex-acceptance") return null;
  if (typeof result.provider !== "string" || !NON_CODEX_PROVIDER.test(result.provider)) {
    throw new Error("the swarm result does not identify a non-Codex provider");
  }
  return Object.freeze({
    type: "SwarmMessageResult",
    status: "completed",
    messageId,
    execution: "non-codex",
    provider: result.provider,
    model: result.model ?? null,
    result: result.candidate,
    receipt: Object.freeze({
      workLot: result.workLot,
      receipt: result.evidence?.receipt,
      compact: result.evidence?.compact,
      schemaAssay: result.evidence?.schemaAssay,
      considerationClose: result.evidence?.considerationClose ?? result.considerationClose,
      settlement: result.evidence?.settlement,
    }),
    receiverAcceptanceRequired: result.receiverAcceptanceRequired === true,
    acceptanceScope: result.acceptanceScope,
  });
}

export async function executeUserMessage(source, { contract = contractCodexInferenceWork, messageId = randomUUID() } = {}) {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("request body must contain one JSON object");
  }
  const message = userMessageWorkLot(source.message);
  const result = await contract(message);
  const completed = completedUserMessage(result, messageId);
  if (completed) return completed;
  return Object.freeze({
    type: "SwarmMessageResult",
    status: "failed",
    messageId,
    reason: result?.disposition ?? result?.outcome ?? "no-provider-result",
    receipt: result?.receipt ?? null,
  });
}
