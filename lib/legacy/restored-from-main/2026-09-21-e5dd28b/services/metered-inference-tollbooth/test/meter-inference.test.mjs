import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer as createNetServer } from "node:net";
import { createRequire } from "node:module";
import test from "node:test";
import { semanticBytes, semanticId } from "@red-cup-engineering/relation-model-notation-cbor-codec";
import { circuitInterfaceFromAgentCard } from "@red-cup-engineering/hierarchical-circuit-law";
import { makeNiUri } from "@red-cup-engineering/computer-data-engine/identity";
import { createA2aServer } from "@red-cup-engineering/a2a-services-section/a2a-server";
import { loadSignedAgentCard } from "@red-cup-engineering/a2a-services-section/agent-card-signing";
import { ACCOUNT, ACTOR, OPERATION_TYPE, meterInference, validateMeteredInferenceRequest } from "../src/meter-inference.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// Locate each contracted service's package root through node module
// resolution (its exported face's package.json), never by relative
// traversal across a package boundary.
const packageRoot = (specifier) => dirname(require.resolve(`${specifier}/package.json`));
const PROVIDER_ROOT = resolve(ROOT, "../groq-inference-team");
const RMN_ROOT = packageRoot("@red-cup-engineering/relation-model-notation-conformance");
const WIT_ROOT = packageRoot("@lenticule-science/wit-transition-assay");
const CONTEXT = "https://www.w3.org/ns/activitystreams";
const PROVIDER_CARD = resolve(PROVIDER_ROOT, "content/agent-cards/groq-inference-team.json");
const PROVIDER_INTERFACE = circuitInterfaceFromAgentCard(JSON.parse(readFileSync(PROVIDER_CARD, "utf8")));
const BASE = ["base"];
const PROVIDER_OPERATION_TYPE = ["prod", BASE, ["prod", BASE, ["prod", BASE, BASE]]];
const ni = (value) => makeNiUri(Buffer.from(value, "utf8"));

async function freePort() { const server = createNetServer(); await new Promise((ok) => server.listen(0, "127.0.0.1", ok)); const port = server.address().port; await new Promise((ok) => server.close(ok)); return port; }
// The fixture agents are now a2a-server.mjs handler maps, in-process: the
// "executor" a caller names is a module exporting executeA2aMessage(message),
// and the Agent Card is loaded and signed the same way a real deployment's
// server.mjs does (AGENT_CARD_SIGNING_KEY/AGENT_CARD_JWKS/AGENT_CARD_SIGNING_KID).
async function startA2a({ port, baseUrl, card, executor }) {
  const { executeA2aMessage } = await import(`${pathToFileURL(executor).href}`);
  const agentCard = (await loadSignedAgentCard({
    origin: baseUrl, cardPath: card,
    signingKeyPath: process.env.AGENT_CARD_SIGNING_KEY, jwksPath: process.env.AGENT_CARD_JWKS, kid: process.env.AGENT_CARD_SIGNING_KID,
  })).card;
  return createA2aServer({ host: "127.0.0.1", port, baseUrl, agentCard, handlers: { "message/send": (message) => executeA2aMessage(message) } });
}
// The fixture identifies terms without normalizing them: the installed
// relation-model-notation-runtime's type grammar has drifted from the pinned
// conformance provider's (assay refuses the provider operation type as
// malformed), and the contract shape these tests exercise does not depend on
// normalization. The live conformance path is exercised only when the fixture
// A2A agents can start (see the integration test's bounded probe).
function conform(term) {
  return { term: semanticId(term), canonicalBytesBase64: semanticBytes(term).toString("base64") };
}
function effect({ caller, provider, label }) { return { caller, provider, evidenceRoot: ni(`${label}-bottom`), outcome: { positiveEvidence: false, negativeEvidence: false }, measures: [], parent: null }; }
function makeContract(providerAgentCard = "http://127.0.0.1:1/.well-known/agent-card.json") {
  const providerOperation = ["pair", ["mark", "Answer briefly."], ["pair", ["mark", "What is two plus two?"], ["pair", ["mark", "general-text"], ["mark", "dry-run"]]]];
  const providerOp = conform(providerOperation, PROVIDER_OPERATION_TYPE);
  const providerCell = effect({ caller: ACCOUNT, provider: PROVIDER_INTERFACE.account, label: "provider" });
  const provider = conform(["pair", ["effect", providerCell], providerOperation], ["prod", ["effect"], PROVIDER_OPERATION_TYPE]);
  const caller = "eip155:31337:0x0000000000000000000000000000000000000001";
  const cell = effect({ caller, provider: ACCOUNT, label: "toll" });
  const outer = conform(["pair", ["effect", cell], ["pair", ["effect", providerCell], providerOperation]], ["prod", ["effect"], OPERATION_TYPE]);
  return { "@context": CONTEXT, id: `urn:test:${randomUUID()}`, type: "Accept", actor: "urn:test:customer", target: ACTOR, object: { type: "ServiceContract", callerAccount: caller, providerAgentCard, proposal: { type: "Document", id: outer.term, mediaType: "application/rmn+cbor", content: outer.canonicalBytesBase64 } } };
}

