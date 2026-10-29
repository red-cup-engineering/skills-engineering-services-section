/**
 * @emsenn/organizing-with-claude-code-in-vs-code
 *
 * The Claude Code specialization of the generic VS Code agent cockpit. The
 * benchmark, adapters, habitat, cockpit carrier, readiness framework, and
 * extension manifest all live in @emsenn/organizing-with-vscode-agents; this
 * package binds them to Claude Code: claude-code-cli session re-exports, the
 * Claude cockpit defaults, the Claude harness adapter, and the Claude readiness
 * observers (workspace visibility, upstream build, `.claude/` config, MCP/LSP).
 */
import {
  vsCodeAgentCockpit,
  evaluateCockpitReadiness as evaluateGenericCockpitReadiness,
  workspaceVisibleObserver,
  mcpConfiguredObserver,
  readText,
  fileExists,
  type CockpitCommand,
  type CockpitReadinessCheck,
  type CockpitReadinessObservers,
  type CockpitReadinessObservation,
  type CockpitReadinessReport,
  type VsCodeAgentCockpit,
} from "@emsenn/organizing-with-vscode-agents";

// Re-export the generic VS Code agent cockpit surface so this package is a
// complete cockpit boundary, symmetric with organizing-with-openai-codex-in-vs-code.
export {
  currentVsCodeHarnessBenchmark,
  harnessBenchmarkSources,
  evaluateHarness,
  defaultAgentHarnessAdapters,
  agentHarnessAdapter,
  claudeCodeHarnessAdapter,
  claudeCapabilitySet,
  defaultAgenticCockpitHabitat,
  defaultAgentHabitatFacets,
  defaultAgentHabitatQuests,
  vsCodeAgentCockpit,
  defaultCockpitPanels,
  defaultCockpitAttachments,
  vscodeHarnessContributionManifest,
} from "@emsenn/organizing-with-vscode-agents";
export type {
  HarnessCapability,
  HarnessCapabilityId,
  HarnessCapabilityKind,
  HarnessCapabilityLevel,
  HarnessEvaluation,
  AgentHarnessAdapter,
  AgentHarnessKind,
  AgentHarnessTransport,
  AgenticCockpitHabitat,
  AgentHabitatFacet,
  AgentHabitatQuest,
  CockpitPanel,
  CockpitPanelId,
  CockpitCommand,
  CockpitAttachment,
  CockpitAttachmentKind,
  CockpitReadinessCheck,
  CockpitReadinessReport,
  CockpitReadinessEvaluation,
  CockpitReadinessStatus,
  VsCodeAgentCockpit,
  VsCodeHarnessContributionManifest,
  VsCodeCommandContribution,
  VsCodeChatParticipantContribution,
  VsCodeLanguageModelToolContribution,
} from "@emsenn/organizing-with-vscode-agents";

// Claude Code CLI session computation surface.
export {
  findRepoRoot,
  loadWorkspace,
  computeImpact,
  suggestCommands,
  recall,
  recallStatus,
} from "@emsenn/organizing-with-claude-code-cli/session";
export type {
  Workspace,
  WsPackage,
  ImpactPackage,
  ChangeImpact,
  Finding,
} from "@emsenn/organizing-with-claude-code-cli/session";
export * as claudeCode from "@emsenn/organizing-with-claude-code-cli";

/** The Claude Code cockpit is a {@link VsCodeAgentCockpit} specialized to Claude Code. */
export type ClaudeCodeInVsCodeCockpit = VsCodeAgentCockpit;
export type ClaudeCodeInVsCodeCockpitInput = Readonly<{
  subject?: string;
  commands?: readonly CockpitCommand[];
  readinessChecks?: readonly CockpitReadinessCheck[];
}>;

export const defaultCockpitCommands: readonly CockpitCommand[] = Object.freeze([
  {
    name: "read-workspace",
    route: "/api/workspace",
    packageName: "@emsenn/organizing-with-claude-code-cli",
    summary: "Load the workspace package mesh through the Claude Code session substrate.",
    readOnly: true,
    writesWorkspace: false,
  },
  {
    name: "read-readiness",
    route: "/api/readiness",
    packageName: "@emsenn/organizing-with-claude-code-in-vs-code",
    summary: "Evaluate cockpit readiness checks against the current workspace files.",
    readOnly: true,
    writesWorkspace: false,
  },
  {
    name: "read-claude-topology",
    route: "/api/claude-topology",
    packageName: "@emsenn/organizing-with-claude",
    summary: "Read the Claude / Claude Code CLI harness topology: hooks, MCP wiring, context injection, and settings projection.",
    readOnly: true,
    writesWorkspace: false,
  },
  {
    name: "read-endeavor-enactment",
    route: "/api/endeavor-enactment",
    packageName: "@emsenn/animating",
    summary: "Read the animating work-tracking projection of endeavors, swarms, goals, assignments, governance, and next interfaces.",
    readOnly: true,
    writesWorkspace: false,
  },
  {
    name: "read-opinions",
    route: "/api/opinions",
    packageName: "@emsenn/561-group-operations-manifold",
    summary: "Read the Operations Manifold opinion fiber of operator guidance, constraints, desires, feedback, and intuitions.",
    readOnly: true,
    writesWorkspace: false,
  },
  {
    name: "read-animating-actions",
    route: "/api/animating-actions",
    packageName: "@emsenn/animating",
    summary: "Read the induced @emsenn/animating action discovery surface for agent-operable verbs, resources, prompts, and utterances.",
    readOnly: true,
    writesWorkspace: false,
  },
  {
    name: "read-faculty-actions",
    route: "/api/faculty-actions",
    packageName: "@emsenn/dev.bare-cedar-fog.emsenn.net",
    summary: "Read the lightweight index of faculty action discovery surfaces before fetching full package schemas and utterances.",
    readOnly: true,
    writesWorkspace: false,
  },
  {
    name: "read-cockpit",
    route: "/api/cockpit",
    packageName: "@emsenn/organizing-with-claude-code-in-vs-code",
    summary: "Read the VS Code cockpit composition as a stable JSON carrier.",
    readOnly: true,
    writesWorkspace: false,
  },
  {
    name: "compute-impact",
    route: "/api/impact",
    packageName: "@emsenn/organizing-with-claude-code-cli",
    summary: "Compute package and command impact for the current worktree.",
    readOnly: true,
    writesWorkspace: false,
  },
  {
    name: "prepare-handoff",
    route: "/handoff",
    packageName: "@emsenn/organizing-with-claude-code-cli",
    summary: "Project session findings and verification into a next-session handoff.",
    readOnly: true,
    writesWorkspace: false,
  },
]);

