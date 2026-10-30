import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadPolicy, renderConfig } from "../scripts/project-codex-agent-harness.mjs";
import { projectCodexUserHarness } from "../scripts/project-codex-user-harness.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function isRepoRootDirectory(dir) {
  return existsSync(join(dir, ".git")) && existsSync(join(dir, "lib/emsenn"));
}
function repositoryRootFromPackage() {
  let current = PACKAGE_ROOT;
  while (true) {
    if (isRepoRootDirectory(current)) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot resolve enclosing git repository root with lib/emsenn");
    current = parent;
  }
}
const REPO_ROOT = repositoryRootFromPackage();

/**
 * Builds a scratch project directory holding a `.codex/config.toml`
 * rendered exactly as the agent-harness projector renders it: MCP server
 * scripts and packages resolve against the real repository checkout
 * (REPO_ROOT) regardless of where the rendered config file itself lands.
 * @returns {string} the scratch directory path
 */
function scratch() {
  const target = mkdtempSync(join(tmpdir(), "codex-user-harness-"));
  mkdirSync(join(target, ".codex"), { recursive: true });
  writeFileSync(join(target, ".codex/config.toml"), renderConfig(REPO_ROOT, loadPolicy(), process.execPath));
  return target;
}

test("a separate project config root verifies the layered user harness", () => {
  const target = scratch();
  const configRoot = scratch();
  projectCodexUserHarness({ target });
  writeFileSync(join(target, ".codex/config.toml"), "user_only = true\n");
  const checked = projectCodexUserHarness({ target, configRoot, check: true });
  assert.equal(checked.disposition, "user-harness-current");
  assert.equal(checked.config, join(configRoot, ".codex/config.toml"));
});

test("user-harness validation derives startup disposition from canonical policy", () => {
  const target = scratch();
  projectCodexUserHarness({ target });
  const path = join(target, ".codex/config.toml");
  writeFileSync(path, readFileSync(path, "utf8").replace(/(\[mcp_servers\."jsnode-package-survey"\][\s\S]*?enabled = )true/u, "$1false"));
  assert.throws(() => projectCodexUserHarness({ target, check: true }), /jsnode-package-survey enabled = true/u);
});

test("the API and CLI refuse to infer a user home destination", () => {
  assert.throws(() => projectCodexUserHarness(), /target path is required/u);
  const script = new URL("../scripts/project-codex-user-harness.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [script.pathname], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--target requires one destination path/u);
});

test("an explicit scratch destination receives the harness", () => {
  const target = scratch();
  projectCodexUserHarness({ target });
  assert.equal(projectCodexUserHarness({ target, check: true }).disposition, "user-harness-current");
  // AGENTS.md is no longer projected: it was hand-authored policy prose with
  // no generator behind it, and carried the self-authorization language this
  // harness now refuses to restore. Confirm this projector no longer writes it.
  assert.equal(existsSync(join(target, ".codex/AGENTS.md")), false);
  assert.equal(existsSync(join(target, ".codex/skills")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(target, ".codex/hooks.json"), "utf8")).hooks, {});
  writeFileSync(join(target, ".codex/hooks.json"), "drift\n");
  assert.throws(() => projectCodexUserHarness({ target, check: true }), /stale or missing/u);
});
