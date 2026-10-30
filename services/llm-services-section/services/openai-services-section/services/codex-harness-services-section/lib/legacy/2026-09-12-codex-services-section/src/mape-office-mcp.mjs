#!/usr/bin/env node
import { serveMcpToolServerStdio } from "@red-cup-engineering/model-context-protocol-services-section";

import { codexMapePosition, compileCodexMapeCycle, loadCodexMapeOffice, recordCodexMapeArtifact } from "./mape-office.mjs";
import { selectContextWarrantedDuties } from "./duty-selection.mjs";
import { integrateRequirementBoundActuationPlan } from "./requirement-trajectory.mjs";
import { admitSourcePinnedAdvisory } from "./source-pinned-analysis.mjs";
import { executeAuthorityBoundIntegration } from "./authority-bounded-integration.mjs";
import { composeSituatedCharacterFace, deriveCapacityFabricationObligation, observeImmunitas, projectOfficeObligations } from "./agential-forms.mjs";

const identity = { type: "string", pattern: "^ni:///sha-256;[A-Za-z0-9_-]{43}$" };
const tools = [
  {
    name: "observe_codex_mape_office",
    description: "Read and mechanically validate the one Bare Cedar Fog Codex office, its duties, real-provider actuator routes, knowledge classes, and registry digests.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "compile_codex_mape_cycle",
    description: "Optionally project one Leader move into a content-addressed peer-to-peer MAPE-over-K work-lot DAG for coordination and evidence. The Leader move itself already authorizes safe in-scope Codex execution; compilation and receipts never gate it.",
    inputSchema: {
      type: "object",
      required: ["leaderMove"],
      properties: {
        leaderMove: {
          type: "object",
          required: ["desiredOutcome", "source"],
          properties: { id: { type: "string" }, desiredOutcome: { type: "string" }, source: { type: "string" }, customer: { const: "urn:leader:emsenn" } },
          additionalProperties: false,
        },
        authorityReceipt: { type: "string" },
        initialKnowledge: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "record_codex_mape_artifact",
    description: "Append one MAPE knowledge artifact after checking exact work-lot and digest bindings, provider receipts, or a typed receiver endpoint outcome.",
    inputSchema: {
      type: "object",
      required: ["cycle", "workLot", "skill", "knowledgeClass", "issuer", "payloadDigest", "sourceReceipts", "knowledgeReceipts", "observedAt"],
      properties: {
        cycle: identity,
        workLot: { type: "object", required: ["id", "type", "cycle", "skill", "stage"], additionalProperties: true },
        skill: { type: "string" },
        knowledgeClass: { type: "string" },
        issuer: { type: "string" },
        payloadDigest: identity,
        sourceReceipts: { type: "array", minItems: 1, items: identity },
        knowledgeReceipts: { type: "object", additionalProperties: identity },
        providerReceipt: { type: "string" },
        authorityReceipt: identity,
        planReceipt: identity,
        disposition: { type: "string" },
        endpoint: { type: "string" },
        observedAt: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "observe_codex_mape_position",
    description: "Read the Codex-owned MAPE knowledge trajectory grouped by explicit K class without treating provider delivery as acceptance.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "select_context_warranted_duties",
    description: "Select the nonempty office-duty subset warranted by an exact provider-compiled context bundle without changing Codex identity or conveying office, execution, Leader, or customer authority.",
    inputSchema: {
      type: "object",
      required: ["actor", "office", "demand", "move", "session", "contextBundle", "contextCompilationReceipt"],
      properties: {
        actor: { const: "urn:ame:bare-cedar-fog-codex" },
        office: { const: "bare-cedar-fog-codex-actuation-office" },
        demand: { type: "string" }, move: { type: "string" }, session: { type: "string" },
        contextBundle: { type: "object", required: ["id", "type", "version", "compiler", "evidence"], additionalProperties: false, properties: { id: { type: "string" }, type: { const: "OfficerContextBundle" }, version: { const: 1 }, compiler: { type: "string" }, evidence: { type: "array", minItems: 1, items: { type: "object", required: ["id", "signal"], additionalProperties: false, properties: { id: { type: "string" }, signal: { type: "string" } } } } } },
        contextCompilationReceipt: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "integrate_requirement_bound_actuation_plan",
    description: "Integrate separately receipted SAS, HLD, LLD, and bounded-work candidates only when every exact requirement and predecessor edge survives; otherwise return a receipted no-fallback provider obstruction.",
    inputSchema: {
      type: "object", required: ["actor", "demand", "requirementSet", "evidenceReceipt"],
      properties: {
        actor: { const: "urn:ame:bare-cedar-fog-codex" }, demand: { type: "string" }, evidenceReceipt: { type: "string" },
        requirementSet: { type: "object" }, providerCandidates: { type: "array", minItems: 4, maxItems: 4, items: { type: "object" } },
        providerRefusal: { type: "object", required: ["stage", "receipt"], properties: { stage: { type: "string" }, receipt: { type: "string" } }, additionalProperties: false },
      }, additionalProperties: false,
    },
  },
  {
    name: "admit_source_pinned_advisory",
    description: "Admit a provider advisory only when it binds an exact source corpus, deterministic lookup receipt, citations, contradictions, unknowns, and provider receipt; otherwise return a no-bypass obstruction.",
    inputSchema: {
      type: "object", required: ["actor", "demand", "corpus", "deterministicLookupReceipt"],
      properties: {
        actor: { const: "urn:ame:bare-cedar-fog-codex" }, demand: { type: "string" }, corpus: { type: "object" }, deterministicLookupReceipt: { type: "string" },
        providerCandidate: { type: "object" }, providerRefusal: { type: "object", required: ["receipt"], properties: { receipt: { type: "string" } }, additionalProperties: false },
      }, additionalProperties: false,
    },
  },
  {
    name: "execute_authority_bounded_integration",
    description: "Optional high-friction recorder for exactly one file candidate with replay and preimage protection. It is not the normal coding path and does not gate the Leader-authorized filesystem tools. The result remains unverified and unaccepted.",
    inputSchema: {
      type: "object", required: ["actor", "demand", "actuationPlan", "intent", "authority", "nativeResourceReceipt"],
      properties: {
        actor: { const: "urn:ame:bare-cedar-fog-codex" }, demand: { type: "string" }, actuationPlan: { type: "object" },
        intent: { type: "object" }, authority: { type: "object" }, nativeResourceReceipt: { type: "string" }, consideration: {},
      }, additionalProperties: false,
    },
  },
  {
    name: "compose_situated_character_face",
    description: "Compose the stable Codex Actor, one transient session face, one session character, and one no-authority mask without conflating identity, office, incumbency, or repertoire.",
    inputSchema: { type: "object", required: ["actor", "stableActor", "sessionFace", "character", "mask", "formationReceipt", "nativeResourceReceipt"], properties: { actor: { const: "urn:ame:bare-cedar-fog-codex" }, stableActor: { type: "object" }, sessionFace: { type: "object" }, character: { type: "object" }, mask: { type: "object" }, formationReceipt: { type: "string" }, nativeResourceReceipt: { type: "string" }, consideration: {} }, additionalProperties: false },
  },
  {
    name: "project_office_obligations",
    description: "Project standing, correlative obligations only through an exact dignitas incumbency joining a bearer-independent office and character; half-seats and incomplete duty denominators refuse.",
    inputSchema: { type: "object", required: ["actor", "office", "incumbency", "holder", "duties", "officeRepertoireReceipt", "nativeResourceReceipt"], properties: { actor: { const: "urn:ame:bare-cedar-fog-codex" }, office: { type: "object" }, incumbency: { type: "object" }, holder: { type: "object" }, duties: { type: "array", minItems: 1, items: { type: "object" } }, officeRepertoireReceipt: { type: "string" }, nativeResourceReceipt: { type: "string" }, consideration: {} }, additionalProperties: false },
  },
  {
    name: "observe_immunitas",
    description: "Observe whether exact Immunitas disables the requester from altering one standing obligation; preserve the original and never turn non-blocking into change authority.",
    inputSchema: { type: "object", required: ["actor", "obligation", "immunitas", "requester", "proposedChange", "nativeResourceReceipt"], properties: { actor: { const: "urn:ame:bare-cedar-fog-codex" }, obligation: { type: "object" }, immunitas: { type: "object" }, requester: { type: "string" }, proposedChange: { type: "string" }, nativeResourceReceipt: { type: "string" }, consideration: {} }, additionalProperties: false },
  },
  {
    name: "derive_capacity_fabrication_obligation",
    description: "Derive an open capacity-fabrication obligation only from the XO's standing cybernetic-medicine munus, an exact witnessed gap, provider-market evidence, a pipeline offer, and explicit office transition.",
    inputSchema: { type: "object", required: ["actor", "obligation", "gap", "pipeline", "pipelineOfferReceipt", "marketObservationReceipt", "officeTransitionReceipt", "nativeResourceReceipt"], properties: { actor: { const: "urn:ame:bare-cedar-fog-codex" }, obligation: { type: "object" }, gap: { type: "object" }, pipeline: { type: "string" }, pipelineOfferReceipt: { type: "string" }, marketObservationReceipt: { type: "string" }, officeTransitionReceipt: { type: "string" }, nativeResourceReceipt: { type: "string" }, consideration: {} }, additionalProperties: false },
  },
];

function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

async function call(name, args) {
  if (name === "observe_codex_mape_office") {
    const office = loadCodexMapeOffice();
    return result({ type: "CodexMapeOfficeProjection", office: office.office, duties: office.duties, skills: office.skills, knowledge: office.knowledge, registryDigests: office.registryDigests });
  }
  if (name === "compile_codex_mape_cycle") return result(compileCodexMapeCycle(args));
  if (name === "record_codex_mape_artifact") return result(recordCodexMapeArtifact(args));
  if (name === "observe_codex_mape_position") return result(codexMapePosition());
  if (name === "select_context_warranted_duties") return result(selectContextWarrantedDuties(args));
  if (name === "integrate_requirement_bound_actuation_plan") return result(integrateRequirementBoundActuationPlan(args));
  if (name === "admit_source_pinned_advisory") return result(admitSourcePinnedAdvisory(args));
  if (name === "execute_authority_bounded_integration") return result(executeAuthorityBoundIntegration(args));
  if (name === "compose_situated_character_face") return result(composeSituatedCharacterFace(args));
  if (name === "project_office_obligations") return result(projectOfficeObligations(args));
  if (name === "observe_immunitas") return result(observeImmunitas(args));
  if (name === "derive_capacity_fabrication_obligation") return result(deriveCapacityFabricationObligation(args));
  throw new Error(`unknown Codex MAPE office tool ${name}`);
}

await serveMcpToolServerStdio({
  serverInfo: { name: "bare-cedar-fog-codex-mape-office", version: "1.0.0" },
  instructions: "Operate as the Human Leader's coding agent. MAPE, skills, markets, plans, and receipts are optional instruments and never gates or jurisdiction. Suppliers and NotebookLM remain authority-free. Codex owns integration, mutation, and proportionate verification; do not invent receiver acceptance.",
  tools,
  dispatchResult: "mcp",
  dispatch: call,
});
