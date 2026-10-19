// Derives agent assignments and their outcomes from a Claude Code lead transcript. Only tool-call
// metadata is read: an Agent call's description, a digest of its prompt (never the prompt), the id of
// the tool use and of the agent it returned, and a task notification's task id, tool-use id and status.
// Reports, results and summaries are never read or stored.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { assignmentEvent, readAssignmentEvents } from "./work-cost.mjs";

const AGENT_TOOLS = new Set(["Agent", "Task"]);
const STATUS_OF = Object.freeze({ completed: "done", failed: "failed", killed: "abandoned", stopped: "abandoned" });
export const workIdOf = (sessionId, toolUseId) => `agent-assignment:${sessionId.slice(0, 8)}:${toolUseId}`;

const digestOf = (prompt) => (typeof prompt === "string" ? createHash("sha256").update(prompt).digest("hex").slice(0, 16) : undefined);
const tag = (raw, name) => raw.match(new RegExp(`<${name}>([^<]*)</${name}>`, "u"))?.[1];

/** Subagent transcripts carry their spawning tool-use id and agent id in the file name and meta. */
function subagentIds(subDir) {
  const byToolUse = new Map();
  if (!existsSync(subDir)) return byToolUse;
  for (const name of readdirSync(subDir)) {
    if (!name.endsWith(".meta.json")) continue;
    try {
      const meta = JSON.parse(readFileSync(path.join(subDir, name), "utf8"));
      if (typeof meta.toolUseId === "string") byToolUse.set(meta.toolUseId, name.slice(0, -".meta.json".length).replace(/^agent-/u, ""));
    } catch { /* an unreadable meta names no agent */ }
  }
  return byToolUse;
}

/** Assigned and outcome events of one lead session, in transcript order. */
export function deriveAssignmentEvents(projectDir, sessionId) {
  const lead = path.join(projectDir, `${sessionId}.jsonl`);
  const ids = subagentIds(path.join(projectDir, sessionId, "subagents"));
  const uses = new Map();
  const outcomes = new Map();
  for (const line of readFileSync(lead, "utf8").split("\n")) {
    if (line === "") continue;
    const hasUse = line.includes('"tool_use"');
    const hasResult = line.includes('"tool_result"');
    const hasNote = line.includes("<task-notification>");
    if (!hasUse && !hasResult && !hasNote) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const at = typeof row.timestamp === "string" ? row.timestamp : undefined;
    if (hasNote && row.type === "queue-operation" && row.operation === "enqueue" && typeof row.content === "string") {
      const status = STATUS_OF[tag(row.content, "status")];
      const toolUseId = tag(row.content, "tool-use-id");
      if (status !== undefined && toolUseId !== undefined) outcomes.set(toolUseId, { status, agentId: tag(row.content, "task-id"), at });
    }
    const content = row.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use" && AGENT_TOOLS.has(block.name)) uses.set(block.id, { description: block.input?.description, promptDigest: digestOf(block.input?.prompt), at });
      else if (block.type === "tool_result" && uses.has(block.tool_use_id)) {
        const result = row.toolUseResult;
        const use = uses.get(block.tool_use_id);
        if (typeof result?.agentId === "string") use.agentId = result.agentId;
        if (result?.status === "completed" && !outcomes.has(block.tool_use_id)) outcomes.set(block.tool_use_id, { status: "done", agentId: result.agentId, at });
        else if (block.is_error === true && !outcomes.has(block.tool_use_id)) outcomes.set(block.tool_use_id, { status: "failed", at });
      }
    }
  }
  const events = [];
  for (const [toolUseId, use] of uses) {
    const agentId = use.agentId ?? ids.get(toolUseId) ?? outcomes.get(toolUseId)?.agentId;
    const identity = { workId: workIdOf(sessionId, toolUseId), sessionId, toolUseId, ...(agentId === undefined ? {} : { agentId }) };
    events.push(assignmentEvent({ ...identity, event: "assigned", title: use.description, promptDigest: use.promptDigest, derived: true, at: use.at }));
    const outcome = outcomes.get(toolUseId);
    if (outcome !== undefined) events.push(assignmentEvent({ ...identity, event: "outcome", status: outcome.status, derived: true, at: outcome.at }));
  }
  return events;
}

/** Appends the derived events the journal does not yet hold (same event, Work and status). Idempotent. */
export function syncDerivedEvents(journalFile, events, append) {
  const held = new Set(readAssignmentEvents(journalFile).map((e) => `${e.event}|${e.workId}|${e.status ?? ""}`));
  const added = events.filter((e) => !held.has(`${e.event}|${e.workId}|${e.status ?? ""}`));
  for (const e of added) append(journalFile, e);
  return added;
}
