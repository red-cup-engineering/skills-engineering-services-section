import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { semanticId } from "@emsenn/rmn-semantic-conformance";
import { startRwilProviderProcess } from "@emsenn/rwil-rdf-services/test-provider";
import { relationalRwilDocument } from "@emsenn/rwil-rdf-services/client";
import { CONTRACT } from "../src/law.mjs";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTEXT = "https://www.w3.org/ns/activitystreams";
const PROVIDER = "urn:ame:claude-code-inference-team";
const LMT = "urn:ame:leader-movement-team";
const NOW = "2096-07-17T12:00:00.000Z";
let base; let root; let endpoint; let rwil;

function digest(value) { return semanticId(relationalRwilDocument(value)); }
function leader(content, request) {
  return { "@context": CONTEXT, id: digest({ content, ...(request === undefined ? {} : { request }) }), type: "Create", actor: "urn:leader:emsenn", target: LMT, object: { type: "Note", content, ...(request ? { attachment: request } : {}) } };
}
function solicit(sourceActivity) {
  return { "@context": CONTEXT, id: `urn:solicitation:${sourceActivity.id}`, type: "Offer", actor: LMT, target: PROVIDER, object: { type: "ServiceSolicitation", demand: "urn:demand:test", sourceActivity } };
}
function run(operation, activity) {
  const inputPath = join(base, "contract-request.json");
  const outputPath = join(base, "contract-response.json");
  writeFileSync(inputPath, `${JSON.stringify(activity)}\n`, "utf8");
  rmSync(outputPath, { force: true });
  const result = spawnSync(process.execPath, [endpoint, "--operation", operation, "--now", NOW, "--input-file", inputPath, "--output-file", outputPath], { cwd: root, encoding: "utf8", timeout: 90_000, env: { ...process.env, RWIL_RDF_AGENT: rwil.agentCardUrl } });
  let output; try { output = JSON.parse(readFileSync(outputPath, "utf8")); } catch { output = undefined; }
  return { ...result, output };
}
function accept(offer, allowedActions = ["invoke-service"]) {
  const capability = { id: `urn:cap:${offer.id}`, type: "Capability", issuer: LMT, holder: PROVIDER, invocationTarget: PROVIDER, parentOffer: offer.id, allowedActions, attenuation: { sourceActivity: offer.object.sourceActivity, requestDigest: offer.object.requestDigest, effects: offer.object.effects, providerScope: offer.object.scope, customerTerritoryMutation: false }, capTP: { target: PROVIDER, method: "invoke-service" } };
  return { "@context": CONTEXT, id: `urn:accept:${offer.id}`, type: "Accept", actor: LMT, target: PROVIDER, inReplyTo: offer.id, object: { type: "ServiceContract", contract: CONTRACT, demand: "urn:demand:test", offer, capability } };
}

test.before(async () => { rwil = await startRwilProviderProcess(); });
test.after(async () => { await rwil.close(); });
test.beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "claude-code-provider-contract-"));
  root = join(base, "claude-code-inference-team");
  cpSync(SOURCE, root, { recursive: true, filter: (path) => !path.startsWith(join(SOURCE, "data")) && !path.startsWith(join(SOURCE, "test")) && !path.startsWith(join(SOURCE, "content", "exchanges")) });
  endpoint = join(root, "src", "contract-claude-code.js");
});
test.afterEach(() => rmSync(base, { recursive: true, force: true }));

test("the operation catalog and service face share the exact RMN law", () => {
  const manifest = JSON.parse(readFileSync(join(SOURCE, "package.json"), "utf8"));
  const catalog = manifest["x-agentic-metro-enterprise"]["operation-catalog"];
  assert.equal(catalog["solicit-service"].contract, CONTRACT);
  assert.equal(catalog["invoke-service"].contract, CONTRACT);
});

test("provider asks for missing executable packet terms", () => {
  const result = run("solicit-service", solicit(leader("Use Sonnet for this report.")));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output.type, "Question");
  assert.deepEqual(result.output.object.missing, ["packet", "packet.messages", "executionMode(dry-run|live)"]);
});

