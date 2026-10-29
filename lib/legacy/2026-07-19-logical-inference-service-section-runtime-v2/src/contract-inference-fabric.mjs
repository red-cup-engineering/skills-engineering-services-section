#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { ACTIVITYSTREAMS_CONTEXT } from "./inference-activitystreams.mjs";

const valued = new Set(["operation", "input-file", "output-file", "socket", "timeout-ms", "max-bytes", "now"]);
const booleans = new Set(["help"]);
function parse(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) throw new Error(`unexpected argument ${raw}`);
    const key = raw.slice(2);
    if (booleans.has(key)) out[key] = true;
    else if (valued.has(key)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
      out[key] = value;
    } else throw new Error(`unknown flag --${key}`);
  }
  return out;
}
const boundedInteger = (value, fallback, low, high, label) => {
  const selected = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(selected) || selected < low || selected > high) throw new Error(`${label} must be an integer from ${low} to ${high}`);
  return selected;
};
const expectedType = (operation) => ({ "solicit-service": "Offer", "invoke-service": "Accept", "query-service": "Question" })[operation];

async function exchange(socketPath, activity, timeoutMs, maxBytes) {
  const socket = connect({ path: socketPath, allowHalfOpen: true });
  let timer, bytes = 0, output = "";
  const reset = () => { clearTimeout(timer); timer = setTimeout(() => socket.destroy(new Error("ActivityStreams contract request timed out")), timeoutMs); };
  await new Promise((resolveConnect, rejectConnect) => { socket.once("connect", resolveConnect); socket.once("error", rejectConnect); });
  reset(); socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    bytes += Buffer.byteLength(chunk); reset();
    if (bytes > maxBytes) socket.destroy(new Error("ActivityStreams contract response exceeds max-bytes"));
    else output += chunk;
  });
  socket.end(`${JSON.stringify(activity)}\n`);
  await new Promise((resolveEnd, rejectEnd) => { socket.once("end", resolveEnd); socket.once("error", rejectEnd); });
  clearTimeout(timer);
  const lines = output.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error(`LISS returned ${lines.length} records for one contract activity`);
  return JSON.parse(lines[0]);
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) {
    process.stderr.write("usage: contract-inference-fabric --operation solicit-service|invoke-service|query-service [--input-file activity.json] [--output-file response.json] [--socket path] [--timeout-ms N] [--max-bytes N]\n");
    return;
  }
  const operation = args.operation;
  if (!expectedType(operation)) throw new Error("--operation must be solicit-service, invoke-service, or query-service");
  const raw = readFileSync(args["input-file"] ? resolve(args["input-file"]) : 0, "utf8");
  const maxBytes = boundedInteger(args["max-bytes"], 4 * 1024 * 1024, 1024, 32 * 1024 * 1024, "max-bytes");
  if (Buffer.byteLength(raw) > maxBytes) throw new Error("ActivityStreams contract request exceeds max-bytes");
  const activity = JSON.parse(raw);
  if (activity?.["@context"] !== ACTIVITYSTREAMS_CONTEXT || activity.type !== expectedType(operation)) throw new Error(`${operation} requires an ActivityStreams ${expectedType(operation)} envelope`);
  const runtime = process.env.XDG_RUNTIME_DIR ?? join(process.env.HOME ?? "/tmp", ".local", "run");
  const socketPath = resolve(args.socket ?? process.env.LISS_INFERENCE_SOCKET ?? join(runtime, "liss-inference", "inference.sock"));
  const response = await exchange(socketPath, activity, boundedInteger(args["timeout-ms"], 60000, 1000, 3600000, "timeout-ms"), maxBytes);
  const encoded = `${JSON.stringify(response, null, 2)}\n`;
  if (args["output-file"]) writeFileSync(resolve(args["output-file"]), encoded, { encoding: "utf8", flag: "wx", mode: 0o600 });
  else process.stdout.write(encoded);
  if (response.type === "Reject") process.exitCode = 2;
}

try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
