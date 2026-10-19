#!/usr/bin/env node
// Priced inference cost of Claude Code sessions per hour, split by lead and subagent, with the context each turn re-read.
//   node scripts/report-agent-cost-timeline.mjs --since ISO [--until ISO] [--session ID] [--claude-project DIR]...
//        [--bucket-minutes N] [--prices FILE] [--allow-later-price-claim] [--json]
// Reads usage fields only, through the same transcript reader and price claims as the ingest.
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expenseRecordsOfAgent, inWindow } from "../src/agent-expense.mjs";
import { loadPriceClaims } from "../src/published-prices.mjs";
import { listClaudeAgentTranscripts, readClaudeTranscript } from "../src/session-transcripts.mjs";
import { microsToDecimal } from "../src/decimal-money.mjs";

const section = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const values = (flag) => args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));
const one = (flag, fallback) => values(flag)[0] ?? fallback;
const since = one("--since");
if (since === undefined) { process.stderr.write("report-agent-cost-timeline: --since is required\n"); process.exit(2); }
const until = one("--until", new Date().toISOString());
const session = one("--session");
const bucketMs = Number(one("--bucket-minutes", "60")) * 60_000;
const projects = values("--claude-project").length > 0 ? values("--claude-project") : [path.join(homedir(), ".claude/projects/-home-emsenn-info")];
const claims = loadPriceClaims(one("--prices", path.join(section, "data/records/2026-10-19-anthropic-published-prices.json")));

const toMicros = (decimal) => Math.round(Number(decimal) * 1e6);
const buckets = new Map();
const bucketOf = (at) => new Date(Math.floor(Date.parse(at) / bucketMs) * bucketMs).toISOString();
for (const projectDir of projects) {
  for (const agent of listClaudeAgentTranscripts(projectDir, { modifiedSince: Date.parse(since) })) {
    if (session !== undefined && agent.sessionId !== session) continue;
    const requests = readClaudeTranscript(agent.file).filter((request) => inWindow(request, { since, until }));
    const byBucket = Map.groupBy(requests, (request) => bucketOf(request.at));
    for (const [start, group] of byBucket) {
      const day = start.slice(0, 10);
      const b = buckets.get(start) ?? { start, lead: 0, sub: 0, turns: 0, contextSum: 0, agents: new Set(), unpriced: 0 };
      for (const record of expenseRecordsOfAgent(agent, group, { claims, day, provider: "anthropic", observedThrough: until, allowLaterPrices: args.includes("--allow-later-price-claim") })) {
        if (!record.priced) { b.unpriced += record.turns; continue; }
        b[agent.role === "subagent" ? "sub" : "lead"] += toMicros(record.costUsd.total);
        b.turns += record.turns;
        b.contextSum += record.context.mean * record.turns;
      }
      b.agents.add(`${agent.sessionId}/${agent.agentId ?? "lead"}`);
      buckets.set(start, b);
    }
  }
}
const rows = [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start)).map((b) => ({
  start: b.start, leadUsd: microsToDecimal(b.lead), subagentUsd: microsToDecimal(b.sub), totalUsd: microsToDecimal(b.lead + b.sub),
  turns: b.turns, meanContextTokens: b.turns ? Math.round(b.contextSum / b.turns) : 0, agents: b.agents.size, unpricedTurns: b.unpriced,
}));
if (args.includes("--json")) console.log(JSON.stringify(rows, null, 1));
else for (const r of rows) console.log(`${r.start}  total ${r.totalUsd.padStart(10)}  lead ${r.leadUsd.padStart(9)}  sub ${r.subagentUsd.padStart(9)}  turns ${String(r.turns).padStart(5)}  ctx ${String(r.meanContextTokens).padStart(7)}  agents ${r.agents}`);
