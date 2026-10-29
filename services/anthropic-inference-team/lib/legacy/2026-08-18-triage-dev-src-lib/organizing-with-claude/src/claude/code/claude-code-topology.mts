/**
 * claude-code-topology — Claude Code as a settled meme-topology carrier.
 *
 * The "claude-code" half of the claude-code-cli-harness diamond: apex
 * `agent-topology`; middles `agent-harness-topology` (agent + content) and this
 * one (agent + claude-models); floor `claude-code-cli-harness-topology` ⊂ both.
 *
 * Claude Code is an agent application that *runs* a claude model: a claude-code
 * `embodies` an agent (agent-topology — the edge up to the apex) and `runs` that
 * agent on a claude model (claude-topology). It carries no harness slots of its
 * own — equipping an agent with the channels it speaks over is
 * agent-harness-topology's half, and the floor specializes the *meet* of the two
 * middles to the concrete CLI (mcp-server, skill, command, subagent, hook,
 * setting), where the mcp-server points at 561 Group Operations Manifold.
 *
 * Pure: a claude-code's coordinates admit onto the meme floor as utterances;
 * settlement is `induceClaudeCodeTopology`.
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
import { settleUtterances, fixedPointReadingsOfUtterances, agentTerm } from "../../topology-settling.mjs";
import { modelTerm } from "../index.mjs";

export type { UtteranceCarrier };

// ---------- term constructor ----------

/** Namespaced mark for a Claude Code instance: "claude-code.<id>". */
export function claudeCodeTerm(id: string): string {
  return `claude-code.${id}`;
}

// ---------- predicate constructors ----------

/** claude-code --embodies--> agent : the agent the application acts as. The agent
 *  term is agent-topology's — the diamond edge up to the apex. */
export function embodiesPredicate(): string {
  return "claude-code.embodies";
}

/** claude-code --runs--> model : the claude model the embodied agent runs on. The
 *  model term is claude-topology's. */
export function runsPredicate(): string {
  return "claude-code.runs";
}

// ---------- ClaudeCodeCarrier ----------

/**
 * Input coordinates for a Claude Code instance: the instance id, the agent id
 * it embodies (defaulting to the id), and the claude model id the agent runs
 * on.
 */
export interface ClaudeCodeInput {
  /** Instance id, e.g. a session id or "default". */
  readonly id: string;
  /** Agent id the instance embodies; defaults to the instance id. */
  readonly agent?: string;
  /** Claude model id the agent runs on (opus | sonnet | haiku | fable). */
  readonly model: string;
}

