// Session frictions: the failures a Claude session met while working, read
// off its own transcript (tool errors, non-zero command exits) or reported
// explicitly by the session (a carrier that states a falsehood), shaped as
// structured work-intent tasks so every friction lands on the rail as a
// duty instead of being worked around and forgotten.
import { createHash } from "node:crypto";
import { CHAIN_ITEMS, PLAN_CELL, slugify } from "../scripts/admit-set-of-health-work-intents.mjs";

/** The readout kind this module derives. */
export const READOUT_KIND = "bare-cedar-fog-claude.session-frictions";

/** Friction kinds this module recognizes. */
export const FRICTION_KINDS = Object.freeze({
  toolError: "tool-error",
  commandFailure: "command-failure",
  carrierFalsehood: "carrier-falsehood",
  missingCapability: "missing-capability",
});

const EXPLICIT_KINDS = new Set([FRICTION_KINDS.carrierFalsehood, FRICTION_KINDS.missingCapability]);

// A tool result the user rejected or interrupted is steering, not friction.
const STEERING_PATTERN = /^(The user doesn't want to proceed|\[Request interrupted)/u;
const EXIT_CODE_PATTERN = /^Exit code (\d+)/u;

/**
 * Parses JSONL transcript text into records, skipping lines that are not
 * JSON objects.
 * @param {string} text
 * @returns {object[]}
 */
export function parseTranscriptLines(text) {
  const records = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object") records.push(record);
    } catch {
      // not a JSON line
    }
  }
  return records;
}

/**
 * The plain text of a tool result's content: a string, or its text blocks
 * joined.
 * @param {unknown} content
 * @returns {string}
 */
export function toolResultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (typeof block === "string" ? block : block?.text ?? "")).filter(Boolean).join("\n");
}

const ERROR_LINE_PATTERN = /error|cannot|no such|not found|refused|denied|failed|unknown|invalid|timed? ?out|enoent|throw/iu;

/**
 * The line of a failure text that names the failure (the first line that
 * reads like an error, else the first non-empty line), lowercased, digits
 * collapsed to `#`, capped at 120 characters: the part that recurs.
 * @param {string} text
 * @returns {string}
 */
export function normalizeFailureLine(text) {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "");
  const first = lines.find((line) => ERROR_LINE_PATTERN.test(line)) ?? lines[0] ?? "";
  return first.toLowerCase().replace(/\d+/gu, "#").slice(0, 120);
}

/**
 * Classifies one tool result as a friction, or null when it is not one.
 * @param {{name: string, input?: object}|undefined} use The tool_use this result answers.
 * @param {{is_error?: boolean, content?: unknown}} result
 * @returns {{kind: string, summary: string}|null}
 */
export function classifyToolResult(use, result) {
  const text = toolResultText(result.content);
  if (STEERING_PATTERN.test(text.trimStart())) return null;
  const exit = EXIT_CODE_PATTERN.exec(text.trimStart());
  if (use?.name === "Bash" && exit && exit[1] !== "0") {
    return { kind: FRICTION_KINDS.commandFailure, summary: normalizeFailureLine(text.replace(EXIT_CODE_PATTERN, "").trimStart()) || `exit code ${exit[1]}` };
  }
  if (result.is_error === true) return { kind: FRICTION_KINDS.toolError, summary: normalizeFailureLine(text) };
  return null;
}

/**
 * A short description of what the tool was asked to do, for the task text.
 * @param {{name: string, input?: object}|undefined} use
 * @returns {string}
 */
function commandOf(use) {
  if (!use) return "an unknown tool call";
  const input = use.input ?? {};
  if (typeof input.description === "string" && input.description !== "") return input.description;
  if (typeof input.command === "string") return input.command.split("\n")[0].slice(0, 100);
  if (typeof input.query === "string") return `query ${JSON.stringify(input.query)}`;
  const keys = Object.keys(input);
  return keys.length === 0 ? use.name : `${use.name} with ${keys.join(", ")}`;
}

/**
 * Derives the frictions of one Claude session from its transcript records:
 * every tool result that is an error or a non-zero command exit, grouped by
 * (kind, tool, normalized failure line) with counts and timestamps. User
 * rejections and interruptions are steering, never friction.
 * @param {object[]} records Transcript records (see {@link parseTranscriptLines}).
 * @param {{sessionId?: string}} [options]
 * @returns {{kind: string, sessionDigest: string|null, records: number, frictions: object[]}}
 */
export function deriveSessionFrictions(records, { sessionId } = {}) {
  const uses = new Map();
  let session = sessionId ?? null;
  for (const record of records) {
    if (session === null && typeof record.sessionId === "string") session = record.sessionId;
    if (record.type !== "assistant" || !Array.isArray(record.message?.content)) continue;
    for (const block of record.message.content) {
      if (block?.type === "tool_use" && typeof block.id === "string") uses.set(block.id, { name: block.name, input: block.input });
    }
  }
  const groups = new Map();
  for (const record of records) {
    if (record.type !== "user" || !Array.isArray(record.message?.content)) continue;
    for (const block of record.message.content) {
      if (block?.type !== "tool_result") continue;
      const use = uses.get(block.tool_use_id);
      const classified = classifyToolResult(use, block);
      if (!classified) continue;
      const tool = use?.name ?? "unknown";
      const signature = `${classified.kind}:${tool}:${classified.summary}`;
      const at = typeof record.timestamp === "string" ? record.timestamp : "";
      const group = groups.get(signature) ?? { signature, kind: classified.kind, tool, summary: classified.summary, command: commandOf(use), count: 0, firstAt: at, lastAt: at, toolUseIds: [] };
      group.count += 1;
      if (at && (group.firstAt === "" || at < group.firstAt)) group.firstAt = at;
      if (at > group.lastAt) group.lastAt = at;
      group.toolUseIds.push(block.tool_use_id);
      groups.set(signature, group);
    }
  }
  return {
    kind: READOUT_KIND,
    sessionDigest: session === null ? null : `sha256:${createHash("sha256").update(session).digest("hex")}`,
    records: records.length,
    frictions: [...groups.values()].sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature)),
  };
}

