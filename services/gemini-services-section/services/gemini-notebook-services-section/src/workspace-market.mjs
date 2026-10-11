import { runGeminiNotebookSync } from "./gemini-notebook-cli.mjs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";
import { walkPosixPathsSync } from "@red-cup-engineering/computer-filepath-engineering-services-section/walk-posix-paths";
import { writeFileTextSync } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { isNiUri, niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
import { decodeCsvRows } from '@red-cup-engineering/csv-services-section/csv-codec';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY = JSON.parse(readFileSync(join(ROOT, "content/config/workspace-market.json"), "utf8"));
const PROVIDER = POLICY.provider;
const ACTOR = /^urn:ame:[a-z0-9][a-z0-9._-]*$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STUDIO = new Set(Object.keys(POLICY.studioPrices));
const SAFE_EXTENSIONS = new Set([".c", ".cc", ".cfg", ".clj", ".cpp", ".css", ".csv", ".go", ".h", ".hs", ".html", ".java", ".js", ".json", ".lean", ".md", ".mjs", ".py", ".rml", ".rs", ".scss", ".sh", ".sql", ".tex", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:ghp|github_pat|sk-proj|sk_live|AIza)[A-Za-z0-9_-]{16,}\b/u,
  /\b(?:password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?[^\s"']{12,}/iu,
];

export { canonical };
function now(options = {}) { return options.now ?? new Date().toISOString(); }
function plusMinutes(instant, minutes) { return new Date(Date.parse(instant) + minutes * 60_000).toISOString(); }
function plusHours(instant, hours) { return new Date(Date.parse(instant) + hours * 3_600_000).toISOString(); }
function assert(condition, message) { if (!condition) throw new TypeError(message); }
function actor(value, field = "customer") { assert(ACTOR.test(value ?? ""), `${field} must be an actor URN`); return value; }
function dataRoot(options = {}) { return resolve(options.dataRoot ?? join(ROOT, "data/workspace-market")); }
function directory(root, name) { const path = join(root, name); mkdirSync(path, { recursive: true }); return path; }
function appendRecord(kind, body, options = {}) {
  const root = directory(dataRoot(options), kind); const record = { id: semanticId(body), ...body };
  const path = join(root, `${niUriDigest(record.id)}.json`);
  if (existsSync(path)) { assert(canonical(JSON.parse(readFileSync(path, "utf8"))) === canonical(record), `${kind} record collision`); return record; }
  writeFileTextSync(path, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 }); return record;
}
function recordById(kind, id, options = {}) {
  assert(isNiUri(id ?? ""), `${kind} identity is malformed`); const path = join(dataRoot(options), kind, `${niUriDigest(id)}.json`);
  assert(existsSync(path), `${kind} record is unknown`); const record = JSON.parse(readFileSync(path, "utf8")); const { id: found, ...body } = record;
  assert(found === id && found === semanticId(body), `${kind} record identity is invalid`); return record;
}
function records(kind, options = {}) {
  const root = join(dataRoot(options), kind); if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(join(root, name), "utf8")));
}
function refusal(operation, code, externalEffects = []) { return { type: "GeminiNotebookWorkspaceMarketRefusal", provider: PROVIDER, operation, disposition: "refused", code, externalEffects }; }

export function observeMarket() {
  return { ...POLICY, observedAt: new Date().toISOString(), claims: { maximumSourceCeiling: "provider-offered-term-not-live-account-observation", studioTypes: "installed-cli-capability-catalog" } };
}

export function authorizeResourceBudget(request, options = {}) {
  const at = now(options); actor(request?.customer);
  for (const [field, maximum] of [["maximumProviderCalls", 10000], ["maximumSourceBytes", 1024 * 1024 * 1024], ["maximumWallTimeSeconds", 86400], ["maximumStudioQuota", 100]]) {
    assert(Number.isSafeInteger(request[field]) && request[field] >= 0 && request[field] <= maximum, `${field} is outside the offered range`);
  }
  assert(Number.isFinite(Date.parse(request.expiresAt)) && Date.parse(request.expiresAt) > Date.parse(at), "resource budget must have a future expiry");
  return appendRecord("resource-budgets", { type: "GeminiNotebookResourceBudgetAuthorization", provider: PROVIDER, customer: request.customer, maximumProviderCalls: request.maximumProviderCalls, maximumSourceBytes: request.maximumSourceBytes, maximumWallTimeSeconds: request.maximumWallTimeSeconds, maximumStudioQuota: request.maximumStudioQuota, monetaryAuthority: false, markup: "0", authorizedAt: at, expiresAt: request.expiresAt }, options);
}

