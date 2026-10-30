import { observeSessionWindow } from "@red-cup-engineering/session-transcript-dialects/shared";
import { codexSessionTranscriptDialect as dialect } from "@red-cup-engineering/session-transcript-dialects/codex-dialect";

/**
 * Summarize privacy-safe Codex session metadata in one exact interval.
 *
 * @param {{window: {fromExclusive: string, toInclusive: string}, sessionRoot?: string}} options
 * @returns {Promise<{sessionsActive: number, userMessages: number, completedTurns: number, toolInvocations: number, patchCompletions: number, webSearches: number, contextCompactions: number, malformedRows: number}>}
 */
export async function summarizeSessionActivity({ window, sessionRoot } = {}) {
  const counts = { userMessages: 0, completedTurns: 0, toolInvocations: 0, patchCompletions: 0, webSearches: 0, contextCompactions: 0 };
  let result;
  try { result = observeSessionWindow(dialect, { window, sessionRoot, label: "Codex session activity window", visit(row) {
    const kind = dialect.rowKind(row);
    if (kind === "user-message") counts.userMessages += 1;
    if (kind === "task-complete") counts.completedTurns += 1;
    if (kind === "patch-apply-end") counts.patchCompletions += 1;
    if (kind === "web-search-end") counts.webSearches += 1;
    if (kind === "context-compacted") counts.contextCompactions += 1;
    if (dialect.isToolCallRow(row)) counts.toolInvocations += 1;
  } }); } catch (error) {
    if (String(error.message).startsWith("contracted session store is unavailable")) throw new Error(`Codex session directory not found: ${sessionRoot}`);
    throw error;
  }
  return { sessionsActive: result.activeFiles.size, ...counts, malformedRows: result.malformedRows };
}
