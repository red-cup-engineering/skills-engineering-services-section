import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { invokeExternalActuator, selectBoundedEvidence } from "../src/client.mjs";

test("selects a bounded digest-bearing source cover from an explicit root", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-evidence-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "a.txt"), "needle\n"); writeFileSync(join(root, "b.txt"), "other\n");
  const cover = selectBoundedEvidence({ root, query: "needle" });
  assert.equal(cover.sources.length, 1);
  assert.equal(cover.sources[0].path, "a.txt");
  assert.match(cover.sources[0].digest, /^urn:sha256:/u);
});

test("invokes an arbitrary actor through an injected transport without inventing acceptance", async () => {
  const receipt = await invokeExternalActuator({ actor: "urn:actor:test", operation: "do", arguments: { value: 1 }, authorityEvidence: "user-request" }, async (request) => ({ type: "ProviderResult", request: request.id }), async () => ({ passed: true }));
  assert.equal(receipt.providerResult.type, "ProviderResult");
  assert.deepEqual(receipt.verification, { passed: true });
  assert.equal(receipt.acceptance, null);
});