export function quoteWorkspace(request, options = {}) {
  const at = now(options); actor(request?.customer); assert(typeof request.title === "string" && request.title.trim(), "title is required");
  assert(Number.isSafeInteger(request.sourceCeiling) && request.sourceCeiling >= 1 && request.sourceCeiling <= POLICY.workspace.maximumSourceCeiling, "sourceCeiling is outside the offered range");
  assert(Number.isSafeInteger(request.leaseHours) && request.leaseHours >= 1 && request.leaseHours <= POLICY.workspace.maximumLeaseHours, "leaseHours is outside the offered range");
  assert(Object.hasOwn(POLICY.retentionPolicies, request.retentionPolicy), "retentionPolicy is unsupported");
  return appendRecord("offers", { type: "GeminiNotebookWorkspaceOffer", provider: PROVIDER, customer: request.customer, title: request.title.trim(), sourceCeiling: request.sourceCeiling, leaseHours: request.leaseHours, retentionPolicy: request.retentionPolicy, consideration: POLICY.accounting, nonce: options.nonce ?? randomUUID(), offeredAt: at, expiresAt: plusMinutes(at, POLICY.offerLifetimeMinutes), authorityGrantedOnCompletion: ["notebook-operation-custody"], authorityWithheld: ["sharing", "publication", "governance", "union-advisory-promotion"] }, options);
}

export function acceptWorkspaceOffer(request, options = {}) {
  const offer = recordById("offers", request?.offer, options); const at = now(options);
  assert(offer.type === "GeminiNotebookWorkspaceOffer" && actor(request.customer) === offer.customer, "only the quoted customer may accept this offer");
  assert(Date.parse(at) <= Date.parse(offer.expiresAt), "workspace offer expired");
  const budget = recordById("resource-budgets", request.resourceBudgetAuthorization, options); assert(budget.customer === offer.customer && Date.parse(at) <= Date.parse(budget.expiresAt), "resource budget is absent, foreign, or expired");
  const prior = records("acceptances", options).filter((row) => row.offer === offer.id);
  if (prior.length) { assert(prior.length === 1 && prior[0].resourceBudgetAuthorization === request.resourceBudgetAuthorization, "workspace offer already has a different acceptance"); return prior[0]; }
  return appendRecord("acceptances", { type: "GeminiNotebookWorkspaceOfferAcceptance", provider: PROVIDER, customer: offer.customer, offer: offer.id, resourceBudgetAuthorization: request.resourceBudgetAuthorization, acceptedAt: at, status: "accepted-awaiting-authorized-creation", externalEffects: [], authorityWithheld: ["notebook-creation-without-separate-authorization"] }, options);
}

function defaultCreate(request) {
  const executable = join(ROOT, "src/create-notebook.mjs");
  const args = [executable, "--customer", request.customer, "--title", request.title, "--authorization", request.authorization, "--authorization-request-digest", request.authorizationRequestDigest, "--request-id", request.creationRequestId, "--execute"];
  const run = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", env: process.env, maxBuffer: Number.POSITIVE_INFINITY });
  let value; try { value = JSON.parse(run.stdout); } catch { value = null; }
  if (run.status !== 0 || !value) throw new Error((run.stderr || "authorized creation provider failed").trim().slice(0, 500)); return value;
}

export async function openWorkspace(request, options = {}) {
  const acceptance = recordById("acceptances", request?.acceptance, options); const offer = recordById("offers", acceptance.offer, options); const operation = request.operationId ?? semanticId({ acceptance: acceptance.id, authorization: request.authorization, creationRequestId: request.creationRequestId });
  try {
    const prior = records("leases", options).filter((row) => row.acceptance === acceptance.id);
    if (prior.length) { assert(prior.length === 1, "workspace acceptance has conflicting leases"); return prior[0]; }
    assert(acceptance.customer === request.customer && offer.customer === request.customer, "workspace acceptance customer changed");
    assert(isNiUri(request.authorization ?? "") && isNiUri(request.authorizationRequestDigest ?? "") && isNiUri(request.creationRequestId ?? ""), "live opening requires exact creation authorization bindings");
    const creation = await (options.createNotebook ?? defaultCreate)({ customer: request.customer, title: offer.title, authorization: request.authorization, authorizationRequestDigest: request.authorizationRequestDigest, creationRequestId: request.creationRequestId });
    assert(UUID.test(creation.notebookId ?? "") && creation.customer === request.customer && creation.status === "completed", "creation provider returned no exact customer notebook receipt");
    return appendRecord("leases", { type: "GeminiNotebookWorkspaceLease", provider: PROVIDER, customer: request.customer, offer: offer.id, acceptance: acceptance.id, resourceBudgetAuthorization: acceptance.resourceBudgetAuthorization, creationReceipt: creation.id ?? semanticId(creation), notebookId: creation.notebookId, title: offer.title, sourceCeiling: offer.sourceCeiling, retentionPolicy: offer.retentionPolicy, openedAt: now(options), expiresAt: plusHours(now(options), offer.leaseHours), status: "open", sourcesAdmitted: 0, externalEffects: ["notebook-created"], authorityGranted: ["observe", "add-source", "ask", "configure", "history", "note", "purchase-studio", "destroy-exact-notebook"], authorityWithheld: offer.authorityWithheld }, options);
  } catch (error) { return refusal(operation, `workspace-open-failed:${error.message}`); }
}

