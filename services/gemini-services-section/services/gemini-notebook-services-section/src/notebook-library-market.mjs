import { runGeminiNotebookSync } from "./gemini-notebook-cli.mjs";
import { openGeminiNotebook, readStorageState } from "./gemini-notebook-client.mjs";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { identifyRelationalValue } from "./semantic-content.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_ID = /^did:pkh:eip155:5615610:0x[a-fA-F0-9]{40}$/u;
const CELL_ID = /^(?:urn:sha256:[a-f0-9]{64}|ni:\/\/\/sha-256;[A-Za-z0-9_-]{43})$/u;
const CELL_FILENAME = /^(?:urn:sha256:|ni:\/\/\/sha-256;)(.+)$/u;
const ACCESS = new Set(["request-grounded-analysis", "fork-to-customer-workspace"]);
function ni(value) { return identifyRelationalValue("gemini-notebook.library-market-record", value).token; }
function assert(condition, message) { if (!condition) throw new TypeError(message); }
function rootId(value, field) { assert(ROOT_ID.test(value ?? ""), `${field} must be a root did:pkh on eip155:5615610`); return value; }
function text(value, field, maximum) { assert(typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum, `${field} must be 1-${maximum} characters`); return value.trim(); }
function marketRoot(options = {}) { return resolve(options.dataRoot ?? join(ROOT, "data", "notebook-library-market")); }
function records(options = {}) { const directory = join(marketRoot(options), "records"); return existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(join(directory, name), "utf8"))) : []; }
function append(body, options) { const row = { id: semanticId(body), ...body }, directory = join(marketRoot(options), "records"), target = join(directory, `${CELL_FILENAME.exec(row.id)[1]}.json`); mkdirSync(directory, { recursive: true }); if (!existsSync(target)) writeFileSync(target, `${JSON.stringify(row, null, 2)}\n`, { flag: "wx", mode: 0o600 }); return row; }
function activeNodes(options) { const all = records(options), withdrawn = new Set(all.filter((row) => row.type === "NotebookKnowledgeNodeWithdrawal").map((row) => row.node)); return all.filter((row) => row.type === "NotebookKnowledgeNode" && !withdrawn.has(row.id)); }
function providerAuthStorage(options = {}) {
  if (typeof options.storagePath === "string" && options.storagePath !== "") return resolve(options.storagePath);
  const source = options.authJson ?? process.env.NOTEBOOKLM_AUTH_JSON;
  if (typeof source !== "string" || source.trim() === "") return null;
  let parsed;
  try { parsed = JSON.parse(source); } catch { throw new TypeError("NOTEBOOKLM_AUTH_JSON must contain one valid storage-state object"); }
  assert(parsed && typeof parsed === "object" && Array.isArray(parsed.cookies), "NOTEBOOKLM_AUTH_JSON must contain one valid storage-state object");
  const directory = resolve(options.authDirectory ?? join(tmpdir(), "gemini-notebook-provider-auth"));
  const target = join(directory, "storage_state.json");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!existsSync(target)) writeFileSync(target, `${JSON.stringify(parsed)}\n`, { flag: "wx", mode: 0o600 });
  return target;
}
function geminiNotebook(args, options = {}) {
  const timeout = options.providerTimeoutMs ?? 120_000;
  assert(Number.isInteger(timeout) && timeout >= 1 && timeout <= 600_000, "providerTimeoutMs must be an integer from 1 through 600000");
  const storagePath = providerAuthStorage(options);
  const environment = { ...process.env };
  if (storagePath !== null) delete environment.NOTEBOOKLM_AUTH_JSON;
  const run = runGeminiNotebookSync(args, { root: ROOT, storagePath, maxBuffer: 16 * 1024 * 1024, timeout, env: options.python ? { ...environment, GEMINI_NOTEBOOK_PYTHON: options.python } : environment });
  run.error = run.errorCode ? { code: run.errorCode, message: run.errorCode } : undefined;
  if (run.error?.code === "ETIMEDOUT") { const error = new Error(`Gemini Notebook ${args[0]} timed out after ${timeout}ms`); error.code = "GEMINI_NOTEBOOK_PROVIDER_TIMEOUT"; throw error; }
  if (run.error) { const error = new Error(`Gemini Notebook ${args[0]} could not run: ${run.error.message}`); error.code = "GEMINI_NOTEBOOK_PROVIDER_FAILURE"; throw error; }
  if (run.status !== 0) { const error = new Error(`Gemini Notebook ${args[0]} failed: ${(run.stderr || run.stdout).trim().slice(0, 1000)}`); error.code = "GEMINI_NOTEBOOK_PROVIDER_FAILURE"; throw error; }
  try { return JSON.parse(run.stdout); } catch { throw new Error(`Gemini Notebook ${args[0]} returned no JSON inventory`); }
}
// The signed-in read client, one per credential: options.client, else the
// storage state named by options.storagePath or options.authJson (or
// NOTEBOOKLM_AUTH_JSON), else the notebooklm login's profile.
const clients = new Map();
function client(options = {}) {
  if (options.client) return Promise.resolve(options.client);
  const authJson = options.authJson ?? (options.storagePath ? undefined : process.env.NOTEBOOKLM_AUTH_JSON);
  const key = options.storagePath ?? authJson ?? "profile";
  if (!clients.has(key)) {
    const readState = () => (authJson ? JSON.parse(authJson) : readStorageState(options.storagePath ? { storagePath: resolve(options.storagePath) } : {}));
    const opened = openGeminiNotebook({ readState });
    clients.set(key, opened);
    opened.catch(() => clients.delete(key));
  }
  return clients.get(key);
}
function publicNotebook(notebook) { return { id: notebook.id, title: notebook.title, createdAt: notebook.createdAt, isOwner: notebook.isOwner, sourceCount: notebook.sources.length, sources: notebook.sources.map((source) => ({ type: source.typeCode, title: source.title })) }; }
function publicStudioResource(artifact) { return { id: artifact.id, title: artifact.title, type: artifact.kind, typeId: artifact.kind, status: artifact.status === "completed" ? "completed" : artifact.status, statusId: artifact.status, createdAt: artifact.createdAt, mediaTypes: artifact.media.map((media) => media.mediaType) }; }
async function studioArtifact(notebookId, resourceId, options) {
  const artifact = (await (await client(options)).listArtifacts(notebookId)).find((row) => row.id === resourceId);
  assert(artifact, "Gemini Notebook Studio resource was not found");
  return artifact;
}

