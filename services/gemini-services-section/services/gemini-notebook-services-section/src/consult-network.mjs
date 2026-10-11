#!/usr/bin/env node
/**
 * Disposable semantic-recovery consultation: `node src/consult-network.mjs "matching string" "question"`.
 * Selects matching repository files, creates one Gemini Notebook workspace, waits for source readiness,
 * asks one source-grounded question, records the result locally, and always attempts to delete that notebook.
 */
import { runGeminiNotebookSync } from "./gemini-notebook-cli.mjs";
import { randomUUID } from "node:crypto";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { retryWithBackoff } from "@red-cup-engineering/javascript-node-services-section/retry";
import { writeFileTextSync } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

const SERVICE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ROOT = process.env.EMSENN_REPOSITORY_ROOT ?? null;
const EXCLUDED = ["!**/.git/**", "!**/node_modules/**", "!**/.venv/**", "!**/data/credentials/**", "!**/*.lock", "!**/*.jsonl", "!**/*.jsonl.gz", "!**/data/advisory-corpus/**", "!**/data/codex-session-corpus*/**"];

function fail(message) { throw new Error(message); }
function run(args) {
  const result = runGeminiNotebookSync(args, { root: SERVICE_ROOT });
  if (result.status !== 0 || result.value === undefined) fail((result.stderr || result.stdout || `Gemini Notebook exited ${result.status}`).trim().slice(0, 2000));
  return result.value;
}
// Delegates to the canonical @red-cup-engineering/javascript-node-services-section/retry
// capability for both the retry loop and its delay -- this used to shell out to the `sleep`
// binary via spawnSync between attempts, which is exactly the child_process-as-delay defect
// that capability exists to remove. baseDelayMs/backoffFactor reproduce the prior 1s-then-2s
// linear-looking schedule (1000*2^0, 1000*2^1) for the default attempts=3 case.
async function retry(label, effect, attempts = 3) {
  const result = await retryWithBackoff({
    operation: async () => {
      try { return { ok: true, value: effect() }; }
      catch (error) { return { ok: false, refusal: error }; }
    },
    maxAttempts: attempts,
    baseDelayMs: 1000,
    backoffFactor: 2,
  });
  if (result.ok) return result.value;
  fail(`${label} failed after ${result.refusal.attempts} attempts: ${result.refusal.refusal.message}`);
}
function parse(argv) {
  const flagsWithValues = new Set(["--root", "--limit", "--session"]); const positional = [];
  for (let index = 0; index < argv.length; index += 1) { if (flagsWithValues.has(argv[index])) { index += 1; continue; } if (!argv[index].startsWith("--")) positional.push(argv[index]); }
  if (positional.length !== 2) fail('usage: consult-network.mjs "matching string" "question" [--root PATH] [--limit N] [--session PATH]');
  const limit = Number(argument("--limit", argv) ?? "300");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 300) fail("--limit must be an integer from 1 through 300");
  const configuredRoot = argument("--root", argv) ?? DEFAULT_ROOT;
  if (!configuredRoot) throw new Error("--root or EMSENN_REPOSITORY_ROOT is required; provider input must be explicitly provisioned");
  return { search: positional[0], question: positional[1], root: resolve(configuredRoot), limit, session: argument("--session", argv) ?? null };
}
function select({ search, root, limit }) {
  if (!existsSync(root)) fail(`search root is absent: ${root}`);
  const result = spawnSync("rg", ["--files-with-matches", "--ignore-case", "--fixed-strings", ...EXCLUDED.flatMap((glob) => ["--glob", glob]), search, root], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (![0, 1].includes(result.status)) fail((result.stderr || "repository search failed").trim());
  const paths = result.stdout.split(/\r?\n/u).filter(Boolean).filter((path) => {
    try { return statSync(path).isFile() && statSync(path).size <= 900 * 1024 && [".md", ".txt", ".rml"].some((extension) => path.endsWith(extension)); } catch { return false; }
  }).sort().slice(0, limit);
  if (!paths.length) fail(`no eligible repository files matched ${JSON.stringify(search)}`);
  return paths;
}
function save(record) {
  const root = resolve(SERVICE_ROOT, "data/network-consultations"); mkdirSync(root, { recursive: true });
  const recordId = semanticId(record); const filename = recordId.slice(recordId.lastIndexOf(";") + 1);
  const path = resolve(root, `${filename}.json`);
  writeFileTextSync(path, `${JSON.stringify({ id: recordId, ...record }, null, 2)}\n`, { mode: 0o600 }); return path;
}

const input = parse(process.argv.slice(2));
const paths = select(input); if (input.session) paths.push(resolve(input.session));
const title = `Ephemeral network consultation ${new Date().toISOString()}`;
let notebookId = null, answer = null, failure = null, cleanup = null, sources = [];
const stagedUploads = [];
function providerUploadPath(path) {
  if (path.endsWith(".md") || path.endsWith(".txt")) return path;
  const staged = resolve("/tmp", `gemini-notebook-network-consultation-${randomUUID()}.txt`);
  writeFileSync(staged, readFileSync(path), { mode: 0o600 });
  stagedUploads.push(staged);
  return staged;
}
try {
  const created = run(["create", title]); notebookId = created.notebook?.id ?? created.id;
  if (typeof notebookId !== "string") fail("Gemini Notebook create returned no notebook id");
  for (const path of paths) {
    const uploadPath = providerUploadPath(path);
    const added = await retry(`source admission for ${path}`, () => run(["source", "add", uploadPath, "--type", "file", "--title", relative(input.root, path), "--notebook", notebookId]));
    const sourceId = added.source?.id ?? added.id; if (typeof sourceId !== "string") fail(`Gemini Notebook returned no source id for ${path}`);
    await retry(`source readiness for ${path}`, () => run(["source", "wait", sourceId, "--notebook", notebookId]));
    sources.push({ path, sourceId, digest: sha256Digest(readFileSync(path)) });
  }
  answer = run(["ask", "--new", "--yes", "--notebook", notebookId, input.question]);
} catch (error) { failure = error.message; }
finally {
  if (notebookId) {
    try { cleanup = run(["delete", "--notebook", notebookId, "--yes"]); }
    catch (error) { cleanup = { disposition: "not-confirmed-deleted", reason: error.message }; }
  }
  for (const staged of stagedUploads) rmSync(staged, { force: true });
}
const record = { type: "EphemeralNetworkGeminiNotebookConsultation", disposition: answer ? "answered" : "refused", search: input.search, question: input.question, root: input.root, selectedSourceCount: paths.length, selectedPaths: paths, selectedSources: sources, notebookId, answer, failure, cleanup, completedAt: new Date().toISOString() };
const receiptPath = save(record); process.stdout.write(`${JSON.stringify({ ...record, receiptPath }, null, 2)}\n`);
if (!answer || cleanup?.success === false || cleanup?.disposition === "not-confirmed-deleted") process.exitCode = 1;
