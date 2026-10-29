#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";

const valued = new Set(["socket", "input", "query", "timeout-ms", "max-input-bytes"]), booleans = new Set(["help"]);
function parse(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { const raw = argv[index]; if (!raw.startsWith("--")) throw new Error(`unexpected argument ${raw}`); const key = raw.slice(2); if (booleans.has(key)) out[key] = true; else if (valued.has(key)) { const value = argv[++index]; if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`); out[key] = value; } else throw new Error(`unknown flag --${key}`); } return out; }
const integer = (value, fallback, low, high, name) => { const number = value === undefined ? fallback : Number(value); if (!Number.isInteger(number) || number < low || number > high) throw new Error(`${name} must be an integer from ${low} to ${high}`); return number; };

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) { process.stderr.write("usage: request-inference-socket [--socket path] [--input jobs.jsonl|--query id] [--timeout-ms N] [--max-input-bytes N]\n"); return; }
  if (args.input && args.query) throw new Error("use only one of --input or --query");
  const runtime = process.env.XDG_RUNTIME_DIR ?? join(process.env.HOME ?? "/tmp", ".local", "run"), socketPath = resolve(args.socket ?? process.env.LISS_INFERENCE_SOCKET ?? join(runtime, "liss-inference", "inference.sock")), timeoutMs = integer(args["timeout-ms"], 600000, 1000, 3600000, "timeout-ms"), maxInputBytes = integer(args["max-input-bytes"], 64 * 1024 * 1024, 1024, 1024 * 1024 * 1024, "max-input-bytes");
  const socket = connect({ path: socketPath, allowHalfOpen: true }); let timer, inputBytes = 0;
  const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => socket.destroy(new Error("socket request timed out")), timeoutMs); };
  await new Promise((resolveConnect, rejectConnect) => { socket.once("connect", resolveConnect); socket.once("error", rejectConnect); }); resetTimer();
  socket.on("data", (chunk) => { resetTimer(); if (!process.stdout.write(chunk)) { socket.pause(); process.stdout.once("drain", () => socket.resume()); } });
  const source = args.query ? null : args.input ? createReadStream(resolve(args.input)) : process.stdin;
  if (args.query) socket.end(`${JSON.stringify({ type: "InferenceResultQuery", id: args.query })}\n`);
  else {
    const limiter = new Transform({ transform(chunk, _encoding, callback) { inputBytes += chunk.length; if (inputBytes > maxInputBytes) callback(new Error("input exceeds max-input-bytes")); else callback(null, chunk); } });
    source.on("error", (error) => socket.destroy(error)); limiter.on("error", (error) => socket.destroy(error)); source.pipe(limiter).pipe(socket);
  }
  await new Promise((resolveClose, rejectClose) => { socket.once("end", resolveClose); socket.once("error", rejectClose); }); clearTimeout(timer);
}

try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
