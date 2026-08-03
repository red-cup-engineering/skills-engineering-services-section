import assert from "node:assert/strict";
import test from "node:test";
import { discoverAgentCard } from "../src/agent-card-discovery.mjs";

test("RMN provider discovery refuses an unsigned standard Agent Card", async () => {
  const source = { name: "unsigned-rmn", description: "test", version: "1", protocolVersion: "1.0", supportedInterfaces: [{ url: "https://rmn.example/a2a/jsonrpc", protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant: "" }], capabilities: {}, skills: [], securitySchemes: {}, securityRequirements: [], signatures: [] };
  const fetch = async () => new Response(JSON.stringify(source), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(discoverAgentCard({ agentUrl: "https://rmn.example/.well-known/agent-card.json", requireSignature: true, fetch }), /no signature/u);
});
