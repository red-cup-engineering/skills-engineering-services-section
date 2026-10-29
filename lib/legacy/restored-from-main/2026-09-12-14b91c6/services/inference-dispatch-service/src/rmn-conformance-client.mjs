import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Message, Role } from "@a2a-js/sdk";
import { a2aResultParts, sendRmnTask } from "@red-cup-engineering/a2a-rmn-task-client-service";
import { extractRmnPart, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { dataCustodyDirectory } from "@red-cup-engineering/data-custody-directory-service";
import { makeNiUri } from "@red-cup-engineering/ni-services-section";
import { SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION } from "./sovereign-provider-interface.mjs";
import { decodeNormalizedCarrier, normalizedCarrierBytes } from "./modern-rmn-carrier.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTBOUND_TASK_ROOT = dataCustodyDirectory(resolve(HERE, ".."), "state", "a2a");

export async function conformTerm({ agentUrl, term, expectedType, signal, send = sendRmnTask }) {
  const requestBytes = normalizedCarrierBytes(["ascribe", expectedType, term]);
  const message = Message.toJSON({
    messageId: randomUUID(), contextId: "", taskId: "", role: Role.ROLE_USER,
    parts: [rmnPart(requestBytes, "ascribed-term.rmn.cbor")], metadata: {}, extensions: [], referenceTaskIds: [],
  });
  const exchange = await send({ agentUrl, extensions: [SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION], requireSignature: true, message, outboundTaskRoot: OUTBOUND_TASK_ROOT, ...(signal ? { signal } : {}) });
  const output = extractRmnPart(a2aResultParts(exchange.result));
  const response = decodeNormalizedCarrier(output.bytes);
  if (!Buffer.from(normalizedCarrierBytes(response)).equals(Buffer.from(output.bytes)) || response?.[0] !== "ascribe" || response.length !== 3) throw new Error("RMN provider returned a noncanonical or untyped response");
  return Object.freeze({
    output,
    response,
    expectedType: response[1],
    normalForm: response[2],
    requestNi: makeNiUri(requestBytes),
    term: makeNiUri(normalizedCarrierBytes(term)),
    normalFormId: makeNiUri(normalizedCarrierBytes(response[2])),
    canonicalBytesBase64: Buffer.from(normalizedCarrierBytes(term)).toString("base64"),
    normalFormBytesBase64: Buffer.from(normalizedCarrierBytes(response[2])).toString("base64"),
    exchange,
  });
}
