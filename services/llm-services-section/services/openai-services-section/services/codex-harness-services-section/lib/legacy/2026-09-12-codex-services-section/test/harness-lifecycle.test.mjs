import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acknowledgeCoordination, ADMITTED_HARNESS_ACTORS, assertHarnessLifecycleEvent, CODEX_HARNESS_ACTOR, completeCoordination, HARNESS_LIFECYCLE_EVENT_SCHEMA, HARNESS_LIFECYCLE_OBJECT_KIND, inventoryCodexHarness, OPS_HARNESS_EVENT_CONTRACT, PROVIDER_COMMISSIONED_EVENT_TYPE, projectOpsHarnessAttentionEvents, recordCoordinationCommission, recordProviderCommission, recordSkillSelection, SKILL_SELECTED_EVENT_TYPE, summarizeHarnessLifecycle } from "../src/harness-lifecycle.mjs";
import * as sharedLifecycle from "@red-cup-engineering/harness-lifecycle-journal-service";

// One recording implementation (harness-lifecycle-journal-service); this exercises this package's CODEX_HARNESS_ACTOR binding of it.

test("skill selections and provider commissions use the addressed harness-owned journal", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-harness-lifecycle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  recordSkillSelection({ root, turnId: "turn-1", skill: "maintain-codex-harness", recordedAt: "2026-08-31T12:00:00.000Z" });
  recordSkillSelection({ root, turnId: "turn-2", skill: "maintain-codex-harness", recordedAt: "2026-08-31T12:01:00.000Z" });
  recordSkillSelection({ root, turnId: "turn-2", skill: "census-existing-code", recordedAt: "2026-08-31T12:02:00.000Z" });
  recordProviderCommission({ root, turnId: "turn-2", agent: "harness-reviewer", task: "Forward-test the harness skill.", recordedAt: "2026-08-31T12:03:00.000Z" });

  const summary = summarizeHarnessLifecycle({ root });
  assert.equal(summary.eventCount, 4);
  assert.deepEqual(summary.selectedSkills.map(({ name, count }) => [name, count]), [["maintain-codex-harness", 2], ["census-existing-code", 1]]);
  assert.deepEqual(summary.commissionedProviders.map(({ name, count }) => [name, count]), [["harness-reviewer", 1]]);
  assert.match(summary.interpretation, /not proof of quality/u);

  const adapter = projectOpsHarnessAttentionEvents({ root });
  assert.equal(adapter.length, 4);
  assert.deepEqual(adapter[0].contract, OPS_HARNESS_EVENT_CONTRACT);
  assert.equal(adapter[0].contract.disposition, "local-adapter-only");
  assert.throws(() => recordSkillSelection({ root, skill: "missing-turn" }), /turnId is required/u);
});

test("the Codex adapter is a real consumer of the shared coordination envelope", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-coordination-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const commissioned = recordCoordinationCommission({
    root, turnId: "weiqi-1", receiverActor: "actor:bZH6KBOlPVWbYpqp04izN_Xtwykn0XgsMBStm_FkPPw",
    capability: "weiqi-platform-cleanup", channel: "codex-collaboration", workClass: "bounded-inference", allocationBasisPoints: 7000,
    inputRefs: ["ni:///sha-256;founder-direction"], route: "offer:gpt-5.6-terra-medium", receiverCondition: "CEO receives consumer evidence.",
  });
  const acknowledged = acknowledgeCoordination({ root, turnId: "weiqi-1", coordination: commissioned.id });
  const completed = completeCoordination({ root, turnId: "weiqi-1", coordination: commissioned.id, resultRefs: ["ni:///sha-256;receiver-evidence"] });
  assert.equal(commissioned.event.actor, CODEX_HARNESS_ACTOR);
  assert.match(commissioned.id, /^ni:\/\/\/sha-256;/u);
  assert.equal(assertHarnessLifecycleEvent(acknowledged.event), acknowledged.event);
  assert.equal(assertHarnessLifecycleEvent(completed.event), completed.event);
  assert.equal(sharedLifecycle.reduceCoordinationLifecycle([{ record: commissioned.event }, { record: acknowledged.event }, { record: completed.event }]), "completed");
});

test("the executable lifecycle schema governs both singular recording operations", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-harness-lifecycle-schema-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(HARNESS_LIFECYCLE_EVENT_SCHEMA.$id, "urn:bare-cedar-fog:harness-lifecycle-event:v1");
  const skill = recordSkillSelection({ root, turnId: "turn-1", skill: "maintain-codex-harness" });
  const provider = recordProviderCommission({ root, turnId: "turn-1", agent: "reviewer", task: "Review the skill." });
  assert.equal(assertHarnessLifecycleEvent(skill.event), skill.event);
  assert.equal(assertHarnessLifecycleEvent(provider.event), provider.event);
  assert.throws(() => assertHarnessLifecycleEvent({ ...skill.event, quality: "good" }), /unadmitted property: quality/u);
  assert.throws(() => assertHarnessLifecycleEvent({ ...provider.event, task: "" }), /task is not a conforming string/u);
});

