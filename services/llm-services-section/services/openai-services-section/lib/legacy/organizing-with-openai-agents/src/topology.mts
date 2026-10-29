/**
 * topology — the OpenAI-dialect agent as a settled meme-topology carrier.
 *
 * This generalizes @emsenn/computing-with-openai-codex's openai-topology and
 * codex-topology off their GPT-5 / Codex-CLI pinning. Two pure carriers:
 *
 *   openaiModel  — a model read two ways downstream of @emsenn/animating topology:
 *                  it `realizes` an agent (the inference surface the agent's
 *                  prehensions run on — the edge up to the apex), and it sits
 *                  `at-tier` a formality tier. Unlike codex's, the model id and
 *                  tier are open: ANY model on ANY endpoint admits.
 *
 *   openaiAgent  — an agent application that `embodies` an agent, `runs` it on a
 *                  model, and reaches that model `via` an endpoint. The via-endpoint
 *                  edge is the new coordinate this package adds: it is what lets
 *                  distinct computers (a codex, a claude, an nvidia agent) be
 *                  mounted into the same settled topology and so interoperate.
 *
 * Pure: coordinates admit onto the meme floor as utterances; settlement is
 * `induceOpenaiAgentTopology`. No transport, no keys, no store live here.
 */
import { action, carrierFrom, mark, tm, utterance, type UtteranceCarrier, type MemeTopologyFixedPointReadings, type SettlementFiltration } from "@emsenn/relating";

import { fixedPointReadingsOfUtterances, settleUtterances, termOf } from "@emsenn/animating";

export type { UtteranceCarrier };

/** Formality tiers, per the agent-algebra tier-routing reading. */
export type ModelTier = "F0" | "F1" | "F2";

// ---------- term constructors ----------

/** Namespaced mark for a model: "model.<id>". */
export function modelTerm(id: string): string {
  return `model.${id}`;
}
/** Namespaced mark for a formality tier: "tier.<F>". */
export function tierTerm(tier: string): string {
  return `tier.${tier}`;
}
/** Namespaced mark for an endpoint: "endpoint.<id>". */
export function endpointTerm(id: string): string {
  return `endpoint.${id}`;
}
/** Namespaced mark for an OpenAI-dialect agent: "openai-agent.<id>". */
export function openaiAgentTerm(id: string): string {
  return `openai-agent.${id}`;
}

// ---------- predicate constructors ----------

/** model --realizes--> agent : the inference surface an agent is realized through. */
export function realizesPredicate(): string {
  return "model.realizes";
}
/** model --at-tier--> tier : the formality tier the model occupies. */
export function atTierPredicate(): string {
  return "model.at-tier";
}
/** openai-agent --embodies--> agent : the agent the application acts as. */
export function embodiesPredicate(): string {
  return "openai-agent.embodies";
}
/** openai-agent --runs--> model : the model the embodied agent runs on. */
export function runsPredicate(): string {
  return "openai-agent.runs";
}
/** openai-agent --via--> endpoint : the endpoint the model is reached through. */
export function viaEndpointPredicate(): string {
  return "openai-agent.via-endpoint";
}

// ---------- model carrier ----------

/** Input coordinates for one model: its id, the tier it occupies, and the agent
 *  id it realizes (defaulting to the model id). */
export interface OpenaiModelInput {
  readonly id: string;
  readonly tier: string;
  readonly agent?: string;
}

export const ModelTierSchema = { anyOf: [{ const: "F0" }, { const: "F1" }, { const: "F2" }] } as const;

export const OpenaiModelInputSchema = { "$id": "organizing/agents/openai/topology/model-input", "title": "OpenaiModelInput", "additionalProperties": false, type: "object", required: ["id", "tier"], properties: { "id": { type: "string", "minLength": 1 }, "tier": ModelTierSchema, "agent": { type: "string", "minLength": 1 } } } as const;

export const openaiModelInputCarrier = carrierFrom(OpenaiModelInputSchema);

/** A model as a settled carrier: model term, id, tier, realized agent, and the
 *  realizes/at-tier utterances. */
export interface OpenaiModelCarrier {
  readonly kind: "openai.model.carrier";
  readonly term: string;
  readonly id: string;
  readonly tier: string;
  readonly agent: string;
  readonly utterances: readonly UtteranceCarrier[];
}

