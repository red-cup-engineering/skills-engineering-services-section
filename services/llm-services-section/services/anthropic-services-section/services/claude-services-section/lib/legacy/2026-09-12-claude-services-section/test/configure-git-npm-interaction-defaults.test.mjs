import test from "node:test";
import assert from "node:assert/strict";
import { configureGitNpmInteractionDefaults } from "../src/configure-git-npm-interaction-defaults.mjs";

// git reads as `config --get <key>` and writes as `config <key> <value>`; npm
// reads as `config get <key>` and writes as `config set <key> <value>`.
function parseInvocation(command, args) {
  if (command === "git") return args[1] === "--get" ? { isGet: true, key: args[2] } : { isGet: false, key: args[1], value: args[2] };
  return args[1] === "get" ? { isGet: true, key: args[2] } : { isGet: false, key: args[2], value: args[3] };
}

function fakeRun(state, writes = []) {
  return (command, args, options) => {
    assert.equal(options.cwd, "/repo");
    const invocation = parseInvocation(command, args);
    if (invocation.isGet) {
      const current = state[command]?.[invocation.key];
      return current === undefined ? { status: 1, stdout: "", stderr: "" } : { status: 0, stdout: `${current}\n`, stderr: "" };
    }
    writes.push([command, invocation.key, invocation.value]);
    state[command] ??= {};
    state[command][invocation.key] = invocation.value;
    return { status: 0, stdout: "", stderr: "" };
  };
}

test("configureGitNpmInteractionDefaults requires a repositoryRoot", () => {
  assert.throws(() => configureGitNpmInteractionDefaults({}), TypeError);
});

test("configureGitNpmInteractionDefaults sets every default from a bare repository", () => {
  const state = {};
  const report = configureGitNpmInteractionDefaults({ repositoryRoot: "/repo", run: fakeRun(state) });
  assert.deepEqual(report.git, [{ key: "status.submodulesummary", previous: null, applied: "false", changed: true }]);
  assert.deepEqual(report.npm, [
    { key: "audit", previous: null, applied: "false", changed: true },
    { key: "fund", previous: null, applied: "false", changed: true },
    { key: "prefer-offline", previous: null, applied: "true", changed: true },
  ]);
  assert.equal(state.git["status.submodulesummary"], "false");
  assert.equal(state.npm.audit, "false");
});

test("configureGitNpmInteractionDefaults is idempotent against an already-configured host", () => {
  const state = { git: { "status.submodulesummary": "false" }, npm: { audit: "false", fund: "false", "prefer-offline": "true" } };
  const writes = [];
  const report = configureGitNpmInteractionDefaults({ repositoryRoot: "/repo", run: fakeRun(state, writes) });
  assert.ok(report.git.every((entry) => entry.changed === false));
  assert.ok(report.npm.every((entry) => entry.changed === false));
  assert.deepEqual(writes, []);
});

test("configureGitNpmInteractionDefaults throws when a config write fails", () => {
  const run = (command, args) => (args.includes("--get") || args[0] === "get" ? { status: 1, stdout: "", stderr: "" } : { status: 1, stdout: "", stderr: "permission denied" });
  assert.throws(() => configureGitNpmInteractionDefaults({ repositoryRoot: "/repo", run }), /permission denied/u);
});
