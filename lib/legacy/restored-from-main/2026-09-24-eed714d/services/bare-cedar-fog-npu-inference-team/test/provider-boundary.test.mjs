import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LAW, MODEL, executeMessage } from "../src/execute-rmn-inference.mjs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const card = JSON.parse(readFileSync(new URL("content/agent-cards/bare-cedar-fog-npu-inference-team.json", root), "utf8"));

test("the local NPU publishes one signed skill and keeps circuit and offer terms canonical", () => {
  assert.equal(manifest["x-agentic-metro-enterprise"], undefined, "the manifest no longer duplicates operation metadata");
  assert.equal("solicit-rmn-inference" in manifest.bin, false);
  assert.deepEqual(card.skills.map((skill) => skill.id), ["typed-rmn-npu-inference"]);
  assert.equal(LAW, "ni:///sha-256;h2VIEZwYH__6vRnSgSWYRrFh1AHFcIBFboED8rlsGgo");
  const circuit = card.capabilities.extensions.find((extension) => extension.params?.component)?.params.component;
  assert.equal(circuit.profile, "org.emsenn.rmn.hierarchical-circuit.v3");
  const offer = card.capabilities.extensions.find((extension) => typeof extension.params?.model === "string").params;
  assert.equal(offer.model, MODEL);
  assert.equal(offer.maximumDifficulty, "0.45");
  assert.match(offer.workTypes, /inquiry/u);
  assert.match(offer.workTypes, /software-engineering/u);
});


test("local NPU module imports without settlement configuration, while execution still refuses it", async () => {
  const prior = process.env.EVM_RPC_URL;
  delete process.env.EVM_RPC_URL;
  try {
    await assert.rejects(executeMessage({}), /EVM_RPC_URL must name the settlement chain/u);
  } finally {
    if (prior === undefined) delete process.env.EVM_RPC_URL; else process.env.EVM_RPC_URL = prior;
  }
});
