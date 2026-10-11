#!/usr/bin/env node
// Keeps the "Harmonious Union Overview" Gemini notebook
// (ffb73bcf-d374-4b1f-bafb-4edc3c16a9b9) in sync with the Union's own current
// best self-conception content. Desired sources are DISCOVERED, not
// hardcoded: root AGENTS.md's own "governing maps" bullet list is parsed
// fresh every run, and content/characters/*.json is globbed fresh every run
// -- so a Leader edit to either grows or shrinks what this script uploads
// next time it runs, with no code change here. Root AGENTS.md/README.md/
// CLAUDE.md are the only three paths named directly, because they are fixed
// structural entry points, not a curated pick.
//
// Idempotent and additive-only against every pre-existing source this
// notebook already carried: this script never touches a source it did not
// itself add (tracked in data/union-notebook-sync-state.json by repo path ->
// {digest, sourceId}). A changed file becomes a new immutable, digest-bound
// source generation through the existing curated-cumulative-add contract.
// Stale generations remain addressable history; this script never bypasses
// that contract with an unwitnessed direct deletion.
import { randomUUID } from "node:crypto";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIVITYSTREAMS_CONTEXT } from "@red-cup-engineering/activitypub-services-section/activitystreams";

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE_ROOT = resolve(HERE, "..");
const CONTRACT_SCRIPT = join(NODE_ROOT, "src/contract-gemini-notebook-sources.js");
const STATE_PATH = join(NODE_ROOT, "data/union-notebook-sync-state.json");
const NOTEBOOK_ID = "ffb73bcf-d374-4b1f-bafb-4edc3c16a9b9";
const PROVIDER = "urn:ame:notebooklm-inference-team";
const LMT = "urn:ame:leader-movement-team";

// Root is identified by the workspace root package.json's own name, not by a
// hand-authored doc's presence (AGENTS.md was removed as unowned prose).
function isRepoRootDirectory(d) {
  const path = join(d, "package.json");
  if (!existsSync(path)) return false;
  try { return JSON.parse(readFileSync(path, "utf8")).name === "@bare-cedar-fog/machine-workspace"; }
  catch { return false; }
}
function findRepoRoot(from) {
  let d = resolve(from);
  for (;;) {
    if (existsSync(join(d, ".git")) && existsSync(join(d, "deno.jsonc")) && isRepoRootDirectory(d)) return d;
    const up = dirname(d);
    if (up === d) throw new Error("no settlement root found above " + from);
    d = up;
  }
}

function sha256(path) { return sha256Digest(readFileSync(path)); }

// AGENTS.md is gone (removed as unowned prose, no generator behind it), so
// its former "governing maps are:" bullet list has nowhere to be parsed
// from. Degrades to no extra governing-map sources rather than throwing.
function governingMaps(repoRoot) {
  const path = join(repoRoot, "AGENTS.md");
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const marker = text.indexOf("governing maps are:");
  if (marker === -1) return [];
  const after = text.slice(marker);
  return [...after.matchAll(/^- `([^`]+)`$/gmu)].map((m) => m[1]);
}

function characterRecords(repoRoot) {
  const dir = join(repoRoot, "lib/emsenn/services/561-group/services/board-of-directors/services/executive-office/services/leader-movement-team/content/characters");
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join("lib/emsenn/services/561-group/services/board-of-directors/services/executive-office/services/leader-movement-team/content/characters", f));
}

export function computeDesiredSources(repoRoot) {
  // AGENTS.md and CLAUDE.md were both removed from the repo (unowned
  // hand-authored prose, no generator behind either) — filter the fixed
  // entry-point list to what's actually on disk instead of hardcoding
  // documents that no longer exist and would crash sha256() below.
  const relPaths = [
    "AGENTS.md",
    "README.md",
    "CLAUDE.md",
    ...governingMaps(repoRoot),
    ...characterRecords(repoRoot),
  ].filter((rel) => existsSync(resolve(repoRoot, rel)));
  return relPaths.map((rel) => {
    const abs = resolve(repoRoot, rel);
    return { rel, abs, digest: sha256(abs), title: rel };
  });
}

function loadState() {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}
function saveState(state) { writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`); }

function runContract(operation, activity) {
  const execution = spawnSync("node", [CONTRACT_SCRIPT, "--operation", operation], { input: JSON.stringify(activity), encoding: "utf8", maxBuffer: Number.POSITIVE_INFINITY, env: process.env });
  let parsed;
  try { parsed = JSON.parse(execution.stdout); } catch { parsed = undefined; }
  if (execution.status !== 0 || !parsed) throw new Error(`${operation} failed: ${execution.stderr || execution.stdout}`);
  return parsed;
}

