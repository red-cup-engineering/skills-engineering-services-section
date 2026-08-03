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
  process.stdout.write(`${JSON.stringify({ ok: true, server: initialized.result.serverInfo })}\n`);
} finally {
  child.kill();
}
