/**
 * organizing-with-llm-agents harness topology — an LLM-facing agent harness as a settled
 * relating topology carrier.
 *
 * A harness is the composition agent + content: it `equips` an agent
 * (animating topology) with the `channel`s it `speaks` over (content topology — the
 * medium through which communication happens). The harness
 * carries no protocol of its own; "speaking a channel" is what a concrete harness
 * specializes, and discovery of a hub over a channel is itself a communication
 * settled downstream.
 *
 * This library is pure: a harness's coordinates admit onto the relating
 * topology floor as utterances, and settlement is `induceAgentHarnessTopology`.
 */
import { action, carrierFrom, mark, utterance, articulate, predicate, predicationSite, posit, settle, tm, fixedPoints, fixedPointReadings, type UtteranceCarrier, type MemeTopologyFixedPointReadings, type SettlementFiltration } from "@emsenn/relating";

import { channelTerm } from "@emsenn/content/topology";

/**
 * Settle a harness's own utterance log into the meme topology, on the relating
 * substrate directly: articulate every utterance, predicate each potential cell,
 * union the generated predication sites, posit the measured valuation, and settle /
 * read the fixed points. (Was the dropped animating wrapper `settleUtterances`; a
 * harness settles its own topology on relating, the stronger base.)
 */
function settleLog(log: readonly UtteranceCarrier[]): {
  readonly settlement: SettlementFiltration;
  readonly fixedPointReadings: MemeTopologyFixedPointReadings;
} {
  const generated = log.map((carrier) => predicate(articulate(carrier)));
  const predicated = predicationSite(generated.flatMap((site) => [...site.cells.cells, ...site.specializations]));
  const posited = posit(predicated);
  return { settlement: settle(posited), fixedPointReadings: fixedPointReadings(fixedPoints(posited)) };
}

export type { UtteranceCarrier };

// ---------- term constructor ----------

/** Namespaced mark for a harness: "harness.<id>". */
export function harnessTerm(id: string): string {
  return `harness.${id}`;
}

/** Namespaced term for the agent a harness equips: "agent.<id>". Fresh animating
 *  identifies agents by bare string, so the harness owns this boundary naming. */
export function agentTerm(id: string): string {
  return `agent.${id}`;
}

// ---------- lawful finite vocabulary ----------

/** The finite predicate vocabulary a generic harness admits. */
export const HARNESS_PREDICATES = Object.freeze({
  /** harness --equips--> agent : the agent this harness endows with affordances. */
  equips: "harness.equips",
  /** harness --speaks--> channel : the medium/protocol the harness communicates over. */
  speaks: "harness.speaks",
} as const);

// ---------- HarnessCarrier ----------

/**
 * Input for constructing a harness: an id, the agent id it equips, and optional
 * channel ids it speaks over.
 */
export interface HarnessInput {
  readonly id: string;
  /** The agent id this harness equips. */
  readonly agent: string;
  /** Channel ids the harness speaks over (content-topology channels). */
  readonly channels?: readonly string[];
}

export const HarnessInputSchema = { "$id": "organizing/agents/llm/harness/input", "title": "LlmHarnessInput", "additionalProperties": false, type: "object", required: ["id", "agent"], properties: { "id": { type: "string", "minLength": 1 }, "agent": { type: "string", "minLength": 1 }, "channels": { type: "array", items: { type: "string", "minLength": 1 } } } } as const;

export const harnessInputCarrier = carrierFrom(HarnessInputSchema);

/**
 * A settled harness carrier: its namespaced term, the agent it equips, the
 * channels it speaks over, and the utterances admitting those coordinates onto
 * the relating topology floor.
 */
export interface HarnessCarrier {
  readonly kind: "harness.carrier";
  readonly term: string;
  readonly agent: string;
  readonly channels: readonly string[];
  readonly utterances: readonly UtteranceCarrier[];
}

export const HarnessCarrierSchema = { "$id": "organizing/agents/llm/harness/carrier", "title": "LlmHarnessCarrier", "additionalProperties": false, type: "object", required: ["kind", "term", "agent", "channels", "utterances"], properties: { "kind": { const: "harness.carrier" }, "term": { type: "string", "minLength": 1 }, "agent": { type: "string", "minLength": 1 }, "channels": { type: "array", items: { type: "string", "minLength": 1 } }, "utterances": { type: "array", items: {} } } } as const;