/**
 * Deterministic task cell for one friction group.
 * @param {{kind: string, tool: string, summary: string}} friction
 * @returns {string}
 */
export function frictionTaskCell(friction) {
  return `task:friction-${slugify(friction.kind)}-${slugify(friction.tool)}-${slugify(friction.summary).slice(0, 60).replace(/-$/u, "")}`;
}

/**
 * One structured work-intent task per derived friction group. The repair
 * text states the house law: a friction is a lawfulness failure at its
 * owner, never a workaround in the caller.
 * @param {readonly object[]} frictions From {@link deriveSessionFrictions}.
 * @param {{planCell?: string, sessionDigest?: string|null}} [options]
 * @returns {object[]}
 */
export function tasksFromFrictions(frictions, { planCell = PLAN_CELL, sessionDigest = null } = {}) {
  return frictions.map((friction) => ({
    cell: frictionTaskCell(friction),
    parent: planCell,
    text: `Session friction: ${friction.tool} failed ${friction.count} time(s) with "${friction.summary}" while ${friction.command}. Repair: fix the tool, service, or carrier at its owner so the call succeeds; never work around it in the caller.`,
    evidence: [
      `session-transcript: kind=${friction.kind} tool=${friction.tool} count=${friction.count} first=${friction.firstAt} last=${friction.lastAt}${sessionDigest ? ` session=${sessionDigest}` : ""}`,
      ...friction.toolUseIds.slice(0, 5).map((id) => `tool-use: ${id}`),
    ],
    provenance: [{ source: "session-transcript" }],
  }));
}

/**
 * One task for a friction a session reports explicitly: a carrier that
 * states a falsehood, or a capability the session needed and the org lacks.
 * @param {{kind: string, carrier: string, observed: string, expected: string, planCell?: string}} report
 * @returns {object}
 */
/** Eight hex chars of sha-256 over kind, carrier, and observed: two frictions whose
 * carrier slugs truncate to the same prefix still land on distinct cells. */
export function frictionReportDigest({ kind, carrier, observed }) {
  return createHash("sha256").update(`${kind}\n${carrier}\n${observed}`).digest("hex").slice(0, 8);
}

export function taskFromFrictionReport({ kind, carrier, observed, expected, planCell = PLAN_CELL }) {
  if (!EXPLICIT_KINDS.has(kind)) throw new Error(`friction report kind must be one of ${[...EXPLICIT_KINDS].join(", ")} (got ${kind})`);
  for (const [name, value] of Object.entries({ carrier, observed, expected })) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`friction report needs a non-empty ${name}`);
  }
  const text = kind === FRICTION_KINDS.carrierFalsehood
    ? `${carrier} states ${JSON.stringify(observed)} but on disk ${expected}. Repair: replace the falsehood at its owner with the truth; never annotate it.`
    : `${carrier} needed ${JSON.stringify(observed)} and the org offers ${expected}. Repair: build or wire the capability at its owner, then use it.`;
  return {
    cell: `task:friction-${slugify(kind)}-${slugify(carrier).slice(0, 60).replace(/-$/u, "")}-${frictionReportDigest({ kind, carrier, observed })}`,
    parent: planCell,
    text,
    evidence: [`session-report: kind=${kind} carrier=${carrier}`, `observed: ${observed}`, `expected: ${expected}`],
    provenance: [{ source: "session-report" }],
  };
}

const SOURCE_CATALOG = Object.freeze({
  "roadmap-chain": Object.freeze({ id: "roadmap-chain", kind: "prior-admission", locator: "metroplat structured-work-intent 2026-09-03-core-stability-chain" }),
  "session-transcript": Object.freeze({ id: "session-transcript", kind: "session-transcript", locator: "bare-cedar-fog-claude-services-section/src/session-frictions.mjs#deriveSessionFrictions" }),
  "session-report": Object.freeze({ id: "session-report", kind: "session-report", locator: "bare-cedar-fog-claude-services-section/scripts/admit-friction.mjs" }),
});

/**
 * The full structured work intent: the admitted chain items verbatim plus
 * the friction tasks, with only the referenced sources attached.
 * @param {{id: string, tasks: readonly object[], producerId?: string}} options
 * @returns {object} a `metroplat.work.structured-intent` payload.
 */
export function buildFrictionWorkIntent({ id, tasks, producerId = "bare-cedar-fog-claude-services-section:session-frictions" }) {
  const chainItems = CHAIN_ITEMS.map((item) => ({ ...item, evidence: [], provenance: [{ source: "roadmap-chain" }] }));
  const items = [...chainItems, ...tasks];
  const referenced = new Set(["roadmap-chain", ...items.flatMap((item) => item.provenance.map((p) => p.source))]);
  return { kind: "metroplat.work.structured-intent", id, producer: { id: producerId }, sources: [...referenced].map((sourceId) => SOURCE_CATALOG[sourceId]).filter(Boolean), items };
}
