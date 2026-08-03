#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSignedAgentCard } from "../src/agent-card-discovery.mjs";
import { assayTypedInferenceCandidate } from "../src/customer-assay-typed-inference.mjs";
import { DEFAULT_CODEX_CONSIDERATION_POLICY } from "../src/codex-inference-market.mjs";
import { loadCustomerServiceAdmissions, loadProviderAdmissions, standingOfferFromAgentCard } from "../src/provider-admission.mjs";
import { demandCommitment, procureTypedInference } from "../src/typed-rmn-inference-procurement.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PROVIDER = "urn:ame:bare-cedar-fog-npu-inference-team";
const ADMISSIONS = resolve(ROOT, "content/provider-admissions/codex-inference-providers.json");
const SERVICES = loadCustomerServiceAdmissions(resolve(ROOT, "content/provider-admissions/semantic-services.json"), { admissionGraph: "urn:ame:inference-work-lot-service:service-admissions" });
function option(name, fallback) { const at = process.argv.indexOf(name); return at === -1 ? fallback : process.argv[at + 1]; }
const mode = option("--mode", "live");
const admission = loadProviderAdmissions(ADMISSIONS).find(({ actor }) => actor === PROVIDER);
if (!admission) throw new Error("the customer provider-admission plate does not admit the local inference die");
const supplier = {
  actor: admission.actor,
  async exchange(activity) {
    const card = await discoverSignedAgentCard({ agentUrl: admission.agentCard });
    return standingOfferFromAgentCard(admission, card, activity, activity.object, demandCommitment);
  },
};
const request = {
  workLot: { id: "urn:work-lot:live-npu-typed-procurement", producer: "urn:ame:inference-work-lot-service" },
  context: {
    purpose: "Exercise one real typed Union inference act without asserting semantic customer acceptance.",
    suppliedContext: "Observed bounded fact: Recursive Development Foundry emits DevelopmentAttemptDemand, DevelopmentDieInductionDemand, DevelopmentNodeCastingDemand, and DevelopmentSettlementInductionDemand as local JSON effect records. A bounded repository search found those demand names only in that foundry's pure compiler and tests; no provider boundary consumes them. Classify this observed handoff as executable-provider-handoff or recorded-effect-only, and state the decisive evidence.",
  },
  actuatorTerms: {
    workType: "classification", requiredCapabilities: ["classification"], difficulty: 0.1, mode,
    considerationPolicy: DEFAULT_CODEX_CONSIDERATION_POLICY,
    outputContract: { format: "json", schema: { type: "object", required: ["class", "basis"], properties: { class: { type: "string" }, basis: { type: "string" } }, additionalProperties: false } },
    agentCards: [{ actor: PROVIDER, url: admission.agentCard }],
  },
};
const residue = { type: "UnresolvedTokenClaimResidue", reason: "no-deterministic-cover-for-novel-classification", admissibleNextServiceClass: "inference-actuator" };
const account = JSON.parse(readFileSync(resolve(ROOT, "content/evm/accounts/eip155-31337.json"), "utf8")).account.caip10;
const result = await procureTypedInference({ residue, request, suppliers: [supplier], caller: { actor: "urn:ame:inference-work-lot-service", account }, customerServices: SERVICES, settlementRoot: ROOT });
const schemaAssay = result.disposition === "candidate-pending-customer-assay" ? await assayTypedInferenceCandidate(result, { customerServices: SERVICES, settlementRoot: ROOT }) : null;
process.stdout.write(`${JSON.stringify({
  type: result.type,
  disposition: schemaAssay ? (schemaAssay.accepted ? "schema-assayed-candidate-pending-customer-acceptance" : "schema-refused-candidate") : result.disposition,
  selectedProvider: result.selection?.selected?.provider?.actor,
  consideration: result.selection?.selected?.offer?.object?.consideration,
  proposal: result.contract?.proposal?.term,
  operation: result.contract?.operation?.term,
  settlement: result.settlement?.completion,
  providerDisposition: result.settlement?.disposition,
  settlementResidues: result.settlementResidues ?? [],
  candidate: result.settlement?.candidate ?? "",
  schemaAssay,
  semanticCustomerAcceptance: false,
  projection: result.projection,
}, null, 2)}\n`);
