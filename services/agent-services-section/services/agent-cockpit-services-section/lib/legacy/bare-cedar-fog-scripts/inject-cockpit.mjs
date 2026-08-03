#!/usr/bin/env node
/**
 * Codex hook adapter for dev.bare-cedar-fog.emsenn.net's agent cockpit.
 *
 * This is for the agent, not the human-facing static page. On SessionStart and
 * UserPromptSubmit it injects a compact cockpit capsule into Codex context:
 * habitat facets, quests, adapter standing, hook surface, and first moves.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { agentOrientation, orientationDigest, recordDevEvent } from "./dev-runtime.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(MODULE_PATH), "../../..");

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function hookPayloadFromText(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return trimmed === "" ? {} : { text };
}

function stringField(payload, key) {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function hookEventName(payload) {
  return stringField(payload, "hook_event_name") ?? "HookEvent";
}

function hookSessionId(payload) {
  return stringField(payload, "session_id") ?? stringField(payload, "session") ?? "unknown-session";
}

function hookPromptText(payload) {
  for (const key of ["prompt", "user_prompt", "message", "text"]) {
    const value = stringField(payload, key);
    if (value !== null) return value;
  }
  return null;
}

async function loadCockpitData() {
  const module = await import("@emsenn/organizing-with-openai-codex-in-vs-code");
  return {
    cockpit: module.defaultCodexInVsCodeCockpit,
    habitat: module.defaultAgenticCockpitHabitat,
    benchmark: module.currentVsCodeHarnessBenchmark,
    adapters: module.defaultAgentHarnessAdapters,
  };
}

async function hooksSummary() {
  try {
    const parsed = JSON.parse(await readFile(path.join(REPO_ROOT, ".codex/hooks.json"), "utf8"));
    const hooks = parsed?.hooks;
    if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) return [];
    return Object.entries(hooks).map(([event, groups]) => {
      const count = Array.isArray(groups)
        ? groups.reduce((sum, group) => sum + (Array.isArray(group?.hooks) ? group.hooks.length : 0), 0)
        : 0;
      return `${event}:${count}`;
    });
  } catch {
    return [];
  }
}

function requiredCapabilityLine(benchmark) {
  const required = benchmark.filter((capability) => capability.level === "required");
  return required.map((capability) => capability.id).join(", ");
}

function adapterLines(adapters) {
  return adapters.map((adapter) => {
    const evaln = adapter.evaluation;
    return `- ${adapter.displayName}: ${evaln.status}; required ${evaln.required.covered}/${evaln.required.total}, expected ${evaln.expected.covered}/${evaln.expected.total}, differentiators ${evaln.differentiators.covered}/${evaln.differentiators.total}`;
  });
}

function panelLines(cockpit) {
  return cockpit.panels.map((panel) => `- ${panel.title}: ${panel.purpose}`);
}

function questLines(habitat) {
  return habitat.quests.map((quest) => `- ${quest.title}: ${quest.trigger} Reward: ${quest.reward}.`);
}

function facetLines(habitat) {
  return habitat.facets.slice(0, 8).map((facet) => `- ${facet.title}: ${facet.designConsequence}`);
}

async function cockpitContextText(payload) {
  const prompt = hookPromptText(payload);
  const hookEvents = await hooksSummary();
  const { cockpit, habitat, benchmark, adapters } = await loadCockpitData();
  await recordDevEvent("dev.bare-cedar-fog.emsenn.net.inject-cockpit", payload, {
    injection: "cockpit-context",
    promptObserved: prompt !== null,
  });
  const archiveScanLimit = Number.parseInt(process.env.EMSENN_DEV_INJECT_ARCHIVE_SCAN_LIMIT ?? "0", 10);
  const orientation = await agentOrientation(payload, {
    archiveLimit: 6,
    archiveScanLimit: Number.isFinite(archiveScanLimit) ? archiveScanLimit : 0,
  });
  return [
    "# dev.bare-cedar-fog.emsenn.net cockpit - injected agent context",
    "",
    "This context is for Codex's own cockpit into the repo. The browser page is only a projection; the operating surface is hooks, context injection, MCP/LSP reachability, readiness, trace folding, checkpoints, and handoff.",
    "",
    `- hook event: ${hookEventName(payload)}`,
    `- session: ${hookSessionId(payload)}`,
    `- prompt observed: ${prompt === null ? "no" : "yes"}`,
    `- cockpit carrier: ${cockpit.kind}`,
    `- habitat: ${habitat.title}`,
    `- hook surface: ${hookEvents.length === 0 ? "not readable" : hookEvents.join(", ")}`,
    "",
    "## First Moves",
    "- Suit up before acting: read durable instructions, workspace/package graph, MCP/LSP reachability, current file focus, and active work.",
    "- Enter the arena: translate the request into request -> inspect existing capabilities -> choose existing carrier -> mount projection.",
    "- Earn writes: use dispatch readiness, package impact, approval policy, and checkpoints before material edits.",
    "- Fold the trace: leave findings, verification, costs, and handoff in machine-readable form.",
    "",
    "## Required Harness Capabilities",
    requiredCapabilityLine(benchmark),
    "",
    "## Cockpit Panels",
    ...panelLines(cockpit),
    "",
    "## Habitat Facets",
    ...facetLines(habitat),
    "",
    "## Quests",
    ...questLines(habitat),
    "",
    "## Adapter Standing",
    ...adapterLines(adapters),
    "",
    "## Your Live Orientation",
    orientationDigest(orientation),
    "",
    "If a package, hook, MCP server, or ops script already exists, use or extend it. Do not make a decorative UI when the agent cockpit needs an actuator.",
  ].join("\n");
}

async function main() {
  try {
    const payload = hookPayloadFromText(await readStdin());
    const additionalContext = await cockpitContextText(payload);
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: hookEventName(payload),
        additionalContext,
      },
    })}\n`);
  } catch {
    process.exit(0);
  }
}

await main();
