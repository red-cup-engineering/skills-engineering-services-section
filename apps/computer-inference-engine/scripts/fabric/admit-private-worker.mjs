#!/usr/bin/env node
import { isMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { appendJsonl, createInferenceScheduler, readJsonl } from "../../src/fabric/inference-fabric.mjs";
import { canonicalJsonValue as canonical } from "@red-cup-engineering/json-services-section/canonical-json";
import { writeFileTextSync } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

const valued = new Set(["offer", "probe", "base-registry", "ledger", "ledger-root", "output-registry"]), booleans = new Set(["reproject", "recover-stale-lock", "help"]);
function parse(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { const raw = argv[index]; if (!raw.startsWith("--")) throw new Error(`unexpected argument ${raw}`); const key = raw.slice(2); if (booleans.has(key)) out[key] = true; else if (valued.has(key)) { const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`); out[key] = value; } else throw new Error(`unknown flag --${key}`); } return out; }
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const identifier = (value, name) => { if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value ?? "")) throw new Error(`${name} is invalid`); return value; };
const environmentName = (value, name) => { if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(value ?? "")) throw new Error(`${name} is invalid`); return value; };
const positiveInteger = (value, name, maximum = 100000) => { if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`); return value; };
const readBoundedJson = (path, name) => { const target = resolve(path); if (statSync(target).size > 1024 * 1024) throw new Error(`${name} exceeds 1 MiB`); return JSON.parse(readFileSync(target, "utf8")); };
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const datedLedger = (root, now = new Date()) => { const year = String(now.getFullYear()), month = String(now.getMonth() + 1).padStart(2, "0"), day = String(now.getDate()).padStart(2, "0"), date = `${year}-${month}-${day}`; return join(root, year, month, day, `${date}-logical-inference-service-section-supplier-admissions.jsonl`); };
function ledgerFiles(root) { if (!existsSync(root)) return []; const found = []; const visit = (directory) => { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) visit(path); else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(path); } }; visit(root); return found.sort(); }

function validateCost(cost) {
  if (!cost || typeof cost !== "object" || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(cost.unit ?? "")) throw new Error("offer cost unit is invalid");
  for (const key of ["dispatch", "inference", "verification", "scarcity"]) if (!Number.isFinite(cost[key]) || cost[key] < 0 || cost[key] > 1_000_000) throw new Error(`offer ${key} cost is invalid`);
  return cost;
}

