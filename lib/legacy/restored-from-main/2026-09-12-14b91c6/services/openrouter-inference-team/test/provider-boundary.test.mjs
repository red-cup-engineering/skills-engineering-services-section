import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { providerPacket } from "../src/provider-packet.mjs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const card = JSON.parse(readFileSync(new URL("content/agent-cards/openrouter-inference-team.json", root), "utf8"));

test("OpenRouter exposes one signed A2A skill through one executor boundary", () => {
  assert.deepEqual(card.skills.map((skill) => skill.id), ["execute-typed-openrouter-free-inference"]);
  assert.equal(manifest.bin["execute-rmn-inference"], "./src/execute-rmn-inference.mjs");
  assert.equal(manifest.bin["serve-inference-a2a"], "./scripts/serve-a2a.mjs");
  assert.equal("solicit-rmn-inference" in manifest.bin, false);
});

test("OpenRouter does not offer schema enforcement that its selected model lacks", () => {
  const offer = card.capabilities.extensions.find((extension) => extension.params?.profile === "org.emsenn.inference.market-offer.v2").params;
  assert.equal(offer.capabilities.split(/\s+/u).includes("json-schema-output"), false);
  assert.equal(offer.capabilities.split(/\s+/u).includes("json-output"), true);
});

test("OpenRouter derives output allocation from the consuming work lot", () => {
  const packet = providerPacket({
    instruction: "Return the contracted result.",
    input: JSON.stringify({ executionBounds: { maximumOutputTokens: 731 } }),
    model: "poolside/laguna-xs-2.1:free",
  });
  assert.equal(packet["max-tokens"], 731);
});

test("OpenRouter refuses to invent an output allocation", () => {
  assert.throws(
    () => providerPacket({
      instruction: "Return the contracted result.",
      input: JSON.stringify({ executionBounds: {} }),
      model: "poolside/laguna-xs-2.1:free",
    }),
    /supplied by the consuming work lot/,
  );
});