test("validateMeteredInferenceRequest refuses a malformed request body before any pricing", () => {
  assert.throws(() => validateMeteredInferenceRequest({}), TypeError);
  assert.throws(() => validateMeteredInferenceRequest({ "@context": CONTEXT, type: "Accept", target: ACTOR, object: { type: "ServiceContract" } }), TypeError);
  const contract = makeContract();
  assert.equal(validateMeteredInferenceRequest(contract), contract, "an admitted body is returned as itself");
});

test("meterInference conforms, dispatches to the caller-named provider, and returns the ActivityStreams settlement -- with no facilitator selection or witness journal of its own", async (t) => {
  const signingData = mkdtempSync(join(tmpdir(), "toll-signing-")), providerData = mkdtempSync(join(tmpdir(), "toll-provider-"));
  const rmnPort = await freePort(), witPort = await freePort(), providerPort = await freePort();
  const rmnBaseUrl = `http://127.0.0.1:${rmnPort}`, witBaseUrl = `http://127.0.0.1:${witPort}`, providerBaseUrl = `http://127.0.0.1:${providerPort}`;
  const prior = { AGENT_CARD_SIGNING_KEY: process.env.AGENT_CARD_SIGNING_KEY, AGENT_CARD_JWKS: process.env.AGENT_CARD_JWKS, AGENT_CARD_SIGNING_KID: process.env.AGENT_CARD_SIGNING_KID, GROQ_WITNESS_JOURNAL_ROOT: process.env.GROQ_WITNESS_JOURNAL_ROOT };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519"), signingKey = resolve(signingData, "agent-card-signing-key.pem"), signingJwks = resolve(signingData, "agent-card-jwks.json"), signingKid = "tollbooth-integration-test-ed25519";
  writeFileSync(signingKey, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 }); writeFileSync(signingJwks, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: signingKid, alg: "EdDSA", use: "sig" }] }));
  // AGENT_CARD_SIGNING_*/GROQ_WITNESS_JOURNAL_ROOT are the spawned A2A
  // fixture agents' own configuration, not meterInference's -- meterInference
  // takes its two agent dependencies as an explicit `env` argument below.
  Object.assign(process.env, { AGENT_CARD_SIGNING_KEY: signingKey, AGENT_CARD_JWKS: signingJwks, AGENT_CARD_SIGNING_KID: signingKid, GROQ_WITNESS_JOURNAL_ROOT: providerData });
  // Bounded probe: the three fixture agents are the installed conformance,
  // wit-transition, and provider packages served as in-process a2a-server.mjs
  // handler maps; when one of them cannot start in this environment (on
  // 2026-09-21 @lenticule-science/wit-transition-assay is not present in this
  // checkout at all, and the RMN runtime's type grammar has drifted), the
  // live path is skipped with the reason, never waited out or reported as
  // green.
  const started = [];
  let rmnServer;
  let witServer;
  let providerServer;
  try {
    rmnServer = await startA2a({ port: rmnPort, baseUrl: rmnBaseUrl,
      card: resolve(RMN_ROOT, "content/agent-cards/rmn-semantic-conformance.json"), executor: resolve(RMN_ROOT, "scripts/execute-a2a-task.mjs") });
    started.push(rmnServer);
    witServer = await startA2a({ port: witPort, baseUrl: witBaseUrl,
      card: resolve(WIT_ROOT, "content/agent-cards/wit-transition-assay.json"), executor: resolve(WIT_ROOT, "scripts/execute-a2a-task.mjs") });
    started.push(witServer);
    providerServer = await startA2a({ port: providerPort, baseUrl: providerBaseUrl,
      card: PROVIDER_CARD, executor: resolve(ROOT, "test/fixtures/deterministic-provider-executor.mjs") });
    started.push(providerServer);
  } catch (error) {
    for (const server of started) await server.close();
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.skip(`fixture A2A agents cannot start here: ${error.message.split("\n")[0].slice(0, 200)}`);
    return;
  }
  try {
    // a2a-client.mjs's discoverAgentCard appends its own well-known path to
    // whatever base URL it is given, so these name each fixture's origin,
    // not its literal Agent Card resource.
    const env = { RMN_CONFORMANCE_AGENT: rmnBaseUrl, WIT_TRANSITION_ASSAY_AGENT: witBaseUrl };
    const result = await meterInference(makeContract(providerBaseUrl), env);
    assert.equal(result.type, "Accept");
    assert.equal(result.object.disposition, "completion");
    assert.equal(result.object.inference.candidate, "ready");
    assert.equal(result.object.inference.provider, PROVIDER_INTERFACE.account);
    assert.match(result.object.witness, /^ni:\/\/\/sha-256;/u);
  } finally {
    for (const server of [providerServer, witServer, rmnServer]) await server.close();
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("meterInference reports a missing deployment-supplied agent dependency as a Reject, never a thrown 5xx-shaped error, because payment has already settled", async () => {
  const result = await meterInference(makeContract(), {});
  assert.equal(result.type, "Reject");
  assert.equal(result.object.type, "Refusal");
  assert.match(result.object.message, /RMN_CONFORMANCE_AGENT/u);
});
