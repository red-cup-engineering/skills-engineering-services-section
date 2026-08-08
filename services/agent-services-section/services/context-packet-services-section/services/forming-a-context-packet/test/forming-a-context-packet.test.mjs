import assert from "node:assert/strict";
import test from "node:test";
import { formContextPacket, formContextPacketExchange, ni } from "../src/forming-a-context-packet.mjs";
import { FORM_CONTEXT_PACKET_EAVT } from "../src/carriers.mjs";

const content = "Semiotic foam coarsens when claims lose explicit membranes.";
const input = { objective: "Preserve the context needed to choose the next operation.", createdBy: "urn:ame:bare-cedar-fog-codex", segments: [{ mediaType: "text/plain", content }], knowledge: [{ ni: ni(content), relation: "supports-objective" }] };

test("forms one deterministic packet with independently addressed content and knowledge", () => {
  const left = formContextPacket(input), right = formContextPacket(structuredClone(input));
  assert.deepEqual(left, right);
  assert.match(left.id, /^ni:\/\/\/sha-256;/u);
  assert.equal(left.segments[0].ni, left.knowledge[0].ni);
  assert.equal(left.segments[0].byteLength, Buffer.byteLength(content));
});

test("refuses aggregate or falsely addressed context", () => {
  assert.throws(() => formContextPacket({ ...input, knowledge: [] }), /at least one relation/u);
  assert.throws(() => formContextPacket({ ...input, segments: [...input.segments, ...input.segments] }), /content-distinct/u);
  assert.throws(() => formContextPacket({ ...input, segments: [{ ...input.segments[0], ni: ni("other") }] }), /differs from its content/u);
});

test("the JSON boundary conserves explicit refusal and schema-to-EAVT metadata", () => {
  const exchange = formContextPacketExchange({ objective: "missing exact carrier fields" });
  assert.equal(exchange.outcome, "refusal");
  assert.equal(exchange.value.type, "ContextPacketFormationRefusal");
  assert.equal(FORM_CONTEXT_PACKET_EAVT.entity, "$.id");
  assert.equal(FORM_CONTEXT_PACKET_EAVT.derived, true);
});
