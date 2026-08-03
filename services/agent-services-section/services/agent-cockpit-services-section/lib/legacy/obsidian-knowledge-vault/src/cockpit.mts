import { coreCapabilityBundle, type AgentCoreCapabilityBundle } from "@emsenn/organizing-with-agents/capabilities";
import {
  agentConnectorRegistration,
  mcpHttpSnippet,
  vscodeMcpHttpSnippet,
  type AgentConnectorRegistration,
} from "@emsenn/organizing-with-agents/connectors";

export type CockpitTool = Readonly<{
  name: string;
  command: string;
  purpose: string;
  writeCapable: boolean;
}>;

export type CockpitAgentPackage = Readonly<{
  packageName: string;
  surface: string;
  cockpitRole: string;
  executable?: string;
}>;

export type CockpitObsidianCommand = Readonly<{
  id: string;
  name: string;
  role: string;
  writesVaultNotes: boolean;
  writeCapable: boolean;
}>;

export type CockpitBenchmarkCapability = Readonly<{
  id: string;
  name: string;
  requirement: string;
  status: "present" | "partial" | "gap";
  evidence: readonly string[];
  next: string;
}>;

export type KnowledgeVaultCockpitManifest = Readonly<{
  kind: "obsidian-knowledge-vault.cockpit.manifest";
  appPackage: "@emsenn/app-obsidian-knowledge-vault";
  vaultRootDefault: "content";
  tools: readonly CockpitTool[];
  obsidianCommands: readonly CockpitObsidianCommand[];
  agentPackages: readonly CockpitAgentPackage[];
  connectors: readonly AgentConnectorRegistration[];
  coreCapabilities: AgentCoreCapabilityBundle;
  benchmark: readonly CockpitBenchmarkCapability[];
  governance: readonly string[];
}>;

export const cockpitTools: readonly CockpitTool[] = Object.freeze([
  { name: "Inspect root", command: "inspect-root", purpose: "Resolve observed and expected content-vault affordances.", writeCapable: false },
  { name: "Catalog", command: "catalog", purpose: "Project bounded memorystore facets for a region.", writeCapable: false },
  { name: "Find name", command: "find-name", purpose: "Search corpus paths by addressed names.", writeCapable: false },
  { name: "Grep text", command: "grep-text", purpose: "Search corpus resources by lexical evidence.", writeCapable: false },
  { name: "Read", command: "read", purpose: "Read a single corpus markdown document through the content codec.", writeCapable: false },
  { name: "Topic guidance", command: "topic-guidance", purpose: "Plan topic scaffolds and placement next actions.", writeCapable: false },
  { name: "Concept map", command: "concept-map", purpose: "Map related corpus resources and tags for a topic.", writeCapable: false },
  { name: "Measure gap", command: "measure-gap", purpose: "Measure topic coverage and legibility gaps.", writeCapable: false },
  { name: "Inspect health", command: "inspect-health", purpose: "Project frontmatter and conformance health.", writeCapable: false },
  { name: "Normalization plan", command: "normalization-plan", purpose: "Prepare dry-run document/frontmatter normalization.", writeCapable: false },
  { name: "Upload triage file", command: "upload-triage-file", purpose: "Prepare or write dated triage deposits.", writeCapable: true },
  { name: "Plan static site publication", command: "plan-static-site-publication", purpose: "Prepare a reviewable GitHub Pages style publish route for a downstream static site.", writeCapable: false },
]);

