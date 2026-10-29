/**
 * run — the agentic chat-run driver, run-trace projection, and cross-agent
 * handoff. This is the substrate that lets each computer (a codex, a claude, an
 * nvidia agent) be "mounted into the same stuff" and so interoperate, talk, and
 * hand off:
 *
 *   - chatTurn / runChat drive an OpenaiAgentInfer over a conversation and
 *     accumulate the canonical @emsenn/organizing-with-llm-agents/running carrier
 *     (emptyRun → appendTurn → settleRun), so a run settles, obstructs, or holds
 *     a contradiction by the same bilattice law every agent loop uses.
 *   - runFindings projects a settled run into the shared coding-agent finding
 *     vocabulary (the same Finding codex and claude-code-cli sessions record), so
 *     runs from any endpoint recall against each other.
 *   - handoff carries one agent's conversation and answer to a successor agent,
 *     plus the relational hands-off-to utterance — the upstream home for the
 *     cross-agent handoff the ops manifold previously kept only as a bin.
 *
 * The driver reads the clock (it already does network IO); every pure projection
 * downstream takes the timestamps it stamped.
 */
import {
  assistant,
  system as systemMessage,
  user,
  inferenceCostEvent,
  ChatMessageSchema,
  CostEventSchema,
  InferenceResultSchema,
  type ChatMessage,
  type Conversation,
  type CostEvent,
  type InferenceResult,
} from "@emsenn/organizing-with-llm-agents/algebra";

export type { CostEvent } from "@emsenn/organizing-with-llm-agents/algebra";
import {
  appendTurn,
  classifyRun,
  emptyRun,
  settleRun,
  stopCharge,
  AgentRunSchema,
  RunClassificationSchema,
  type AgentRun,
  type RunClassification,
  type Turn,
} from "@emsenn/organizing-with-llm-agents/running";

import { action, carrierFrom, mark, tm, utterance, witnessedPotential, type UtteranceCarrier } from "@emsenn/relating";
import { finding, type Finding } from "@emsenn/organizing-with-llm-agents/session";
import { openaiAgentTerm } from "./topology.mjs";
import type { OpenaiAgentInfer } from "./inference.mjs";

/** Per-million-token dollar rates used to stamp a run's cost events. */
export type CostRates = Readonly<{
  dollarsPerMillionInputTokens?: number;
  dollarsPerMillionOutputTokens?: number;
  charsPerToken?: number;
}>;

export const CostRatesSchema = { "$id": "organizing/agents/openai/run/cost-rates", "title": "OpenaiAgentCostRates", "additionalProperties": false, type: "object", properties: { "dollarsPerMillionInputTokens": { type: "number", "minimum": 0 }, "dollarsPerMillionOutputTokens": { type: "number", "minimum": 0 }, "charsPerToken": { type: "number", "minimum": 0 } } } as const;

export const costRatesCarrier = carrierFrom(CostRatesSchema);

/** Options for one chat run. */
export type RunChatOptions = Readonly<{
  /** Run id; also the agent instance id in the finding/handoff vocabulary. */
  id: string;
  /** The user prompt to answer. */
  prompt: string;
  /** Optional system prompt prepended to the conversation. */
  system?: string;
  /** Prior conversation to continue (e.g. a handoff seed). */
  conversation?: Conversation;
  /** Model id; defaults to the bound endpoint's default when omitted. */
  model?: string;
  /** ISO instant to stamp the turn and cost with; defaults to the live clock. */
  now?: string;
  /** Cost rates for the cost event. */
  cost?: CostRates;
}>;

export const RunChatOptionsSchema = { "$id": "organizing/agents/openai/run/chat-options", "title": "OpenaiAgentRunChatOptions", "additionalProperties": false, type: "object", required: ["id", "prompt"], properties: { "id": { type: "string", "minLength": 1 }, "prompt": { type: "string" }, "system": { type: "string" }, "conversation": { type: "array", items: ChatMessageSchema }, "model": { type: "string", "minLength": 1 }, "now": { type: "string", "minLength": 1 }, "cost": CostRatesSchema } } as const;

