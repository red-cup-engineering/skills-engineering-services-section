#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { appendJsonl, dispatchJobs, observationsFromRecords, readJsonl } from "./inference-fabric.mjs";

const valued = new Set(["input", "output", "registry", "concurrency", "attempts", "history"]); const booleans = new Set(["resume", "dry-run", "help", "recover-stale-lock"]);
function parse(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { const raw = argv[i]; if (!raw.startsWith("--")) throw new Error(`unexpected argument ${raw}`); const key = raw.slice(2); if (booleans.has(key)) out[key] = true; else if (valued.has(key)) { const value = argv[++i]; if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`); out[key] = value; } else throw new Error(`unknown flag --${key}`); } return out; }
function usage(code) { process.stderr.write("usage: dispatch-jsonl --input jobs.jsonl --output results.jsonl --registry registry.json [--resume] [--recover-stale-lock] [--concurrency N] [--attempts N] [--history results.jsonl] [--dry-run]\n"); process.exit(code); }
let args; try { args = parse(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); usage(2); }
if (args.help) usage(0); if (!args.input || !args.output || !args.registry) usage(2); if (args.concurrency && (!Number.isInteger(Number(args.concurrency)) || Number(args.concurrency) < 1)) { process.stderr.write("--concurrency must be a positive integer\n"); usage(2); } if (args.attempts && (!Number.isInteger(Number(args.attempts)) || Number(args.attempts) < 1)) { process.stderr.write("--attempts must be a positive integer\n"); usage(2); }
const input = resolve(args.input), output = resolve(args.output), registryPath = resolve(args.registry), registryDir = dirname(registryPath), registry = JSON.parse(readFileSync(registryPath, "utf8")); const base = registry.baseDir ? resolve(registryDir, registry.baseDir) : registryDir;
for (const endpoint of registry.endpoints ?? []) { if (endpoint.command && !isAbsolute(endpoint.command)) endpoint.command = resolve(base, endpoint.command); if (endpoint.cwd && !isAbsolute(endpoint.cwd)) endpoint.cwd = resolve(base, endpoint.cwd); }
const ids = (registry.endpoints ?? []).map((e) => e.id); if (!ids.length || ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length || !registry.endpoints.some((e) => e.enabled !== false)) { process.stderr.write("registry requires unique nonempty endpoint ids and one enabled endpoint\n"); process.exit(2); }
const lockPath = `${output}.lock`;
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const acquireLock = () => { mkdirSync(dirname(lockPath), { recursive: true }); try { const fd = openSync(lockPath, "wx"); writeFileSync(fd, JSON.stringify({ pid: process.pid, input, output, registry: registryPath, startedAt: new Date().toISOString() })); closeSync(fd); return; } catch (error) { if (error.code !== "EEXIST") throw error; }
  let existing = {}; try { existing = JSON.parse(readFileSync(lockPath, "utf8")); } catch {}
  if (Number.isInteger(existing.pid) && pidAlive(existing.pid)) { process.stderr.write(`output lock held by live pid ${existing.pid}\n`); process.exit(3); }
  if (!args["recover-stale-lock"]) { process.stderr.write("stale output lock exists; rerun with --recover-stale-lock to archive it\n"); process.exit(3); }
  renameSync(lockPath, `${lockPath}.stale-${Date.now()}`); return acquireLock();
};
acquireLock(); let released = false; const releaseLock = () => { if (!released) { released = true; try { unlinkSync(lockPath); } catch {} } }; process.on("SIGINT", () => { releaseLock(); process.exit(130); }); process.on("SIGTERM", () => { releaseLock(); process.exit(143); });
const priorRecords = args.resume && existsSync(output) ? readJsonl(output) : [], prior = new Set(priorRecords.map((record) => record.id));
const historyRecords = args.history ? readJsonl(resolve(args.history)) : [];
const mergeObservations = (...sources) => {
  const merged = {};
  for (const source of sources) for (const [endpoint, workTypes] of Object.entries(source ?? {})) for (const [workType, value] of Object.entries(workTypes ?? {})) {
    if (!Number.isInteger(value?.attempts) || !Number.isInteger(value?.successes)) continue;
    const target = (merged[endpoint] ??= {})[workType] ??= { attempts: 0, successes: 0, latencyMs: 0 };
    target.attempts += value.attempts; target.successes += value.successes; target.latencyMs += Number.isFinite(value.latencyMs) ? value.latencyMs : 0;
  }
  return merged;
};
const observations = mergeObservations(registry.observations, observationsFromRecords(historyRecords));
try { const result = await dispatchJobs(readJsonl(input), registry, { completed: prior, concurrency: args.concurrency ? Number(args.concurrency) : undefined, attempts: args.attempts ? Number(args.attempts) : undefined, observations, dryRun: Boolean(args["dry-run"]), onRecord: (record) => appendJsonl(output, record) }); process.stderr.write(`${JSON.stringify(result.summary)}\n`); } finally { releaseLock(); }