export const cockpitObsidianCommands: readonly CockpitObsidianCommand[] = Object.freeze([
  { id: "open-cockpit", name: "Open knowledge vault cockpit", role: "Mount the persistent side-panel cockpit.", writesVaultNotes: false, writeCapable: false },
  { id: "open-dashboard", name: "Open knowledge vault dashboard", role: "Write a dashboard note from root, health, and catalog evidence.", writesVaultNotes: true, writeCapable: false },
  { id: "write-cockpit-manifest", name: "Write cockpit manifest", role: "Fold tool, package, capability, and governance surfaces into a note.", writesVaultNotes: true, writeCapable: false },
  { id: "write-runtime-setup", name: "Write runtime setup note", role: "Write resolved runtime mode, paths, package-runner fallback, dispatch gates, and provider-key readiness.", writesVaultNotes: true, writeCapable: false },
  { id: "write-runtime-doctor", name: "Write runtime doctor note", role: "Probe Node/runtime/action dispatch from the Obsidian process and write stdout, stderr, cwd, PATH, and fix suggestions.", writesVaultNotes: true, writeCapable: false },
  { id: "write-cockpit-checkpoint", name: "Write cockpit checkpoint", role: "Fold the current cockpit state into an agent.session.checkpoint carrier and markdown trace note.", writesVaultNotes: true, writeCapable: false },
  { id: "write-cockpit-handoff", name: "Write cockpit handoff", role: "Checkpoint manifest, readiness, active note context, root/health evidence, and recent generated notes.", writesVaultNotes: true, writeCapable: false },
  { id: "write-cockpit-queue", name: "Write cockpit queue", role: "Group generated cockpit notes by kind/status and surface the review queue.", writesVaultNotes: true, writeCapable: false },
  { id: "open-cockpit-review-queue", name: "Open cockpit review queue", role: "Filter generated cockpit work and transition selected items to reviewed or settled.", writesVaultNotes: false, writeCapable: true },
  { id: "open-cockpit-quick-switcher", name: "Open cockpit quick switcher", role: "Fuzzy-open generated work, active note context, graph neighbors, arenas, and proposals from one palette.", writesVaultNotes: false, writeCapable: false },
  { id: "write-cockpit-audit", name: "Write cockpit capability audit", role: "Compare the cockpit against agentic Obsidian benchmark capabilities and name remaining gaps.", writesVaultNotes: true, writeCapable: false },
  { id: "write-connector-snippets", name: "Write connector snippets", role: "Write MCP/OpenAPI host registration snippets for external agent clients.", writesVaultNotes: true, writeCapable: false },
  { id: "plan-next-gen-emsenn-net-publication", name: "Plan next-gen emsenn.net publication", role: "Write the reviewable build, commit, push, and Pages artifact route for the staged emsenn.net site.", writesVaultNotes: true, writeCapable: false },
  { id: "run-tool-palette", name: "Run knowledge vault tool", role: "Expose any bounded content-vault action through Obsidian.", writesVaultNotes: true, writeCapable: false },
  { id: "search-content-vault", name: "Search content vault", role: "Run name and text search against the content vault and write results.", writesVaultNotes: true, writeCapable: false },
  { id: "build-active-note-context-pack", name: "Build active note context pack", role: "Bundle note markdown, graph facts, and corpus evidence for agent work.", writesVaultNotes: true, writeCapable: false },
  { id: "build-active-note-neighborhood", name: "Build active note neighborhood", role: "Rank local graph neighbors by outlinks, backlinks, shared tags, Canvas files, recency, and snippets.", writesVaultNotes: true, writeCapable: false },
  { id: "create-agent-mission-from-active-note", name: "Create agent mission from active note", role: "Turn selected or full note markdown into a governed agent mission.", writesVaultNotes: true, writeCapable: false },
  { id: "create-arena-from-active-note", name: "Create cockpit arena from active note", role: "Admit the active note or selection as a typed arena with evidence, readiness, route state, and next-move contract.", writesVaultNotes: true, writeCapable: false },
  { id: "advance-active-arena", name: "Advance active cockpit arena", role: "Run the ecosystem agent bridge over a cockpit arena and write one next-move settlement note.", writesVaultNotes: true, writeCapable: false },
  { id: "run-active-note-with-agent", name: "Run active note with ecosystem agent", role: "Run the ecosystem agent bridge over the active note and bounded evidence.", writesVaultNotes: true, writeCapable: false },
  { id: "propose-active-note-edit", name: "Propose active note edit", role: "Generate a proposal note before any active-note mutation.", writesVaultNotes: true, writeCapable: false },
  { id: "preview-active-note-edit-proposal-diff", name: "Preview active note edit proposal diff", role: "Write a line diff review note for an edit proposal before approval.", writesVaultNotes: true, writeCapable: false },
  { id: "apply-active-note-edit-proposal", name: "Apply active note edit proposal", role: "Apply an approved proposal when note edits are explicitly enabled.", writesVaultNotes: false, writeCapable: true },
  { id: "restore-active-note-from-edit-receipt", name: "Choose edit receipt to restore", role: "Choose an approved apply receipt and restore the previous content it recorded.", writesVaultNotes: false, writeCapable: true },
  { id: "prepare-active-note-triage-deposit", name: "Prepare active note triage deposit", role: "Prepare or write a content-vault triage deposit from the active note.", writesVaultNotes: true, writeCapable: true },
]);

