import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { recordWitnessJournalBatch, relationalWitnessJournalDocument } from "@red-cup-engineering/witness-journal-document-service";
import { collectGeminiNotebookColonyActivity, GEMINI_NOTEBOOK_ACTIVITY_PROVIDER } from "../src/collect-colony-activity.mjs";
import { queryProviderCategory } from "../src/provider-evidence.mjs";
import { startGeminiNotebookWitnessJournalFixture } from "./witness-journal-fixture.js";

const ACCOUNT = "eip155:31337:0xf1c133d8f725af2f4ad00176ff810e32d1d2f6cd";
const window = { fromExclusive: "2026-07-20T05:00:00.000Z", toInclusive: "2026-07-20T06:00:00.000Z", baseline: false };

async function append(witnessJournal, root, category, row) {
  const envelope = { type: "GeminiNotebookJobRecord", category, row };
  const document = relationalWitnessJournalDocument(envelope); const graph = semanticId(document);
  await recordWitnessJournalBatch({ agentUrl: witnessJournal.agentCardUrl, batch: { settlement: ACCOUNT, graph, recordedAt: row.recordedAt, document, assertions: [
    { subject: GEMINI_NOTEBOOK_ACTIVITY_PROVIDER, predicate: "urn:emsenn:gemini-notebook:recorded", object: { kind: "iri", value: graph } },
    { subject: graph, predicate: "urn:emsenn:gemini-notebook:category", object: { kind: "literal", value: category } }
  ] } });
}

test("authors exact-interval reconciliation, cancellation, refusal, and audio outcomes", async () => {
  const witnessJournal = await startGeminiNotebookWitnessJournalFixture(); const dataRoot = mkdtempSync(join(tmpdir(), "gemini-notebook-pulse-"));
  try {
    await append(witnessJournal, dataRoot, "source-jobs", { operationId: "urn:source:boundary", sequence: 1, recordedAt: window.fromExclusive, status: "completed", receipt: { finalSourceIds: ["old"], deletedSourceIds: [] } });
    await append(witnessJournal, dataRoot, "source-jobs", { operationId: "urn:source:complete", sequence: 1, recordedAt: "2026-07-20T05:10:00.000Z", status: "completed", receipt: { finalSourceIds: ["a", "b", "c", "d", "e"], deletedSourceIds: ["p", "q", "r", "s", "t"] } });
    await append(witnessJournal, dataRoot, "source-jobs", { operationId: "urn:source:cancel", sequence: 2, recordedAt: "2026-07-20T05:20:00.000Z", status: "cancelled", cancellationReceipt: { preservedIncumbentSourceIds: ["a", "b", "c", "d", "e"], deletedStagedSourceIds: ["x", "y"] } });
    await append(witnessJournal, dataRoot, "audio-jobs", { operationId: "urn:audio:complete", sequence: 3, recordedAt: "2026-07-20T05:30:00.000Z", status: "completed", artifact: { byteLength: 1200 } });
    await append(witnessJournal, dataRoot, "audio-jobs", { operationId: "urn:audio:active", sequence: 1, recordedAt: "2026-07-20T05:40:00.000Z", status: "audio-submitted" });
    await append(witnessJournal, dataRoot, "source-jobs", { operationId: "urn:source:refused", sequence: 1, recordedAt: "2026-07-20T05:50:00.000Z", status: "refused", code: "source-precondition-mismatch" });
    const pulse = await collectGeminiNotebookColonyActivity({ window, recordedAt: window.toInclusive, dataRoot, witnessJournalAgentUrl: witnessJournal.agentCardUrl, query: queryProviderCategory });
    assert.equal(pulse.providerActor, GEMINI_NOTEBOOK_ACTIVITY_PROVIDER);
    assert.deepEqual(pulse.events.map((item) => item.kind), [
      "gemini-notebook-source-reconciliation-completed", "gemini-notebook-source-reconciliation-safely-cancelled",
      "gemini-notebook-audio-briefing-delivered", "gemini-notebook-provider-job-refused"
    ]);
    assert.match(pulse.events[1].summary, /preserved 5 incumbent sources/u);
    assert.equal(pulse.events[2].quantities.find((item) => item.unit === "bytes").amount, "1200");
    assert.match(pulse.events[3].summary, /source-precondition-mismatch/u);
    assert.equal(pulse.stocks.find((item) => item.id === "active-audio-jobs").amount, "1");
    assert.equal(pulse.stocks.find((item) => item.id === "source-jobs-safely-cancelled").amount, "1");
  } finally { await witnessJournal.close(); }
});

test("reports durable progress without fabricating a terminal outcome", async () => {
  const witnessJournal = await startGeminiNotebookWitnessJournalFixture(); const dataRoot = mkdtempSync(join(tmpdir(), "gemini-notebook-progress-pulse-"));
  try {
    await append(witnessJournal, dataRoot, "source-jobs", { operationId: "urn:source:active", sequence: 1, recordedAt: "2026-07-20T05:15:00.000Z", status: "source-processing" });
    const pulse = await collectGeminiNotebookColonyActivity({ window, recordedAt: window.toInclusive, dataRoot, witnessJournalAgentUrl: witnessJournal.agentCardUrl, query: queryProviderCategory });
    assert.equal(pulse.events.length, 1); assert.equal(pulse.events[0].kind, "gemini-notebook-async-work-advanced"); assert.equal(pulse.events[0].outcome, "observed");
    assert.equal(pulse.stocks.find((item) => item.id === "active-source-jobs").amount, "1");
  } finally { await witnessJournal.close(); }
});
