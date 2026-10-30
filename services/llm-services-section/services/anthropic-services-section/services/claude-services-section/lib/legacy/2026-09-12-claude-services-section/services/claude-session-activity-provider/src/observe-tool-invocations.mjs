import { observeSessionWindow, sha256Digest } from "@red-cup-engineering/session-transcript-dialects/shared";
import { claudeSessionTranscriptDialect as dialect } from "@red-cup-engineering/session-transcript-dialects/claude-dialect";

export const CLAUDE_TOOL_OBSERVATION_PROVIDER = dialect.providerCells.toolObservation;

function observation(row, call, sessionDigest) {
  return Object.freeze({
    type: dialect.recordTypes.toolObservation,
    version: 1,
    occurredAt: dialect.rowTimestamp(row),
    sessionDigest,
    inferenceProcess: {
      kind: dialect.inferenceProcessKind,
      address: `urn:sha256:${sessionDigest.slice("sha256:".length)}`,
      authority: "inference-only",
    },
    providerCell: CLAUDE_TOOL_OBSERVATION_PROVIDER,
    requestedTool: { transport: call.transport, name: call.name },
    invocation: {
      callDigest: call.callId === null ? null : sha256Digest(call.callId),
      runtimeStatus: "requested",
    },
    actuator: {
      status: "not-bound-by-transcript-observation",
      reason: "A Claude transcript records an inference request to a tool. It proves neither execution nor an admitted capability, authority grant, external effect, restricted move, or successful outcome.",
    },
    disclosure: {
      transcriptText: false,
      reasoning: false,
      toolArguments: false,
      toolOutput: false,
      fileContents: false,
    },
  });
}

/**
 * Observe Claude tool requests as metadata-only carriers. One assistant row
 * may hold several tool_use blocks; each becomes a distinct observation.
 * This operation reads no arguments or results and executes nothing.
 */
export async function observeClaudeToolInvocations({ window, recordedAt, sessionRoot } = {}) {
  const observations = [], evidence = [], malformed = new Set(), selected = new Map();
  const scanned = observeSessionWindow(dialect, { window, sessionRoot, label: "Claude tool observation", visit(row, path) {
      const sessionDigest = sha256Digest(path);
      for (const call of dialect.toolCallsOf(row)) {
        observations.push(observation(row, call, sessionDigest));
        selected.set(sessionDigest, (selected.get(sessionDigest) ?? 0) + 1);
      }
  } });
  if (scanned.malformedRows) for (const path of scanned.files) malformed.add(sha256Digest(path));
  for (const [sessionDigest, count] of selected) evidence.push({ sessionDigest, observations: count });
  observations.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || JSON.stringify(left.requestedTool).localeCompare(JSON.stringify(right.requestedTool)) || String(left.invocation.callDigest).localeCompare(String(right.invocation.callDigest)));
  return Object.freeze({
    type: dialect.recordTypes.toolObservationReceipt,
    version: 1,
    disposition: "observed",
    providerCell: CLAUDE_TOOL_OBSERVATION_PROVIDER,
    operation: "observe-claude-tool-invocations",
    recordedAt: typeof recordedAt === "string" ? recordedAt : window.toInclusive,
    window: { fromExclusive: window.fromExclusive, toInclusive: window.toInclusive },
    observations,
    evidence: evidence.sort((left, right) => left.sessionDigest.localeCompare(right.sessionDigest)),
    refusals: malformed.size === 0 ? [] : [{ code: "malformed-transcript-row-excluded", sessionDigests: [...malformed].sort() }],
    authority: {
      observation: true,
      execution: false,
      restrictedMove: false,
      actuatorBinding: false,
      outcomeAssertion: false,
    },
  });
}
