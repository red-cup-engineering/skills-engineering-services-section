import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const json = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

test("package advertises ActivityStreams contracting, detached procurement, market observation, and supplier admission", () => {
  const catalog = json("package.json")["x-agentic-metro-enterprise"]["operation-catalog"];
  assert.equal(catalog["solicit-service"].migrationTarget, "solicit-inference"); assert.equal(catalog["solicit-inference"].contract, "inference-fabric-activitystreams-service"); assert.equal(catalog["invoke-inference"].asynchronous, true); assert.equal(catalog["query-inference"].contract, "inference-fabric-activitystreams-service");
  assert.equal(catalog["submit-inference"].asynchronous, true); assert.equal(catalog["submit-inference"].contract, "inference-fabric-service");
  assert.equal(catalog["query-inference-result"].contract, "inference-fabric-service"); assert.equal(catalog["observe-inference-market"].returns, "InferenceMarketSnapshot"); assert.equal(catalog["admit-private-worker"].contract, "private-worker-admission-service");
  assert.equal(catalog["open-inference-jsonl-session"].socketRequired, false); assert.equal(catalog["open-inference-jsonl-session"].contract, "inference-fabric-activitystreams-service"); assert.equal(catalog["measure-inference-throughput"].returns, "InferenceFabricDispatchSummary");
});

test("contracts bound the raw carrier honestly and runtime registry remains a base-plus-admissions projection", () => {
  const fabric = json("content/contracts/inference-fabric-service.json"), activityStreams = json("content/contracts/inference-fabric-activitystreams-service.json"), admission = json("content/contracts/private-worker-admission-service.json"), base = json("content/config/inference-fabric-registry.json"), runtime = json("content/config/inference-fabric-runtime.json"), unit = readFileSync(join(ROOT, "ops/systemd/liss-inference.service"), "utf8");
  assert.match(fabric.boundary.classification, /raw .* remain intra-enterprise A2A/); assert.match(fabric.boundary.interEnterpriseStatus, /separately typed inference-fabric-activitystreams-service/); assert(activityStreams.boundary.currentCarriers.some((carrier) => /stdin\/stdout JSONL/.test(carrier))); assert.match(activityStreams.boundary.networkActivityPub, /missing separately hireable/); assert.match(activityStreams.boundary.x402, /metered-inference-tollbooth/); assert.equal(admission.sourceOfTruth, "data/supplier-admissions/YYYY/MM/DD/*.jsonl");
  assert.equal(runtime.projection.type, "InferenceFabricRegistryProjection"); assert.equal(runtime.projection.admissions, runtime.endpoints.length - base.endpoints.length); assert.deepEqual(runtime.endpoints.slice(0, base.endpoints.length).map((endpoint) => endpoint.id), base.endpoints.map((endpoint) => endpoint.id)); assert.match(unit, /inference-fabric-runtime\.json/);
  assert.match(unit, /--recover-stale-lock/, "socket-activated LISS must recover a dead broker's journal lock after host reboot");
  for (const bound of ["MemoryHigh=35%", "MemoryMax=50%", "MemorySwapMax=0", "TasksMax=256", "OOMPolicy=stop"]) assert.match(unit, new RegExp(`^${bound}$`, "m"), `LISS service must carry ${bound}`);
});

test("every legacy provider harness names the contracted inference-exchange schema pool explicitly", () => {
  const harnesses = [
    "run-one-exchange.mjs",
    ...["anthropic", "claude-code", "gemini", "github-models", "groq", "openai", "nvidia", "openrouter"].map((name) => `services/${name}-inference-team/run-one-exchange.mjs`)
  ];
  for (const harness of harnesses) {
    const source = readFileSync(join(ROOT, harness), "utf8");
    assert.match(source, /"emsenn\/schema\/inference-exchange", "--pool", resolvePath\(dirname\(reader\), "\.\.", "\.\.", "schemas"\)/, harness);
  }
});
