import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { appendJsonl, createInferenceScheduler, observationsFromRecords, readJsonl } from "./inference-fabric.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";

export const safeRefusal = (id, type) => ({ id: typeof id === "string" && id ? id : null, attempts: [], refusal: { type }, latencyMs: 0, scheduler: { admitted: false } });
export const jobDigest = (value) => { try { return semanticId(value); } catch { return null; } };
const submissionReceipt = (id, status, digest, extra = {}) => ({ type: "InferenceSubmissionReceipt", id: typeof id === "string" && id ? id : null, status, issuedAt: new Date().toISOString(), ...(digest ? { jobDigest: digest } : {}), ...extra });
export const boundedInteger = (value, fallback, low, high, label) => { const selected = value === undefined ? fallback : Number(value); if (!Number.isInteger(selected) || selected < low || selected > high) throw new Error(`${label} must be an integer from ${low} to ${high}`); return selected; };
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const increment = (object, key, amount = 1) => { object[key] = (object[key] ?? 0) + amount; };

function buildMarketSnapshot(registry, records, schedulerSnapshot, journal) {
  const now = Date.now(), completed = records.filter((record) => typeof record?.text === "string" && record.text.length), refused = records.filter((record) => record?.refusal), verified = completed.filter((record) => record.verification?.format === "json"), workTypes = {}, terminalRefusals = {}, quotedConsideration = {}, realizedResources = {};
  for (const record of records) {
    const workType = record?.routing?.workType ?? "unclassified", target = workTypes[workType] ??= { settlements: 0, completed: 0, verified: 0, refused: 0 }; target.settlements += 1; if (record?.text) target.completed += 1; if (record?.verification) target.verified += 1; if (record?.refusal?.type) { target.refused += 1; increment(terminalRefusals, record.refusal.type); }
    for (const attempt of record?.attempts ?? []) if (Number.isFinite(attempt.expectedResolutionCost) && attempt.unit) increment(quotedConsideration, attempt.unit, attempt.expectedResolutionCost);
    if (record?.cost && typeof record.cost === "object") { const denomination = record.cost.denomination ?? record.cost.unit ?? "unclassified", totals = realizedResources[denomination] ??= {}; for (const [key, value] of Object.entries(record.cost)) if (Number.isFinite(value)) increment(totals, key, value); }
  }
  const suppliers = (registry.endpoints ?? []).filter((endpoint) => endpoint.enabled !== false).map((endpoint) => {
    const profile = endpoint.profile ?? endpoint, attempts = records.flatMap((record) => record?.attempts ?? []).filter((attempt) => attempt.endpoint === endpoint.id), completions = attempts.filter((attempt) => attempt.outcome === "completion"), refusals = attempts.filter((attempt) => attempt.outcome === "refusal"), latencyMs = attempts.reduce((sum, attempt) => sum + (Number.isFinite(attempt.latencyMs) ? attempt.latencyMs : 0), 0), refusalReasons = {};
    for (const attempt of refusals) increment(refusalReasons, attempt.reason ?? "unclassified");
    return { id: endpoint.id, model: endpoint.model ?? null, capabilities: profile.capabilities ?? [], workTypes: profile.workTypes ?? [], terms: { concurrency: endpoint.concurrency ?? profile.concurrency ?? 1, rpm: endpoint.rpm ?? profile.rpm ?? null, expectedLatencyMs: profile.expectedLatencyMs ?? null, cost: profile.cost ?? null }, live: schedulerSnapshot.endpoints?.[endpoint.id] ?? null, evidence: { attempts: attempts.length, completions: completions.length, refusals: refusals.length, verifiedCompletions: records.filter((record) => record.endpoint === endpoint.id && record.verification).length, successRate: attempts.length ? completions.length / attempts.length : null, averageAttemptLatencyMs: attempts.length ? latencyMs / attempts.length : null, refusalReasons } };
  });
  const recent = (windowMs) => { const windowRecords = records.filter((record) => { const time = Date.parse(record?.settledAt ?? ""); return Number.isFinite(time) && time >= now - windowMs && time <= now; }), useful = windowRecords.filter((record) => record?.text).length; return { windowSeconds: windowMs / 1000, settlements: windowRecords.length, usefulCompletions: useful, usefulJobsPerMinute: useful * 60000 / windowMs }; };
  return { type: "InferenceMarketSnapshot", observedAt: new Date(now).toISOString(), formulaVersion: "frugality-v2", custody: { boundary: "host-local-unix-socket", soleJournalOwner: Boolean(journal), resultBodiesIncluded: false }, capacity: { accepting: schedulerSnapshot.accepting, active: schedulerSnapshot.active, pending: schedulerSnapshot.pending, seenIds: schedulerSnapshot.seenIds }, settlements: { total: records.length, usefulCompletions: completed.length, schemaVerifiedCompletions: verified.length, refused: refused.length, terminalRefusalsByType: terminalRefusals, recent: [recent(60000), recent(300000)] }, workTypes, quotedConsiderationByUnit: quotedConsideration, realizedResourcesByDenomination: realizedResources, suppliers };
}