function candidateFromEvidence(offer, probe, baseRegistry) {
  if (offer?.type !== "PrivateInferenceWorkerOffer") throw new Error("offer type is invalid");
  const endpointId = identifier(offer.endpointId, "offer endpointId"), model = identifier(offer.model?.alias, "offer model alias"), baseUrlEnv = environmentName(offer.baseUrlEnvironmentAtLiss, "offer base URL environment"), apiKeyEnv = environmentName(offer.credential?.environmentAtLiss, "offer API key environment");
  if (offer.network?.carrier !== "tailscale-serve" || offer.network?.publicExposureAuthorized !== false || offer.credential?.kind !== "file-backed-bearer") throw new Error("offer network or credential boundary is invalid");
  if (offer.terms?.authoredBy !== "worker-operator") throw new Error("offer terms must be worker-operator authored");
  const concurrency = positiveInteger(offer.terms?.capacity?.concurrency, "offered concurrency", 64), rpm = positiveInteger(offer.terms?.capacity?.rpm, "offered rpm"), cost = validateCost(offer.terms?.cost);
  if (offer.admission?.command !== "probe-openai-endpoint" || offer.admission?.required !== "admitted=true" || offer.admission.requests !== positiveInteger(offer.admission?.requests, "offer probe requests", 128) || offer.admission.concurrency !== concurrency || offer.admission.rpm !== rpm) throw new Error("offer admission terms do not match offered capacity");
  if (probe?.type !== "OpenAICompatibleEndpointProbe" || probe.admitted !== true || probe.requests !== offer.admission.requests || probe.verified !== probe.requests || probe.refused !== 0 || probe.verifiedYield !== 1) throw new Error("probe did not meet the offered admission requirement");
  const candidate = probe.registryEndpointCandidate;
  if (!candidate || candidate.id !== endpointId || probe.endpoint?.id !== endpointId || candidate.model !== model || probe.endpoint?.model !== model || candidate.type !== "openai-compatible" || candidate.enabled !== true || candidate.baseUrl !== undefined || candidate.baseUrlEnv !== baseUrlEnv || candidate.apiKeyEnv !== apiKeyEnv || probe.endpoint?.apiKeyEnvironment !== apiKeyEnv || candidate.concurrency !== concurrency || candidate.rpm !== rpm) throw new Error("probe candidate does not match the worker offer");
  if (!Array.isArray(candidate.capabilities) || !candidate.capabilities.includes("chat") || !Array.isArray(candidate.workTypes) || !candidate.workTypes.length || !Number.isFinite(candidate.expectedLatencyMs) || candidate.expectedLatencyMs < 0) throw new Error("probe candidate evidence is incomplete");
  const baseIdList = (baseRegistry.endpoints ?? []).map((endpoint) => endpoint.id); if (baseIdList.some((id) => typeof id !== "string" || !id) || new Set(baseIdList).size !== baseIdList.length) throw new Error("base registry endpoint ids are invalid or duplicated"); const baseIds = new Set(baseIdList); if (baseIds.has(endpointId)) throw new Error(`endpoint id already exists in base registry: ${endpointId}`);
  const enabledUnits = new Set((baseRegistry.endpoints ?? []).filter((endpoint) => endpoint.enabled !== false).map((endpoint) => (endpoint.profile ?? endpoint).cost?.unit).filter(Boolean)); if (enabledUnits.size > 1 || (enabledUnits.size === 1 && !enabledUnits.has(cost.unit))) throw new Error("offered cost unit is not comparable with the base registry");
  return { ...candidate, concurrency, rpm, cost };
}

function validateAdmissionRecords(records, baseRegistry) {
  const ids = new Set((baseRegistry.endpoints ?? []).map((endpoint) => endpoint.id));
  for (const record of records) { if (record?.type !== "PrivateInferenceWorkerAdmission" || !record.registryEndpointCandidate) throw new Error("admission ledger contains an invalid record"); const id = record.registryEndpointCandidate.id; if (ids.has(id)) throw new Error(`duplicate admitted endpoint id: ${id}`); ids.add(id); }
}

function projectRegistry(baseRegistry, records, basePath, outputPath) {
  if (dirname(basePath) !== dirname(outputPath)) throw new Error("base and runtime registry must share a directory so relative baseDir semantics remain fixed");
  if (basePath === outputPath) throw new Error("runtime registry must not overwrite the base registry"); validateAdmissionRecords(records, baseRegistry);
  const projection = { ...baseRegistry, projection: { type: "InferenceFabricRegistryProjection", generatedAt: new Date().toISOString(), baseRegistryDigest: semanticId(baseRegistry), admissions: records.length }, endpoints: [...(baseRegistry.endpoints ?? []), ...records.map((record) => record.registryEndpointCandidate)] };
  const validationScheduler = createInferenceScheduler(projection); validationScheduler.stop();
  writeFileTextSync(outputPath, `${JSON.stringify(projection, null, 2)}\n`, { mode: 0o600 });
  return projection;
}

function acquireLock(path, recover) {
  mkdirSync(dirname(path), { recursive: true });
  try { const descriptor = openSync(path, "wx"); writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); closeSync(descriptor); }
  catch (error) { if (error.code !== "EEXIST") throw error; let existing = {}; try { existing = JSON.parse(readFileSync(path, "utf8")); } catch {} if (Number.isInteger(existing.pid) && pidAlive(existing.pid)) throw new Error(`admission lock held by live pid ${existing.pid}`); if (!recover) throw new Error("stale admission lock exists; use --recover-stale-lock"); renameSync(path, `${path}.stale-${Date.now()}`); return acquireLock(path, recover); }
  let released = false; return () => { if (!released) { released = true; try { unlinkSync(path); } catch {} } };
}

