/**
 * claude-code-cli-harness-topology — the Claude Code CLI harness as a settled
 * meme-topology carrier. The floor of the diamond: downstream of BOTH middles.
 *
 *   agent-topology                              (apex)
 *     ├── agent-harness-topology   (agent + content: equips an agent with channels)
 *     └── claude-code-topology     (agent + claude-models: embodies an agent on a model)
 *           └── claude-code-cli-harness-topology   (⊂ both — this node)
 *
 * The name spells its lineage: it *is* an agent-harness (it equips an agent and
 * speaks channels) AND it *is* claude-code's (it embodies an agent running a
 * claude model). Every word — including "cli" and "harness" — is load-bearing.
 *
 * What this floor adds over the two middles is the concrete CLI's *slots*:
 * mcp-server, skill, command, subagent, hook, setting. The single load-bearing
 * edge is `mcp-server --points-at--> hub`, where the hub is 561 Group Operations Manifold: that edge is
 * the topological statement of the standing law that every tool and read routes
 * You↔MCP↔561 Group Operations Manifold. The harness "speaks MCP" to *discover* the hub; it does not
 * hardcode it, so `pointsAt` is a coordinate, settled, not a constant.
 *
 * Pure: coordinates admit onto the meme floor as utterances; settlement is
 * `induceClaudeCodeCliHarnessTopology`.
 */
import {
  action,
  carrierFrom,
  mark,
  tm,
  utterance,
  type UtteranceCarrier,
  type MemeTopologyFixedPointReadings,
  type SettlementFiltration,
} from "@emsenn/relating";
import { settleUtterances, fixedPointReadingsOfUtterances } from "../../../topology-settling.mjs";
import { harness, harnessTerm } from "@emsenn/organizing-with-llm-agents/harness";
import { claudeCode, claudeCodeTerm } from "../index.mjs";

export type { UtteranceCarrier };

/** The default hub a discovered mcp-server points at. */
export const OPERATIONS_MANIFOLD_HUB = "operations-manifold";

// ---------- term constructors ----------

/**
 * The term for a CLI harness node: prefixes the id with
 * "claude-code-cli-harness.".
 */
export function cliHarnessTerm(id: string): string {
  return `claude-code-cli-harness.${id}`;
}
/** The term for an mcp-server slot node: prefixes the id with "mcp-server.". */
export function mcpServerTerm(id: string): string {
  return `mcp-server.${id}`;
}
/** The term for a skill slot node: prefixes the id with "skill.". */
export function skillTerm(id: string): string {
  return `skill.${id}`;
}
/** The term for a command slot node: prefixes the id with "command.". */
export function commandTerm(id: string): string {
  return `command.${id}`;
}
/** The term for a subagent slot node: prefixes the id with "subagent.". */
export function subagentTerm(id: string): string {
  return `subagent.${id}`;
}
/** The term for a hook slot node: prefixes the id with "hook.". */
export function hookTerm(id: string): string {
  return `hook.${id}`;
}
/** The term for a setting slot node: prefixes the id with "setting.". */
export function settingTerm(id: string): string {
  return `setting.${id}`;
}
/** The term for a hub node: prefixes the id with "hub.". */
export function hubTerm(id: string): string {
  return `hub.${id}`;
}

// ---------- predicate constructors ----------

/** floor --is-harness--> harness : the ⊂ edge to agent-harness-topology. */
export function isHarnessPredicate(): string {
  return "claude-code-cli-harness.is-harness";
}
/** floor --is-claude-code--> claude-code : the ⊂ edge to claude-code-topology. */
export function isClaudeCodePredicate(): string {
  return "claude-code-cli-harness.is-claude-code";
}
/** floor --has-mcp-server--> mcp-server : a CLI MCP server slot. */
export function hasMcpServerPredicate(): string {
  return "harness.has-mcp-server";
}
/** mcp-server --points-at--> hub : the hub the server discovers (561 Group Operations Manifold). The
 *  one edge that makes You↔MCP↔561 Group Operations Manifold a settled fact. */
export function pointsAtPredicate(): string {
  return "mcp-server.points-at";
}
/**
 * floor --provides-skill--> skill : a CLI skill slot. Returns
 * "harness.provides-skill".
 */
export function providesSkillPredicate(): string {
  return "harness.provides-skill";
}
/**
 * floor --has-command--> command : a CLI command slot. Returns
 * "harness.has-command".
 */
