#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry, acquireJournalLock, jobDigest } from "../../src/fabric/inference-broker.mjs";
import { appendJsonl, dispatchJobs, observationsFromRecords, readJsonl, inferenceRegistryFromCatalog } from "../../src/fabric/inference-fabric.mjs";
import { sha256Digest, sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";

const valued = new Set(["input", "output", "registry", "concurrency", "attempts", "history", "summary", "providers"]); const booleans = new Set(["resume", "dry-run", "help", "recover-stale-lock", "roundtable"]);
function parse(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { const raw = argv[i]; if (!raw.startsWith("--")) throw new Error(`unexpected argument ${raw}`); const key = raw.slice(2); if (booleans.has(key)) out[key] = true; else if (valued.has(key)) { const value = argv[++i]; if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`); out[key] = value; } else throw new Error(`unknown flag --${key}`); } return out; }
function usage(code) { process.stderr.write("usage: dispatch-jsonl --input jobs.jsonl --output results.jsonl [--registry registry.json] [--providers provider-id,...] [--roundtable] [--summary summary.json] [--resume] [--recover-stale-lock] [--concurrency N] [--attempts N] [--history results.jsonl] [--dry-run]\n"); process.exit(code); }
let args; try { args = parse(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); usage(2); }
if (args.help) usage(0); if (!args.input || !args.output) usage(2); if (args.concurrency && (!Number.isInteger(Number(args.concurrency)) || Number(args.concurrency) < 1)) { process.stderr.write("--concurrency must be a positive integer\n"); usage(2); } if (args.attempts && (!Number.isInteger(Number(args.attempts)) || Number(args.attempts) < 1)) { process.stderr.write("--attempts must be a positive integer\n"); usage(2); }
const input = resolve(args.input), output = resolve(args.output), summaryPath = args.summary ? resolve(args.summary) : null;
const catalogPath = fileURLToPath(new URL("./content/openai/providers/catalog.json", import.meta.resolve("@red-cup-engineering/computer-inference-engine/package.json")));
const registryPath = args.registry ? resolve(args.registry) : catalogPath;
if ([input, registryPath].includes(output) || (summaryPath && [input, output, registryPath].includes(summaryPath))) throw new Error("input, output, summary, and registry paths must differ");
const inputBytes = readFileSync(input), registryBytes = readFileSync(registryPath);
const registry = args.registry ? loadRegistry(registryPath).registry : inferenceRegistryFromCatalog(JSON.parse(registryBytes), { ...(args.providers ? { providerIds: args.providers.split(",") } : {}) });
if (args.registry && args.providers) { const selected = new Set(args.providers.split(",")); registry.endpoints = registry.endpoints.filter((endpoint) => selected.has(endpoint.id)); }
if (!registry.endpoints.length) throw new Error(`no admitted providers: ${JSON.stringify(registry.excluded)}`);
const lock = acquireJournalLock(output, registryPath, args["recover-stale-lock"]);
const releaseLock = () => lock.release();
try {
const priorRecords = args.resume && existsSync(output) ? readJsonl(output) : [], prior = new Set(priorRecords.map((record) => record.id));
const historyPath = args.history ? resolve(args.history) : null, historyBytes = historyPath ? readFileSync(historyPath) : null, historyRecords = historyPath ? readJsonl(historyPath) : [];
const observations = observationsFromRecords(historyRecords);
  const sourceJobs = readJsonl(input);
  if (args.roundtable && sourceJobs.some((job) => job.preferEndpoints && !registry.endpoints.some((endpoint) => job.preferEndpoints.includes(endpoint.id)))) throw new Error("roundtable job has no admitted preferred endpoint");
  const jobs = args.roundtable ? sourceJobs.flatMap((job) => registry.endpoints.filter((endpoint) => !job.preferEndpoints || job.preferEndpoints.includes(endpoint.id)).map((endpoint) => ({ ...job, id: `${job.id}::${endpoint.id}`, preferEndpoints: [endpoint.id] }))) : sourceJobs;
  const digests = new Map(jobs.map((job) => [job.id, jobDigest(job)]));
  const resumed = priorRecords.filter((record) => digests.has(record.id));
  for (const record of resumed) {
    if (!record.jobDigest || record.jobDigest !== digests.get(record.id)) throw new Error(`cannot resume ${record.id}: prior payload is unverified or changed; use a new output journal`);
    if (record.dryRun !== Boolean(args["dry-run"])) throw new Error(`cannot resume ${record.id}: execution mode changed; use a new output journal`);
  }
  const startedAt = new Date().toISOString();
  const result = await dispatchJobs(jobs, registry, { completed: prior, concurrency: args.concurrency ? Number(args.concurrency) : undefined, attempts: args.attempts ? Number(args.attempts) : undefined, observations, dryRun: Boolean(args["dry-run"]), onRecord: (record) => appendJsonl(output, { ...record, jobDigest: digests.get(record.id), dryRun: Boolean(args["dry-run"]) }) });
  const summary = {
    type: "InferenceFabricDispatchSummary",
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun: Boolean(args["dry-run"]),
    excludedProviders: registry.excluded ?? [],
    input: { digest: sha256Digest(inputBytes), jobs: jobs.length, skippedByResume: jobs.length - result.records.length },
    history: historyBytes ? { digest: sha256Digest(historyBytes), records: historyRecords.length } : null,
    registryDigest: sha256Digest(registryBytes),
    output: { recordsAppended: result.records.length },
    throughput: result.summary
  };
  if (summaryPath) { mkdirSync(dirname(summaryPath), { recursive: true }); writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx", mode: 0o600 }); }
  process.stderr.write(`${JSON.stringify(summary)}\n`);
  if ([...resumed, ...result.records].some((record) => record.refusal)) process.exitCode = 1;
} finally { releaseLock(); }
