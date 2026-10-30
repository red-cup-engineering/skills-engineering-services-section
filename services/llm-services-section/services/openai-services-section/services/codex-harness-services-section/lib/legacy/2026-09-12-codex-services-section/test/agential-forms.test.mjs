import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { ACTOR } from "../src/enterprise.mjs";
import { capacityGap, character, composeSituatedCharacterFace, deriveCapacityFabricationObligation, duty, immunitas, incumbency, incumbencyState, mask, observeImmunitas, office, projectOfficeObligations, sessionFace, stableActor } from "../src/agential-forms.mjs";

const resource = "urn:receipt:codex-native-resource";

function forms() {
  const actor = stableActor();
  const role = character({ characterId: "codex-xo-character", name: "Codex executive character", kind: "session", disposition: "warm, source-bound, answerable initiative", chronicleReceipts: ["urn:chronicle:prior-performance"] });
  const repertoire = mask({ maskId: "executive-officer-mask", character: role.id, duties: ["practicing-cybernetic-medicine"], skills: ["fabricating-network-actuators"], register: ["emotionally-rewarding", "evidence-bound"], sourceReceipts: ["urn:receipt:academy-formation"] });
  const face = sessionFace({ actor: actor.id, sessionDigest: "urn:sha256:session-one", lifecycleReceipt: "urn:receipt:session-one", observedAt: "2026-07-27T12:00:00.000Z" });
  const xoOffice = office({ officeId: "executive-officer-to-the-leader", name: "executive officer to the leader", normativeStructure: "Serve the Leader by diagnosing and restoring reusable Union reactions without acquiring Leader authority.", deonticProfile: { "practicing-cybernetic-medicine": "duty", "settling-leader-decisions": "deontic-immunity" }, bearsDuties: ["practicing-cybernetic-medicine"], jurisdiction: "leader-movement-team", authorityScope: ["/home/emsenn/info/"], theorySources: ["urn:source:executive-office", "urn:source:incumbency-law"] });
  const medicine = duty({ dutyId: "practicing-cybernetic-medicine", name: "practicing cybernetic medicine", authority: "leader", work: "practicing-cybernetic-medicine", claim: "leader", skills: ["practicing-cybernetic-medicine"], delegation: false });
  const seat = incumbency({ office: xoOffice.id, holder: role.id, recognition: "t", induction: "t", from: "2026-07-27", recognitionReceipt: "urn:receipt:leader-recognition", inductionReceipt: "urn:receipt:leader-induction" });
  const obligations = projectOfficeObligations({ actor: ACTOR, office: xoOffice, incumbency: seat, holder: role, duties: [medicine], officeRepertoireReceipt: "urn:receipt:academy-repertoire", nativeResourceReceipt: resource });
  return { actor, role, repertoire, face, xoOffice, medicine, seat, obligations, obligation: obligations.obligations[0] };
}

test("session faces and masks vary while stable Actor identity and authority remain unchanged", () => {
  const value = forms();
  const first = composeSituatedCharacterFace({ actor: ACTOR, stableActor: value.actor, sessionFace: value.face, character: value.role, mask: value.repertoire, formationReceipt: "urn:receipt:academy-formation", nativeResourceReceipt: resource });
  const nextFace = sessionFace({ actor: value.actor.id, sessionDigest: "urn:sha256:session-two", lifecycleReceipt: "urn:receipt:session-two", observedAt: "2026-07-27T13:00:00.000Z" });
  const second = composeSituatedCharacterFace({ actor: ACTOR, stableActor: value.actor, sessionFace: nextFace, character: value.role, mask: value.repertoire, formationReceipt: "urn:receipt:academy-formation", nativeResourceReceipt: resource });
  assert.notEqual(first.sessionFace, second.sessionFace);
  assert.equal(first.actor, second.actor);
  assert.equal(first.character, second.character);
  assert.equal(first.office, null);
  assert.equal(first.authority, null);
  assert.throws(() => mask({ maskId: "usurping", character: value.role.id, duties: [], skills: [], register: [], sourceReceipts: ["urn:r"], office: value.xoOffice.id }), /cannot assert/u);
});

