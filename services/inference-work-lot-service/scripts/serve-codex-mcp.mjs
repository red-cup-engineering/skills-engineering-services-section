#!/usr/bin/env node

import { createInterface } from "node:readline";
import { toJSONSchema, z } from "zod";
import {
  CODEX_MCP_INSTRUCTIONS,
  CODEX_MCP_SERVER_INFO,
  CLASSIFY_CODEX_DEMAND_INPUT_SCHEMA,
  RECORD_INFERENCE_OUTCOME_INPUT_SCHEMA,
  CONTRACT_INFERENCE_WORK_INPUT_SCHEMA,
  invokeClassifyCodexDemand,
  invokeContractInferenceWork,
  invokeRecordInferenceOutcome,
} from "../src/codex-mcp-contract.mjs";

// Keep this customer-facing membrane dependency-light. The Union's raw MCP
// transport is the canonical local exemplar; the SDK belongs to clients and
// must not be required merely to expose an Actor's tool face.
// Zod 4 exposes the conversion as a package function.  Keeping this at the
// MCP membrane makes the published tool schemas independent of schema
// instance internals and works with the service's declared Zod version.
const jsonSchema = (shape) => toJSONSchema(z.object(shape), { target: "draft-2020-12" });
const tools = Object.freeze([
  {
    name: "contract_inference_work",
    description: "Solicit customer-admitted sovereign inference providers and execute one direct typed RMN/A2A inference act.",
    inputSchema: jsonSchema(CONTRACT_INFERENCE_WORK_INPUT_SCHEMA),
  },
  {
    name: "classify_codex_demand",
    description: "Classify bounded Codex demand before inference without sending source context.",
    inputSchema: jsonSchema(CLASSIFY_CODEX_DEMAND_INPUT_SCHEMA),
  },
  {
    name: "record_inference_outcome",
    description: "Record one attributable Codex receiver acceptance or refusal after delivery.",
    inputSchema: jsonSchema(RECORD_INFERENCE_OUTCOME_INPUT_SCHEMA),
  },
]);

async function call(name, args) {
  if (name === "contract_inference_work") return invokeContractInferenceWork(args);
  if (name === "classify_codex_demand") return invokeClassifyCodexDemand(args);
  if (name === "record_inference_outcome") return invokeRecordInferenceOutcome(args);
  throw new Error(`unknown inference-work-lot operation ${name}`);
}

async function handle(request) {
  if (request.method === "initialize") {
    return {
      protocolVersion: request.params?.protocolVersion ?? "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: CODEX_MCP_SERVER_INFO,
      instructions: CODEX_MCP_INSTRUCTIONS,
    };
  }
  if (request.method === "tools/list") return { tools };
  if (request.method === "tools/call") return call(request.params?.name, request.params?.arguments ?? {});
  if (request.method === "ping") return {};
  throw new Error(`unsupported MCP method ${request.method}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
    const response = await handle(request);
    if (request.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: response })}\n`);
  } catch (error) {
    if (request?.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })}\n`);
  }
}