export function admitPrivateWorker(options) {
  for (const name of ["baseRegistryPath", "outputRegistryPath"]) if (!options?.[name]) throw new Error(`${name} is required`); if (Boolean(options.ledgerPath) === Boolean(options.ledgerRootPath)) throw new Error("provide exactly one of ledgerPath or ledgerRootPath");
  const basePath = resolve(options.baseRegistryPath), ledgerRoot = options.ledgerRootPath ? resolve(options.ledgerRootPath) : null, ledgerPath = options.ledgerPath ? resolve(options.ledgerPath) : datedLedger(ledgerRoot), outputPath = resolve(options.outputRegistryPath), release = acquireLock(ledgerRoot ? join(ledgerRoot, ".admission.lock") : `${ledgerPath}.lock`, options.recoverStaleLock);
  try {
    const baseRegistry = readBoundedJson(basePath, "base registry"), sources = ledgerRoot ? ledgerFiles(ledgerRoot) : (existsSync(ledgerPath) ? [ledgerPath] : []), records = sources.flatMap((path) => readJsonl(path));
    if (!options.reproject) {
      if (!options.offerPath || !options.probePath) throw new Error("offerPath and probePath are required for admission");
      const offer = readBoundedJson(options.offerPath, "offer"), probe = readBoundedJson(options.probePath, "probe"), candidate = candidateFromEvidence(offer, probe, baseRegistry), existingIds = new Set(records.map((record) => record.registryEndpointCandidate?.id)); if (existingIds.has(candidate.id)) throw new Error(`endpoint id already admitted: ${candidate.id}`);
      const offerDigest = semanticId(offer), probeDigest = semanticId(probe), admittedAt = new Date().toISOString(), admissionId = `${candidate.id}-${admittedAt.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID()}`;
      const record = { type: "PrivateInferenceWorkerAdmission", id: admissionId, admittedAt, endpointId: candidate.id, offerDigest, probeDigest, evidence: { requests: probe.requests, verified: probe.verified, verifiedYield: probe.verifiedYield, p50LatencyMs: probe.p50LatencyMs, p95LatencyMs: probe.p95LatencyMs, mutableImageTag: offer.mutableImageTag === true }, terms: offer.terms, registryEndpointCandidate: { ...candidate, admission: { id: admissionId, offerDigest, probeDigest } } };
      appendJsonl(ledgerPath, record); records.push(record);
    }
    const projection = projectRegistry(baseRegistry, records, basePath, outputPath); return { type: "PrivateInferenceWorkerAdmissionProjection", admitted: options.reproject ? null : records.at(-1).endpointId, admissions: records.length, endpoints: projection.endpoints.length, ledger: ledgerPath, ledgerRoot, runtimeRegistry: outputPath, credentialValuesRecorded: false };
  } finally { release(); }
}

async function main() {
  const args = parse(process.argv.slice(2)); if (args.help) { process.stderr.write("usage: admit-private-worker --base-registry base.json (--ledger admissions.jsonl|--ledger-root data/supplier-admissions) --output-registry runtime.json [--offer worker-offer.json --probe probe.json | --reproject] [--recover-stale-lock]\n"); return; }
  const result = admitPrivateWorker({ offerPath: args.offer, probePath: args.probe, baseRegistryPath: args["base-registry"], ledgerPath: args.ledger, ledgerRootPath: args["ledger-root"], outputRegistryPath: args["output-registry"], reproject: args.reproject, recoverStaleLock: args["recover-stale-lock"] }); process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isMain(import.meta.url)) try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