export const harnessCarrier = carrierFrom(HarnessCarrierSchema);

export const canonicalizeHarnessAction = action({
  verb: "organizing.llm.harness.canonicalize-harness",
  summary: "Canonicalize an admitted LLM harness carrier through the relational IR.",
  description: "Domain and codomain: an LlmHarnessCarrier. Body: the CHL identity term.",
  domain: harnessCarrier,
  codomain: harnessCarrier,
  runTerm: tm.lam(tm.var(0)),
});

/**
 * Constructs a frozen harness carrier from a HarnessInput: emits one equips
 * utterance binding the harness term to its agent and one speaks utterance per
 * channel.
 */
export function harness(input: HarnessInput): HarnessCarrier {
  const term = harnessTerm(input.id);
  const channels = input.channels ?? [];
  const utterances: UtteranceCarrier[] = [
    utterance(
      mark({ subject: term, object: agentTerm(input.agent) }),
      mark(HARNESS_PREDICATES.equips),
    ),
    ...channels.map((c) =>
      utterance(
        mark({ subject: term, object: channelTerm(c) }),
        mark(HARNESS_PREDICATES.speaks),
      )
    ),
  ];
  return Object.freeze({
    kind: "harness.carrier" as const,
    term,
    agent: input.agent,
    channels: Object.freeze([...channels]),
    utterances: Object.freeze(utterances),
  });
}

// ---------- topology settlement ----------

/**
 * The settled relating readings of harness coordinates.
 */
export interface AgentHarnessTopologyCarrier {
  readonly kind: "agent-harness.topology.carrier";
  readonly utterances: readonly UtteranceCarrier[];
  readonly settlement: SettlementFiltration;
  readonly fixedPointReadings: MemeTopologyFixedPointReadings;
  readonly _agentHarnessTopologyBrand: never;
}

export const AgentHarnessTopologyCarrierSchema = { "$id": "organizing/agents/llm/harness/topology", "title": "LlmAgentHarnessTopologyCarrier", "additionalProperties": false, type: "object", required: ["kind", "utterances", "settlement", "fixedPointReadings"], properties: { "kind": { const: "agent-harness.topology.carrier" }, "utterances": { type: "array", items: {} }, "settlement": {}, "fixedPointReadings": {} } } as const;

export const agentHarnessTopologyCarrier = carrierFrom(AgentHarnessTopologyCarrierSchema);

export const canonicalizeAgentHarnessTopologyAction = action({
  verb: "organizing.llm.harness.canonicalize-topology",
  summary: "Canonicalize an admitted LLM harness topology carrier through the relational IR.",
  description: "Domain and codomain: an LlmAgentHarnessTopologyCarrier. Body: the CHL identity term.",
  domain: agentHarnessTopologyCarrier,
  codomain: agentHarnessTopologyCarrier,
  runTerm: tm.lam(tm.var(0)),
});

/** Settles a sequence of utterances into an AgentHarnessTopologyCarrier. */
export function induceAgentHarnessTopology(
  utterances: readonly UtteranceCarrier[],
): AgentHarnessTopologyCarrier {
  const log = Object.freeze([...utterances]);
  const topology = settleLog(log);
  return Object.freeze({
    kind: "agent-harness.topology.carrier" as const,
    utterances: log,
    settlement: topology.settlement,
    fixedPointReadings: topology.fixedPointReadings,
  }) as AgentHarnessTopologyCarrier;
}

/**
 * Extends an existing AgentHarnessTopologyCarrier with a delta of utterances,
 * returning the re-settled carrier.
 */
export function extendAgentHarnessTopology(
  carrier: AgentHarnessTopologyCarrier,
  delta: readonly UtteranceCarrier[],
): AgentHarnessTopologyCarrier {
  return induceAgentHarnessTopology([...carrier.utterances, ...delta]);
}

/** Settle a single harness's coordinates into a topology carrier. */
export function induceHarnessTopology(h: HarnessCarrier): AgentHarnessTopologyCarrier {
  return induceAgentHarnessTopology(h.utterances);
}

export const actions = Object.freeze([
  canonicalizeHarnessAction,
  canonicalizeAgentHarnessTopologyAction,
]);
