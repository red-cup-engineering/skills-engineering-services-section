/**
 * Claude CLI event projection.
 *
 * `claude --print --output-format json` emits a single JSON array of events;
 * `--output-format stream-json` emits the same events newline-delimited. Both are
 * the right automation boundary, so this module keeps it and projects each event
 * into the shared relational trace vocabulary (@emsenn/relating utterances/cells,
 * @emsenn/animating work, @emsenn/organizing-with-claude cost) — symmetric to
 * the codex `codex exec --json` projection, so a manifold can publish the
 * evidence without inventing another DTO. NOTHING here spawns or reads sockets.
 */
import { createHash } from "node:crypto";
import {
  cell,
  charge,
  chargeValue,
  claim,
  action,
  carrierFrom,
  mark,
  predicateOfClaim,
  tm,
  token,
  utterance,
  type ChargeCarrier,
  type ChargeValueName,
  type Mark,
  type PredicationPredicate,
  type PredicationTerm,
  type UtteranceCarrier,
} from "@emsenn/relating";
import { canonical, isJsonRecord, parseJsonlLines, requireJsonValue, type JsonValue } from "@emsenn/relating/writing";
import type { CostEvent } from "@emsenn/organizing-with-claude/inference";
import { finding, type Finding } from "@emsenn/organizing-with-claude/session";

export type ClaudeEvent = Readonly<Record<string, unknown> & { readonly type: string }>;

export const ClaudeEventSchema = {
  $id: "organizing/claude/code-cli/events/event",
  type: "object",
  title: "ClaudeCliEvent",
  required: ["type"],
  properties: {
    type: { type: "string", minLength: 1 },
  },
  additionalProperties: {},
} as const;

/** The terminal `result` event, the authoritative envelope of a print-mode run. */
export interface ClaudeResult {
  readonly type: "result";
  readonly subtype?: string;
  readonly isError: boolean;
  readonly sessionId?: string;
  readonly result?: string;
  readonly numTurns?: number;
  readonly durationMs?: number;
  readonly totalCostUsd?: number;
  readonly usage?: Readonly<Record<string, unknown>>;
  readonly modelUsage?: Readonly<Record<string, unknown>>;
  readonly permissionDenials?: readonly unknown[];
  readonly terminalReason?: string;
  readonly raw: ClaudeEvent;
}

export const ClaudeResultSchema = {
  $id: "organizing/claude/code-cli/events/result",
  type: "object",
  title: "ClaudeCliResult",
  required: ["type", "isError", "raw"],
  properties: {
    type: { const: "result" },
    subtype: { type: "string", minLength: 1 },
    isError: { type: "boolean" },
    sessionId: { type: "string", minLength: 1 },
    result: { type: "string" },
    numTurns: { type: "number", minimum: 0 },
    durationMs: { type: "number", minimum: 0 },
    totalCostUsd: { type: "number", minimum: 0 },
    usage: { type: "object", additionalProperties: {} },
    modelUsage: { type: "object", additionalProperties: {} },
    permissionDenials: { type: "array", items: {} },
    terminalReason: { type: "string", minLength: 1 },
    raw: ClaudeEventSchema,
  },
  additionalProperties: false,
} as const;

export const claudeResultCarrier = carrierFrom(ClaudeResultSchema);

export interface ClaudeTraceCarrier {
  readonly kind: "claude.cli.trace";
  readonly run: string;
  readonly events: readonly ClaudeEvent[];
  readonly entries: readonly TraceEntry[];
  readonly utterances: readonly UtteranceCarrier[];
  readonly readings: readonly TraceCellReading[];
  readonly findings: readonly Finding[];
  readonly work: readonly WorkItem[];
  readonly reports: readonly WorkReport[];
}

const ChargeValueNameSchema = { enum: ["absurd", "potential", "active", "stable"] } as const;

export const TraceEntrySchema = {
  $id: "organizing/claude/code-cli/events/trace-entry",
  type: "object",
  title: "ClaudeCliTraceEntry",
  required: ["subject", "predicate", "object", "provenance"],
  properties: {
    subject: { type: "string", minLength: 1 },
    predicate: { type: "string", minLength: 1 },
    object: {},
    provenance: {},
  },
  additionalProperties: false,
} as const;