export function hasCommandPredicate(): string {
  return "harness.has-command";
}
/**
 * floor --has-subagent--> subagent : a CLI subagent slot. Returns
 * "harness.has-subagent".
 */
export function hasSubagentPredicate(): string {
  return "harness.has-subagent";
}
/**
 * floor --fires-hook--> hook : a CLI hook slot. Returns "harness.fires-hook".
 */
export function firesHookPredicate(): string {
  return "harness.fires-hook";
}
/**
 * floor --has-setting--> setting : a CLI setting slot. Returns
 * "harness.has-setting".
 */
export function hasSettingPredicate(): string {
  return "harness.has-setting";
}

// ---------- carrier ----------

/**
 * Input for one mcp-server slot: the server id and an optional hub it points at
 * (defaulting to 561 Group Operations Manifold).
 */
export interface McpServerInput {
  readonly id: string;
  /** Hub the server points at; defaults to 561 Group Operations Manifold. */
  readonly pointsAt?: string;
}

export const McpServerInputSchema = {
  $id: "organizing/claude/code/cli-harness/mcp-server-input",
  type: "object",
  title: "ClaudeCodeCliMcpServerInput",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
    pointsAt: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const mcpServerInputCarrier = carrierFrom(McpServerInputSchema);

/**
 * Input for one CLI harness: the id, the agent it equips/embodies, the claude
 * model it runs on, the channels it speaks, the default hub, and the CLI slot
 * lists (mcp-servers, skills, commands, subagents, hooks, settings).
 */
export interface ClaudeCodeCliHarnessInput {
  readonly id: string;
  /** Agent the harness equips/embodies; defaults to the harness id. */
  readonly agent?: string;
  /** Claude model the embodied agent runs on. */
  readonly model: string;
  /** Channels the harness speaks over (content-topology channels). */
  readonly channels?: readonly string[];
  /** Default hub for servers given as bare ids; defaults to 561 Group Operations Manifold. */
  readonly hub?: string;
  readonly mcpServers?: readonly (string | McpServerInput)[];
  readonly skills?: readonly string[];
  readonly commands?: readonly string[];
  readonly subagents?: readonly string[];
  readonly hooks?: readonly string[];
  readonly settings?: readonly string[];
}

export const ClaudeCodeCliHarnessInputSchema = {
  $id: "organizing/claude/code/cli-harness/input",
  type: "object",
  title: "ClaudeCodeCliHarnessInput",
  required: ["id", "model"],
  properties: {
    id: { type: "string", minLength: 1 },
    agent: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    channels: { type: "array", items: { type: "string", minLength: 1 } },
    hub: { type: "string", minLength: 1 },
    mcpServers: {
      type: "array",
      items: {
        anyOf: [
          { type: "string", minLength: 1 },
          McpServerInputSchema,
        ],
      },
    },
    skills: { type: "array", items: { type: "string", minLength: 1 } },
    commands: { type: "array", items: { type: "string", minLength: 1 } },
    subagents: { type: "array", items: { type: "string", minLength: 1 } },
    hooks: { type: "array", items: { type: "string", minLength: 1 } },
    settings: { type: "array", items: { type: "string", minLength: 1 } },
  },
  additionalProperties: false,
} as const;

export const claudeCodeCliHarnessInputCarrier = carrierFrom(ClaudeCodeCliHarnessInputSchema);

/**
 * An mcp-server slot after resolution: the server id paired with the concrete
 * hub it points at.
 */
export interface ResolvedMcpServer {
  readonly id: string;
  readonly pointsAt: string;
}

export const ResolvedMcpServerSchema = {
  $id: "organizing/claude/code/cli-harness/resolved-mcp-server",
  type: "object",
  title: "ClaudeCodeCliResolvedMcpServer",
  required: ["id", "pointsAt"],
  properties: {
    id: { type: "string", minLength: 1 },
    pointsAt: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const resolvedMcpServerCarrier = carrierFrom(ResolvedMcpServerSchema);

/**
 * A settled CLI harness carrier: its term, id, agent, model, default hub, and
 * the resolved CLI slots (mcp-servers, skills, commands, subagents, hooks,
 * settings), together with the utterances that express the harness and both
 * middles on the meme floor.
 */
export interface ClaudeCodeCliHarnessCarrier {
  readonly kind: "claude-code-cli-harness.carrier";
  readonly term: string;
  readonly id: string;
  readonly agent: string;
  readonly model: string;
  readonly hub: string;
  readonly mcpServers: readonly ResolvedMcpServer[];
  readonly skills: readonly string[];
  readonly commands: readonly string[];
  readonly subagents: readonly string[];
  readonly hooks: readonly string[];
  readonly settings: readonly string[];
  readonly utterances: readonly UtteranceCarrier[];
}

export const ClaudeCodeCliHarnessCarrierSchema = {
  $id: "organizing/claude/code/cli-harness/carrier",
  type: "object",
  title: "ClaudeCodeCliHarnessCarrier",
  required: [
    "kind",
    "term",
    "id",
    "agent",
    "model",
    "hub",
    "mcpServers",
    "skills",
    "commands",
    "subagents",
    "hooks",
    "settings",
    "utterances",
  ],
  properties: {
    kind: { const: "claude-code-cli-harness.carrier" },
    term: { type: "string", minLength: 1 },
    id: { type: "string", minLength: 1 },
    agent: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    hub: { type: "string", minLength: 1 },
    mcpServers: { type: "array", items: ResolvedMcpServerSchema },
    skills: { type: "array", items: { type: "string", minLength: 1 } },
    commands: { type: "array", items: { type: "string", minLength: 1 } },
    subagents: { type: "array", items: { type: "string", minLength: 1 } },
    hooks: { type: "array", items: { type: "string", minLength: 1 } },
    settings: { type: "array", items: { type: "string", minLength: 1 } },
    utterances: { type: "array", items: {} },
  },
  additionalProperties: false,
} as const;

export const claudeCodeCliHarnessCarrier = carrierFrom(ClaudeCodeCliHarnessCarrierSchema);

export const canonicalizeClaudeCodeCliHarnessAction = action({
  verb: "organizing.claude.code.cli-harness.canonicalize-harness",
  summary: "Canonicalize an admitted Claude Code CLI harness carrier through the relational IR.",
  description: "Domain and codomain: a ClaudeCodeCliHarnessCarrier. Body: the CHL identity term.",
  domain: claudeCodeCliHarnessCarrier,
  codomain: claudeCodeCliHarnessCarrier,
  runTerm: tm.lam(tm.var(0)),
});

function slotUtterance(subject: string, object: string, predicate: string): UtteranceCarrier {
  return utterance(mark({ subject, object }), mark(predicate));
}

/**
 * Builds a CLI harness carrier from input: composes the harness and claude-code
 * middles on the same body, resolves each mcp-server to its hub, and emits the
 * utterances - the two is-harness/is-claude-code edges, the middles' own
 * coordinates, and one edge per CLI slot (including each mcp-server's
 * points-at-hub edge).
 */
export function claudeCodeCliHarness(
  input: ClaudeCodeCliHarnessInput,
): ClaudeCodeCliHarnessCarrier {
  const term = cliHarnessTerm(input.id);
  const agent = input.agent ?? input.id;
  const hub = input.hub ?? OPERATIONS_MANIFOLD_HUB;

  // The two middles, on the same body natural (same id/agent).
  const h = harness({ id: input.id, agent, channels: input.channels ?? [] });
  const cc = claudeCode({ id: input.id, agent, model: input.model });

  const mcpServers: ResolvedMcpServer[] = (input.mcpServers ?? []).map((m) =>
    typeof m === "string"
      ? { id: m, pointsAt: hub }
      : { id: m.id, pointsAt: m.pointsAt ?? hub },
  );
  const skills = [...(input.skills ?? [])];
  const commands = [...(input.commands ?? [])];
  const subagents = [...(input.subagents ?? [])];
  const hooks = [...(input.hooks ?? [])];
  const settings = [...(input.settings ?? [])];

  const utterances: UtteranceCarrier[] = [
    // ⊂ both middles
    slotUtterance(term, harnessTerm(input.id), isHarnessPredicate()),
    slotUtterance(term, claudeCodeTerm(input.id), isClaudeCodePredicate()),
    // embed the middles' own coordinates so the floor settles with their content
    ...h.utterances,
    ...cc.utterances,
  ];
  for (const s of mcpServers) {
    utterances.push(slotUtterance(term, mcpServerTerm(s.id), hasMcpServerPredicate()));
    // the load-bearing edge: mcp-server points at the hub (561 Group Operations Manifold)
    utterances.push(slotUtterance(mcpServerTerm(s.id), hubTerm(s.pointsAt), pointsAtPredicate()));
  }
  for (const s of skills) utterances.push(slotUtterance(term, skillTerm(s), providesSkillPredicate()));
  for (const c of commands) utterances.push(slotUtterance(term, commandTerm(c), hasCommandPredicate()));
  for (const a of subagents) utterances.push(slotUtterance(term, subagentTerm(a), hasSubagentPredicate()));
  for (const k of hooks) utterances.push(slotUtterance(term, hookTerm(k), firesHookPredicate()));
  for (const g of settings) utterances.push(slotUtterance(term, settingTerm(g), hasSettingPredicate()));

  return Object.freeze({
    kind: "claude-code-cli-harness.carrier" as const,
    term,
    id: input.id,
    agent,
    model: input.model,
    hub,
    mcpServers: Object.freeze(mcpServers),
    skills: Object.freeze(skills),
    commands: Object.freeze(commands),
    subagents: Object.freeze(subagents),
    hooks: Object.freeze(hooks),
    settings: Object.freeze(settings),
    utterances: Object.freeze(utterances),
  });
}

// ---------- topology settlement ----------

/**
 * A meme-topology carrier settled from CLI harness utterances: a branded
 * fixed-point readings identifying the claude-code-cli-harness floor.
 */
export interface ClaudeCodeCliHarnessTopologyCarrier {
  readonly kind: "claude-code-cli-harness.topology.carrier";
  readonly utterances: readonly UtteranceCarrier[];
  readonly settlement: SettlementFiltration;
  readonly fixedPointReadings: MemeTopologyFixedPointReadings;
  readonly _claudeCodeCliHarnessTopologyBrand: never;
}

export const ClaudeCodeCliHarnessTopologyCarrierSchema = {
  $id: "organizing/claude/code/cli-harness/topology",
  type: "object",
  title: "ClaudeCodeCliHarnessTopologyCarrier",
  required: ["kind", "utterances", "settlement", "fixedPointReadings"],
  properties: {
    kind: { const: "claude-code-cli-harness.topology.carrier" },
    utterances: { type: "array", items: {} },
    settlement: {},
    fixedPointReadings: {},
  },
  additionalProperties: false,
} as const;

export const claudeCodeCliHarnessTopologyCarrier = carrierFrom(ClaudeCodeCliHarnessTopologyCarrierSchema);

export const canonicalizeClaudeCodeCliHarnessTopologyAction = action({
  verb: "organizing.claude.code.cli-harness.canonicalize-topology",
  summary: "Canonicalize an admitted Claude Code CLI harness topology carrier through the relational IR.",
  description: "Domain and codomain: a ClaudeCodeCliHarnessTopologyCarrier. Body: the CHL identity term.",
  domain: claudeCodeCliHarnessTopologyCarrier,
  codomain: claudeCodeCliHarnessTopologyCarrier,
  runTerm: tm.lam(tm.var(0)),
});

/**
 * Settles a set of utterances into a CLI harness topology carrier by inducing
 * the meme floor over them.
 */
export function induceClaudeCodeCliHarnessTopology(
  utterances: readonly UtteranceCarrier[],
): ClaudeCodeCliHarnessTopologyCarrier {
  const log = Object.freeze([...utterances]);
  return Object.freeze({
    kind: "claude-code-cli-harness.topology.carrier" as const,
    utterances: log,
    settlement: settleUtterances(log),
    fixedPointReadings: fixedPointReadingsOfUtterances(log),
  }) as ClaudeCodeCliHarnessTopologyCarrier;
}

/**
 * Extends a settled CLI harness topology carrier with a delta of further
 * utterances, returning the re-settled carrier.
 */
export function extendClaudeCodeCliHarnessTopology(
  carrier: ClaudeCodeCliHarnessTopologyCarrier,
  delta: readonly UtteranceCarrier[],
): ClaudeCodeCliHarnessTopologyCarrier {
  return induceClaudeCodeCliHarnessTopology([...carrier.utterances, ...delta]);
}

/** Settle one CLI harness's coordinates (both middles + CLI slots) into a carrier. */
export function induceHarnessInstanceTopology(
  h: ClaudeCodeCliHarnessCarrier,
): ClaudeCodeCliHarnessTopologyCarrier {
  return induceClaudeCodeCliHarnessTopology(h.utterances);
}

export const actions = Object.freeze([
  canonicalizeClaudeCodeCliHarnessAction,
  canonicalizeClaudeCodeCliHarnessTopologyAction,
]);
