import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ACTOR, DEFAULT_STATE_ROOT, appendObservation, identity, readTrajectory } from "./enterprise.mjs";
import { compileCodexMapeCycle, recordCodexMapeArtifact } from "./mape-office.mjs";
import { semanticFileKey } from "./semiotic-circuit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = resolve(HERE, "../scripts/process-prompt-cycle.mjs");
const CUSTOMER = "urn:leader:emsenn";

function root(options = {}) { return resolve(options.stateRoot ?? process.env.CODEX_ENTERPRISE_STATE_ROOT ?? DEFAULT_STATE_ROOT); }
function sessionStatePath(sessionId, options = {}) { return join(root(options), "prompt-session-state", `${semanticFileKey(identity(sessionId))}.json`); }
function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`);
  return value;
}
function rows(options = {}) {
  return readTrajectory(options).filter((row) => row.type === "CodexLeaderPromptEvent");
}
function appendPrompt(body, options = {}) {
  return appendObservation(body, options).record;
}
function readSessionState(sessionId, options = {}) {
  const path = sessionStatePath(sessionId, options);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { generation: 0, active: null, resumable: null };
}
function writeSessionState(sessionId, state, options = {}) {
  const path = sessionStatePath(sessionId, options);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
function activeCycle(sessionId, options = {}) {
  return readSessionState(sessionId, options).active;
}

const WORK_STATES = new Set(["open", "in-progress", "blocked", "completed", "withdrawn"]);

export function promptWorkBoard(options = {}) {
  const trajectory = readTrajectory(options);
  const prompts = rows(options);
  const compiled = new Map(trajectory.filter((row) => row.type === "PromptWorkItemsCompiled").map((row) => [row.cycle, row]));
  const superseded = new Map(trajectory.filter((row) => row.type === "PromptMapeCycleSuperseded").map((row) => [row.cycle, row]));
  const changes = trajectory.filter((row) => row.type === "PromptWorkStateChanged");
  return Object.freeze(prompts.map((prompt) => {
    const changed = changes.findLast((row) => row.cycle === prompt.cycle);
    const replaced = superseded.get(prompt.cycle);
    const state = changed?.state ?? (replaced ? "withdrawn" : "open");
    return Object.freeze({
      id: prompt.id,
      cycle: prompt.cycle,
      state,
      sessionId: prompt.sessionId,
      turnId: prompt.turnId,
      observedAt: prompt.observedAt,
      prompt: prompt.prompt,
      supersededBy: replaced?.supersededBy ?? null,
      workItems: Object.freeze(compiled.get(prompt.cycle)?.workItems ?? []),
      institutionalProgram: compiled.get(prompt.cycle)?.institutionalProgram ?? null,
      evidence: changed?.evidence ?? null,
      updatedAt: changed?.observedAt ?? prompt.observedAt,
    });
  }).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))));
}

export function setPromptWorkState(input, options = {}) {
  const cycle = nonempty(input.cycle, "cycle");
  const state = nonempty(input.state, "state");
  if (!WORK_STATES.has(state)) throw new TypeError(`unsupported prompt work state ${state}`);
  const prompt = rows(options).find((row) => row.cycle === cycle);
  if (!prompt) throw new TypeError(`unknown prompt work cycle ${cycle}`);
  return appendObservation({
    type: "PromptWorkStateChanged",
    actor: ACTOR,
    customer: CUSTOMER,
    cycle,
    promptEvent: prompt.id,
    state,
    issuer: nonempty(input.issuer, "issuer"),
    evidence: nonempty(input.evidence, "evidence"),
    observedAt: nonempty(input.observedAt, "observedAt"),
  }, options).record;
}

export function admitPrompt(input, options = {}) {
  const sessionId = nonempty(input.session_id, "session_id");
  const turnId = nonempty(input.turn_id, "turn_id");
  const prompt = nonempty(input.prompt ?? input.user_prompt, "prompt");
  const institutionalContext = input.institutional_context ?? null;
  if (institutionalContext !== null && (typeof institutionalContext !== "object" || Array.isArray(institutionalContext))) {
    throw new TypeError("institutional_context must be an object when supplied");
  }
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  const sessionState = readSessionState(sessionId, options);
  const previous = sessionState.active;
  const generation = sessionState.generation + 1;
  const source = `codex-session:${sessionId}:turn:${turnId}:prompt:${identity(prompt)}`;
  const compiled = compileCodexMapeCycle({ leaderMove: { customer: CUSTOMER, desiredOutcome: prompt, source } });
  if (previous) {
    appendObservation({
      type: "PromptMapeCycleSuperseded", actor: ACTOR, sessionId, cycle: previous.cycle,
      supersededBy: compiled.id, priorTurnId: previous.turnId, correctionTurnId: turnId,
      reason: "new UserPromptSubmit arrived before the prior turn boundary; re-monitor before further execution", observedAt,
    }, options);
  }
  const promptRecord = appendPrompt({
    type: "CodexLeaderPromptEvent", actor: ACTOR, customer: CUSTOMER, sessionId, turnId,
    generation, observedAt, prompt, promptDigest: identity(prompt), interruption: previous !== null,
    supersedes: previous?.cycle ?? null, cycle: compiled.id, institutionalContext,
  }, options);
  appendObservation({
    type: "PromptMapeCycleStarted", actor: ACTOR, customer: CUSTOMER, sessionId, turnId,
    generation, promptEvent: promptRecord.id, promptDigest: promptRecord.promptDigest,
    cycle: compiled.id, lots: compiled.lots, interruption: previous !== null,
    supersedes: previous?.cycle ?? null, observedAt,
  }, options);
  const monitorLot = compiled.lots.find((lot) => lot.skill === "monitor-leader-move");
  for (const knowledgeClass of ["LeaderMoveK", "RequirementK"]) {
    recordCodexMapeArtifact({
      cycle: compiled.id,
      workLot: monitorLot,
      skill: "monitor-leader-move",
      knowledgeClass,
      issuer: ACTOR,
      payloadDigest: compiled.move,
      sourceReceipts: [promptRecord.promptDigest, promptRecord.id],
      knowledgeReceipts: { LeaderExpressionK: promptRecord.promptDigest },
      observedAt,
    }, options);
  }
  writeSessionState(sessionId, { generation, resumable: null, active: {
    type: "PromptMapeCycleStarted", sessionId, turnId, generation, cycle: compiled.id,
    promptEvent: promptRecord.id, interruption: previous !== null, supersedes: previous?.cycle ?? null,
  } }, options);
  return Object.freeze({ promptEvent: promptRecord, cycle: compiled, interruption: previous !== null, supersededCycle: previous?.cycle ?? null });
}

export function toolUseDisposition(input, options = {}) {
  const sessionId = nonempty(input.session_id, "session_id");
  const turnId = nonempty(input.turn_id, "turn_id");
  const active = activeCycle(sessionId, options);
  const state = readSessionState(sessionId, options);
  const sessionStarts = state.generation;
  const superseded = readTrajectory(options).findLast((row) => row.type === "PromptMapeCycleSuperseded" && row.sessionId === sessionId && row.priorTurnId === turnId);
  const sameTurnCorrection = superseded && superseded.correctionTurnId === turnId && active?.turnId === turnId && active.cycle === superseded.supersededBy;
  if (superseded && !sameTurnCorrection) return Object.freeze({ allowed: false, reason: `turn ${turnId} was superseded by correction cycle ${superseded.supersededBy}; restart Monitor over the correction before tool execution` });
  if (!active && sessionStarts === 0) return Object.freeze({ allowed: true, legacySession: true });
  if (!active) {
    const resumable = state.resumable;
    if (resumable?.cycle && resumable.turnId !== turnId) {
      return Object.freeze({ allowed: true, cycle: resumable.cycle, resumedAfterBoundary: true });
    }
    return Object.freeze({ allowed: false, reason: "the persisted prompt MAPE cycle is already closed; a new prompt must be monitored before more tool execution" });
  }
  if (active.turnId !== turnId) {
    return Object.freeze({ allowed: true, cycle: active.cycle, delegatedTurn: true });
  }
  return Object.freeze({ allowed: true, cycle: active.cycle, ...(sameTurnCorrection ? { restartedGeneration: true } : {}) });
}

const NATIVE_MUTATION_TOOLS = /^(?:Agent|spawn_agent|collaboration\.spawn_agent|multi_agent_v1__spawn_agent)$/u;
const NATIVE_PROVIDER_TOOLS = /^(?:spawn_agent|collaboration\.spawn_agent)$/u;
const GITHUB_INDUCTION_TOOL = /^mcp__.*(?:github|software.*induction)/iu;

/**
 * Normalize the fields accepted by the native model-selecting spawn boundary.
 * Model exceptions are source-declared assignment policy, never a caller's
 * assertion that an explicit model was user-authorized.
 */
export function providerLaunchDisposition(input, options = {}) {
  const tool = String(input?.tool_name ?? "unknown");
  if (!NATIVE_PROVIDER_TOOLS.test(tool)) return Object.freeze({ allowed: true, applies: false });
  const assignment = input?.tool_input ?? {};
  const taskName = assignment.task_name;
  if (Object.hasOwn(assignment, "thinking")) {
    return Object.freeze({ allowed: false, applies: true, reason: "native spawn uses reasoning_effort, not thinking" });
  }
  if (typeof taskName !== "string" || taskName.trim() === "") {
    return Object.freeze({ allowed: false, applies: true, reason: "provider work must name its bounded assignment" });
  }
  const policy = options.launchPolicy;
  const defaultSelection = policy?.default;
  const selected = policy?.assignmentOverrides?.[taskName] ?? defaultSelection;
  if (!selected || typeof selected.model !== "string" || typeof selected.reasoning_effort !== "string") {
    return Object.freeze({ allowed: false, applies: true, reason: `assignment ${taskName} has no declared provider selection` });
  }
  const model = assignment.model ?? selected.model;
  const reasoningEffort = assignment.reasoning_effort ?? selected.reasoning_effort;
  if (model !== selected.model || reasoningEffort !== selected.reasoning_effort) {
    return Object.freeze({ allowed: false, applies: true, reason: `assignment ${taskName} is declared for ${selected.model} with ${selected.reasoning_effort} reasoning` });
  }
  const forkTurns = assignment.fork_turns ?? "none";
  if (forkTurns !== "none" && !/^[1-9][0-9]*$/u.test(forkTurns)) {
    return Object.freeze({ allowed: false, applies: true, reason: "model-selecting provider work requires fork_turns none or a positive numeric context" });
  }
  const preamble = policy.instructionPreamble;
  if (preamble !== undefined && (typeof preamble !== "string" || preamble.length > 2048)) {
    return Object.freeze({ allowed: false, applies: true, reason: "provider instruction preamble must be a string of at most 2048 characters" });
  }
  const message = preamble && typeof assignment.message === "string" && !assignment.message.startsWith(preamble + "\n\n")
    ? preamble + "\n\n" + assignment.message
    : assignment.message;
  const updatedInput = assignment.message === message && assignment.model === model && assignment.reasoning_effort === reasoningEffort && assignment.fork_turns === forkTurns
    ? assignment
    : { ...assignment, ...(message === undefined ? {} : { message }), model, reasoning_effort: reasoningEffort, fork_turns: forkTurns };
  return Object.freeze({
    allowed: true,
    applies: true,
    assignment: taskName,
    ...(updatedInput === assignment ? {} : { updatedInput }),
  });
}

export function governedMutationDisposition(input) {
  const tool = String(input.tool_name ?? "unknown");
  if (GITHUB_INDUCTION_TOOL.test(tool)) return Object.freeze({ allowed: true, route: "github-software-induction" });
  if (NATIVE_MUTATION_TOOLS.test(tool)) {
    return Object.freeze({ allowed: true, route: "bounded-provider-delegation" });
  }
  if (tool === "apply_patch") {
    const patch = typeof input.tool_input === "string"
      ? input.tool_input
      : ["patch", "input", "command", "cmd"].map((key) => input.tool_input?.[key]).find((value) => typeof value === "string") ?? "";
    const paths = [
      ...patch.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): ([^\n]+)$/gmu),
      ...patch.matchAll(/^(?:\+\+\+|---) [ab]\/([^\n]+)$/gmu),
    ].map((match) => match[1]);
    const workspacePrefix = "/home/emsenn/info/";
    const normalizedPaths = paths.map((path) => path.startsWith(workspacePrefix) ? path.slice(workspacePrefix.length) : path);
    const workspacePath = (path) => path.length > 0
      && !path.startsWith("/")
      && !path.split("/").some((segment) => segment === ".." || segment === ".git");
    if (normalizedPaths.length > 0 && normalizedPaths.every(workspacePath)) {
      return Object.freeze({ allowed: true, route: "leader-authorized-workspace-patch" });
    }
    return Object.freeze({ allowed: false, reason: "project filesystem mutation is disabled; submit a proposal through the admitted software-induction route" });
  }
  return Object.freeze({ allowed: true });
}

export function pausePromptCycleBoundary(input, options = {}) {
  const sessionId = nonempty(input.session_id, "session_id");
  const turnId = nonempty(input.turn_id, "turn_id");
  const active = activeCycle(sessionId, options);
  if (!active || active.turnId !== turnId) return null;
  const record = appendObservation({ type: "PromptMapeCyclePaused", actor: ACTOR, sessionId, turnId, cycle: active.cycle, boundary: input.hook_event_name, observedAt: (options.now ?? (() => new Date().toISOString()))() }, options).record;
  const state = readSessionState(sessionId, options);
  writeSessionState(sessionId, { generation: state.generation, active: null, resumable: active }, options);
  return record;
}

export function completePromptCycleBoundary(input, options = {}) {
  const sessionId = nonempty(input.session_id, "session_id");
  const turnId = nonempty(input.turn_id, "turn_id");
  const active = activeCycle(sessionId, options);
  if (!active || active.turnId !== turnId) return null;
  const record = appendObservation({ type: "PromptMapeCycleCompleted", actor: ACTOR, sessionId, turnId, cycle: active.cycle, boundary: input.hook_event_name, observedAt: (options.now ?? (() => new Date().toISOString()))() }, options).record;
  const state = readSessionState(sessionId, options);
  writeSessionState(sessionId, { generation: state.generation, active: null, resumable: active }, options);
  return record;
}

export function readPromptEvents(options = {}) { return Object.freeze(rows(options)); }
