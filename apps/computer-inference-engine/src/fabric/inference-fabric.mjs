import { assertSchema } from "@red-cup-engineering/json-schema-services-section/assert-schema";
import { validateSchemaInstance } from "@red-cup-engineering/json-schema-services-section/validate-schema-instance";
import { exchangeOpenAiCompatibleAssistantMessage, isZeroCashProvider } from "@red-cup-engineering/computer-inference-engine/openai";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { canonicalJsonValue as canonical } from "@red-cup-engineering/json-services-section/canonical-json";

const cancellation = () => new EndpointRefusal("inference invocation cancelled", { retryable: false });
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(cancellation());
  const timer = setTimeout(done, ms);
  const abort = () => done(cancellation());
  function done(error) { clearTimeout(timer); signal?.removeEventListener("abort", abort); error ? reject(error) : resolve(); }
  signal?.addEventListener("abort", abort, { once: true });
});
const percentile = (xs, p) => xs.length ? xs[Math.floor((xs.length - 1) * p)] : null;
const COMPONENTS = ["dispatch", "inference", "verification", "scarcity"];
const DEFAULT_COST_UNIT = "default-conservative-unit";
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
function validSchema(schema) { try { assertSchema({ schema, allowUnknownAnnotations: true }); return true; } catch { return false; } }
const schemaMatches = (value, schema) => validateSchemaInstance({ instance: value, schema }).ok;
function outputFormat(job) { const contract = job?.outputContract; if (!contract) return null; if (typeof contract !== "object" || Object.keys(contract).some((key) => !["format", "schema", "mode"].includes(key)) || contract.format !== "json" || ![undefined, "json_object", "json_schema"].includes(contract.mode) || (contract.schema !== undefined && !validSchema(contract.schema))) throw new TypeError(`invalid outputContract: ${job.id}`); return contract.mode === "json_schema" && contract.schema ? { type: "json_schema", json_schema: { name: "result", strict: true, schema: contract.schema } } : { type: "json_object" }; }
function verifyOutput(value, job) { const contract = outputFormat(job); if (!contract) return null; let parsed; try { parsed = JSON.parse(value.text); } catch { throw new EndpointRefusal("output contract JSON verification failed", { retryable: false }); } if (job.outputContract.schema && !schemaMatches(parsed, job.outputContract.schema)) throw new EndpointRefusal("output contract schema verification failed", { retryable: false }); return { format: "json", schema: Boolean(job.outputContract.schema) }; }
export function resolveEndpointBaseUrl(endpoint, environment = process.env) { const raw = endpoint?.baseUrl ?? (endpoint?.baseUrlEnv ? environment[endpoint.baseUrlEnv] : undefined); if (typeof raw !== "string" || !raw) throw new EndpointRefusal("OpenAI-compatible endpoint has no base URL"); let url; try { url = new URL(raw); } catch { throw new EndpointRefusal("OpenAI-compatible endpoint base URL is invalid"); } if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new EndpointRefusal("OpenAI-compatible endpoint base URL is unsafe"); return url.toString().replace(/\/$/, ""); }
export class EndpointRefusal extends Error { constructor(reason, { status = null, retryable = false, retryAfterMs = null } = {}) { super(reason); this.name = "EndpointRefusal"; this.status = status; this.retryable = retryable; this.retryAfterMs = retryAfterMs; } }
const safeHarnessRefusal = (grounds, fallback) => { const text = String(grounds ?? ""), retry = text.match(/retry_after_seconds[^0-9]*([0-9.]+)|Retry-After[^0-9]*([0-9.]+)/i), retryAfterMs = retry ? Number(retry[1] ?? retry[2]) * 1000 : null; if (/HTTP 429|\b429\b|Too Many Requests/i.test(text)) return new EndpointRefusal("harness HTTP 429", { status: 429, retryable: true, retryAfterMs }); return new EndpointRefusal(fallback, { retryable: false }); };
const nonEmptyStrings = (value, label, maximum = 32) => {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || !item || item.length > 128) || new Set(value).size !== value.length) throw new TypeError(`invalid ${label}`);
  return value;
};
const profileFor = (endpoint) => endpoint.profile && typeof endpoint.profile === "object" ? endpoint.profile : endpoint;
const observationFor = (observations, endpointId, workType) => {
  const endpointObservations = observations?.[endpointId];
  if (!endpointObservations || typeof endpointObservations !== "object") return null;
  const candidate = (workType && endpointObservations[workType]) ?? endpointObservations.default ?? endpointObservations;
  return candidate && typeof candidate === "object" && Number.isInteger(candidate.attempts) && Number.isInteger(candidate.successes) ? candidate : null;
};
export function validateJobs(jobs) { const seen = new Set(); for (const job of jobs) { if (!job || typeof job.id !== "string" || !job.id || seen.has(job.id) || !Array.isArray(job.messages) || !job.messages.length || job.messages.some((m) => !m || typeof m.content !== "string")) throw new TypeError(`invalid or duplicate job: ${job?.id ?? "unknown"}`); if (job.requiredCapabilities !== undefined) nonEmptyStrings(job.requiredCapabilities, "requiredCapabilities"); if (job.difficulty !== undefined && (!Number.isFinite(job.difficulty) || job.difficulty < 0 || job.difficulty > 1)) throw new TypeError(`invalid difficulty: ${job.id}`); if (job.allowedCostUnit !== undefined && (typeof job.allowedCostUnit !== "string" || !job.allowedCostUnit || job.allowedCostUnit.length > 128)) throw new TypeError(`invalid allowedCostUnit: ${job.id}`); outputFormat(job); seen.add(job.id); } return jobs; }
export function validateEndpointProfile(endpoint) {
  if (!endpoint || typeof endpoint.id !== "string" || !endpoint.id) throw new TypeError("endpoint requires a nonempty id");
  for (const key of ["concurrency", "rpm"]) if (endpoint[key] !== undefined && (!Number.isSafeInteger(endpoint[key]) || endpoint[key] < 1)) throw new TypeError(`invalid ${key}: ${endpoint.id}`);
  for (const key of ["minIntervalMs", "cooldownMs"]) if (endpoint[key] !== undefined && (!Number.isFinite(endpoint[key]) || endpoint[key] < 0)) throw new TypeError(`invalid ${key}: ${endpoint.id}`);
  const profile = profileFor(endpoint);
  if (profile.capabilities !== undefined) nonEmptyStrings(profile.capabilities, "endpoint capabilities", 128);
  if (profile.expectedLatencyMs !== undefined && (!Number.isFinite(profile.expectedLatencyMs) || profile.expectedLatencyMs < 0)) throw new TypeError(`invalid expectedLatencyMs: ${endpoint.id}`);
  if (profile.cost !== undefined) {
    const { unit } = profile.cost;
    if (typeof unit !== "string" || !unit || unit.length > 128 || COMPONENTS.some((name) => !Number.isFinite(profile.cost[name]) || profile.cost[name] < 0)) throw new TypeError(`invalid cost profile: ${endpoint.id}`);
  }
  const prior = profile.successPrior;
  if (prior !== undefined && typeof prior !== "number" && (typeof prior !== "object" || prior === null)) throw new TypeError(`invalid successPrior: ${endpoint.id}`);
  const defaultPrior = typeof prior === "number" ? prior : prior?.default;
  if (defaultPrior !== undefined && (!Number.isFinite(defaultPrior) || defaultPrior < 0 || defaultPrior > 1)) throw new TypeError(`invalid successPrior: ${endpoint.id}`);
  if (prior && typeof prior === "object" && prior.byWorkType !== undefined) for (const value of Object.values(prior.byWorkType)) if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`invalid work-type successPrior: ${endpoint.id}`);
  if (prior && typeof prior === "object" && prior.difficultyPenalty !== undefined && (!Number.isFinite(prior.difficultyPenalty) || prior.difficultyPenalty < 0 || prior.difficultyPenalty > 1)) throw new TypeError(`invalid difficultyPenalty: ${endpoint.id}`);
  return endpoint;
}
export function estimateDifficulty(job) {
  if (job?.difficulty !== undefined) return { difficulty: job.difficulty, difficultySource: "explicit" };
  const messageBytes = Buffer.byteLength(JSON.stringify(job?.messages ?? []));
  const workTypeWeight = job?.workType ? Math.min(0.2, Buffer.byteLength(job.workType) / 640) : 0;
  const tokenWeight = Number.isFinite(job?.maxTokens) && job.maxTokens > 0 ? Math.min(0.35, job.maxTokens / 16384) : 0;
  return { difficulty: clamp(0.1 + Math.min(0.5, messageBytes / 32768) + workTypeWeight + tokenWeight, 0, 1), difficultySource: "heuristic:workType+messageBytes+maxTokens", messageBytes };
}
export function requiredCapabilitiesForJob(job) {
  const required = [...(job?.requiredCapabilities ?? [])];
  if (job?.outputContract?.format === "json") required.push("json-output");
  if (job?.outputContract?.mode === "json_schema") required.push("json-schema-output");
  return [...new Set(required)];
}
export function endpointFeasibility(endpoint, job) {
  const reasons = [], defaultNotes = [];
  try { validateEndpointProfile(endpoint); } catch (error) { return { feasible: false, reasons: [error.message], defaultNotes }; }
  const profile = profileFor(endpoint), capabilities = profile.capabilities ?? [];
  if (endpoint.enabled === false) reasons.push("disabled");
  if (job.preferEndpoints && !job.preferEndpoints.includes(endpoint.id)) reasons.push("not-preferred");
  if (endpoint.workTypes && job.workType && !endpoint.workTypes.includes(job.workType)) reasons.push("work-type-not-supported");
  const missingCapabilities = requiredCapabilitiesForJob(job).filter((capability) => !capabilities.includes(capability));
  if (missingCapabilities.length) reasons.push(`missing-capabilities:${missingCapabilities.join(",")}`);
  if (profile.capabilities === undefined) defaultNotes.push("default-capabilities:[]");
  if (profile.cost === undefined) defaultNotes.push(`default-cost:${DEFAULT_COST_UNIT}`);
  if (profile.successPrior === undefined) defaultNotes.push("default-success-prior:0.5");
  if (profile.expectedLatencyMs === undefined) defaultNotes.push("default-expected-latency-ms:0");
  return { feasible: reasons.length === 0, reasons, defaultNotes, capabilities, missingCapabilities };
}
export function quoteEndpoint(endpoint, job, { observations = {}, latencyCostPerMs = 0 } = {}) {
  if (!Number.isFinite(latencyCostPerMs) || latencyCostPerMs < 0) throw new TypeError("latencyCostPerMs must be nonnegative");
  const feasibility = endpointFeasibility(endpoint, job);
  const difficulty = estimateDifficulty(job);
  if (!feasibility.feasible) return { endpoint: endpoint?.id, feasible: false, ...difficulty, ...feasibility };
  const profile = profileFor(endpoint), cost = profile.cost ?? { unit: DEFAULT_COST_UNIT, dispatch: 1, inference: 1, verification: 1, scarcity: 1 };
  const priorSpec = profile.successPrior;
  const basePrior = typeof priorSpec === "number" ? priorSpec : (priorSpec?.byWorkType?.[job.workType] ?? priorSpec?.default ?? 0.5);
  const difficultyPenalty = typeof priorSpec === "object" && priorSpec ? (priorSpec.difficultyPenalty ?? 0.5) : 0.5;
  const observation = observationFor(observations, endpoint.id, job.workType);
  if (observation && (observation.attempts < 0 || observation.successes < 0 || observation.successes > observation.attempts)) throw new TypeError(`invalid observation: ${endpoint.id}`);
  const smoothedPrior = observation ? (observation.successes + basePrior * 2) / (observation.attempts + 2) : basePrior;
  const pSuccess = clamp(smoothedPrior * (1 - difficulty.difficulty * difficultyPenalty), 0.01, 0.999);
  const expectedLatencyMs = profile.expectedLatencyMs ?? 0;
  const componentCost = COMPONENTS.reduce((sum, name) => sum + cost[name], 0);
  const latencyShadowCost = expectedLatencyMs * latencyCostPerMs;
  const totalAttemptCost = componentCost + latencyShadowCost;
  return { endpoint: endpoint.id, feasible: true, ...difficulty, unit: cost.unit, components: Object.fromEntries(COMPONENTS.map((name) => [name, cost[name]])), componentCost, expectedLatencyMs, latencyShadowCost, totalAttemptCost, basePrior, smoothedPrior, difficultyPenalty, pSuccess, expectedResolutionCost: totalAttemptCost / pSuccess, observation: observation ? { attempts: observation.attempts, successes: observation.successes } : null, defaultNotes: feasibility.defaultNotes };
}
export function quotePlan(job, endpoints, options = {}) {
  if (!job || !Array.isArray(endpoints)) throw new TypeError("quotePlan requires a job and endpoints");
  validateJobs([{ ...job, id: job.id ?? "quote-job" }]);
  const quotes = endpoints.map((endpoint) => quoteEndpoint(endpoint, job, options));
  const feasible = quotes.filter((quote) => quote.feasible);
  const units = [...new Set(feasible.map((quote) => quote.unit))];
  if (job.allowedCostUnit !== undefined) {
    for (const quote of feasible) if (quote.unit !== job.allowedCostUnit) { quote.feasible = false; quote.reasons = [`cost-unit-not-allowed:${quote.unit}`]; }
  }
  const selected = feasible.filter((quote) => quote.feasible);
  const selectedUnits = [...new Set(selected.map((quote) => quote.unit))];
  const refused = selected.length === 0 ? "no-feasible-endpoint" : selectedUnits.length > 1 ? "incomparable-cost-units" : null;
  if (refused === "incomparable-cost-units") for (const quote of selected) quote.reasons = ["incomparable-cost-units"];
  const ordered = refused ? [] : selected.sort((a, b) => a.expectedResolutionCost - b.expectedResolutionCost || a.endpoint.localeCompare(b.endpoint));
  return { refused, difficulty: estimateDifficulty(job), allowedCostUnit: job.allowedCostUnit ?? null, units, quotes: quotes.sort((a, b) => Number(b.feasible) - Number(a.feasible) || (a.expectedResolutionCost ?? Infinity) - (b.expectedResolutionCost ?? Infinity) || String(a.endpoint).localeCompare(String(b.endpoint))), filtered: quotes.filter((quote) => !quote.feasible).map((quote) => ({ endpoint: quote.endpoint, reasons: quote.reasons ?? [] })), plan: ordered };
}
export function observationsFromRecords(records) {
  const observations = {};
  for (const record of records ?? []) {
    const workType = record?.routing?.workType ?? "default";
    for (const attempt of record?.attempts ?? []) {
      if (!attempt?.endpoint || !["completion", "refusal"].includes(attempt.outcome)) continue;
      const target = observations[attempt.endpoint] ??= {};
      const observation = target[workType] ??= { attempts: 0, successes: 0, latencyMs: 0 };
      observation.attempts += 1;
      observation.successes += attempt.outcome === "completion" && nonempty(record.text) ? 1 : 0;
      observation.latencyMs += Number.isFinite(attempt.latencyMs) && attempt.latencyMs >= 0 ? attempt.latencyMs : 0;
    }
  }
  return observations;
}
const mergeObservations = (...sources) => {
  const merged = {};
  for (const source of sources) for (const [endpoint, workTypes] of Object.entries(source ?? {})) for (const [workType, value] of Object.entries(workTypes ?? {})) {
    if (!Number.isInteger(value?.attempts) || !Number.isInteger(value?.successes)) continue;
    const target = (merged[endpoint] ??= {})[workType] ??= { attempts: 0, successes: 0, latencyMs: 0 };
    target.attempts += value.attempts; target.successes += value.successes; target.latencyMs += Number.isFinite(value.latencyMs) ? value.latencyMs : 0;
  }
  return merged;
};
export function readJsonl(path) { const text = readFileSync(path, "utf8").trim(); return text ? text.split("\n").map(JSON.parse) : []; }
export function appendJsonl(path, record) { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(record)}\n`); }
function endpointAllowed(endpoint, job) { return endpoint.enabled !== false && (!job.preferEndpoints || job.preferEndpoints.includes(endpoint.id)) && (!endpoint.workTypes || !job.workType || endpoint.workTypes.includes(job.workType)); }
export async function invokeEndpoint(endpoint, job, options = {}) {
  if (options.dryRun) return { text: "", usage: null, cost: null };
  if (endpoint.type === "harness") return invokeHarness(endpoint, job, options);
  const environment = options.env ?? process.env;
  const url = endpoint.chatCompletionsUrl ?? `${resolveEndpointBaseUrl(endpoint, environment).replace(/\/v1$/, "")}/v1/chat/completions`;
  const responseFormat = outputFormat(job);
  const exchange = await exchangeOpenAiCompatibleAssistantMessage({
    ...(job.params ?? {}), model: endpoint.model, messages: job.messages,
    ...(job.maxTokens ? { max_tokens: job.maxTokens } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
  }, {
    providerId: endpoint.id, chatCompletionsUrl: url,
    apiKey: environment[endpoint.apiKeyEnv], auth: endpoint.auth ?? (endpoint.apiKeyEnv ? undefined : { mode: "none" }),
    timeoutMs: options.timeoutMs ?? endpoint.timeoutMs,
    signal: options.signal,
  }, options.request ?? fetch);
  if (!exchange.ok) {
    const cause = exchange.cause;
    throw new EndpointRefusal(cause.kind === "http" ? `HTTP ${cause.status}` : cause.reason, {
      status: cause.status ?? null,
      retryable: cause.kind === "transport" || cause.status === 429 || cause.status >= 500,
      retryAfterMs: cause.retryAfterSeconds == null ? null : cause.retryAfterSeconds * 1000,
    });
  }
  const body = exchange.body, text = body.choices?.[0]?.message?.content;
  if (!nonempty(text)) throw new EndpointRefusal("OpenAI-compatible response has no nonempty completion text");
  const value = { text, usage: body.usage ?? null, cost: null };
  return { ...value, verification: verifyOutput(value, job) };
}
function projectLocator(locator, endpoint, packet, limit) {
  if (!endpoint.cwd || typeof locator?.recordPath !== "string" || !locator.recordPath) throw new Error("harness locator lacks an endpoint-local recordPath");
  let membrane, candidate; try { membrane = realpathSync(resolve(endpoint.cwd, "content", "exchanges")); candidate = realpathSync(isAbsolute(locator.recordPath) ? locator.recordPath : resolve(endpoint.cwd, locator.recordPath)); } catch { throw new Error("harness locator path is unreadable"); }
  const inside = relative(membrane, candidate); if (inside === "" || inside.startsWith("..") || isAbsolute(inside) || !statSync(candidate).isFile()) throw new Error("harness locator escapes content/exchanges membrane");
  const size = statSync(candidate).size; if (size > limit) throw new Error(`harness locator record exceeds ${limit} bytes`);
  const record = JSON.parse(readFileSync(candidate, "utf8"));
  if (!same(locator.id, record.id) || !same(locator.outcome, record.outcome) || !same(locator.cost, record.cost)) throw new Error("harness locator does not match settled record");
  if (!same(record.packet, packet)) throw new Error("harness locator packet does not match invocation");
  if (record.outcome !== "completion") throw new Error("harness locator record is not a completion");
  if (!nonempty(record.completion?.text)) throw new Error("harness locator record has no nonempty completion text");
  return { text: record.completion.text, usage: record.completion?.usage ?? null, cost: record.cost ?? null };
}
export async function invokeHarness(endpoint, job, options = {}) { if (options.signal?.aborted) throw cancellation(); const dir = mkdtempSync(join(tmpdir(), "inference-fabric-")); const packet = join(dir, "packet.json"), responseFormat = outputFormat(job), packetValue = { model: endpoint.model, messages: job.messages, ...(job.maxTokens ? { "max-tokens": job.maxTokens } : {}), ...(responseFormat ? { params: endpoint.adapter === "claude-json-schema" && job.outputContract?.schema ? { outputSchema: job.outputContract.schema } : { response_format: responseFormat } } : {}) }; writeFileSync(packet, JSON.stringify(packetValue)); try {
  const grouped = process.platform !== "win32", child = spawn(process.execPath, [endpoint.command, packet], { cwd: endpoint.cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: grouped }); const out = [], err = [], limit = options.maxOutputBytes ?? endpoint.maxOutputBytes ?? 1024 * 1024; let outputBytes = 0, exceeded = false;
  const capture = (target) => (chunk) => { const remaining = Math.max(0, limit - outputBytes); if (remaining) target.push(chunk.subarray(0, remaining)); outputBytes += chunk.length; if (outputBytes > limit) exceeded = true; };
  child.stdout.on("data", capture(out)); child.stderr.on("data", capture(err));
  const signalTree = (signal) => { try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch {} };
  const timeoutMs = options.timeoutMs ?? endpoint.timeoutMs, graceMs = options.timeoutGraceMs ?? endpoint.timeoutGraceMs ?? 250; let timedOut = false, cancelled = false;
  let kill;
  const terminate = () => { signalTree("SIGTERM"); kill ??= setTimeout(() => { if (child.exitCode === null) signalTree("SIGKILL"); }, graceMs); };
  const timeout = timeoutMs == null ? undefined : setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
  const abort = () => { cancelled = true; terminate(); };
  options.signal?.addEventListener("abort", abort, { once: true });
  let code; try { code = await new Promise((resolve, reject) => { child.once("close", resolve); child.once("error", reject); }); }
  finally { clearTimeout(timeout); clearTimeout(kill); options.signal?.removeEventListener("abort", abort); }
  if (cancelled) throw cancellation();
  if (timedOut) throw new EndpointRefusal(`harness timed out after ${timeoutMs}ms`, { retryable: true });
  if (exceeded) throw new Error(`harness output exceeded ${limit} bytes`);
  if (code !== 0) throw safeHarnessRefusal(Buffer.concat(err).toString(), `harness exited ${code}`);
  const record = JSON.parse(Buffer.concat(out).toString()); if (record.outcome === "refusal") throw safeHarnessRefusal(record.refusal?.grounds, "harness refusal"); const value = !record.completion && record.recordPath ? projectLocator(record, endpoint, packetValue, limit) : record.outcome !== "completion" || !nonempty(record.completion?.text) ? (() => { throw new Error("harness response has no nonempty completion text"); })() : { text: record.completion.text, usage: record.completion?.usage ?? null, cost: record.cost ?? null }; return { ...value, verification: verifyOutput(value, job) };
} finally { rmSync(dir, { recursive: true, force: true }); } }
const positiveInteger = (value, fallback, label) => { const selected = value ?? fallback; if (!Number.isInteger(selected) || selected < 1) throw new TypeError(`${label} must be a positive integer`); return selected; };
const schedulerRefusal = (id, type) => ({ id: typeof id === "string" ? id : null, attempts: [], refusal: { type }, latencyMs: 0, scheduler: { admitted: false } });
const abortableInvocation = async (invoke, endpoint, job, options) => {
  if (options.signal?.aborted) throw cancellation();
  const controller = new AbortController(), timeoutMs = options.timeoutMs ?? endpoint.timeoutMs;
  const abort = () => controller.abort(); let rejectCancelled = () => {};
  options.signal?.addEventListener("abort", abort, { once: true });
  let timer;
  const timeout = timeoutMs == null ? new Promise(() => {}) : new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new EndpointRefusal(`endpoint timed out after ${timeoutMs}ms`, { retryable: true })); }, timeoutMs); });
  const cancelled = new Promise((_, reject) => { rejectCancelled = () => reject(cancellation()); options.signal?.addEventListener("abort", rejectCancelled, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(() => invoke(endpoint, job, { ...options, signal: controller.signal })), timeout, cancelled]); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); options.signal?.removeEventListener("abort", rejectCancelled); }
};

export function createInferenceScheduler(registry, options = {}) {
  const endpoints = (registry.endpoints ?? []).filter((endpoint) => endpoint.enabled !== false); for (const endpoint of endpoints) validateEndpointProfile(endpoint);
  if (new Set(endpoints.map((endpoint) => endpoint.id)).size !== endpoints.length) throw new TypeError("endpoint ids must be unique");
  const global = positiveInteger(options.concurrency, registry.concurrency ?? 1, "concurrency"), attemptsMax = positiveInteger(options.attempts, registry.attempts ?? 3, "attempts"), maxQueueDepth = positiveInteger(options.maxQueueDepth, 1024, "maxQueueDepth"), maxSeenIds = positiveInteger(options.maxSeenIds, 100000, "maxSeenIds");
  const state = new Map(endpoints.map((endpoint) => [endpoint.id, { inFlight: 0, next: 0, cooldownUntil: 0, leases: [] }])), observations = mergeObservations(registry.observations, options.observations), latencyCostPerMs = options.latencyCostPerMs ?? registry.latencyCostPerMs ?? 0, seenIds = new Set(options.seenIds ?? []), pending = [], endpointWaiters = new Set(), drainWaiters = [];
  const accounts = new Map();
  for (const endpoint of endpoints) {
    const id = endpoint.accountId ?? endpoint.id;
    const limit = endpoint.accountConcurrency ?? endpoint.concurrency ?? 1;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("invalid shared inference account capacity");
    const existing = accounts.get(id);
    if (existing) existing.limit = Math.max(existing.limit, limit);
    else accounts.set(id, { limit, inFlight: 0, leases: [] });
  }
  if (seenIds.size > maxSeenIds || [...seenIds].some((id) => typeof id !== "string" || !id)) throw new TypeError("seenIds exceed maxSeenIds or contain an invalid id");
  let active = 0, accepting = true;
  const notifyEndpoints = () => { for (const resolve of [...endpointWaiters]) resolve(); }, waitForEndpoint = (signal) => {
    let done = false, resolvePromise, rejectPromise;
    const resolve = () => settle(), abort = () => settle(cancellation());
    const settle = (error) => { if (done) return; done = true; endpointWaiters.delete(resolve); signal?.removeEventListener("abort", abort); error ? rejectPromise(error) : resolvePromise(); };
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    if (signal?.aborted) settle(cancellation()); else { endpointWaiters.add(resolve); signal?.addEventListener("abort", abort, { once: true }); }
    return { promise, cancel: () => settle() };
  }, waitForAvailability = async (milliseconds) => {
    const controller = new AbortController(), abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort(); else options.signal?.addEventListener("abort", abort, { once: true });
    const waiter = waitForEndpoint(controller.signal);
    try { await Promise.race([waiter.promise, sleep(milliseconds, controller.signal)]); }
    finally { controller.abort(); waiter.cancel(); options.signal?.removeEventListener("abort", abort); }
  };
  const notifyDrained = () => { if (!active && !pending.length) for (const resolve of drainWaiters.splice(0)) resolve(); };

  async function jobRun(job) {
    const began = Date.now(), attempts = [], quotes = quotePlan(job, endpoints, { observations, latencyCostPerMs });
    const routing = { formulaVersion: "frugality-v2", requiredCapabilities: requiredCapabilitiesForJob(job), workType: job.workType ?? null, difficulty: quotes.difficulty.difficulty, difficultySource: quotes.difficulty.difficultySource, allowedCostUnit: quotes.allowedCostUnit, allQuotes: quotes.quotes, filtered: quotes.filtered, plannedPath: quotes.plan.map((quote) => ({ endpoint: quote.endpoint, expectedResolutionCost: quote.expectedResolutionCost, unit: quote.unit })), congestionDecisions: [], selectedEndpoints: [] };
    const cancelled = () => ({ id: job.id, attempts, refusal: { type: "cancelled" }, latencyMs: Date.now() - began, routing });
    if (options.signal?.aborted) return cancelled();
    if (quotes.refused) return { id: job.id, attempts, refusal: { type: quotes.refused }, latencyMs: Date.now() - began, routing };
    const candidates = quotes.plan.map((quote) => ({ quote, endpoint: endpoints.find((endpoint) => endpoint.id === quote.endpoint) }));
    while (candidates.length && attempts.length < attemptsMax) {
      const now = Date.now(), nonCooling = candidates.filter(({ endpoint }) => state.get(endpoint.id).cooldownUntil <= now);
      if (!nonCooling.length) { const until = Math.min(...candidates.map(({ endpoint }) => state.get(endpoint.id).cooldownUntil)); try { await waitForAvailability(Math.max(1, until - now)); } catch (error) { if (error.message === "inference invocation cancelled") return cancelled(); throw error; } continue; }
      const priced = nonCooling.map((candidate) => {
        const { endpoint, quote } = candidate, current = state.get(endpoint.id), account = accounts.get(endpoint.accountId ?? endpoint.id), capacity = endpoint.concurrency ?? 1, interval = Math.max(endpoint.minIntervalMs ?? 0, endpoint.rpm ? Math.ceil(60000 / endpoint.rpm) : 0), full = current.inFlight >= capacity || account.inFlight >= account.limit;
        const liveEstimates = [...current.leases, ...account.leases].map((lease) => lease.expectedAt).filter(Number.isFinite), expectedLatency = profileFor(endpoint).expectedLatencyMs ?? 0;
        const capacityWaitMs = full ? Math.max(1, liveEstimates.length ? Math.min(...liveEstimates) - now : expectedLatency, liveEstimates.some((at) => at > now) ? 0 : expectedLatency) : 0;
        const paceWaitMs = full ? 0 : Math.max(0, current.next - now), predictedWaitMs = Math.max(capacityWaitMs, paceWaitMs), congestionShadowCost = predictedWaitMs * latencyCostPerMs;
        return { candidate, full, interval, predictedWaitMs, congestionShadowCost, effectiveExpectedResolutionCost: quote.expectedResolutionCost + congestionShadowCost };
      }).sort((left, right) => left.effectiveExpectedResolutionCost - right.effectiveExpectedResolutionCost || left.candidate.quote.expectedResolutionCost - right.candidate.quote.expectedResolutionCost || left.candidate.endpoint.id.localeCompare(right.candidate.endpoint.id));
      // For admitted zero-cash capacity, hire another idle sovereign account
      // rather than serially wait on the cheapest alphabetic model alias.
      const selected = registry.fillAvailableCapacity === true ?
        (priced.find((item) => !item.full) ?? priced[0]) : priced[0];
      const { endpoint, quote } = selected.candidate, current = state.get(endpoint.id),
        account = accounts.get(endpoint.accountId ?? endpoint.id);
      const congestionDecision = { consideredAtMs: Date.now() - began, selectedEndpoint: endpoint.id, predictedWaitMs: selected.predictedWaitMs, congestionShadowCost: selected.congestionShadowCost, effectiveExpectedResolutionCost: selected.effectiveExpectedResolutionCost, candidates: priced.map((item) => ({ endpoint: item.candidate.endpoint.id, predictedWaitMs: item.predictedWaitMs, congestionShadowCost: item.congestionShadowCost, effectiveExpectedResolutionCost: item.effectiveExpectedResolutionCost })) };
      if (routing.congestionDecisions.length < 32) routing.congestionDecisions.push(congestionDecision); else routing.congestionDecisionsTruncated = true;
      if (selected.full) { try { await waitForAvailability(selected.predictedWaitMs); } catch (error) { if (error.message === "inference invocation cancelled") return cancelled(); throw error; } continue; }
      const slot = Math.max(Date.now(), current.next), lease = { expectedAt: slot + (profileFor(endpoint).expectedLatencyMs ?? 0) }, attemptBegan = Date.now();
      current.inFlight += 1; current.leases.push(lease);
      account.inFlight += 1; account.leases.push(lease);
      current.next = slot + selected.interval; routing.selectedEndpoints.push(endpoint.id);
      try {
        await sleep(Math.max(0, slot - Date.now()), options.signal);
        const value = await abortableInvocation(options.invoke ?? invokeEndpoint, endpoint, job, options), outcome = options.dryRun ? "dry-run" : "completion", verification = outcome === "completion" ? (value.verification ?? verifyOutput(value, job)) : null, attempt = { endpoint: endpoint.id, outcome, latencyMs: Date.now() - attemptBegan, expectedResolutionCost: quote.expectedResolutionCost, unit: quote.unit };
        if (outcome === "completion") { const observed = ((observations[endpoint.id] ??= {})[job.workType ?? "default"] ??= { attempts: 0, successes: 0, latencyMs: 0 }); observed.attempts += 1; observed.successes += 1; observed.latencyMs += attempt.latencyMs; }
        return { id: job.id, endpoint: endpoint.id, model: endpoint.model, attempts: [...attempts, attempt], text: value.text, usage: value.usage, cost: value.cost, verification, latencyMs: Date.now() - began, routing };
      } catch (error) {
        const refusal = error instanceof EndpointRefusal ? error : null, attempt = { endpoint: endpoint.id, outcome: "refusal", reason: refusal ? refusal.message : error.message, latencyMs: Date.now() - attemptBegan, expectedResolutionCost: quote.expectedResolutionCost, unit: quote.unit, verificationFailure: /^output contract /.test(error.message), ...(refusal ? { status: refusal.status, retryable: refusal.retryable, retryAfterMs: refusal.retryAfterMs } : {}) };
        attempts.push(attempt); const observed = ((observations[endpoint.id] ??= {})[job.workType ?? "default"] ??= { attempts: 0, successes: 0, latencyMs: 0 }); observed.attempts += 1; observed.latencyMs += attempt.latencyMs; if (error.message === "inference invocation cancelled") return cancelled(); if (refusal?.retryable) { const cooldownMs = refusal.retryAfterMs ?? endpoint.cooldownMs ?? 1000; current.cooldownUntil = Math.max(current.cooldownUntil, Date.now() + cooldownMs); attempt.cooldownUntil = current.cooldownUntil; } candidates.splice(candidates.indexOf(selected.candidate), 1);
      } finally {
        current.inFlight -= 1; current.leases.splice(current.leases.indexOf(lease), 1);
        account.inFlight -= 1; account.leases.splice(account.leases.indexOf(lease), 1);
        notifyEndpoints();
      }
    }
    return { id: job.id, attempts, refusal: { type: "all-quoted-endpoints-refused" }, latencyMs: Date.now() - began, routing };
  }

  const pump = () => { while (accepting || pending.length) { if (active >= global || !pending.length) break; const item = pending.shift(); active += 1; Promise.resolve(jobRun(item.job)).then(item.resolve, item.reject).finally(() => { active -= 1; pump(); notifyDrained(); }); } notifyDrained(); };
  const admit = (job) => {
    validateJobs([job]);
    const refuse = (type) => ({ admitted: false, refusal: type, settlement: Promise.resolve(schedulerRefusal(job.id, type)) });
    if (!accepting) return refuse("scheduler-closed");
    if (seenIds.has(job.id)) return refuse("duplicate-id");
    if (seenIds.size >= maxSeenIds) return refuse("seen-id-capacity");
    if (pending.length >= maxQueueDepth) return refuse("queue-full");
    seenIds.add(job.id); const settlement = new Promise((resolve, reject) => { pending.push({ job, resolve, reject }); pump(); }); return { admitted: true, refusal: null, settlement };
  };
  const submit = (job) => admit(job).settlement;
  const stop = () => { accepting = false; notifyDrained(); };
  const drain = () => !active && !pending.length ? Promise.resolve() : new Promise((resolve) => drainWaiters.push(resolve));
  const close = async () => { stop(); await drain(); };
  return { admit, submit, quote: (job) => quotePlan(job, endpoints, { observations, latencyCostPerMs }), stop, drain, close, snapshot: () => ({ active, pending: pending.length, accepting, seenIds: seenIds.size, observations: canonical(observations), endpoints: Object.fromEntries([...state].map(([id, value]) => [id, { inFlight: value.inFlight, next: value.next, cooldownUntil: value.cooldownUntil, leases: value.leases.length }])) }) };
}

const summarizeRecords = (records, endpoints, elapsedMs) => {
  const latencies = records.map((record) => record.latencyMs).sort((left, right) => left - right);
  const completed = records.filter((record) => nonempty(record.text));
  const verified = completed.filter((record) => record.verification?.format === "json");
  const rate = (count) => elapsedMs ? count * 60000 / elapsedMs : 0;
  const quotedAttemptConsiderationByUnit = {}, realizedResourcesByDenomination = {};
  for (const record of records) {
    for (const attempt of record.attempts ?? []) if (typeof attempt.unit === "string" && Number.isFinite(attempt.expectedResolutionCost)) quotedAttemptConsiderationByUnit[attempt.unit] = (quotedAttemptConsiderationByUnit[attempt.unit] ?? 0) + attempt.expectedResolutionCost;
    if (typeof record.cost?.denomination === "string") {
      const resource = realizedResourcesByDenomination[record.cost.denomination] ??= { fuelConsumed: 0, wallTimeSeconds: 0, completions: 0 };
      if (Number.isFinite(record.cost["fuel-consumed"])) resource.fuelConsumed += record.cost["fuel-consumed"];
      if (Number.isFinite(record.cost["wall-time-seconds"])) resource.wallTimeSeconds += record.cost["wall-time-seconds"];
      if (nonempty(record.text)) resource.completions += 1;
    }
  }
  return {
    elapsedMs,
    terminalJobsPerMinute: rate(records.length),
    usefulJobsPerMinute: rate(completed.length),
    schemaVerifiedJobsPerMinute: rate(verified.length),
    completed: completed.length,
    schemaVerifiedCompleted: verified.length,
    usefulYield: records.length ? completed.length / records.length : 0,
    schemaVerifiedYield: records.length ? verified.length / records.length : 0,
    refused: records.filter((record) => record.refusal).length,
    attempts: records.reduce((sum, record) => sum + (record.attempts?.length ?? 0), 0),
    fallbackCompletions: completed.filter((record) => (record.attempts?.length ?? 0) > 1).length,
    verificationFailures: records.reduce((sum, record) => sum + (record.attempts?.filter((attempt) => attempt.verificationFailure).length ?? 0), 0),
    quotedAttemptConsiderationByUnit,
    realizedResourcesByDenomination,
    p50LatencyMs: percentile(latencies, .5),
    p95LatencyMs: percentile(latencies, .95),
    byEndpoint: Object.fromEntries(endpoints.map((endpoint) => [endpoint.id, {
      attempts: records.reduce((sum, record) => sum + (record.attempts?.filter((attempt) => attempt.endpoint === endpoint.id).length ?? 0), 0),
      completed: completed.filter((record) => record.endpoint === endpoint.id).length,
      schemaVerifiedCompleted: verified.filter((record) => record.endpoint === endpoint.id).length,
      refused: records.reduce((sum, record) => sum + (record.attempts?.filter((attempt) => attempt.endpoint === endpoint.id && attempt.outcome === "refusal").length ?? 0), 0),
      verificationFailures: records.reduce((sum, record) => sum + (record.attempts?.filter((attempt) => attempt.endpoint === endpoint.id && attempt.verificationFailure).length ?? 0), 0)
    }]))
  };
};

export async function dispatchJobs(jobs, registry, options = {}) {
  validateJobs(jobs); const started = Date.now(), completed = options.completed ?? new Set(), queue = jobs.filter((job) => !completed.has(job.id)), records = [], endpoints = (registry.endpoints ?? []).filter((endpoint) => endpoint.enabled !== false), scheduler = createInferenceScheduler(registry, { ...options, seenIds: completed, maxQueueDepth: options.maxQueueDepth ?? Math.max(1, queue.length), maxSeenIds: options.maxSeenIds ?? Math.max(100000, completed.size + queue.length) });
  try { await Promise.all(queue.map(async (job) => { const record = await scheduler.submit(job); records.push(record); await options.onRecord?.(record); })); } finally { await scheduler.close(); } const elapsedMs = Date.now() - started; return { records, summary: summarizeRecords(records, endpoints, elapsedMs) };
}

/** Project the shared catalog to scheduler configuration; credentials remain in env.
 * Respect the existing ordered admission policy, not a second provider list.
 * Independent account lanes may run concurrently; aliases sharing one key
 * contribute only their maximum observed capacity, not the sum of model rows.
 */
export function inferenceRegistryFromCatalog(catalog, { env = process.env, providerIds = catalog?.routingPolicy?.freeFirstOrder ?? catalog?.routingPolicy?.order, zeroCashOnly = true, concurrency, attempts = 1 } = {}) {
  if (!Array.isArray(catalog?.rows) || !Array.isArray(providerIds) || new Set(providerIds).size !== providerIds.length) throw new TypeError("catalog rows and unique provider ids are required");
  const rows = new Map(catalog.rows.map((row) => [row.providerId, row]));
  const endpoints = [], excluded = [], accountCapacity = new Map();
  for (const id of providerIds) {
    const row = rows.get(id);
    const reason = !row ? "unknown-provider" : !row.keyed ? "not-armed" : zeroCashOnly && !isZeroCashProvider(row) ? "zero-cash-not-established" : row.auth?.mode !== "none" && !env[row.apiKeyEnvVar] ? "missing-credential" : null;
    if (reason) { excluded.push({ id, reason }); continue; }
    const url = row.chatCompletionsUrl.replace(/\{([A-Z][A-Z0-9_]*)\}/gu, (_, key) => env[key] ?? `{${key}}`);
    if (/\{[A-Z][A-Z0-9_]*\}/u.test(url)) { excluded.push({ id, reason: "unresolved-endpoint" }); continue; }
    const capacity = row.concurrency ?? 1;
    const account = row.apiKeyEnvVar ?? `unkeyed:${id}`;
    accountCapacity.set(account, Math.max(accountCapacity.get(account) ?? 0, capacity));
    endpoints.push({ id, model: row.defaultModel, chatCompletionsUrl: url, apiKeyEnv: row.apiKeyEnvVar,
      auth: row.auth, concurrency: capacity, accountId: account,
      accountConcurrency: capacity, ...(row.rpm ? { rpm: row.rpm } : {}),
      profile: { capabilities: row.capabilities ?? ["text"], expectedLatencyMs: 1000 },
    });
  }
  // Bounded parallelism cannot exceed account-local declared lanes. The
  // default is not an authorization to spend: zero-cash admission is unchanged.
  const safeConcurrency = concurrency ?? Math.max(1, Math.min(8,
    [...accountCapacity.values()].reduce((sum, capacity) => sum + capacity, 0)));
  if (!Number.isSafeInteger(safeConcurrency) || safeConcurrency < 1)
    throw new TypeError("inference concurrency must be positive");
  return { endpoints, excluded, concurrency: safeConcurrency, attempts,
    fillAvailableCapacity: zeroCashOnly };
}
