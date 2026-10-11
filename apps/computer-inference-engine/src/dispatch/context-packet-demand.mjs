export function admitInferenceContext(input, { formContextPacket, canonicalJson }) {
  const hasRawContext = typeof input?.context === "string";
  const hasPacket = input?.contextPacket !== undefined;
  if (input?.chatCompletion !== undefined && (hasRawContext || hasPacket)) {
    throw new Error("chatCompletion messages must carry all provider-visible context; do not supply separate context or contextPacket");
  }
  if (!hasRawContext && !hasPacket && input?.chatCompletion !== undefined) return Object.freeze({ suppliedContext: "" });
  if (hasRawContext === hasPacket) throw new Error("supply exactly one of context or contextPacket");
  if (hasRawContext) return Object.freeze({ suppliedContext: input.context });
  if (typeof formContextPacket !== "function" || typeof canonicalJson !== "function") throw new Error("context packet admission requires the forming cell");
  const packet = input.contextPacket;
  const formed = formContextPacket({ objective: packet?.objective, createdBy: packet?.createdBy, segments: packet?.segments, knowledge: packet?.knowledge });
  if (canonicalJson(formed) !== canonicalJson(packet)) throw new Error("contextPacket differs from its canonical content");
  if (formed.objective !== input.objective) throw new Error("contextPacket.objective must equal the work-lot objective");
  return Object.freeze({
    suppliedContext: formed.segments.map((segment) => segment.content).join("\n\n"),
    contextPacket: Object.freeze({
      id: formed.id,
      createdBy: formed.createdBy,
      segmentRefs: Object.freeze(formed.segments.map(({ ni, mediaType, byteLength, source }) => Object.freeze({ ni, mediaType, byteLength, ...(source ? { source } : {}) }))),
      knowledge: formed.knowledge,
    }),
  });
}