export const cockpitAgentPackages: readonly CockpitAgentPackage[] = Object.freeze([
  {
    packageName: "@emsenn/organizing-with-agents",
    surface: "generic agent/session/review/connector substrate",
    cockpitRole: "workspace impact, session memory, findings, recall, session checkpoints, capability projections, connector registrations, context neighborhoods, proposal review, diffs, receipts",
  },
  {
    packageName: "@emsenn/organizing-with-llm-agents",
    surface: "LLM algebra and running substrate",
    cockpitRole: "conversation, inference, cost, run settlement, dreaming, host holography",
  },
  {
    packageName: "@emsenn/organizing-with-openai-agents",
    surface: "OpenAI-compatible provider runner",
    cockpitRole: "endpoint inventory and settled ecosystem agent runs",
    executable: "obsidian-knowledge-agent",
  },
  {
    packageName: "@emsenn/organizing-with-openai-codex",
    surface: "Codex harness/session projection",
    cockpitRole: "Codex trace, harness, and session memory compatibility",
    executable: "codex-session",
  },
  {
    packageName: "@emsenn/organizing-with-claude-code-cli",
    surface: "Claude Code CLI driver",
    cockpitRole: "Claude CLI execution, transcript projection, and session compatibility",
    executable: "claude-run",
  },
  {
    packageName: "@emsenn/organizing-with-vscode-agents",
    surface: "VS Code agent carrier surface",
    cockpitRole: "chat participant, language-model provider, tool, and MCP readiness projection",
  },
  {
    packageName: "@emsenn/organizing-with-ollama",
    surface: "local-first Ollama provider",
    cockpitRole: "local LLM endpoint option for private/offline vault work",
  },
  {
    packageName: "@emsenn/organizing-with-foundry",
    surface: "Microsoft Foundry provider",
    cockpitRole: "cloud/local Foundry model carrier and deployment-aware agent option",
  },
]);