export const TraceCellReadingSchema = {
  $id: "organizing/claude/code-cli/events/trace-cell-reading",
  type: "object",
  title: "ClaudeCliTraceCellReading",
  required: ["subject", "predicate", "object", "value", "provenance"],
  properties: {
    subject: { type: "string", minLength: 1 },
    predicate: { type: "string", minLength: 1 },
    object: {},
    value: ChargeValueNameSchema,
    provenance: {},
  },
  additionalProperties: false,
} as const;

export const ClaudeWorkTaskSchema = {
  $id: "organizing/claude/code-cli/events/work-task",
  type: "object",
  title: "ClaudeCliWorkTask",
  required: ["kind", "term", "goals", "evidence"],
  properties: {
    kind: { const: "claude.cli.work.task" },
    term: {},
    goals: { type: "array", items: {} },
    evidence: { type: "array", items: {} },
  },
  additionalProperties: false,
} as const;

export const ClaudeWorkItemSchema = {
  $id: "organizing/claude/code-cli/events/work-item",
  type: "object",
  title: "ClaudeCliWorkItem",
  required: ["kind", "term", "task", "office", "evidence"],
  properties: {
    kind: { const: "claude.cli.work.item" },
    term: {},
    task: ClaudeWorkTaskSchema,
    office: {},
    evidence: { type: "array", items: {} },
  },
  additionalProperties: false,
} as const;

export const ClaudeWorkReportSchema = {
  $id: "organizing/claude/code-cli/events/work-report",
  type: "object",
  title: "ClaudeCliWorkReport",
  required: ["kind", "term", "work", "office", "charge", "evidence"],
  properties: {
    kind: { const: "claude.cli.work.report" },
    term: {},
    work: ClaudeWorkItemSchema,
    office: {},
    charge: {},
    evidence: { type: "array", items: {} },
  },
  additionalProperties: false,
} as const;

export const ClaudeTraceCarrierSchema = {
  $id: "organizing/claude/code-cli/events/trace",
  type: "object",
  title: "ClaudeCliTraceCarrier",
  required: ["kind", "run", "events", "entries", "utterances", "readings", "findings", "work", "reports"],
  properties: {
    kind: { const: "claude.cli.trace" },
    run: { type: "string", minLength: 1 },
    events: { type: "array", items: ClaudeEventSchema },
    entries: { type: "array", items: TraceEntrySchema },
    utterances: { type: "array", items: {} },
    readings: { type: "array", items: TraceCellReadingSchema },
    findings: { type: "array", items: {} },
    work: { type: "array", items: ClaudeWorkItemSchema },
    reports: { type: "array", items: ClaudeWorkReportSchema },
  },
  additionalProperties: false,
} as const;

export const traceEntryCarrier = carrierFrom(TraceEntrySchema);

export const traceCellReadingCarrier = carrierFrom(TraceCellReadingSchema);

export const claudeWorkTaskCarrier = carrierFrom(ClaudeWorkTaskSchema);

export const claudeWorkItemCarrier = carrierFrom(ClaudeWorkItemSchema);

export const claudeWorkReportCarrier = carrierFrom(ClaudeWorkReportSchema);

export const claudeTraceCarrier = carrierFrom(ClaudeTraceCarrierSchema);