function walk(root, extensions, excluded, base = root) {
  const files = walkPosixPathsSync({ root, extensions: [...extensions], paths: "absolute", result: "paths" }).files;
  return files.filter((path) => !excluded.some((pattern) => relative(base, path).includes(pattern)));
}
function safeFile(path) { const absolute = resolve(path); assert(existsSync(absolute), `source does not exist: ${absolute}`); const stat = lstatSync(absolute); assert(stat.isFile() && !stat.isSymbolicLink(), `source must be a regular non-symlink file: ${absolute}`); assert(stat.size <= 10 * 1024 * 1024, `source exceeds the provider file limit: ${absolute}`); return absolute; }
function secretMatches(text) { return SECRET_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source); }
function sessionProjection(path, spec) {
  assert(spec.authorization === "leader-authorized-session-material", "session projection requires explicit Leader-authorized disclosure");
  const messages = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    if (!line) continue; let row; try { row = JSON.parse(line); } catch { continue; }
    const payload = row?.type === "response_item" ? row.payload : null;
    if (payload?.type !== "message" || !["user", "assistant"].includes(payload.role)) continue;
    const text = (payload.content ?? []).map((item) => item.text ?? item.input_text ?? item.output_text ?? "").join("\n").trim();
    if (!text || /^(?:<recommended_plugins>|<environment_context>)/u.test(text)) continue;
    messages.push(`## ${payload.role}\n\n${text}`);
  }
  const projection = `# Sanitized Codex session projection\n\nDisclosure: leader-authorized-session-material\nRetention: ephemeral-source\nIncluded roles: user, assistant\nExcluded channels: system, developer, tool, world-state\n\n${messages.join("\n\n")}`;
  const matches = secretMatches(projection); assert(matches.length === 0 || spec.allowSensitive === true, `session projection matched ${matches.length} credential pattern(s)`); return projection;
}
function sourceSpecs(manifest) {
  const sources = [];
  for (const spec of manifest.sources ?? []) {
    if (spec.kind === "file") sources.push({ spec, path: safeFile(spec.path) });
    else if (spec.kind === "tree") {
      const root = realpathSync(resolve(spec.root)); const extensions = new Set((spec.extensions ?? [...SAFE_EXTENSIONS]).map((item) => item.startsWith(".") ? item.toLowerCase() : `.${item.toLowerCase()}`));
      for (const path of walk(root, extensions, spec.excludeContains ?? [".git/", "node_modules/", "data/credentials/"])) sources.push({ spec: { ...spec, title: `${spec.titlePrefix ? `${spec.titlePrefix}/` : ""}${relative(root, path)}`, kind: "file" }, path: safeFile(path) });
    } else if (spec.kind === "codex-session") sources.push({ spec, path: safeFile(spec.path), projection: sessionProjection(safeFile(spec.path), spec) });
    else throw new TypeError(`unsupported corpus source kind ${spec.kind}`);
  }
  return sources.sort((a, b) => a.path.localeCompare(b.path));
}