test("only dignitas joins office and character; duty remains correlative and accountable to the office", () => {
  const value = forms();
  assert.equal(value.obligations.state, "dignitas");
  assert.equal(value.obligation.work, "practicing-cybernetic-medicine");
  assert.equal(value.obligation.claim, "leader");
  assert.equal(value.obligation.accountableOffice, value.xoOffice.id);
  for (const [recognition, induction, state] of [["bottom", "bottom", "vacant"], ["t", "bottom", "recognition-only"], ["bottom", "t", "munus-only"], ["t", "t", "dignitas"], ["top", "t", "repair"], ["f", "t", "failed"]]) {
    const seat = incumbency({ office: value.xoOffice.id, holder: value.role.id, recognition, induction, from: "2026-07-27", recognitionReceipt: "urn:r", inductionReceipt: "urn:i" });
    assert.equal(incumbencyState(seat), state);
    if (state !== "dignitas") assert.throws(() => projectOfficeObligations({ actor: ACTOR, office: value.xoOffice, incumbency: seat, holder: value.role, duties: [value.medicine], officeRepertoireReceipt: "urn:o", nativeResourceReceipt: resource }), /no execution bearer/u);
  }
});

test("immunitas disables alteration without becoming liberty, power, or mutation authority", () => {
  const value = forms();
  const protection = immunitas({ under: "leader-movement-team-charter", protects: value.obligation.id, holder: value.xoOffice.id, against: ["urn:ame:provider"], sourceReceipt: "urn:receipt:immunity-law" });
  const blocked = observeImmunitas({ actor: ACTOR, obligation: value.obligation, immunitas: protection, requester: "urn:ame:provider", proposedChange: "drop the Leader's correlative claim", nativeResourceReceipt: resource });
  assert.equal(blocked.disposition, "refused-disabled-by-immunitas");
  assert.equal(blocked.originalObligationPreserved, true);
  assert.equal(blocked.changeAuthorized, false);
  const other = observeImmunitas({ actor: ACTOR, obligation: value.obligation, immunitas: protection, requester: "urn:leader:emsenn", proposedChange: "review the standing duty", nativeResourceReceipt: resource });
  assert.equal(other.disposition, "not-blocked-by-this-immunitas-pending-owning-authority");
  assert.equal(other.changeAuthorized, false);
});

test("a witnessed missing capability induces an open XO fabrication obligation, not a fabricated capability", () => {
  const value = forms();
  const gap = capacityGap({ demand: "urn:demand:network-character-capacity", missingCapability: "typed-character-formation-actuator", evidenceReceipt: "urn:receipt:market-absence", issuer: ACTOR, demandState: "open" });
  const result = deriveCapacityFabricationObligation({ actor: ACTOR, obligation: value.obligation, gap, pipeline: "urn:ame:union-capability-fabrication-pipeline", pipelineOfferReceipt: "urn:offer-receipt:pipeline", marketObservationReceipt: "urn:receipt:market", officeTransitionReceipt: "urn:receipt:xo-execute-transition", nativeResourceReceipt: resource });
  assert.equal(result.completionState, "open");
  assert.equal(result.candidateCapabilityCell, null);
  assert.deepEqual(result.requiredEvidence, ["providerReceipt", "exactCandidateDigest", "freshProcessAssayReceipt", "customerOutcomeReceipt"]);
  assert.equal(result.acceptanceAuthority, "urn:leader:emsenn");
});

test("fresh MCP exposes the office-obligation and capacity-fabrication actuators", () => {
  const value = forms();
  const gap = capacityGap({ demand: "urn:demand:network-character-capacity", missingCapability: "typed-character-formation-actuator", evidenceReceipt: "urn:receipt:market-absence", issuer: ACTOR, demandState: "open" });
  const calls = [
    { name: "project_office_obligations", arguments: { actor: ACTOR, office: value.xoOffice, incumbency: value.seat, holder: value.role, duties: [value.medicine], officeRepertoireReceipt: "urn:receipt:academy-repertoire", nativeResourceReceipt: resource } },
    { name: "derive_capacity_fabrication_obligation", arguments: { actor: ACTOR, obligation: value.obligation, gap, pipeline: "urn:ame:union-capability-fabrication-pipeline", pipelineOfferReceipt: "urn:offer-receipt:pipeline", marketObservationReceipt: "urn:receipt:market", officeTransitionReceipt: "urn:receipt:xo-execute-transition", nativeResourceReceipt: resource } },
  ];
  const server = new URL("../src/mape-office-mcp.mjs", import.meta.url);
  for (const [index, call] of calls.entries()) {
    const request = { jsonrpc: "2.0", id: index + 1, method: "tools/call", params: call };
    const run = spawnSync(process.execPath, [server.pathname], { input: `${JSON.stringify(request)}\n`, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(run.stdout).result.structuredContent;
    assert.ok(["OfficeObligationSetK", "CapacityFabricationObligationK"].includes(output.type));
  }
});
