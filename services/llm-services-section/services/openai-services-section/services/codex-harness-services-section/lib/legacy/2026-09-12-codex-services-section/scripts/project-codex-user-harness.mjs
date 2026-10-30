#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicy } from "./project-codex-agent-harness.mjs";

// AGENTS.md is no longer projected here: it was hand-authored prose with no
// generator behind it, and its "standing authority" framing was the exact
// shape of a prompt-injection self-authorization grant (see the removed
// `authorityContract` field this file used to assert against). The Leader
// removed the source doc rather than keep curating a policy document this
// projector could silently restore. Only .codex/hooks.json is projected now.
function projections(target) {
  const projected = new Map([
    [join(target, ".codex/hooks.json"), `${JSON.stringify({ description: "Lifecycle receipt hooks are opt-in; skills provide task-local process.", hooks: {} }, null, 2)}\n`],
  ]);
  return projected;
}

function table(config, name) {
  const quoted = JSON.stringify(name).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return config.match(new RegExp(`(?:^|\\n)\\[mcp_servers\\.${quoted}\\]\\n([\\s\\S]*?)(?=\\n\\[|$)`, "u"))?.[1] ?? "";
}

function validateConfig(target) {
  const path = join(target, ".codex/config.toml");
  if (!existsSync(path)) throw new Error(`Codex user config is missing: ${path}`);
  const config = readFileSync(path, "utf8");
  const policy = loadPolicy();
  for (const [name, server] of Object.entries(policy.mcpServers)) {
    const boundary = table(config, name);
    if (boundary.length === 0) throw new Error(`Codex user config does not expose ${name}`);
    if (!new RegExp(`^enabled\\s*=\\s*${server.enabled}$`, "mu").test(boundary)) throw new Error(`Codex user config must set ${name} enabled = ${server.enabled}`);
    for (const tool of server.enabledTools) if (!boundary.includes(`"${tool}"`)) throw new Error(`Codex user config does not expose ${name}.${tool}`);
    for (const [key, value] of Object.entries(server.environment ?? {})) if (!boundary.includes(`${key} = ${JSON.stringify(value)}`)) throw new Error(`Codex user config does not project ${name} environment ${key}`);
  }
  return path;
}

export function projectCodexUserHarness({ target, configRoot, check = false } = {}) {
  if (typeof target !== "string" || target.length === 0) throw new TypeError("target path is required");
  target = resolve(target);
  configRoot = resolve(configRoot ?? target);
  const expected = projections(target);
  if (check) {
    const stale = [...expected].filter(([path, content]) => !existsSync(path) || readFileSync(path, "utf8") !== content).map(([path]) => path);
    if (stale.length) throw new Error(`Codex user harness is stale or missing: ${stale.join(", ")}`);
    const config = validateConfig(configRoot);
    return Object.freeze({ actor: "urn:ame:bare-cedar-fog-codex", disposition: "user-harness-current", target, files: [...expected.keys()], config });
  }
  for (const [path, content] of expected) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path) && readFileSync(path, "utf8") === content) continue;
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, content, { mode: 0o600 });
    renameSync(temporary, path);
  }
  return Object.freeze({ actor: "urn:ame:bare-cedar-fog-codex", disposition: "user-harness-projected", target, files: [...expected.keys()] });
}

function parse(argv) {
  let target, configRoot, check = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--check") check = true;
    else if (argv[index] === "--config-root") {
      if (!argv[index + 1]) throw new TypeError("--config-root requires one directory");
      configRoot = argv[index += 1];
    }
    else if (argv[index] === "--target") {
      if (!argv[index + 1]) throw new TypeError("--target requires one destination path");
      target = argv[index += 1];
    }
    else throw new TypeError(`unknown argument ${argv[index]}`);
  }
  if (target === undefined) throw new TypeError("--target requires one destination path");
  return { target, configRoot, check };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { process.stdout.write(`${JSON.stringify(projectCodexUserHarness(parse(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`project-codex-user-harness: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
