#!/usr/bin/env node
import { createReadStream, createWriteStream } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";
import { TextDecoder } from "node:util";
import { validateJobs } from "../../src/fabric/inference-fabric.mjs";

const valued = new Set(["socket", "input", "output", "query", "timeout-ms", "max-input-bytes", "max-line-bytes"]), booleans = new Set(["detach", "market-snapshot", "help"]);
function parse(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { const raw = argv[index]; if (!raw.startsWith("--")) throw new Error(`unexpected argument ${raw}`); const key = raw.slice(2); if (booleans.has(key)) out[key] = true; else if (valued.has(key)) { const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`); out[key] = value; } else throw new Error(`unknown flag --${key}`); } return out; }
const integer = (value, fallback, low, high, name) => { const number = value === undefined ? fallback : Number(value); if (!Number.isInteger(number) || number < low || number > high) throw new Error(`${name} must be an integer from ${low} to ${high}`); return number; };

function createSubmissionEnvelopeTransform(maxLineBytes) {
  const decoder = new TextDecoder("utf-8", { fatal: true }), seen = new Set(); let buffered = Buffer.alloc(0);
  const encode = (line) => {
    if (line.length && line.at(-1) === 13) line = line.subarray(0, -1);
    let job; try { job = JSON.parse(decoder.decode(line)); validateJobs([job]); } catch { throw new Error("detached input contains an invalid job line"); }
    if (seen.has(job.id)) throw new Error(`detached input contains duplicate id: ${job.id}`); seen.add(job.id);
    return Buffer.from(`${JSON.stringify({ type: "InferenceSubmission", delivery: "receipt-only", job })}\n`);
  };
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        buffered = buffered.length ? Buffer.concat([buffered, chunk]) : Buffer.from(chunk); let newline;
        while ((newline = buffered.indexOf(10)) !== -1) { const line = buffered.subarray(0, newline); buffered = buffered.subarray(newline + 1); if (line.length > maxLineBytes) throw new Error("detached input line exceeds max-line-bytes"); if (line.length) this.push(encode(line)); }
        if (buffered.length > maxLineBytes) throw new Error("detached input line exceeds max-line-bytes"); callback();
      } catch (error) { callback(error); }
    },
    flush(callback) { try { if (buffered.length) this.push(encode(buffered)); callback(); } catch (error) { callback(error); } }
  });
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) { process.stderr.write("usage: request-inference-socket [--socket path] [--input jobs.jsonl|--query id|--market-snapshot] [--output records.jsonl] [--detach] [--timeout-ms N] [--max-input-bytes N] [--max-line-bytes N]\n"); return; }
  if ([Boolean(args.input), Boolean(args.query), Boolean(args["market-snapshot"])].filter(Boolean).length > 1) throw new Error("use only one of --input, --query, or --market-snapshot");
  if (args.detach && (args.query || args["market-snapshot"] || (!args.input && process.stdin.isTTY))) throw new Error("--detach requires job input and cannot be combined with a query");
  const runtime = process.env.XDG_RUNTIME_DIR ?? join(process.env.HOME ?? "/tmp", ".local", "run"), socketPath = resolve(args.socket ?? process.env.LISS_INFERENCE_SOCKET ?? join(runtime, "liss-inference", "inference.sock")), timeoutMs = integer(args["timeout-ms"], args.detach ? 60000 : 600000, 1000, 3600000, "timeout-ms"), maxInputBytes = integer(args["max-input-bytes"], 64 * 1024 * 1024, 1024, 1024 * 1024 * 1024, "max-input-bytes"), maxLineBytes = integer(args["max-line-bytes"], 1024 * 1024, 1024, 16 * 1024 * 1024, "max-line-bytes");
  const socket = connect({ path: socketPath, allowHalfOpen: true }); let timer, inputBytes = 0;
  const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => socket.destroy(new Error("socket request timed out")), timeoutMs); };
  await new Promise((resolveConnect, rejectConnect) => { socket.once("connect", resolveConnect); socket.once("error", rejectConnect); }); resetTimer();
  const output = args.output ? createWriteStream(resolve(args.output), { flags: "wx", mode: 0o600 }) : process.stdout;
  if (args.output) await new Promise((resolveOpen, rejectOpen) => { output.once("open", resolveOpen); output.once("error", rejectOpen); });
  output.on("error", (error) => socket.destroy(error));
  socket.on("data", (chunk) => { resetTimer(); if (!output.write(chunk)) { socket.pause(); output.once("drain", () => socket.resume()); } });
  const source = args.query || args["market-snapshot"] ? null : args.input ? createReadStream(resolve(args.input)) : process.stdin;
  if (args.query) socket.end(`${JSON.stringify({ type: "InferenceResultQuery", id: args.query })}\n`);
  else if (args["market-snapshot"]) socket.end(`${JSON.stringify({ type: "InferenceMarketSnapshotQuery" })}\n`);
  else {
    const limiter = new Transform({ transform(chunk, _encoding, callback) { inputBytes += chunk.length; resetTimer(); if (inputBytes > maxInputBytes) callback(new Error("input exceeds max-input-bytes")); else callback(null, chunk); } }), envelope = args.detach ? createSubmissionEnvelopeTransform(maxLineBytes) : null;
    source.on("error", (error) => socket.destroy(error)); limiter.on("error", (error) => socket.destroy(error)); envelope?.on("error", (error) => socket.destroy(error)); if (envelope) source.pipe(limiter).pipe(envelope).pipe(socket); else source.pipe(limiter).pipe(socket);
  }
  await new Promise((resolveClose, rejectClose) => { socket.once("end", resolveClose); socket.once("error", rejectClose); }); clearTimeout(timer);
  if (args.output) await new Promise((resolveEnd, rejectEnd) => { output.end(resolveEnd); output.once("error", rejectEnd); });
}

try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
