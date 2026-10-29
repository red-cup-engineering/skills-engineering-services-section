import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { admitRateState } from "../src/rate-admission.mjs";

test("Groq rate admission advances one monotone provider-local timestamp", () => {
  const root = mkdtempSync(join(tmpdir(), "groq-rate-state-")), statePath = join(root, "last-admission");
  const waits = [];
  try {
    const first = admitRateState({ statePath, minimumIntervalMilliseconds: 1_000, now: 2_000, pause: (delay) => waits.push(delay) });
    const second = admitRateState({ statePath, minimumIntervalMilliseconds: 1_000, now: 2_500, pause: (delay) => waits.push(delay) });
    assert.deepEqual(first, { admittedAt: 2_000, delayMilliseconds: 0 });
    assert.deepEqual(second, { admittedAt: 3_000, delayMilliseconds: 500 });
    assert.deepEqual(waits, [0, 500]);
    assert.equal(readFileSync(statePath, "utf8"), "3000\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Groq rate admission refuses malformed state without widening capacity", () => {
  const root = mkdtempSync(join(tmpdir(), "groq-rate-malformed-")), statePath = join(root, "last-admission");
  try {
    writeFileSync(statePath, "not-a-time\n");
    assert.throws(() => admitRateState({ statePath, minimumIntervalMilliseconds: 1_000, now: 2_000, pause: () => {} }), /malformed/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
