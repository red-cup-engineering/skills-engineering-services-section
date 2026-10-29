/**
 * claude-topology — the claude models as a settled meme-topology carrier.
 *
 * This is the "claude" half of the claude-code-cli-harness diamond
 * (apex `agent-topology`; middles `agent-harness-topology` = agent+content and
 * `claude-code-topology` = agent+claude-topology; floor
 * `claude-code-cli-harness-topology` ⊂ both). It is scoped to *only the models*:
 * opus, sonnet, haiku, fable.
 *
 * A claude model is read two ways, both downstream of agent-topology:
 *  - it `realizes` an agent — the inference surface an agent's prehensions run on
 *    (agent-topology's `agentTerm`), which is the edge that makes this node a
 *    refinement of the apex; and
 *  - it sits `at-tier` a formality tier. Per the agent-algebra tier-routing
 *    reading the tiers are F0 (flagship), F1, F2 — opus/fable at F0, sonnet at F1,
 *    haiku at F2 — and tiers are *peer formality surfaces over the same bilattice
 *    substrate*, a differentiating coordinate, not a capability total order.
 *
 * Pure: a model's coordinates admit onto the meme floor as utterances; settlement
 * is `induceClaudeTopology`. No transport, no store, no harness lives here.
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
import { settleUtterances, fixedPointReadingsOfUtterances, agentTerm } from "../topology-settling.mjs";

export type { UtteranceCarrier };

/** The claude models this node settles. Open string elsewhere; this union pins
 *  the ones we actually run. */
export type ClaudeModelId = "opus" | "sonnet" | "haiku" | "fable";

export const ClaudeModelIdSchema = { enum: ["opus", "sonnet", "haiku", "fable"] } as const;

/** Formality tiers, per the agent-algebra tier-routing reading. */
export type ModelTier = "F0" | "F1" | "F2";

export const ModelTierSchema = { enum: ["F0", "F1", "F2"] } as const;

// ---------- term constructors ----------

/** Namespaced mark for a claude model: "model.<id>". Matches the object form
 *  agent-topology identity already prehends (`prehend(agent, "model.opus")`). */
export function modelTerm(id: string): string {
  return `model.${id}`;
}

/** Namespaced mark for a formality tier: "tier.<F>". */
export function tierTerm(tier: string): string {
  return `tier.${tier}`;
}

// ---------- predicate constructors ----------

/** model --realizes--> agent : the inference surface an agent is realized through.
 *  The agent term is agent-topology's — this is the diamond edge to the apex. */
export function realizesPredicate(): string {
  return "model.realizes";
}

/** model --at-tier--> tier : the formality tier the model occupies. */
export function atTierPredicate(): string {
  return "model.at-tier";
}

// ---------- ClaudeModelCarrier ----------

/**
 * Input coordinates for one claude model: its id, the formality tier it
 * occupies, and the agent id it realizes (defaulting to the model id).
 */
export interface ClaudeModelInput {
  /** Model id, e.g. "opus". */
  readonly id: string;
  /** Formality tier the model occupies. */
  readonly tier: string;
  /** Agent id the model realizes; defaults to the model id. */
  readonly agent?: string;
}

