import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LAW, MODEL } from "../src/execute-rmn-inference.mjs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const card = JSON.parse(readFileSync(new URL("content/agent-cards/bare-cedar-fog-npu-inference-team.json", root), "utf8"));

test("the local NPU has one semantic operation identical to its signed A2A skill", () => {
  const catalog = manifest["x-agentic-metro-enterprise"]["operation-catalog"];
  assert.deepEqual(Object.keys(catalog), ["typed-rmn-npu-inference"]);
  assert.equal("solicit-rmn-inference" in manifest.bin, false);
  assert.deepEqual(Object.keys(catalog), card.skills.map((skill) => skill.id));
  const offer = card.capabilities.extensions.find((extension) => typeof extension.params?.model === "string").params;
  assert.equal(catalog["typed-rmn-npu-inference"].law, LAW);
  assert.equal(card.capabilities.extensions.find((extension) => extension.params?.component).params.component.law, LAW);
  assert.equal(offer.model, MODEL);
  assert.equal(offer.maximumDifficulty, "0.45");
  assert.match(offer.workTypes, /inquiry/u);
  assert.match(offer.workTypes, /software-engineering/u);
});
