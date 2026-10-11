import { randomUUID } from "node:crypto";

/** A deterministic stand-in provider handler for a2a-server.mjs's handler
 * map: echoes the caller's SEN part back and reports completion. */
export function executeA2aMessage(message) {
  const part = (message.parts ?? []).find((value) => value?.mediaType === "application/sen+cbor" && value?.content?.$case === "raw");
  if (!part) throw new Error("deterministic provider requires one SEN CBOR part");
  return {
    messageId: randomUUID(), contextId: message.contextId, taskId: message.taskId, role: "ROLE_AGENT",
    parts: [part, { content: { $case: "text", value: "ready" }, metadata: { disposition: "completion" }, filename: "", mediaType: "text/plain" }],
    metadata: { disposition: "completion", providerExecution: "deterministic-test-fixture" },
    extensions: [], referenceTaskIds: [],
  };
}
