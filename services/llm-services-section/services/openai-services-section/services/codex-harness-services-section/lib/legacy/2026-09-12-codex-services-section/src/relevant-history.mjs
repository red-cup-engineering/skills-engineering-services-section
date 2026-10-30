import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { ACTOR, CUSTOMER, DEFAULT_STATE_ROOT, identity, readTrajectory } from "./enterprise.mjs";
import { DEFAULT_CODEX_SESSIONS_ROOT } from "./historical-demands.mjs";
import { normalizeLeaderMove } from "./mape-office.mjs";
import { promptWorkBoard } from "./prompt-cycle.mjs";
import { semanticByteIdentity } from "./semiotic-circuit.mjs";

export const RELEVANT_HISTORY_SELECTOR = "urn:ame:codex-relevant-history-selection-actuator";
export const RELEVANT_HISTORY_OFFER = "urn:offer:codex-relevant-history-selection";

const ACTIVE_STATES = new Set(["open", "in-progress", "blocked"]);

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`);
  return value.trim();
}

function filesBelow(root) {
  const selected = resolve(root);
  if (!existsSync(selected)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  };
  visit(selected);
  return files;
}

function byteDigest(bytes) {
  return semanticByteIdentity(bytes, "bare-cedar-fog-codex.session-transcript-carrier").id;
}

function transcriptEvidence(path, promptDigest, currentSession) {
  const bytes = readFileSync(path);
  const sourceDigest = byteDigest(bytes);
  let sessionId = null;
  const matches = [];
  const problems = [];
  for (const [index, line] of bytes.toString("utf8").split("\n").entries()) {
    if (line.trim() === "") continue;
    let row;
    try { row = JSON.parse(line); }
    catch {
      problems.push(Object.freeze({ source: path, sourceDigest, line: index + 1, error: "malformed-json-row" }));
      continue;
    }
    if (row.type === "session_meta" && typeof row.payload?.id === "string") sessionId = row.payload.id;
    if (row.type !== "event_msg" || row.payload?.type !== "user_message" || typeof row.payload.message !== "string" || row.payload.message.trim() === "") continue;
    const matchesDemand = identity(row.payload.message) === promptDigest;
    if (matchesDemand && sessionId !== currentSession) {
      matches.push(Object.freeze({
        type: "PriorSessionDemandEvidence",
        promptDigest,
        sessionId,
        timestamp: row.timestamp ?? null,
        source: Object.freeze({ path, digest: sourceDigest, line: index + 1 }),
      }));
    }
  }
  return Object.freeze({ matches, problems });
}

function activeWork(promptDigest, currentSession, options) {
  const trajectory = readTrajectory(options);
  const compiled = new Map(trajectory.filter((row) => row.type === "PromptWorkItemsCompiled").map((row) => [row.cycle, row]));
  return promptWorkBoard(options)
    .filter((item) => item.sessionId !== currentSession && ACTIVE_STATES.has(item.state) && identity(item.prompt) === promptDigest)
    .map((item) => {
      const provider = compiled.get(item.cycle);
      return Object.freeze({
        type: "ActivePriorWorkEvidence",
        cycle: item.cycle,
        state: item.state,
        sessionId: item.sessionId,
        turnId: item.turnId,
        observedAt: item.observedAt,
        updatedAt: item.updatedAt,
        evidence: item.evidence,
        workItems: item.workItems,
        provider: provider?.provider ?? null,
        providerReceipt: provider?.providerReceipt ?? null,
      });
    })
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)) || left.cycle.localeCompare(right.cycle));
}

function rank(match, work) {
  const related = work.filter((item) => item.sessionId === match.sessionId);
  if (related.some(({ providerReceipt }) => providerReceipt !== null)) return 3;
  if (related.length > 0) return 2;
  return 1;
}

export function observeRelevantPriorSessionEvidence(input, options = {}) {
  const move = normalizeLeaderMove(input?.leaderMove);
  const currentSession = nonempty(input?.session, "session");
  const cap = input?.cap ?? 20;
  if (!Number.isSafeInteger(cap) || cap < 1) throw new TypeError("cap must be a positive safe integer");
  const sessionsRoot = resolve(options.sessionsRoot ?? process.env.CODEX_SESSIONS_ROOT ?? DEFAULT_CODEX_SESSIONS_ROOT);
  const stateRoot = resolve(options.stateRoot ?? process.env.CODEX_ENTERPRISE_STATE_ROOT ?? DEFAULT_STATE_ROOT);
  const promptDigest = identity(move.desiredOutcome);
  const scanned = filesBelow(sessionsRoot).map((path) => transcriptEvidence(path, promptDigest, currentSession));
  const work = activeWork(promptDigest, currentSession, { ...options, stateRoot });
  const evidence = scanned.flatMap(({ matches }) => matches)
    .map((match) => Object.freeze({ ...match, rank: rank(match, work) }))
    .sort((left, right) => right.rank - left.rank || String(right.timestamp).localeCompare(String(left.timestamp)) || left.source.digest.localeCompare(right.source.digest) || left.source.line - right.source.line)
    .slice(0, cap);
  const selectedSessions = new Set(evidence.map(({ sessionId }) => sessionId));
  const selectedWork = work.filter(({ sessionId }) => selectedSessions.has(sessionId));
  const problems = scanned.flatMap(({ problems: entries }) => entries)
    .sort((left, right) => left.source.localeCompare(right.source) || left.line - right.line);
  const body = {
    type: "RelevantPriorSessionEvidenceSetK",
    version: 1,
    provider: RELEVANT_HISTORY_SELECTOR,
    customer: CUSTOMER,
    actor: ACTOR,
    move: move.id,
    currentSession,
    promptDigest,
    matchPolicy: "exact-normalized-leader-move-identity-only",
    evidence,
    activeWork: selectedWork,
    problems,
    absence: evidence.length === 0 ? "no-exact-prior-session-evidence" : null,
    offer: RELEVANT_HISTORY_OFFER,
    considerationDisposition: "unknown-until-provider-authored-offer-and-independent-incurrence-observation",
    conveys: [],
  };
  return Object.freeze({ id: identity(body), ...body });
}
