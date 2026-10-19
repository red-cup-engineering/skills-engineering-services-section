#!/usr/bin/env node
// Ingest Claude Code transcripts (and Codex rollouts) into priced expense records, per session and agent.
//   node scripts/ingest-agent-session-transcripts.mjs [--day YYYY-MM-DD] [--claude-project DIR]... [--codex DIR]...
//        [--prices FILE] [--out DIR] [--simulate-handoff THRESHOLD:HANDOFF] [--allow-later-price-claim] [--dry-run]
// Reads usage fields only. Prices come from published-price claims; a model with no claim is reported unpriced.
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { ingestAgentSessions, writeExpenseRecords } from "../src/ingest.mjs";
import { loadPriceClaims } from "../src/published-prices.mjs";
import { totalsOf } from "../src/agent-expense.mjs";
import { microsToDecimal } from "../src/decimal-money.mjs";

const section = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const values = (flag) => args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));
const one = (flag, fallback) => values(flag)[0] ?? fallback;

const day = one("--day", new Date().toISOString().slice(0, 10));
const claudeProjects = values("--claude-project");
const codexRoots = values("--codex");
const simulateText = one("--simulate-handoff");
const simulate = simulateText === undefined ? undefined : (([t, h]) => ({ thresholdTokens: Number(t), handoffTokens: Number(h) }))(simulateText.split(":"));
const claims = loadPriceClaims(one("--prices", path.join(section, "data/records/2026-10-19-anthropic-published-prices.json")));
const outDir = one("--out", path.join(section, "data/records/agent-inference-expense"));

const result = ingestAgentSessions({
  claudeProjects: claudeProjects.length > 0 ? claudeProjects : [path.join(homedir(), ".claude/projects/-home-emsenn-info")],
  codexRoots: codexRoots.length > 0 ? codexRoots : [path.join(homedir(), ".codex/sessions"), path.join(homedir(), ".codex/archived_sessions")],
  claims, day, simulate, allowLaterPrices: args.includes("--allow-later-price-claim"),
});

const files = args.includes("--dry-run") ? [] : writeExpenseRecords(result.records, outDir, day);
if (simulate !== undefined && !args.includes("--dry-run")) writeFileSync(path.join(outDir, day, "handoff-simulation.json"), JSON.stringify({ day, assumptions: "see simulateHandoff in src/context-budget.mjs", simulate, results: result.simulations.map((row) => ({ ...row, actualMicros: String(row.actualMicros), simulatedMicros: String(row.simulatedMicros), savedMicros: String(row.savedMicros) })) }, null, 2) + "\n");
const total = totalsOf(result.records);
console.log(JSON.stringify({ day, records: result.records.length, sessions: new Set(result.records.map((r) => r.sessionId)).size, files: files.length, turns: total.turns, tokens: total.tokens, pricedUsd: microsToDecimal(total.pricedMicros), unpricedTurns: total.unpricedTurns, skipped: result.skipped }, null, 1));
