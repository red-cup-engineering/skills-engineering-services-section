import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentSenMessage, extractSenPart, parseA2aMessage, userSenMessage, discoverValidatedAgentCard } from "@red-cup-engineering/a2a-services-section/sen-part";
import { discoverSignedAgentCard } from "@red-cup-engineering/a2a-services-section/agent-card-signing";
import { extractSenActivity, projectSenActivity } from "@red-cup-engineering/activitypub-services-section/sen-activity";
import { decodeSemantic, semanticBytes, semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-engineering-services-section/semantic-content-identity";
import { serveGeminiNotebookActivityPub } from "../src/serve-activitypub.mjs";
import { signedGeminiNotebookAgentCard } from "../src/serve-activitypub.mjs";
import { startGeminiNotebookWitnessJournalFixture } from "./witness-journal-fixture.js";

const DISCOVERY = { card: { type: "test-card" }, jwks: { keys: [] } };
function activityBytes(value, objectKind = "gemini-notebook.a2a-operation") {
  return Buffer.from(identifyJsonSemanticContent({ objectKind, value, witnessRoot: EMPTY_WITNESS_ROOT }).bytes);
}
function activityValue(bytes, objectKind = "gemini-notebook.a2a-operation-result") {
  return admitJsonSemanticContent({ bytes, objectKind }).value;
}

test("a hermetic Gemini Notebook signing identity produces one discoverable signed card", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-agent-card-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const signingKeyPath = join(root, "agent-card.pkcs8.pem"), jwksPath = join(root, "jwks.json"), kid = "gemini-notebook-test-ed25519";
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(signingKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  writeFileSync(jwksPath, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "EdDSA", use: "sig" }] }));
  const origin = "https://gemini-notebook.example", documents = await signedGeminiNotebookAgentCard({ origin, signingKeyPath, jwksPath, kid });
  const fetchCard = async (url) => new Response(JSON.stringify(String(url).endsWith("/.well-known/jwks.json") ? documents.jwks : documents.card), { headers: { "content-type": "application/json" } });
  const discovered = await discoverValidatedAgentCard(origin, { requireSignature: true, discover: (baseUrl, { signal } = {}) => discoverSignedAgentCard(baseUrl, { signal, fetch: fetchCard }) });
  assert.equal(discovered.signatures.length, 1);
  assert.equal(discovered.skills.some(({ id }) => id === "code-artifact-operation"), true);
  assert.equal(discovered.supportedInterfaces[0].url, `${origin}/actors/notebooklm-inference-team/inbox`);
});

test("the cloud provider starts its durable inbox worker at service boot", async () => {
  let started = 0;
  const running = {
    provider: {
      federation: {
        startQueue(contextData) {
          assert.equal(contextData, undefined);
          started += 1;
          return Promise.resolve();
        },
      },
    },
  };
  const custody = { kv: {}, inbox: {}, queue: {} };

  const result = await serveGeminiNotebookActivityPub({
    origin: "https://gemini-notebook.example",
    custody,
    agentCardDocuments: DISCOVERY,
    serve: async (options) => {
      assert.equal(options.queue, custody.queue);
      return running;
    },
  });

  assert.equal(result, running);
  assert.equal(started, 1);
});

test("an ActivityPub SEN projection is adapted into an A2A user message", async () => {
  const origin = "https://gemini-notebook.example";
  const sender = "https://cedar.example/actors/codex";
  const recipient = `${origin}/actors/notebooklm-inference-team`;
  const operationBytes = activityBytes(["test-operation", { value: 1 }]);
  const resultBytes = activityBytes(["test-result", { value: 2 }], "gemini-notebook.a2a-operation-result");
  let onActivity;
  let delivered;
  const running = {
    provider: { federation: { startQueue: () => Promise.resolve() } },
  };
  const activity = projectSenActivity({
    type: "Offer",
    origin: "https://cedar.example",
    identifier: "codex",
    recipient,
    objectBytes: operationBytes,
    a2aMessage: userSenMessage(operationBytes),
    a2aRole: "ROLE_USER",
    agentCard: sender,
  });

  await serveGeminiNotebookActivityPub({
    origin,
    custody: { kv: {}, inbox: {}, queue: {} },
    agentCardDocuments: DISCOVERY,
    serve: async (options) => { onActivity = options.onActivity; return running; },
    fetch: async () => new Response(JSON.stringify({ inbox: `${sender}/inbox` })),
    execute: async (source) => {
      const message = parseA2aMessage(source);
      assert.deepEqual(extractSenPart(message.parts).bytes, operationBytes);
      return agentSenMessage(resultBytes);
    },
    deliver: async (provider, input) => { delivered = { provider, input }; },
  });
  await onActivity({ jsonLd: activity });

  assert.equal(delivered.provider, running.provider);
  assert.equal(delivered.input.recipient, sender);
  assert.equal(delivered.input.activity.type, "Accept");
});

