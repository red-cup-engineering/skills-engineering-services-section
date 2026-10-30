import { observeSessionWindow } from "@red-cup-engineering/session-transcript-dialects/shared";
import { claudeSessionTranscriptDialect as dialect } from "@red-cup-engineering/session-transcript-dialects/claude-dialect";

// Claude Code's built-in web tools. Kept as a local name-set check, distinct
// from the dialect's toolClassPatterns.{market,patch,exec} regexes, so this
// collector doesn't need the shared dialect to know about web tools
// specifically.
const WEB_TOOL_NAMES = new Set(["WebSearch", "WebFetch"]);

/**
 * Summarize Claude Code session activity recorded on disk during one time
 * window.
 *
 * Reads the project's `<session-uuid>.jsonl` transcript files and counts
 * turns, tool calls, and user messages that fall inside the window. Only
 * counts are returned: transcript text, tool arguments, and tool output are
 * never read out of the rows, so this function cannot leak session content.
 *
 * @param {object} options
 * @param {{fromExclusive: string, toInclusive: string}} options.window
 *   An ISO-8601 interval, exclusive of `fromExclusive` and inclusive of
 *   `toInclusive`.
 * @param {string} [options.sessionRoot]
 *   Directory holding this project's transcript files. Defaults to Claude
 *   Code's own on-disk location for the current working directory.
 * @returns {Promise<{
 *   window: {fromExclusive: string, toInclusive: string},
 *   sessionsActive: number,
 *   turnsCompleted: number,
 *   toolInvocations: number,
 *   patchInvocations: number,
 *   webInvocations: number,
 *   userMessages: number,
 *   malformedRows: number,
 * }>}
 */
export async function collectClaudeSessionActivity({ window, sessionRoot } = {}) {
  let turnsCompleted = 0;
  let toolInvocations = 0;
  let patchInvocations = 0;
  let webInvocations = 0;
  let userMessages = 0;

  let scanned; try { scanned = observeSessionWindow(dialect, { window, sessionRoot, label: "Claude session activity window", visit(row) {
      if (row.type === "assistant" && row.message?.stop_reason === "end_turn") turnsCompleted += 1;
      for (const call of dialect.toolCallsOf(row)) {
        toolInvocations += 1;
        if (dialect.toolClassPatterns.patch.test(call.name)) patchInvocations += 1;
        if (WEB_TOOL_NAMES.has(call.name)) webInvocations += 1;
      }
      if (dialect.isPlainUserTextRow(row)) userMessages += 1;
  } }); } catch (error) { if (String(error.message).startsWith("contracted session store is unavailable")) throw new Error(`Claude session directory not found: ${sessionRoot}`); throw error; }

  return {
    window,
    sessionsActive: scanned.activeFiles.size,
    turnsCompleted,
    toolInvocations,
    patchInvocations,
    webInvocations,
    userMessages,
    malformedRows: scanned.malformedRows,
  };
}
