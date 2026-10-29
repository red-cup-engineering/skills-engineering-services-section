import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const card = JSON.parse(readFileSync(new URL("content/agent-cards/groq-inference-team.json", root), "utf8"));
const policy = JSON.parse(readFileSync(new URL("content/policies/typed-inference-rate-capacity.json", root), "utf8"));
const extensions = card.capabilities.extensions;
const circuit = extensions.find((extension) => extension.params?.component)?.params.component;
const offer = extensions.find((extension) => extension.params?.profile === "org.emsenn.inference.market-offer.v2")?.params;
const service = readFileSync(new URL("ops/systemd/bare-cedar-fog-groq-inference-a2a.service", root), "utf8");

function serviceValue(key) {
  return service.split(/\r?\n/u).find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
}

function environmentValue(key) {
  const prefix = `Environment=${key}=`;
  return service.split(/\r?\n/u).find((line) => line.startsWith(prefix))?.slice(prefix.length);
}

test("Groq exposes exactly one semantic operation through its signed standing offer", () => {
  const enterprise = manifest["x-agentic-metro-enterprise"];
  assert.deepEqual(Object.keys(enterprise["operation-catalog"]), ["execute-typed-groq-inference"]);
  assert.equal("solicit-rmn-inference" in manifest.bin, false);
  assert.equal(offer.maximumConcurrentLots, "1");
  assert.equal(policy.maximumConcurrentLots, 1);
  assert.match(offer.capabilities, /code-review/u);
});

test("Groq has no live JSON exchange ledger", () => {
  const live = readdirSync(new URL("content/exchanges", root), { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  assert.deepEqual(live, []);
});

test("Groq systemd deployment paths resolve to this package", () => {
  const packageRoot = fileURLToPath(root).replace(/\/$/u, "");
  assert.equal(serviceValue("WorkingDirectory"), packageRoot);
  assert.equal(environmentValue("AGENT_CARD_SIGNING_KEY"), `${packageRoot}/data/agent-card-signing/ed25519-private.pem`);
  assert.equal(environmentValue("AGENT_CARD_JWKS"), `${packageRoot}/content/agent-card-signing/jwks.json`);
});
