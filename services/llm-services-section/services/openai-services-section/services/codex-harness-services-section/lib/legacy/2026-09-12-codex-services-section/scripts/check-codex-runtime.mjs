#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { installHooks } from "./project-codex-hooks.mjs";
import { loadPolicy } from "./project-codex-agent-harness.mjs";
import { evaluateHarnessParity } from "../src/harness-parity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
function isRepoRootDirectory(dir) {
  return existsSync(join(dir, ".git")) && existsSync(join(dir, "lib/emsenn"));
}
function repositoryRoot() {
  let current = HERE;
  while (true) {
    if (isRepoRootDirectory(current) && existsSync(join(current, "lib/emsenn"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot locate repository root");
    current = parent;
  }
}
const REPO = repositoryRoot();
const RUNTIME = resolve(process.env.CODEX_RUNTIME_ROOT ?? "/home/emsenn/.codex");

function directories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
}
function configPaths(path) {
  const source = readFileSync(path, "utf8"), values = [];
  for (const match of source.matchAll(/^(?:args\s*=\s*\["([^"]+)"\]|cwd\s*=\s*"([^"]+)")/gmu)) values.push(match[1] ?? match[2]);
  return values.filter((value) => value.startsWith("/"));
}
function hookCommands(path) {
  const source = JSON.parse(readFileSync(path, "utf8"));
  return Object.values(source.hooks ?? {}).flatMap((groups) => groups.flatMap((group) => group.hooks ?? [])).map(({ command }) => command).filter(Boolean);
}
function executablePaths(command) { return command.split(/\s+/u).slice(0, 2).filter((value) => value.startsWith("/")); }

function filesBelow(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesBelow(join(path, entry.name)) : entry.isFile() ? [join(path, entry.name)] : []);
}

function checkCodexStateStore() {
  const database = join(RUNTIME, "state_5.sqlite"), sessions = join(RUNTIME, "sessions");
  if (!existsSync(database)) throw new Error(`Codex state database is missing: ${database}`);
  const query = "PRAGMA integrity_check; SELECT id || char(9) || rollout_path FROM threads ORDER BY id;";
  const result = spawnSync("sqlite3", ["-readonly", database, query], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Codex state database assay failed: ${result.stderr || result.stdout}`);
  const [integrity, ...rows] = result.stdout.trim().split("\n");
  if (integrity !== "ok") throw new Error(`Codex state database integrity failed: ${integrity}`);
  const indexed = new Map(rows.map((line) => { const at = line.indexOf("\t"); return [line.slice(0, at), line.slice(at + 1)]; }));
  const transcripts = filesBelow(sessions).filter((path) => path.endsWith(".jsonl"));
  const transcriptIds = new Map(transcripts.map((path) => [path.match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/u)?.[1], path]).filter(([id]) => id));
  const missingFiles = [...indexed].filter(([, path]) => !existsSync(path)).map(([id, path]) => ({ id, path }));
  const unindexedFiles = [...transcriptIds].filter(([id]) => !indexed.has(id)).map(([id, path]) => ({ id, path }));
  if (missingFiles.length || unindexedFiles.length || indexed.size !== transcriptIds.size) throw new Error(`Codex state index and transcript tree disagree: ${JSON.stringify({ indexed: indexed.size, transcripts: transcriptIds.size, missingFiles, unindexedFiles })}`);
  return Object.freeze({ integrity, indexedThreads: indexed.size, transcriptFiles: transcriptIds.size, disposition: "bijective-and-healthy" });
}

export function checkCodexRuntime() {
  const policy = loadPolicy();
  const hooks = policy.features.hooks
    ? installHooks({ root: dirname(RUNTIME), check: true })
    : Object.freeze({ targets: Object.freeze([]), checked: true, disposition: "lifecycle-hooks-disabled-by-active-policy" });
  const runtimeConfig = join(RUNTIME, "config.toml"), runtimeHooks = join(RUNTIME, "hooks.json");
  for (const path of [runtimeConfig, runtimeHooks]) if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`required Codex runtime file is missing: ${path}`);
  const referenced = [...configPaths(runtimeConfig), ...hookCommands(runtimeHooks).flatMap(executablePaths)];
  const missing = [...new Set(referenced.filter((path) => !existsSync(path)))];
  if (missing.length) throw new Error(`Codex runtime references missing paths: ${missing.join(", ")}`);
  const globalSkills = directories(join(RUNTIME, "skills")), projectSkills = directories(join(REPO, ".codex/skills"));
  const duplicates = globalSkills.filter((name) => projectSkills.includes(name));
  if (duplicates.length) throw new Error(`global and project skill names collide: ${duplicates.join(", ")}`);
  const preservedSources = [];
  const activeText = `${readFileSync(runtimeConfig, "utf8")}\n${readFileSync(runtimeHooks, "utf8")}`;
  if (/\.codex\.bk(?:\.newer|\.runtime-skills-20260727)?/u.test(activeText)) throw new Error("active harness references a preserved backup tree");
  const parity = evaluateHarnessParity();
  if (parity.sourceDrift.length || parity.uncoveredSources.length || parity.invalidActuators.length) throw new Error(`harness parity baseline is invalid: ${JSON.stringify(parity)}`);
  return Object.freeze({
    type: "CodexRuntimePreflight", disposition: "static-runtime-current", runtimeRoot: RUNTIME,
    hookTargets: hooks.targets, referencedPaths: [...new Set(referenced)].sort(),
    globalSkills, projectSkills, preservedSources, stateStore: checkCodexStateStore(), harnessParity: { demand: parity.baselineDemand, disposition: parity.disposition, capabilityCount: parity.capabilityCount },
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { process.stdout.write(`${JSON.stringify(checkCodexRuntime(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`check-codex-runtime: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
