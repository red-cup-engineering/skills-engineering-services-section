/**
 * pulse — the message-triggered agent step that turns a chat into continuous
 * learning. No ticking service: a pulse fires once per received message (step
 * automation), and that is the only clock the agent needs.
 *
 * One pulse, in order:
 *   1. chat   — run the message against the chat endpoint for a reply
 *   2. log    — append the user message, the reply, and the run's findings to the
 *               shared data mount (data/log/YYYY/MM/DD/…-<namespace>-log.jsonl)
 *   3. derive — read the whole log back and settle it into per-subject state
 *   4. judge  — decide, from that state and the cadence, whether to dream
 *   5. dream  — if judged necessary: run the INWARD dream first (animating's
 *               finite, zero-dollar consolidation), build a dream context from the
 *               settled memory, and send it to the dream endpoint (the agent's own
 *               or a better one) as an APERIODIC dream — the boundary where new
 *               generators enter from outside the settled fibers. The dream is
 *               logged and a record (a settled filtration cut) is written.
 *
 * The corpus is explicit (content/…/dreaming-tick, llm-agents/dreaming): inward
 * dreaming is finite-settling and free; the aperiodic LLM dream is the only part
 * that spends. So a pulse only spends on a dream when its judgment calls for one.
 */

import {
  user as userMessage,
  ChatMessageSchema,
  CostEventSchema,
  type Conversation,
  type CostEvent,
} from "@emsenn/organizing-with-llm-agents/algebra";
import { aperiodicDream, type DreamResponder } from "@emsenn/organizing-with-llm-agents/dreaming";
import { task } from "@emsenn/knowing/dreaming";
import {
  appendLog,
  cutRecord,
  dataMountRoot,
  readLog,
  type JsonValue,
} from "@emsenn/organizing-with-llm-agents/mount";
import {
  dreamFindings,
  finding,
  findingLogEntry,
  findingsStateFold,
  readSessionFindings,
  settleFindings,
  type Finding,
  type SettledFindingsState,
} from "@emsenn/organizing-with-llm-agents/session";
import { claim, carrierFrom, mark, predicateOfClaim, token, valueOf, witnessedPotential, action, tm } from "@emsenn/relating";
import { RunChatResultSchema, CostRatesSchema } from "./run.mjs";
import { defaultModelFor, firstAvailableEndpoint, resolveEndpoint, type EndpointRef } from "./endpoints.mjs";
import { openaiAgentInfer } from "./inference.mjs";
import { runChat, runFindings, type CostRates, type RunChatResult } from "./run.mjs";

const DREAM_SYSTEM =
  "You are the dreaming pass of an agent: consolidate, between turns, what this " +
  "session has durably learned. You are not answering the user. Read the settled " +
  "memory and recent dialogue, then state 1–5 concise, durable lessons the agent " +
  "should carry forward. Prefer generalizations and corrections over restatement.";

/** The verdict of a pulse's dream judgment. */
export type DreamJudgment = Readonly<{ dream: boolean; reason: string }>;

export const DreamJudgmentSchema = { "$id": "organizing/agents/openai/pulse/dream-judgment", "title": "OpenaiAgentDreamJudgment", "additionalProperties": false, type: "object", required: ["dream", "reason"], properties: { "dream": { type: "boolean" }, "reason": { type: "string" } } } as const;

export const dreamJudgmentCarrier = carrierFrom(DreamJudgmentSchema);

/** What the judge sees: the derived state and the cadence counters. */
export type JudgeContext = Readonly<{
  state: SettledFindingsState;
  assistantTurns: number;
  dreamsSoFar: number;
  dreamEvery: number;
}>;

export const JudgeContextSchema = { "$id": "organizing/agents/openai/pulse/judge-context", "title": "OpenaiAgentJudgeContext", "additionalProperties": false, type: "object", required: ["state", "assistantTurns", "dreamsSoFar", "dreamEvery"], properties: { "state": {}, "assistantTurns": { type: "integer", "minimum": 0 }, "dreamsSoFar": { type: "integer", "minimum": 0 }, "dreamEvery": { type: "integer", "minimum": 1 } } } as const;

export const judgeContextCarrier = carrierFrom(JudgeContextSchema);