export function loadRegistry(path) {
  const registryPath = resolve(path), registryDir = dirname(registryPath), registryBytes = readFileSync(registryPath, "utf8"), registry = JSON.parse(registryBytes), registryDigest = sha256Hex(registryBytes), base = registry.baseDir ? resolve(registryDir, registry.baseDir) : registryDir;
  for (const endpoint of registry.endpoints ?? []) { if (endpoint.command && !isAbsolute(endpoint.command)) endpoint.command = resolve(base, endpoint.command); if (endpoint.cwd && !isAbsolute(endpoint.cwd)) endpoint.cwd = resolve(base, endpoint.cwd); }
  const ids = (registry.endpoints ?? []).map((endpoint) => endpoint.id);
  if (!ids.length || ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length || !registry.endpoints.some((endpoint) => endpoint.enabled !== false)) throw new Error("registry requires unique nonempty endpoint ids and one enabled endpoint");
  return { registry, registryPath, registryDigest };
}

export function acquireJournalLock(journal, registryPath, recover) {
  if (!journal) return { release() {} };
  const lock = `${journal}.lock`; mkdirSync(dirname(lock), { recursive: true });
  const acquire = () => { try { const descriptor = openSync(lock, "wx"); writeFileSync(descriptor, JSON.stringify({ pid: process.pid, journal, registry: registryPath, startedAt: new Date().toISOString() })); closeSync(descriptor); } catch (error) { if (error.code !== "EEXIST") throw error; let existing = {}; try { existing = JSON.parse(readFileSync(lock, "utf8")); } catch {} if (Number.isInteger(existing.pid) && pidAlive(existing.pid)) { const held = new Error(`journal lock held by live pid ${existing.pid}`); held.exitCode = 3; throw held; } if (!recover) { const stale = new Error("stale journal lock exists; rerun with --recover-stale-lock to archive it"); stale.exitCode = 3; throw stale; } renameSync(lock, `${lock}.stale-${Date.now()}`); acquire(); } };
  acquire(); let released = false;
  return { release() { if (!released) { released = true; try { unlinkSync(lock); } catch {} } } };
}

