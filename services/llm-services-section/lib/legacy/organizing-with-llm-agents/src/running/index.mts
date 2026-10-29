// @emsenn/organizing-with-llm-agents/running — the agentic loop as lesson evidence.
//
// An agent run is a monotone, append-only accumulation of turns. It projects to a
// @emsenn/knowing/learning evidence set, and its verdict is the knowledge-join of its
// per-step admission judgments (settleLessonJudgments) — knowing's ≤_k settlement (learning
// is the inside face; fresh animating handed it to knowing), not a hand-rolled fold. The run *settles* (reaches a
// fixed point) on a final answer with no tool calls; it is *obstructed* when a step
// or cost bound halts it before settling; and it is *contested* when a tool run holds
// a contradiction. An obstruction is a bound, never a "settled" claim.
//
// Charges are @emsenn/relating bilattice values; a held contradiction (⊤, the
// "stable" value name) is kept first-class, never collapsed. Cost folds serially
// over the emitted cost events — a projection over the log, not a replay.

import { action, carrierFrom, bottom, joinKnowledge, mark, negate, tm, valueOf, witnessedPotential, type ChargeCarrier, type ChargeValueName } from "@emsenn/relating";

import {
  ChatMessageSchema,
  ToolCallSchema,
} from "@emsenn/organizing-with-agents/algebra";
import {
  type LessonJudgment,
  type LessonSettlement,
  type LessonEvidence,
  settleLessonJudgments,
} from "@emsenn/knowing/learning";
import {
  type ChatMessage,
  type Conversation,
  type CostAmount,
  type CostEvent,
  type JsonValue,
  type ToolCall,
  CostEventSchema,
  composeCost,
} from "../algebra/index.mjs";

// ── tool runs ───────────────────────────────────────────────────────────────
/**
 * The outcome of running one tool call: ok (settled), refused (denied),
 * unsettled (no determinate result), or contested (a held contradiction).
 */
export type ToolRunStatus = "ok" | "refused" | "unsettled" | "contested";

export const ToolRunStatusSchema = { anyOf: [{ const: "ok" }, { const: "refused" }, { const: "unsettled" }, { const: "contested" }] } as const;

export const ToolRunSchema = { "$id": "organizing/agents/llm/running/tool-run", "title": "LlmToolRun", "additionalProperties": false, type: "object", required: ["call", "status", "charge", "ran", "gate"], properties: { "call": ToolCallSchema, "status": ToolRunStatusSchema, "charge": {}, "output": {}, "reason": { type: "string" }, "ran": { type: "boolean" }, "gate": { type: "string", "minLength": 1 } } } as const;

/**
 * One executed tool call and its outcome: the originating call, its status, its
 * bilattice charge, optional output and reason, whether it actually ran, and
 * the gate that produced the outcome.
 */
export type ToolRun = Readonly<{
  call: ToolCall;
  status: ToolRunStatus;
  charge: ChargeCarrier;
  output?: JsonValue;
  reason?: string;
  ran: boolean;
  /** which gate produced this outcome: tool-call, policy, capability, handler, … */
  gate: string;
}>;

export const toolRunCarrier = carrierFrom(ToolRunSchema);

/** The bilattice reading of a tool run: ok→potential, refused→denied, unsettled→⊥, contested→⊤. */
export function toolRunCharge(status: ToolRunStatus, witness: unknown): ChargeCarrier {
  switch (status) {
    case "ok":
      return witnessedPotential(mark(witness));
    case "refused":
      return negate(witnessedPotential(mark(witness)));
    case "unsettled":
      return bottom;
    case "contested":
      return joinKnowledge(witnessedPotential(mark(witness)), negate(witnessedPotential(mark(witness))));
  }
}

// ── turns ───────────────────────────────────────────────────────────────────
/**
 * One step of the agentic loop: its index, the assistant message, the tool
 * calls it emitted, the resulting tool runs, and an optional cost event.
 */
export type Turn = Readonly<{
  index: number;
  assistant: ChatMessage;
  toolCalls: readonly ToolCall[];
  toolRuns: readonly ToolRun[];
  cost?: CostEvent;
}>;

export const TurnSchema = { "$id": "organizing/agents/llm/running/turn", "title": "LlmAgentTurn", "additionalProperties": false, type: "object", required: ["index", "assistant", "toolCalls", "toolRuns"], properties: { "index": { type: "integer", "minimum": 0 }, "assistant": ChatMessageSchema, "toolCalls": { type: "array", items: ToolCallSchema }, "toolRuns": { type: "array", items: ToolRunSchema }, "cost": CostEventSchema } } as const;

export const turnCarrier = carrierFrom(TurnSchema);