/** The default judge: dream on cadence (every `dreamEvery` turns) or whenever a
 *  subject is held-contested (⊤/stable) or a gap (⊥/absurd) — those want
 *  consolidation now, not on the next cadence beat. */
export function defaultJudge(ctx: JudgeContext): DreamJudgment {
  const unsettled = ctx.state.subjects.find((s) => s.status === "stable" || s.status === "absurd");
  if (unsettled !== undefined) {
    return { dream: true, reason: `subject ${unsettled.subject.join("/")} is ${unsettled.status}` };
  }
  if (ctx.assistantTurns > 0 && ctx.assistantTurns % ctx.dreamEvery === 0) {
    return { dream: true, reason: `cadence: ${ctx.assistantTurns} turns` };
  }
  return { dream: false, reason: `cadence: ${ctx.assistantTurns} of ${ctx.dreamEvery}` };
}

/** Configuration for a pulsing agent. */
export type PulseConfig = Readonly<{
  /** The conversation/session id (also the agent instance id). */
  session: string;
  /** Chat endpoint ref; defaults to the first available (NVIDIA, then Groq). */
  chatEndpoint?: EndpointRef;
  /** Dream endpoint ref ("a better endpoint, one for dreaming"); defaults to chat. */
  dreamEndpoint?: EndpointRef;
  /** Chat model; defaults to the endpoint's default model. */
  model?: string;
  /** Dream model; defaults to the dream endpoint's default model. */
  dreamModel?: string;
  /** System prompt for chat turns. */
  system?: string;
  /** Mount namespace; defaults to "openai-agent" so co-mounted computers don't clobber. */
  namespace?: string;
  /** Data mount root; defaults to <cwd>/data. */
  root?: string;
  /** Dream cadence in assistant turns (default 3). */
  dreamEvery?: number;
  /** Judge override; defaults to defaultJudge. */
  judge?: (ctx: JudgeContext) => DreamJudgment;
  /** Cost rates to stamp run cost events with. */
  cost?: CostRates;
}>;

export const PulseConfigSchema = { "$id": "organizing/agents/openai/pulse/config", "title": "OpenaiAgentPulseConfig", "additionalProperties": false, type: "object", required: ["session"], properties: { "session": { type: "string", "minLength": 1 }, "chatEndpoint": {}, "dreamEndpoint": {}, "model": { type: "string", "minLength": 1 }, "dreamModel": { type: "string", "minLength": 1 }, "system": { type: "string" }, "namespace": { type: "string", "minLength": 1 }, "root": { type: "string", "minLength": 1 }, "dreamEvery": { type: "integer", "minimum": 1 }, "judge": {}, "cost": CostRatesSchema } } as const;

export const pulseConfigCarrier = carrierFrom(PulseConfigSchema);

/** What a dream produced. */
export type PulseDream = Readonly<{
  inwardRegime: string;
  inwardObservations: number;
  endpoint: string;
  model: string;
  text: string;
  charge: string;
  recordPath: string;
}>;

export const PulseDreamSchema = { "$id": "organizing/agents/openai/pulse/dream", "title": "OpenaiAgentPulseDream", "additionalProperties": false, type: "object", required: ["inwardRegime", "inwardObservations", "endpoint", "model", "text", "charge", "recordPath"], properties: { "inwardRegime": { type: "string", "minLength": 1 }, "inwardObservations": { type: "integer", "minimum": 0 }, "endpoint": { type: "string", "minLength": 1 }, "model": { type: "string", "minLength": 1 }, "text": { type: "string" }, "charge": { type: "string", "minLength": 1 }, "recordPath": { type: "string", "minLength": 1 } } } as const;

export const pulseDreamCarrier = carrierFrom(PulseDreamSchema);

/** The settled outcome of one pulse. */
export type PulseResult = Readonly<{
  reply: string;
  run: RunChatResult;
  conversation: Conversation;
  logged: number;
  state: SettledFindingsState;
  judgment: DreamJudgment;
  cost: CostEvent;
  dream: PulseDream | null;
}>;

