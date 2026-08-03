import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { assay, semanticBytes, semanticId } from "@red-cup-engineering/relation-model-notation-runtime";
import { circuitInterfaceFromAgentCard } from "@red-cup-engineering/relation-model-notation-runtime/hierarchical-circuit";
import { ACCOUNT, ACTOR, OPERATION_TYPE, createServer, executeSettledContract } from "../src/tollbooth.mjs";
import { makeNiUri } from "@red-cup-engineering/ni-uri-services-section";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// Locate each contracted service's package root through node module
// resolution (its exported face's package.json), never by relative
// traversal across a package boundary.
const packageRoot = (specifier) => dirname(require.resolve(`${specifier}/package.json`));
const PROVIDER_ROOT = resolve(ROOT, "../gemini-inference-team");
const RMN_ROOT = packageRoot("@red-cup-engineering/relation-model-notation-conformance");
const WITNESS_JOURNAL_ROOT = packageRoot("@red-cup-engineering/witness-journal-rdf-projection-service");
const WIT_ROOT = packageRoot("@lenticule-science/wit-transition-assay");
const CONTEXT = "https://www.w3.org/ns/activitystreams";
const PROVIDER_CARD = resolve(PROVIDER_ROOT, "content/agent-cards/gemini-inference-team.json");
const PROVIDER_INTERFACE = circuitInterfaceFromAgentCard(JSON.parse(readFileSync(PROVIDER_CARD, "utf8")));
const PROVIDER_OPERATION_TYPE = ["product", ["mark"], ["product", ["mark"], ["product", ["mark"], ["mark"]]]];
const ni = (value) => makeNiUri(Buffer.from(value, "utf8"));
const TEST_ENV = { X402_NETWORK: "eip155:84532", X402_PAY_TO: ACCOUNT.split(":").at(-1), X402_FACILITATOR: "https://facilitator.invalid", X402_PRICE: "$0.001", WITNESS_JOURNAL_RDF_AGENT: "http://127.0.0.1:1/.well-known/agent-card.json", PORT: "0" };

async function freePort() { const server = createNetServer(); await new Promise((ok) => server.listen(0, "127.0.0.1", ok)); const port = server.address().port; await new Promise((ok) => server.close(ok)); return port; }
async function startA2a({ port, baseUrl, env, card, executor }) {
  const service = resolve(ROOT, "../../../../../web-services-section/services/a2a-services-section/services/a2a-contracted-agent-service");
  const server = spawn(process.execPath, [resolve(service, "src/serve-contracted-agent.mjs"), "--port", String(port), "--host", "127.0.0.1", "--base-url", baseUrl,
    "--agent-card", card, "--executor", process.execPath,
    "--executor-arg", executor, "--timeout-ms", "10000"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; server.stderr.setEncoding("utf8"); server.stderr.on("data", (chunk) => { stderr += chunk; });
  await new Promise((ok, fail) => { let stdout = ""; const timer = setTimeout(() => fail(new Error(`A2A server did not start: ${stderr}`)), 10_000); server.stdout.setEncoding("utf8"); server.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.includes("\n")) { clearTimeout(timer); ok(); } }); server.once("exit", (code) => { clearTimeout(timer); fail(new Error(`A2A server exited ${code}: ${stderr}`)); }); });
  return server;
}
function conform(term, expectedType) {
  const result = assay({ term, expectedType, fuel: 0 });
  return { term: semanticId(result.normalizedTerm), canonicalBytesBase64: semanticBytes(result.normalizedTerm).toString("base64") };
}
function effect({ law, caller, provider, operation, label }) { return { ...(law !== undefined ? { law } : {}), caller, provider, precondition: ni(`${label}-pre`), operation, postcondition: ni(`${label}-post`), refusal: ni(`${label}-refusal`), evidenceRoot: ni(`${label}-bottom`), outcome: { positiveEvidence: false, negativeEvidence: false }, measures: [], parent: null }; }
function makeContract(providerAgentCard = "http://127.0.0.1:1/.well-known/agent-card.json") {
  const providerOperation = ["pair", ["mark", "Answer briefly."], ["pair", ["mark", "What is two plus two?"], ["pair", ["mark", "general-text"], ["mark", "dry-run"]]]];
  const providerOp = conform(providerOperation, PROVIDER_OPERATION_TYPE);
  const providerCell = effect({ law: PROVIDER_INTERFACE.component.law, caller: ACCOUNT, provider: PROVIDER_INTERFACE.account, operation: providerOp.term, label: "provider" });
  const provider = conform(["pair", ["effect", providerCell], providerOperation], ["product", ["effect"], PROVIDER_OPERATION_TYPE]);
  const caller = "eip155:31337:0x0000000000000000000000000000000000000001";
  const cell = effect({ caller, provider: ACCOUNT, operation: provider.term, label: "toll" });
  const outer = conform(["pair", ["effect", cell], ["pair", ["effect", providerCell], providerOperation]], ["product", ["effect"], OPERATION_TYPE]);
  return { "@context": CONTEXT, id: `urn:test:${randomUUID()}`, type: "Accept", actor: "urn:test:customer", target: ACTOR, object: { type: "ServiceContract", callerAccount: caller, providerAgentCard, proposal: { type: "Document", id: outer.term, mediaType: "application/rmn+cbor", content: outer.canonicalBytesBase64 } } };
}

