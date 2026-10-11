#!/usr/bin/env node
/**
 * Local, deterministic retrieval for a fresh Codex session.
 *
 * This deliberately spends CPU rather than model context: it extracts only
 * prior user corrections and their immediately following assistant outcome.
 * Gemini Notebook remains the synthesis layer for questions that cannot be settled
 * from these exact records.
 */
import { gunzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";

const DEFAULT_SESSIONS = process.env.CODEX_SESSIONS_ROOT ?? null;
const DEFAULT_MAX_BYTES = 18 * 1024;

function sessionFiles(root, maximumFiles = 64) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...sessionFiles(path));
    else if (entry.isFile() && (entry.name.endsWith(".jsonl") || entry.name.endsWith(".jsonl.gz"))) result.push(path);
  }
  return result.sort().reverse().slice(0, maximumFiles);
}

function textOf(message) {
  return (message.content ?? []).map((item) => item.text ?? item.input_text ?? item.output_text ?? "").join("\n").trim();
}

export function messagesFromSession(path) {
  const bytes = readFileSync(path);
  const source = path.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  const messages = [];
  for (const line of source.split(/\r?\n/u)) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      const payload = row?.type === "response_item" ? row.payload : row?.payload;
      if (payload?.type !== "message" || !["user", "assistant"].includes(payload.role)) continue;
      const text = textOf(payload);
      if (text) messages.push({ role: payload.role, text });
    } catch { /* A malformed rollout row is not session evidence. */ }
  }
  return messages;
}

function words(query) {
  return [...new Set(String(query).toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/gu) ?? [])];
}
function score(text, terms) {
  const lower = text.toLowerCase();
  return terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
}
function excerpt(text, maximum) {
  const compact = text.replace(/\s+/gu, " ").trim();
  return compact.length <= maximum ? compact : `${compact.slice(0, maximum - 1)}…`;
}

export function compileSessionContext({ query, sessionsRoot = DEFAULT_SESSIONS, maximumBytes = DEFAULT_MAX_BYTES, maximumFiles = 64 }) {
  if (typeof query !== "string" || query.trim().length < 3) throw new Error("query must contain at least three characters");
  if (typeof sessionsRoot !== "string" || sessionsRoot.trim() === "") throw new Error("CODEX_SESSIONS_ROOT is required; the provider must receive an authorized session projection, never inspect a developer laptop");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1024) throw new Error("maximumBytes must be an integer of at least 1024");
  if (!Number.isSafeInteger(maximumFiles) || maximumFiles < 1) throw new Error("maximumFiles must be a positive safe integer");
  const terms = words(query); if (!terms.length) throw new Error("query has no retrievable terms");
  const candidates = [];
  for (const path of sessionFiles(resolve(sessionsRoot), maximumFiles)) {
    const messages = messagesFromSession(path);
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role !== "user") continue;
      const relevance = score(message.text, terms);
      if (!relevance) continue;
      const outcome = messages.slice(index + 1).find((candidate) => candidate.role === "assistant");
      candidates.push({ path, relevance, correction: message.text, outcome: outcome?.text ?? null });
    }
  }
  candidates.sort((left, right) => right.relevance - left.relevance || right.path.localeCompare(left.path));
  const selected = []; let body = `# Retrieved prior session context\n\nQuery: ${query.trim()}\n\n`;
  for (const candidate of candidates) {
    const section = `## Prior correction\n\n${excerpt(candidate.correction, 1800)}\n\n${candidate.outcome ? `### Immediate prior response\n\n${excerpt(candidate.outcome, 1200)}\n\n` : ""}`;
    if (Buffer.byteLength(body + section) > maximumBytes) continue;
    body += section; selected.push(candidate.path);
  }
  return Object.freeze({ query: query.trim(), terms, sessionCount: new Set(selected).size, matchCount: selected.length, context: body, selected });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const query = argument("--query");
  const result = compileSessionContext({ query, sessionsRoot: argument("--sessions") ?? DEFAULT_SESSIONS, maximumBytes: Number(argument("--max-bytes") ?? String(DEFAULT_MAX_BYTES)), maximumFiles: Number(argument("--max-files") ?? "64") });
  process.stdout.write(result.context);
}