test("one live code lot crosses ActivityPub, A2A, and the provider-authored code contract", async (t) => {
  const origin = "https://gemini-notebook.example", sender = "https://cedar.example/actors/codex", recipient = `${origin}/actors/notebooklm-inference-team`;
  const root = mkdtempSync(join(tmpdir(), "gemini-notebook-activitypub-code-")), sourcePath = join(root, "source.md"), statePath = join(root, "fake-state.json");
  const lifecycleRoots = [new URL("../data/ephemeral-notebook-cleanup-intents", import.meta.url).pathname, new URL("../data/ephemeral-notebook-cleanup-receipts", import.meta.url).pathname];
  const lifecycleBefore = new Map(lifecycleRoots.map((path) => [path, new Set(existsSync(path) ? readdirSync(path) : [])]));
  const witnessJournal = await startGeminiNotebookWitnessJournalFixture();
  t.after(async () => { await witnessJournal.close(); for (const path of lifecycleRoots) for (const name of existsSync(path) ? readdirSync(path) : []) if (!lifecycleBefore.get(path).has(name)) rmSync(join(path, name)); rmSync(root, { recursive: true, force: true }); });
  writeFileSync(sourcePath, "export one grounded JavaScript constant\n");
  writeFileSync(statePath, JSON.stringify({ sequence: 0, sources: [], calls: [] }));
  const prior = { PYTHONPATH: process.env.PYTHONPATH, GEMINI_NOTEBOOK_PYTHON: process.env.GEMINI_NOTEBOOK_PYTHON, FAKE_GEMINI_NOTEBOOK_STATE: process.env.FAKE_GEMINI_NOTEBOOK_STATE, WITNESS_JOURNAL_RDF_AGENT: process.env.WITNESS_JOURNAL_RDF_AGENT, GEMINI_NOTEBOOK_EXCHANGES_DIR: process.env.GEMINI_NOTEBOOK_EXCHANGES_DIR };
  process.env.PYTHONPATH = `${join(new URL("./", import.meta.url).pathname, "fake-gemini-notebook")}${prior.PYTHONPATH ? `:${prior.PYTHONPATH}` : ""}`;
  process.env.GEMINI_NOTEBOOK_PYTHON = "python3";
  process.env.FAKE_GEMINI_NOTEBOOK_STATE = statePath;
  process.env.WITNESS_JOURNAL_RDF_AGENT = witnessJournal.agentCardUrl;
  process.env.GEMINI_NOTEBOOK_EXCHANGES_DIR = join(root, "exchanges");
  t.after(() => { for (const [name, value] of Object.entries(prior)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
  const authorization = { type: "ResourceBudgetAuthorization", id: "urn:resource-budget:gemini-notebook-code-fixture", provider: "urn:ame:notebooklm-inference-team", status: "authorized", fixedFee: null, markup: "0", monetaryConversion: "none-without-an-observed-cost-oracle", meters: ["gemini-notebook-provider-calls", "source-bytes-egressed", "provider-wall-time", "studio-quota-consumed"] };
  const request = { type: "GeminiNotebookA2ACodeArtifactOperation", customer: "urn:ame:bare-cedar-fog-codex", operationId: `ni:///sha-256;${"9".repeat(42)}A`, sources: [{ path: sourcePath, digest: sha256Digest(readFileSync(sourcePath)) }], prompt: "Implement the grounded constant.", executionMode: "live", resourceBudgetAuthorization: authorization };
  request.providerRequestDigest = semanticId({ customer: request.customer, sources: request.sources, prompt: request.prompt, executionMode: request.executionMode, corpusMode: "ephemeral-upload", artifactType: "code", resourceBudgetAuthorization: authorization });
  const bytes = activityBytes(["gemini-notebook-code-artifact-operation", request]), message = userSenMessage(bytes), activity = projectSenActivity({ type: "Offer", origin: "https://cedar.example", identifier: "codex", recipient, objectBytes: bytes, a2aMessage: message, a2aRole: "ROLE_USER", agentCard: sender });
  let onActivity, delivered; const running = { provider: { federation: { startQueue: () => Promise.resolve() } } };
  await serveGeminiNotebookActivityPub({ origin, custody: { kv: {}, inbox: {}, queue: {} }, agentCardDocuments: DISCOVERY, serve: async (options) => { onActivity = options.onActivity; return running; }, fetch: async () => new Response(JSON.stringify({ inbox: `${sender}/inbox` })), deliver: async (_provider, input) => { delivered = input; }, executorOptions: { now: "2096-07-17T12:00:00.000Z", testOnlyWitness: async () => ({}) } });
  await onActivity({ jsonLd: activity });
  const projection = extractSenActivity(delivered.activity, { expectedActor: recipient, expectedRecipient: sender }), result = activityValue(extractSenPart(parseA2aMessage(projection.a2aMessage).parts).bytes);
  assert.equal(result[0], "gemini-notebook-operation-result");
  assert.equal(result[1].disposition, "completed", JSON.stringify(result[1]));
  assert.equal(result[1].codeBundle.format, "json-code-bundle");
  assert.equal(result[1].codeBundle.files[0].content, "export const grounded = true;\n");
  assert.match(result[1].codeEvidence.bundleDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(result[1].codeEvidence.files[0].digest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(result[1].externalEffects, ["external-network", "source-egress"]);
  assert.equal(result[1].consideration.fixedFee, null);
});
