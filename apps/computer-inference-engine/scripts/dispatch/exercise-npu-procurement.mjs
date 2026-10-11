#!/usr/bin/env node
// Exercise one real typed inference act on the local NPU provider through its
// direct-endpoint admission: the typed request is admitted against the
// admission's typedInferenceBounds, dispatched as the direct-endpoint offer
// through the engine's OpenAI-compatible transport, and its candidate is
// assayed against the output schema. Semantic customer acceptance is never
// asserted. --mode dry-run admits and prints the offer without dispatching.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { schemaFrom } from "@red-cup-engineering/json-schema-services-section/contracts";
import { executeOpenAiCompatibleToolAgent } from "../../src/openai/tool-agent.mjs";
import { admitBoundedTypedInference } from "../../src/ollama/ollama-exchange.mjs";
import { DEFAULT_DIRECT_ENDPOINT_PROVIDER_CONFIG, directEndpointOffer, dispatchDirectEndpointOffer, loadDirectEndpointProviderDescriptors, openAiJsonSchemaResponseFormat } from "../../src/dispatch/direct-endpoint-provider.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROVIDER = "urn:ame:bare-cedar-fog-npu-inference-team";
const mode = argument("--mode", process.argv) ?? "live";
const admission = JSON.parse(readFileSync(DEFAULT_DIRECT_ENDPOINT_PROVIDER_CONFIG, "utf8")).providers.find(({ actor }) => actor === PROVIDER);
const descriptor = loadDirectEndpointProviderDescriptors(process.env).find(({ provider }) => provider === PROVIDER);
if (!admission?.typedInferenceBounds || !descriptor) throw new Error("the direct-endpoint admissions do not admit the local NPU provider with typed inference bounds");

const outputSchema = { type: "object", required: ["class", "basis"], properties: { class: { type: "string" }, basis: { type: "string" } }, additionalProperties: false };
const instruction = "Classify the supplied observed handoff as executable-provider-handoff or recorded-effect-only, and state the decisive evidence. Reply with one JSON object {class, basis}.";
const payload = {
  workType: "classification",
  context: { suppliedContext: "Observed bounded fact: Recursive Development Foundry emits DevelopmentAttemptDemand, DevelopmentDieInductionDemand, DevelopmentNodeCastingDemand, and DevelopmentSettlementInductionDemand as local JSON effect records. A bounded repository search found those demand names only in that foundry's pure compiler and tests; no provider boundary consumes them." },
  executionBounds: { maximumOutputTokens: 300 },
  outputContract: { mode: "json_schema", schema: outputSchema },
};
const input = JSON.stringify(payload);
const { maximumOutputTokens } = admitBoundedTypedInference({ instruction, input, model: descriptor.model }, admission.typedInferenceBounds);
const offer = directEndpointOffer(descriptor, { taskClass: "classification", outputContract: { identity: "urn:output-contract:npu-classification" } });
if (mode === "dry-run") {
  process.stdout.write(`${JSON.stringify({ disposition: "admitted-not-dispatched", provider: descriptor.provider, model: descriptor.model, offer: offer.id, maximumOutputTokens }, null, 2)}\n`);
} else {
  const delivered = await dispatchDirectEndpointOffer(descriptor, {
    messages: [{ role: "system", content: instruction }, { role: "user", content: input }],
    responseFormat: openAiJsonSchemaResponseFormat(outputSchema),
    execution: { maximumOutputTokens },
  }, { invoke: executeOpenAiCompatibleToolAgent });
  let candidate, schemaAssay;
  try { candidate = JSON.parse(delivered.text ?? ""); schemaAssay = schemaFrom(outputSchema).validate(candidate); } catch (error) { schemaAssay = { valid: false, issues: [{ message: error.message }] }; }
  process.stdout.write(`${JSON.stringify({
    disposition: delivered.disposition === "delivered" ? (schemaAssay.valid ? "schema-assayed-candidate-pending-customer-acceptance" : "schema-refused-candidate") : delivered.disposition,
    provider: delivered.provider, model: delivered.model, offer: offer.id,
    ...(delivered.disposition === "delivered" ? {} : { reason: delivered.reason, cause: delivered.cause }),
    consideration: offer.consideration, durationMs: delivered.durationMs,
    candidate: candidate ?? delivered.text ?? null, schemaAssay, semanticCustomerAcceptance: false,
  }, null, 2)}\n`);
}
