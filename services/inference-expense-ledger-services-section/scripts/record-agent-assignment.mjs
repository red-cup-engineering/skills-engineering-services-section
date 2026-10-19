#!/usr/bin/env node
// Record an agent assignment to a Work item, or its outcome, in the append-only assignment journal.
//   record-agent-assignment.mjs assigned --work ID --session ID (--agent ID | --tool-use ID) [--title T]
//   record-agent-assignment.mjs outcome  --work ID --session ID (--agent ID | --tool-use ID) --status done|partial|failed|abandoned|handed-off [--summary S]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendAssignmentEvent } from "../src/work-cost.mjs";

const section = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [event, ...args] = process.argv.slice(2);
const one = (flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };
const journal = one("--journal") ?? process.env.AGENT_ASSIGNMENT_JOURNAL ?? path.join(section, "data/records/agent-assignments/journal.jsonl");
try {
  const row = appendAssignmentEvent(journal, { event, workId: one("--work"), sessionId: one("--session"), agentId: one("--agent"), toolUseId: one("--tool-use"), title: one("--title"), status: one("--status"), summary: one("--summary") });
  console.log(JSON.stringify(row));
} catch (error) { console.error(error.message); process.exit(2); }
