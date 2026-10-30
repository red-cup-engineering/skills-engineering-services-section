import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FRICTION_KINDS,
  READOUT_KIND,
  buildFrictionWorkIntent,
  classifyToolResult,
  deriveSessionFrictions,
  frictionTaskCell,
  normalizeFailureLine,
  parseTranscriptLines,
  taskFromFrictionReport,
  tasksFromFrictions,
} from "../src/session-frictions.mjs";
import { deriveTranscriptFrictions } from "../scripts/derive-set-of-session-frictions.mjs";
import { admitFrictionWorkIntents } from "../scripts/admit-set-of-friction-work-intents.mjs";
import { admitFriction } from "../scripts/admit-friction.mjs";
import { CHAIN_ITEMS, PLAN_CELL } from "../scripts/admit-set-of-health-work-intents.mjs";

const use = (id, name, input) => JSON.stringify({ type: "assistant", sessionId: "s-1", timestamp: "2026-09-04T00:00:00.000Z", message: { content: [{ type: "tool_use", id, name, input }] } });
const result = (id, content, isError, t = "2026-09-04T00:00:01.000Z") => JSON.stringify({ type: "user", sessionId: "s-1", timestamp: t, message: { content: [{ type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } });

const FIXTURE = [
  use("t1", "Bash", { command: "ls content/text/glossary/terms/", description: "List glossary terms" }),
  result("t1", "Exit code 2\nls: cannot access 'content/text/glossary/terms/': No such file or directory", true),
  use("t2", "Bash", { command: "ls content/text/glossary/terms/", description: "List glossary terms" }),
  result("t2", "Exit code 2\nls: cannot access 'content/text/glossary/terms/': No such file or directory", true, "2026-09-04T00:00:05.000Z"),
  use("t3", "Bash", { command: "echo fine" }),
  result("t3", "fine", false),
  use("t4", "mcp__ops__orientation", { input: {} }),
  result("t4", "The user doesn't want to proceed with this tool use.", true),
  use("t5", "mcp__jsnode-server__jsnode_search", { query: "json" }),
  result("t5", [{ type: "text", text: "Error: result (128,980 characters) exceeds maximum allowed tokens." }], true),
  "not json",
].join("\n");

test("parseTranscriptLines skips non-JSON lines", () => {
  assert.equal(parseTranscriptLines(FIXTURE).length, 10);
});

test("normalizeFailureLine takes the first non-empty line, lowercased, digits collapsed", () => {
  assert.equal(normalizeFailureLine("\n  Exit code 12\nrest"), "exit code #");
});

test("classifyToolResult: non-zero Bash exit is a command failure, is_error is a tool error, rejection is nothing", () => {
  assert.deepEqual(classifyToolResult({ name: "Bash" }, { content: "Exit code 1\nboom" }), { kind: FRICTION_KINDS.commandFailure, summary: "boom" });
  assert.deepEqual(classifyToolResult({ name: "X" }, { content: "Error: bad", is_error: true }), { kind: FRICTION_KINDS.toolError, summary: "error: bad" });
  assert.equal(classifyToolResult({ name: "X" }, { content: "The user doesn't want to proceed", is_error: true }), null);
  assert.equal(classifyToolResult({ name: "Bash" }, { content: "Exit code 0\nok" }), null);
});

test("deriveSessionFrictions groups repeats, skips steering, keeps commands and timestamps", () => {
  const readout = deriveSessionFrictions(parseTranscriptLines(FIXTURE));
  assert.equal(readout.kind, READOUT_KIND);
  assert.match(readout.sessionDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(readout.frictions.length, 2);
  const [ls, search] = readout.frictions;
  assert.equal(ls.kind, FRICTION_KINDS.commandFailure);
  assert.equal(ls.count, 2);
  assert.equal(ls.command, "List glossary terms");
  assert.equal(ls.firstAt, "2026-09-04T00:00:01.000Z");
  assert.equal(ls.lastAt, "2026-09-04T00:00:05.000Z");
  assert.equal(search.tool, "mcp__jsnode-server__jsnode_search");
  assert.equal(search.command, 'query "json"');
});

test("tasksFromFrictions yields deterministic cells under the plan with transcript provenance", () => {
  const readout = deriveSessionFrictions(parseTranscriptLines(FIXTURE));
  const tasks = tasksFromFrictions(readout.frictions, { sessionDigest: readout.sessionDigest });
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].cell, frictionTaskCell(readout.frictions[0]));
  assert.match(tasks[0].cell, /^task:friction-command-failure-bash-/u);
  assert.equal(tasks[0].parent, PLAN_CELL);
  assert.deepEqual(tasks[0].provenance, [{ source: "session-transcript" }]);
  assert.match(tasks[0].evidence[0], /session=sha256:/u);
});

test("taskFromFrictionReport shapes a carrier falsehood and refuses bad kinds or empty fields", () => {
  const task = taskFromFrictionReport({ kind: FRICTION_KINDS.carrierFalsehood, carrier: "CLAUDE.md:64", observed: "content/text/glossary/terms/", expected: "glossaries live per section" });
  assert.match(task.cell, /^task:friction-carrier-falsehood-claude-md-64-[0-9a-f]{8}$/u);
  assert.match(task.text, /states "content\/text\/glossary\/terms\/" but on disk/u);
  assert.throws(() => taskFromFrictionReport({ kind: "tool-error", carrier: "x", observed: "y", expected: "z" }), /kind must be one of/u);
  assert.throws(() => taskFromFrictionReport({ kind: FRICTION_KINDS.carrierFalsehood, carrier: "x", observed: "", expected: "z" }), /non-empty observed/u);
});

test("buildFrictionWorkIntent carries the chain verbatim and only referenced sources", () => {
  const intent = buildFrictionWorkIntent({ id: "i", tasks: [taskFromFrictionReport({ kind: FRICTION_KINDS.missingCapability, carrier: "c", observed: "o", expected: "e" })] });
  assert.equal(intent.items.length, CHAIN_ITEMS.length + 1);
  assert.deepEqual(intent.sources.map((s) => s.id), ["roadmap-chain", "session-report"]);
});

function fakeAdmit() {
  const calls = [];
  const fn = (binding, intent, options) => { calls.push({ binding, intent, options }); return { appended: intent.items.length }; };
  fn.calls = calls;
  return fn;
}
function fakeAllocate() {
  const calls = [];
  const fn = (binding, allocation, options) => { calls.push({ binding, allocation, options }); return { appended: 1 }; };
  fn.calls = calls;
  return fn;
}

test("admitFrictionWorkIntents admits one intent per session-day and one allocation per task; nothing when empty", async () => {
  const readout = deriveSessionFrictions(parseTranscriptLines(FIXTURE));
  const admitFn = fakeAdmit();
  const admitAllocationFn = fakeAllocate();
  const now = () => new Date("2026-09-04T01:00:00.000Z");
  const summary = await admitFrictionWorkIntents({ readout, binding: { dataRoot: "/fake" }, now, admitFn, admitAllocationFn });
  assert.equal(summary.admitted, 2);
  assert.match(summary.intentId, /^friction-work-intents-2026-09-04-[0-9a-f]{12}$/u);
  assert.equal(admitFn.calls.length, 1);
  assert.equal(admitAllocationFn.calls.length, 2);
  assert.equal(admitAllocationFn.calls[0].allocation.office.id, "executive-officer-to-the-leader");
  const empty = await admitFrictionWorkIntents({ readout: { kind: READOUT_KIND, frictions: [] }, binding: { dataRoot: "/fake" }, admitFn, admitAllocationFn });
  assert.equal(empty.intentId, null);
  await assert.rejects(() => admitFrictionWorkIntents({ readout: { kind: "other", frictions: [] }, binding: {} }), /readout kind must be/u);
});

test("admitFriction admits one explicit report as a task with a per-carrier intent id", async () => {
  const admitFn = fakeAdmit();
  const admitAllocationFn = fakeAllocate();
  const summary = await admitFriction({ report: { kind: FRICTION_KINDS.carrierFalsehood, carrier: "CLAUDE.md:64", observed: "a", expected: "b" }, binding: { dataRoot: "/fake" }, now: () => new Date("2026-09-04T01:00:00.000Z"), admitFn, admitAllocationFn });
  assert.match(summary.task, /^task:friction-carrier-falsehood-claude-md-64-[0-9a-f]{8}$/u);
  assert.match(summary.intentId, /^friction-report-2026-09-04-claude-md-64-[0-9a-f]{8}$/u);
  assert.equal(admitAllocationFn.calls.length, 1);
  const other = await admitFriction({ report: { kind: FRICTION_KINDS.carrierFalsehood, carrier: "CLAUDE.md:64", observed: "c", expected: "b" }, binding: { dataRoot: "/fake" }, now: () => new Date("2026-09-04T01:00:00.000Z"), admitFn, admitAllocationFn });
  assert.notEqual(other.intentId, summary.intentId);
  assert.notEqual(other.task, summary.task);
});

test("deriveTranscriptFrictions honors and advances a byte cursor per transcript", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frictions-"));
  try {
    const transcript = path.join(dir, "s.jsonl");
    const cursorPath = path.join(dir, "cursor.json");
    await writeFile(transcript, `${FIXTURE}\n`);
    const first = deriveTranscriptFrictions({ transcript, cursorPath });
    assert.equal(first.frictions.length, 2);
    assert.ok(first.bytes > 0);
    const second = deriveTranscriptFrictions({ transcript, cursorPath });
    assert.equal(second.frictions.length, 0);
    assert.equal(second.bytes, 0);
    const cursor = JSON.parse(await readFile(cursorPath, "utf8"));
    assert.equal(Object.keys(cursor).length, 1);
    const whole = deriveTranscriptFrictions({ transcript, cursorPath: null });
    assert.equal(whole.frictions.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