export const OpenaiModelCarrierSchema = { "$id": "organizing/agents/openai/topology/model", "title": "OpenaiModelCarrier", "additionalProperties": false, type: "object", required: ["kind", "term", "id", "tier", "agent", "utterances"], properties: { "kind": { const: "openai.model.carrier" }, "term": { type: "string", "minLength": 1 }, "id": { type: "string", "minLength": 1 }, "tier": ModelTierSchema, "agent": { type: "string", "minLength": 1 }, "utterances": { type: "array", items: {} } } } as const;

export const openaiModelCarrier = carrierFrom(OpenaiModelCarrierSchema);

export const canonicalizeOpenaiModelAction = action({
  verb: "organizing.openai.topology.canonicalize-model",
  summary: "Canonicalize an admitted OpenAI model topology carrier through the relational IR.",
  description: "Domain and codomain: an OpenaiModelCarrier. Body: the CHL identity term.",
  domain: openaiModelCarrier,
  codomain: openaiModelCarrier,
  runTerm: tm.lam(tm.var(0)),
});

/** Build an OpenaiModelCarrier from coordinates. */
export function openaiModel(input: OpenaiModelInput): OpenaiModelCarrier {
  const term = modelTerm(input.id);
  const agent = input.agent ?? input.id;
  const utterances: UtteranceCarrier[] = [
    utterance(mark({ subject: term, object: termOf(mark(agent)) }), mark(realizesPredicate())),
    utterance(mark({ subject: term, object: tierTerm(input.tier) }), mark(atTierPredicate())),
  ];
  return Object.freeze({
    kind: "openai.model.carrier" as const,
    term,
    id: input.id,
    tier: input.tier,
    agent,
    utterances: Object.freeze(utterances),
  });
}

// ---------- agent carrier ----------

/** Input coordinates for an OpenAI-dialect agent instance: its id, the agent it
 *  embodies (defaulting to the id), the model it runs, and the endpoint it
 *  reaches the model through. */
export interface OpenaiAgentInput {
  /** Instance id, e.g. a session id or "default". */
  readonly id: string;
  /** Agent id the instance embodies; defaults to the instance id. */
  readonly agent?: string;
  /** Model id the embodied agent runs on. */
  readonly model: string;
  /** Endpoint id the model is reached through (openai | nvidia | groq | cerebras | …). */
  readonly endpoint: string;
}

export const OpenaiAgentInputSchema = { "$id": "organizing/agents/openai/topology/agent-input", "title": "OpenaiAgentInput", "additionalProperties": false, type: "object", required: ["id", "model", "endpoint"], properties: { "id": { type: "string", "minLength": 1 }, "agent": { type: "string", "minLength": 1 }, "model": { type: "string", "minLength": 1 }, "endpoint": { type: "string", "minLength": 1 } } } as const;

export const openaiAgentInputCarrier = carrierFrom(OpenaiAgentInputSchema);

/** A settled OpenAI-dialect agent: its term, id, embodied agent, model, endpoint,
 *  and the embodies/runs/via utterances that admit onto the meme floor. */
export interface OpenaiAgentCarrier {
  readonly kind: "openai-agent.carrier";
  readonly term: string;
  readonly id: string;
  readonly agent: string;
  readonly model: string;
  readonly endpoint: string;
  readonly utterances: readonly UtteranceCarrier[];
}

export const OpenaiAgentCarrierSchema = { "$id": "organizing/agents/openai/topology/agent", "title": "OpenaiAgentCarrier", "additionalProperties": false, type: "object", required: ["kind", "term", "id", "agent", "model", "endpoint", "utterances"], properties: { "kind": { const: "openai-agent.carrier" }, "term": { type: "string", "minLength": 1 }, "id": { type: "string", "minLength": 1 }, "agent": { type: "string", "minLength": 1 }, "model": { type: "string", "minLength": 1 }, "endpoint": { type: "string", "minLength": 1 }, "utterances": { type: "array", items: {} } } } as const;

export const openaiAgentCarrier = carrierFrom(OpenaiAgentCarrierSchema);