export function compileCorpus(manifest, options = {}) {
  actor(manifest?.customer); assert(typeof manifest.purpose === "string" && manifest.purpose.trim(), "corpus purpose is required");
  assert(Number.isSafeInteger(manifest.sourceCeiling) && manifest.sourceCeiling >= 1 && manifest.sourceCeiling <= POLICY.workspace.maximumSourceCeiling, "corpus sourceCeiling is outside the offered range");
  const entries = sourceSpecs(manifest); assert(entries.length > 0, "corpus has no sources"); assert(entries.length <= manifest.sourceCeiling, `corpus has ${entries.length} sources but purchased ceiling is ${manifest.sourceCeiling}`);
  const manifestDigest = semanticId(manifest); const out = directory(resolve(options.outputRoot ?? join(dataRoot(options), "corpora")), manifestDigest.slice(7)); const projected = [];
  for (const [index, entry] of entries.entries()) {
    const original = entry.projection ?? readFileSync(entry.path, "utf8"); const matches = secretMatches(original); assert(matches.length === 0 || entry.spec.allowSensitive === true, `source matched ${matches.length} credential pattern(s): ${entry.path}`);
    const originalDigest = sha256Digest(Buffer.from(original)); const title = entry.spec.title ?? relative(process.cwd(), entry.path); const header = `# Gemini Notebook source projection\n\nTitle: ${title}\nOrigin: ${entry.spec.kind === "codex-session" ? "sanitized-session" : entry.path}\nOriginal-Digest: ${originalDigest}\nDisclosure: ${entry.spec.disclosure ?? (entry.spec.kind === "codex-session" ? "leader-authorized-session-material" : "repository-source")}\n\n`;
    const bytes = Buffer.from(header + original); const projectionDigest = sha256Digest(bytes); const path = join(out, `${String(index + 1).padStart(3, "0")}-${projectionDigest.slice(7, 23)}.txt`);
    if (existsSync(path)) assert(sha256Digest(readFileSync(path)) === projectionDigest, "corpus projection collision"); else writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    projected.push({ title, origin: entry.spec.kind === "codex-session" ? "sanitized-session" : entry.path, path, digest: projectionDigest, byteLength: bytes.length, mediaType: "text/plain", disclosure: entry.spec.disclosure ?? "repository-source" });
  }
  const sourceSetDigest = semanticId(projected.map(({ title, digest: value, byteLength }) => ({ title, digest: value, byteLength })));
  const receipt = appendRecord("corpus-receipts", { type: "GeminiNotebookCorpusCompilationReceipt", provider: PROVIDER, customer: manifest.customer, purpose: manifest.purpose, manifestDigest, sourceSetDigest, sourceCount: projected.length, purchasedSourceCeiling: manifest.sourceCeiling, projected, retention: manifest.retention ?? "ephemeral", compiledAt: now(options), externalEffects: [] }, options);
  writeFileSync(join(out, "corpus.json"), `${JSON.stringify(receipt, null, 2)}\n`); return receipt;
}

function defaultCli(args) {
  const run = runGeminiNotebookSync(args, { root: ROOT, maxBuffer: Number.POSITIVE_INFINITY });
  return { status: run.status, value: run.value ?? null, diagnostic: (run.stderr || run.stdout).trim().slice(0, 500) };
}
function liveLease(id, customer, options = {}) { const lease = recordById("leases", id, options); assert(lease.customer === actor(customer) && lease.status === "open", "workspace lease is not open for this customer"); assert(Date.parse(now(options)) <= Date.parse(lease.expiresAt), "workspace lease expired"); assert(!records("cleanup-receipts", options).some((row) => row.lease === lease.id && row.status === "confirmed-deleted"), "workspace was already destroyed"); return lease; }
function usedResources(lease, options = {}) {
  const use = { providerCalls: 0, sourceBytesEgressed: 0, providerWallTimeSeconds: 0, studioQuotaConsumed: 0 };
  for (const kind of ["operation-receipts", "studio-artifacts", "cleanup-receipts"]) for (const row of records(kind, options)) if (row.lease === lease.id && row.resourceUse) for (const key of Object.keys(use)) use[key] += row.resourceUse[key] ?? 0;
  return use;
}
function admitResourceUse(lease, proposed, options = {}) {
  const budget = recordById("resource-budgets", lease.resourceBudgetAuthorization, options), used = usedResources(lease, options);
  const limits = { providerCalls: budget.maximumProviderCalls, sourceBytesEgressed: budget.maximumSourceBytes, providerWallTimeSeconds: budget.maximumWallTimeSeconds, studioQuotaConsumed: budget.maximumStudioQuota };
  for (const key of Object.keys(limits)) assert(used[key] + (proposed[key] ?? 0) <= limits[key], `resource budget exceeded for ${key}`);
  return { budget, used, proposed };
}
function wallSeconds(started) { return Math.max(0, Math.ceil((performance.now() - started) / 1000)); }