export const runChatOptionsCarrier = carrierFrom(RunChatOptionsSchema);

/** The settled outcome of one chat run. */
export type RunChatResult = Readonly<{
  run: AgentRun;
  result: InferenceResult;
  classification: RunClassification;
  cost: CostEvent;
}>;

export const RunChatResultSchema = { "$id": "organizing/agents/openai/run/chat-result", "title": "OpenaiAgentRunChatResult", "additionalProperties": false, type: "object", required: ["run", "result", "classification", "cost"], properties: { "run": AgentRunSchema, "result": InferenceResultSchema, "classification": RunClassificationSchema, "cost": CostEventSchema } } as const;

export const runChatResultCarrier = carrierFrom(RunChatResultSchema);

/**
 * Drive one inference turn over a conversation: infer, build the assistant
 * message, and stamp a cost event. Pure but for the injected infer and clock.
 */
export async function chatTurn(
  infer: OpenaiAgentInfer,
  conversation: Conversation,
  options: Readonly<{ model?: string; system?: string; now?: string; cost?: CostRates }> = {},
): Promise<Readonly<{ result: InferenceResult; assistant: ChatMessage; cost: CostEvent }>> {
  const result = await infer({
    messages: conversation,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.system === undefined ? {} : { system: options.system }),
  });
  const transactionTime = options.now ?? new Date().toISOString();
  const cost = inferenceCostEvent(result, {
    operation: "chatting",
    transactionTime,
    ...(options.cost?.dollarsPerMillionInputTokens === undefined ? {} : { dollarsPerMillionInputTokens: options.cost.dollarsPerMillionInputTokens }),
    ...(options.cost?.dollarsPerMillionOutputTokens === undefined ? {} : { dollarsPerMillionOutputTokens: options.cost.dollarsPerMillionOutputTokens }),
    ...(options.cost?.charsPerToken === undefined ? {} : { charsPerToken: options.cost.charsPerToken }),
  });
  return { result, assistant: assistant(result.text), cost };
}

/**
 * Run a single-prompt chat to settlement: seed the conversation (optional system,
 * prior turns, the user prompt), infer one turn, append it, and settle the run on
 * the final answer. The run carrier and its classification come back so callers
 * can fold cost, project findings, or hand off.
 */
export async function runChat(infer: OpenaiAgentInfer, options: RunChatOptions): Promise<RunChatResult> {
  const seed: Conversation = [
    ...(options.system === undefined ? [] : [systemMessage(options.system)]),
    ...(options.conversation ?? []),
    user(options.prompt),
  ];
  let run = emptyRun(options.id, seed);
  const turn = await chatTurn(infer, run.conversation, {
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.cost === undefined ? {} : { cost: options.cost }),
  });
  const fullTurn: Turn = {
    index: run.turns.length,
    assistant: turn.assistant,
    toolCalls: turn.result.toolCalls ?? [],
    toolRuns: [],
    cost: turn.cost,
  };
  run = appendTurn(run, fullTurn, [turn.assistant]);
  run = settleRun(run, "final-answer", turn.result.text);
  return { run, result: turn.result, classification: classifyRun(run), cost: turn.cost };
}

/**
 * Project a settled run into the shared coding-agent finding vocabulary: one
 * potential finding per uttered turn and one for the stop, charged by the run's
 * own stop regime. The session string is the run id, so these findings recall
 * alongside codex and claude-code-cli findings.
 */
