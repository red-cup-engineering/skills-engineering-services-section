/**
 * transcripts — read the sessions the `claude` CLI already persists to disk.
 *
 * Claude Code writes every session as newline-delimited JSON under
 * `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`. That is a standing,
 * upstream capability the codex package has no analogue for: past sessions are
 * available for projection without re-running anything. This module lists and
 * reads them and routes the lines through the same events projection, tolerant of
 * transcript lines that lack the print-mode envelope shape.
 */
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { action, carrierFrom, tm } from "@emsenn/relating";
import { isJsonRecord, parseJsonlLines } from "@emsenn/relating/writing";
import { claudeTrace, type ClaudeEvent, type ClaudeTraceCarrier } from "./events.mjs";

export interface TranscriptLocation {
  /** Override the projects root (defaults to ~/.claude/projects). */
  readonly projectsDir?: string;
  /** The working directory whose slug names the project subdir (defaults cwd). */
  readonly cwd?: string;
}

export const TranscriptLocationSchema = {
  $id: "organizing/claude/code-cli/transcripts/location",
  type: "object",
  title: "ClaudeTranscriptLocation",
  properties: {
    projectsDir: { type: "string", minLength: 1 },
    cwd: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const transcriptLocationCarrier = carrierFrom(TranscriptLocationSchema);

/** The directory claude persists sessions under. */
export function claudeProjectsDir(projectsDir?: string): string {
  return projectsDir ?? path.join(homedir(), ".claude", "projects");
}

/** The slug claude derives from a working directory (non-alphanumerics → "-"). */
export function projectSlug(cwd: string = process.cwd()): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/** The project directory for a given working directory. */
export function projectDir(location: TranscriptLocation = {}): string {
  return path.join(claudeProjectsDir(location.projectsDir), projectSlug(location.cwd ?? process.cwd()));
}

export interface SessionRef {
  readonly sessionId: string;
  readonly path: string;
}

export const SessionRefSchema = {
  $id: "organizing/claude/code-cli/transcripts/session-ref",
  type: "object",
  title: "ClaudeTranscriptSessionRef",
  required: ["sessionId", "path"],
  properties: {
    sessionId: { type: "string", minLength: 1 },
    path: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const sessionRefCarrier = carrierFrom(SessionRefSchema);

export const canonicalizeTranscriptLocationAction = action({
  verb: "organizing.claude.code-cli.transcripts.canonicalize-location",
  description: "Canonicalize a Claude transcript location carrier.",
  domain: transcriptLocationCarrier,
  codomain: transcriptLocationCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeSessionRefAction = action({
  verb: "organizing.claude.code-cli.transcripts.canonicalize-session-ref",
  description: "Canonicalize a Claude transcript session reference.",
  domain: sessionRefCarrier,
  codomain: sessionRefCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const transcriptActions = Object.freeze([
  canonicalizeTranscriptLocationAction,
  canonicalizeSessionRefAction,
]);

/** List persisted sessions for a project, newest filename last. */
export async function listSessions(location: TranscriptLocation = {}): Promise<readonly SessionRef[]> {
  const dir = projectDir(location);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return Object.freeze([]);
  }
  return Object.freeze(
    names
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => Object.freeze({ sessionId: name.slice(0, -".jsonl".length), path: path.join(dir, name) }))
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
  );
}

/** List the project slugs that have persisted sessions. */
export async function listProjects(projectsDir?: string): Promise<readonly string[]> {
  try {
    return Object.freeze((await readdir(claudeProjectsDir(projectsDir))).sort());
  } catch {
    return Object.freeze([]);
  }
}

/** Read a persisted session's events, tolerant of non-envelope transcript lines. */
export async function readSessionEvents(
  sessionId: string,
  location: TranscriptLocation = {},
): Promise<readonly ClaudeEvent[]> {
  const file = path.join(projectDir(location), `${sessionId}.jsonl`);
  const text = await readFile(file, "utf8");
  const events: ClaudeEvent[] = [];
  for (const parsed of parseJsonlLines(text)) {
    if (!isJsonRecord(parsed)) continue;
    if (typeof parsed["type"] !== "string" || parsed["type"].length === 0) continue;
    events.push(Object.freeze({ ...parsed, type: parsed["type"] }));
  }
  return Object.freeze(events);
}

/** Read a persisted session straight into a trace carrier. */
export async function readSessionTrace(
  sessionId: string,
  location: TranscriptLocation = {},
): Promise<ClaudeTraceCarrier> {
  return claudeTrace(await readSessionEvents(sessionId, location), { run: `session.${sessionId}` });
}