export function addCorpus(request, options = {}) {
  const started = performance.now(); const lease = liveLease(request?.lease, request?.customer, options); const corpus = recordById("corpus-receipts", request.corpus, options); const operation = request.operationId ?? semanticId({ lease: lease.id, corpus: corpus.id });
  const prior = records("operation-receipts", options).filter((row) => row.operation === operation);
  if (prior.length) { assert(prior.length === 1 && prior[0].corpus === corpus.id && prior[0].lease === lease.id, "source operation replay conflicts with prior receipt"); return prior[0]; }
  if (corpus.customer !== lease.customer) return refusal(operation, "corpus-customer-does-not-own-workspace");
  const maximumWallTimeSeconds = request.maximumWallTimeSeconds ?? 3600; assert(Number.isSafeInteger(maximumWallTimeSeconds) && maximumWallTimeSeconds >= 1, "maximumWallTimeSeconds is required"); const plannedUse = { providerCalls: 1 + 2 * corpus.sourceCount, sourceBytesEgressed: corpus.projected.reduce((sum, row) => sum + row.byteLength, 0), providerWallTimeSeconds: maximumWallTimeSeconds, studioQuotaConsumed: 0 }; admitResourceUse(lease, plannedUse, options);
  const runCli = options.runCli ?? defaultCli; const admitted = [];
  const deadline = started + maximumWallTimeSeconds * 1000; const remaining = () => Math.max(1, Math.floor(deadline - performance.now()));
  const inventory = runCli(["source", "list", "--notebook", lease.notebookId], remaining()); const incumbents = inventory.value?.sources;
  if (inventory.status !== 0 || !Array.isArray(incumbents)) return refusal(operation, `source-inventory-failed:${inventory.diagnostic}`);
  if (incumbents.length + corpus.sourceCount > lease.sourceCeiling) return refusal(operation, "corpus-exceeds-remaining-purchased-workspace-ceiling");
  for (const source of corpus.projected) {
    const result = runCli(["source", "add", source.path, "--type", "file", "--mime-type", "text/plain", "--title", source.title.slice(0, 180), "--notebook", lease.notebookId], remaining());
    if (result.status !== 0 || typeof result.value?.source?.id !== "string") return refusal(operation, `source-admission-failed:${result.diagnostic}`, admitted.map((row) => ({ effect: "source-added", sourceId: row.sourceId })));
    const sourceId = result.value.source.id; const waitSeconds = Math.max(1, Math.min(600, Math.floor(remaining() / 1000))); const waited = runCli(["source", "wait", sourceId, "--notebook", lease.notebookId, "--timeout", String(waitSeconds)], remaining());
    if (waited.status !== 0) return refusal(operation, `source-not-ready:${result.diagnostic}`, [...admitted, { effect: "source-added", sourceId }]);
    admitted.push({ ...source, sourceId });
  }
  return appendRecord("operation-receipts", { type: "GeminiNotebookCorpusAdmissionReceipt", provider: PROVIDER, customer: lease.customer, operation, lease: lease.id, notebookId: lease.notebookId, corpus: corpus.id, sourceSetDigest: corpus.sourceSetDigest, admitted, admittedCount: admitted.length, completedAt: now(options), disposition: "completed", resourceUse: { ...plannedUse, providerWallTimeSeconds: wallSeconds(started) }, externalEffects: admitted.map((row) => ({ effect: "source-added", sourceId: row.sourceId })) }, options);
}

export function askWorkspace(request, options = {}) {
  const started = performance.now(); const lease = liveLease(request?.lease, request?.customer, options); assert(typeof request.question === "string" && request.question.trim(), "question is required"); const operation = request.operationId ?? semanticId({ lease: lease.id, question: request.question, sources: request.sourceIds ?? [] }); const maximumWallTimeSeconds = request.maximumWallTimeSeconds ?? 600; const plannedUse = { providerCalls: 1, sourceBytesEgressed: 0, providerWallTimeSeconds: maximumWallTimeSeconds, studioQuotaConsumed: 0 }; admitResourceUse(lease, plannedUse, options);
  const args = ["ask", request.question, "--notebook", lease.notebookId]; for (const source of request.sourceIds ?? []) args.push("--source", source);
  const result = (options.runCli ?? defaultCli)(args, maximumWallTimeSeconds * 1000); if (result.status !== 0) return refusal(operation, `question-failed:${result.diagnostic}`);
  return appendRecord("operation-receipts", { type: "GeminiNotebookGroundedAnswerReceipt", provider: PROVIDER, customer: lease.customer, operation, lease: lease.id, notebookId: lease.notebookId, question: request.question, selectedSourceIds: request.sourceIds ?? [], answer: result.value, advisoryAuthority: "none", completedAt: now(options), disposition: "completed", resourceUse: { ...plannedUse, providerWallTimeSeconds: wallSeconds(started) }, externalEffects: [{ effect: "notebook-query" }] }, options);
}

