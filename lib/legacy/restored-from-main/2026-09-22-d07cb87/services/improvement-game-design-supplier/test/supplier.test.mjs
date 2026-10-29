import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolutionCreditPolicy } from "@red-cup-engineering/inference-dispatch-service/consideration";
import { ACTOR, CONTEXT, bidForGameOffer, fulfillGameAward, record } from "../src/supplier.mjs";
import { operatePulse, memoryLedger } from "../src/service.mjs";
import { createImprovementGameDesignSupplierRecordJournal, OBJECT_KIND } from "../src/record-journal.mjs";
import { formRecordImprovementOpportunity } from "@coesite-operations/sovereign-improvement-board-service/record-improvement-opportunity";
import { ACTOR as BOARD } from "@coesite-operations/sovereign-improvement-board-service/board";

const policy = { clockActor: "urn:ame:scheduled-activity-delivery-service", deliveryCapabilityId: `${ACTOR}:capability:watch`, minimumAsk: { amount: 6, unit: "u" }, capabilities: ["software-engineering", "json-schema-output"], maximumConcurrentLots: 2, maximumActivitiesPerTick: 4, reviewConsiderationPolicy: resolutionCreditPolicy(40), boards: [{ actor: "urn:customer", minimumBoardTick: 0, listOperation: "list", submitOperation: "submit" }] };
test("supplier dispositions use only package-local support custody at the supplied dataRoot", (t) => { const dataRoot = mkdtempSync(join(tmpdir(), "game-supplier-journal-")); t.after(() => rmSync(dataRoot, { recursive: true, force: true })); const journal = createImprovementGameDesignSupplierRecordJournal({ root: dataRoot }); journal.record({ category: "improvement-game-design-supplier.foraging", recordedAt: "2026-08-14T00:00:00.000Z", record: { board: "urn:board", activity: "urn:activity", status: "submitted" }, charge: { support: true, refutation: false } }); assert.equal(journal.root, dataRoot); assert.equal(journal.query({ category: "improvement-game-design-supplier.foraging" })[0].objectKind, OBJECT_KIND); assert.ok(journal.claims().some((claim) => claim.a === "charge:support")); assert.ok(!journal.claims().some((claim) => claim.a === "charge:refutation")); });
const digest = (x) => `sha256:${x.repeat(64)}`;
const envelope = { type: "ProtectedOracleImprovementGameEnvelope", customer: "urn:customer", territory: "/customer", requestedChanges: ["replace repeated premium derivation with deterministic resolver"], ownedTargetRoots: ["src/resolver"], forbiddenRoots: ["test"], sourceDigests: [digest("1"), digest("2")], acceptanceArtifacts: [{ path: "test/oracle.test.mjs", digest: digest("1") }], acceptanceCommands: [{ runner: "node", argv: ["--test", "test/oracle.test.mjs"] }], economy: { baselinePerTick: { amount: 100, unit: "tokens" }, maximumAcceptedPerTick: { amount: 1, unit: "tokens" }, expectedTicks: 10, baselineArtifacts: [{ path: "test/baseline.json", digest: digest("2") }] }, resourceCeilings: { runtimeMs: 1000, maximumFiles: 2, maximumBytes: 10000 }, productContract: { type: "DeterministicResolver", requiredFields: ["input"], prohibitedFields: ["network"], bindingFields: ["source"], validationChecks: ["customer-oracle"] }, requiredCapabilities: policy.capabilities, taskClass: "compile-repeated-derivation" };
const opportunity = record({ type: "ImprovementOpportunityObservation", customer: "urn:customer", territory: "/customer", taskClass: "compile-repeated-derivation", summary: "measured repeated derivation", sourceDigests: [digest("3")], observedAt: "2026-07-21T00:00:00.000Z", sensor: { provider: "urn:sensor", contract: "sensor/v1", operation: "observe", receipt: "urn:receipt" }, resourceObservation: { baselinePerTick: { amount: 100, unit: "tokens" }, expectedTicks: 10, basis: "measured" }, inquiryBudget: { amount: 10, unit: "u" }, requiredCapabilities: policy.capabilities, constraints: ["downward only"], context: { protectedOracleEnvelope: envelope } });
const lot = record({ type: "ImprovementGameDesignWorkLot", consumer: "urn:customer", opportunity: opportunity.id, sourceObservation: opportunity, gameTerms: { requiredCapabilities: policy.capabilities, territory: "/customer", customerMutationAuthorized: false, implementationAuthorized: false, oracleAuthorshipAuthorized: false, upwardEscalationAuthorized: false } });
const quote = record({ type: "ImprovementGameBuyerQuote", lot: lot.id, tick: 1, consideration: { amount: 7, unit: "u" } });
const offer = record({ "@context": CONTEXT, type: "Offer", actor: "urn:customer", target: "public", object: lot, attachment: [quote] });

