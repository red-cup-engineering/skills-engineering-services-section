#!/usr/bin/env node
// Price ONE finished agent's transcript into its expense records, at the moment it ends (the SubagentStop hook calls this).
//   node scripts/ingest-one-agent-transcript.mjs --transcript FILE --session ID --agent ID [--type TYPE] [--description TEXT]
//        [--prices FILE] [--out DIR] [--allow-later-price-claim]
// Reads usage fields only. Writes <out>/<day>/<session>/<agent>.jsonl (default out: data/records/agent-inference-expense) and
// prints one JSON line: {agent, records, files, turns, pricedUsd}. The day ingest, run later, supersedes these files.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestAgentTranscript, writeAgentExpenseRecords } from "../src/ingest.mjs";
import { loadPriceClaims } from "../src/published-prices.mjs";
import { totalsOf } from "../src/agent-expense.mjs";
import { microsToDecimal } from "../src/decimal-money.mjs";

const section = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const one = (flag, fallback) => { const at = args.indexOf(flag); return at < 0 ? fallback : args[at + 1]; };
try {
  const file = one("--transcript");
  const sessionId = one("--session");
  const agentId = one("--agent");
  if (!file || !sessionId || !agentId) throw new TypeError("--transcript, --session and --agent are required");
  const claims = loadPriceClaims(one("--prices", path.join(section, "data/records/2026-10-19-anthropic-published-prices.json")));
  const agent = { harness: "claude-code", sessionId, agentId, role: "subagent", meta: { agentType: one("--type", null), description: one("--description", null), toolUseId: null } };
  const records = ingestAgentTranscript({ file, agent, claims, allowLaterPrices: args.includes("--allow-later-price-claim") });
  const files = writeAgentExpenseRecords(records, path.resolve(one("--out", path.join(section, "data/records/agent-inference-expense"))));
  const total = totalsOf(records);
  console.log(JSON.stringify({ agent: agentId, records: records.length, files, turns: total.turns, pricedUsd: microsToDecimal(total.pricedMicros), unpricedTurns: total.unpricedTurns }));
} catch (error) {
  console.error(`ingest-one-agent-transcript: ${error.message}`);
  process.exit(2);
}
