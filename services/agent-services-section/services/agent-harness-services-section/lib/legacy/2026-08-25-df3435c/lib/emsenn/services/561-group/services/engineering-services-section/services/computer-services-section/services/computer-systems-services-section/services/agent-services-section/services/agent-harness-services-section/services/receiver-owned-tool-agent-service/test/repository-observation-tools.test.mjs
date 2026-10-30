import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRepositoryObservationHandlers } from "../src/repository-observation-tools.mjs";

test("repository observations are bounded beneath the admitted root", async () => {
  const root = await mkdtemp(join(tmpdir(), "receiver-tools-"));
  await writeFile(join(root, "theory.md"), "alpha\nbeta attention\ngamma\n", "utf8");
  const handlers = createRepositoryObservationHandlers({ root });
  const read = await handlers.read_repository_file({ path: "theory.md", startLine: 2, maximumLines: 1 });
  assert.equal(read.text, "beta attention");
  const search = await handlers.search_repository({ query: "attention", maximumMatches: 2 });
  assert.equal(search.matches.length, 1);
  await assert.rejects(handlers.read_repository_file({ path: "../foreign" }), /beneath the admitted root/u);
});

test("machine observation exposes quantities without granting mutation", async () => {
  const observation = await createRepositoryObservationHandlers({ root: process.cwd() }).observe_machine_territory();
  assert.equal(observation.type, "MachineTerritoryObservation");
  assert.ok(observation.cpuCount > 0);
  assert.ok(observation.totalMemoryBytes >= observation.freeMemoryBytes);
});
