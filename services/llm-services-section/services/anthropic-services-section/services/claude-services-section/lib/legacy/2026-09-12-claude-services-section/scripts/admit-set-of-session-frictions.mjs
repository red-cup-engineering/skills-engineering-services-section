#!/usr/bin/env node
// Stop-hook entry: derive this turn's frictions from the session transcript
// (cursor-bounded) and admit them as ready duties on the rail at
// ops.561.group. Composes the derive and admit functions; never
// re-implements either. Silent when nothing new.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkRail } from "../src/ops-rail.mjs";
import { admitFrictionWorkIntents } from "./admit-set-of-friction-work-intents.mjs";
import { DEFAULT_CURSOR_PATH, deriveTranscriptFrictions } from "./derive-set-of-session-frictions.mjs";
import { cliArgument, readBoundedHookInput } from "./lib/claude-hook-input.mjs";

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let work = null;
  try {
    const input = await readBoundedHookInput(process.stdin);
    const expected = cliArgument("--expected-event");
    if (expected && input.hook_event_name !== expected) throw new Error(`hook event '${input.hook_event_name}' does not match projected event '${expected}'`);
    if (typeof input.transcript_path !== "string" || input.transcript_path === "") throw new Error("hook input names no transcript_path");
    const readout = deriveTranscriptFrictions({ transcript: input.transcript_path, cursorPath: DEFAULT_CURSOR_PATH, sessionId: input.session_id });
    if (readout.frictions.length === 0) process.exit(0);
    work = resolveWorkRail({ dataRoot: cliArgument("--data-root") });
    const summary = await admitFrictionWorkIntents({ readout, work });
    process.stdout.write(`frictions: ${summary.admitted} admitted as duties on the ${work.kind} rail (${summary.intentId})\n`);
  } catch (error) {
    process.stderr.write(`admit-set-of-session-frictions: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await work?.close();
  }
}
