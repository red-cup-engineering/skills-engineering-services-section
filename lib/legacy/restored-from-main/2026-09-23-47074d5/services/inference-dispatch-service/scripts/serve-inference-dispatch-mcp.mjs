#!/usr/bin/env node

import process from "node:process";
import { createMcpServer } from "@red-cup-engineering/mcp-engineering-services-section/mcp-json-rpc";
import {
  MCP_INSTRUCTIONS,
  MCP_SERVER_INFO,
  CLASSIFY_INFERENCE_DEMAND_INPUT_SCHEMA,
  RECORD_INFERENCE_OUTCOME_INPUT_SCHEMA,
  DISPATCH_INFERENCE_INPUT_SCHEMA,
  invokeClassifyInferenceDemand,
  invokeDispatchInference,
  invokeRecordInferenceOutcome,
  INSPECT_INFERENCE_RESOURCES_INPUT_SCHEMA,
  invokeInspectInferenceResources,
  configuredInferenceCashControl,
} from "../src/inference-dispatch-mcp-contract.mjs";
import { createInferenceResourceReservationRuntime } from "../src/resource-reservation-runtime.mjs";

// Dependency-light on purpose: no MCP SDK, just the raw transport.
// One server for every harness; actor comes from process env INFERENCE_WORK_CUSTOMER (provider-admission.mjs).
// Tool names are shared vocabulary -- never rename per actor. Codex's own harness config still lists the pre-rename names; that config is updated separately.
const resourceReservations = createInferenceResourceReservationRuntime();
const cashControl = configuredInferenceCashControl();
const tools = Object.freeze([
  {
    name: "inspect_inference_resources",
    description: "Inspect configured models, exact resource and consideration dimensions, zero-cash eligibility, and remaining account reservations without invoking inference. Endpoint reachability remains unobserved.",
    inputSchema: INSPECT_INFERENCE_RESOURCES_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "dispatch_inference",
    description: "Solicit customer-admitted sovereign inference providers and execute one direct typed RMN/A2A inference act.",
    inputSchema: DISPATCH_INFERENCE_INPUT_SCHEMA,
  },
  {
    name: "classify_inference_demand",
    description: "Classify bounded demand before inference without sending source context.",
    inputSchema: CLASSIFY_INFERENCE_DEMAND_INPUT_SCHEMA,
  },
  {
    name: "record_inference_outcome",
    description: "Record one attributable receiver acceptance or refusal after delivery.",
    inputSchema: RECORD_INFERENCE_OUTCOME_INPUT_SCHEMA,
  },
]);

async function call(name, args) {
  if (name === "inspect_inference_resources") return invokeInspectInferenceResources(args, { resourceReservations });
  if (name === "dispatch_inference") return invokeDispatchInference(args, { resourceReservations, ...(cashControl ? { cashControl } : {}) });
  if (name === "classify_inference_demand") return invokeClassifyInferenceDemand(args);
  if (name === "record_inference_outcome") return invokeRecordInferenceOutcome(args);
  throw new Error(`unknown inference-dispatch operation ${name}`);
}

const server = createMcpServer({
  name: MCP_SERVER_INFO.name,
  version: MCP_SERVER_INFO.version,
  instructions: MCP_INSTRUCTIONS,
  tools: tools.map((tool) => ({ ...tool, handler: (args) => call(tool.name, args) })),
});
await server.serveStdio({ input: process.stdin, output: process.stdout });