export function quoteStudio(request, options = {}) {
  actor(request?.customer); assert(isNiUri(request.lease ?? ""), "lease identity is required"); assert(STUDIO.has(request.artifactType), "unsupported Studio artifact type"); const lease = liveLease(request.lease, request.customer, options); const at = now(options);
  return appendRecord("offers", { type: "GeminiNotebookStudioOffer", provider: PROVIDER, customer: lease.customer, lease: lease.id, notebookId: lease.notebookId, artifactType: request.artifactType, instructionsDigest: sha256Digest(Buffer.from(request.instructions ?? "")), consideration: { ...POLICY.accounting, studioQuotaClass: POLICY.studioPrices[request.artifactType] }, nonce: options.nonce ?? randomUUID(), offeredAt: at, expiresAt: plusMinutes(at, POLICY.offerLifetimeMinutes), authorityGrantedOnCompletion: ["custody-of-downloaded-artifact"], authorityWithheld: ["truth", "governance", "publication", "union-advisory-promotion"] }, options);
}

export function generateStudio(request, options = {}) {
  const offer = recordById("offers", request?.offer, options); const operation = request.operationId ?? semanticId({ offer: offer.id, resourceBudgetAuthorization: request.resourceBudgetAuthorization });
  try {
    assert(offer.type === "GeminiNotebookStudioOffer" && offer.customer === actor(request.customer), "Studio offer customer changed"); assert(Date.parse(now(options)) <= Date.parse(offer.expiresAt), "Studio offer expired");
    const started = performance.now(); const lease = liveLease(offer.lease, request.customer, options); assert(request.resourceBudgetAuthorization === lease.resourceBudgetAuthorization, "Studio generation requires the lease's exact resource budget"); const budget = recordById("resource-budgets", request.resourceBudgetAuthorization, options); assert(budget.maximumStudioQuota >= 1 && Date.parse(now(options)) <= Date.parse(budget.expiresAt), "Studio resource budget is exhausted by terms or expired"); const maximumWallTimeSeconds = request.maximumWallTimeSeconds ?? 300; const plannedUse = { providerCalls: 1, sourceBytesEgressed: 0, providerWallTimeSeconds: maximumWallTimeSeconds, studioQuotaConsumed: 1 }; admitResourceUse(lease, plannedUse, options); const args = ["generate", offer.artifactType]; if (request.instructions && offer.artifactType !== "mind-map") args.push(request.instructions); args.push("--notebook", lease.notebookId); if (request.instructions && offer.artifactType === "mind-map") args.push("--instructions", request.instructions, "--kind", "note-backed");
    const result = (options.runCli ?? defaultCli)(args, maximumWallTimeSeconds * 1000); if (result.status !== 0) return refusal(operation, `studio-generation-failed:${result.diagnostic}`);
    return appendRecord("operation-receipts", { type: "GeminiNotebookStudioGenerationReceipt", provider: PROVIDER, customer: lease.customer, operation, lease: lease.id, offer: offer.id, resourceBudgetAuthorization: request.resourceBudgetAuthorization, notebookId: lease.notebookId, artifactType: offer.artifactType, job: result.value, status: "submitted", submittedAt: now(options), advisoryAuthority: "none", resourceUse: { ...plannedUse, providerWallTimeSeconds: wallSeconds(started) }, costSettlement: "observed-provider-native-meters-only", externalEffects: [{ effect: "studio-generation-submitted" }] }, options);
  } catch (error) { return refusal(operation, `studio-generation-refused:${error.message}`); }
}

function artifactIdentity(value) {
  const queue = [value]; while (queue.length) { const row = queue.shift(); if (!row || typeof row !== "object") continue;
    for (const key of ["artifact_id", "artifactId", "task_id", "taskId", "id"]) if (typeof row[key] === "string" && row[key]) return row[key];
    for (const child of Object.values(row)) if (child && typeof child === "object") queue.push(child);
  } return null;
}
const CARRIERS = {
  audio: [".mp3", "audio/mpeg"], "cinematic-video": [".mp4", "video/mp4"], "data-table": [".csv", "text/csv"], flashcards: [".json", "application/json"], infographic: [".png", "image/png"], "mind-map": [".json", "application/json"], quiz: [".json", "application/json"], report: [".md", "text/markdown"], "slide-deck": [".pdf", "application/pdf"], video: [".mp4", "video/mp4"],
};
function validateCarrier(type, bytes) {
  assert(bytes.length > 0, "downloaded Studio carrier is empty");
  if (["flashcards", "mind-map", "quiz"].includes(type)) JSON.parse(bytes.toString("utf8"));
  if (type === "data-table") { const rows = decodeCsvRows(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); assert(rows.length >= 1 && rows[0].every((cell) => cell.trim()), "data-table headers must be nonempty"); assert(new Set(rows[0]).size === rows[0].length, "data-table headers must be unique"); assert(rows.every((row) => row.length === rows[0].length), "data-table rows are not rectangular"); assert(!rows.flat().some((cell) => /^[=+\-@]/u.test(cell.trimStart())), "data-table contains a spreadsheet-formula-like cell"); }
  if (type === "audio") assert(bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), "audio carrier is not MP3-shaped");
  if (type === "infographic") assert(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), "infographic carrier is not PNG");
  if (["video", "cinematic-video"].includes(type)) assert(bytes.subarray(4, 8).toString("ascii") === "ftyp", "video carrier is not MP4");
  if (type === "report") new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (type === "slide-deck") assert(bytes.subarray(0, 4).toString("ascii") === "%PDF", "slide carrier is not PDF");
}

