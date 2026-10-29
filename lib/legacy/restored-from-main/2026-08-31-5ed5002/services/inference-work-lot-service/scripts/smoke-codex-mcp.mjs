#!/usr/bin/env node

import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CODEX_MCP_SERVER_INFO } from "../src/codex-mcp-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [resolve(root, "scripts/serve-codex-mcp.mjs")], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
let nextId = 1;
const pending = new Map();
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const resolvePending = pending.get(message.id);
  if (resolvePending) { pending.delete(message.id); resolvePending(message); }
});
function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolvePending) => { pending.set(id, resolvePending); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); });
}
try {
  const initialized = await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "inference-work-lot-mcp-smoke", version: "1.0.0" } });
  assert.deepEqual(initialized.result.serverInfo, CODEX_MCP_SERVER_INFO);
  const listed = await request("tools/list");
  const names = listed.result.tools.map(({ name }) => name);
  assert.deepEqual(names, ["contract_inference_work", "classify_codex_demand", "record_inference_outcome"]);
  assert.deepEqual(listed.result.tools[1].inputSchema.properties.demandClass.enum, ["mechanical", "bounded-derivation", "premium-review"]);
  let live = null;
  if (process.argv.includes("--live")) {
    const contracted = await request("tools/call", {
      name: "contract_inference_work",
      arguments: {
        objective: "Classify the supplied statement and return only the required JSON object.",
        context: "Statement: A configured inference provider endpoint is not proof that one live inference lot can settle successfully.",
        workType: "classification",
        requiredCapabilities: ["json-schema-output"],
        enforceProviderSchema: true,
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["classification"],
          properties: { classification: { const: "evidence-limit" } },
        },
        desiredUse: "Live bounded market assay only; no repository mutation or automatic acceptance.",
      },
    });
    assert.equal(contracted.result?.isError, false, contracted.result?.content?.[0]?.text ?? "live market invocation failed");
    assert.equal(contracted.result?.structuredContent?.outcome, "candidate-pending-codex-acceptance");
    assert.deepEqual(contracted.result?.structuredContent?.candidate, { classification: "evidence-limit" });
    live = {
      outcome: contracted.result.structuredContent.outcome,
      provider: contracted.result.structuredContent.provider,
      model: contracted.result.structuredContent.model,
      receipt: contracted.result.structuredContent.receipt?.id ?? null,
      candidate: contracted.result.structuredContent.candidate,
    };
  }
  process.stdout.write(`${JSON.stringify({ ok: true, server: initialized.result.serverInfo, live })}\n`);
} finally {
  child.kill();
}
