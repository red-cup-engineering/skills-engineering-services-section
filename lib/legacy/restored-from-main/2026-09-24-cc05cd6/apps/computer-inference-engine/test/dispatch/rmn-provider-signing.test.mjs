import assert from "node:assert/strict";
import test from "node:test";
import { discoverSignedAgentCard } from "@red-cup-engineering/a2a-services-section/agent-card-signing";

test("RMN provider discovery refuses an unsigned standard Agent Card", async () => {
  const source = { name: "unsigned-rmn", description: "test", version: "1", protocolVersion: "1.0", supportedInterfaces: [{ url: "https://rmn.example/a2a/jsonrpc", protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant: "" }], capabilities: {}, skills: [], securitySchemes: {}, securityRequirements: [], signatures: [] };
  const fetch = async () => new Response(JSON.stringify(source), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(discoverSignedAgentCard("https://rmn.example", { fetch }), /exactly one valid JWS signature/u);
});

test("dispatch uses the installed conformance service for typed remote normalization", { timeout: 20000 }, async () => {
  const { startSenProviderProcess } = await import("@red-cup-engineering/relation-model-notation-conformance/test-provider");
  const { conformTerm } = await import("@red-cup-engineering/relation-model-notation-conformance/client");
  const provider = await startSenProviderProcess();
  try {
    const result = await conformTerm({ agentUrl: provider.agentCardUrl, term: ["mark", "dispatch evidence"], expectedType: ["base"] });
    assert.deepEqual(result.normalForm, ["mark", "dispatch evidence"]);
    assert.deepEqual(result.expectedType, ["base"]);
    assert.match(result.term, /^ni:\/\/\/sha-256;/u);
  } finally {
    await provider.close();
  }
});
