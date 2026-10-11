import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { effectTerm } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { artifactChecksum, assayWitTransition, completeEffect, proposeEffect, semanticBytesId, semanticJsonId, serveWitTransitionAssay, textNi } from "../../src/fabric/effect-assay.mjs";

function minimalCell(overrides = {}) {
  return {
    caller: "eip155:31337:0x4444444444444444444444444444444444444444",
    provider: "eip155:31337:0x5555555555555555555555555555555555555555",
    evidenceRoot: textNi("evidence"),
    outcome: { positiveEvidence: false, negativeEvidence: false },
    measures: [],
    parent: null,
    ...overrides,
  };
}

test("artifactChecksum names bytes by their sha256 hex digest", () => {
  const bytes = Buffer.from("effect-assay", "utf8");
  assert.equal(artifactChecksum(bytes), `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
});

test("semanticJsonId/semanticBytesId/textNi are deterministic and object-kind-scoped", () => {
  assert.equal(textNi("FOUR-bottom"), textNi("FOUR-bottom"));
  assert.notEqual(textNi("FOUR-bottom"), textNi("FOUR-bottom", "inference-work-lot.effect-coordinate"));
  assert.match(textNi("FOUR-bottom"), /^ni:\/\/\/sha-256;/u);
  const bytes = Buffer.from("artifact bytes", "utf8");
  assert.equal(semanticBytesId("resource-brokerage.artifact", bytes), semanticBytesId("resource-brokerage.artifact", bytes));
  assert.notEqual(semanticBytesId("resource-brokerage.artifact", bytes), semanticBytesId("other.artifact", bytes));
  assert.equal(semanticJsonId("k", { a: 1 }), semanticJsonId("k", { a: 1 }));
});

test("proposeEffect conforms the effect term locally", () => {
  const cell = minimalCell();
  const proposal = proposeEffect("urn:ame:test-actor", cell, "2099-01-01T00:00:00.000Z");
  assert.equal(proposal.semanticId, semanticId(effectTerm(cell)));
  assert.equal(proposal.evidence, cell.evidenceRoot);
  assert.match(proposal.conformance, /^ni:\/\/\/sha-256;/u);
});

test("completeEffect requires WIT_TRANSITION_ASSAY_AGENT to be named before it hires the provider", async () => {
  delete process.env.WIT_TRANSITION_ASSAY_AGENT;
  await assert.rejects(() => completeEffect("urn:ame:test-actor", minimalCell(), minimalCell(), textNi("evidence"), "2099-01-01T00:00:00.000Z"), /WIT_TRANSITION_ASSAY_AGENT/u);
});

test("a served WIT transition provider witnesses one FOUR cover and refuses a double jump", async () => {
  const account = "eip155:31337:0x0aadad1c6a71d34f89dad0cb41a75603433a6071";
  const server = await serveWitTransitionAssay({ providerAccount: account });
  try {
    const evidence = textNi("evidence");
    const proposalCell = minimalCell();
    const completion = (positiveEvidence, negativeEvidence) => ({ ...proposalCell, evidenceRoot: evidence, outcome: { positiveEvidence, negativeEvidence } });
    const receipt = await assayWitTransition({ agentUrl: server.baseUrl, proposalCell, completionCell: completion(true, false), evidence });
    assert.equal(receipt.provider, account);
    assert.equal(receipt.witnessTerm.articulatedAxis, "positiveEvidence");
    await assert.rejects(() => assayWitTransition({ agentUrl: server.baseUrl, proposalCell, completionCell: completion(true, true), evidence }));
  } finally { await server.close(); }
});