/**
 * Observe a provider library once and produce the two things the L-space
 * membrane needs: an opaque, content-addressed catalog for the MUD and an
 * in-memory resolver for the provider IDs.  Neither provider IDs nor source
 * titles cross the returned catalog; the resolver is deliberately a closure,
 * not a file-backed binding store.
 */
export async function createLiveNotebookLspaceCatalog(request = {}, options = {}) {
  const observedAt = options.now ?? new Date().toISOString();
  const inputNi = ni({ type: "GeminiNotebookLiveLspaceCatalogRequest", version: 1, provider: "urn:ame:notebooklm-inference-team", operation: "observe-notebook-library" });
  try {
    const provider = await client(options);
    const inventory = await provider.listNotebooks();
    const described = await Promise.all(inventory.map((entry) => provider.getNotebook(entry.id)));
    const bindings = new Map();
    const notebooks = inventory.flatMap((entry, index) => {
      const metadata = described[index] ?? { sources: [] };
      const notebookRefNi = ni({ type: "GeminiNotebookPrivateNotebookReference", version: 1, provider: "urn:ame:notebooklm-inference-team", providerReferenceDigest: sha256Digest(entry.id) });
      const sourceBindings = (metadata.sources ?? []).map((source, ordinal) => {
        const providerReference = source.id;
        assert(typeof providerReference === "string" && providerReference.length > 0, `Gemini Notebook source ${ordinal} has no provider reference`);
        const sourceReceiptNi = ni({ type: "GeminiNotebookSourceObservationReceipt", version: 1, notebookRefNi, providerReferenceDigest: sha256Digest(providerReference), sourceType: source.typeCode === null ? "unknown" : String(source.typeCode) });
        return Object.freeze({ providerReference, sourceReceiptNi });
      });
      const sourceReceiptNis = sourceBindings.map(({ sourceReceiptNi }) => sourceReceiptNi).sort();
      if (sourceReceiptNis.length === 0) return [];
      const sourceSetNi = ni({ type: "GeminiNotebookSourceSet", version: 1, notebookRefNi, sourceReceiptNis });
      bindings.set(notebookRefNi, Object.freeze({ notebookId: entry.id, sourceSetNi, sourceBindings: Object.freeze(sourceBindings) }));
      return [Object.freeze({ notebookRefNi, sourceSetNi, sourceReceiptNis, access: "query", witnessNis: [ni({ type: "GeminiNotebookObservationWitness", version: 1, notebookRefNi, observedAt, sourceSetNi })] })];
    });
    const libraryReceiptNi = ni({ type: "GeminiNotebookLibraryObservationReceipt", version: 1, provider: "urn:ame:notebooklm-inference-team", observedAt, notebookCount: notebooks.length });
    const catalogBody = { type: "GeminiNotebookLibraryCatalogReceipt", version: 1, provider: "urn:ame:notebooklm-inference-team", libraryReceiptNi, notebooks };
    const catalog = Object.freeze({ id: ni(catalogBody), ...catalogBody });
    const observation = { type: "GeminiNotebookLiveLspaceCatalogObservation", version: 1, disposition: "observed", observedAt, inputNi, catalogNi: catalog.id };
    return Object.freeze({ ...observation, id: ni(observation), catalog, availability: Object.freeze({ available: true }), resolvePrivateBinding: async ({ notebookRefNi, sourceSetNi }) => { const binding = bindings.get(notebookRefNi); if (!binding || binding.sourceSetNi !== sourceSetNi) throw new Error("Gemini Notebook private binding is absent or displaced"); return binding; } });
  } catch (error) { throw Object.assign(error, { inputNi }); }
}

