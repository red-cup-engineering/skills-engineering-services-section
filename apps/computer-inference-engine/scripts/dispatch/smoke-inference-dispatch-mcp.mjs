#!/usr/bin/env node

import assert from "node:assert/strict";
import { createMcpClient, mcpInProcessTransport } from "@red-cup-engineering/mcp-engineering-services-section/client";
import { ACTOR_TOKENS, CONFIGURED_CUSTOMER, MCP_SERVER_INFO } from "../../src/dispatch/inference-dispatch-mcp-contract.mjs";
import { openInferenceDispatchMcp } from "../../src/dispatch/inference-dispatch-mcp.mjs";
import { outcomeSentinelForCustomer } from "../../src/dispatch/provider-admission.mjs";

/**
 * Builds one fresh MCP host and returns a JSON-RPC client bound directly to it.
 * Each live retry gets its own reservation runtime instead of reusing the prior host.
 * @returns The MCP client of that host.
 */
function startServer() {
  const host = openInferenceDispatchMcp({ environment: process.env });
  return createMcpClient({
    transport: mcpInProcessTransport(host.handle),
    clientInfo: { name: "inference-work-lot-mcp-smoke", version: "1.0.0" },
  });
}

/**
 * The schema-enforced path asks an exact enum value under
 * additionalProperties:false and requires json-schema-output so the
 * selected provider attempts genuine response_format shaping -- a strong,
 * narrow claim backed by provider-side enforcement.
 */
const SCHEMA_ENFORCED_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["classification"],
  properties: { classification: { type: "string", enum: ["evidence-limit"] } },
});
const SCHEMA_ENFORCED_DEMAND = Object.freeze({
  objective: "Classify the supplied statement and return only the required JSON object.",
  context: "Statement: A configured inference provider endpoint is not proof that one live inference lot can settle successfully.",
  workType: "classification",
  outputSchema: SCHEMA_ENFORCED_SCHEMA,
  desiredUse: "Live bounded market assay only; no repository mutation or automatic acceptance.",
});

/**
 * The customer-assay path never sets enforceProviderSchema, so no provider
 * attempts response_format shaping (see the enforceProviderSchema gate in
 * attemptDirectEndpointLane) -- the customer's own JSON Schema assay is the
 * sole gate. Its schema only requires one nonempty string field so it stays
 * realistically achievable by plain prompting alone, the honest boundary of
 * what unshaped generation can be expected to hit reliably; the exact-enum
 * claim belongs to the schema-enforced path above.
 */
const CUSTOMER_ASSAY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: { summary: { type: "string", minLength: 1 } },
});
const CUSTOMER_ASSAY_DEMAND = Object.freeze({
  objective: "Return only a JSON object with exactly one key, summary, whose value is a short string summarizing the supplied statement.",
  context: "Statement: A configured inference provider endpoint is not proof that one live inference lot can settle successfully.",
  workType: "classification",
  outputSchema: CUSTOMER_ASSAY_SCHEMA,
  desiredUse: "Live bounded market assay only; no repository mutation or automatic acceptance.",
});

/**
 * Exercises one live dispatch_inference call, retried on a fresh server
 * host each attempt, until `accepts` recognizes a delivered candidate.
 * @param {string} label - "schema-enforced" or "customer-assay", for the printed report
 * @param {object} demand - the full dispatch_inference arguments
 * @param {(candidate: unknown) => boolean} accepts - recognizes an acceptable delivered candidate
 * @param {{attempts?: number}} [options]
 * @returns {Promise<object>} the reported live evidence for this path
 */
async function exerciseLiveDispatch(label, demand, accepts, { attempts = 3 } = {}) {
  let lastFailure = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const server = startServer();
    let contracted;
    try {
      contracted = { result: await server.callTool({ name: "dispatch_inference", arguments: demand }) };
    } finally {
      await server.close();
    }
    const delivered = contracted.result?.isError === false
      && contracted.result?.structuredContent?.outcome === outcomeSentinelForCustomer(CONFIGURED_CUSTOMER, ACTOR_TOKENS)
      && accepts(contracted.result?.structuredContent?.candidate);
    if (delivered) {
      return {
        path: label,
        attempt,
        outcome: contracted.result.structuredContent.outcome,
        provider: contracted.result.structuredContent.provider,
        model: contracted.result.structuredContent.model,
        providerSchemaEnforcement: contracted.result.structuredContent.providerSchemaEnforcement ?? null,
        receipt: contracted.result.structuredContent.receipt?.id ?? null,
        candidate: contracted.result.structuredContent.candidate,
        timing: contracted.result.structuredContent.timing ?? null,
      };
    }
    lastFailure = contracted.result?.content?.[0]?.text ?? JSON.stringify(contracted.result?.structuredContent ?? contracted);
  }
  throw new Error(`${label}: no delivered candidate across ${attempts} live attempts on ${attempts} fresh MCP hosts (the customer-owned assay refuses a noncompliant candidate rather than accepting it). Last attempt: ${lastFailure}`);
}

const protocolServer = startServer();
let initialized;
try {
  initialized = { result: await protocolServer.initialize() };
  assert.deepEqual(initialized.result.serverInfo, MCP_SERVER_INFO);
  const listed = { result: await protocolServer.listTools() };
  const names = listed.result.tools.map(({ name }) => name);
  assert.deepEqual(names, ["inspect_inference_resources", "dispatch_inference", "classify_inference_demand", "record_inference_outcome"]);
  assert.deepEqual(listed.result.tools.find(({ name }) => name === "classify_inference_demand").inputSchema.properties.demandClass.enum, ["mechanical", "bounded-derivation", "premium-review"]);
  const inspected = { result: await protocolServer.callTool({ name: "inspect_inference_resources", arguments: {} }) };
  assert.equal(inspected.result.structuredContent.type, "InferenceResourceInspection");
} finally {
  await protocolServer.close();
}

let live = null;
if (process.argv.includes("--live")) {
  const schemaEnforced = await exerciseLiveDispatch(
    "schema-enforced",
    { ...SCHEMA_ENFORCED_DEMAND, requiredCapabilities: ["json-schema-output"], enforceProviderSchema: true },
    (candidate) => JSON.stringify(candidate) === JSON.stringify({ classification: "evidence-limit" }),
  );
  assert.equal(schemaEnforced.providerSchemaEnforcement?.attempted, true, "schema-enforced path must actually attempt provider-side enforcement");
  const customerAssay = await exerciseLiveDispatch(
    "customer-assay",
    CUSTOMER_ASSAY_DEMAND,
    (candidate) => typeof candidate?.summary === "string" && candidate.summary.length > 0 && Object.keys(candidate).length === 1,
  );
  assert.equal(customerAssay.providerSchemaEnforcement?.attempted, false, "customer-assay path must not require provider-side enforcement");
  live = { schemaEnforced, customerAssay };
}
process.stdout.write(`${JSON.stringify({ ok: true, server: initialized.result.serverInfo, live })}\n`);
