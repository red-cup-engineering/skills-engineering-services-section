import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runBoundedCommand } from "../scripts/run-bounded-command.mjs";

const root = () => mkdtempSync(join(tmpdir(), "bounded-command-"));

test("runBoundedCommand captures stdout, stderr, and exit code", async () => {
  process.env.CODEX_TOOLKIT_STATE_ROOT = root();
  try {
    const result = await runBoundedCommand({ command: "echo out; echo err 1>&2; exit 3", cwd: process.cwd() });
    assert.equal(result.exitCode, 3);
    assert.equal(result.captureComplete, true);
    assert.match(readAll(result.stdout.path), /out/u);
    assert.match(readAll(result.stderr.path), /err/u);
  } finally {
    delete process.env.CODEX_TOOLKIT_STATE_ROOT;
  }
});

test("runBoundedCommand marks capture incomplete once output exceeds the byte cap", async () => {
  process.env.CODEX_TOOLKIT_STATE_ROOT = root();
  try {
    const result = await runBoundedCommand({ command: "yes | head -c 100000", cwd: process.cwd(), maximumBytes: 1024 });
    assert.equal(result.captureComplete, false);
    assert.ok(result.stdout.bytes <= 1024);
  } finally {
    delete process.env.CODEX_TOOLKIT_STATE_ROOT;
  }
});

function readAll(path) {
  return readFileSync(path, "utf8");
}