/** Observe the actual authenticated Gemini Notebook library: every visible notebook and, when asked, its source topology. */
export async function observeLiveNotebookLibrary(request = {}, options = {}) {
  const provider = await client(options);
  const query = typeof request.query === "string" ? request.query.trim().toLowerCase() : "";
  const inventory = await provider.listNotebooks();
  const listed = request.includeSources === true ? (await Promise.all(inventory.map((notebook) => provider.getNotebook(notebook.id)))).filter(Boolean).map(publicNotebook) : inventory.map((notebook) => ({ id: notebook.id, title: notebook.title, createdAt: notebook.createdAt, isOwner: notebook.isOwner, sourceCount: null }));
  const notebooks = listed.filter((notebook) => !query || `${notebook.title}\n${(notebook.sources ?? []).map((source) => source.title).join("\n")}`.toLowerCase().includes(query));
  return { type: "GeminiNotebookLiveLibraryObservation", provider: "notebooklm-inference-team", observedAt: options.now ?? new Date().toISOString(), count: notebooks.length, ownerCount: notebooks.filter((notebook) => notebook.isOwner).length, sharedCount: notebooks.filter((notebook) => !notebook.isOwner).length, notebooks };
}
/** Inspect the actual source topology of one selected notebook, without changing it. */
export async function describeLiveNotebook(request, options = {}) {
  text(request?.notebookId, "notebookId", 100);
  const notebook = await (await client(options)).getNotebook(request.notebookId);
  assert(notebook, "Gemini notebook was not found");
  return { type: "GeminiNotebookLiveNotebookDescription", provider: "notebooklm-inference-team", notebook: publicNotebook(notebook), observedAt: options.now ?? new Date().toISOString(), externalEffects: ["gemini-notebook-metadata-observation"] };
}
/** Ask one selected real notebook and return Gemini Notebook's cited answer; credentials remain in the provider membrane. */
export function askLiveNotebook(request, options = {}) {
  text(request?.notebookId, "notebookId", 100); const question = text(request?.question, "question", 12_000); const result = geminiNotebook(["ask", "--notebook", request.notebookId, question], options);
  return { type: "GeminiNotebookLiveAnswer", provider: "notebooklm-inference-team", notebookId: request.notebookId, question, answer: result, authority: "source-grounded-provider-answer-not-execution-or-governance-authority", externalEffects: ["gemini-notebook-chat-request"], observedAt: options.now ?? new Date().toISOString() };
}

