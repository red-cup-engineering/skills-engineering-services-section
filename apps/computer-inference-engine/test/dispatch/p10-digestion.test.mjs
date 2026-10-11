import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../../src/dispatch/context-packet.mjs";
import { inferenceBatchRequest } from "../../src/dispatch/client.mjs";
import { admitP10Digest, formP10WorkLot } from "../../src/dispatch/p10-digestion.mjs";

const observation = {
  id: "ni:///sha-256;repository-observation",
  type: "RepositoryMaterialObservation",
  provider: "urn:ame:repository-material-observation-service",
  customerMutation: false,
  projection: {
    kind: "file",
    encoding: "base64",
    content: Buffer.from("A fulfilled inference found one exact seam.").toString("base64"),
    file: { kind: "file", path: "records/fulfilled.txt", textual: true },
  },
};

test("an ordinary typed carrier becomes a standard playable inference work lot", () => {
  const job = formP10WorkLot({ carrier: observation, createdBy: "urn:ame:test-cultivator" });
  const request = inferenceBatchRequest(job, {
    customer: "urn:test:customer",
    purpose: "P10 digestion",
    desiredUse: "seed the next inference",
    workLotPrefix: "p10",
  });
  assert.equal(request.workType, "summarization");
  assert.equal(request.taskClass, "p10-digestion");
  assert.equal(request.context, undefined);
  assert.equal(request.contextPacket.profile, "org.harmonious-union.context-packet.v1");
  assert.equal(request.contextPacket.segments[0].content, canonicalJson(observation));
  assert.deepEqual(request.contextPacket.knowledge.map(({ relation }) => relation), ["witnessed-as:RepositoryMaterialObservation"]);
  assert.match(request.objective, /no more than 30 nonempty lines/u);
});

test("a receipt without an authored id receives its canonical content identity", () => {
  const carrier = { type: "ModeledUnionActionReceipt", sequence: 0, action: "inspect:bamboo-court" };
  const job = formP10WorkLot({ carrier, createdBy: "urn:ame:modeled-union-dimension" });
  assert.match(job.id, /^p10:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
  assert.match(job.contextPacket.segments[0].source, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
  assert.equal(job.contextPacket.segments[0].content, canonicalJson(carrier));
});

test("the compiler refuses untyped or noncanonical carriers", () => {
  assert.throws(() => formP10WorkLot({ carrier: {}, createdBy: "urn:ame:test-cultivator" }), /nonempty type/u);
  assert.throws(() => formP10WorkLot({ carrier: { type: "Cyclic", get self() { return this; } }, createdBy: "urn:ame:test-cultivator" }), /canonical JSON/u);
});

test("P10 admission keeps the compact product bounded", () => {
  assert.equal(admitP10Digest("decision: keep the typed packet\nnext: dispatch it"), "decision: keep the typed packet\nnext: dispatch it");
  assert.throws(() => admitP10Digest("one\n\nthree"), /must not contain blank lines/u);
  assert.throws(() => admitP10Digest(Array.from({ length: 31 }, (_, index) => `line ${index}`).join("\n")), /exceeds 30 lines/u);
});
