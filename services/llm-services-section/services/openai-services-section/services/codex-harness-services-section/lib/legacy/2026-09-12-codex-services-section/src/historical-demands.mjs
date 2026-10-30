import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { ACTOR, DEFAULT_STATE_ROOT, appendObservation, identity } from "./enterprise.mjs";
import { admitPrompt, readPromptEvents } from "./prompt-cycle.mjs";
import { semanticByteIdentity } from "./semiotic-circuit.mjs";

export const DEFAULT_CODEX_SESSIONS_ROOT = "/home/emsenn/.codex/sessions";

function filesBelow(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  };
  visit(resolve(root));
  return files;
}

function digest(bytes) {
  return semanticByteIdentity(bytes, "bare-cedar-fog-codex.session-transcript-carrier").id;
}

function readSession(path) {
  const bytes = readFileSync(path);
  const rows = [];
  const problems = [];
  for (const [index, line] of bytes.toString("utf8").split("\n").entries()) {
    if (line.trim() === "") continue;
    try { rows.push(JSON.parse(line)); }
    catch (error) { problems.push(Object.freeze({ source: path, line: index + 1, error: error instanceof Error ? error.message : String(error) })); }
  }
  const sessionId = rows.find((row) => row.type === "session_meta")?.payload?.id ?? null;
  const demands = rows.filter((row) => row.type === "event_msg" && row.payload?.type === "user_message" && typeof row.payload.message === "string" && row.payload.message.trim() !== "").map((row) => Object.freeze({
    timestamp: row.timestamp ?? null,
    sessionId,
    clientId: row.payload.client_id ?? null,
    text: row.payload.message,
  }));
  return Object.freeze({ source: path, sourceDigest: digest(bytes), rowCount: rows.length, demands, problems });
}

export function observeHistoricalDemands({ sessionsRoot = DEFAULT_CODEX_SESSIONS_ROOT, stateRoot } = {}) {
  const cacheRoot = resolve(stateRoot ?? DEFAULT_STATE_ROOT);
  const cachePath = join(cacheRoot, "historical-demand-index.json");
  let cached = { version: 1, files: {} };
  let cacheProblem = null;
  try {
    const value = JSON.parse(readFileSync(cachePath, "utf8"));
    if (value?.version === 1 && value.files && typeof value.files === "object") cached = value;
    else cacheProblem = { source: cachePath, line: null, error: "historical demand cache has an unsupported shape; rebuilt from transcripts" };
  } catch (error) {
    if (error?.code !== "ENOENT") cacheProblem = { source: cachePath, line: null, error: "historical demand cache was unreadable; rebuilt from transcripts" };
  }
  const files = filesBelow(sessionsRoot);
  const sessions = files.map((path) => {
    const stat = statSync(path);
    const prior = cached.files[path];
    if (prior?.size === stat.size && prior?.mtimeMs === stat.mtimeMs && prior.session) return prior.session;
    return readSession(path);
  });
  const nextCache = {
    version: 1,
    files: Object.fromEntries(files.map((path, index) => {
      const stat = statSync(path);
      return [path, { size: stat.size, mtimeMs: stat.mtimeMs, session: sessions[index] }];
    })),
  };
  const encodedCache = JSON.stringify(nextCache);
  let priorCache = null;
  try { priorCache = readFileSync(cachePath, "utf8"); } catch {}
  if (priorCache !== encodedCache) {
    mkdirSync(cacheRoot, { recursive: true });
    const temporary = cachePath + "." + process.pid + ".tmp";
    writeFileSync(temporary, encodedCache, { mode: 0o600 });
    renameSync(temporary, cachePath);
  }
  const current = new Set(readPromptEvents({ ...(stateRoot ? { stateRoot } : {}) }).map((row) => row.promptDigest));
  const byDigest = new Map();
  for (const session of sessions) {
    for (const demand of session.demands) {
      const promptDigest = identity(demand.text);
      const source = Object.freeze({ path: session.source, digest: session.sourceDigest, timestamp: demand.timestamp, sessionId: demand.sessionId, clientId: demand.clientId });
      const prior = byDigest.get(promptDigest);
      if (prior) prior.sources.push(source);
      else byDigest.set(promptDigest, { id: identity({ type: "HistoricalCodexDemand", promptDigest }), type: "HistoricalCodexDemand", promptDigest, prompt: demand.text, sources: [source] });
    }
  }
  const demands = [...byDigest.values()].map((demand) => Object.freeze({
    ...demand,
    sources: Object.freeze(demand.sources.sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)))),
    latestObservedAt: demand.sources.map(({ timestamp }) => timestamp).filter(Boolean).sort().at(-1) ?? null,
    status: current.has(demand.promptDigest) ? "admitted-to-prompt-cycle" : "pending-backward-review",
  })).sort((left, right) => String(right.latestObservedAt).localeCompare(String(left.latestObservedAt)));
  return Object.freeze({
    type: "HistoricalCodexDemandLedger",
    direction: "newest-to-oldest",
    sessionFileCount: sessions.length,
    transcriptRowCount: sessions.reduce((sum, session) => sum + session.rowCount, 0),
    distinctDemandCount: demands.length,
    pendingDemandCount: demands.filter(({ status }) => status === "pending-backward-review").length,
    demands: Object.freeze(demands),
    problems: Object.freeze([...(cacheProblem ? [cacheProblem] : []), ...sessions.flatMap(({ problems }) => problems)]),
  });
}

export function admitNextHistoricalDemand(options = {}) {
  const ledger = observeHistoricalDemands(options);
  const demand = ledger.demands.find(({ status }) => status === "pending-backward-review");
  if (!demand) return Object.freeze({ disposition: "historical-demand-ledger-exhausted", ledger });
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  const admitted = admitPrompt({
    session_id: "history:" + demand.id,
    turn_id: demand.id,
    prompt: demand.prompt,
  }, { ...options, now: () => observedAt });
  const sourceReceipt = identity({ historicalDemand: demand.id, sources: demand.sources });
  const record = appendObservation({
    type: "HistoricalCodexDemandAdmitted", actor: ACTOR, historicalDemand: demand.id,
    promptDigest: demand.promptDigest, cycle: admitted.cycle.id, sourceReceipt,
    sources: demand.sources, direction: ledger.direction, observedAt,
  }, options).record;
  return Object.freeze({ disposition: "historical-demand-admitted", demand, admitted, record });
}
