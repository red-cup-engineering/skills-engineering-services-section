import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, formContextPacket, ni } from "../../src/dispatch/context-packet.mjs";
import { admitInferenceContext } from "../../src/dispatch/context-packet-demand.mjs";

const objective = "Return one source-grounded distinction.";
const content = "A context packet carries both material and knowledge coordinates.";
const packet = formContextPacket({ objective, createdBy: "urn:ame:bare-cedar-fog-codex", segments: [{ mediaType: "text/plain", content }], knowledge: [{ ni: ni(content), relation: "supports-objective" }] });
const admit = (input) => admitInferenceContext(input, { formContextPacket, canonicalJson });

test("a formed packet enters the paid demand as material plus knowledge coordinates", () => {
  const result = admit({ objective, contextPacket: packet });
  assert.equal(result.suppliedContext, content);
  assert.equal(result.contextPacket.id, packet.id);
  assert.deepEqual(result.contextPacket.knowledge, packet.knowledge);
  assert.equal(Object.hasOwn(result.contextPacket.segmentRefs[0], "content"), false);
});

test("the market refuses ambiguous, forged, or differently purposed packets", () => {
  assert.throws(() => admit({ objective }), /exactly one/u);
  assert.throws(() => admit({ objective, context: content, contextPacket: packet }), /exactly one/u);
  assert.throws(() => admit({ objective, contextPacket: { ...packet, id: ni("forged") } }), /canonical content/u);
  assert.throws(() => admit({ objective: "different", contextPacket: packet }), /work-lot objective/u);
});
