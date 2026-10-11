#!/usr/bin/env node
// Resumably add the vetted 269-source expansion to the owned Union
// Self-Conception Corpus. It never deletes or alters incumbent sources.
import { runGeminiNotebookSync } from "./gemini-notebook-cli.mjs";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileTextSync } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = "1a19fe72-e4d4-48ee-98f9-dad841ff272b";
const INITIAL_SOURCES = 31;
const CEILING = 300;
const COMPILATION = join(ROOT, "data/advisory-corpus/union-self-conception-corpus-compilation.json");
const STATE = join(ROOT, "data/advisory-corpus/union-self-conception-corpus-admission-state.json");

function fail(message) { throw new Error(message); }
function cli(args, timeout = 660_000) {
  const result = runGeminiNotebookSync(args, { root: ROOT, timeout });
  if (result.status !== 0 || !result.value) fail((result.stderr || result.stdout || `Gemini Notebook exited ${result.status}`).trim().slice(0, 2000));
  return result.value;
}
function write(value) { writeFileTextSync(STATE, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }
function sourceRows() { const rows = cli(["source", "list", "--notebook", TARGET]).sources; if (!Array.isArray(rows)) fail("Gemini Notebook source inventory was malformed"); return rows; }

if (!process.argv.includes("--execute")) fail("refusing live source admission; rerun with --execute");
const batchIndex = process.argv.indexOf("--batch");
const batch = batchIndex === -1 ? 3 : Number(process.argv[batchIndex + 1]);
if (!Number.isSafeInteger(batch) || batch < 1 || batch > 20) fail("--batch must be an integer from 1 through 20");
const compilation = JSON.parse(readFileSync(COMPILATION, "utf8"));
const desired = compilation.receipt?.projected;
if (!Array.isArray(desired) || desired.length !== CEILING - INITIAL_SOURCES) fail("compiled expansion is not exactly 269 sources");
if (new Set(desired.map((row) => row.title)).size !== desired.length) fail("compiled expansion has duplicate titles");
for (const row of desired) if (!row.path || !row.title || row.byteLength > 3 * 1024 * 1024) fail(`invalid compiled source: ${row.title ?? row.path}`);
const current = sourceRows();
if (current.length < INITIAL_SOURCES || current.length > CEILING) fail(`target has ${current.length} sources, outside safe range ${INITIAL_SOURCES}–${CEILING}`);
for (const row of current.filter((row) => row.status !== "ready")) cli(["source", "wait", row.id, "--notebook", TARGET, "--timeout", "600"]);
const existingTitles = new Set(current.map((row) => row.title));
if (current.length === INITIAL_SOURCES && desired.some((row) => existingTitles.has(row.title))) fail("incumbent source title collides with a planned expansion source");
const admitted = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { targetNotebookId: TARGET, compilation: compilation.receipt.sourceSetDigest, admitted: [] };
if (admitted.targetNotebookId !== TARGET || admitted.compilation !== compilation.receipt.sourceSetDigest) fail("existing admission state belongs to a different target or compilation");
let addedThisRun = 0;
for (const row of desired) {
  if (existingTitles.has(row.title)) continue;
  const added = cli(["source", "add", row.path, "--type", "file", "--mime-type", "text/plain", "--title", row.title.slice(0, 180), "--notebook", TARGET], 360_000);
  const sourceId = added.source?.id ?? added.id;
  if (typeof sourceId !== "string") fail(`source add returned no ID for ${row.title}`);
  cli(["source", "wait", sourceId, "--notebook", TARGET, "--timeout", "600"]);
  existingTitles.add(row.title);
  admitted.admitted = [...new Map([...admitted.admitted, { title: row.title, sourceId, digest: row.digest }].map((item) => [item.title, item])).values()];
  admitted.updatedAt = new Date().toISOString(); write(admitted);
  process.stdout.write(`${JSON.stringify({ admitted: admitted.admitted.length, total: desired.length, title: row.title })}\n`);
  addedThisRun += 1;
  if (addedThisRun >= batch) break;
}
const settled = sourceRows();
const remaining = desired.filter((row) => !settled.some((source) => source.title === row.title));
if (remaining.length) {
  process.stdout.write(`${JSON.stringify({ ok: true, partial: true, addedThisRun, remaining: remaining.length, currentSourceCount: settled.length })}\n`);
  process.exit(0);
}
if (settled.length !== CEILING) fail(`admission settled with ${settled.length}, expected ${CEILING}`);
const notReady = settled.filter((row) => row.status !== "ready");
if (notReady.length) fail(`admission settled with ${notReady.length} non-ready sources`);
write({ ...admitted, completedAt: new Date().toISOString(), finalSourceCount: settled.length, finalReadyCount: settled.length });
process.stdout.write(`${JSON.stringify({ ok: true, targetNotebookId: TARGET, sourceCount: settled.length, readyCount: settled.length })}\n`);