export const canonicalizeClaudeResultAction = action({
  verb: "organizing.claude.code-cli.events.canonicalize-result",
  description: "Canonicalize a Claude CLI result event projection.",
  domain: claudeResultCarrier,
  codomain: claudeResultCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeTraceEntryAction = action({
  verb: "organizing.claude.code-cli.events.canonicalize-trace-entry",
  description: "Canonicalize a Claude CLI trace entry.",
  domain: traceEntryCarrier,
  codomain: traceEntryCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeTraceCellReadingAction = action({
  verb: "organizing.claude.code-cli.events.canonicalize-trace-cell-reading",
  description: "Canonicalize a Claude CLI trace cell reading.",
  domain: traceCellReadingCarrier,
  codomain: traceCellReadingCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeClaudeWorkTaskAction = action({
  verb: "organizing.claude.code-cli.events.canonicalize-work-task",
  description: "Canonicalize a Claude CLI work task.",
  domain: claudeWorkTaskCarrier,
  codomain: claudeWorkTaskCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeClaudeWorkItemAction = action({
  verb: "organizing.claude.code-cli.events.canonicalize-work-item",
  description: "Canonicalize a Claude CLI work item.",
  domain: claudeWorkItemCarrier,
  codomain: claudeWorkItemCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeClaudeWorkReportAction = action({
  verb: "organizing.claude.code-cli.events.canonicalize-work-report",
  description: "Canonicalize a Claude CLI work report.",
  domain: claudeWorkReportCarrier,
  codomain: claudeWorkReportCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeClaudeTraceAction = action({
  verb: "organizing.claude.code-cli.events.canonicalize-trace",
  description: "Canonicalize a Claude CLI trace carrier.",
  domain: claudeTraceCarrier,
  codomain: claudeTraceCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const eventActions = Object.freeze([
  canonicalizeClaudeResultAction,
  canonicalizeTraceEntryAction,
  canonicalizeTraceCellReadingAction,
  canonicalizeClaudeWorkTaskAction,
  canonicalizeClaudeWorkItemAction,
  canonicalizeClaudeWorkReportAction,
  canonicalizeClaudeTraceAction,
]);

export type ClaudeWorkTask = Readonly<{
  kind: "claude.cli.work.task";
  term: PredicationTerm;
  goals: readonly unknown[];
  evidence: readonly PredicationTerm[];
}>;

export type ClaudeWorkItem = Readonly<{
  kind: "claude.cli.work.item";
  term: PredicationTerm;
  task: ClaudeWorkTask;
  office: PredicationTerm;
  evidence: readonly PredicationTerm[];
}>;

export type ClaudeWorkReport = Readonly<{
  kind: "claude.cli.work.report";
  term: PredicationTerm;
  work: ClaudeWorkItem;
  office: PredicationTerm;
  charge: ChargeCarrier;
  evidence: readonly PredicationTerm[];
}>;

type WorkItem = ClaudeWorkItem;
type WorkReport = ClaudeWorkReport;
type WorkStatus = ChargeCarrier;

export type TraceEntry = Readonly<{
  subject: string;
  predicate: string;
  object: string | Mark;
  provenance: unknown;
}>;

export type TraceCellReading = Readonly<{
  subject: string;
  predicate: string;
  object: string | Mark;
  value: ChargeValueName;
  provenance: unknown;
}>;

// ---------- parsing ----------

/** Parse either the json-array envelope or the stream-json JSONL into events. */
export function parseClaudeEvents(input: string): readonly ClaudeEvent[] {
  const trimmed = input.trim();
  if (trimmed.length === 0) return Object.freeze([]);
  const records: readonly JsonValue[] = trimmed.startsWith("[") ? parseJsonArray(trimmed) : parseJsonlLines(trimmed);
  const events: ClaudeEvent[] = [];
  for (const [index, parsed] of records.entries()) {
    if (!isJsonRecord(parsed)) throw new TypeError(`claude event ${index + 1}: expected object`);
    if (typeof parsed["type"] !== "string" || parsed["type"].length === 0) {
      throw new TypeError(`claude event ${index + 1}: expected string type`);
    }
    events.push(Object.freeze({ ...parsed, type: parsed["type"] }));
  }
  return Object.freeze(events);
}

function parseJsonArray(input: string): readonly JsonValue[] {
  const parsed: unknown = JSON.parse(input);
  if (!Array.isArray(parsed)) throw new TypeError("claude json output: expected a top-level array");
  return parsed as readonly JsonValue[];
}

/** The terminal result event, decoded into the typed ClaudeResult. */
export function resultEventOf(events: readonly ClaudeEvent[]): ClaudeResult | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type === "result") return decodeResult(event);
  }
  return undefined;
}

function decodeResult(event: ClaudeEvent): ClaudeResult {
  return Object.freeze({
    type: "result" as const,
    isError: event["is_error"] === true,
    raw: event,
    ...(stringValue(event["subtype"]) === undefined ? {} : { subtype: stringValue(event["subtype"])! }),
    ...(stringValue(event["session_id"]) === undefined ? {} : { sessionId: stringValue(event["session_id"])! }),
    ...(stringValue(event["result"]) === undefined ? {} : { result: stringValue(event["result"])! }),
    ...(numberValue(event["num_turns"]) === undefined ? {} : { numTurns: numberValue(event["num_turns"])! }),
    ...(numberValue(event["duration_ms"]) === undefined ? {} : { durationMs: numberValue(event["duration_ms"])! }),
    ...(numberValue(event["total_cost_usd"]) === undefined ? {} : { totalCostUsd: numberValue(event["total_cost_usd"])! }),
    ...(recordValue(event["usage"]) === null ? {} : { usage: recordValue(event["usage"])! }),
    ...(recordValue(event["modelUsage"]) === null ? {} : { modelUsage: recordValue(event["modelUsage"])! }),
    ...(Array.isArray(event["permission_denials"]) ? { permissionDenials: Object.freeze([...event["permission_denials"]]) } : {}),
    ...(stringValue(event["terminal_reason"]) === undefined ? {} : { terminalReason: stringValue(event["terminal_reason"])! }),
  });
}

// ---------- term/hash helpers ----------

function stableJson(value: unknown): string {
  return canonical(requireJsonValue(value, "claude event value"));
}
function shortHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 16);
}
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/** Stable run id: the session id when present, else a content hash. */
function eventRun(events: readonly ClaudeEvent[], explicit: string | undefined): string {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  for (const event of events) {
    const session = stringValue(event["session_id"]);
    if (session !== undefined) return `session.${session}`;
  }
  return `run.${shortHash(events)}`;
}

function eventId(event: ClaudeEvent, ordinal: number): string {
  const uuid = stringValue(event["uuid"]);
  if (uuid !== undefined) return `uuid.${uuid}`;
  return `event.${ordinal}.${event.type}`;
}

function valueMark(value: unknown): Mark {
  return mark(value);
}

// ---------- trace entries ----------

function entry(subject: string, predicate: string, object: string | Mark, provenance: unknown): TraceEntry {
  return Object.freeze({ subject, predicate, object, provenance });
}

function provenance(run: string, ordinal: number, event: ClaudeEvent): Readonly<Record<string, unknown>> {
  return Object.freeze({ source: "claude.cli.json", run, ordinal, type: event.type });
}

function maybeStringEntry(
  entries: TraceEntry[],
  subject: string,
  predicate: string,
  object: unknown,
  prov: unknown,
): void {
  const value = stringValue(object);
  if (value !== undefined) entries.push(entry(subject, predicate, value, prov));
}

function contentBlocks(event: ClaudeEvent): readonly Record<string, unknown>[] {
  const message = recordValue(event["message"]);
  if (message === null) return [];
  const content = message["content"];
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is Record<string, unknown> => recordValue(block) !== null);
}

function blockEntries(
  entries: TraceEntry[],
  eventTerm: string,
  block: Record<string, unknown>,
  ordinal: number,
  prov: unknown,
): void {
  const blockType = stringValue(block["type"]) ?? "unknown";
  const blockTerm = `${eventTerm}.block.${ordinal}.${blockType}`;
  entries.push(entry(eventTerm, "claude.message.has-block", blockTerm, prov));
  entries.push(entry(blockTerm, "claude.block.has-type", blockType, prov));
  maybeStringEntry(entries, blockTerm, "claude.block.has-text", block["text"], prov);
  maybeStringEntry(entries, blockTerm, "claude.block.has-thinking", block["thinking"], prov);
  if (blockType === "tool_use") {
    maybeStringEntry(entries, blockTerm, "claude.tool.uses-tool", block["name"], prov);
    maybeStringEntry(entries, blockTerm, "claude.tool.has-id", block["id"], prov);
    if (block["input"] !== undefined) {
      entries.push(entry(blockTerm, "claude.tool.has-input", valueMark(block["input"]), prov));
    }
  }
  if (blockType === "tool_result") {
    maybeStringEntry(entries, blockTerm, "claude.tool.for-id", block["tool_use_id"], prov);
    if (block["is_error"] === true) entries.push(entry(blockTerm, "claude.tool.is-error", "true", prov));
    if (block["content"] !== undefined) {
      entries.push(entry(blockTerm, "claude.tool.has-result", valueMark(block["content"]), prov));
    }
  }
}

/** Project events into flat trace entries (subject/predicate/object + provenance). */
export function claudeTraceEntries(
  events: readonly ClaudeEvent[],
  options: { readonly run?: string } = {},
): readonly TraceEntry[] {
  const run = eventRun(events, options.run);
  const runTerm = `claude.cli.${run}`;
  const entries: TraceEntry[] = [];
  for (const [ordinal, event] of events.entries()) {
    const eventTerm = `${runTerm}.${eventId(event, ordinal)}`;
    const p = provenance(run, ordinal, event);
    entries.push(entry(runTerm, "claude.cli.has-event", eventTerm, p));
    entries.push(entry(eventTerm, "claude.cli.event.has-type", event.type, p));
    maybeStringEntry(entries, eventTerm, "claude.cli.event.has-subtype", event["subtype"], p);
    maybeStringEntry(entries, eventTerm, "claude.cli.event.in-session", event["session_id"], p);
    const message = recordValue(event["message"]);
    if (message !== null) {
      maybeStringEntry(entries, eventTerm, "claude.message.has-role", message["role"], p);
      maybeStringEntry(entries, eventTerm, "claude.message.has-model", message["model"], p);
      contentBlocks(event).forEach((block, index) => blockEntries(entries, eventTerm, block, index, p));
      const usage = recordValue(message["usage"]);
      if (usage !== null) entries.push(entry(eventTerm, "claude.message.has-usage", valueMark(usage), p));
    }
    if (event.type === "result") {
      entries.push(entry(eventTerm, "claude.cli.result.is-error", event["is_error"] === true ? "true" : "false", p));
      maybeStringEntry(entries, eventTerm, "claude.cli.result.has-text", event["result"], p);
      const cost = numberValue(event["total_cost_usd"]);
      if (cost !== undefined) entries.push(entry(eventTerm, "claude.cli.result.cost-usd", String(cost), p));
      const turns = numberValue(event["num_turns"]);
      if (turns !== undefined) entries.push(entry(eventTerm, "claude.cli.result.num-turns", String(turns), p));
    }
  }
  return Object.freeze(entries);
}

function traceObjectValue(object: string | Mark): unknown {
  return typeof object === "string" ? object : object.value;
}

function utterTrace(entries: readonly TraceEntry[]): readonly UtteranceCarrier[] {
  return Object.freeze(
    entries.map((item) =>
      utterance(mark(Object.freeze({ subject: item.subject, object: traceObjectValue(item.object) })), mark(item.predicate)),
    ),
  );
}

function foldTrace(entries: readonly TraceEntry[]): readonly TraceCellReading[] {
  return Object.freeze(
    entries.map((item) =>
      Object.freeze({
        subject: item.subject,
        predicate: item.predicate,
        object: item.object,
        value: "potential" as const,
        provenance: item.provenance,
      }),
    ),
  );
}

// ---------- findings ----------

function termPath(subject: string): readonly string[] {
  return Object.freeze(subject.split(".").filter((part) => part.length > 0));
}

/** Project trace readings into session findings; add a settled result finding. */
export function claudeFindings(
  trace: Pick<ClaudeTraceCarrier, "run" | "readings" | "events">,
  options: { readonly session?: string } = {},
): readonly Finding[] {
  const session = options.session ?? `claude.cli.${trace.run}`;
  const findings: Finding[] = trace.readings.map((reading) =>
    finding({
      session,
      subject: termPath(reading.subject),
      predicate: reading.predicate,
      charge: charge(chargeValue(reading.value)),
      ...(reading.object === undefined ? {} : { object: traceObjectValue(reading.object) }),
      note: Object.freeze({ source: "claude.cli.trace", run: trace.run, provenance: reading.provenance }),
    }),
  );
  const result = resultEventOf(trace.events);
  if (result !== undefined) {
    findings.push(
      finding({
        session,
        subject: ["claude", "cli", trace.run, "result"],
        predicate: "claude.cli.session.settled",
        charge: charge(chargeValue(result.isError ? "stable" : "potential")),
        note: Object.freeze({
          source: "claude.cli.result",
          terminalReason: result.terminalReason ?? null,
          totalCostUsd: result.totalCostUsd ?? null,
        }),
      }),
    );
  }
  return Object.freeze(findings);
}

// ---------- work ----------

function term(value: unknown): PredicationTerm {
  return token(mark(value));
}
function predicate(value: unknown): PredicationPredicate {
  return predicateOfClaim(claim(mark(value)));
}
function officeTerm(office: string): PredicationTerm {
  return term(["office", office]);
}

interface ToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly ordinal: number;
}

function toolUses(events: readonly ClaudeEvent[]): readonly ToolUse[] {
  const uses: ToolUse[] = [];
  for (const [ordinal, event] of events.entries()) {
    if (event.type !== "assistant") continue;
    for (const block of contentBlocks(event)) {
      if (stringValue(block["type"]) !== "tool_use") continue;
      const id = stringValue(block["id"]) ?? shortHash({ ordinal, block });
      uses.push({ id, name: stringValue(block["name"]) ?? "tool", input: block["input"], ordinal });
    }
  }
  return uses;
}

function toolResultStatus(events: readonly ClaudeEvent[]): ReadonlyMap<string, boolean> {
  // tool_use_id → isError, read from user tool_result blocks.
  const status = new Map<string, boolean>();
  for (const event of events) {
    if (event.type !== "user") continue;
    for (const block of contentBlocks(event)) {
      if (stringValue(block["type"]) !== "tool_result") continue;
      const forId = stringValue(block["tool_use_id"]);
      if (forId !== undefined) status.set(forId, block["is_error"] === true);
    }
  }
  return status;
}

function toolWorkItem(run: string, office: string, use: ToolUse): WorkItem {
  const task = workTask({
    term: term(["claude", "task", run, use.id]),
    goals: Object.freeze([
      cell(
        term(["claude", "cli", run, "tool", use.id]),
        predicate(["claude", "tool", "invoke"]),
        term(["tool", use.name]),
      ),
    ]),
    evidence: Object.freeze([
      term(["claude", "tool", use.id]),
      term(["claude", "tool", "name", use.name]),
      term(["claude", "cli", "ordinal", use.ordinal]),
    ]),
  });
  return workItem({
    term: term(["claude", "work", run, use.id]),
    task,
    office: officeTerm(office),
    evidence: Object.freeze([term(["claude", "tool", use.id]), term(["claude", "cli", "ordinal", use.ordinal])]),
  });
}

function workTask(input: Omit<ClaudeWorkTask, "kind">): ClaudeWorkTask {
  return Object.freeze({ kind: "claude.cli.work.task" as const, ...input });
}

function workItem(input: Omit<ClaudeWorkItem, "kind">): ClaudeWorkItem {
  return Object.freeze({ kind: "claude.cli.work.item" as const, ...input });
}

function workReport(input: Omit<ClaudeWorkReport, "kind">): ClaudeWorkReport {
  return Object.freeze({ kind: "claude.cli.work.report" as const, ...input });
}

/** Each tool_use the assistant issued, as a work item. */
export function claudeWorkItems(
  events: readonly ClaudeEvent[],
  options: { readonly run?: string; readonly office?: string } = {},
): readonly WorkItem[] {
  const run = eventRun(events, options.run);
  const office = options.office ?? "claude";
  return Object.freeze(toolUses(events).map((use) => toolWorkItem(run, office, use)));
}

/** A work report per tool_use, charged by whether its tool_result errored. */
export function claudeWorkReports(
  events: readonly ClaudeEvent[],
  options: { readonly run?: string; readonly office?: string } = {},
): readonly WorkReport[] {
  const run = eventRun(events, options.run);
  const office = options.office ?? "claude";
  const status = toolResultStatus(events);
  return Object.freeze(
    toolUses(events).map((use) => {
      const settled = status.get(use.id);
      const charged: WorkStatus =
        settled === undefined
          ? charge(chargeValue("active"))
          : charge(chargeValue(settled ? "stable" : "potential"));
      return workReport({
        term: term(["claude", "report", run, use.id]),
        work: toolWorkItem(run, office, use),
        office: officeTerm(office),
        charge: charged,
        evidence: Object.freeze([
          term(["claude", "tool", use.id]),
          term(["claude", "tool", "name", use.name]),
          term(["claude", "cli", "ordinal", use.ordinal]),
        ]),
      });
    }),
  );
}

// ---------- cost ----------

function usageTokenCount(usage: Readonly<Record<string, unknown>>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  }
  return 0;
}

/**
 * Cost events from the run. The terminal result carries the authoritative
 * total_cost_usd + usage, so one cost event is emitted from it; if there is no
 * result, fall back to the last assistant message usage (no dollar figure).
 */
export function claudeUsageCostEvents(
  events: readonly ClaudeEvent[],
  options: { readonly run?: string; readonly transactionTime: string },
): readonly CostEvent[] {
  const run = eventRun(events, options.run);
  const result = resultEventOf(events);
  if (result?.usage !== undefined) {
    const usage = result.usage;
    const input = usageTokenCount(usage, ["input_tokens", "inputTokens"]);
    const output = usageTokenCount(usage, ["output_tokens", "outputTokens"]);
    const model = modelOf(result);
    return Object.freeze([
      Object.freeze({
        id: `cost:claude-cli:${run}`,
        operation: "claude-cli",
        endpoint: "anthropic",
        ...(model === undefined ? {} : { model }),
        settlementFuel: 0,
        dollars: moneyValue(result.totalCostUsd),
        tokens: { input, output },
        transactionTime: options.transactionTime,
        evidence: Object.freeze([`claude.cli.${run}.result`, "claude.cli.result.usage"]),
      }),
    ]);
  }
  const lastAssistant = [...events].reverse().find((event) => event.type === "assistant");
  if (lastAssistant === undefined) return Object.freeze([]);
  const usage = recordValue(recordValue(lastAssistant["message"])?.["usage"]);
  if (usage === null) return Object.freeze([]);
  const input = usageTokenCount(usage, ["input_tokens", "inputTokens"]);
  const output = usageTokenCount(usage, ["output_tokens", "outputTokens"]);
  if (input + output <= 0) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({
      id: `cost:claude-cli:${run}:assistant`,
      operation: "claude-cli",
      endpoint: "anthropic",
      settlementFuel: 0,
      dollars: 0,
      tokens: { input, output },
      transactionTime: options.transactionTime,
      evidence: Object.freeze([`claude.cli.${run}.assistant`]),
    }),
  ]);
}

function modelOf(result: ClaudeResult): string | undefined {
  if (result.modelUsage === undefined) return undefined;
  const keys = Object.keys(result.modelUsage);
  return keys.length > 0 ? keys[0] : undefined;
}

function moneyValue(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1_000_000) / 1_000_000
    : 0;
}

// ---------- the carrier ----------

/** Settle a run's events into the full trace carrier. */
export function claudeTrace(
  events: readonly ClaudeEvent[],
  options: { readonly run?: string } = {},
): ClaudeTraceCarrier {
  const run = eventRun(events, options.run);
  const entries = claudeTraceEntries(events, { run });
  const utterances = utterTrace(entries);
  const readings = foldTrace(entries);
  return Object.freeze({
    kind: "claude.cli.trace" as const,
    run,
    events: Object.freeze([...events]),
    entries,
    utterances,
    readings,
    findings: claudeFindings({ run, readings, events }),
    work: claudeWorkItems(events, { run }),
    reports: claudeWorkReports(events, { run }),
  });
}

/** Parse json/stream-json text straight into a trace carrier. */
export function parseClaudeTrace(input: string, options: { readonly run?: string } = {}): ClaudeTraceCarrier {
  return claudeTrace(parseClaudeEvents(input), options);
}
