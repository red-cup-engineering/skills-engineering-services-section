#!/usr/bin/env node
// Per-agent context budgets and cost, read from the expense ledger.
//   node scripts/report-agent-context-budgets.mjs [--day YYYY-MM-DD] [--ledger DIR] [--budget TOKENS] [--json]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contextBudgetReport, DEFAULT_CONTEXT_BUDGET_TOKENS } from "../src/context-budget.mjs";

const section = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const one = (flag, fallback) => { const i = args.indexOf(flag); return i === -1 ? fallback : args[i + 1]; };
const day = one("--day", new Date().toISOString().slice(0, 10));
const dir = path.join(one("--ledger", path.join(section, "data/records/agent-inference-expense")), day);
const records = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const rows = contextBudgetReport(records, { budgetTokens: Number(one("--budget", DEFAULT_CONTEXT_BUDGET_TOKENS)) });
if (args.includes("--json")) console.log(JSON.stringify(rows, (k, v) => (typeof v === "bigint" ? String(v) : v), 1));
else {
  console.log("session | agent | role | turns | peak ctx | final ctx | over-budget turns | USD | state");
  for (const r of rows) console.log([r.sessionId.slice(0, 8), r.agentId.slice(0, 10), r.role, r.turns, r.peakContext, r.finalContext, r.turnsOverBudget, r.costUsd, r.overBudget ? `OVER ${r.budgetTokens}` : "ok"].join(" | "));
}
