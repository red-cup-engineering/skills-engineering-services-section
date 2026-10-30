#!/usr/bin/env node
// Stop-hook entry and its detached worker: admit one Claude Code session to
// the rail at ops.561.group through MetroPlat's own `claude-session-admit` and
// `agent-session-token-usage-admit` verbs, and journal one receipt naming both
// results. The hook returns at once; the worker does the admitting.
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createSemanticRecordJournal } from "@red-cup-engineering/semantic-record-journal-service";
import { resolveWorkRail } from "../src/ops-rail.mjs";
import { cliArg } from "./lib/runtime.mjs";
import { readBoundedHookInput } from "./lib/claude-hook-input.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY = join(PACKAGE_ROOT, "content/harness/claude-agent-harness.json");
const ACTOR = JSON.parse(readFileSync(POLICY, "utf8")).actor;
export const OBJECT_KIND = "bare-cedar-fog-claude.metroplat-admission";
const SELF_PATH = fileURLToPath(import.meta.url);

/**
 * Admits one session and its token usage on the rail, then journals one receipt.
 * @param {object} options
 * @param {string} options.transcriptPath
 * @param {string} [options.sessionId] - defaults to the transcript basename.
 * @param {string} [options.journalRoot] - the receipt journal's custody root; defaults to this package.
 * @param {ReturnType<typeof resolveWorkRail>} [options.work] - the rail; defaults to production.
 * @param {(verb: string, input: object) => unknown|Promise<unknown>} [options.runVerb] - overrides the rail's call (tests).
 * @param {() => Date} [options.now]
 * @returns {Promise<{root: string, id: string, sessionAdmission: unknown, tokenUsageAdmission: unknown}>}
 * @throws {Error} when `transcriptPath` is missing, or either verb refuses.
 */
export async function admitClaudeSession({ transcriptPath, sessionId, journalRoot = PACKAGE_ROOT, work, runVerb, now = () => new Date() } = {}) {
  if (typeof transcriptPath !== "string" || transcriptPath.trim() === "") throw new Error("admit-claude-session: names no transcriptPath");
  const resolvedSessionId = sessionId ?? basename(transcriptPath, ".jsonl");
  const call = runVerb ?? (work ?? resolveWorkRail()).call;

  const sessionAdmission = await call("claude-session-admit", { sessionId: resolvedSessionId });
  const tokenUsageAdmission = await call("agent-session-token-usage-admit", { provider: "claude", sessionId: resolvedSessionId });
  // The rail's token-usage verb discovers transcripts from the rail host's
  // own session roots. A session whose transcript lives only on this machine
  // comes back with zero turns; that reading is the rail's blindness, never
  // this session's usage, so it is recorded as unseen rather than as zero.
  const usageSeenByRail = usageTurnsOf(tokenUsageAdmission) > 0;

  const recordedAt = now().toISOString();
  const journal = createSemanticRecordJournal({ root: journalRoot, objectKind: OBJECT_KIND });
  const result = journal.record({
    category: "metroplat.session-admit",
    recordedAt,
    record: {
      type: "BareCedarFogClaudeMetroplatAdmission",
      actor: ACTOR,
      sessionId: resolvedSessionId,
      transcriptPath,
      sessionAdmission,
      tokenUsageAdmission,
      usageSeenByRail,
    },
    charge: { support: true, refutation: !usageSeenByRail },
  });
  return Object.freeze({ root: journal.root, id: result.id, sessionAdmission, tokenUsageAdmission, usageSeenByRail });
}

/**
 * The turn count a token-usage admission reports, wherever the verb's
 * result shape puts it; 0 when it reports none.
 * @param {unknown} admission
 * @returns {number}
 */
export function usageTurnsOf(admission) {
  if (admission === null || typeof admission !== "object") return 0;
  const candidates = [admission.turns, admission.summary?.turns, admission.usage?.turns, admission.readout?.turns];
  for (const value of candidates) if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

/**
 * Spawns this file as a detached, unreferenced worker so the Stop hook returns at once.
 * @param {{transcriptPath: string, sessionId: string, journalRoot?: string, spawnFn?: typeof spawn}} options
 */
export function spawnDetachedAdmit({ transcriptPath, sessionId, journalRoot, spawnFn = spawn } = {}) {
  const args = [SELF_PATH, "--admit", "--transcript-path", transcriptPath, "--session-id", sessionId];
  if (journalRoot) args.push("--journal-root", journalRoot);
  const child = spawnFn(process.execPath, args, { detached: true, stdio: "ignore" });
  child.unref();
}

/**
 * The Stop-hook reaction: validates the event and spawns the detached worker.
 * @param {object} input - the hook's JSON input.
 * @param {{journalRoot?: string, spawnDetachedAdmitFn?: typeof spawnDetachedAdmit}} [options]
 * @returns {{spawned: true, sessionId: string}}
 * @throws {Error} when the input is not a Stop event or names no transcript.
 */
export function admitClaudeSessionOnStop(input, { journalRoot, spawnDetachedAdmitFn = spawnDetachedAdmit } = {}) {
  if (!input || input.hook_event_name !== "Stop") throw new Error("admit-claude-session: hook input is not a Stop event");
  if (typeof input.transcript_path !== "string" || input.transcript_path.trim() === "") {
    throw new Error("admit-claude-session: hook input names no transcript_path");
  }
  const sessionId = basename(input.transcript_path, ".jsonl");
  spawnDetachedAdmitFn({ transcriptPath: input.transcript_path, sessionId, journalRoot });
  return Object.freeze({ spawned: true, sessionId });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.includes("--admit")) {
    let work = null;
    try {
      work = resolveWorkRail();
      const result = await admitClaudeSession({
        transcriptPath: cliArg("--transcript-path"),
        sessionId: cliArg("--session-id"),
        journalRoot: cliArg("--journal-root"),
        work,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`admit-claude-session --admit: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    } finally {
      await work?.close();
    }
  } else {
    try {
      const result = admitClaudeSessionOnStop(await readBoundedHookInput(process.stdin));
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      process.stderr.write(`admit-claude-session: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