export const canonicalizeOpenaiAgentAction = action({
  verb: "organizing.openai.topology.canonicalize-agent",
  summary: "Canonicalize an admitted OpenAI agent topology carrier through the relational IR.",
  description: "Domain and codomain: an OpenaiAgentCarrier. Body: the CHL identity term.",
  domain: openaiAgentCarrier,
  codomain: openaiAgentCarrier,
  runTerm: tm.lam(tm.var(0)),
});

/** Build a frozen OpenaiAgentCarrier from input coordinates. */
export function openaiAgent(input: OpenaiAgentInput): OpenaiAgentCarrier {
  const term = openaiAgentTerm(input.id);
  const agent = input.agent ?? input.id;
  const utterances: UtteranceCarrier[] = [
    utterance(mark({ subject: term, object: termOf(mark(agent)) }), mark(embodiesPredicate())),
    utterance(mark({ subject: term, object: modelTerm(input.model) }), mark(runsPredicate())),
    utterance(mark({ subject: term, object: endpointTerm(input.endpoint) }), mark(viaEndpointPredicate())),
  ];
  return Object.freeze({
    kind: "openai-agent.carrier" as const,
    term,
    id: input.id,
    agent,
    model: input.model,
    endpoint: input.endpoint,
    utterances: Object.freeze(utterances),
  });
}

// ---------- topology settlement ----------

/** A meme-topology carrier branded as the openai-agent topology node. */
export interface OpenaiAgentTopologyCarrier {
  readonly kind: "openai-agent.topology.carrier";
  readonly utterances: readonly UtteranceCarrier[];
  readonly settlement: SettlementFiltration;
  readonly fixedPointReadings: MemeTopologyFixedPointReadings;
  readonly _openaiAgentTopologyBrand: never;
}

export const OpenaiAgentTopologyCarrierSchema = { "$id": "organizing/agents/openai/topology/topology", "title": "OpenaiAgentTopologyCarrier", "additionalProperties": false, type: "object", required: ["kind", "utterances", "settlement", "fixedPointReadings"], properties: { "kind": { const: "openai-agent.topology.carrier" }, "utterances": { type: "array", items: {} }, "settlement": {}, "fixedPointReadings": {} } } as const;

export const openaiAgentTopologyCarrier = carrierFrom(OpenaiAgentTopologyCarrierSchema);

export const canonicalizeOpenaiAgentTopologyAction = action({
  verb: "organizing.openai.topology.canonicalize-topology",
  summary: "Canonicalize an admitted OpenAI agent topology carrier through the relational IR.",
  description: "Domain and codomain: an OpenaiAgentTopologyCarrier. Body: the CHL identity term.",
  domain: openaiAgentTopologyCarrier,
  codomain: openaiAgentTopologyCarrier,
  runTerm: tm.lam(tm.var(0)),
});

/** Settle a set of utterances into an OpenaiAgentTopologyCarrier. */
export function induceOpenaiAgentTopology(
  utterances: readonly UtteranceCarrier[],
): OpenaiAgentTopologyCarrier {
  const log = Object.freeze([...utterances]);
  return Object.freeze({
    kind: "openai-agent.topology.carrier" as const,
    utterances: log,
    settlement: settleUtterances(log),
    fixedPointReadings: fixedPointReadingsOfUtterances(log),
  }) as OpenaiAgentTopologyCarrier;
}

/** Extend a settled topology carrier with delta utterances, re-settling. */
export function extendOpenaiAgentTopology(
  carrier: OpenaiAgentTopologyCarrier,
  delta: readonly UtteranceCarrier[],
): OpenaiAgentTopologyCarrier {
  return induceOpenaiAgentTopology([...carrier.utterances, ...delta]);
}

/** Settle one agent instance (and the model it runs) into a topology carrier. */
export function induceAgentInstanceTopology(
  a: OpenaiAgentCarrier,
  model?: OpenaiModelCarrier,
): OpenaiAgentTopologyCarrier {
  return induceOpenaiAgentTopology([...(model?.utterances ?? []), ...a.utterances]);
}

export const actions = Object.freeze([
  canonicalizeOpenaiModelAction,
  canonicalizeOpenaiAgentAction,
  canonicalizeOpenaiAgentTopologyAction,
]);
