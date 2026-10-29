import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = join(ROOT, "run-one-exchange.mjs");

function run(extraEnv = {}) {
  const env = { ...process.env };
  delete env.GITHUB_MODELS_INFERENCE_PILOT_CAP;
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, env, encoding: "utf8" });
}

test("GitHub Models supplier has no implicit lifetime exchange cap", () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: node run-one-exchange/);
  assert.doesNotMatch(result.stderr, /at or above GITHUB_MODELS_INFERENCE_PILOT_CAP/);
});

test("GitHub Models supplier honors an explicit customer cap", () => {
  const result = run({ GITHUB_MODELS_INFERENCE_PILOT_CAP: "0" });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /GITHUB_MODELS_INFERENCE_PILOT_CAP \(0\)/);
});

test("GitHub Models supplier refuses a malformed explicit cap", () => {
  const result = run({ GITHUB_MODELS_INFERENCE_PILOT_CAP: "ten" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /must be a nonnegative integer/);
});
