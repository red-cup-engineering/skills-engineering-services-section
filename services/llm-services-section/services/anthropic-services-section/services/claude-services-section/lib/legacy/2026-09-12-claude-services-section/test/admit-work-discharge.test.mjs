import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCER,
  admitWorkDischargeSafely,
  buildDischargeInputFromArgs,
  repeatedEvidenceArgs,
} from "../scripts/admit-work-discharge.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "admit-work-discharge.mjs");

test("PRODUCER carries this package's own name and version", () => {
  assert.equal(PRODUCER.id, "@red-cup-engineering/bare-cedar-fog-claude-services-section");
  assert.match(PRODUCER.revision, /^\d+\.\d+\.\d+$/u);
});

test("repeatedEvidenceArgs collects every --evidence value in order", () => {
  const argv = ["--scope", "task:x", "--evidence", "first", "--intent", "i-1", "--evidence", "second"];
  assert.deepEqual(repeatedEvidenceArgs(argv), ["first", "second"]);
});

test("repeatedEvidenceArgs is empty when --evidence is never given", () => {
  assert.deepEqual(repeatedEvidenceArgs(["--scope", "task:x"]), []);
});

test("buildDischargeInputFromArgs defaults id from scope and producer from options", () => {
  const input = buildDischargeInputFromArgs({
    scope: "task:github-actions-house-registry-access",
    intent: "health-work-intents-2026-09-03",
    text: "Confirmed HOUSE_REGISTRY_USER/PASSWORD secrets exist and workflow run succeeded.",
    evidence: ["gh secret list names HOUSE_REGISTRY_USER, HOUSE_REGISTRY_PASSWORD"],
  });
  assert.equal(input.kind, "metroplat.work.discharge");
  assert.equal(input.id, "discharge-task:github-actions-house-registry-access");
  assert.equal(input.intent, "health-work-intents-2026-09-03");
  assert.equal(input.scope, "task:github-actions-house-registry-access");
  assert.deepEqual(input.producer, PRODUCER);
  assert.equal(input.evidence.length, 1);
});

test("buildDischargeInputFromArgs honors an explicit --id and producer override", () => {
  const input = buildDischargeInputFromArgs({
    scope: "task:x",
    intent: "intent-1",
    text: "text",
    evidence: ["e1"],
    id: "discharge-custom",
    producer: { id: "someone-else", revision: "9.9.9" },
  });
  assert.equal(input.id, "discharge-custom");
  assert.deepEqual(input.producer, { id: "someone-else", revision: "9.9.9" });
});

test("admitWorkDischargeSafely returns {ok:true, admission} when the verb succeeds", async () => {
  const admission = { kind: "metroplat.work.discharge-admission", discharge: "discharge-task:x", intent: "intent-1", subject: "structured-work-intent-intent-1", scope: "task:x", appended: 1, status: "admitted" };
  const result = await admitWorkDischargeSafely({
    binding: { dataRoot: "/fake" },
    discharge: { kind: "metroplat.work.discharge", id: "discharge-task:x", intent: "intent-1", producer: PRODUCER, scope: "task:x", text: "t", evidence: ["e"] },
    at: "2026-09-03T00:00:00.000Z",
    admitFn: () => admission,
  });
  assert.deepEqual(result, { ok: true, admission });
});

test("admitWorkDischargeSafely returns {ok:false, error} instead of throwing when the verb refuses", async () => {
  const result = await admitWorkDischargeSafely({
    binding: { dataRoot: "/fake" },
    discharge: { kind: "metroplat.work.discharge", id: "discharge-task:x", intent: "intent-1", producer: PRODUCER, scope: "task:x", text: "t", evidence: ["e"] },
    at: "2026-09-03T00:00:00.000Z",
    admitFn: () => {
      throw new TypeError("work discharge: scope task:x is not an obligation of structured intent intent-1");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /not an obligation of structured intent/u);
});

test("CLI: --help prints usage and exits 0", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: admit-work-discharge/u);
});

test("CLI: missing --scope/--intent/--text/--evidence refuses with exit 1 and a stderr message, no JSON on stdout", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--scope", "task:x"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--scope, --intent, --text, and at least one --evidence are required/u);
  assert.equal(result.stdout, "");
});

test("CLI: a well-formed call refuses (nonzero exit, JSON {ok:false, error}) against an empty METROPLAT_DATA_ROOT rather than throwing raw", () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--scope", "task:x", "--intent", "no-such-intent", "--text", "t", "--evidence", "e1", "--data-root", "/tmp/nonexistent-metroplat-root-for-cli-test"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.error, "string");
});
