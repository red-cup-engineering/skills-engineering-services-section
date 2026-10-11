import { Buffer } from "node:buffer";
import { canonicalJson, formContextPacket, ni } from "./context-packet.mjs";

const MAX_CARRIER_BYTES = 1_048_576;

function canonicalCarrier(carrier) {
  if (carrier === null || typeof carrier !== "object" || Array.isArray(carrier)) {
    throw new Error("P10 digestion requires one typed carrier object");
  }
  if (typeof carrier.type !== "string" || carrier.type.trim() === "") {
    throw new Error("P10 digestion carrier requires one nonempty type");
  }
  let content;
  try {
    content = canonicalJson(carrier);
    if (typeof content !== "string") throw new TypeError("carrier is not JSON-representable");
    JSON.parse(content);
  } catch {
    throw new Error("P10 digestion carrier must have one canonical JSON representation");
  }
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength === 0 || byteLength > MAX_CARRIER_BYTES) {
    throw new Error(`P10 carrier must contain 1 to ${MAX_CARRIER_BYTES} canonical bytes`);
  }
  const address = ni(content);
  const source = typeof carrier.id === "string" && carrier.id.trim() !== "" ? carrier.id : address;
  return Object.freeze({ address, content, source, type: carrier.type.trim() });
}

export function formP10WorkLot({ carrier, createdBy, objective, id } = {}) {
  if (typeof createdBy !== "string" || !createdBy.startsWith("urn:")) throw new Error("P10 digestion requires one creating actor URN");
  const witnessed = canonicalCarrier(carrier);
  const workObjective = objective?.trim() || `Digest ${witnessed.type} at ${witnessed.source} into one self-contained record of no more than 30 nonempty lines. Preserve evidence identities, decisions, unresolved contradictions, and the next lawful action. Do not invent facts or claim integration.`;
  const packet = formContextPacket({
    objective: workObjective,
    createdBy,
    segments: [
      { mediaType: "application/json", content: witnessed.content, source: witnessed.source },
    ],
    knowledge: [
      { ni: witnessed.address, relation: `witnessed-as:${witnessed.type}` },
    ],
  });
  return Object.freeze({
    id: id ?? `p10:${witnessed.address.split(";")[1]}`,
    objective: workObjective,
    contextPacket: packet,
    workType: "summarization",
    taskClass: "p10-digestion",
    requiredCapabilities: Object.freeze(["summarization"]),
  });
}

export function admitP10Digest(candidate) {
  if (typeof candidate !== "string") throw new Error("P10 digestion candidate must be text");
  const text = candidate.trim();
  if (text === "") throw new Error("P10 digestion candidate must contain text");
  const lines = text.split(/\r?\n/u);
  if (lines.some((line) => line.trim() === "")) throw new Error("P10 digestion record must not contain blank lines");
  if (lines.length > 30) throw new Error("P10 digestion record exceeds 30 lines");
  return text;
}
