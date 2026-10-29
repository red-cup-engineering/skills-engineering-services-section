#!/usr/bin/env node
import { resolve } from "node:path";
import { boundedInteger, createInferenceBroker } from "./inference-broker.mjs";
import { attachInferenceJsonlSession } from "./inference-jsonl-session.mjs";

const valued = new Set(["registry", "concurrency", "attempts", "max-queue-depth", "max-seen-ids", "history", "journal", "max-line-bytes", "max-write-buffer-bytes"]), booleans = new Set(["recover-stale-lock", "help"]);
function parse(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { const raw = argv[index]; if (!raw.startsWith("--")) throw new Error(`unexpected argument ${raw}`); const key = raw.slice(2); if (booleans.has(key)) out[key] = true; else if (valued.has(key)) { const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`); out[key] = value; } else throw new Error(`unknown flag --${key}`); } return out; }

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) { process.stderr.write("usage: serve-inference-jsonl --registry registry.json [--journal records.jsonl] [--history records.jsonl] [--concurrency N] [--attempts N] [--max-queue-depth N] [--max-seen-ids N] [--max-line-bytes N] [--max-write-buffer-bytes N] [--recover-stale-lock]\n"); return; }
  if (!args.registry) throw new Error("--registry is required");
  const maxLineBytes = boundedInteger(args["max-line-bytes"], 1024 * 1024, 1024, 16 * 1024 * 1024, "max-line-bytes"), maxWriteBufferBytes = boundedInteger(args["max-write-buffer-bytes"], 2 * 1024 * 1024, 1024, 32 * 1024 * 1024, "max-write-buffer-bytes");
  const broker = createInferenceBroker({ registryPath: resolve(args.registry), journalPath: args.journal, historyPath: args.history, concurrency: args.concurrency, attempts: args.attempts, maxQueueDepth: args["max-queue-depth"], maxSeenIds: args["max-seen-ids"], recoverStaleLock: args["recover-stale-lock"] });
  let session, stopping = false;
  const stop = () => { if (!stopping) { stopping = true; broker.stop(); session?.stopInput(); } };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try {
    session = attachInferenceJsonlSession({ readable: process.stdin, writable: process.stdout, broker, allowShutdown: true, onShutdown: stop, maxLineBytes, maxWriteBufferBytes });
    process.stderr.write(`${JSON.stringify({ type: "InferenceJsonlServiceReady", pid: process.pid, ...broker.ready, maxLineBytes, maxWriteBufferBytes })}\n`);
    await session.inputEnded; broker.stop(); await broker.drain(); await session.drain();
  } finally { await broker.close(); }
}

try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = error.exitCode ?? 2; }