// ── stopping ────────────────────────────────────────────────────────────────
/**
 * The reason a run halted: final-answer (settled), contested-tool (held
 * contradiction), or max-steps / cost-bound / max-unsettled (a bound that
 * obstructed it).
 */
export type LoopStop = "final-answer" | "contested-tool" | "max-steps" | "cost-bound" | "max-unsettled";

export const LoopStopSchema = { anyOf: [{ const: "final-answer" }, { const: "contested-tool" }, { const: "max-steps" }, { const: "cost-bound" }, { const: "max-unsettled" }] } as const;

/**
 * The settlement regime of a run: stabilized (reached a fixed point),
 * obstructed (halted by a bound), or contested (holds a contradiction).
 */
export type RunRegime = "stabilized" | "obstructed" | "contested";

export const RunRegimeSchema = { anyOf: [{ const: "stabilized" }, { const: "obstructed" }, { const: "contested" }] } as const;

/**
 * The run regime a stop reason implies: final-answer maps to stabilized,
 * contested-tool to contested, and the bound stops to obstructed.
 */
export function regimeOf(stop: LoopStop): RunRegime {
  switch (stop) {
    case "final-answer":
      return "stabilized";
    case "contested-tool":
      return "contested";
    case "max-steps":
    case "cost-bound":
    case "max-unsettled":
      return "obstructed";
  }
}

/** The bilattice reading of a stop: stabilized→potential, contested→⊤, obstructed→⊥. */
export function stopCharge(stop: LoopStop): ChargeCarrier {
  switch (regimeOf(stop)) {
    case "stabilized":
      return witnessedPotential(mark({ stop }));
    case "contested":
      return joinKnowledge(witnessedPotential(mark({ stop })), negate(witnessedPotential(mark({ stop }))));
    case "obstructed":
      return bottom;
  }
}

// ── the run carrier ───────────────────────────────────────────────────────────
/**
 * The run carrier: a monotone, append-only accumulation of a run's id, its
 * growing conversation, its turns and cost events, and - once halted - its stop
 * reason and final answer.
 */
export type AgentRun = Readonly<{
  id: string;
  /** the accumulating conversation; only ever grows */
  conversation: Conversation;
  turns: readonly Turn[];
  costEvents: readonly CostEvent[];
  stop: LoopStop | null;
  finalAnswer: string | null;
}>;

export const AgentRunSchema = { "$id": "organizing/agents/llm/running/agent-run", "title": "LlmAgentRun", "additionalProperties": false, type: "object", required: ["id", "conversation", "turns", "costEvents", "stop", "finalAnswer"], properties: { "id": { type: "string", "minLength": 1 }, "conversation": { type: "array", items: ChatMessageSchema }, "turns": { type: "array", items: TurnSchema }, "costEvents": { type: "array", items: CostEventSchema }, "stop": { anyOf: [LoopStopSchema, { type: "null" }] }, "finalAnswer": { anyOf: [{ type: "string" }, { type: "null" }] } } } as const;

export const agentRunCarrier = carrierFrom(AgentRunSchema);

/**
 * A fresh, unstopped run with the given id and optional seed conversation: no
 * turns, no cost events, no stop, no final answer.
 */
export function emptyRun(id: string, seed: Conversation = []): AgentRun {
  return { id, conversation: seed, turns: [], costEvents: [], stop: null, finalAnswer: null };
}

/**
 * Append a turn and the messages it produced. Enforces the monotone-growth law:
 * a settling stage may only add to its predecessor, never drop. Appending to an
 * already-stopped run is rejected.
 */
export function appendTurn(run: AgentRun, turn: Turn, messagesAdded: readonly ChatMessage[]): AgentRun {
  if (run.stop !== null) throw new Error(`appendTurn: run ${run.id} has already stopped (${run.stop})`);
  if (messagesAdded.length === 0) throw new Error("appendTurn: a turn must add at least one message");
  return {
    ...run,
    conversation: [...run.conversation, ...messagesAdded],
    turns: [...run.turns, turn],
    costEvents: turn.cost === undefined ? run.costEvents : [...run.costEvents, turn.cost],
  };
}

/** Settle (or obstruct) the run, recording the stop and any final answer. */
export function settleRun(run: AgentRun, stop: LoopStop, finalAnswer: string | null = null): AgentRun {
  if (run.stop !== null) throw new Error(`settleRun: run ${run.id} has already stopped (${run.stop})`);
  return { ...run, stop, finalAnswer };
}

/** Total cost: a serial fold over the emitted cost events (projection, not replay). */
export function runCost(run: AgentRun): CostAmount {
  return composeCost(run.costEvents, "serial");
}

// ── projection onto animating lesson evidence ─────────────────────────────────
/** The bilattice value name of a charge — the form animating learning judgments carry. */
export function chargeName(charge: ChargeCarrier): ChargeValueName {
  return valueOf(charge).name;
}

