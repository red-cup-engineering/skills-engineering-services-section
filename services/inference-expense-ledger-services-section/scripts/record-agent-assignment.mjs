#!/usr/bin/env node
// Record agent assignments to Work, and their outcomes, in the append-only assignment journal.
// The record is derived from the lead transcript (Agent tool calls and task-notification statuses; metadata only):
//   record-agent-assignment.mjs derive --session ID [--project DIR]
// Idempotent: events already in the journal are not appended again.
// Manual override, for an assignment no transcript shows:
//   record-agent-assignment.mjs assigned --work ID --session ID (--agent ID | --tool-use ID) [--title T]
//   record-agent-assignment.mjs outcome  --work ID --session ID (--agent ID | --tool-use ID) --status done|partial|failed|abandoned|handed-off [--summary S]
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendAssignmentEvent } from "../src/work-cost.mjs";
import { deriveAssignmentEvents, syncDerivedEvents } from "../src/assignment-derive.mjs";

const section = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [event, ...args] = process.argv.slice(2);
const one = (flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };
const journal = one("--journal") ?? process.env.AGENT_ASSIGNMENT_JOURNAL ?? path.join(section, "data/records/agent-assignments/journal.jsonl");
try {
  if (event === "derive") {
    const session = one("--session");
    if (session === undefined) throw new TypeError("derive needs --session");
    const project = one("--project") ?? path.join(os.homedir(), ".claude/projects", process.cwd().split(path.sep).join("-"));
    const derived = deriveAssignmentEvents(project, session);
    const added = syncDerivedEvents(journal, derived, appendAssignmentEvent);
    console.log(JSON.stringify({ derived: derived.length, appended: added.length, journal }));
  } else {
    console.log(JSON.stringify(appendAssignmentEvent(journal, { event, workId: one("--work"), sessionId: one("--session"), agentId: one("--agent"), toolUseId: one("--tool-use"), title: one("--title"), status: one("--status"), summary: one("--summary") })));
  }
} catch (error) { console.error(error.message); process.exit(2); }