export const ClaudeModelInputSchema = {
  $id: "organizing/claude/topology/model-input",
  type: "object",
  title: "ClaudeModelInput",
  required: ["id", "tier"],
  properties: {
    id: ClaudeModelIdSchema,
    tier: ModelTierSchema,
    agent: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const claudeModelInputCarrier = carrierFrom(ClaudeModelInputSchema);

/**
 * A claude model as a settled carrier: its namespaced model term, id, tier,
 * realized agent id, and the utterances asserting model --realizes--> agent and
 * model --at-tier--> tier.
 */
export interface ClaudeModelCarrier {
  readonly kind: "claude.model.carrier";
  readonly term: string;
  readonly id: string;
  readonly tier: string;
  readonly agent: string;
  readonly utterances: readonly UtteranceCarrier[];
}

export const ClaudeModelCarrierSchema = {
  $id: "organizing/claude/topology/model",
  type: "object",
  title: "ClaudeModelCarrier",
  required: ["kind", "term", "id", "tier", "agent", "utterances"],
  properties: {
    kind: { const: "claude.model.carrier" },
    term: { type: "string", minLength: 1 },
    id: ClaudeModelIdSchema,
    tier: ModelTierSchema,
    agent: { type: "string", minLength: 1 },
    utterances: { type: "array", items: {} },
  },
  additionalProperties: false,
} as const;

export const claudeModelCarrier = carrierFrom(ClaudeModelCarrierSchema);

export const canonicalizeClaudeModelAction = action({
  verb: "organizing.claude.topology.canonicalize-model",
  summary: "Canonicalize an admitted Claude model topology carrier through the relational IR.",
  description: "Domain and codomain: a ClaudeModelCarrier. Body: the CHL identity term.",
  domain: claudeModelCarrier,
  codomain: claudeModelCarrier,
  runTerm: tm.lam(tm.var(0)),
});

/**
 * Builds a ClaudeModelCarrier from a ClaudeModelInput: derives the model term,
 * resolves the realized agent (defaulting to the id), and emits the realizes
 * and at-tier utterances as a frozen carrier.
 */
export function claudeModel(input: ClaudeModelInput): ClaudeModelCarrier {
  const term = modelTerm(input.id);
  const agent = input.agent ?? input.id;
  const utterances: UtteranceCarrier[] = [
    utterance(
      mark({ subject: term, object: agentTerm(agent) }),
      mark(realizesPredicate()),
    ),
    utterance(
      mark({ subject: term, object: tierTerm(input.tier) }),
      mark(atTierPredicate()),
    ),
  ];
  return Object.freeze({
    kind: "claude.model.carrier" as const,
    term,
    id: input.id,
    tier: input.tier,
    agent,
    utterances: Object.freeze(utterances),
  });
}

// ---------- the known claude models ----------

/** The claude models and their formality tiers. fable is the newest flagship and
 *  joins opus at F0. */
export const CLAUDE_MODELS: readonly ClaudeModelInput[] = Object.freeze([
  Object.freeze({ id: "opus", tier: "F0" satisfies ModelTier }),
  Object.freeze({ id: "fable", tier: "F0" satisfies ModelTier }),
  Object.freeze({ id: "sonnet", tier: "F1" satisfies ModelTier }),
  Object.freeze({ id: "haiku", tier: "F2" satisfies ModelTier }),
]);

/** Each known claude model as a carrier. */
export function claudeModels(): readonly ClaudeModelCarrier[] {
  return Object.freeze(CLAUDE_MODELS.map(claudeModel));
}

// ---------- topology settlement ----------

/**
 * A meme-topology carrier branded as the claude-topology node: a
 * fixed-point readings and settlement from claude model utterances.
 */
export interface ClaudeTopologyCarrier {
  readonly kind: "claude.topology.carrier";
  readonly utterances: readonly UtteranceCarrier[];
  readonly settlement: SettlementFiltration;
  readonly fixedPointReadings: MemeTopologyFixedPointReadings;
  readonly _claudeTopologyBrand: never;
}

export const ClaudeTopologyCarrierSchema = {
  $id: "organizing/claude/topology/topology",
  type: "object",
  title: "ClaudeTopologyCarrier",
  required: ["kind", "utterances", "settlement", "fixedPointReadings"],
  properties: {
    kind: { const: "claude.topology.carrier" },
    utterances: { type: "array", items: {} },
    settlement: {},
    fixedPointReadings: {},
  },
  additionalProperties: false,
} as const;

export const claudeTopologyCarrier = carrierFrom(ClaudeTopologyCarrierSchema);

export const canonicalizeClaudeTopologyAction = action({
  verb: "organizing.claude.topology.canonicalize-topology",
  summary: "Canonicalize an admitted Claude topology carrier through the relational IR.",
  description: "Domain and codomain: a ClaudeTopologyCarrier. Body: the CHL identity term.",
  domain: claudeTopologyCarrier,
  codomain: claudeTopologyCarrier,
  runTerm: tm.lam(tm.var(0)),
});

/**
 * Settles utterances into a ClaudeTopologyCarrier: delegates to the base induce
 * and brands the result as the claude-topology node.
 */
export function induceClaudeTopology(
  utterances: readonly UtteranceCarrier[],
): ClaudeTopologyCarrier {
  const log = Object.freeze([...utterances]);
  return Object.freeze({
    kind: "claude.topology.carrier" as const,
    utterances: log,
    settlement: settleUtterances(log),
    fixedPointReadings: fixedPointReadingsOfUtterances(log),
  }) as ClaudeTopologyCarrier;
}

/**
 * Extends an existing ClaudeTopologyCarrier with delta utterances: delegates to
 * the base extend and re-brands the result as the claude-topology node.
 */
export function extendClaudeTopology(
  carrier: ClaudeTopologyCarrier,
  delta: readonly UtteranceCarrier[],
): ClaudeTopologyCarrier {
  return induceClaudeTopology([...carrier.utterances, ...delta]);
}

/** Settle a single model's coordinates into a topology carrier. */
export function induceModelTopology(m: ClaudeModelCarrier): ClaudeTopologyCarrier {
  return induceClaudeTopology(m.utterances);
}

/** Settle all known claude models into one topology carrier. */
export function induceClaudeModelsTopology(): ClaudeTopologyCarrier {
  return induceClaudeTopology(claudeModels().flatMap((m) => m.utterances));
}

export const actions = Object.freeze([
  canonicalizeClaudeModelAction,
  canonicalizeClaudeTopologyAction,
]);
