// Readers for agent-session transcripts. They read usage fields only: a line is parsed to take
// its message id, model, timestamp and token counters, and nothing else of it (prompts, tool
// inputs, results, paths, and any credential a tool result carried) is kept.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** One Claude Code assistant row -> a request, or null when it carries no billable usage. */
function claudeRequestOf(row) {
  const message = row?.message;
  const usage = message?.usage;
  if (row?.type !== "assistant" || usage === undefined || usage === null) return null;
  if (message.model === "<synthetic>" || typeof message.model !== "string") return null;
  const written = count(usage.cache_creation_input_tokens);
  const split = usage.cache_creation;
  const cacheWrite5m = split === undefined || split === null ? 0 : count(split.ephemeral_5m_input_tokens);
  const cacheWrite1h = split === undefined || split === null ? 0 : count(split.ephemeral_1h_input_tokens);
  const cacheWriteUnsplit = Math.max(0, written - cacheWrite5m - cacheWrite1h);
  const tokens = { input: count(usage.input_tokens), cacheWrite5m, cacheWrite1h, cacheRead: count(usage.cache_read_input_tokens), output: count(usage.output_tokens) };
  return {
    id: typeof message.id === "string" ? message.id : `${row.uuid}`,
    at: typeof row.timestamp === "string" ? row.timestamp : null,
    model: message.model,
    speed: usage.speed === "fast" ? "fast" : "standard",
    tokens,
    cacheWriteUnsplit,
    context: tokens.input + tokens.cacheRead + written,
  };
}

/** Requests of one Claude Code transcript, one per API message id (the last row of an id carries its final counters). */
export function readClaudeTranscript(file) {
  const byId = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"usage"')) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const request = claudeRequestOf(row);
    if (request !== null) byId.set(request.id, request);
  }
  return [...byId.values()].filter((request) => request.at !== null).sort((a, b) => a.at.localeCompare(b.at));
}

function readMeta(file) {
  try {
    const meta = JSON.parse(readFileSync(file, "utf8"));
    const text = (value) => (typeof value === "string" ? value.slice(0, 120) : null);
    return { agentType: text(meta.agentType), description: text(meta.description), toolUseId: text(meta.toolUseId), spawnDepth: Number.isInteger(meta.spawnDepth) ? meta.spawnDepth : null };
  } catch { return { agentType: null, description: null, toolUseId: null, spawnDepth: null }; }
}

/**
 * Every agent transcript of a Claude Code project directory (`~/.claude/projects/<project>`):
 * each `<session>.jsonl` is that session's lead; each `<session>/subagents/agent-<id>.jsonl` is a subagent.
 * `modifiedSince` (ms epoch) skips transcripts not written since, before any are read.
 */
export function listClaudeAgentTranscripts(projectDir, { modifiedSince = 0 } = {}) {
  const agents = [];
  for (const entry of readdirSync(projectDir)) {
    if (!entry.endsWith(".jsonl")) continue;
    const sessionId = entry.slice(0, -".jsonl".length);
    const leadFile = path.join(projectDir, entry);
    if (statSync(leadFile).mtimeMs >= modifiedSince) agents.push({ harness: "claude-code", sessionId, agentId: "lead", role: "lead", file: leadFile, meta: null });
    const subDir = path.join(projectDir, sessionId, "subagents");
    if (!existsSync(subDir)) continue;
    for (const sub of readdirSync(subDir)) {
      if (!sub.endsWith(".jsonl")) continue;
      const file = path.join(subDir, sub);
      if (statSync(file).mtimeMs < modifiedSince) continue;
      const id = sub.slice(0, -".jsonl".length).replace(/^agent-/u, "");
      agents.push({ harness: "claude-code", sessionId, agentId: id, role: "subagent", file, meta: readMeta(path.join(subDir, `${sub.slice(0, -".jsonl".length)}.meta.json`)) });
    }
  }
  return agents;
}

/**
 * A Codex rollout (`rollout-*.jsonl`): `token_count` events carry the running `total_token_usage`;
 * a request is each increase of that total. Codex counts cached input inside input, so the
 * uncached input is input minus cached. Codex has no cache-write TTL split.
 */
export function readCodexRollout(file) {
  const requests = [];
  let sessionId = path.basename(file, ".jsonl");
  let model = null;
  let previous = { input: 0, cached: 0, write: 0, output: 0, total: 0 };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"session_meta"') && !line.includes('"turn_context"') && !line.includes('"token_count"')) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const payload = row?.payload;
    if (row?.type === "session_meta" && typeof payload?.id === "string") sessionId = payload.id;
    else if (row?.type === "turn_context" && typeof payload?.model === "string") model = payload.model;
    else if (row?.type === "event_msg" && payload?.type === "token_count") {
      const total = payload.info?.total_token_usage;
      if (total === undefined || total === null || count(total.total_tokens) <= previous.total) continue;
      const now = { input: count(total.input_tokens), cached: count(total.cached_input_tokens), write: count(total.cache_write_input_tokens), output: count(total.output_tokens), total: count(total.total_tokens) };
      const inputDelta = now.input - previous.input;
      const cachedDelta = now.cached - previous.cached;
      requests.push({
        id: `${sessionId}#${now.total}`,
        at: typeof row.timestamp === "string" ? row.timestamp : null,
        model: model ?? "unknown",
        speed: "standard",
        tokens: { input: Math.max(0, inputDelta - cachedDelta), cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: cachedDelta, output: now.output - previous.output },
        cacheWriteUnsplit: Math.max(0, now.write - previous.write),
        context: now.input - previous.input,
      });
      previous = now;
    }
  }
  return { sessionId, requests: requests.filter((request) => request.at !== null) };
}
