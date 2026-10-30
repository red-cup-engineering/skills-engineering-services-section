import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("the cycle CLI accepts an ordinary session move and derives its identity", () => {
  const input = JSON.stringify({
    leaderMove: {
      id: "leader-move-session-start",
      desiredOutcome: "Repair the startup preflight",
      source: "Leader session message",
      customer: "urn:leader:emsenn",
    },
    authorityReceipt: "authority-pending-observation",
    initialKnowledge: ["file-sha256:abc:AGENTS.md"],
  });
  const run = spawnSync(process.execPath, [join(root, "scripts/project-codex-mape-cycle.mjs")], { input, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const cycle = JSON.parse(run.stdout);
  assert.match(cycle.move, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.equal(cycle.authorityReceipt, null);
  assert.equal(cycle.authorityReference, "authority-pending-observation");
  assert.match(cycle.initialKnowledge[0], /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
});

test("the MAPE MCP boundary advertises and accepts descriptive startup references", () => {
  const initialize = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mape-office-test", version: "1.0.0" } },
  });
  const initialized = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "compile_codex_mape_cycle",
      arguments: {
        leaderMove: { id: "session-start", desiredOutcome: "Repair startup", source: "Leader session" },
        authorityReceipt: "authority-pending-observation",
        initialKnowledge: ["file-sha256:abc:AGENTS.md"],
      },
    },
  });
  const run = spawnSync(process.execPath, [join(root, "src/mape-office-mcp.mjs")], { input: `${initialize}\n${initialized}\n${request}\n`, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const responses = run.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(responses[0].result.serverInfo.name, "bare-cedar-fog-codex-mape-office");
  const response = responses[1];
  assert.equal(response.error, undefined);
  const cycle = response.result.structuredContent;
  assert.match(cycle.move, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.equal(cycle.authorityReceipt, null);
  assert.equal(cycle.authorityReference, "authority-pending-observation");
});