function solicitAndInvoke(request, tag) {
  const sourceActivity = { id: `urn:union-notebook-sync:${tag}:${randomUUID()}`, type: "Create", object: { type: "Note", content: "Union notebook sync.", attachment: [request] } };
  const solicitActivity = { "@context": ACTIVITYSTREAMS_CONTEXT, id: `urn:union-notebook-sync:solicit:${tag}:${randomUUID()}`, type: "Offer", actor: LMT, target: PROVIDER, object: { type: "ServiceSolicitation", sourceActivity } };
  const offer = runContract(request.executionMode === "observe-live" ? "solicit-source-reconciliation" : "solicit-source-reconciliation", solicitActivity);
  if (offer.type !== "Offer") throw new Error(`solicit refused: ${JSON.stringify(offer)}`);
  const capability = { type: "Capability", holder: PROVIDER, invocationTarget: PROVIDER, parentOffer: offer.id, attenuation: { requestDigest: offer.object.requestDigest, providerScope: offer.object.scope }, allowedActions: ["invoke-source-reconciliation", ...(offer.object.effects ?? [])] };
  const acceptActivity = { "@context": ACTIVITYSTREAMS_CONTEXT, id: `urn:union-notebook-sync:accept:${tag}:${randomUUID()}`, type: "Accept", actor: LMT, target: PROVIDER, object: { type: "ServiceContract", contract: offer.object.contract, offer, capability } };
  return runContract("invoke-source-reconciliation", acceptActivity);
}

export async function syncUnionNotebook({ repoRoot = findRepoRoot(HERE), dryRun = false } = {}) {
  const desired = computeDesiredSources(repoRoot);
  const state = loadState();

  // A file this script has never tracked might already be present in the
  // notebook by some other route (e.g. the pre-existing 84 uploaded before
  // this script existed) -- observe live titles first so "new" means
  // genuinely absent, not just untracked by us.
  const observed = solicitAndInvoke({ type: "GeminiNotebookSourceReconciliationRequest", notebookId: NOTEBOOK_ID, policy: "observe-only", executionMode: "observe-live" }, "observe");
  const currentSources = observed.object.receipt.previousSources;
  const expectedCurrentSourceIds = currentSources.map((s) => s.id);
  const currentTitles = new Set(currentSources.map((s) => s.title));
  const trackedFor = (source) => state[source.rel] ?? state[source.rel.split("/").pop()];
  const boundTitle = (source) => `SHUOC ${source.digest} ${source.rel}`.slice(0, 180);

  const toAdd = desired.filter((d) => {
    const tracked = trackedFor(d);
    if (tracked) return tracked.digest !== d.digest; // ours, and content changed
    return !currentTitles.has(boundTitle(d)) && !currentTitles.has(d.rel.split("/").pop());
  });
  const retainedStale = desired.filter((d) => trackedFor(d)?.digest !== undefined && trackedFor(d).digest !== d.digest).map((d) => trackedFor(d).sourceId).filter(Boolean);

  if (toAdd.length === 0) {
    // Still record untracked-but-already-present files so a future content
    // change to them is detected as "ours to update" rather than silently
    // matching currentTitles forever with stale state.
    for (const d of desired) if (!trackedFor(d) && currentTitles.has(d.rel.split("/").pop())) state[d.rel] = { digest: d.digest, sourceId: null, rel: d.rel, note: "pre-existing, not added by this script" };
    saveState(state);
    return { outcome: "already-in-sync", desiredCount: desired.length };
  }
  if (dryRun) return { outcome: "would-sync", toAdd: toAdd.map((d) => d.rel), retainedStale };

  const reconciled = solicitAndInvoke({
    type: "GeminiNotebookSourceReconciliationRequest", notebookId: NOTEBOOK_ID, policy: "curated-cumulative-add", executionMode: "reconcile-live",
    expectedCurrentSourceIds,
    desiredSources: toAdd.map((d) => ({ path: d.abs, digest: d.digest, title: d.rel })),
  }, "reconcile");
  const receipt = reconciled.object.receipt;

  for (const d of toAdd) {
    const match = receipt.finalSources.find((s) => s.title === `SHUOC ${d.digest} ${d.rel}`.slice(0, 180));
    if (match) state[d.rel] = { digest: d.digest, sourceId: match.id, rel: d.rel };
  }
  saveState(state);

  return { outcome: "synced", added: toAdd.map((d) => d.rel), retainedStale };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  syncUnionNotebook({ dryRun }).then((result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); }).catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
