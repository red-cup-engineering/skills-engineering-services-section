import { observeSessionWindow, sha256Digest } from "@red-cup-engineering/session-transcript-dialects/shared";
import { codexSessionTranscriptDialect as dialect } from "@red-cup-engineering/session-transcript-dialects/codex-dialect";

export const CODEX_TOOL_OBSERVATION_PROVIDER = dialect.providerCells.toolObservation;

function observation(row, call, sessionDigest) { return Object.freeze({ type: dialect.recordTypes.toolObservation, version: 1, occurredAt: dialect.rowTimestamp(row), sessionDigest, inferenceProcess: { kind: dialect.inferenceProcessKind, address: `urn:sha256:${sessionDigest.slice("sha256:".length)}`, authority: "inference-only" }, providerCell: CODEX_TOOL_OBSERVATION_PROVIDER, requestedTool: { transport: call.transport, name: call.name }, invocation: { callDigest: call.callId === null ? null : sha256Digest(call.callId), runtimeStatus: call.status }, actuator: { status: "not-bound-by-transcript-observation", reason: "A Codex transcript records an inference request to a tool. It neither identifies an admitted network capability cell nor proves a restricted move, authority grant, external effect, or successful outcome." }, disclosure: { transcriptText: false, reasoning: false, toolArguments: false, toolOutput: false, fileContents: false } }); }

/** @param {{window: {fromExclusive: string, toInclusive: string}, recordedAt?: string, sessionRoot?: string}} options @returns {Promise<object>} */
export async function observeCodexToolInvocations({ window, recordedAt, sessionRoot } = {}) {
  const observations = [], evidence = [], malformed = new Set(), selectedByFile = new Map();
  const scanned = observeSessionWindow(dialect, { window, sessionRoot, label: "Codex tool observation", visit(row, path) {
    const call = dialect.toolCallsOf(row)[0]; if (!call) return;
    const sessionDigest = sha256Digest(path); observations.push(observation(row, call, sessionDigest)); selectedByFile.set(sessionDigest, (selectedByFile.get(sessionDigest) ?? 0) + 1);
  } });
  if (scanned.malformedRows) for (const path of scanned.files) malformed.add(sha256Digest(path));
  observations.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || JSON.stringify(left.requestedTool).localeCompare(JSON.stringify(right.requestedTool)) || String(left.invocation.callDigest).localeCompare(String(right.invocation.callDigest)));
  return Object.freeze({ type: dialect.recordTypes.toolObservationReceipt, version: 1, disposition: "observed", providerCell: CODEX_TOOL_OBSERVATION_PROVIDER, operation: "observe-codex-tool-invocations", recordedAt: typeof recordedAt === "string" ? recordedAt : window.toInclusive, window: { fromExclusive: window.fromExclusive, toInclusive: window.toInclusive }, observations, evidence: [...selectedByFile].map(([sessionDigest, count]) => ({ sessionDigest, observations: count })).sort((a,b) => a.sessionDigest.localeCompare(b.sessionDigest)), refusals: malformed.size === 0 ? [] : [{ code: "malformed-transcript-row-excluded", sessionDigests: [...malformed].sort() }], authority: { observation: true, execution: false, restrictedMove: false, actuatorBinding: false, outcomeAssertion: false } });
}
