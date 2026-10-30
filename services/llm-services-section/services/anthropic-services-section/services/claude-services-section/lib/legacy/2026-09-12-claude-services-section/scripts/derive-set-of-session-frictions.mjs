#!/usr/bin/env node
// One transformation: a Claude session transcript in, the session's
// frictions readout out (tool errors and non-zero command exits, grouped
// and counted). Reads --transcript, or the transcript_path of a Stop hook
// input on stdin. Optional byte cursor so a per-turn run reads only what
// the previous run has not.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readSync, closeSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveSessionFrictions, parseTranscriptLines } from "../src/session-frictions.mjs";
import { cliArgument, readBoundedHookInput } from "./lib/claude-hook-input.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Default byte-offset cursor, keyed by transcript path digest. */
export const DEFAULT_CURSOR_PATH = join(PACKAGE_ROOT, "data", "state", "session-frictions-cursor.json");

/**
 * Reads the transcript from `offset` to its end.
 * @param {string} path
 * @param {number} offset
 * @returns {{text: string, end: number}}
 */
export function readTranscriptFrom(path, offset) {
  const size = statSync(path).size;
  if (offset >= size) return { text: "", end: size };
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(size - offset);
    readSync(fd, buffer, 0, buffer.length, offset);
    return { text: buffer.toString("utf8"), end: size };
  } finally {
    closeSync(fd);
  }
}

/**
 * Derives the frictions of one transcript, honoring and advancing a byte
 * cursor when one is given.
 * @param {{transcript: string, cursorPath?: string|null, sessionId?: string}} options
 * @returns {object} the readout, plus `transcriptDigest` and `bytes` read.
 */
export function deriveTranscriptFrictions({ transcript, cursorPath = null, sessionId }) {
  const path = resolve(transcript);
  const key = `sha256:${createHash("sha256").update(path).digest("hex")}`;
  let cursor = {};
  if (cursorPath && existsSync(cursorPath)) cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
  const offset = cursorPath ? Number(cursor[key] ?? 0) : 0;
  const { text, end } = readTranscriptFrom(path, offset);
  const readout = deriveSessionFrictions(parseTranscriptLines(text), { sessionId });
  if (cursorPath) {
    mkdirSync(dirname(cursorPath), { recursive: true });
    writeFileSync(cursorPath, `${JSON.stringify({ ...cursor, [key]: end }, null, 2)}\n`);
  }
  return { ...readout, transcriptDigest: key, bytes: end - offset };
}

function usage() {
  return "Usage: derive-set-of-session-frictions [--transcript <jsonl>] [--cursor <path>|--no-cursor] [--session <id>]\n" +
    "Prints the {kind:\"bare-cedar-fog-claude.session-frictions\"} readout for one Claude\n" +
    "transcript: every tool error and non-zero command exit, grouped by tool and failure\n" +
    "line. Without --transcript, reads a Stop hook input on stdin and uses its transcript_path.\n" +
    "--no-cursor reads the whole transcript; otherwise a byte cursor is kept per transcript.\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.includes("--help")) {
    process.stdout.write(usage());
    process.exit(0);
  }
  try {
    let transcript = cliArgument("--transcript");
    let sessionId = cliArgument("--session");
    if (transcript === undefined) {
      const input = await readBoundedHookInput(process.stdin);
      transcript = input.transcript_path;
      sessionId ??= input.session_id;
    }
    if (typeof transcript !== "string" || transcript === "") throw new Error("no transcript given (--transcript or hook transcript_path)");
    const cursorPath = process.argv.includes("--no-cursor") ? null : (cliArgument("--cursor") ?? DEFAULT_CURSOR_PATH);
    process.stdout.write(`${JSON.stringify(deriveTranscriptFrictions({ transcript, cursorPath, sessionId }))}\n`);
  } catch (error) {
    process.stderr.write(`derive-set-of-session-frictions: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
