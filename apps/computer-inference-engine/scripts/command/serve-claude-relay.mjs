#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";

const host = process.env.CLAUDE_RELAY_HOST ?? "127.0.0.1";
const port = Number(process.env.CLAUDE_RELAY_PORT ?? 19762);
const claude = process.env.CLAUDE_RELAY_CLAUDE_BIN ?? "/home/emsenn/.local/bin/claude";
if (!process.env.CLAUDE_RELAY_ALLOWED_MODELS) throw new Error("CLAUDE_RELAY_ALLOWED_MODELS must explicitly declare this runtime's admitted models");
const allowedModels = new Set(process.env.CLAUDE_RELAY_ALLOWED_MODELS.split(",").map((value) => value.trim()).filter(Boolean));
function optionalPositiveLimit(name) {
  if (process.env[name] === undefined) return null;
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer when supplied`);
  return value;
}
const inputLimit = optionalPositiveLimit("CLAUDE_RELAY_INPUT_LIMIT_BYTES");
const outputLimit = optionalPositiveLimit("CLAUDE_RELAY_OUTPUT_LIMIT_BYTES");
if (process.env.CLAUDE_RELAY_TIMEOUT_MS !== undefined) throw new Error("CLAUDE_RELAY_TIMEOUT_MS is retired; the customer owns cancellation");

function boundedArgs(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("args must be strings");
  const outputMode = value[4];
  if (!["text", "json"].includes(outputMode)) throw new Error("Claude output carrier must be text or explicitly structured JSON");
  const fixed = ["-p", "--model", value[2], "--output-format", outputMode, "--tools", "", "--strict-mcp-config", "--setting-sources", ""];
  if (!allowedModels.has(value[2]) || fixed.some((item, index) => value[index] !== item)) throw new Error("only a configured bounded print-mode invocation is admitted");
  let index = fixed.length;
  const seen = new Set();
  while (index < value.length) {
    const flag = value[index++];
    const argument = value[index++];
    if (argument === undefined || seen.has(flag) || !["--json-schema", "--append-system-prompt"].includes(flag)) throw new Error("unsupported or repeated Claude option");
    seen.add(flag);
    if (flag === "--json-schema") {
      if (outputMode !== "json") throw new Error("JSON schema requires the explicitly structured JSON carrier");
      const schema = JSON.parse(argument);
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("JSON schema must be an object");
    }
  }
  return Object.freeze([...value]);
}

function reply(response, status, value) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}

async function longReply(response, operation) {
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  response.flushHeaders();
  response.end(`${JSON.stringify(await operation())}\n`);
}

async function body(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (inputLimit !== null && bytes > inputLimit + 131072) throw new Error("request exceeds its explicit relay input grant");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function invoke(args, input, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ status: 75, signal: "SIGTERM", stdout: "", stderr: "relay request aborted before native Claude launch" });
    const child = spawn(claude, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let exceeded = false;
    let settled = false;
    const terminate = () => {
      if (settled || child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
    };
    const abortListener = () => terminate();
    signal?.addEventListener("abort", abortListener, { once: true });
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (outputLimit !== null && bytes > outputLimit) { exceeded = true; child.kill("SIGKILL"); return; }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    const finish = (value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abortListener);
      resolve(value);
    };
    child.on("error", (error) => finish({ status: 70, signal: null, stdout: "", stderr: error.message }));
    child.on("close", (status, signal) => {
      finish({ status: exceeded ? 74 : (status ?? 70), signal, stdout: Buffer.concat(stdout).toString(), stderr: exceeded ? "explicit relay output grant exhausted" : Buffer.concat(stderr).toString() });
    });
    child.stdin.end(input);
  });
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") return reply(response, 200, { ok: true, carrier: "bare-cedar-fog-claude-relay", models: [...allowedModels] });
  if (request.method !== "POST" || request.url !== "/invoke") return reply(response, 404, { error: "not-found" });
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  request.once("aborted", cancel);
  response.once("close", () => { if (!response.writableEnded) cancel(); });
  try {
    const value = await body(request);
    if (typeof value?.input !== "string" || !value.input || (inputLimit !== null && Buffer.byteLength(value.input) > inputLimit)) throw new Error("input must be a nonempty string within its explicit relay input grant");
    const args = boundedArgs(value.args);
    return longReply(response, () => invoke(args, value.input, cancellation.signal));
  } catch (error) {
    return reply(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => process.stdout.write(`${JSON.stringify({ ready: true, host, port, models: [...allowedModels] })}\n`));
