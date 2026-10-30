import { observeSessionWindow, sha256Hex } from "@red-cup-engineering/session-transcript-dialects/shared";
import { claudeSessionTranscriptDialect as dialect } from "@red-cup-engineering/session-transcript-dialects/claude-dialect";
import { deriveCborNi } from "@red-cup-engineering/derive-cbor-ni-service";

export const CLAUDE_SESSION_ACTIVITY_PROVIDER = dialect.providerCells.pulse;
const SETTLEMENT_ACTOR = dialect.actorUrn;
const COLONY_ACTOR = "urn:ame:bare-cedar-fog-colony";

// Claude's built-in web tools. Distinct from toolClassPatterns.{market,patch,exec}
// (a 3-key seam contract): this is a direct name-set check local to this
// collector, exactly the way Codex's collect-colony-activity.mjs counts
// "web_search_end" outside sensor.mjs's own market/patch/exec patterns.
const WEB_TOOL_NAMES = new Set(["WebSearch", "WebFetch"]);

export async function collectClaudeSessionActivity({ window, recordedAt, sessionRoot } = {}) {
  const selected = [];
  let completedTurns = 0, toolInvocations = 0, patchInvocations = 0, webInvocations = 0, userMessages = 0;
  const scanned = observeSessionWindow(dialect, { window, sessionRoot, label: "Claude session pulse", visit(row) {
      selected.push(dialect.safeMetadata(row));
      if (row.type === "assistant" && row.message?.stop_reason === "end_turn") completedTurns += 1;
      for (const call of dialect.toolCallsOf(row)) {
        toolInvocations += 1;
        if (dialect.toolClassPatterns.patch.test(call.name)) patchInvocations += 1;
        if (WEB_TOOL_NAMES.has(call.name)) webInvocations += 1;
      }
      if (dialect.isPlainUserTextRow(row)) userMessages += 1;
  } });
  selected.sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)) || JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const countable = completedTurns + toolInvocations + patchInvocations + webInvocations;
  const evidence = `urn:ame:claude-session-activity-provider:evidence:selected-metadata:sha256:${sha256Hex(JSON.stringify(selected))}`;
  const occurredAt = selected.at(-1)?.timestamp ?? window.toInclusive;
  const events = [];
  if (countable > 0) {
    events.push({
      id: deriveCborNi({ value: { domain: "work", fromExclusive: window.fromExclusive, toInclusive: window.toInclusive, evidence } }).uri, occurredAt, domain: "work", kind: "interactive-claude-work-observed",
      summary: `${scanned.activeFiles.size} Claude sessions recorded ${completedTurns} completed turns, ${toolInvocations} tool invocations, ${patchInvocations} patch-tool invocations, and ${webInvocations} web-search invocations. These are activity observations, not proof that intended outcomes succeeded.`,
      outcome: "observed",
      quantities: [
        { label: "Claude sessions active", amount: String(scanned.activeFiles.size), unit: "sessions", displayOrder: 150 },
        { label: "Claude turns completed", amount: String(completedTurns), unit: "turns", displayOrder: 151 },
        { label: "Claude tool invocations", amount: String(toolInvocations), unit: "invocations", displayOrder: 152 },
        { label: "Claude patch-tool invocations", amount: String(patchInvocations), unit: "invocations", displayOrder: 153 },
        { label: "Claude web-search invocations", amount: String(webInvocations), unit: "invocations", displayOrder: 154 }
      ], evidence: [evidence] });
  }
  if (userMessages > 0) {
    events.push({
      id: deriveCborNi({ value: { domain: "politics", fromExclusive: window.fromExclusive, toInclusive: window.toInclusive, evidence } }).uri, occurredAt, domain: "politics", kind: "leader-user-participation-observed",
      summary: `${userMessages} Leader/user messages were observed in Claude sessions; they are not automatically classified as directions, grants, awards, approvals, or executions.`,
      outcome: "observed",
      quantities: [{ label: "Leader user messages observed", amount: String(userMessages), unit: "messages", displayOrder: 160 }], evidence: [evidence] });
  }
  // No "operations" domain event: unlike Codex's transcript, nothing in a
  // Claude session's on-disk row shapes was found to carry a genuine
  // context-compaction (or equivalent runtime) signal — see the sector's
  // session-transcript-dialects package for what was checked. Inventing one
  // would be exactly the substitution this office exists to refuse rather
  // than commit, so "operations" is left unsupported below instead.
  const refusals = [{ domain: "work", reason: "This privacy-bounded metadata contract cannot classify Leader corrections, intent satisfaction, recurrent work classes, session compaction, or promotion into durable services; those require provider-authored outcome records.", evidence: [evidence] }];
  if (scanned.malformedRows) refusals.push({ domain: "operations", reason: `${scanned.malformedRows} malformed transcript rows were excluded rather than guessed.`, evidence: [evidence] });
  return {
    type: "ColonyActivityPulseEnvelope", providerActor: CLAUDE_SESSION_ACTIVITY_PROVIDER, settlementActor: SETTLEMENT_ACTOR, colonyActor: COLONY_ACTOR, window, recordedAt, events, stocks: [],
    unsupportedDomains: ["formations", "contracts", "a2a", "activity-streams", "git-io", "evm", "economy", "deployments", "operations"],
    refusals,
  };
}