export const defaultCockpitReadinessChecks: readonly CockpitReadinessCheck[] = Object.freeze([
  {
    id: "workspace-visible",
    label: "Workspace package graph is visible",
    required: true,
    evidence: "pnpm-workspace.yaml includes this package and the Claude Code CLI package.",
  },
  {
    id: "claude-upstream-built",
    label: "Claude Code CLI upstream package builds",
    required: true,
    evidence: "@emsenn/organizing-with-claude-code-cli exports session, harness, exec, and transcript surfaces.",
  },
  {
    id: "mcp-configured",
    label: "MCP and LSP bridge files are present",
    required: true,
    evidence: ".mcp.json, .lsp-mcp.json, and .vscode/mcp.json are cockpit attachments.",
  },
  {
    id: "claude-config-present",
    label: "Claude Code harness configuration is present",
    required: true,
    evidence: ".claude/settings.json and the workspace .mcp.json drive the Claude Code session harness.",
  },
]);

export function claudeCodeInVsCodeCockpit(
  input: ClaudeCodeInVsCodeCockpitInput = {},
): ClaudeCodeInVsCodeCockpit {
  return vsCodeAgentCockpit({
    subject: input.subject ?? "dev.bare-cedar-fog.emsenn.net/claude-code-in-vs-code",
    provider: "claude",
    upstreamPackage: "@emsenn/organizing-with-claude-code-cli",
    commands: input.commands ?? defaultCockpitCommands,
    readinessChecks: input.readinessChecks ?? defaultCockpitReadinessChecks,
  });
}

export const defaultClaudeCodeInVsCodeCockpit = claudeCodeInVsCodeCockpit();

function observeClaudeUpstream(root: string): CockpitReadinessObservation {
  const packageJson = readText(root, "lib/organizing-with-claude-code-cli/package.json");
  const observed: string[] = [];
  const missing: string[] = [];
  if (packageJson === null) {
    missing.push("lib/organizing-with-claude-code-cli/package.json");
  } else {
    observed.push("lib/organizing-with-claude-code-cli/package.json");
    for (const exportedSurface of ["./session", "./harness", "./exec", "./transcripts"]) {
      if (packageJson.includes(`"${exportedSurface}"`)) observed.push(`export: ${exportedSurface}`);
      else missing.push(`export: ${exportedSurface}`);
    }
  }
  for (const sourcePath of [
    "lib/organizing-with-claude-code-cli/src/session/index.mts",
    "lib/organizing-with-claude-code-cli/src/harness.mts",
    "lib/organizing-with-claude-code-cli/src/exec.mts",
  ]) {
    if (fileExists(root, sourcePath)) observed.push(sourcePath);
    else missing.push(sourcePath);
  }
  return Object.freeze({ observed: Object.freeze(observed), missing: Object.freeze(missing) });
}

function observeClaudeConfig(root: string): CockpitReadinessObservation {
  const observed: string[] = [];
  const missing: string[] = [];
  if (fileExists(root, ".claude/settings.json")) observed.push(".claude/settings.json");
  else missing.push(".claude/settings.json");
  if (fileExists(root, ".claude")) observed.push(".claude/");
  else missing.push(".claude/");
  if (fileExists(root, ".mcp.json")) observed.push(".mcp.json");
  else missing.push(".mcp.json");
  return Object.freeze({ observed: Object.freeze(observed), missing: Object.freeze(missing) });
}

export const claudeCockpitReadinessObservers: CockpitReadinessObservers = Object.freeze({
  "workspace-visible": workspaceVisibleObserver([
    "sites/dev.bare-cedar-fog.emsenn.net",
    "lib/organizing-with-claude-code-in-vs-code",
    "lib/organizing-with-claude-code-cli",
  ]),
  "claude-upstream-built": observeClaudeUpstream,
  "mcp-configured": mcpConfiguredObserver(),
  "claude-config-present": observeClaudeConfig,
});

/** Evaluate the Claude Code cockpit's readiness using the Claude observers. */
export function evaluateCockpitReadiness(
  options: Readonly<{ root: string; cockpit: ClaudeCodeInVsCodeCockpit }>,
): CockpitReadinessReport {
  return evaluateGenericCockpitReadiness({
    root: options.root,
    cockpit: options.cockpit,
    observers: claudeCockpitReadinessObservers,
  });
}
