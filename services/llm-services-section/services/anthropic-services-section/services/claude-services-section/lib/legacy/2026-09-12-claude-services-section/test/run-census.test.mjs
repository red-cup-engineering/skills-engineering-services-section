import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSemanticRecordJournal } from "@red-cup-engineering/semantic-record-journal-service";
import { validateTargets, runCensus, OBJECT_KIND } from "../scripts/run-census.mjs";

test("validateTargets rejects a non-array targets value", () => {
  assert.throws(() => validateTargets(null), /must have a "targets" array/);
  assert.throws(() => validateTargets("nope"), /must have a "targets" array/);
});

test("validateTargets rejects a target missing id, path, or command", () => {
  assert.throws(() => validateTargets([{ path: "x", command: ["true"] }]), /malformed target entry/);
  assert.throws(() => validateTargets([{ id: "x", command: ["true"] }]), /malformed target entry/);
  assert.throws(() => validateTargets([{ id: "x", path: "x", command: [] }]), /malformed target entry/);
});

test("validateTargets accepts a well-formed target list", () => {
  const targets = [{ id: "x", path: ".", command: ["true"] }];
  assert.equal(validateTargets(targets), targets);
});

test("runCensus records a passing target as green and a failing one as red, and logs both", () => {
  const root = mkdtempSync(join(tmpdir(), "census-root-"));
  const journalRoot = mkdtempSync(join(tmpdir(), "census-journal-"));
  try {
    const targets = [
      { id: "passing", path: ".", command: process.platform === "win32" ? ["cmd", "/c", "exit 0"] : ["true"] },
      { id: "failing", path: ".", command: process.platform === "win32" ? ["cmd", "/c", "exit 1"] : ["false"] },
      { id: "missing", path: "does-not-exist", command: ["true"] },
    ];
    const summary = runCensus({ root, targets, unit: "test-unit", journalRoot });

    assert.equal(summary.type, "CensusRun");
    assert.equal(summary.targets, 3);
    assert.equal(summary.green, 1);
    assert.deepEqual(summary.red.sort(), ["failing", "missing"]);
    assert.equal(summary.root, journalRoot);

    const journal = createSemanticRecordJournal({ root: journalRoot, objectKind: OBJECT_KIND });
    const observations = journal.query({ category: "test-unit.census-target-observation" }).map((r) => r.record);
    assert.equal(observations.length, 3);
    assert.equal(observations.find((r) => r.target === "passing").green, true);
    assert.equal(observations.find((r) => r.target === "failing").green, false);
    assert.equal(observations.find((r) => r.target === "missing").error, "target path does not exist");

    const summaries = journal.query({ category: "test-unit.census-run-summary" }).map((r) => r.record);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].green, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(journalRoot, { recursive: true, force: true });
  }
});
