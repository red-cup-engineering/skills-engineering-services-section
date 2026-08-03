import { readFileSync } from "node:fs";
import { z } from "zod";
import { classifyCodexDemand } from "./codex-demand-classification.mjs";
import { DIRECT_WITNESS_SETTLEMENT_CAPABILITY, RESOLUTION_CREDIT_ASSET, RESOLUTION_CREDIT_UNIT } from "./consideration.mjs";

const CODEX_CUSTOMER = "urn:ame:bare-cedar-fog-codex";

const PACKAGE = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const CODEX_MCP_SERVER_INFO = Object.freeze({
  name: "inference-work-lot-service",
  version: PACKAGE.version,
});

export const CODEX_MCP_INSTRUCTIONS = `The stable customer Actor is ${CODEX_CUSTOMER}; a session is never a customer. Codex owns its routine bounded code decisions, provider purchases under the admitted consideration policy, and assayed delivery outcomes without case-by-case Leader approval. Route mechanical acts to deterministic execution and bounded context-complete derivations to the provider market. Provider failure never silently falls back to Codex. Provider identity is provenance, not acceptance evidence. Do not send secrets or ambient repository access. A later effect on another Actor requires that Actor's induction boundary; it does not change who purchased this work.`;

export const CONTRACT_INFERENCE_WORK_INPUT_SCHEMA = Object.freeze({
  objective: z.string().min(1).describe("One exact result to derive."),
  context: z.string().optional().describe("Legacy self-contained source excerpts. Supply this or contextPacket, never both. Do not include secrets."),
  contextPacket: z.object({
    id: z.string().startsWith("ni:///sha-256;"),
    profile: z.literal("org.harmonious-union.context-packet.v1"),
    objective: z.string().min(1),
    createdBy: z.string().startsWith("urn:"),
    segments: z.array(z.object({ ni: z.string().startsWith("ni:///sha-256;"), mediaType: z.string().min(1), byteLength: z.number().int().positive(), source: z.string().min(1).optional(), content: z.string().min(1) })).min(1),
    knowledge: z.array(z.object({ ni: z.string().startsWith("ni:///sha-256;"), relation: z.string().min(1) })).min(1),
  }).optional().describe("Canonical packet whose context and knowledge coordinates enter the paid inference compact. Supply this or context, never both."),
  workType: z.enum(["chat", "classification", "extraction", "summarization", "inquiry", "software-engineering", "code-review"]).default("inquiry"),
  requiredCapabilities: z.array(z.string()).optional(),
  difficulty: z.number().min(0).max(1).optional().describe("Optional customer observation on the closed interval 0..1; omit rather than invent one."),
  enforceProviderSchema: z.boolean().default(false).describe("Require the selected supplier to enforce the JSON Schema itself; otherwise the customer-owned assay validates returned JSON."),
  routingProfile: z.enum(["bounded", "extended"]).optional().describe("Legacy provider-selection hint; omit to let offers form the frontier."),
  extendedRoutingRationale: z.string().min(1).optional(),
  considerationPolicy: z.object({
    type: z.literal("ConsiderationPolicy"),
    acceptableAlternatives: z.array(z.object({
      id: z.string().min(1),
      obligations: z.array(z.object({
        kind: z.literal("credit"),
        asset: z.literal(RESOLUTION_CREDIT_ASSET),
        unit: z.literal(RESOLUTION_CREDIT_UNIT),
        settlementCapabilities: z.array(z.literal(DIRECT_WITNESS_SETTLEMENT_CAPABILITY)).min(1),
      })).min(1),
    })).min(1).describe("Ordered from most preferred to least preferred; no implicit exchange rate is applied."),
  }).optional().describe("Customer-authored acceptable denomination and settlement capabilities. Provider-authored exact prices form the market frontier."),
  outputSchema: z.record(z.string(), z.unknown()).optional().describe("Optional customer-owned JSON Schema. Omit for natural text; the customer binds the entire provider output deterministically."),
  desiredUse: z.string().optional(),
  excludeProviders: z.array(z.string()).optional().describe("Providers barred for an observed operational or contractual reason; author identity alone is not evidence."),
  customer: z.literal(CODEX_CUSTOMER).optional().describe("The only customer accepted by this Codex-specific market; omitted input is bound to the same stable Actor."),
  workLotId: z.string().startsWith("urn:").optional().describe("Optional exact work-lot URN; omit to generate one."),
  mode: z.enum(["live"]).default("live"),
});

export const CONTRACT_INFERENCE_WORK_ANNOTATIONS = Object.freeze({
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
  readOnlyHint: false,
});

export const CLASSIFY_CODEX_DEMAND_INPUT_SCHEMA = Object.freeze({
  demandClass: z.enum(["mechanical", "bounded-derivation", "premium-review"]).describe("Mechanical work stays deterministic; bounded derivations enter the provider market; premium review is an explicit human-led residual."),
  difficulty: z.number().min(0).max(1).optional(),
  contextCharacters: z.number().int().min(0).optional(),
});

export const RECORD_INFERENCE_OUTCOME_INPUT_SCHEMA = Object.freeze({
  workLot: z.string().min(1).describe("The exact work-lot identifier returned by the market."),
  provider: z.string().min(1).describe("The exact provider actor from the fulfilled or refused exchange."),
  taskClass: z.string().min(1).describe("The task class used to select that provider."),
  selectedOffer: z.string().min(1).describe("The exact selected provider offer returned by the market."),
  receipt: z.string().min(1).describe("The fulfilled inference exchange receipt returned by the market."),
  receiver: z.string().min(1).describe("The receiving customer actor that issued this disposition."),
  outcome: z.enum(["accepted", "refused"]).describe("The receiving customer's attributable disposition; schema validity alone is not acceptance."),
  evidence: z.string().min(1).describe("An exact receiver decision or behavioral-assay evidence identifier."),
});

export async function invokeClassifyCodexDemand(input) {
  try {
    const result = classifyCodexDemand(input);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: JSON.stringify({ outcome: "classification-error", reason }, null, 2) }], isError: true };
  }
}

export async function invokeContractInferenceWork(input) {
  try {
    // Provider transport is loaded only for an actual contracted lot.  This
    // keeps initialize and deterministic classification available through a
    // supplier outage or a missing optional provider dependency.
    const { contractCodexInferenceWork } = await import("./codex-inference-market.mjs");
    const result = await contractCodexInferenceWork(input);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: result.outcome !== "candidate-pending-codex-acceptance" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: JSON.stringify({ outcome: "procurement-error", reason }, null, 2) }], isError: true };
  }
}

export async function invokeRecordInferenceOutcome(input) {
  try {
    const { recordCodexInferenceOutcome } = await import("./codex-inference-market.mjs");
    const result = await recordCodexInferenceOutcome(input);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: JSON.stringify({ outcome: "receiver-outcome-error", reason }, null, 2) }], isError: true };
  }
}
