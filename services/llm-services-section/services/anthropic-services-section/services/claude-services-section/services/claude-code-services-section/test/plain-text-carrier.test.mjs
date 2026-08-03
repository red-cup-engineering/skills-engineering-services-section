import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const harness = new URL("../run-one-exchange.mjs", import.meta.url).pathname;

test("ordinary inference preserves large JSON-like reasoning as text before deterministic wrapping", () => {
  const root = mkdtempSync(join(tmpdir(), "claude-text-carrier-"));
  const fakeClaude = join(root, "fake-claude");
  const packet = join(root, "packet.json");
  const payload = `${"reasoning\n".repeat(18_000)}{\"unfinished\":\"this is model text, not a provider envelope`;
  try {
    writeFileSync(fakeClaude, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[args.indexOf("--output-format") + 1] !== "text") process.exit(64);
process.stdout.write(${JSON.stringify(payload)});
`);
    chmodSync(fakeClaude, 0o755);
    writeFileSync(packet, `${JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "fabricate it" }] })}\n`);
    const run = spawnSync(process.execPath, [harness, packet], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CODE_BIN: fakeClaude, CLAUDE_CODE_CAPACITY_LOCK: join(root, "slot.lock") },
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.outcome, "completion");
    assert.equal(result.completion.text, payload);
    assert.equal(result.completion.raw.result, payload);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
