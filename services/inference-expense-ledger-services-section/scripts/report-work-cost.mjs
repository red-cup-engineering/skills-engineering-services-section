#!/usr/bin/env node
// Per-Work cost roll-up: assignments joined to the expense ledger.
//   node scripts/report-work-cost.mjs [--ledger DIR] [--journal FILE] [--json]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAssignmentEvents, workCostRollup } from "../src/work-cost.mjs";

const section = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const one = (flag, fallback) => { const i = args.indexOf(flag); return i === -1 ? fallback : args[i + 1]; };
const ledger = one("--ledger", path.join(section, "data/records/agent-inference-expense"));
const records = readdirSync(ledger, { recursive: true }).filter((f) => String(f).endsWith(".jsonl")).flatMap((f) => readFileSync(path.join(ledger, String(f)), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const rollup = workCostRollup(readAssignmentEvents(one("--journal", process.env.AGENT_ASSIGNMENT_JOURNAL ?? path.join(section, "data/records/agent-assignments/journal.jsonl"))), records);
if (args.includes("--json")) console.log(JSON.stringify(rollup, null, 1));
else for (const w of rollup) console.log(`${w.workId} [${w.status}] ${w.costUsd} USD, ${w.agents.length} agent(s), ${w.turns} turns${w.unmatchedAssignments.length ? `, UNMATCHED ${w.unmatchedAssignments.join(",")}` : ""}${w.unpricedTurns ? `, ${w.unpricedTurns} unpriced turns` : ""}${w.title ? ` - ${w.title}` : ""}`);