const facilitator = { async getSupported() { return { kinds: [{ x402Version: 2, scheme: "exact", network: TEST_ENV.X402_NETWORK }], extensions: [], signers: {} }; }, async verify() { throw new Error("unpaid test must not verify"); }, async settle() { throw new Error("unpaid test must not settle"); } };

test("pre-payment boundary refuses malformed input and emits official x402 v2 for valid input", async () => {
  const { app } = createServer(TEST_ENV, { facilitatorClient: facilitator });
  const server = app.listen(0, "127.0.0.1"); await new Promise((ok) => server.once("listening", ok));
  await new Promise((ok) => setTimeout(ok, 25));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/inference`, { method: "POST", headers: { "content-type": "application/activity+json" }, body: JSON.stringify(makeContract()) });
    if (response.status !== 402) throw new Error(`expected x402 challenge, received ${response.status}: ${await response.text()}`); const header = response.headers.get("payment-required"); assert.ok(header);
    const challenge = JSON.parse(Buffer.from(header, "base64").toString("utf8")); const option = challenge.accepts[0];
    assert.equal(challenge.x402Version, 2); assert.equal(option.scheme, "exact"); assert.equal(option.network, TEST_ENV.X402_NETWORK); assert.equal(option.payTo.toLowerCase(), TEST_ENV.X402_PAY_TO);
    assert.equal(challenge.extensions.bazaar.info.input.method, "POST");
    const status = await fetch(`http://127.0.0.1:${server.address().port}/status`);
    assert.equal(status.status, 200);
    await response.arrayBuffer();
    const malformed = await fetch(`http://127.0.0.1:${server.address().port}/inference`, { method: "POST", headers: { "content-type": "application/activity+json" }, body: "{}" });
    assert.equal(malformed.status, 422); assert.equal((await malformed.json()).type, "Reject");
  }
  finally { await new Promise((ok) => server.close(ok)); }
});

