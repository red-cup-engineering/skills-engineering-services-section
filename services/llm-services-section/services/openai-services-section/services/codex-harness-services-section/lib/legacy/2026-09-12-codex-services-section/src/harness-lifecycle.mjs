import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  openHarnessLifecycleJournal,
  PROVIDER_COMMISSIONED_CATEGORY,
  recordProviderCommission as recordHarnessProviderCommissionEvent,
  recordSkillSelection as recordHarnessSkillSelectionEvent,
  recordCoordinationCommission as recordHarnessCoordinationCommission,
  acknowledgeCoordination as acknowledgeHarnessCoordination,
  completeCoordination as completeHarnessCoordination,
  refuseCoordination as refuseHarnessCoordination,
  SKILL_SELECTED_CATEGORY,
  summarizeHarnessLifecycle as summarizeSharedHarnessLifecycle,
} from "@red-cup-engineering/harness-lifecycle-journal-service";

export {
  ADMITTED_HARNESS_ACTORS,
  assertHarnessLifecycleEvent,
  HARNESS_LIFECYCLE_EVENT_SCHEMA,
  HARNESS_LIFECYCLE_OBJECT_KIND,
  PROVIDER_COMMISSIONED_EVENT_TYPE,
  SKILL_SELECTED_EVENT_TYPE,
} from "@red-cup-engineering/harness-lifecycle-journal-service";

export const CODEX_HARNESS_ACTOR = "actor:WWOM5azg-fTrn1Id0YVbz5AhppbnFny_W5Xl-rKgSs4";
export const OPS_HARNESS_EVENT_CONTRACT = Object.freeze({
  type: "ops.561.group/codex-harness-attention-event",
  version: 1,
  disposition: "local-adapter-only",
});

export function recordSkillSelection({ root, turnId, skill, recordedAt }) {
  return recordHarnessSkillSelectionEvent({ root, actor: CODEX_HARNESS_ACTOR, turnId, skill, recordedAt });
}

export function recordProviderCommission({ root, turnId, agent, task, recordedAt }) {
  return recordHarnessProviderCommissionEvent({ root, actor: CODEX_HARNESS_ACTOR, turnId, agent, task, recordedAt });
}

/** Imperative Codex binding of the shared, content-addressed coordination envelope. */
export function recordCoordinationCommission({ root, turnId, receiverActor, capability, channel, workClass, allocationBasisPoints, inputRefs, route, receiverCondition, recordedAt }) {
  return recordHarnessCoordinationCommission({ root, actor: CODEX_HARNESS_ACTOR, turnId, receiverActor, capability, channel, workClass, allocationBasisPoints, inputRefs, route, receiverCondition, recordedAt });
}

export function acknowledgeCoordination({ root, turnId, coordination, recordedAt }) {
  return acknowledgeHarnessCoordination({ root, actor: CODEX_HARNESS_ACTOR, turnId, coordination, recordedAt });
}

export function completeCoordination({ root, turnId, coordination, resultRefs, recordedAt }) {
  return completeHarnessCoordination({ root, actor: CODEX_HARNESS_ACTOR, turnId, coordination, resultRefs, recordedAt });
}

export function refuseCoordination({ root, turnId, coordination, refusal, recordedAt }) {
  return refuseHarnessCoordination({ root, actor: CODEX_HARNESS_ACTOR, turnId, coordination, refusal, recordedAt });
}

export function summarizeHarnessLifecycle({ root }) {
  return summarizeSharedHarnessLifecycle({ root });
}

export function projectOpsHarnessAttentionEvents({ root }) {
  const lifecycle = openHarnessLifecycleJournal({ root });
  const events = [
    ...lifecycle.query({ category: SKILL_SELECTED_CATEGORY }),
    ...lifecycle.query({ category: PROVIDER_COMMISSIONED_CATEGORY }),
  ].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  return Object.freeze(events.map(({ id, recordedAt, record }) => Object.freeze({
    contract: OPS_HARNESS_EVENT_CONTRACT,
    source: "bare-cedar-fog-codex",
    sourceEvent: id,
    observedAt: recordedAt,
    event: record,
  })));
}

