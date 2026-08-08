import { isNiUri, makeNiUri } from "@red-cup-engineering/ni-uri-services-section";
import { admitFormContextPacketRefusal, admitFormContextPacketRequest, admitFormContextPacketResult } from "./carriers.mjs";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function ni(value) {
  const text = typeof value === "string" ? value : canonicalJson(value);
  return makeNiUri(Buffer.from(text, "utf8"));
}

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a nonempty string`);
  return value;
}

function formSegment(segment, index) {
  if (!segment || typeof segment !== "object" || Array.isArray(segment)) throw new Error(`segments[${index}] must be an object`);
  const mediaType = nonempty(segment.mediaType, `segments[${index}].mediaType`);
  const content = nonempty(segment.content, `segments[${index}].content`);
  const source = segment.source === undefined ? undefined : nonempty(segment.source, `segments[${index}].source`);
  const address = ni(content);
  if (segment.ni !== undefined && segment.ni !== address) throw new Error(`segments[${index}].ni differs from its content`);
  return Object.freeze({ ni: address, mediaType, byteLength: Buffer.byteLength(content), ...(source ? { source } : {}), content });
}

function formKnowledge(reference, index, segmentAddresses) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) throw new Error(`knowledge[${index}] must be an object`);
  const address = nonempty(reference.ni, `knowledge[${index}].ni`);
  if (!isNiUri(address)) throw new Error(`knowledge[${index}].ni must be an RFC 6920 sha-256 ni URI`);
  if (!segmentAddresses.has(address)) throw new Error(`knowledge[${index}].ni must address a segment in this packet`);
  return Object.freeze({ ni: address, relation: nonempty(reference.relation, `knowledge[${index}].relation`) });
}

export function formContextPacket(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("context packet input must be an object");
  if (!Array.isArray(input.segments) || input.segments.length === 0) throw new Error("segments must contain at least one context segment");
  const segments = input.segments.map(formSegment);
  const segmentAddresses = new Set(segments.map((segment) => segment.ni));
  if (segmentAddresses.size !== segments.length) throw new Error("segments must be content-distinct; duplicate content belongs in one segment");
  if (!Array.isArray(input.knowledge) || input.knowledge.length === 0) throw new Error("knowledge must state at least one relation to the supplied context");
  const knowledge = input.knowledge.map((reference, index) => formKnowledge(reference, index, segmentAddresses))
    .sort((left, right) => left.ni.localeCompare(right.ni) || left.relation.localeCompare(right.relation));
  const coordinates = new Set(knowledge.map((reference) => `${reference.ni}\n${reference.relation}`));
  if (coordinates.size !== knowledge.length) throw new Error("knowledge relations must be unique");
  const body = Object.freeze({
    profile: "org.harmonious-union.context-packet.v1",
    objective: nonempty(input.objective, "objective"),
    createdBy: nonempty(input.createdBy, "createdBy"),
    segments: Object.freeze(segments),
    knowledge: Object.freeze(knowledge),
  });
  admitFormContextPacketRequest(input);
  return Object.freeze(admitFormContextPacketResult({ id: ni(body), ...body }));
}

export function formContextPacketExchange(input) {
  try { return Object.freeze({ outcome: "result", value: formContextPacket(input) }); }
  catch (error) { return Object.freeze({ outcome: "refusal", value: admitFormContextPacketRefusal({ type: "ContextPacketFormationRefusal", code: error.code ?? "invalid-context-packet", reason: error instanceof Error ? error.message : String(error) }) }); }
}