test("settled handler composes tollbooth RMN directly to the selected signed provider A2A task", async () => {
  const signingData = mkdtempSync(join(tmpdir(), "toll-signing-")), providerData = mkdtempSync(join(tmpdir(), "toll-provider-"));
  const rmnPort = await freePort(), witnessJournalPort = await freePort(), witPort = await freePort(), providerPort = await freePort();
  const rmnBaseUrl = `http://127.0.0.1:${rmnPort}`, witnessJournalBaseUrl = `http://127.0.0.1:${witnessJournalPort}`, witBaseUrl = `http://127.0.0.1:${witPort}`, providerBaseUrl = `http://127.0.0.1:${providerPort}`;
  const prior = { AGENT_CARD_SIGNING_KEY: process.env.AGENT_CARD_SIGNING_KEY, AGENT_CARD_JWKS: process.env.AGENT_CARD_JWKS, AGENT_CARD_SIGNING_KID: process.env.AGENT_CARD_SIGNING_KID, RMN_CONFORMANCE_AGENT: process.env.RMN_CONFORMANCE_AGENT, WITNESS_JOURNAL_RDF_AGENT: process.env.WITNESS_JOURNAL_RDF_AGENT, WIT_TRANSITION_ASSAY_AGENT: process.env.WIT_TRANSITION_ASSAY_AGENT, GEMINI_WITNESS_JOURNAL_ROOT: process.env.GEMINI_WITNESS_JOURNAL_ROOT };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519"), signingKey = resolve(signingData, "agent-card-signing-key.pem"), signingJwks = resolve(signingData, "agent-card-jwks.json"), signingKid = "tollbooth-integration-test-ed25519";
  writeFileSync(signingKey, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 }); writeFileSync(signingJwks, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: signingKid, alg: "EdDSA", use: "sig" }] }));
  Object.assign(process.env, { AGENT_CARD_SIGNING_KEY: signingKey, AGENT_CARD_JWKS: signingJwks, AGENT_CARD_SIGNING_KID: signingKid, RMN_CONFORMANCE_AGENT: `${rmnBaseUrl}/.well-known/agent-card.json`, WITNESS_JOURNAL_RDF_AGENT: `${witnessJournalBaseUrl}/.well-known/agent-card.json`, WIT_TRANSITION_ASSAY_AGENT: `${witBaseUrl}/.well-known/agent-card.json`, GEMINI_WITNESS_JOURNAL_ROOT: providerData });
  const service = resolve(ROOT, "../../../../../web-services-section/services/a2a-services-section/services/a2a-contracted-agent-service");
  const rmnServer = await startA2a({ port: rmnPort, baseUrl: rmnBaseUrl, env: process.env,
    card: resolve(RMN_ROOT, "content/agent-cards/rmn-semantic-conformance.json"), executor: resolve(RMN_ROOT, "scripts/execute-a2a-task.mjs") });
  const witnessJournalServer = await startA2a({ port: witnessJournalPort, baseUrl: witnessJournalBaseUrl, env: process.env,
    card: resolve(WITNESS_JOURNAL_ROOT, "content/agent-cards/witness-journal-rdf.json"), executor: resolve(WITNESS_JOURNAL_ROOT, "scripts/execute-a2a-task.mjs") });
  const witServer = await startA2a({ port: witPort, baseUrl: witBaseUrl, env: process.env,
    card: resolve(WIT_ROOT, "content/agent-cards/wit-transition-assay.json"), executor: resolve(WIT_ROOT, "scripts/execute-a2a-task.mjs") });
  const providerServer = await startA2a({ port: providerPort, baseUrl: providerBaseUrl, env: process.env,
    card: PROVIDER_CARD, executor: resolve(ROOT, "test/fixtures/deterministic-provider-executor.mjs") });
  try { const result = await executeSettledContract(makeContract(`${providerBaseUrl}/.well-known/agent-card.json`)); assert.equal(result.type, "Accept"); assert.equal(result.object.disposition, "completion"); assert.equal(result.object.inference.candidate, "ready"); assert.equal(result.object.inference.provider, PROVIDER_INTERFACE.account); assert.match(result.object.witness, /^ni:\/\/\/sha-256;/u); }
  finally { for (const server of [providerServer, witServer, witnessJournalServer, rmnServer]) { server.kill("SIGTERM"); await new Promise((ok) => server.once("exit", ok)); } for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
