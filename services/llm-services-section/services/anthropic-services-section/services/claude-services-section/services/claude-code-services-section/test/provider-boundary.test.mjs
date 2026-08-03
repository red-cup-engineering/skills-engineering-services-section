import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const card = JSON.parse(readFileSync(new URL("content/agent-cards/claude-code-inference-team.json", root), "utf8"));
const policy = JSON.parse(readFileSync(new URL("content/policies/typed-inference-capacity.json", root), "utf8"));
const extensions = card.capabilities.extensions;
const circuit = extensions.find((extension) => extension.params?.component)?.params.component;
const offer = extensions.find((extension) => extension.params?.profile === "org.emsenn.inference.market-offer.v2")?.params;

test("Claude exposes exactly one semantic operation through its signed standing offer", () => {
  const catalog = manifest["x-agentic-metro-enterprise"]["operation-catalog"];
  assert.deepEqual(Object.keys(catalog), ["execute-typed-claude-inference"]);
  assert.equal("solicit-service" in manifest.bin, false);
  assert.deepEqual(Object.keys(catalog), card.skills.map((skill) => skill.id));
  assert.equal(catalog["execute-typed-claude-inference"].law, circuit.law);
  assert.equal(offer.maximumConcurrentLots, "1");
  assert.equal(policy.maximumConcurrentLots, 1);
});

test("Claude has no live JSON exchange ledger", () => {
  const live = readdirSync(new URL("content/exchanges", root), { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  assert.deepEqual(live, []);
});