test("this harness binds the shared lifecycle contract to its own actor without forking it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-harness-lifecycle-drift-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(CODEX_HARNESS_ACTOR, "actor:WWOM5azg-fTrn1Id0YVbz5AhppbnFny_W5Xl-rKgSs4");
  assert.ok(ADMITTED_HARNESS_ACTORS.includes(CODEX_HARNESS_ACTOR));
  assert.equal(HARNESS_LIFECYCLE_OBJECT_KIND, sharedLifecycle.HARNESS_LIFECYCLE_OBJECT_KIND);
  assert.equal(HARNESS_LIFECYCLE_EVENT_SCHEMA, sharedLifecycle.HARNESS_LIFECYCLE_EVENT_SCHEMA);
  assert.equal(assertHarnessLifecycleEvent, sharedLifecycle.assertHarnessLifecycleEvent);

  const skill = recordSkillSelection({ root, turnId: "turn-1", skill: "maintain-codex-harness", recordedAt: "2026-08-31T12:00:00.000Z" });
  const provider = recordProviderCommission({ root, turnId: "turn-1", agent: "node-programming", task: "Generalize the journal.", recordedAt: "2026-08-31T12:01:00.000Z" });
  assert.equal(skill.event.actor, CODEX_HARNESS_ACTOR);
  assert.equal(provider.event.actor, CODEX_HARNESS_ACTOR);
  assert.equal(skill.event.type, SKILL_SELECTED_EVENT_TYPE);
  assert.equal(provider.event.type, PROVIDER_COMMISSIONED_EVENT_TYPE);
  assert.equal(skill.objectKind, sharedLifecycle.HARNESS_LIFECYCLE_OBJECT_KIND);
  assert.equal(provider.objectKind, sharedLifecycle.HARNESS_LIFECYCLE_OBJECT_KIND);
  assert.equal(sharedLifecycle.assertHarnessLifecycleEvent(skill.event), skill.event);
  assert.equal(sharedLifecycle.assertHarnessLifecycleEvent(provider.event), provider.event);
});

test("inventory distinguishes authored sources, managed projections, deprecated duplicates, and attention evidence", (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-harness-inventory-"));
  const lifecycleRoot = mkdtempSync(join(tmpdir(), "codex-harness-inventory-events-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  t.after(() => rmSync(lifecycleRoot, { recursive: true, force: true }));
  for (const path of [
    ".claude/skills/current",
    ".claude/skills/source-only",
    ".claude/skills/drifted",
    ".agents/skills/current",
    ".agents/skills/drifted",
    ".agents/skills/observe/scripts",
    ".codex/skills/current",
    ".codex/agents",
    ".codex",
  ]) mkdirSync(join(repoRoot, path), { recursive: true });
  writeFileSync(join(repoRoot, ".claude/skills/current/SKILL.md"), "current\n");
  writeFileSync(join(repoRoot, ".agents/skills/current/SKILL.md"), "current\n");
  writeFileSync(join(repoRoot, ".claude/skills/source-only/SKILL.md"), "source\n");
  writeFileSync(join(repoRoot, ".claude/skills/drifted/SKILL.md"), "source\n");
  writeFileSync(join(repoRoot, ".agents/skills/drifted/SKILL.md"), "stale\n");
  writeFileSync(join(repoRoot, ".agents/skills/observe/SKILL.md"), "operation\n");
  writeFileSync(join(repoRoot, ".codex/skills/current/SKILL.md"), "duplicate\n");
  writeFileSync(join(repoRoot, ".codex/agents/managed-agent.toml"), "name = \"managed-agent\"\n");
  writeFileSync(join(repoRoot, ".codex/agents/local-agent.toml"), "name = \"local-agent\"\n");
  writeFileSync(join(repoRoot, ".codex/.codex-agent-manifest"), "managed-agent\nskill:current\nskill:drifted\nskill:observe\n");
  recordSkillSelection({ root: lifecycleRoot, turnId: "turn-1", skill: "current", recordedAt: "2026-08-31T12:00:00.000Z" });
  recordProviderCommission({ root: lifecycleRoot, turnId: "turn-1", agent: "managed-agent", task: "Review.", recordedAt: "2026-08-31T12:01:00.000Z" });

  const inventory = inventoryCodexHarness({ repoRoot, lifecycleRoot });
  const bySkill = Object.fromEntries(inventory.skills.map((skill) => [skill.name, skill]));
  assert.deepEqual(bySkill.current.findings, ["deprecated-parallel-runtime-projection"]);
  assert.ok(bySkill["source-only"].findings.includes("authored-source-not-currently-projected"));
  assert.ok(bySkill.drifted.findings.includes("runtime-projection-differs-from-authored-source"));
  assert.ok(bySkill.observe.findings.includes("granular-operation-exposed-as-root-skill"));
  assert.equal(bySkill.current.useCount, 1);
  assert.match(inventory.rule, /never deletion authority/u);
  const byAgent = Object.fromEntries(inventory.agents.map((agent) => [agent.name, agent]));
  assert.equal(byAgent["managed-agent"].useCount, 1);
  assert.ok(byAgent["local-agent"].findings.includes("unmanaged-runtime-extension"));
});