export const cockpitBenchmarkCapabilities: readonly CockpitBenchmarkCapability[] = Object.freeze([
  {
    id: "bounded-vault-evidence",
    name: "Bounded vault evidence",
    requirement: "Retrieve, read, map, and measure vault evidence without handing the agent an untyped whole-vault scrape.",
    status: "present",
    evidence: Object.freeze(["catalog", "find-name", "grep-text", "read", "concept-map", "measure-gap"]),
    next: "Broaden ranking and preview ergonomics in the side panel.",
  },
  {
    id: "obsidian-graph-context",
    name: "Obsidian graph context",
    requirement: "Use active note path, selection/body, frontmatter, tags, outlinks, backlinks, unresolved links, Canvas files, and ranked local graph neighbors in agent context.",
    status: "present",
    evidence: Object.freeze(["@emsenn/organizing-with-agents/context", "canvas relation", "build-active-note-context-pack", "build-active-note-neighborhood", "open-cockpit-quick-switcher", "quick-switch graph neighbors", "run-active-note-with-agent", "create-arena-from-active-note"]),
    next: "Add graph-neighborhood pinning and exclusion controls.",
  },
  {
    id: "ecosystem-agent-routing",
    name: "Ecosystem agent routing",
    requirement: "Route inference through repo agent packages with endpoint/model/cost/run settlement compatibility.",
    status: "present",
    evidence: Object.freeze(["@emsenn/organizing-with-agents", "@emsenn/organizing-with-llm-agents", "@emsenn/organizing-with-openai-agents", "list-agent-endpoints", "agent endpoint/model settings", "agent API key env injection", "public npm runtime fallback"]),
    next: "Add direct adapters for local Ollama, Foundry, Codex, and Claude execution where their packages expose stable runners.",
  },
  {
    id: "governed-writes",
    name: "Governed writes",
    requirement: "Keep content mutations gated, proposal-first, and visible as reviewable notes.",
    status: "present",
    evidence: Object.freeze(["@emsenn/organizing-with-agents/review", "allowExternalWrites", "allowNoteEdits", "propose-active-note-edit", "preview-active-note-edit-proposal-diff", "approved: true", "apply-active-note-edit-proposal", "append-only agent-edit-apply-receipt", "rollbackApproved: true", "receipt chooser", "restore-active-note-from-edit-receipt", "prepare-active-note-triage-deposit", "review queue approve action"]),
    next: "Add linked approval receipts for queue transitions.",
  },
  {
    id: "arena-work-loop",
    name: "Arena work loop",
    requirement: "Admit a request into a typed work state, advance it one move, and preserve settlement evidence.",
    status: "present",
    evidence: Object.freeze(["create-arena-from-active-note", "advance-active-arena", "write-cockpit-queue"]),
    next: "Add arena status transitions and multi-step settlement history.",
  },
  {
    id: "review-queue",
    name: "Review queue",
    requirement: "Surface proposed/admitted agent work and recent generated artifacts for human review.",
    status: "present",
    evidence: Object.freeze(["write-cockpit-queue", "Agents/cockpit-queue.md", "open-cockpit-review-queue", "open-cockpit-quick-switcher", "side-panel Review", "side-panel Switch", "needs-review/proposals/arenas/receipts filters", "open source note", "approve proposal/receipt", "advance selected arena", "reviewed/settled status transitions"]),
    next: "Add linked approval receipts for queue transitions.",
  },
  {
    id: "handoff-trace",
    name: "Handoff trace",
    requirement: "Fold readiness, manifest, active context, evidence, generated artifact trails, and next moves into resumable checkpoint records.",
    status: "present",
    evidence: Object.freeze(["@emsenn/organizing-with-agents/session checkpoint carrier", "write-cockpit-checkpoint", "Agents/cockpit-checkpoint.md", "Carrier JSON", "write-cockpit-handoff", "Agents/cockpit-handoff.md"]),
    next: "Include run cost summaries when provider usage is present.",
  },
  {
    id: "command-and-panel-control",
    name: "Command and panel control",
    requirement: "Expose work through Obsidian command palette and a persistent cockpit side panel.",
    status: "present",
    evidence: Object.freeze(["open-cockpit", "open-dashboard", "write-runtime-setup", "side-panel runtime setup", "write-cockpit-checkpoint", "side-panel Checkpoint", "open-cockpit-quick-switcher", "side-panel Switch", "run-tool-palette", "search-content-vault"]),
    next: "Add command aliases for the highest-frequency cockpit moves.",
  },
  {
    id: "inline-chat-ux",
    name: "Inline chat UX",
    requirement: "Provide a polished live chat-style interaction loop with streaming tokens and retained conversation controls.",
    status: "present",
    evidence: Object.freeze(["side-panel prompt", "obsidian-knowledge-agent --stream", "OpenAI SSE token decoder", "conversation threading", "stop/retry controls", "chat transcript notes", "--conversation-json"]),
    next: "Add richer transcript metadata once provider usage arrives on streaming responses.",
  },
  {
    id: "external-tool-bridge",
    name: "External tool bridge",
    requirement: "Expose vault tools to outside agent hosts through a stable MCP/OpenAPI/server bridge.",
    status: "present",
    evidence: Object.freeze(["@emsenn/organizing-with-agents/connectors", "obsidian-knowledge-vault CLI", "obsidian-knowledge-cockpit CLI", "obsidian-knowledge-vault-serve", "GET /openapi.json", "POST /mcp", "GET /cockpit", "GET /benchmark", "GET /connectors", "write-connector-snippets"]),
    next: "Add one-click installer scripts for host-specific config files after human confirmation.",
  },
  {
    id: "installable-plugin",
    name: "Installable Obsidian plugin",
    requirement: "Produce release-ready Obsidian plugin artifacts for manual install, BRAT-style installs, and later community-plugin submission.",
    status: "present",
    evidence: Object.freeze(["plugin/manifest.json", "plugin/styles.css", "versions.json", "pnpm run package:plugin", "dist/obsidian-plugin/knowledge-vault", "knowledge-vault-<version>.zip", "runtimePackage setting", "write-runtime-setup", "npx -p @emsenn/app-obsidian-knowledge-vault fallback"]),
    next: "Mirror or publish this app from a plugin-root repository for official community plugin submission.",
  },
]);

export const cockpitConnectors: readonly AgentConnectorRegistration[] = Object.freeze([
  knowledgeVaultConnectorRegistration(),
]);

