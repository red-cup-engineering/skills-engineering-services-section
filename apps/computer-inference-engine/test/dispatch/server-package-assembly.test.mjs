import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url)));
const dependency = "@red-cup-engineering/a2a-services-section";
// A child process resolves house packages only with the same --import hooks as this one.
const importFlags = process.execArgv.flatMap((flag, index, flags) => flag === "--import" ? [flag, flags[index + 1]] : flag.startsWith("--import=") ? [flag] : []);

test("advertised A2A server has an installed mandatory provider and no phantom main", async () => {
  assert.equal(manifest.dependencies[dependency], "1.0.0");
  assert.equal(manifest.peerDependencies?.[dependency], undefined);
  assert.equal(manifest.peerDependenciesMeta?.[dependency], undefined);
  assert.equal(manifest.main, undefined);
  assert.equal(typeof (await import(`${dependency}/a2a-server`)).createA2aServerProcess, "function");
  const checked = spawnSync(process.execPath, ["--check", manifest.bin["serve-inference-work-lot-a2a"]], { cwd: root, encoding: "utf8" });
  assert.equal(checked.error, undefined);
  assert.equal(checked.status, 0, checked.stderr);
});

test("installed server assembles its declared provider without opening a listener", () => {
  const source = [
    'import assert from "node:assert/strict";',
    'import { mock } from "node:test";',
    'let assembled;',
    'const signing = await import("@red-cup-engineering/a2a-services-section/agent-card-signing");',
    'mock.module("@red-cup-engineering/a2a-services-section/agent-card-signing", { namedExports: {',
    '  ...signing, loadSignedAgentCard: async () => ({ card: { name: "stub-agent-card" }, jwks: { keys: [] } }),',
    '} });',
    'mock.module("@red-cup-engineering/a2a-services-section/a2a-server", { namedExports: {',
    '  createA2aServer: async (options) => { assembled = options; return { close: async () => {} }; },',
    '  createA2aServerProcess: async (options, config) => { await config.serve(options); },',
    '} });',
    'await import("./scripts/dispatch/server.mjs");',
    'assert.ok(assembled);',
    'assert.equal(typeof assembled.handlers["message/send"], "function");',
    'assert.deepEqual(assembled.agentCard, { name: "stub-agent-card" });',
    'assert.equal(assembled.port, 8796);',
    'assert.equal(assembled.host, "127.0.0.1");',
  ].join("\n");
  const env = { ...process.env };
  for (const key of ["NODE_TEST_CONTEXT", "PORT", "HOST", "BASE_URL"]) delete env[key];
  const result = spawnSync(process.execPath, [...importFlags, "--experimental-test-module-mocks", "--input-type=module", "--eval", source], { cwd: root, env, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
