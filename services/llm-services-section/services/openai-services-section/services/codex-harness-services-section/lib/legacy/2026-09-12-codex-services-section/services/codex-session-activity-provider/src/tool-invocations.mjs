import { observeSessionWindow } from "@red-cup-engineering/session-transcript-dialects/shared";
import { codexSessionTranscriptDialect as dialect } from "@red-cup-engineering/session-transcript-dialects/codex-dialect";

/**
 * List the tools Codex CLI requested within a time window.
 *
 * Each entry reports only the tool's name, transport, and reported run
 * status — never the arguments passed to it, its output, or surrounding
 * transcript text. A listed request means Codex asked to run that tool; it
 * does not confirm the tool executed or what it did.
 *
 * @param {object} options
 * @param {{fromExclusive: string, toInclusive: string}} options.window
 *   ISO-8601 timestamps bounding the interval `(fromExclusive, toInclusive]`.
 * @param {string} [options.sessionRoot] Directory to read transcripts from.
 *   Defaults to `~/.codex/sessions`.
 * @returns {Promise<{
 *   invocations: Array<{ occurredAt: string, tool: string, transport: string, status: string }>,
 *   malformedRows: number,
 * }>}
 */
export async function listToolInvocations({ window, sessionRoot } = {}) {
  const invocations = [];
  let scanned; try { scanned = observeSessionWindow(dialect, { window, sessionRoot, label: "Codex tool invocation window", visit(row) {
      const call = dialect.toolCallsOf(row)[0];
      if (!call) return;
      invocations.push({ occurredAt: dialect.rowTimestamp(row), tool: call.name, transport: call.transport, status: call.status });
  } }); } catch (error) { if (String(error.message).startsWith("contracted session store is unavailable")) throw new Error(`Codex session directory not found: ${sessionRoot}`); throw error; }

  invocations.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return { invocations, malformedRows: scanned.malformedRows };
}