export const PulseResultSchema = { "$id": "organizing/agents/openai/pulse/result", "title": "OpenaiAgentPulseResult", "additionalProperties": false, type: "object", required: ["reply", "run", "conversation", "logged", "state", "judgment", "cost", "dream"], properties: { "reply": { type: "string" }, "run": RunChatResultSchema, "conversation": { type: "array", items: ChatMessageSchema }, "logged": { type: "integer", "minimum": 0 }, "state": {}, "judgment": DreamJudgmentSchema, "cost": CostEventSchema, "dream": { anyOf: [PulseDreamSchema, { type: "null" }] } } } as const;

export const pulseResultCarrier = carrierFrom(PulseResultSchema);

export const canonicalizeDreamJudgmentAction = action({
  verb: "organizing.agents.openai.pulse.canonicalize-dream-judgment",
  description: "Canonicalize an OpenAI agent pulse dream judgment.",
  domain: dreamJudgmentCarrier,
  codomain: dreamJudgmentCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeJudgeContextAction = action({
  verb: "organizing.agents.openai.pulse.canonicalize-judge-context",
  description: "Canonicalize an OpenAI agent pulse judge context.",
  domain: judgeContextCarrier,
  codomain: judgeContextCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizePulseConfigAction = action({
  verb: "organizing.agents.openai.pulse.canonicalize-config",
  description: "Canonicalize an OpenAI agent pulse configuration.",
  domain: pulseConfigCarrier,
  codomain: pulseConfigCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizePulseDreamAction = action({
  verb: "organizing.agents.openai.pulse.canonicalize-dream",
  description: "Canonicalize an OpenAI agent pulse dream carrier.",
  domain: pulseDreamCarrier,
  codomain: pulseDreamCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizePulseResultAction = action({
  verb: "organizing.agents.openai.pulse.canonicalize-result",
  description: "Canonicalize an OpenAI agent pulse result carrier.",
  domain: pulseResultCarrier,
  codomain: pulseResultCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const pulseActions = Object.freeze([
  canonicalizeDreamJudgmentAction,
  canonicalizeJudgeContextAction,
  canonicalizePulseConfigAction,
  canonicalizePulseDreamAction,
  canonicalizePulseResultAction,
]);

const PREFERRED = ["nvidia", "groq"] as const;

function resolveChatEndpoint(config: PulseConfig): EndpointRef {
  if (config.chatEndpoint !== undefined) return config.chatEndpoint;
  const available = firstAvailableEndpoint({ prefer: PREFERRED });
  if (available === null) {
    throw new Error("pulse: no endpoint key present (set NVIDIA_API_KEY or GROQ_API_KEY, or pass chatEndpoint)");
  }
  return available.endpoint;
}

/**
 * Fire one pulse for a received message over a prior conversation. Returns the
 * reply, the settled state, the dream judgment, and — when the agent dreamed —
 * what the dream produced and where the record cut landed.
 */
export async function pulse(
  config: PulseConfig,
  promptText: string,
  conversation: Conversation = [],
): Promise<PulseResult> {
  const namespace = config.namespace ?? "openai-agent";
  const root = dataMountRoot(config.root === undefined ? {} : { root: config.root });
  const dreamEvery = config.dreamEvery ?? 3;
  const judge = config.judge ?? defaultJudge;
  const now = new Date().toISOString();

  // 1. chat
  const chatRef = resolveChatEndpoint(config);
  const chatEndpoint = resolveEndpoint(chatRef);
  const model = config.model ?? defaultModelFor(chatEndpoint);
  const infer = openaiAgentInfer(chatEndpoint);
  const run = await runChat(infer, {
    id: config.session,
    prompt: promptText,
    conversation,
    model,
    now,
    ...(config.system === undefined ? {} : { system: config.system }),
    ...(config.cost === undefined ? {} : { cost: config.cost }),
  });
  const reply = run.result.text;

  // 2. log message + reply + findings
  const messageEntries: JsonValue[] = [
    { t: now, kind: "message", session: config.session, role: "user", content: promptText },
    { t: now, kind: "message", session: config.session, role: "assistant", content: reply, endpoint: run.result.endpoint, model: run.result.model },
  ];
  const findingEntries: JsonValue[] = runFindings(run.run, { at: now }).map((f) => findingLogEntry(f, now));
  const logged = messageEntries.length + findingEntries.length;
  await appendLog(root, namespace, [...messageEntries, ...findingEntries], now);

  // 3. derive state from the whole log
  const allFindings = await readSessionFindings(root, namespace);
  const state = settleFindings(allFindings);

  // 4. judge
  const log = await readLog(root, namespace);
  const assistantTurns = log.filter((e) => isKind(e, "message") && field(e, "role") === "assistant").length;
  const dreamsSoFar = log.filter((e) => isKind(e, "dream")).length;
  const judgment = judge({ state, assistantTurns, dreamsSoFar, dreamEvery });

  // 5. dream, if judged necessary
  let dream: PulseDream | null = null;
  if (judgment.dream) {
    dream = await runDream(config, root, namespace, allFindings, conversation, reply, now);
  }

  return {
    reply,
    run,
    conversation: [...conversation, userMessage(promptText), run.run.turns[0]!.assistant],
    logged,
    state,
    judgment,
    cost: run.cost,
    ...(dream === null ? { dream: null } : { dream }),
  };
}

async function runDream(
  config: PulseConfig,
  root: string,
  namespace: string,
  findings: readonly Finding[],
  conversation: Conversation,
  lastReply: string,
  now: string,
): Promise<PulseDream> {
  // INWARD dream first: finite, zero-dollar consolidation of the settled fibers.
  const inward = dreamFindings(findings);

  // The dream context: settled memory + recent dialogue, for the aperiodic pass.
  const state = settleFindings(findings);
  const recent = [...conversation.slice(-6), { role: "assistant" as const, content: lastReply }]
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const context =
    `Settled memory (subject → status):\n` +
    state.subjects.map((s) => `- ${s.subject.join("/")} → ${s.status}`).join("\n") +
    `\n\nInward consolidation produced ${inward.observations.length} observation(s) ` +
    `under the ${inward.regime} regime.\n\nRecent dialogue:\n${recent}`;

  // APERIODIC dream: the LLM boundary where new generators enter.
  const dreamRef = config.dreamEndpoint ?? config.chatEndpoint ?? resolveChatEndpoint(config);
  const dreamEndpoint = resolveEndpoint(dreamRef);
  const dreamModel = config.dreamModel ?? defaultModelFor(dreamEndpoint);
  const dreamInfer = openaiAgentInfer(dreamEndpoint);
  let dreamText = "";
  let dreamEndpointId = dreamEndpoint.id;
  const responder: DreamResponder = async () => {
    const res = await dreamInfer({ messages: [userMessage(context)], system: DREAM_SYSTEM, model: dreamModel });
    dreamText = res.text;
    dreamEndpointId = res.endpoint;
    return witnessedPotential(mark({ dream: config.session, endpoint: res.endpoint, model: res.model }));
  };
  const dreamTask = task({
    subject: token(mark(["openai-agent.dream", config.session])),
    predicate: predicateOfClaim(claim(mark("consolidates"))),
    object: token(mark(["openai-agent.session", config.session])),
  });
  const aperiodic = await aperiodicDream(dreamTask, responder);
  const chargeName = valueOf(aperiodic.charge).name;

  // Log the dream + a finding carrying the lesson, then cut a record (a settled
  // filtration of the log).
  await appendLog(root, namespace, [
    {
      t: now, kind: "dream", session: config.session, regime: "aperiodic",
      inwardRegime: inward.regime, inwardObservations: inward.observations.length,
      endpoint: dreamEndpointId, model: dreamModel, charge: chargeName, text: dreamText,
    },
    findingLogEntry(finding({
      session: config.session,
      subject: [config.session, "dream"],
      predicate: "consolidated",
      charge: aperiodic.charge,
      object: { observations: inward.observations.length },
      at: now,
    }), now),
  ], now);
  const cut = await cutRecord(root, namespace, { at: now, id: `dream-${now.slice(0, 19).replace(/[:T]/g, "")}`, fold: findingsStateFold });

  return {
    inwardRegime: inward.regime,
    inwardObservations: inward.observations.length,
    endpoint: dreamEndpointId,
    model: dreamModel,
    text: dreamText,
    charge: chargeName,
    recordPath: cut.path,
  };
}

function isKind(entry: JsonValue, kind: string): boolean {
  return entry !== null && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, JsonValue>)["kind"] === kind;
}
function field(entry: JsonValue, key: string): JsonValue | undefined {
  return entry !== null && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, JsonValue>)[key] : undefined;
}
