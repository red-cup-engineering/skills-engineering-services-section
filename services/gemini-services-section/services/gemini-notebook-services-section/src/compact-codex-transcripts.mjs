import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

function files(root) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...files(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl.gz")) output.push(path);
  }
  return output.sort();
}
export function projectSession(path) {
  const rows = gunzipSync(readFileSync(path)).toString("utf8").split(/\r?\n/u);
  const messages = [];
  for (const line of rows) {
    if (!line) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const message = row?.type === "response_item" ? row.payload : null;
    if (message?.type !== "message" || !["user", "assistant"].includes(message.role)) continue;
    const text = (message.content ?? []).map((item) => item.text ?? item.input_text ?? item.output_text ?? "").join("\n").trim();
    if (text) messages.push(`## ${message.role}\n\n${text}`);
  }
  return messages.join("\n\n");
}
// Gemini Notebook accepts 10 MiB files, but the live ingestion assay rejects dense
// multi-session projections near that ceiling. Keep packets below 900 KiB so
// source readiness is a usable network boundary rather than a nominal upload.
export function compactCodexTranscripts({ sourceRoot, outputRoot, maximumBytes = 900 * 1024 }) {
  const chunks = []; let body = ""; let members = [];
  const flush = () => { if (!body) return; chunks.push({ body, members }); body = ""; members = []; };
  for (const path of files(resolve(sourceRoot))) {
    const projection = projectSession(path); if (!projection) continue;
    const section = `# Session ${basename(path)}\n\n${projection}\n\n`;
    if (Buffer.byteLength(body + section) > maximumBytes) flush();
    body += section; members.push(path);
  }
  flush(); mkdirSync(outputRoot, { recursive: true });
  const receipt = { type: "CodexTranscriptCompactionReceipt", sourceRoot: resolve(sourceRoot), chunks: [] };
  for (const [index, chunk] of chunks.entries()) {
    const path = join(outputRoot, `codex-transcripts-${String(index + 1).padStart(3, "0")}.md`);
    writeFileSync(path, chunk.body, { mode: 0o600 }); receipt.chunks.push({ path, digest: sha256Digest(chunk.body), sessions: chunk.members.length, byteLength: Buffer.byteLength(chunk.body) });
  }
  return Object.freeze({ ...receipt, sourceCount: receipt.chunks.reduce((n, chunk) => n + chunk.sessions, 0), chunkCount: receipt.chunks.length });
}