export function knowledgeVaultConnectorRegistration(input: Readonly<{
  name?: string;
  baseUrl?: string;
  command?: string;
  path?: string;
  port?: number;
}> = {}): AgentConnectorRegistration {
  const name = input.name ?? "obsidian-knowledge-vault";
  const port = input.port ?? 8790;
  const baseUrl = (input.baseUrl ?? `http://127.0.0.1:${port}`).replace(/\/+$/u, "");
  const command = input.command ?? "obsidian-knowledge-vault-serve";
  const corpusPath = input.path ?? "content";
  const endpoints = Object.freeze({
    baseUrl,
    mcp: `${baseUrl}/mcp`,
    openapi: `${baseUrl}/openapi.json`,
    health: `${baseUrl}/health`,
    cockpit: `${baseUrl}/cockpit`,
    benchmark: `${baseUrl}/benchmark`,
  });
  const serverCommand = `${command} --path ${corpusPath} --port ${port}`;
  return agentConnectorRegistration({
    id: name,
    title: "Obsidian knowledge vault MCP/OpenAPI bridge",
    packageName: "@emsenn/app-obsidian-knowledge-vault",
    transport: "hybrid",
    command,
    args: Object.freeze(["--path", corpusPath, "--port", String(port)]),
    env: Object.freeze({}),
    endpoints,
    snippets: Object.freeze([
      {
        host: "561 .mcp.json / Claude-compatible MCP clients",
        path: ".mcp.json",
        format: "json",
        body: mcpHttpSnippet({ name, url: endpoints.mcp }),
      },
      {
        host: "VS Code MCP",
        path: ".vscode/mcp.json",
        format: "json",
        body: vscodeMcpHttpSnippet({ name, url: endpoints.mcp }),
      },
      {
        host: "Shell",
        path: "terminal",
        format: "shell",
        body: serverCommand,
      },
      {
        host: "OpenAPI",
        path: "openapi.json",
        format: "markdown",
        body: `Open ${endpoints.openapi} after starting \`${serverCommand}\`.`,
      },
    ]),
  });
}

export function knowledgeVaultCockpitManifest(): KnowledgeVaultCockpitManifest {
  return Object.freeze({
    kind: "obsidian-knowledge-vault.cockpit.manifest",
    appPackage: "@emsenn/app-obsidian-knowledge-vault",
    vaultRootDefault: "content",
    tools: cockpitTools,
    obsidianCommands: cockpitObsidianCommands,
    agentPackages: cockpitAgentPackages,
    connectors: cockpitConnectors,
    coreCapabilities: coreCapabilityBundle({
      provider: "obsidian-knowledge-vault",
      surface: "Obsidian cockpit over content-vault tools and 561 agent packages",
    }),
    benchmark: cockpitBenchmarkCapabilities,
    governance: Object.freeze([
      "Read bounded corpus evidence before writing.",
      "Expose dry-run mutation proposals as notes before enabling external writes.",
      "Keep generated context packs, missions, and runs as ordinary markdown evidence.",
      "Route inference through ecosystem agent packages so endpoint, cost, run, and handoff projections remain compatible.",
    ]),
  });
}

export function renderCockpitManifestMarkdown(manifest: KnowledgeVaultCockpitManifest = knowledgeVaultCockpitManifest()): string {
  return [
    "# Knowledge vault cockpit manifest",
    "",
    `App package: \`${manifest.appPackage}\``,
    `Default vault root: \`${manifest.vaultRootDefault}\``,
    "",
    "## Tools",
    "",
    ...manifest.tools.map((tool) => `- \`${tool.command}\` - ${tool.purpose}${tool.writeCapable ? " (write-capable)" : ""}`),
    "",
    "## Obsidian commands",
    "",
    ...manifest.obsidianCommands.map((command) => `- \`${command.id}\` - ${command.role}${command.writeCapable ? " (write-capable)" : ""}`),
    "",
    "## Agent packages",
    "",
    ...manifest.agentPackages.map((pkg) => `- \`${pkg.packageName}\` - ${pkg.surface}; ${pkg.cockpitRole}${pkg.executable === undefined ? "" : `; executable \`${pkg.executable}\``}`),
    "",
    "## Connectors",
    "",
    ...manifest.connectors.flatMap((connector) => [
      `- \`${connector.id}\` - ${connector.title}; command \`${connector.command} ${connector.args.join(" ")}\`; MCP \`${connector.endpoints.mcp}\`; OpenAPI \`${connector.endpoints.openapi}\``,
      ...connector.snippets.map((snippet) => `  - ${snippet.host} (${snippet.path}, ${snippet.format})`),
    ]),
    "",
    "## Core capability spine",
    "",
    ...manifest.coreCapabilities.projections.map((projection) => `- \`${projection.library}\` via \`${projection.packageName}\`: ${projection.providerUse}`),
    "",
    "## Benchmark",
    "",
    ...manifest.benchmark.map((item) => `- \`${item.id}\` (${item.status}) - ${item.requirement} Evidence: ${item.evidence.join(", ")} Next: ${item.next}`),
    "",
    "## Governance",
    "",
    ...manifest.governance.map((rule) => `- ${rule}`),
    "",
  ].join("\n");
}