export function runFindings(run: AgentRun, options: Readonly<{ at?: string }> = {}): readonly Finding[] {
  const at = options.at;
  const findings: Finding[] = run.turns.map((turn) =>
    finding({
      session: run.id,
      subject: [run.id, "turn", String(turn.index)],
      predicate: "agent.turn.uttered",
      charge: witnessedPotential(mark({ run: run.id, turn: turn.index })),
      ...(at === undefined ? {} : { at }),
    }),
  );
  if (run.stop !== null) {
    findings.push(
      finding({
        session: run.id,
        subject: [run.id],
        predicate: "agent.run.stopped",
        charge: stopCharge(run.stop),
        object: { stop: run.stop, finalAnswer: run.finalAnswer },
        ...(at === undefined ? {} : { at }),
      }),
    );
  }
  return Object.freeze(findings);
}

/** The cost events a run accumulated — a projection over its log, not a replay. */
export function runCostEvents(run: AgentRun): readonly CostEvent[] {
  return run.costEvents;
}

// ── cross-agent handoff ─────────────────────────────────────────────────────
/** A handoff from one agent to another: the seed conversation the successor
 *  resumes from, and the relational hands-off-to utterance. */
export type Handoff = Readonly<{
  from: string;
  to: string;
  /** The conversation the receiving agent should resume from. */
  seed: Conversation;
  /** from-agent --hands-off-to--> to-agent, for the topology. */
  utterance: UtteranceCarrier;
}>;

export const HandoffSchema = { "$id": "organizing/agents/openai/run/handoff", "title": "OpenaiAgentHandoff", "additionalProperties": false, type: "object", required: ["from", "to", "seed", "utterance"], properties: { "from": { type: "string", "minLength": 1 }, "to": { type: "string", "minLength": 1 }, "seed": { type: "array", items: ChatMessageSchema }, "utterance": {} } } as const;

export const handoffCarrier = carrierFrom(HandoffSchema);

export const canonicalizeCostRatesAction = action({
  verb: "organizing.agents.openai.run.canonicalize-cost-rates",
  description: "Canonicalize OpenAI agent run cost rates.",
  domain: costRatesCarrier,
  codomain: costRatesCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeRunChatOptionsAction = action({
  verb: "organizing.agents.openai.run.canonicalize-chat-options",
  description: "Canonicalize OpenAI agent chat-run options.",
  domain: runChatOptionsCarrier,
  codomain: runChatOptionsCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeRunChatResultAction = action({
  verb: "organizing.agents.openai.run.canonicalize-chat-result",
  description: "Canonicalize an OpenAI agent chat-run result.",
  domain: runChatResultCarrier,
  codomain: runChatResultCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeHandoffAction = action({
  verb: "organizing.agents.openai.run.canonicalize-handoff",
  description: "Canonicalize an OpenAI agent handoff carrier.",
  domain: handoffCarrier,
  codomain: handoffCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const runActions = Object.freeze([
  canonicalizeCostRatesAction,
  canonicalizeRunChatOptionsAction,
  canonicalizeRunChatResultAction,
  canonicalizeHandoffAction,
]);

/** floor predicate: openai-agent --hands-off-to--> openai-agent. */
export function handsOffToPredicate(): string {
  return "openai-agent.hands-off-to";
}

/**
 * Hand a finished run off to a successor agent. The successor resumes from the
 * full conversation (optionally with a handoff note appended as a system turn),
 * and the relational hands-off-to utterance records the edge so both agents sit
 * in one settled topology. This is the upstream primitive the ops manifold's
 * handoff-agent bin should consume rather than reimplement.
 */
export function handoff(
  run: AgentRun,
  toAgentId: string,
  options: Readonly<{ note?: string }> = {},
): Handoff {
  const seed: Conversation = [
    ...run.conversation,
    ...(options.note === undefined ? [] : [systemMessage(options.note)]),
  ];
  return Object.freeze({
    from: run.id,
    to: toAgentId,
    seed: Object.freeze([...seed]),
    utterance: utterance(
      mark({ subject: openaiAgentTerm(run.id), object: openaiAgentTerm(toAgentId) }),
      mark(handsOffToPredicate()),
    ),
  });
}
