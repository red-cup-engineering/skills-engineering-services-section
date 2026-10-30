import { observeSessionWindow, sha256Hex } from "@red-cup-engineering/session-transcript-dialects/shared";
import { codexSessionTranscriptDialect as dialect } from "@red-cup-engineering/session-transcript-dialects/codex-dialect";
import { deriveCborNi } from "@red-cup-engineering/derive-cbor-ni-service";

export const CODEX_SESSION_ACTIVITY_PROVIDER = dialect.providerCells.pulse;
const SETTLEMENT_ACTOR = dialect.actorUrn;
const COLONY_ACTOR = "urn:ame:bare-cedar-fog-colony";

/**
 * Collect a privacy-bounded Codex activity pulse.
 *
 * @param {{window: {fromExclusive: string, toInclusive: string}, recordedAt?: string, sessionRoot?: string}} options
 * @returns {Promise<object>}
 */
export async function collectCodexSessionActivity({ window, recordedAt, sessionRoot } = {}) {
  const selected = []; const counts = { userMessages: 0, completedTurns: 0, toolInvocations: 0, patchCompletions: 0, webSearches: 0, compactions: 0 };
  const scanned = observeSessionWindow(dialect, { window, sessionRoot, label: "Codex session pulse", visit(row) {
    selected.push(dialect.safeMetadata(row));
    const kind = dialect.rowKind(row);
    if (kind === "user-message") counts.userMessages += 1;
    if (kind === "task-complete") counts.completedTurns += 1;
    if (kind === "patch-apply-end") counts.patchCompletions += 1;
    if (kind === "web-search-end") counts.webSearches += 1;
    if (kind === "context-compacted") counts.compactions += 1;
    if (dialect.isToolCallRow(row)) counts.toolInvocations += 1;
  } });
  selected.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const evidence = `urn:ame:codex-session-activity-provider:evidence:selected-metadata:sha256:${sha256Hex(JSON.stringify(selected))}`;
  const occurredAt = selected.at(-1)?.timestamp ?? window.toInclusive, events = [];
  if (counts.completedTurns + counts.toolInvocations + counts.patchCompletions + counts.webSearches > 0) events.push({ id: deriveCborNi({ value: { domain: "work", fromExclusive: window.fromExclusive, toInclusive: window.toInclusive, evidence } }).uri, occurredAt, domain: "work", kind: "interactive-codex-work-observed", summary: `${scanned.activeFiles.size} Codex sessions recorded ${counts.completedTurns} completed turns, ${counts.toolInvocations} tool invocations, ${counts.patchCompletions} patch completions, and ${counts.webSearches} web-search completions. These are activity observations, not proof that intended outcomes succeeded.`, outcome: "observed", quantities: [{ label: "Codex sessions active", amount: String(scanned.activeFiles.size), unit: "sessions", displayOrder: 120 }, { label: "Codex turns completed", amount: String(counts.completedTurns), unit: "turns", displayOrder: 121 }, { label: "Codex tool invocations", amount: String(counts.toolInvocations), unit: "invocations", displayOrder: 122 }, { label: "Codex patch completions", amount: String(counts.patchCompletions), unit: "patches", displayOrder: 123 }, { label: "Codex web searches completed", amount: String(counts.webSearches), unit: "searches", displayOrder: 124 }], evidence: [evidence] });
  if (counts.userMessages > 0) events.push({ id: deriveCborNi({ value: { domain: "politics", fromExclusive: window.fromExclusive, toInclusive: window.toInclusive, evidence } }).uri, occurredAt, domain: "politics", kind: "leader-user-participation-observed", summary: `${counts.userMessages} Leader/user messages were observed in Codex sessions; they are not automatically classified as directions, grants, awards, approvals, or executions.`, outcome: "observed", quantities: [{ label: "Leader user messages observed", amount: String(counts.userMessages), unit: "messages", displayOrder: 130 }], evidence: [evidence] });
  if (counts.compactions > 0) events.push({ id: deriveCborNi({ value: { domain: "operations", fromExclusive: window.fromExclusive, toInclusive: window.toInclusive, evidence } }).uri, occurredAt, domain: "operations", kind: "interactive-session-runtime-observed", summary: `${counts.compactions} Codex context compactions occurred while ${scanned.activeFiles.size} sessions were active.`, outcome: "observed", quantities: [{ label: "Codex context compactions", amount: String(counts.compactions), unit: "compactions", displayOrder: 140 }], evidence: [evidence] });
  const refusals = [{ domain: "work", reason: "This privacy-bounded metadata contract cannot classify Leader corrections, intent satisfaction, recurrent work classes, or promotion into durable services; those require provider-authored outcome records.", evidence: [evidence] }];
  if (scanned.malformedRows) refusals.push({ domain: "operations", reason: `${scanned.malformedRows} malformed transcript rows were excluded rather than guessed.`, evidence: [evidence] });
  return { type: "ColonyActivityPulseEnvelope", providerActor: CODEX_SESSION_ACTIVITY_PROVIDER, settlementActor: SETTLEMENT_ACTOR, colonyActor: COLONY_ACTOR, window, recordedAt, events, stocks: [], unsupportedDomains: ["formations", "contracts", "a2a", "activity-streams", "git-io", "evm", "economy", "deployments"], refusals };
}
