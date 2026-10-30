#!/usr/bin/env node
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSemanticRecordJournal } from "@red-cup-engineering/semantic-record-journal-service";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
import { readSeavt } from "@red-cup-engineering/witness-journal-log-service";
import { termToJson } from "@red-cup-engineering/relation-model-notation-json-codec";
import { recordProviderCommission } from "@red-cup-engineering/harness-lifecycle-journal-service";
import { cliArgument, readBoundedHookInput } from "./lib/claude-hook-input.mjs";

const EVENTS = new Set(["SessionStart", "UserPromptSubmit", "Stop", "SubagentStop"]);
const START_SOURCES = new Set(["startup", "resume", "clear", "compact", "fork"]);
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY = join(PACKAGE_ROOT, "content/harness/claude-agent-harness.json");
const ACTOR = JSON.parse(readFileSync(POLICY, "utf8")).actor;
export const OBJECT_KIND = "bare-cedar-fog-claude.lifecycle-observation";
// Feed name is the semantic-record-journal-service's own dated content
// partition (`<root>/data/logs/YYYY/MM/DD/<this>.jsonl`) -- not exported by
// that package, but stable across the corpus's existing content.
const CONTENT_FEED = "witness-journal-seavt";
// The turn-chain spine: SessionStart is the chain root, and each
// UserPromptSubmit/Stop follows the session's prior spine row. SubagentStop
// rows are excluded so a subagent event never displaces the turn a Stop
// should chain to.
const TURN_CHAIN_CATEGORIES = new Set(["lifecycle.SessionStart", "lifecycle.UserPromptSubmit", "lifecycle.Stop"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function digest(value) {
  return typeof value === "string" && value !== "" ? `sha256:${createHash("sha256").update(value).digest("hex")}` : null;
}

/**
 * Finds the most recent lifecycle content-feed row for a session, reading
 * only today's and yesterday's dated journal partitions (per `now`) instead
 * of scanning the whole journal.
 *
 * @param {object} options
 * @param {string} options.root Journal custody root.
 * @param {string} options.sessionDigest The digested session id to match.
 * @param {() => Date} options.now Clock, so tests can pin "today".
 * @param {(category: string) => boolean} options.admit Row-category filter.
 * @returns {{id: string, occurredAt: string}|null} The latest matching row, or null when none exists.
 */
function latestSessionRecord({ root, sessionDigest, now, admit }) {
  const today = now();
  const yesterday = new Date(today.getTime() - DAY_MS);
  const rows = [...readSeavt(root, CONTENT_FEED, today.toISOString()), ...readSeavt(root, CONTENT_FEED, yesterday.toISOString())];
  let latest = null;
  for (const { entry: row } of rows) {
    const category = termToJson(row.a), value = termToJson(row.v), id = termToJson(row.e);
    if (!admit(category) || value?.sessionDigest !== sessionDigest || typeof id !== "string") continue;
    if (latest === null || row.t > latest.occurredAt) latest = { id, occurredAt: row.t };
  }
  return latest;
}

/** The content-address this observation will settle to, computed the same way `journal.record()` computes it internally, so it can be named as a relation subject before the write. */
function selfIdentity(value) {
  return identifyJsonSemanticContent({ objectKind: OBJECT_KIND, value, witnessRoot: EMPTY_WITNESS_ROOT }).id;
}

export function observeLifecycle({ input, expectedEvent, projectRoot, journalRoot, now = () => new Date() }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Claude hook input must be a JSON object");
  if (!EVENTS.has(expectedEvent)) throw new Error(`unsupported expected lifecycle event '${expectedEvent}'`);
  if (input.hook_event_name !== expectedEvent) {
    throw new Error(`hook event '${input.hook_event_name}' does not match projected event '${expectedEvent}'`);
  }
  const rootInput = projectRoot ?? process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  if (typeof rootInput !== "string" || rootInput.trim() === "") throw new Error("Claude hook input names no project root");
  const root = resolve(rootInput);
  const custodyRoot = resolve(journalRoot ?? PACKAGE_ROOT);
  const recordedAt = now().toISOString();
  const sessionDigest = digest(input.session_id);
  const promptDigest = expectedEvent === "UserPromptSubmit" ? digest(input.prompt) : null;
  const transcriptDigest = expectedEvent === "Stop" || expectedEvent === "SubagentStop" ? digest(input.transcript_path) : null;
  const observation = {
    type: "BareCedarFogClaudeLifecycleObservation",
    version: 2,
    actor: ACTOR,
    event: expectedEvent,
    occurredAt: recordedAt,
    sessionDigest,
    workspaceDigest: digest(root),
    ...(promptDigest !== null ? { promptDigest } : {}),
    ...(transcriptDigest !== null ? { transcriptDigest } : {}),
    ...(expectedEvent === "SessionStart" && START_SOURCES.has(input.source) ? { source: input.source } : {}),
  };

  let turn = null;
  if (expectedEvent === "SubagentStop") {
    turn = latestSessionRecord({ root: custodyRoot, sessionDigest, now, admit: (category) => category === "lifecycle.UserPromptSubmit" });
    if (!turn) throw new Error("SubagentStop observed with no UserPromptSubmit record for this session in the last two days");
  }

  let relation;
  if (expectedEvent === "SubagentStop") {
    relation = { subject: selfIdentity(observation), predicate: "follows", object: turn.id };
  } else if (expectedEvent === "UserPromptSubmit" || expectedEvent === "Stop") {
    const previous = latestSessionRecord({ root: custodyRoot, sessionDigest, now, admit: (category) => TURN_CHAIN_CATEGORIES.has(category) });
    if (previous) relation = { subject: selfIdentity(observation), predicate: "follows", object: previous.id };
  }

  const journal = createSemanticRecordJournal({ root: custodyRoot, objectKind: OBJECT_KIND });
  const result = journal.record({
    category: `lifecycle.${expectedEvent}`,
    recordedAt,
    record: observation,
    charge: { support: true, refutation: false },
    ...(relation ? { relation } : {}),
  });

  let commission = null;
  if (expectedEvent === "SubagentStop") {
    const commissionResult = recordProviderCommission({
      root: custodyRoot,
      actor: ACTOR,
      turnId: turn.id,
      agent: "claude-subagent",
      task: transcriptDigest,
      recordedAt,
    });
    commission = Object.freeze({ id: commissionResult.id, turnId: turn.id });
  }

  return Object.freeze({
    root: journal.root,
    id: result.id,
    observation,
    relation: relation ? Object.freeze({ ...relation }) : null,
    ...(commission ? { commission } : {}),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    observeLifecycle({ input: await readBoundedHookInput(process.stdin), expectedEvent: cliArgument("--expected-event") });
  } catch (error) {
    process.stderr.write(`observe-claude-lifecycle: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