/** The run as animating lesson evidence: one entry per turn and per tool run. Charges
 *  are NOT seeded here - they are read from the judgments below, not the evidence. */
export function runLessonEvidence(run: AgentRun): readonly LessonEvidence[] {
  const entries: LessonEvidence[] = [];
  for (const turn of run.turns) {
    entries.push({ subject: run.id, predicate: "uttered-turn", object: `turn:${turn.index}`, provenance: { content: turn.assistant.content } });
    for (const toolRun of turn.toolRuns) {
      entries.push({
        subject: `turn:${turn.index}`,
        predicate: `tool-${toolRun.status}`,
        object: `tool:${toolRun.call.name}`,
        provenance: { gate: toolRun.gate, reason: toolRun.reason ?? null },
      });
    }
  }
  if (run.stop !== null) {
    entries.push({ subject: run.id, predicate: "stopped", object: run.stop, provenance: { finalAnswer: run.finalAnswer } });
  }
  return Object.freeze(entries);
}

/** One admission judgment per tool run plus one for the stop. */
export function runJudgments(run: AgentRun): readonly LessonJudgment[] {
  const judgments: LessonJudgment[] = run.turns.flatMap((turn) =>
    turn.toolRuns.map((toolRun) => ({
      name: `tool:${toolRun.call.name}`,
      value: chargeName(toolRun.charge),
      reason: toolRun.reason ?? toolRun.status,
      path: `run/${run.id}/turn/${turn.index}/tool/${toolRun.call.id ?? toolRun.call.name}`,
    })));
  if (run.stop !== null) {
    judgments.push({ name: `stop:${run.stop}`, value: chargeName(stopCharge(run.stop)), reason: run.stop, path: `run/${run.id}/stop` });
  }
  return judgments;
}

/** Settle the run by the knowledge-join of its judgments - animating learning's canonical settlement. */
export function settleRunJudgments(run: AgentRun): LessonSettlement {
  return settleLessonJudgments(runJudgments(run));
}

// ── classification (witness-or-obstruction, per invariant A1) ──────────────────
/**
 * The witness-or-obstruction verdict of a run: either settled with a stabilized
 * regime and a final answer, or unsettled with an obstructed or contested
 * regime and the stop reason; both carry the turn count and the judgment
 * settlement.
 */
export type RunClassification =
  | Readonly<{ settled: true; regime: "stabilized"; turns: number; finalAnswer: string; settlement: LessonSettlement }>
  | Readonly<{ settled: false; regime: "obstructed" | "contested"; turns: number; reason: LoopStop; settlement: LessonSettlement }>;

export const RunClassificationSchema = { "$id": "organizing/agents/llm/running/classification", "title": "LlmRunClassification", anyOf: [{ "additionalProperties": false, type: "object", required: ["settled", "regime", "turns", "finalAnswer", "settlement"], properties: { "settled": { const: true }, "regime": { const: "stabilized" }, "turns": { type: "integer", "minimum": 0 }, "finalAnswer": { type: "string" }, "settlement": {} } }, { "additionalProperties": false, type: "object", required: ["settled", "regime", "turns", "reason", "settlement"], properties: { "settled": { const: false }, "regime": { anyOf: [{ const: "obstructed" }, { const: "contested" }] }, "turns": { type: "integer", "minimum": 0 }, "reason": LoopStopSchema, "settlement": {} } }] } as const;

export const runClassificationCarrier = carrierFrom(RunClassificationSchema);

/**
 * Classifies a run into its witness-or-obstruction verdict from its judgment
 * settlement and stop: an unstopped run is obstructed, a stabilized stop is
 * settled with the final answer, and any other stop is unsettled.
 */
export function classifyRun(run: AgentRun): RunClassification {
  const settlement = settleRunJudgments(run);
  if (run.stop === null) {
    return { settled: false, regime: "obstructed", turns: run.turns.length, reason: "max-steps", settlement };
  }
  const regime = regimeOf(run.stop);
  if (regime === "stabilized") {
    return { settled: true, regime, turns: run.turns.length, finalAnswer: run.finalAnswer ?? "", settlement };
  }
  return { settled: false, regime, turns: run.turns.length, reason: run.stop, settlement };
}

export const canonicalizeAgentRunAction = action({
  verb: "organizing.llm.running.canonicalize-agent-run",
  summary: "Canonicalize an admitted LLM agent run carrier through the relational IR.",
  description: "Domain and codomain: an LlmAgentRun carrier. Body: the CHL identity term; operational run validates admission at both boundaries.",
  domain: agentRunCarrier,
  codomain: agentRunCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const actions = Object.freeze([
  canonicalizeAgentRunAction,
]);