test("provider authors an offer and independently validates a contracted dry run", () => {
  const request = { type: "ClaudeCodeInferenceRequest", packet: { model: "sonnet", messages: [{ role: "user", content: "Synthesize this." }], "max-tokens": 1000 }, executionMode: "dry-run" };
  const offered = run("solicit-service", solicit(leader("Use Sonnet for this report.", request)));
  assert.equal(offered.status, 0, offered.stderr);
  assert.equal(offered.output.type, "Offer");
  assert.deepEqual(offered.output.object.effects, []);
  const bid = offered.output.object.inferenceServiceBid;
  assert.equal(bid.type, "InferenceServiceBid"); assert.equal(bid.provider, "urn:ame:claude-code-inference-team"); assert.equal(bid.model, "sonnet"); assert.equal(bid.availability, "unknown"); assert.match(bid.requestScopeDigest, /^ni:\/\/\/sha-256;/); assert.deepEqual(bid.capacity, { unit: "provider-request-slot", remaining: "unknown", period: "unknown" }); assert.deepEqual(bid.consideration, { denomination: "unknown", maxPerRequest: "unknown", monetary: "unknown" }); assert.deepEqual(bid.qualityEvidence, { kind: "provider-local-exchange-record", reference: "unknown" }); assert.equal(JSON.stringify(bid).includes("total_cost_usd"), false);
  const invoked = run("invoke-service", accept(offered.output));
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  assert.equal(invoked.output.type, "Accept");
  assert.equal(invoked.output.object.disposition, "ready");
  assert.deepEqual(invoked.output.object.observations, { networkCalls: 0, recordsWritten: 0 });
});

test("provider carries a bounded structured tool-choice schema to the Claude CLI without filesystem tools", () => {
  const outputSchema = { type: "object", additionalProperties: false, properties: { tool: { enum: ["accept", "revise", "refuse"] }, report: { type: "string" } }, required: ["tool", "report"] };
  const request = { type: "ClaudeCodeInferenceRequest", packet: { model: "sonnet", messages: [{ role: "user", content: "Judge this and select one bounded tool." }], params: { outputSchema } }, executionMode: "dry-run" };
  const offered = run("solicit-service", solicit(leader("Use Sonnet for bounded editorial tool selection.", request)));
  assert.equal(offered.output.type, "Offer");
  const invoked = run("invoke-service", accept(offered.output));
  assert.equal(invoked.status, 0, invoked.stderr || invoked.stdout);
  const harness = invoked.output.object.observations;
  assert.equal(invoked.output.object.disposition, "ready");
  assert.deepEqual(harness, { networkCalls: 0, recordsWritten: 0 });

  const invalid = { ...request, packet: { ...request.packet, params: { outputSchema: "accept" } } };
  const refused = run("solicit-service", solicit(leader("Use Sonnet for bounded editorial tool selection.", invalid)));
  assert.equal(refused.output.type, "Question");
  assert.ok(refused.output.object.missing.includes("packet.params.outputSchema"));
});

test("live harness projects provider-validated structured output as strict JSON text", () => {
  const fakeBin = join(base, "bin"), capture = join(base, "claude-args.json"), packetPath = join(base, "packet.json"), locatorPath = join(base, "locator.json"), fakeClaude = join(fakeBin, "claude"); mkdirSync(fakeBin);
  writeFileSync(fakeClaude, `#!/usr/bin/env node\nconst fs=require("node:fs");fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS,JSON.stringify(process.argv.slice(2)));process.stdout.write(JSON.stringify({subtype:"success",is_error:false,stop_reason:"end_turn",result:"ambient prose",structured_output:{kind:"admission"}}));\n`, { mode: 0o755 });
  const outputSchema = { type: "object", additionalProperties: false, properties: { kind: { const: "admission" } }, required: ["kind"] }; writeFileSync(packetPath, JSON.stringify({ model: "sonnet", messages: [{ role: "user", content: "Classify this." }], params: { outputSchema } }));
  const result = spawnSync(process.execPath, [join(root, "run-one-exchange.mjs"), packetPath, "--output-file", locatorPath], { cwd: root, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, CLAUDE_CODE_BIN: fakeClaude, FAKE_CLAUDE_ARGS: capture }, encoding: "utf8", timeout: 90_000 }); assert.equal(result.status, 0, result.stderr);
  const locator = JSON.parse(readFileSync(locatorPath, "utf8")), record = JSON.parse(readFileSync(locator.recordPath, "utf8")), args = JSON.parse(readFileSync(capture, "utf8")); assert.deepEqual(JSON.parse(record.completion.text), { kind: "admission" }); assert.deepEqual(record.completion.raw.structured_output, { kind: "admission" }); assert.equal(args[args.indexOf("--json-schema") + 1], JSON.stringify(outputSchema)); assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", ""]);
});

