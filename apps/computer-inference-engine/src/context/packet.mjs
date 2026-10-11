import { isNiUri, makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
import { admitContextPacketRefusal, admitContextPacketRequest, admitContextPacketResult } from "./packet-carriers.mjs";

export { CONTEXT_PACKET_EAVT } from "./packet-carriers.mjs";

export const CONTEXT_PACKET_PROFILE = "org.harmonious-union.context-packet.v1";

export function contextPacketContentAddress(value) {
  return makeNiUri(Buffer.from(typeof value === "string" ? value : canonicalJson(value), "utf8"));
}

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be a nonempty string`);
  return value;
}

function formSegment(segment, index) {
  if (!segment || typeof segment !== "object" || Array.isArray(segment)) throw new TypeError(`segments[${index}] must be an object`);
  const mediaType = nonempty(segment.mediaType, `segments[${index}].mediaType`);
  const content = nonempty(segment.content, `segments[${index}].content`);
  const source = segment.source === undefined ? undefined : nonempty(segment.source, `segments[${index}].source`);
  const ni = contextPacketContentAddress(content);
  if (segment.ni !== undefined && segment.ni !== ni) throw new TypeError(`segments[${index}].ni differs from its content`);

  let compaction;
  if (segment.compaction !== undefined) {
    const value = segment.compaction;
    if (!value || typeof value !== "object" || Array.isArray(value) || value.eligibility !== "tool-output"
      || (value.isError !== undefined && typeof value.isError !== "boolean")
      || (value.exitCode !== undefined && !Number.isInteger(value.exitCode))) {
      throw new TypeError(`segments[${index}].compaction must declare an eligible tool output`);
    }
    compaction = Object.freeze({
      eligibility: "tool-output",
      ...(value.isError === undefined ? {} : { isError: value.isError }),
      ...(value.exitCode === undefined ? {} : { exitCode: value.exitCode }),
    });
  }

  return Object.freeze({
    ni,
    mediaType,
    byteLength: Buffer.byteLength(content),
    ...(source === undefined ? {} : { source }),
    ...(compaction === undefined ? {} : { compaction }),
    content,
  });
}

function formKnowledge(reference, index, segmentAddresses) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) throw new TypeError(`knowledge[${index}] must be an object`);
  const ni = nonempty(reference.ni, `knowledge[${index}].ni`);
  if (!isNiUri(ni)) throw new TypeError(`knowledge[${index}].ni must be an RFC 6920 sha-256 ni URI`);
  if (!segmentAddresses.has(ni)) throw new TypeError(`knowledge[${index}].ni must address a segment in this packet`);
  return Object.freeze({ ni, relation: nonempty(reference.relation, `knowledge[${index}].relation`) });
}

/** Form one self-contained, content-addressed context packet. */
export function formContextPacket(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("context packet input must be an object");
  if (!Array.isArray(input.segments) || input.segments.length === 0) throw new TypeError("segments must contain at least one context segment");
  if (!Array.isArray(input.knowledge) || input.knowledge.length === 0) throw new TypeError("knowledge must state at least one relation to the supplied context");

  const segments = input.segments.map(formSegment);
  const addresses = new Set(segments.map(({ ni }) => ni));
  if (addresses.size !== segments.length) throw new TypeError("segments must be content-distinct; duplicate content belongs in one segment");
  const knowledge = input.knowledge.map((reference, index) => formKnowledge(reference, index, addresses))
    .sort((left, right) => left.ni.localeCompare(right.ni) || left.relation.localeCompare(right.relation));
  if (new Set(knowledge.map(({ ni, relation }) => `${ni}\n${relation}`)).size !== knowledge.length) throw new TypeError("knowledge relations must be unique");

  const body = Object.freeze({
    profile: CONTEXT_PACKET_PROFILE,
    objective: nonempty(input.objective, "objective"),
    createdBy: nonempty(input.createdBy, "createdBy"),
    segments: Object.freeze(segments),
    knowledge: Object.freeze(knowledge),
  });
  admitContextPacketRequest(input);
  return Object.freeze(admitContextPacketResult({ id: contextPacketContentAddress(body), ...body }));
}

/** A serializable formation boundary: an immutable packet or an explicit refusal. */
export function formContextPacketExchange(input) {
  try { return Object.freeze({ outcome: "result", value: formContextPacket(input) }); }
  catch (error) {
    return Object.freeze({
      outcome: "refusal",
      value: Object.freeze(admitContextPacketRefusal({
        type: "ContextPacketFormationRefusal",
        code: error?.code ?? "invalid-context-packet",
        reason: error instanceof Error ? error.message : String(error),
      })),
    });
  }
}
