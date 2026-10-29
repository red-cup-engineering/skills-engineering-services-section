/**
 * memory — recall a namespace's settled memory WITHOUT taking a turn.
 *
 * The pulse writes memory: every turn it logs findings and, on judgment, dreams
 * a consolidation into the shared data mount under one namespace. That is enough
 * for a single long-lived conversation (the TUI keeps the dialogue in a closure).
 * A stateless caller — a web request that holds no closure between turns — needs
 * the dual: read back what a namespace has durably learned so it can be fused
 * into the next turn's system prompt BEFORE the turn runs.
 *
 * `recallMemory` reads the namespace log, settles its findings into per-subject
 * state (the same fold the pulse's derive step uses), gathers the most recent
 * dream consolidations, and renders a compact, promptable summary. It spends
 * nothing and runs no inference — it is pure recall over the mount.
 */

import {
  dataMountRoot,
  readLog,
  type JsonValue,
} from "@emsenn/organizing-with-llm-agents/mount";
import {
  readSessionFindings,
  settleFindings,
  type SettledFindingsState,
} from "@emsenn/organizing-with-llm-agents/session";
import { action, carrierFrom, tm } from "@emsenn/relating";

/** What a namespace durably remembers, recalled from the mount. */
export type RecalledMemory = Readonly<{
  /** The mount namespace this memory was recalled from. */
  namespace: string;
  /** The settled per-subject state (potential / active / held / gap). */
  state: SettledFindingsState;
  /** The most recent dream consolidations, oldest-first, as plain lesson text. */
  dreams: readonly string[];
  /** A compact rendering suitable for prepending to a system prompt. Empty when
   *  nothing has been learned yet. */
  summary: string;
}>;

export const RecalledMemorySchema = { "$id": "organizing/agents/openai/memory/recalled", "title": "OpenaiAgentRecalledMemory", "additionalProperties": false, type: "object", required: ["namespace", "state", "dreams", "summary"], properties: { "namespace": { type: "string", "minLength": 1 }, "state": {}, "dreams": { type: "array", items: { type: "string" } }, "summary": { type: "string" } } } as const;

export const recalledMemoryCarrier = carrierFrom(RecalledMemorySchema);

/** Options for recalling a namespace's memory. */
export type RecallMemoryOptions = Readonly<{
  /** Data mount root; defaults to <cwd>/data (matches the pulse default). */
  root?: string;
  /** Mount namespace; defaults to "openai-agent" (matches the pulse default). */
  namespace?: string;
  /** How many recent dream consolidations to carry into the summary (default 3). */
  dreamLimit?: number;
}>;

export const RecallMemoryOptionsSchema = { "$id": "organizing/agents/openai/memory/recall-options", "title": "OpenaiAgentRecallMemoryOptions", "additionalProperties": false, type: "object", properties: { "root": { type: "string", "minLength": 1 }, "namespace": { type: "string", "minLength": 1 }, "dreamLimit": { type: "integer", "minimum": 0 } } } as const;

export const recallMemoryOptionsCarrier = carrierFrom(RecallMemoryOptionsSchema);

export const canonicalizeRecalledMemoryAction = action({
  verb: "organizing.agents.openai.memory.canonicalize-recalled",
  description: "Canonicalize an OpenAI agent recalled-memory carrier.",
  domain: recalledMemoryCarrier,
  codomain: recalledMemoryCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeRecallMemoryOptionsAction = action({
  verb: "organizing.agents.openai.memory.canonicalize-recall-options",
  description: "Canonicalize OpenAI agent memory recall options.",
  domain: recallMemoryOptionsCarrier,
  codomain: recallMemoryOptionsCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const memoryActions = Object.freeze([
  canonicalizeRecalledMemoryAction,
  canonicalizeRecallMemoryOptionsAction,
]);

function field(entry: JsonValue, key: string): JsonValue | undefined {
  return entry !== null && typeof entry === "object" && !Array.isArray(entry)
    ? (entry as Record<string, JsonValue>)[key]
    : undefined;
}

/** Recall a namespace's settled memory from the data mount. */
export async function recallMemory(options: RecallMemoryOptions = {}): Promise<RecalledMemory> {
  const namespace = options.namespace ?? "openai-agent";
  const root = dataMountRoot(options.root === undefined ? {} : { root: options.root });
  const dreamLimit = options.dreamLimit ?? 3;

  const log = await readLog(root, namespace);
  const findings = await readSessionFindings(root, namespace);
  const state = settleFindings(findings);
  const dreams = log
    .filter((e) => field(e, "kind") === "dream")
    .map((e) => field(e, "text"))
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .slice(-dreamLimit);

  return { namespace, state, dreams, summary: renderSummary(state, dreams) };
}

/** Render settled state + recent dreams into a promptable memory block. */
export function renderSummary(state: SettledFindingsState, dreams: readonly string[]): string {
  const lines: string[] = [];
  const knowable = state.subjects.filter((s) => s.subject.length > 0);
  if (knowable.length > 0) {
    lines.push("What you durably remember about this person (settled across your prior conversations):");
    for (const s of knowable) lines.push(`- ${s.subject.join("/")} → ${s.status}`);
  }
  if (dreams.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Lessons you consolidated in earlier reflection:");
    for (const d of dreams) lines.push(d.trim());
  }
  return lines.join("\n");
}