/** List the existing Studio resources belonging to one live notebook. */
export async function observeLiveNotebookStudio(request, options = {}) {
  const notebookId = text(request?.notebookId, "notebookId", 100);
  const type = typeof request?.type === "string" && request.type.trim() ? request.type.trim().toLowerCase() : null;
  const provider = await client(options);
  const [notebook, artifacts] = await Promise.all([provider.getNotebook(notebookId), provider.listArtifacts(notebookId)]);
  const resources = artifacts.map(publicStudioResource).filter((resource) => !type || resource.typeId === type);
  return { type: "GeminiNotebookLiveStudioObservation", provider: "notebooklm-inference-team", notebookId, notebookTitle: notebook?.title ?? null, count: resources.length, resources, observedAt: options.now ?? new Date().toISOString(), externalEffects: ["gemini-notebook-artifact-inventory-observation"] };
}

/** Get the provider metadata for one exact existing Studio resource. */
export async function getLiveNotebookStudioResource(request, options = {}) {
  const notebookId = text(request?.notebookId, "notebookId", 100), resourceId = text(request?.resourceId, "resourceId", 100);
  const resource = publicStudioResource(await studioArtifact(notebookId, resourceId, options));
  return { type: "GeminiNotebookLiveStudioResourceDescription", provider: "notebooklm-inference-team", notebookId, resource, observedAt: options.now ?? new Date().toISOString(), externalEffects: ["gemini-notebook-artifact-metadata-observation"] };
}

/** Read one exact completed report, or generated Markdown or code file, as bounded UTF-8 text. */
export async function readLiveNotebookStudioReport(request, options = {}) {
  const notebookId = text(request?.notebookId, "notebookId", 100), resourceId = text(request?.resourceId, "resourceId", 100);
  const maximumBytes = request?.maximumBytes ?? 8 * 1024 * 1024;
  assert(Number.isInteger(maximumBytes) && maximumBytes >= 1 && maximumBytes <= 16 * 1024 * 1024, "maximumBytes must be an integer from 1 through 16777216");
  const artifact = await studioArtifact(notebookId, resourceId, options);
  assert(artifact.status === "completed", "Studio report is not completed");
  const media = artifact.media.find((entry) => /^(?:text\/|application\/(?:json|javascript|typescript))/u.test(entry.mediaType));
  assert(media, "Studio resource carries no text");
  const bytes = media.text !== undefined ? Buffer.from(media.text, "utf8") : Buffer.from(await (await (await client(options)).fetchMedia(media.url)).arrayBuffer());
  assert(bytes.length <= maximumBytes, `Studio report exceeds maximumBytes (${bytes.length} > ${maximumBytes})`);
  const content = bytes.toString("utf8");
  assert(Buffer.from(content, "utf8").equals(bytes), "Studio report is not valid UTF-8");
  return { type: "GeminiNotebookLiveStudioReport", provider: "notebooklm-inference-team", notebookId, resource: publicStudioResource(artifact), carrier: { mediaType: media.mediaType, byteLength: bytes.length, sha256: sha256Digest(bytes), content }, authority: "source-grounded-provider-report-not-execution-or-governance-authority", observedAt: options.now ?? new Date().toISOString(), externalEffects: ["gemini-notebook-artifact-metadata-observation", "gemini-notebook-report-download"] };
}

