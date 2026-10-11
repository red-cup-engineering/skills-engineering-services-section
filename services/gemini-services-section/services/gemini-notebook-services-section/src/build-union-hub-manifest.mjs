#!/usr/bin/env node
// Produce a reproducible, reviewable source manifest for the Union knowledge
// hub.  This is deliberately selection-only: compileCorpus() remains the
// authority that projects and admits these repository files to Gemini Notebook.
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { walkPosixPathsSync } from "@red-cup-engineering/computer-filepath-engineering-services-section/walk-posix-paths";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE_ROOT = resolve(HERE, "..");
const DEFAULT_ROOT = resolve(NODE_ROOT, "../../../../../../../../../../../..");
const LIMIT = 3 * 1024 * 1024;
const CEILING = 300;
const SECTORS = [
  ["board", "board-of-directors", 85],
  ["lenticule", "lenticule-science", 70],
  ["rsc", "rsc-quiescent", 45],
  ["academy", "union-officer-academy", 40],
  ["red-cup", "red-cup-engineering", 25],
];
const EXTENSIONS = new Set([".md", ".rml", ".txt"]);
const EXCLUDED = [
  "/.git/", "/node_modules/", "/dist/", "/build/", "/coverage/", "/data/",
  "/assets/legacy/", "/legacy-", "/_private/", "/test/", "/tests/",
  "/fixtures/", "/generated/", "/frozen-inputs/", "/journals/", "/diary/",
  "/log-entries/", "/transcripts/", "/upload-txt", "/work/items/", "/work/tasks/",
];
const HIGH_VALUE = [
  "/content/glossary/", "/content/charters/", "/content/constitutions/", "/content/contracts/",
  "/content/text/documents/articles/essays/", "/content/text/documents/articles/letters/",
  "/content/text/documents/articles/notes/2026/07/", "/content/records/",
  "/docs/", "/.agents/docs/", "/content/designs/", "/governance/", "/prose/teaching/",
];
const TERMS = ["union", "harmonious", "constitution", "charter", "governance", "theory", "semiotic", "relational", "predicat", "lenticule", "obsmetrolog", "formation", "autonomy", "sovereign", "architecture", "specification", "glossary", "rendanheyi", "huidu"];

function sha256(path) { return sha256Digest(readFileSync(path)); }
function walk(root) {
  return walkPosixPathsSync({ root, paths: "absolute", result: "paths" }).files;
}
function score(path, bytes) {
  const lower = path.toLowerCase();
  let value = 0;
  for (const marker of HIGH_VALUE) if (lower.includes(marker)) value += 24;
  for (const term of TERMS) if (lower.includes(term)) value += 4;
  if (lower.includes("/2026/07/")) value += 8;
  if (lower.includes("/2026/06/")) value += 3;
  if (extname(path) === ".md") value += 5;
  // Prefer substantial, independently useful documents without rewarding dumps.
  value += Math.min(12, Math.floor(bytes / 4096));
  return value;
}
function candidate(path, repoRoot) {
  const rel = relative(repoRoot, path).replaceAll("\\", "/");
  if (!EXTENSIONS.has(extname(path).toLowerCase()) || EXCLUDED.some((marker) => `/${rel}`.includes(marker))) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > LIMIT) return null;
  const sector = SECTORS.find(([, name]) => rel.startsWith(`lib/emsenn/services/561-group/services/${name}/`));
  if (!sector) return null;
  return { path, rel, sector: sector[0], digest: sha256(path), byteLength: stat.size, score: score(rel, stat.size) };
}
function select(rows) {
  // Exact hashes are duplicate generations: retain the highest ranked path,
  // with lexical ordering making ties stable across runs.
  const unique = [...new Map(rows.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel)).map((row) => [row.digest, row])).values()];
  const selected = [];
  const selectedDigests = new Set();
  for (const [sector, , quota] of SECTORS) {
    for (const row of unique.filter((item) => item.sector === sector).slice(0, quota)) { selected.push(row); selectedDigests.add(row.digest); }
  }
  // A sector may contain fewer candidates than its allocation. Backfill from
  // the remaining high-ranked material without changing any fulfilled quota.
  for (const row of unique) if (selected.length < CEILING && !selectedDigests.has(row.digest)) { selected.push(row); selectedDigests.add(row.digest); }
  return selected.sort((a, b) => a.sector.localeCompare(b.sector) || b.score - a.score || a.rel.localeCompare(b.rel)).slice(0, CEILING);
}
export function buildUnionHubManifest({ repoRoot = DEFAULT_ROOT, customer = "urn:ame:leader-movement-team" } = {}) {
  const roots = SECTORS.map(([, name]) => join(repoRoot, "lib/emsenn/services/561-group/services", name));
  const candidates = roots.flatMap((root) => walk(root).map((path) => candidate(path, repoRoot)).filter(Boolean));
  const selected = select(candidates);
  if (selected.length !== CEILING) throw new Error(`only ${selected.length} eligible, deduplicated sources; need ${CEILING}`);
  const sectors = Object.fromEntries(SECTORS.map(([id]) => [id, selected.filter((row) => row.sector === id).length]));
  return {
    type: "UnionKnowledgeHubCandidateManifest", version: 1, purpose: "Source-grounded Union self-conception and theory hub; repository evidence only.",
    customer, sourceCeiling: CEILING, retention: "persistent", maxSourceBytes: LIMIT,
    selection: { candidates: candidates.length, exactHashDeduplicated: candidates.length - new Set(candidates.map((row) => row.digest)).size, sectors, exclusions: EXCLUDED },
    sources: selected.map(({ path, rel, sector, digest, byteLength, score: value }) => ({ kind: "file", path, title: `Union Hub [${sector}] ${rel}`, disclosure: "repository-source", metadata: { rel, sector, digest, byteLength, score: value } })),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = argument("--output"); const manifest = buildUnionHubManifest(); const json = `${JSON.stringify(manifest, null, 2)}\n`;
  if (output !== undefined) writeFileSync(resolve(output), json, { flag: "w" }); else process.stdout.write(json);
}
