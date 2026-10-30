import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { installHooks, projectHooks } from "../scripts/install-hooks.mjs";

const root = () => mkdtempSync(join(tmpdir(), "install-hooks-"));

test("projectHooks builds a hooks.json body from the package's manifest", () => {
  const projected = projectHooks();
  assert.ok(projected.hooks.PreToolUse);
  assert.ok(projected.hooks.PostToolUse);
  assert.ok(projected.hooks.Stop);
  assert.match(projected.hooks.PreToolUse[0].hooks[0].command, /src\/hooks\.mjs$/u);
});

test("installHooks writes .codex/hooks.json under the given root", () => {
  const projectRoot = root();
  const result = installHooks({ root: projectRoot });
  assert.equal(result.changed, true);
  assert.equal(result.target, join(projectRoot, ".codex/hooks.json"));
  assert.ok(existsSync(result.target));
  const written = JSON.parse(readFileSync(result.target, "utf8"));
  assert.ok(written.hooks.PreToolUse);
});

test("installHooks is idempotent on a second run", () => {
  const projectRoot = root();
  installHooks({ root: projectRoot });
  const second = installHooks({ root: projectRoot });
  assert.equal(second.changed, false);
});

test("installHooks preserves hooks this package did not declare", () => {
  const projectRoot = root();
  mkdirSync(join(projectRoot, ".codex"), { recursive: true });
  writeFileSync(join(projectRoot, ".codex/hooks.json"), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo other-hook" }] }] },
  }));
  installHooks({ root: projectRoot });
  const written = JSON.parse(readFileSync(join(projectRoot, ".codex/hooks.json"), "utf8"));
  assert.equal(written.hooks.SessionStart[0].hooks[0].command, "echo other-hook");
  assert.ok(written.hooks.PreToolUse);
});

test("installHooks --check throws when the projection is stale", () => {
  const projectRoot = root();
  assert.throws(() => installHooks({ root: projectRoot, check: true }));
  installHooks({ root: projectRoot });
  assert.doesNotThrow(() => installHooks({ root: projectRoot, check: true }));
});