export function settleStudio(request, options = {}) {
  const generation = recordById("operation-receipts", request?.generation, options); const operation = request.operationId ?? semanticId({ generation: generation.id, settle: true });
  try {
    const started = performance.now(); assert(generation.type === "GeminiNotebookStudioGenerationReceipt" && generation.customer === actor(request.customer), "generation is not customer-owned"); const lease = liveLease(generation.lease, request.customer, options); const timeoutSeconds = request.timeoutSeconds ?? 1800; const plannedUse = { providerCalls: request.deleteRemote === false ? 2 : 3, sourceBytesEgressed: 0, providerWallTimeSeconds: timeoutSeconds, studioQuotaConsumed: 0 }; admitResourceUse(lease, plannedUse, options);
    const prior = records("studio-artifacts", options).filter((row) => row.generation === generation.id); if (prior.length) { assert(prior.length === 1, "generation has conflicting artifact settlements"); return prior[0]; }
    const artifactId = artifactIdentity(generation.job); assert(artifactId, "generation receipt has no provider artifact identity"); const runCli = options.runCli ?? defaultCli;
    const waited = runCli(["artifact", "wait", artifactId, "--notebook", lease.notebookId, "--timeout", String(timeoutSeconds)], timeoutSeconds * 1000); if (waited.status !== 0) return refusal(operation, `studio-wait-failed:${waited.diagnostic}`);
    const [extension, mediaType] = CARRIERS[generation.artifactType]; const output = join(directory(dataRoot(options), "studio-carriers"), `${artifactId.replace(/[^A-Za-z0-9._-]/gu, "_")}${extension}`);
    const downloaded = runCli(["download", generation.artifactType, output, "--notebook", lease.notebookId, "--artifact", artifactId, "--force"]); if (downloaded.status !== 0 || !existsSync(output)) return refusal(operation, `studio-download-failed:${downloaded.diagnostic}`);
    const bytes = readFileSync(output); validateCarrier(generation.artifactType, bytes); const carrierDigest = sha256Digest(bytes);
    let remoteCleanup = "retained"; if (request.deleteRemote !== false) { const deleted = runCli(["artifact", "delete", artifactId, "--notebook", lease.notebookId, "--yes"]); remoteCleanup = deleted.status === 0 ? "delete-acknowledged" : `delete-not-acknowledged:${deleted.diagnostic}`; }
    return appendRecord("studio-artifacts", {
      type: "GeminiNotebookStudioArtifactReceipt", provider: PROVIDER, customer: lease.customer,
      operation, generation: generation.id, lease: lease.id, notebookId: lease.notebookId,
      providerArtifactId: artifactId, artifactType: generation.artifactType,
      carrier: { path: output, digest: carrierDigest, byteLength: bytes.length, mediaType },
      remoteCleanup, advisoryAuthority: "none", settledAt: now(options), disposition: "completed", resourceUse: { ...plannedUse, providerWallTimeSeconds: wallSeconds(started) },
      externalEffects: [{ effect: "artifact-downloaded" }, ...(remoteCleanup === "delete-acknowledged" ? [{ effect: "remote-artifact-delete-acknowledged" }] : [])],
    }, options);
  } catch (error) { return refusal(operation, `studio-settlement-refused:${error.message}`); }
}