export const ClaudeCodeInputSchema = {
  $id: "organizing/claude/code/topology/input",
  type: "object",
  title: "ClaudeCodeInput",
  required: ["id", "model"],
  properties: {
    id: { type: "string", minLength: 1 },
    agent: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const claudeCodeInputCarrier = carrierFrom(ClaudeCodeInputSchema);

/**
 * A settled Claude Code instance: its namespaced term, id, embodied agent,
 * claude model, and the frozen embodies/runs utterances that admit onto the
 * meme floor.
 */
export interface ClaudeCodeCarrier {
  readonly kind: "claude-code.carrier";
  readonly term: string;
  readonly id: string;
  readonly agent: string;
  readonly model: string;
  readonly utterances: readonly UtteranceCarrier[];
}

export const ClaudeCodeCarrierSchema = {
  $id: "organizing/claude/code/topology/carrier",
  type: "object",
  title: "ClaudeCodeCarrier",
  required: ["kind", "term", "id", "agent", "model", "utterances"],
  properties: {
    kind: { const: "claude-code.carrier" },
    term: { type: "string", minLength: 1 },
    id: { type: "string", minLength: 1 },
    agent: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    utterances: { type: "array", items: {} },
  },
  additionalProperties: false,
} as const;

export const claudeCodeCarrier = carrierFrom(ClaudeCodeCarrierSchema);

export const canonicalizeClaudeCodeAction = action({
  verb: "organizing.claude.code.topology.canonicalize-code",
  summary: "Canonicalize an admitted Claude Code topology carrier through the relational IR.",
  description: "Domain and codomain: a ClaudeCodeCarrier. Body: the CHL identity term.",
  domain: claudeCodeCarrier,
  codomain: claudeCodeCarrier,
  runTerm: tm.lam(tm.var(0)),
});

/**
 * Builds a frozen ClaudeCodeCarrier from input coordinates: derives the term,
 * defaults the agent to the id, and emits the embodies (agent) and runs (model)
 * utterances.
 */
export function claudeCode(input: ClaudeCodeInput): ClaudeCodeCarrier {
  const term = claudeCodeTerm(input.id);
  const agent = input.agent ?? input.id;
  const utterances: UtteranceCarrier[] = [
    utterance(
      mark({ subject: term, object: agentTerm(agent) }),
      mark(embodiesPredicate()),
    ),
    utterance(
      mark({ subject: term, object: modelTerm(input.model) }),
      mark(runsPredicate()),
    ),
  ];
  return Object.freeze({
    kind: "claude-code.carrier" as const,
    term,
    id: input.id,
    agent,
    model: input.model,
    utterances: Object.freeze(utterances),
  });
}

// ---------- topology settlement ----------

/**
 * A meme-topology carrier branded as the claude-code topology: the settled
 * relational structure over claude-code utterances.
 */
export interface ClaudeCodeTopologyCarrier {
  readonly kind: "claude-code.topology.carrier";
  readonly utterances: readonly UtteranceCarrier[];
  readonly settlement: SettlementFiltration;
  readonly fixedPointReadings: MemeTopologyFixedPointReadings;
  readonly _claudeCodeTopologyBrand: never;
}

export const ClaudeCodeTopologyCarrierSchema = {
  $id: "organizing/claude/code/topology/topology",
  type: "object",
  title: "ClaudeCodeTopologyCarrier",
  required: ["kind", "utterances", "settlement", "fixedPointReadings"],
  properties: {
    kind: { const: "claude-code.topology.carrier" },
    utterances: { type: "array", items: {} },
    settlement: {},
    fixedPointReadings: {},
  },
  additionalProperties: false,
} as const;

export const claudeCodeTopologyCarrier = carrierFrom(ClaudeCodeTopologyCarrierSchema);

export const canonicalizeClaudeCodeTopologyAction = action({
  verb: "organizing.claude.code.topology.canonicalize-topology",
  summary: "Canonicalize an admitted Claude Code topology carrier through the relational IR.",
  description: "Domain and codomain: a ClaudeCodeTopologyCarrier. Body: the CHL identity term.",
  domain: claudeCodeTopologyCarrier,
  codomain: claudeCodeTopologyCarrier,
  runTerm: tm.lam(tm.var(0)),
});

/**
 * Settles a set of utterances into a ClaudeCodeTopologyCarrier by inducing the
 * meme topology over them.
 */
export function induceClaudeCodeTopology(
  utterances: readonly UtteranceCarrier[],
): ClaudeCodeTopologyCarrier {
  const log = Object.freeze([...utterances]);
  return Object.freeze({
    kind: "claude-code.topology.carrier" as const,
    utterances: log,
    settlement: settleUtterances(log),
    fixedPointReadings: fixedPointReadingsOfUtterances(log),
  }) as ClaudeCodeTopologyCarrier;
}

/**
 * Extends an existing ClaudeCodeTopologyCarrier with a delta of utterances,
 * returning the re-settled topology.
 */
export function extendClaudeCodeTopology(
  carrier: ClaudeCodeTopologyCarrier,
  delta: readonly UtteranceCarrier[],
): ClaudeCodeTopologyCarrier {
  return induceClaudeCodeTopology([...carrier.utterances, ...delta]);
}

/** Settle a single Claude Code instance's coordinates into a topology carrier. */
export function induceClaudeCodeInstanceTopology(
  c: ClaudeCodeCarrier,
): ClaudeCodeTopologyCarrier {
  return induceClaudeCodeTopology(c.utterances);
}

export const actions = Object.freeze([
  canonicalizeClaudeCodeAction,
  canonicalizeClaudeCodeTopologyAction,
]);
