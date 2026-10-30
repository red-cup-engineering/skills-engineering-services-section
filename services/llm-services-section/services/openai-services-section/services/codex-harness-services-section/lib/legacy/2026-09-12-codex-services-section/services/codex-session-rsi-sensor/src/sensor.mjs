import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
const semanticId = (value) => identifyJsonSemanticContent({ objectKind: "rsc-quiescent.record", value, witnessRoot: EMPTY_WITNESS_ROOT }).token;
import { relationalWitnessJournalDocument } from "@red-cup-engineering/witness-journal-document-service";
import { cumulativeTokenDelta, scanSessionRows, sha256Digest } from "@red-cup-engineering/session-transcript-dialects/shared";
import { codexSessionTranscriptDialect as dialect } from "@red-cup-engineering/session-transcript-dialects/codex-dialect";

export const CONTEXT = "https://www.w3.org/ns/activitystreams";
export const ACTOR = "urn:ame:codex-session-rsi-sensor";
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function record(body) { return Object.freeze({ id: semanticId(body), ...body }); }
function inside(root, path) { const rel = relative(root, path); return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); }

export function measureSessionWindow({ sessionRoot, fromExclusive, toInclusive, premiumModels }) {
  const root = resolve(sessionRoot), states = new Map();
  const scanned = scanSessionRows(dialect, { window: { fromExclusive, toInclusive }, sessionRoot, label: "Codex RSI measurement", visit(row, path, at) {
    let state = states.get(path);
    if (!state) { state = { previous: { input: 0, cached: 0, output: 0, reasoning: 0 }, sawUsage: false, first: null, last: null, models: new Set(), tokens: { uncachedInput: 0, output: 0, reasoning: 0 }, counts: { patchActs: 0, shellActs: 0, marketActs: 0, toolActs: 0, completedTurns: 0, compactions: 0, goalUpdates: 0 } }; states.set(path, state); }
    const model = dialect.modelOf(row); if (model) state.models.add(model);
    const usage = dialect.tokenUsageOf(row);
    if (usage) { if (at <= Date.parse(fromExclusive)) state.previous = usage; else { const delta = cumulativeTokenDelta(state.previous, usage); state.previous = usage; state.sawUsage = true; state.tokens.uncachedInput += delta.uncachedInput; state.tokens.output += delta.output; state.tokens.reasoning += delta.reasoning; } }
    if (!(at > Date.parse(fromExclusive) && at <= Date.parse(toInclusive))) return;
    state.first ??= row.timestamp; state.last = row.timestamp;
    if (dialect.isToolCallRow(row)) { state.counts.toolActs += 1; const name = dialect.toolNameOf(row) ?? ""; if (dialect.toolClassPatterns.market.test(name)) state.counts.marketActs += 1; if (dialect.toolClassPatterns.patch.test(name)) state.counts.patchActs += 1; if (dialect.toolClassPatterns.exec.test(name)) state.counts.shellActs += 1; }
    const kind = dialect.rowKind(row); if (kind === "task-complete") state.counts.completedTurns += 1; if (kind === "context-compacted") state.counts.compactions += 1; if (kind === "thread-goal-updated") state.counts.goalUpdates += 1;
  } });
  const measurements = [];
  for (const [path, state] of states) {
    const models = [...state.models].filter((model) => premiumModels.includes(model)).sort(); if (!state.sawUsage || models.length === 0) continue;
    const baseline = state.tokens.uncachedInput + state.tokens.output + state.tokens.reasoning, selfExecutionActs = state.counts.patchActs + state.counts.shellActs;
    const projection = { session: sha256Digest(relative(root, path)), interval: { fromExclusive, toInclusive }, first: state.first, last: state.last, models, tokens: state.tokens, baseline, counts: state.counts, selfExecutionActs, malformedRows: scanned.malformedRows };
    measurements.push({ ...projection, sourceDigest: sha256Digest(JSON.stringify(projection)) });
  }
  return measurements.sort((left, right) => right.baseline - left.baseline || right.selfExecutionActs - left.selfExecutionActs || left.session.localeCompare(right.session));
}

export function selectOpportunity(measurements, policy, observedAt) {
  const eligible = measurements.filter((item) => item.baseline > 0 && item.selfExecutionActs >= policy.minimumSelfExecutionActs && item.counts.marketActs / Math.max(1, item.selfExecutionActs) <= policy.maximumMarketActRatio);
  const selected = eligible[0]; if (!selected) return null;
  const receipt = record({ type: "CodexSessionRsiMeasurement", provider: ACTOR, observedAt, projection: selected, transcriptDisclosed: false, inferenceCalls: 0 });
  return record({
    type: "ImprovementOpportunityObservation", customer: policy.board.actor, territory: policy.board.packageRoot, taskClass: "shift-premium-interactive-execution-to-sovereign-suppliers",
    summary: "A premium interactive Codex session spent measured tokens on repeated tool-mediated self-execution faster than it contracted bounded work to the sovereign inference market.",
    sourceDigests: [selected.sourceDigest], observedAt,
    sensor: { provider: ACTOR, operation: "observe-and-publish-opportunity", receipt: receipt.id },
    resourceObservation: { baselinePerTick: { amount: selected.baseline, unit: "premium-model-tokens" }, expectedTicks: policy.expectedTicks, basis: "exact interval mutually exclusive uncached-input, output, and reasoning token delta; cached input is reported separately" },
    inquiryBudget: policy.inquiryBudget, requiredCapabilities: policy.requiredCapabilities,
    constraints: ["Design a reusable bounded game before implementation.", "Use an already-existing customer-controlled oracle.", "Do not disclose or request transcript text, reasoning, tool arguments, or tool output.", "Move work downward from premium model to cheap providers to deterministic scripts."],
    context: { interval: selected.interval, models: selected.models, tokens: selected.tokens, structuralActs: selected.counts, selfExecutionActs: selected.selfExecutionActs, privacyProjection: selected.sourceDigest },
  });
}

export function loadPolicy(path = join(ROOT, "content/policies/bare-cedar-fog.json")) { return JSON.parse(readFileSync(path, "utf8")); }
export function inspectBoardBoundary(board) {
  if (!board || !isAbsolute(board.packageRoot ?? "") || typeof board.actor !== "string" || typeof board.nodeId !== "string" || typeof board.contract !== "string" || typeof board.submitOperation !== "string") throw new Error("sensor policy must name one exact board boundary");
  const root = resolve(board.packageRoot), manifestPath = join(root, "package.json"); if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink()) throw new Error("board manifest unavailable");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")), operation = manifest?.["x-agentic-metro-enterprise"]?.["operation-catalog"]?.[board.submitOperation], entry = resolve(root, manifest?.bin?.[board.submitOperation] ?? "");
  if (manifest?.["x-agentic-metro-enterprise"]?.["node-id"] !== board.nodeId || operation?.contract !== board.contract || !inside(root, entry) || !existsSync(entry) || !lstatSync(entry).isFile() || lstatSync(entry).isSymbolicLink()) throw new Error("configured board ingress is not currently advertised");
  return { root, entry };
}

export { record };
