import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { installHooks } from "../scripts/project-codex-hooks.mjs";

const fixture = () => mkdtempSync(join(tmpdir(), "codex-hooks-projection-"));
const handlers = (hooks, event) => hooks[event].map((group) => group.hooks[0].command);

test("the API and CLI refuse to infer a user home destination", () => {
  assert.throws(() => installHooks(), /root path is required/u);
  const script = new URL("../scripts/project-codex-hooks.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [script.pathname], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--root requires one destination path/u);
});

test("package installer projects bounded context and shared output capture", () => {
  const root = fixture();
  const installed = installHooks({ root });
  assert.equal(installed.changed, true);
  const projection = JSON.parse(readFileSync(join(root, ".codex/hooks.json"), "utf8"));
  assert.deepEqual(Object.keys(projection.hooks), ["SessionStart", "UserPromptSubmit", "PreToolUse"]);
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    assert.equal(projection.hooks[event][0].hooks[0].additionalContextLimit, 512, event);
  }
  assert.equal(projection.hooks.PreToolUse[0].matcher, "^(?:collaboration\\.)?spawn_agent$");
  assert.match(projection.hooks.PreToolUse[0].hooks[0].command, /codex-enterprise-hook\.mjs$/u);
  assert.equal(projection.hooks.PreToolUse[1].matcher, "Bash");
  assert.match(projection.hooks.PreToolUse[1].hooks[0].command, /codex-pretool-output-capture-hook\.mjs$/u);
  assert.equal(projection.hooks.SessionStart[0].hooks[0].timeout, 10);
  assert.equal(installHooks({ root, check: true }).checked, true);
});

test("package check detects projection drift without overwriting it", () => {
  const root = fixture();
  installHooks({ root });
  const target = join(root, ".codex/hooks.json");
  writeFileSync(target, "{}\n");
  assert.throws(() => installHooks({ root, check: true }), /stale or missing/u);
  assert.equal(readFileSync(target, "utf8"), "{}\n");
});

test("installation preserves lifecycle hooks outside the manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-hooks-merge-"));
  mkdirSync(join(root, ".codex"), { recursive: true });
  writeFileSync(join(root, ".codex/hooks.json"), `${JSON.stringify({ description: "local lifecycle hooks", hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "local-post" }] }] } }, null, 2)}\n`);
  installHooks({ root });
  const installed = JSON.parse(readFileSync(join(root, ".codex/hooks.json"), "utf8"));
  assert.equal(installed.description, "local lifecycle hooks");
  assert.equal(installed.hooks.PostToolUse[0].hooks[0].command, "local-post");
  assert.ok(installed.hooks.SessionStart);
});

test("CLI projects and checks a scratch project", () => {
  const root = fixture();
  const script = new URL("../scripts/project-codex-hooks.mjs", import.meta.url);
  const projected = spawnSync(process.execPath, [script.pathname, "--root", root], { encoding: "utf8" });
  assert.equal(projected.status, 0, projected.stderr);
  assert.match(projected.stdout, /^projected /u);
  const checked = spawnSync(process.execPath, [script.pathname, "--root", root, "--check"], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /^checked /u);
});
