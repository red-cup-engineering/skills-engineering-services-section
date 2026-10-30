#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectCodexHooks } from "@red-cup-engineering/codex-harness-projection-service/projector";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
function repositoryRootFromPackage() {
  let current = PACKAGE_ROOT;
  while (true) {
    if (existsSync(join(current, ".git")) && existsSync(join(current, "lib/emsenn"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot resolve Git repository root containing lib/emsenn");
    current = parent;
  }
}
const SOURCE_ROOT = repositoryRootFromPackage();
const MANIFEST = join(PACKAGE_ROOT, "agents/harness/codex-hooks.manifest.json");
const BOUNDED_CONTEXT_EVENTS = new Set(["SessionStart", "UserPromptSubmit"]);

function parseArguments(argv) {
  let root, check = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--check") check = true;
    else if (argv[index] === "--root") {
      if (!argv[index + 1]) throw new TypeError("--root requires one project directory");
      root = resolve(argv[index += 1]);
    } else throw new TypeError(`unknown argument ${argv[index]}`);
  }
  if (root === undefined) throw new TypeError("--root requires one destination path");
  return { root, check };
}

function readManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  if (manifest.version !== 1 || !manifest.handlers || !manifest.events || !manifest.projections) throw new TypeError("invalid Codex hooks manifest");
  return manifest;
}

export function projectHooks(options = {}) {
  const sourceRoot = resolve(options.sourceRoot ?? SOURCE_ROOT);
  const manifest = options.manifest ?? readManifest();
  const handlers = Object.fromEntries(Object.entries(manifest.handlers).map(([name, relative]) => {
    const source = resolve(sourceRoot, relative);
    const projectedSource = manifest.projections?.[relative];
    if (!existsSync(source) && (!projectedSource || !existsSync(join(PACKAGE_ROOT, projectedSource)))) {
      throw new TypeError(`missing hook handler ${name}: ${source}`);
    }
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
  const manifest = options.manifest ?? readManifest();
  const projected = projectHooks({ ...options, manifest });
  const hookProjection = projectCodexHooks({ target: root, projection: projected, check: options.check === true });
  const fileProjections = Object.entries(manifest.projections).map(([target, source]) => [join(root, target), readFileSync(join(PACKAGE_ROOT, source), "utf8")]);
  if (options.check) {
    const stale = fileProjections.filter(([target, expected]) => !existsSync(target) || readFileSync(target, "utf8") !== expected).map(([target]) => target);
    if (stale.length) throw new Error(`Codex hooks projection is stale or missing: ${stale.join(", ")}`);
    return Object.freeze({ target: hookProjection.target, targets: Object.freeze([hookProjection.target, ...fileProjections.map(([target]) => target)]), changed: false, checked: true });
  }
  let changed = hookProjection.changed;
  for (const [target, expected] of fileProjections) {
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target) && readFileSync(target, "utf8") === expected) continue;
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, expected, { mode: 0o600 });
    renameSync(temporary, target);
    changed = true;
  }
  return Object.freeze({ target: hookProjection.target, targets: Object.freeze([hookProjection.target, ...fileProjections.map(([target]) => target)]), changed, checked: false });
}

function main(argv) {
  const result = installHooks(parseArguments(argv));
  process.stdout.write(`${result.checked ? "checked" : result.changed ? "projected" : "unchanged"} ${result.target}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`project-codex-hooks: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