test("live account use is an explicit accepted effect", () => {
  const request = { type: "ClaudeCodeInferenceRequest", packet: { model: "sonnet", messages: [{ role: "user", content: "Synthesize this." }] }, executionMode: "live" };
  const offered = run("solicit-service", solicit(leader("Use Sonnet for this report.", request)));
  assert.deepEqual(offered.output.object.effects, ["external-network", "leader-inference-account"]);
  const refused = run("invoke-service", accept(offered.output, ["invoke-service"]));
  assert.equal(refused.status, 2);
  assert.match(refused.output.object.reason, /external-network/u);
});

test("private relay acknowledges a long invocation before its result body is ready", async () => {
  const fakeClaude = join(base, "slow-claude"), done = join(base, "done");
  writeFileSync(fakeClaude, `#!/usr/bin/env node\nconst fs=require("node:fs");setTimeout(()=>{fs.writeFileSync(process.env.FAKE_CLAUDE_DONE,"done");process.stdout.write("finished");},1000);\n`, { mode: 0o755 });
  const probe = createServer();
  await new Promise((resolvePromise) => probe.listen(0, "127.0.0.1", resolvePromise));
  const port = probe.address().port;
  await new Promise((resolvePromise) => probe.close(resolvePromise));
  const relay = spawn(process.execPath, [join(root, "src", "serve-private-claude-relay.mjs")], {
    cwd: root,
    env: { ...process.env, CLAUDE_RELAY_PORT: String(port), CLAUDE_RELAY_CLAUDE_BIN: fakeClaude, FAKE_CLAUDE_DONE: done },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      relay.once("error", rejectPromise);
      relay.stdout.once("data", resolvePromise);
    });
    const payload = JSON.stringify({
      args: ["-p", "--model", "claude-sonnet-4-6", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--setting-sources", ""],
      input: "Judge this manuscript.",
    });
    const value = await new Promise((resolvePromise, rejectPromise) => {
      const req = request({ hostname: "127.0.0.1", port, path: "/invoke", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (response) => {
        try { assert.equal(existsSync(done), false, "relay withheld response headers until the child completed"); } catch (error) { rejectPromise(error); return; }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      });
      req.once("error", rejectPromise);
      req.end(payload);
    });
    assert.equal(value.status, 0);
    assert.equal(value.stdout, "finished");
  } finally {
    relay.kill("SIGTERM");
  }
});

test("private relay client preserves a child kill signal in its refusal evidence", async () => {
  const probe = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(`${JSON.stringify({ status: 70, signal: "SIGKILL", stdout: "", stderr: "" })}\n`);
  });
  await new Promise((resolvePromise) => probe.listen(0, "127.0.0.1", resolvePromise));
  const port = probe.address().port;
  try {
    const child = spawn(process.execPath, [join(root, "src", "claude-via-private-relay.mjs"), "-p"], {
      env: { ...process.env, CLAUDE_RELAY_URL: `http://127.0.0.1:${port}/invoke` },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.stdin.end("Judge this manuscript.");
    const status = await new Promise((resolvePromise, rejectPromise) => {
      child.once("error", rejectPromise);
      child.once("close", resolvePromise);
    });
    assert.equal(status, 70);
    assert.match(Buffer.concat(stderr).toString("utf8"), /status 70 after signal SIGKILL/u);
  } finally {
    await new Promise((resolvePromise) => probe.close(resolvePromise));
  }
});