export function publishNotebookKnowledgeNode(request, options = {}) {
  const publisher = rootId(request?.publisher, "publisher"), title = text(request?.title, "title", 160), summary = text(request?.summary, "summary", 1200);
  assert(Array.isArray(request?.topics) && request.topics.length > 0 && request.topics.length <= 20, "topics must contain 1-20 public terms"); const topics = [...new Set(request.topics.map((value) => text(value, "topic", 80).toLowerCase()))].sort();
  assert(ACCESS.has(request?.accessMode), "accessMode is unsupported"); assert(CELL_ID.test(request?.sourceReceipt ?? ""), "sourceReceipt must be a receipt content address");
  return append({ type: "NotebookKnowledgeNode", version: 1, publisher, title, summary, topics, sourceReceipt: request.sourceReceipt, access: { mode: request.accessMode, entrypoint: "gemini-notebook-workspace-market", consideration: { fixedFee: null, markup: null, denominations: ["provider-calls", "source-bytes-egressed", "provider-wall-time-seconds", "studio-quota-consumed"], moneyRequires: "observed-cost-record" }, requires: ["provider-authored-offer", "resource-budget-authorization", "separate-custody-or-creation-authorization"] }, disclosure: { sourceContents: "not-disclosed", providerNotebookLocator: "not-disclosed", authority: "non-authoritative-discovery-metadata" }, publishedAt: options.now ?? new Date().toISOString() }, options);
}
export function observeNotebookKnowledgeLibrary(request = {}, options = {}) {
  const query = typeof request.query === "string" ? request.query.trim().toLowerCase() : "", topics = Array.isArray(request.topics) ? request.topics.map((value) => text(value, "topic", 80).toLowerCase()) : [], limit = request.limit ?? 50; assert(Number.isInteger(limit) && limit >= 1 && limit <= 100, "limit must be an integer from 1 to 100");
  const nodes = activeNodes(options).filter((node) => !query || `${node.title}\n${node.summary}\n${node.topics.join(" ")}`.toLowerCase().includes(query)).filter((node) => topics.every((topic) => node.topics.includes(topic))).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit); return { type: "NotebookKnowledgeLibraryObservation", provider: "notebooklm-inference-team", disposition: "observed", nodeCount: nodes.length, nodes };
}
export function requestNotebookKnowledgeAccess(request, options = {}) { const requester = rootId(request?.requester, "requester"); assert(CELL_ID.test(request?.node ?? ""), "node must be a knowledge-node cell address"); const node = activeNodes(options).find((row) => row.id === request.node); assert(node, "knowledge node is absent or withdrawn"); return append({ type: "NotebookKnowledgeAccessInquiry", version: 1, requester, node: node.id, custodian: node.publisher, requestedOperation: text(request?.requestedOperation, "requestedOperation", 120), accessMode: node.access.mode, requiredNextAct: "custodian-authored-provider-offer", authority: "inquiry-only", issuedAt: options.now ?? new Date().toISOString() }, options); }
export function withdrawNotebookKnowledgeNode(request, options = {}) { const publisher = rootId(request?.publisher, "publisher"); assert(CELL_ID.test(request?.node ?? ""), "node must be a knowledge-node cell address"); const node = activeNodes(options).find((row) => row.id === request.node); assert(node, "knowledge node is absent or already withdrawn"); assert(node.publisher === publisher, "only the publishing root may withdraw a knowledge node"); return append({ type: "NotebookKnowledgeNodeWithdrawal", version: 1, node: node.id, publisher, reason: text(request.reason ?? "withdrawn-by-publisher", "reason", 240), withdrawnAt: options.now ?? new Date().toISOString() }, options); }
export const operations = { publishNotebookKnowledgeNode, observeNotebookKnowledgeLibrary, requestNotebookKnowledgeAccess, withdrawNotebookKnowledgeNode, observeLiveNotebookLibrary, describeLiveNotebook, askLiveNotebook, observeLiveNotebookStudio, getLiveNotebookStudioResource, readLiveNotebookStudioReport, createLiveNotebookLspaceCatalog };
export const internals = Object.freeze({ providerAuthStorage });