function directoryNames(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function fileNames(path, suffix) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(suffix)).map((entry) => entry.name.slice(0, -suffix.length)).sort();
}

function managedProjectionNames(repoRoot) {
  const path = join(repoRoot, ".codex/.codex-agent-manifest");
  if (!existsSync(path)) return { skills: new Set(), agents: new Set() };
  const lines = readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean);
  return {
    skills: new Set(lines.filter((line) => line.startsWith("skill:")).map((line) => line.slice(6))),
    agents: new Set(lines.filter((line) => !line.startsWith("skill:") && !line.includes(":"))),
  };
}

function sameBytes(left, right) {
  return existsSync(left) && existsSync(right) && readFileSync(left).equals(readFileSync(right));
}

export function inventoryCodexHarness({ repoRoot, lifecycleRoot }) {
  const root = resolve(repoRoot), authoredRoot = join(root, ".claude/skills"), runtimeRoot = join(root, ".agents/skills"), deprecatedRoot = join(root, ".codex/skills");
  const authored = new Set(directoryNames(authoredRoot)), runtime = new Set(directoryNames(runtimeRoot)), deprecated = new Set(directoryNames(deprecatedRoot));
  const managed = managedProjectionNames(root), usage = summarizeHarnessLifecycle({ root: lifecycleRoot });
  const skillUse = new Map(usage.selectedSkills.map(({ name, count }) => [name, count]));
  const skillNames = [...new Set([...authored, ...runtime, ...deprecated])].sort();
  const skills = skillNames.map((name) => {
    const inSource = authored.has(name), inRuntime = runtime.has(name), inDeprecatedRuntime = deprecated.has(name);
    const sourceSkill = join(authoredRoot, name, "SKILL.md"), runtimeSkill = join(runtimeRoot, name, "SKILL.md");
    const sourceDrift = inSource && inRuntime && !sameBytes(sourceSkill, runtimeSkill);
    const operationExposure = inRuntime && !inSource && existsSync(join(runtimeRoot, name, "scripts"));
    const findings = [
      ...(inDeprecatedRuntime ? ["deprecated-parallel-runtime-projection"] : []),
      ...(inSource && !inRuntime ? ["authored-source-not-currently-projected"] : []),
      ...(sourceDrift ? ["runtime-projection-differs-from-authored-source"] : []),
      ...(operationExposure ? ["granular-operation-exposed-as-root-skill"] : []),
      ...(!inSource && inRuntime && !managed.skills.has(name) ? ["unmanaged-runtime-extension"] : []),
      ...((skillUse.get(name) ?? 0) === 0 ? ["no-local-usage-evidence"] : []),
    ];
    const disposition = inDeprecatedRuntime
      ? "retire-after-source-and-consumer-check"
      : sourceDrift || (inSource && !inRuntime)
        ? "regenerate-from-authored-source"
        : operationExposure
          ? "consolidate-or-keep-as-explicit-operation"
          : "keep-pending-evidence";
    return Object.freeze({ name, authored: inSource, runtime: inRuntime, deprecatedRuntime: inDeprecatedRuntime, managed: managed.skills.has(name), useCount: skillUse.get(name) ?? 0, findings: Object.freeze(findings), disposition });
  });
  const providerUse = new Map(usage.commissionedProviders.map(({ name, count }) => [name, count]));
  const agents = fileNames(join(root, ".codex/agents"), ".toml").map((name) => Object.freeze({
    name,
    managed: managed.agents.has(name),
    useCount: providerUse.get(name) ?? 0,
    findings: Object.freeze([
      ...(!managed.agents.has(name) ? ["unmanaged-runtime-extension"] : []),
      ...((providerUse.get(name) ?? 0) === 0 ? ["no-local-usage-evidence"] : []),
    ]),
    disposition: managed.agents.has(name) ? "keep-pending-evidence" : "keep-or-consolidate-after-owner-review",
  }));
  return Object.freeze({
    type: "bare-cedar-fog.codex-harness-inventory.v1",
    rule: "Age, count, and non-use are review signals, never deletion authority.",
    skills: Object.freeze(skills),
    agents: Object.freeze(agents),
    attention: usage,
  });
}
