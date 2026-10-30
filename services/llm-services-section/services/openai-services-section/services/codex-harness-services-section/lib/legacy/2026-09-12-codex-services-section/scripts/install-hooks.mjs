#!/usr/bin/env node
// Installs (or checks) this package's Codex CLI lifecycle hooks into a
// project's .codex/hooks.json, described declaratively by
// config/hooks-manifest.json. Hooks this package didn't declare are left
// untouched, so it can coexist with other installed hooks.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(PACKAGE_ROOT, "config/hooks-manifest.json");
const BOUNDED_CONTEXT_EVENTS = new Set(["SubagentStart"]);

function parseArguments(argv) {
  let root, check = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--check") check = true;
    else if (argv[index] === "--root") {
      if (!argv[index + 1]) throw new TypeError("--root requires one project directory");
      root = resolve(argv[(index += 1)]);
    } else throw new TypeError(`unknown argument ${argv[index]}`);
  }
  if (root === undefined) throw new TypeError("--root requires one destination path");
  return { root, check };
}

function readManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.version !== 1 || !manifest.handlers || !manifest.events) throw new TypeError("invalid hooks manifest");
  return manifest;
}

function existingHookConfig(root) {
  const path = join(root, ".codex/hooks.json");
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && value.hooks && typeof value.hooks === "object" ? value : null;
  } catch {
    throw new TypeError(`installed Codex hooks configuration is not valid JSON: ${path}`);
  }
}

function mergedHookConfig(root, projected) {
  const existing = existingHookConfig(root);
  if (!existing) return projected;
  return { ...existing, hooks: { ...existing.hooks, ...projected.hooks } };
}

export function projectHooks(options = {}) {
  const manifest = options.manifest ?? readManifest();
  const handlers = Object.fromEntries(Object.entries(manifest.handlers).map(([name, relative]) => {
    const source = resolve(PACKAGE_ROOT, relative);
    if (!existsSync(source)) throw new TypeError(`missing hook handler ${name}: ${source}`);
    return [name, source];
  }));
  const hooks = Object.fromEntries(Object.entries(manifest.events).map(([event, entries]) => [event, entries.map((entry) => {
    const source = handlers[entry.handler];
    if (!source) throw new TypeError(`event ${event} names unknown handler ${entry.handler}`);
    const group = {
      hooks: [{
        type: "command",
        command: `${process.execPath} ${source}`,
        timeout: event === "SessionEnd" ? 3 : event === "PostToolUse" ? 30 : 10,
        statusMessage: entry.statusMessage,
        ...(event === "PostToolUse" ? { additionalContextLimit: 4000 } : BOUNDED_CONTEXT_EVENTS.has(event) ? { additionalContextLimit: 512 } : {}),
      }],
    };
    if (entry.matcher !== undefined) group.matcher = entry.matcher;
    return group;
  })]));
  return Object.freeze({ description: manifest.description, hooks });
}

export function installHooks(options = {}) {
  if (typeof options.root !== "string" || options.root.length === 0) throw new TypeError("root path is required");
  const root = resolve(options.root);
  const projected = projectHooks(options);
  const installed = mergedHookConfig(root, projected);
  const hooksPath = join(root, ".codex/hooks.json");
  const expected = `${JSON.stringify(installed, null, 2)}\n`;
  if (options.check) {
    const actual = existingHookConfig(root);
    const stale = !existsSync(hooksPath) || !actual || Object.entries(projected.hooks).some(([event, value]) => JSON.stringify(actual.hooks[event]) !== JSON.stringify(value));
    if (stale) throw new Error(`Codex hooks projection is stale or missing: ${hooksPath}`);
    return Object.freeze({ target: hooksPath, changed: false, checked: true });
  }
  mkdirSync(dirname(hooksPath), { recursive: true });
  const changed = !existsSync(hooksPath) || readFileSync(hooksPath, "utf8") !== expected;
  if (changed) {
    const temporary = `${hooksPath}.${process.pid}.tmp`;
    writeFileSync(temporary, expected, { mode: 0o600 });
    renameSync(temporary, hooksPath);
  }
  return Object.freeze({ target: hooksPath, changed, checked: false });
}

function main(argv) {
  const result = installHooks(parseArguments(argv));
  process.stdout.write(`${result.checked ? "checked" : result.changed ? "projected" : "unchanged"} ${result.target}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`install-hooks: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
