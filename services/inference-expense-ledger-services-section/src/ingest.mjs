// Ingest agent-session transcripts into expense records for one UTC day.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expenseRecordsOfAgent, inWindow } from "./agent-expense.mjs";
import { findPriceClaim } from "./published-prices.mjs";
import { simulateHandoff } from "./context-budget.mjs";
import { listClaudeAgentTranscripts, readClaudeTranscript, readCodexRollout } from "./session-transcripts.mjs";

const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);

function* codexRollouts(root) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* codexRollouts(full);
    else if (/^rollout-.*\.jsonl$/u.test(entry.name)) yield full;
  }
}

/**
 * @param {object} options
 * @param {string[]} options.claudeProjects Claude Code project directories
 * @param {string[]} [options.codexRoots] directories holding Codex rollouts
 * @param {object[]} options.claims published price claims
 * @param {string} options.day UTC day, YYYY-MM-DD
 * @param {{thresholdTokens:number, handoffTokens:number}} [options.simulate]
 * @returns {{records: object[], simulations: object[], skipped: object[]}}
 */
export function ingestAgentSessions({ claudeProjects, codexRoots = [], claims, day, simulate, allowLaterPrices = false, now = new Date() }) {
  const window = { since: `${day}T00:00:00.000Z`, until: `${nextDay(day)}T00:00:00.000Z` };
  const modifiedSince = Date.parse(window.since);
  const observedThrough = now.toISOString();
  const records = [];
  const simulations = [];
  const skipped = [];
  const take = (agent, requests) => {
    const inDay = requests.filter((request) => inWindow(request, window));
    if (inDay.length === 0) return;
    records.push(...expenseRecordsOfAgent(agent, inDay, { claims, day, provider: agent.provider ?? "anthropic", observedThrough, allowLaterPrices }));
    if (simulate === undefined) return;
    for (const model of new Set(inDay.map((request) => request.model))) {
      const group = inDay.filter((request) => request.model === model && request.speed === "standard");
      const result = simulateHandoff(group, findPriceClaim(claims, { provider: "anthropic", model, speed: "standard", day, allowLater: allowLaterPrices }), simulate);
      if (result !== null) simulations.push({ sessionId: agent.sessionId, agentId: agent.agentId, role: agent.role, description: agent.meta?.description ?? null, model, ...result });
    }
  };
  for (const projectDir of claudeProjects) {
    for (const agent of listClaudeAgentTranscripts(projectDir, { modifiedSince })) {
      try { take(agent, readClaudeTranscript(agent.file)); } catch (error) { skipped.push({ file: path.basename(agent.file), reason: String(error.message).slice(0, 120) }); }
    }
  }
  for (const root of codexRoots) {
    for (const file of codexRollouts(root)) {
      if (statSync(file).mtimeMs < modifiedSince) continue;
      try {
        const { sessionId, requests } = readCodexRollout(file);
        take({ harness: "codex", provider: "openai", sessionId, agentId: "lead", role: "lead", meta: null }, requests);
      } catch (error) { skipped.push({ file: path.basename(file), reason: String(error.message).slice(0, 120) }); }
    }
  }
  return { records, simulations, skipped };
}

/** One JSONL file per session under `<out>/<day>/`; returns the paths written. */
export function writeExpenseRecords(records, outDir, day) {
  const dir = path.join(outDir, day);
  mkdirSync(dir, { recursive: true });
  const bySession = new Map();
  for (const record of records) bySession.set(record.sessionId, [...(bySession.get(record.sessionId) ?? []), record]);
  const written = [];
  for (const [sessionId, rows] of bySession) {
    const file = path.join(dir, `${sessionId}.jsonl`);
    rows.sort((a, b) => (a.agent.id + a.model).localeCompare(b.agent.id + b.model));
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    written.push(file);
  }
  return written;
}
