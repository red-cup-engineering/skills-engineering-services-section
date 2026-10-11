import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

export const GEMINI_NOTEBOOK_ACTIVITY_PROVIDER = "urn:ame:notebooklm-inference-team:activity-pulse-provider";
const SETTLEMENT_ACTOR = "urn:ame:notebooklm-inference-team";
const COLONY_ACTOR = "urn:ame:bare-cedar-fog-colony";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATEGORY_PREDICATE = "urn:emsenn:gemini-notebook:category";

async function jobRows(query, dataRoot, category, options = {}) {
  return (await query(category, { predicate: CATEGORY_PREDICATE, witnessJournalAgentUrl: options.witnessJournalAgentUrl }))
    .filter(({ value }) => value?.type === "GeminiNotebookJobRecord" && value.category === category && value.row?.operationId)
    .map(({ id, value }) => ({ evidence: id, ...value.row }));
}
function latestByOperation(rows) {
  const latest = new Map();
  for (const row of rows) {
    const prior = latest.get(row.operationId);
    if (!prior || Number(row.sequence ?? 0) > Number(prior.sequence ?? 0)
      || (Number(row.sequence ?? 0) === Number(prior.sequence ?? 0) && Date.parse(row.recordedAt) > Date.parse(prior.recordedAt))) latest.set(row.operationId, row);
  }
  return [...latest.values()];
}
function distinctTerminal(rows, statuses) {
  const found = new Map();
  for (const row of rows.filter((item) => statuses.includes(item.status))) found.set(`${row.operationId}:${row.status}:${row.code ?? ""}`, row);
  return [...found.values()];
}
function quantities(values) { return values.map(([label, amount, unit, displayOrder]) => ({ label, amount: String(amount), unit, displayOrder })); }
function event({ window, occurredAt, domain, kind, summary, outcome, values, evidence }) {
  return { id: semanticId({ window, kind, evidence }), occurredAt, domain, kind, summary, outcome, quantities: quantities(values), evidence: [...new Set(evidence)].sort() };
}

/**
 * @param {object} options
 * @param {Function} options.query - Reads provider-category rows (e.g. `queryProviderCategory` from ./provider-evidence.mjs), possibly crossing the WitnessJournal boundary; supplied by the caller at the kernel edge.
 */