export function condenseArtifact(request, options = {}) {
  actor(request?.customer); assert(typeof request.carrierPath === "string", "carrierPath is required"); const path = safeFile(request.carrierPath); const bytes = readFileSync(path); const carrierDigest = sha256Digest(bytes); assert(!request.expectedDigest || request.expectedDigest === carrierDigest, "artifact digest changed");
  const out = directory(dataRoot(options), "condensates"); const extension = request.reingestAsText === false ? extname(path) : ".txt"; const target = join(out, `${carrierDigest.slice(7)}${extension || ".bin"}`);
  if (!existsSync(target)) writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
  return appendRecord("operation-receipts", { type: "GeminiNotebookCondensationReceipt", provider: PROVIDER, customer: request.customer, sourceArtifact: request.sourceArtifact ?? null, carrierDigest, carrierMediaType: request.mediaType ?? "application/octet-stream", localKnowledgePath: target, reingestMediaType: request.reingestAsText === false ? (request.mediaType ?? "application/octet-stream") : "text/plain", condensedAt: now(options), authority: "non-authoritative-derived-knowledge", promotionStatus: "not-proposed", externalEffects: [] }, options);
}

export function proposePromotion(request, options = {}) {
  actor(request?.customer); const condensation = recordById("operation-receipts", request.condensation, options); assert(condensation.type === "GeminiNotebookCondensationReceipt" && condensation.customer === request.customer, "condensation is not customer-owned");
  return appendRecord("promotion-proposals", { type: "UnionAdvisoryPromotionProposal", provider: PROVIDER, proposer: request.customer, condensation: condensation.id, carrierDigest: condensation.carrierDigest, reviewRequestedFrom: request.assayAuthority ?? "urn:ame:union-advisory-corpus-curator", rationale: request.rationale ?? "", proposedAt: now(options), status: "pending-review", authorityGranted: [], externalEffects: [] }, options);
}

export function destroyWorkspace(request, options = {}) {
  const started = performance.now(); const leaseRecord = recordById("leases", request?.lease, options); const operation = request.operationId ?? semanticId({ lease: leaseRecord.id, destroy: leaseRecord.notebookId }); const prior = records("cleanup-receipts", options).filter((row) => row.operation === operation);
  if (prior.length) { assert(prior.length === 1 && prior[0].lease === leaseRecord.id, "cleanup replay conflicts with prior receipt"); return prior[0]; }
  const lease = liveLease(request.lease, request.customer, options);
  const maximumWallTimeSeconds = request.maximumWallTimeSeconds ?? 120; const plannedUse = { providerCalls: 2, sourceBytesEgressed: 0, providerWallTimeSeconds: maximumWallTimeSeconds, studioQuotaConsumed: 0 }; admitResourceUse(lease, plannedUse, options);
  const intent = appendRecord("cleanup-intents", { type: "GeminiNotebookWorkspaceCleanupIntent", provider: PROVIDER, customer: lease.customer, operation, lease: lease.id, notebookId: lease.notebookId, reason: request.reason ?? "lease-customer-request", recordedAt: now(options), status: "effect-intent-recorded" }, options);
  const runCli = options.runCli ?? defaultCli; const deletion = runCli(["delete", lease.notebookId, "--yes"], maximumWallTimeSeconds * 1000); if (deletion.status !== 0) return appendRecord("cleanup-receipts", { type: "GeminiNotebookWorkspaceLeakReceipt", provider: PROVIDER, customer: lease.customer, operation, intent: intent.id, lease: lease.id, notebookId: lease.notebookId, status: "not-confirmed-deleted", diagnostic: deletion.diagnostic, observedAt: now(options), resourceUse: { ...plannedUse, providerCalls: 1, providerWallTimeSeconds: wallSeconds(started) }, externalEffects: [] }, options);
  const observation = runCli(["list"]); const rows = observation.value?.notebooks ?? []; const absent = observation.status === 0 && Array.isArray(rows) && !rows.some((row) => row.id === lease.notebookId);
  return appendRecord("cleanup-receipts", { type: absent ? "GeminiNotebookWorkspaceCleanupReceipt" : "GeminiNotebookWorkspaceLeakReceipt", provider: PROVIDER, customer: lease.customer, operation, intent: intent.id, lease: lease.id, notebookId: lease.notebookId, status: absent ? "confirmed-deleted" : "not-confirmed-deleted", observedAt: now(options), resourceUse: { ...plannedUse, providerWallTimeSeconds: wallSeconds(started) }, externalEffects: absent ? [{ effect: "notebook-deleted", notebookId: lease.notebookId }] : [] }, options);
}

export const operations = { observeMarket, authorizeResourceBudget, quoteWorkspace, acceptWorkspaceOffer, openWorkspace, compileCorpus, addCorpus, askWorkspace, quoteStudio, generateStudio, settleStudio, condenseArtifact, proposePromotion, destroyWorkspace };