export function createInferenceBroker(options) {
  if (!options?.registryPath) throw new Error("registryPath is required");
  const { registry, registryPath, registryDigest } = loadRegistry(options.registryPath), concurrency = boundedInteger(options.concurrency, registry.concurrency ?? 1, 1, 256, "concurrency"), attempts = boundedInteger(options.attempts, registry.attempts ?? 3, 1, 32, "attempts"), maxQueueDepth = boundedInteger(options.maxQueueDepth, 1024, 1, 100000, "maxQueueDepth"), maxSeenIds = boundedInteger(options.maxSeenIds, 100000, 1, 10000000, "maxSeenIds"), journal = options.journalPath ? resolve(options.journalPath) : null, history = options.historyPath ? resolve(options.historyPath) : null;
  const lock = acquireJournalLock(journal, registryPath, options.recoverStaleLock); let scheduler, closed = false;
  try {
    const sources = [...new Set([journal && existsSync(journal) ? journal : null, history].filter(Boolean))], priorRecords = sources.flatMap((path) => readJsonl(path)), marketRecords = [...priorRecords], settledById = new Map();
    for (const record of priorRecords) if (typeof record?.id === "string" && record.id && record.scheduler?.admitted !== false && !settledById.has(record.id)) settledById.set(record.id, record);
    const seenIds = new Set(settledById.keys());
    scheduler = createInferenceScheduler(registry, { invoke: options.invoke, request: options.request, env: options.env, timeoutMs: options.timeoutMs, concurrency, attempts, maxQueueDepth, maxSeenIds, seenIds, observations: observationsFromRecords(priorRecords) });

    const replay = (id) => { const prior = settledById.get(id); return prior ? { ...prior, scheduler: { ...(prior.scheduler ?? {}), admitted: false, replayed: true } } : null; };
    const settle = async (value, submitted, digest) => {
      let record; try { record = await submitted; } catch { return safeRefusal(value?.id, "service-execution-failure"); }
      if (digest) record = { ...record, jobDigest: digest };
      record = { ...record, settledAt: new Date().toISOString() };
      try { if (journal) appendJsonl(journal, record); } catch { return safeRefusal(value?.id, "service-settlement-failure"); }
      marketRecords.push(record);
      if (typeof record?.id === "string" && record.scheduler?.admitted !== false) settledById.set(record.id, record);
      return record;
    };
    const admit = (value) => {
      const digest = jobDigest(value);
      if (typeof value?.id === "string") {
        const prior = replay(value.id);
        if (prior) {
          if (prior.jobDigest && digest !== prior.jobDigest) { const result = Promise.resolve(safeRefusal(value.id, "id-payload-conflict")); return { receipt: submissionReceipt(value.id, "refused", digest, { durable: false, refusal: { type: "id-payload-conflict" }, scheduler: { admitted: false } }), result }; }
          return { receipt: submissionReceipt(value.id, "already-settled", digest, { durable: true, scheduler: { admitted: false, replayed: true } }), result: Promise.resolve(prior) };
        }
      }
      let admission;
      try { admission = scheduler.admit(value); }
      catch { const result = Promise.resolve(safeRefusal(value?.id, "invalid-job")); return { receipt: submissionReceipt(value?.id, "refused", digest, { durable: false, refusal: { type: "invalid-job" }, scheduler: { admitted: false } }), result }; }
      const result = settle(value, admission.settlement, digest);
      if (!admission.admitted) return { receipt: submissionReceipt(value.id, "refused", digest, { durable: false, refusal: { type: admission.refusal }, scheduler: { admitted: false } }), result };
      return { receipt: submissionReceipt(value.id, "admitted", digest, { durable: false, settlement: "pending", scheduler: { admitted: true } }), result };
    };
    const submit = (value) => admit(value).result;
    const stop = () => scheduler.stop(), drain = () => scheduler.drain();
    const close = async () => { if (!closed) { closed = true; scheduler.stop(); await scheduler.drain(); lock.release(); } };
    return { admit, submit, replay, quote: (value) => scheduler.quote(value), marketSnapshot: () => buildMarketSnapshot(registry, marketRecords, scheduler.snapshot(), journal), stop, drain, close, ready: { concurrency, maxQueueDepth, maxSeenIds, priorIds: seenIds.size, journal: Boolean(journal), registryPath, registryDigest }, snapshot: () => scheduler.snapshot() };
  } catch (error) { lock.release(); throw error; }
}
