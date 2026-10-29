#!/usr/bin/env node
// scripts/conductor-mcp.mjs -- the MCP stdio server registered in .mcp.json. It exposes the SWARM
// carrier tool surface (src/mcp.mjs) to a Claude Code session over JSON-RPC. The transport is
// the archive's robust pattern: buffer stdin by line, drain through a serial queue so an
// in-flight `await` can't interleave two data events racing on the shared buffer.
//
//   node scripts/conductor-mcp.mjs           # live stdio MCP server
//   node scripts/conductor-mcp.mjs --demo    # exercise every verb against a temp .swarm (no network)
//
// The session office is resolved lazily on first use from env SWARM_AGENT / <root>/harness.json
// (default: programmer), so the server starts even before a .swarm exists.

import { fileURLToPath } from "node:url";

import { TOOLS, handleToolCall, createMcpContext } from "../src/mcp.mjs";

let ctx = null;
function context() {
  if (!ctx) ctx = createMcpContext({});
  return ctx;
}

async function rpc(msg) {
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  if (msg.method === "initialize") {
    return reply({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "claude-code-conductor", version: "0.1.0" },
    });
  }
  if (msg.method === "notifications/initialized") return null;
  if (msg.method === "tools/list") {
    return reply({ tools: TOOLS });
  }
  if (msg.method === "tools/call") {
    try {
      const out = await handleToolCall(msg.params?.name, msg.params?.arguments ?? {}, context());
      return reply({ content: [{ type: "text", text: JSON.stringify(out) }] });
    } catch (error) {
      return reply({ isError: true, content: [{ type: "text", text: String(error.message) }] });
    }
  }
  return null;
}

async function runDemo() {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { learnFromMessage } = await import("../src/swarm.mjs");

  const root = mkdtempSync(join(tmpdir(), "swarm-harness-demo-"));
  const demoCtx = createMcpContext({ root, env: { SWARM_AGENT: "programmer" } });

  // Seed one durable memory so inward recall has something to surface (legitimate setup).
  learnFromMessage(root, demoCtx.session.agent, "remember: the harness binds Claude Code into SWARM", "", [], {
    now: "2026-06-03T00:00:00.000Z",
    messageId: "demo-seed",
  });

  const calls = [
    ["swarm_remember", { query: "harness SWARM" }],
    ["swarm_context", { focus: "harness" }],
    ["swarm_plan", { aim: "implement the SWARM harness" }],
    ["swarm_dream", {}],
    ["swarm_work_status", {}],
    ["swarm_costs", {}],
    ["swarm_message", { agent: "coordinator", prompt: "Report SWARM work status" }],
  ];
  const out = {};
  for (const [name, args] of calls) {
    try {
      out[name] = await handleToolCall(name, args, demoCtx);
    } catch (error) {
      out[name] = { error: String(error.message) };
    }
  }
  console.log(JSON.stringify({ root, results: out }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === "--demo") {
    runDemo();
  } else {
    let buf = "";
    const queue = [];
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      while (queue.length) {
        const out = await rpc(queue.shift());
        if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
      }
      draining = false;
    };
    process.stdin.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        queue.push(msg);
      }
      drain();
    });
  }
}
