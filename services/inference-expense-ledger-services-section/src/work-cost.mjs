// Agent assignments to Work, and the per-Work cost roll-up. The lead records each assignment
// (and later its outcome) as an append-only journal event; the roll-up joins those events to the
// expense ledger on session and agent, so a Work item's cost is read, never estimated.
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { decimalToMicros, microsToDecimal } from "./decimal-money.mjs";

export const ASSIGNMENT_EVENT_KIND = "agent-assignment-event";
export const OUTCOME_STATUSES = Object.freeze(["done", "partial", "failed", "abandoned", "handed-off"]);

const text = (value, label, { optional = false, max = 400 } = {}) => {
  if (value === undefined || value === null || value === "") {
    if (optional) return undefined;
    throw new TypeError(`${label} is required`);
  }
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value.slice(0, max);
};

/** Validates one journal event; returns it normalised. `assigned` names the agent; `outcome` carries a status. */
export function assignmentEvent(input, now = new Date()) {
  const event = text(input.event, "event");
  if (event !== "assigned" && event !== "outcome") throw new TypeError("event must be assigned or outcome");
  const agentId = text(input.agentId, "agentId", { optional: true, max: 80 });
  const toolUseId = text(input.toolUseId, "toolUseId", { optional: true, max: 80 });
  if (agentId === undefined && toolUseId === undefined) throw new TypeError("an assignment names its agent by agentId or toolUseId");
  const row = { kind: ASSIGNMENT_EVENT_KIND, event, workId: text(input.workId, "workId", { max: 200 }), sessionId: text(input.sessionId, "sessionId", { max: 80 }), ...(agentId === undefined ? {} : { agentId }), ...(toolUseId === undefined ? {} : { toolUseId }), at: input.at ?? now.toISOString() };
  const title = text(input.title, "title", { optional: true });
  const summary = text(input.summary, "summary", { optional: true, max: 1000 });
  if (title !== undefined) row.title = title;
  const promptDigest = text(input.promptDigest, "promptDigest", { optional: true, max: 64 });
  if (promptDigest !== undefined) row.promptDigest = promptDigest;
  if (input.derived === true) row.derived = true;
  if (event === "outcome") {
    if (!OUTCOME_STATUSES.includes(input.status)) throw new TypeError(`status must be one of ${OUTCOME_STATUSES.join(", ")}`);
    row.status = input.status;
  }
  if (summary !== undefined) row.summary = summary;
  return row;
}

export function appendAssignmentEvent(journalFile, input, now) {
  const row = assignmentEvent(input, now);
  mkdirSync(path.dirname(journalFile), { recursive: true });
  appendFileSync(journalFile, `${JSON.stringify(row)}\n`);
  return row;
}

export function readAssignmentEvents(journalFile) {
  if (!existsSync(journalFile)) return [];
  return readFileSync(journalFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((row) => row.kind === ASSIGNMENT_EVENT_KIND);
}

const matches = (event, record) => record.sessionId === event.sessionId && ((event.agentId !== undefined && record.agent.id === event.agentId) || (event.toolUseId !== undefined && record.agent.toolUseId === event.toolUseId));

/** Per Work: its agents with their measured cost, the latest outcome, and assignments that match no ledger record. */
export function workCostRollup(events, records) {
  const works = new Map();
  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const work = works.get(event.workId) ?? { workId: event.workId, title: null, assignments: [], status: "open", summary: null };
    if (event.title !== undefined) work.title = event.title;
    if (event.event === "assigned") work.assignments.push(event);
    else { work.status = event.status; work.summary = event.summary ?? work.summary; }
    works.set(event.workId, work);
  }
  return [...works.values()].map((work) => {
    const seen = new Set();
    const agents = [];
    const unmatched = [];
    let micros = 0n;
    let turns = 0;
    let unpricedTurns = 0;
    const tokens = { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 };
    for (const assignment of work.assignments) {
      const found = records.filter((record) => matches(assignment, record));
      if (found.length === 0) unmatched.push(assignment.agentId ?? assignment.toolUseId);
      for (const record of found) {
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        turns += record.turns;
        for (const kind of Object.keys(tokens)) tokens[kind] += record.tokens[kind];
        if (record.priced) micros += decimalToMicros(record.costUsd.total); else unpricedTurns += record.turns;
        agents.push({ agentId: record.agent.id, model: record.model, turns: record.turns, peakContext: record.context.peak, costUsd: record.priced ? record.costUsd.total : null });
      }
    }
    return { workId: work.workId, title: work.title, status: work.status, summary: work.summary, agents, unmatchedAssignments: unmatched, turns, unpricedTurns, tokens, costUsd: microsToDecimal(micros) };
  }).sort((a, b) => (decimalToMicros(b.costUsd) > decimalToMicros(a.costUsd) ? 1 : -1));
}
