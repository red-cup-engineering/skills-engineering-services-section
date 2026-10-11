import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-engineering-services-section/semantic-content-identity";
import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
export { canonicalJson };


export function ni(value, objectKind = `inference-work-lot.${value?.type ?? (typeof value === "string" ? "text" : "material")}`) {
  return identifyJsonSemanticContent({ objectKind, value, witnessRoot: EMPTY_WITNESS_ROOT }).token;
}
function text(value, label) { if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a nonempty string`); return value; }
export function formContextPacket(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("context packet input must be an object");
  if (!Array.isArray(input.segments) || input.segments.length === 0) throw new Error("segments must contain at least one context segment");
  const segments = input.segments.map((segment, index) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) throw new Error(`segments[${index}] must be an object`);
    const content = text(segment.content, `segments[${index}].content`), address = ni(content);
    if (segment.ni !== undefined && segment.ni !== address) throw new Error(`segments[${index}].ni differs from its content`);
    let compaction;
    if (segment.compaction !== undefined) {
      if (!segment.compaction || typeof segment.compaction !== "object" || Array.isArray(segment.compaction)
        || segment.compaction.eligibility !== "tool-output"
        || (segment.compaction.isError !== undefined && typeof segment.compaction.isError !== "boolean")
        || (segment.compaction.exitCode !== undefined && !Number.isInteger(segment.compaction.exitCode))) throw new Error(`segments[${index}].compaction must declare an eligible tool output`);
      compaction = Object.freeze({ eligibility: "tool-output", ...(segment.compaction.isError === undefined ? {} : { isError: segment.compaction.isError }), ...(segment.compaction.exitCode === undefined ? {} : { exitCode: segment.compaction.exitCode }) });
    }
    return Object.freeze({ ni: address, mediaType: text(segment.mediaType, `segments[${index}].mediaType`), byteLength: Buffer.byteLength(content), ...(segment.source === undefined ? {} : { source: text(segment.source, `segments[${index}].source`) }), ...(compaction ? { compaction } : {}), content });
  });
  const addresses = new Set(segments.map(({ ni: address }) => address));
  if (addresses.size !== segments.length) throw new Error("segments must be content-distinct; duplicate content belongs in one segment");
  if (!Array.isArray(input.knowledge) || input.knowledge.length === 0) throw new Error("knowledge must state at least one relation to the supplied context");
  const knowledge = input.knowledge.map((reference, index) => {
    if (!reference || typeof reference !== "object" || Array.isArray(reference) || !addresses.has(reference.ni)) throw new Error(`knowledge[${index}].ni must address a segment in this packet`);
    return Object.freeze({ ni: reference.ni, relation: text(reference.relation, `knowledge[${index}].relation`) });
  }).sort((left, right) => left.ni.localeCompare(right.ni) || left.relation.localeCompare(right.relation));
  if (new Set(knowledge.map(({ ni: address, relation }) => `${address}\n${relation}`)).size !== knowledge.length) throw new Error("knowledge relations must be unique");
  const body = Object.freeze({ profile: "org.harmonious-union.context-packet.v1", objective: text(input.objective, "objective"), createdBy: text(input.createdBy, "createdBy"), segments: Object.freeze(segments), knowledge: Object.freeze(knowledge) });
  return Object.freeze({ id: ni(body, "inference-work-lot.context-packet"), ...body });
}
