#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { ACTOR, appendObservation, identity, recordSupplierExchange, recordSupplierOffer } from "../src/enterprise.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REVIEW_ROOT = resolve(ROOT, "../../../../../../../red-cup-engineering/services/software-services-section/services/semiotic-services-section/semantic-services-section/semantic-candidate-review-service");
const { requestSemanticCandidateReview } = await import(pathToFileURL(resolve(REVIEW_ROOT, "src/client.mjs")));
const assayRun = spawnSync(process.execPath, [resolve(ROOT, "scripts/assay-harness-candidate.mjs"), "--record"], { cwd: ROOT, encoding: "utf8" });
if (assayRun.status !== 0) throw new Error(`fresh harness assay failed: ${assayRun.stderr || assayRun.stdout}`);
const assay = JSON.parse(assayRun.stdout);
const changedPaths = assay.candidateFiles.filter(({ path }) => /^(?:src|agents\/actuators)\//u.test(path)).map(({ path }) => path);
const manifest = {
  id: identity({ type: "HarnessSemanticReviewManifest", candidateDigest: assay.candidateDigest }),
  objective: "Meet or beat the preserved Codex runtime-skills harness with real typed architecture, source-pinned analysis, requirement-preserving planning, authority-bounded Execute, evidence-bound assurance, and exact Actor/face/character/mask/office/duty/obligation/immunitas relations.",
  constraints: [
    "No supplier, session, mask, office, or advisory acquires Leader or customer authority.",
    "Every provider receipt, economic observation, exact candidate digest, fresh assay, and customer outcome remains distinct.",
    "No backup source is deprecated from provider delivery or verification alone.",
    "Execute must refuse missing, superseded, replayed, scope-drifting, or changed-preimage authority before mutation.",
  ],
  writablePaths: changedPaths,
  routingProfile: "extended",
  extendedRoutingRationale: "The exact candidate spans five inherited runtime capabilities plus the new agential/deontic actuator family; cross-file invariants require one complete bounded review lot.",
  testVectors: [
    { id: "typed-mape", given: ["a MAPE registry and Leader move"], when: "the cycle is compiled", then: ["every transformation is one stage over explicit K", "provider Actors are real"], forbidden: ["synthetic market actors", "advisory-to-Execute shortcut"] },
    { id: "source-pinned-analysis", given: ["an exact source corpus"], when: "NotebookLM advice is admitted", then: ["citations, contradictions, unknowns, and provider receipt bind the corpus"], forbidden: ["foreign citation", "authority-bearing advice"] },
    { id: "requirement-trajectory", given: ["exact RequirementK completion conditions"], when: "SAS/HLD/LLD/work lots compose", then: ["all conditions and predecessor receipts survive"], forbidden: ["silent weakening", "collapsed tier", "credential or ambient repository access"] },
    { id: "authority-bounded-execute", given: ["one exact inert plan and single-use LeaderAuthorityK"], when: "Execute materializes bytes", then: ["only the exact scoped preimage/after image changes", "CandidatePatchK remains pending"], forbidden: ["plain authority reference writes", "replay", "self-verification or acceptance"] },
    { id: "evidence-bound-completion", given: ["an exact pending candidate and named completion conditions"], when: "completion is observed", then: ["evidence binds the exact condition and candidate"], forbidden: ["provider completion becoming demand closure"] },
    { id: "agential-deontic-separation", given: ["Actor, face, character, mask, office, incumbency, duty, and immunitas"], when: "the XO repertoire is projected", then: ["identity, seat, munus, claim, and protection remain distinct"], forbidden: ["mask authority", "half-seat execution", "immunity treated as liberty or power", "declared capability success"] },
  ],
  acceptanceCapsule: {
    oracleReview: assay.oracleReview, redWitness: assay.redWitness, command: assay.command,
    artifacts: assay.artifacts.map(({ path, digest }) => ({ path, digest, text: readFileSync(resolve(ROOT, path), "utf8") })),
  },
};
const candidate = {
  providers: [ACTOR], actions: changedPaths.map((path) => ({ action: "candidate-source", args: { path }, reason: `exact member of ${assay.candidateDigest}` })),
  changes: changedPaths.map((path) => ({ path, after: readFileSync(resolve(ROOT, path)) })),
};
const exchange = await requestSemanticCandidateReview({ agentUrl: process.env.SEMANTIC_REVIEW_AGENT_URL ?? "http://127.0.0.1:19840/.well-known/agent-card.json", manifest, candidate, minimumReviews: 1, maximumReviews: 1 });
const observedAt = new Date().toISOString();
const provider = "urn:ame:semantic-candidate-review-service";
const demand = "ni:///sha-256;gByRVgozO50GrHQLdKi_6BNfDYSzAq-LSzcrmdZqcWU";
const signedCardReceipt = identity({ type: "SignedProviderAgentCard", agentCard: exchange.exchange.agentCard });
let offerObservation;
try { offerObservation = recordSupplierOffer({ demand, provider, capability: "evidence-bound-harness-semantic-review", offer: signedCardReceipt, protocol: "A2A 1.0 + RMN", observedAt }); }
catch (error) { if (!/known Codex demand/u.test(error.message)) throw error; }
const exchangeObservation = recordSupplierExchange({ demand, ...(offerObservation ? { offer: offerObservation.record.id } : {}), provider, capability: "evidence-bound-harness-semantic-review", receipt: exchange.receiptNi, protocol: "A2A 1.0 + RMN", observedAt });
const body = { type: "HarnessSemanticReviewExchange", version: 1, actor: ACTOR, demand, candidateDigest: assay.candidateDigest, freshAssayReceipt: assay.id, provider, signedCardReceipt, providerReceipt: exchange.receiptNi, reviewSubject: exchange.receipt.subject, acceptedByProtectedAssay: exchange.review.accepted, acceptanceBasis: exchange.review.acceptanceBasis, customerOutcome: null, supplierExchange: exchangeObservation.record.id, observedAt };
const result = Object.freeze({ id: identity(body), ...body });
appendObservation({ type: "HarnessSemanticReviewObserved", actor: ACTOR, receipt: result.id, providerReceipt: exchange.receiptNi, candidateDigest: assay.candidateDigest, freshAssayReceipt: assay.id, disposition: exchange.review.accepted ? "provider-verified-customer-outcome-pending" : "provider-refused-or-assay-failed", observedAt });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
