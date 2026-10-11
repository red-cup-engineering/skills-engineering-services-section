import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNotebook, formNotebookCreationRequest } from "../src/create-notebook.mjs";
import { startGeminiNotebookWitnessJournalFixture } from "./witness-journal-fixture.js";

const CUSTOMER = "urn:test:notebook-customer", TITLE = "Independent research workspace", ID = "00000000-0000-4000-8000-000000000001";
const AUTHORIZATION = `ni:///sha-256;${"a".repeat(42)}A`, AUTHORIZATION_REQUEST_DIGEST = `ni:///sha-256;${"b".repeat(42)}A`;
function request(customer = CUSTOMER, title = TITLE) { return formNotebookCreationRequest(customer, title, AUTHORIZATION, AUTHORIZATION_REQUEST_DIGEST); }
function verifyAuthorization(input) { return { type: "NotebookCreationAuthorizationVerification", id: `ni:///sha-256;${"c".repeat(42)}A`, active: true, authorization: input.authorizationId, provider: input.provider, beneficiary: input.beneficiary, title: input.title, requestDigest: input.requestDigest, expiresAt: "2096-07-22T12:00:00.000Z" }; }
async function fixture(t) { const root = mkdtempSync(join(tmpdir(), "notebook-create-")), witnessJournal = await startGeminiNotebookWitnessJournalFixture(); t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); }); return { dataRoot: join(root, "data"), witnessJournalAgentUrl: witnessJournal.agentCardUrl, now: "2096-07-21T12:00:00.000Z" }; }
test("authorization-bound notebook creation records intent, validates identity, and replays", async (t) => { const options = await fixture(t); let calls = 0; const formed = request(); const first = await createNotebook(formed, { ...options, verifyAuthorization, runCli: () => { calls += 1; return { status: 0, json: { notebook: { id: ID, title: TITLE, created_at: options.now } } }; } }); const second = await createNotebook(formed, { ...options, verifyAuthorization, runCli: () => { calls += 1; } }); assert.equal(first.notebookId, ID); assert.equal(first.authorization, AUTHORIZATION); assert.equal(second.id, first.id); assert.equal(calls, 1); assert.deepEqual(first.authorityWithheld, ["source-mutation", "sharing", "generation", "deletion", "publication"]); });
test("unverified creation and ambiguous retry are refused", async (t) => { const options = await fixture(t); await assert.rejects(createNotebook(request("urn:foreign", "Other"), options), /separately hired/u); const formed = request(); await assert.rejects(createNotebook(formed, { ...options, verifyAuthorization, runCli: () => ({ status: 124, errorCode: "ETIMEDOUT" }) }), /ambiguous/u); await assert.rejects(createNotebook(formed, { ...options, verifyAuthorization }), /ambiguous prior effect/u); });