test("supplier competes below the free-compute ask", () => { const bid = bidForGameOffer(offer, policy); assert.equal(bid.actor, ACTOR); assert.equal(bid.object.consideration.amount, 6); assert.equal(bid.object.estimatedInferenceCalls, 1); });
test("the record-improvement ingress advertises the exact capability profile this supplier can bid", () => {
  const finding = { type: "RecordImprovementFinding", customer: BOARD, provider: "urn:ame:record-curator", territory: "/customer", findingClass: "missing-description", path: "content/example.md", contentDigest: digest("4"), observationDigest: digest("5"), observedAt: "2026-07-22T00:00:00.000Z", summary: "a record needs its customer-approved description", resourceObservation: { baselinePerTransition: { amount: 1, unit: "record-findings" }, expectedTransitions: 4 }, protectedOracleEnvelope: { ...envelope, customer: BOARD, sourceDigests: [digest("4"), digest("5")] } };
  const opportunity = formRecordImprovementOpportunity(finding, { denomination: "u", minimumBounty: 5, maximumBounty: 31, recordOpportunity: { enabled: true, inquiryBudget: { amount: 9, unit: "u" } } });
  const recordLot = record({ type: "ImprovementGameDesignWorkLot", consumer: BOARD, opportunity: opportunity.id, sourceObservation: opportunity, gameTerms: { requiredCapabilities: opportunity.requiredCapabilities, territory: opportunity.territory, customerMutationAuthorized: false, implementationAuthorized: false, oracleAuthorshipAuthorized: false, upwardEscalationAuthorized: false } });
  const recordQuote = record({ type: "ImprovementGameBuyerQuote", lot: recordLot.id, tick: 1, consideration: { amount: 7, unit: "u" } });
  const recordOffer = record({ "@context": CONTEXT, type: "Offer", actor: BOARD, target: "public", object: recordLot, attachment: [recordQuote] });
  assert.equal(bidForGameOffer(recordOffer, policy)?.object.type, "ImprovementGameDesignBid");
});
test("protected oracle envelope compiles deterministically and review preserves attribution without review", async () => {
  const bid = bidForGameOffer(offer, policy), award = record({ "@context": CONTEXT, type: "Accept", actor: "urn:customer", target: ACTOR, object: { type: "ImprovementGameDesignAward", lot: lot.id, bid: bid.id, bidSnapshot: bid, customerMutationAuthorized: false, implementationAuthorized: false, oracleAuthorshipAuthorized: false } });
  const result = await fulfillGameAward(award, bid, { policy, contractInferenceWork: async (request) => { assert.equal(typeof request.context, "string"); assert.equal("excludeProviders" in request, false); return { outcome: "candidate-pending-customer-acceptance", provider: ACTOR, candidate: "bounded attributable advisory", evidence: { selectedOffer: "urn:offer", replay: "urn:replay" } }; } });
  assert.equal(result.object.proposedResidue.type, "ImprovementResidue"); assert.equal(result.object.resources.inferenceAttempts, 0); assert.equal(result.attachment[0].actor, ACTOR);
});
test("a separate deterministic assay retires the review inference call", async () => {
  const bid = bidForGameOffer(offer, policy), award = record({ "@context": CONTEXT, type: "Accept", actor: "urn:customer", target: ACTOR, object: { type: "ImprovementGameDesignAward", lot: lot.id, bid: bid.id, bidSnapshot: bid, customerMutationAuthorized: false, implementationAuthorized: false, oracleAuthorshipAuthorized: false } }); let inference = 0;
  const result = await fulfillGameAward(award, bid, { policy, reviewProposal: async ({ proposal }) => record({ type: "ImprovementGameReview", actor: "urn:deterministic-assay", proposal: proposal.id, accepted: true, reason: "bounded", evidence: { inferenceCalls: 0 } }), contractInferenceWork: async () => { inference += 1; } });
  assert.equal(result.type, "Create"); assert.equal(result.attachment[0].actor, "urn:deterministic-assay"); assert.equal(inference, 0);
});
test("missing customer oracle is a terminal typed refusal without stronger-model escalation", async () => {
  const { id: _opportunityId, ...opportunityBody } = opportunity, nakedOpportunity = record({ ...opportunityBody, context: {} });
  const { id: _lotId, ...lotBody } = lot, nakedLot = record({ ...lotBody, sourceObservation: nakedOpportunity });
  const nakedQuote = record({ type: "ImprovementGameBuyerQuote", lot: nakedLot.id, tick: 1, consideration: { amount: 7, unit: "u" } });
  const nakedOffer = record({ "@context": CONTEXT, type: "Offer", actor: "urn:customer", target: "public", object: nakedLot, attachment: [nakedQuote] }), bid = bidForGameOffer(nakedOffer, policy), award = record({ "@context": CONTEXT, type: "Accept", actor: "urn:customer", target: ACTOR, object: { type: "ImprovementGameDesignAward", lot: nakedLot.id, bid: bid.id, bidSnapshot: bid, customerMutationAuthorized: false, implementationAuthorized: false, oracleAuthorshipAuthorized: false } });
  const result = await fulfillGameAward(award, bid, { policy }); assert.equal(result.type, "Reject"); assert.equal(result.object.code, "insufficient-evidence"); assert.equal(result.object.strongerModelRequested, false);
});
test("clock pulse watches public offers and crosses only the board ingress", async () => {
  const pulse = { "@context": CONTEXT, id: "urn:pulse", type: "Create", actor: policy.clockActor, target: ACTOR, capability: policy.deliveryCapabilityId, object: { type: "IndependentImprovementGameSupplierPulse", pulseId: "urn:schedule#0" } }, calls = [];
  const result = await operatePulse(pulse, { policy, ledger: memoryLedger(), invokeBoard: async (_board, operation, input) => { calls.push({ operation, input }); return operation === "list" ? { type: "OrderedCollection", orderedItems: [offer] } : { type: "Accept", id: "urn:receipt" }; } });
  assert.equal(result.type, "Accept"); assert.deepEqual(calls.map((item) => item.operation), ["list", "submit"]); assert.equal(calls[1].input.object.type, "ImprovementGameDesignBid");
});
test("the advertised ScheduleDelivery entrypoint refuses a raw activity outside the supplier pulse contract", () => {
  const entry = new URL("../scripts/pulse-improvement-game-design-supplier.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(entry)], { input: JSON.stringify({}), encoding: "utf8" });
  assert.equal(result.status, 2); assert.equal(JSON.parse(result.stdout).type, "Reject");
});