export async function collectGeminiNotebookColonyActivity({ window, recordedAt, dataRoot = join(ROOT, "data"), witnessJournalAgentUrl, query } = {}) {
  const from = Date.parse(window.fromExclusive); const to = Date.parse(window.toInclusive);
  // Provider-category reads are asynchronous (they may cross the contracted
  // WitnessJournal boundary).  Await both charts before projecting their interval and
  // current-state views; otherwise this pulse fails before it can report a
  // typed refusal or an empty current state.
  const [sourceRows, audioRows] = await Promise.all([
    jobRows(query, dataRoot, "source-jobs", { witnessJournalAgentUrl }),
    jobRows(query, dataRoot, "audio-jobs", { witnessJournalAgentUrl }),
  ]);
  const eligibleSources = sourceRows.filter((row) => Date.parse(row.recordedAt) <= to);
  const eligibleAudio = audioRows.filter((row) => Date.parse(row.recordedAt) <= to);
  const intervalSources = eligibleSources.filter((row) => Date.parse(row.recordedAt) > from);
  const intervalAudio = eligibleAudio.filter((row) => Date.parse(row.recordedAt) > from);
  const completedSources = distinctTerminal(intervalSources, ["completed"]);
  const cancelledSources = distinctTerminal(intervalSources, ["cancelled"]);
  const refusedSources = distinctTerminal(intervalSources, ["refused"]);
  const completedAudio = distinctTerminal(intervalAudio, ["completed"]);
  const refusedAudio = distinctTerminal(intervalAudio, ["refused"]);
  const terminalEvidence = new Set([...completedSources, ...cancelledSources, ...refusedSources, ...completedAudio, ...refusedAudio].map((row) => row.evidence));
  const events = [];
  if (completedSources.length) {
    const installed = completedSources.reduce((sum, row) => sum + (row.receipt?.finalSourceIds?.length ?? 0), 0);
    const retired = completedSources.reduce((sum, row) => sum + (row.receipt?.deletedSourceIds?.length ?? 0), 0);
    events.push(event({ window, occurredAt: completedSources.map((row) => row.recordedAt).sort().at(-1), domain: "operations", kind: "gemini-notebook-source-reconciliation-completed",
      summary: `Gemini Notebook reconciled ${completedSources.length} source sets, installed ${installed} current sources, and retired ${retired} superseded sources only after replacements were ready.`, outcome: "succeeded",
      values: [["Gemini Notebook source sets reconciled", completedSources.length, "sets", 440], ["Gemini Notebook sources installed", installed, "sources", 441], ["Gemini Notebook superseded sources retired", retired, "sources", 442]], evidence: completedSources.map((row) => row.evidence) }));
  }
  if (cancelledSources.length) {
    const preserved = cancelledSources.reduce((sum, row) => sum + (row.cancellationReceipt?.preservedIncumbentSourceIds?.length ?? 0), 0);
    const removed = cancelledSources.reduce((sum, row) => sum + (row.cancellationReceipt?.deletedStagedSourceIds?.length ?? 0), 0);
    events.push(event({ window, occurredAt: cancelledSources.map((row) => row.recordedAt).sort().at(-1), domain: "operations", kind: "gemini-notebook-source-reconciliation-safely-cancelled",
      summary: `Gemini Notebook safely cancelled ${cancelledSources.length} source reconciliation job${cancelledSources.length === 1 ? "" : "s"} after downstream refusal, removed ${removed} staged sources, and preserved ${preserved} incumbent sources.`, outcome: "succeeded",
      values: [["Gemini Notebook source jobs safely cancelled", cancelledSources.length, "jobs", 443], ["Gemini Notebook staged sources removed", removed, "sources", 444], ["Gemini Notebook incumbent sources preserved", preserved, "sources", 445]], evidence: cancelledSources.map((row) => row.evidence) }));
  }
  if (completedAudio.length) {
    const bytes = completedAudio.reduce((sum, row) => sum + Number(row.artifact?.byteLength ?? 0), 0);
    events.push(event({ window, occurredAt: completedAudio.map((row) => row.recordedAt).sort().at(-1), domain: "work", kind: "gemini-notebook-audio-briefing-delivered",
      summary: `Gemini Notebook completed and locally delivered ${completedAudio.length} source-grounded audio briefings (${bytes} bytes).`, outcome: "succeeded",
      values: [["Gemini Notebook audio briefings delivered", completedAudio.length, "briefings", 446], ["Gemini Notebook audio bytes delivered", bytes, "bytes", 447]], evidence: completedAudio.map((row) => row.evidence) }));
  }
  if (refusedSources.length || refusedAudio.length) {
    const codes = [...new Set([...refusedSources, ...refusedAudio].map((row) => row.code ?? "unspecified"))].sort();
    events.push(event({ window, occurredAt: [...refusedSources, ...refusedAudio].map((row) => row.recordedAt).sort().at(-1), domain: "operations", kind: "gemini-notebook-provider-job-refused",
      summary: `Gemini Notebook refused ${refusedSources.length} source jobs and ${refusedAudio.length} audio jobs; provider codes: ${codes.join(", ")}.`, outcome: "refused",
      values: [["Gemini Notebook source jobs refused", refusedSources.length, "jobs", 448], ["Gemini Notebook audio jobs refused", refusedAudio.length, "jobs", 449]], evidence: [...refusedSources, ...refusedAudio].map((row) => row.evidence) }));
  }
  if ((intervalSources.length || intervalAudio.length) && terminalEvidence.size === 0) {
    const all = [...intervalSources, ...intervalAudio];
    events.push(event({ window, occurredAt: all.map((row) => row.recordedAt).sort().at(-1), domain: "operations", kind: "gemini-notebook-async-work-advanced",
      summary: `Gemini Notebook advanced ${intervalSources.length} durable source-job transitions and ${intervalAudio.length} durable audio-job transitions; no terminal provider outcome occurred in this interval.`, outcome: "observed",
      values: [["Gemini Notebook source-job transitions", intervalSources.length, "transitions", 450], ["Gemini Notebook audio-job transitions", intervalAudio.length, "transitions", 451]], evidence: all.map((row) => row.evidence) }));
  }

  const latestSources = latestByOperation(eligibleSources); const latestAudio = latestByOperation(eligibleAudio);
  const activeSources = latestSources.filter((row) => !["completed", "cancelled", "refused"].includes(row.status));
  const activeAudio = latestAudio.filter((row) => !["completed", "refused"].includes(row.status));
  const latest = [...latestSources, ...latestAudio].sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt));
  const observedAt = latest.at(-1)?.recordedAt ?? recordedAt;
  const stockEvidence = latest.length ? [...new Set(latest.map((row) => row.evidence))].sort() : [`${GEMINI_NOTEBOOK_ACTIVITY_PROVIDER}:evidence:no-jobs-at-boundary`];
  return { type: "ColonyActivityPulseEnvelope", providerActor: GEMINI_NOTEBOOK_ACTIVITY_PROVIDER, settlementActor: SETTLEMENT_ACTOR, colonyActor: COLONY_ACTOR, window, recordedAt, events,
    stocks: [
      { id: "active-source-jobs", observedAt, domain: "operations", label: "Gemini Notebook source jobs active", amount: String(activeSources.length), unit: "jobs", status: "observed", displayOrder: 880, evidence: stockEvidence },
      { id: "active-audio-jobs", observedAt, domain: "work", label: "Gemini Notebook audio jobs active", amount: String(activeAudio.length), unit: "jobs", status: "observed", displayOrder: 881, evidence: stockEvidence },
      { id: "audio-briefings-delivered", observedAt, domain: "work", label: "Gemini Notebook audio briefings delivered", amount: String(latestAudio.filter((row) => row.status === "completed").length), unit: "briefings", status: "observed", displayOrder: 882, evidence: stockEvidence },
      { id: "source-jobs-safely-cancelled", observedAt, domain: "operations", label: "Gemini Notebook source jobs safely cancelled", amount: String(latestSources.filter((row) => row.status === "cancelled").length), unit: "jobs", status: "observed", displayOrder: 883, evidence: stockEvidence }
    ],
    unsupportedDomains: ["formations", "politics", "contracts", "a2a", "activity-streams", "git-io", "evm", "deployments"],
    refusals: [{ domain: "economy", reason: "This provider pulse exposes job outcomes but carries no price, spend, revenue, or x402 settlement receipt; monetary outcomes remain unknown.", evidence: stockEvidence }] };
}
