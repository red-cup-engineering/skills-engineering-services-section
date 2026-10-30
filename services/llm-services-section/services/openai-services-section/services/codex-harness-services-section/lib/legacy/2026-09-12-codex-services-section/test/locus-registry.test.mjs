import assert from "node:assert/strict";
import test from "node:test";
import { ACTOR } from "../src/enterprise.mjs";
import { observeArchitecturalLoci } from "../src/locus-registry.mjs";

test("the bootloader is four content-addressed loci without replacing Codex identity", () => {
  const registry = observeArchitecturalLoci();
  assert.match(registry.id, /^ni:\/\/\/sha-256;/u);
  assert.equal(registry.owner, ACTOR);
  assert.equal(registry.loci.length, 4);
  assert.equal(new Set(registry.loci.map(({ actor }) => actor)).size, 4);
  assert.ok(registry.loci.every(({ owner, status, missingFaces }) => owner === ACTOR && status === "seed-not-advertised" && missingFaces.length === 5));
});
