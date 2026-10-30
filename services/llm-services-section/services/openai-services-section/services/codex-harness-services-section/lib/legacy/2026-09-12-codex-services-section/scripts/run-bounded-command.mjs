#!/usr/bin/env node
// Runs one shell command, caches its full stdout/stderr to disk, and prints
// the captured output followed by a receipt line. Use this in place of a
// plain `bash -c` invocation for commands that might produce a very large
// amount of output (recursive search, full test runs, directory dumps),
// so a caller reading stdout back into a model's context can be capped
// without losing the underlying data.
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { isStrictMain, runMain } from "@red-cup-engineering/javascript-file-main-guard-service";
import { compileEvidence } from "../src/tool-evidence.mjs";
import {
  EMPTY_WITNESS_ROOT,
  identifyBytesSemanticContent,
  sha256DigestBytesFromNiUri,
} from "@red-cup-engineering/semantic-content-identify-service";
import { stateRoot } from "../src/state-root.mjs";

const DEFAULT_MAXIMUM_BYTES = 16_777_216;

function fail(message) { throw new Error(message); }

function parse(argv) {
  const at = argv.indexOf("--command");
  if (at < 0 || !argv[at + 1]) fail("--command is required");
  const cwdAt = argv.indexOf("--cwd");
  const maxAt = argv.indexOf("--max-bytes");
  return {
    command: argv[at + 1],
    cwd: cwdAt >= 0 && argv[cwdAt + 1] ? resolve(argv[cwdAt + 1]) : process.cwd(),
    maximumBytes: maxAt >= 0 && argv[maxAt + 1] ? Number(argv[maxAt + 1]) : DEFAULT_MAXIMUM_BYTES,
  };
}

function identifyCarrier(path) {
  return identifyBytesSemanticContent({
    objectKind: "bare-cedar-fog-codex.command-output",
    bytes: readFileSync(path),
    witnessRoot: EMPTY_WITNESS_ROOT,
  }).id;
}

function pump(source, destination, maximum) {
  let bytes = 0, complete = true;
  return new Promise((resolvePump, reject) => {
    source.on("data", (chunk) => {
      const retained = Math.max(0, Math.min(chunk.length, maximum - bytes));
      if (retained !== chunk.length) complete = false;
      bytes += retained;
      if (retained && !destination.write(retained === chunk.length ? chunk : chunk.subarray(0, retained))) {
        source.pause();
        destination.once("drain", () => source.resume());
      }
    });
    source.on("error", (error) => (error?.code === "ERR_STREAM_PREMATURE_CLOSE" ? destination.end() : reject(error)));
    source.on("end", () => destination.end());
    destination.on("error", reject);
    destination.on("finish", () => resolvePump({ bytes: Math.min(bytes, maximum), complete }));
  });
}

export async function runBoundedCommand({ command, cwd, maximumBytes = DEFAULT_MAXIMUM_BYTES } = {}) {
  const runRoot = join(stateRoot(), "command-output", "runs");
  mkdirSync(runRoot, { recursive: true });
  const stem = `${process.pid}-${randomUUID()}`;
  const stdoutTemporary = join(runRoot, `${stem}.stdout.tmp`);
  const stderrTemporary = join(runRoot, `${stem}.stderr.tmp`);
  const stdoutWriter = createWriteStream(stdoutTemporary, { mode: 0o600, flags: "wx" });
  const stderrWriter = createWriteStream(stderrTemporary, { mode: 0o600, flags: "wx" });
  const stderrBudget = Math.min(Math.floor(maximumBytes / 4), 4096);
  const stdoutBudget = maximumBytes - stderrBudget;

  const child = spawn("/bin/bash", ["-c", command], { cwd: resolve(cwd), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const [stdoutCapture, stderrCapture, completion] = await Promise.all([
    pump(child.stdout, stdoutWriter, stdoutBudget),
    pump(child.stderr, stderrWriter, stderrBudget),
    new Promise((resolveChild, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolveChild({ code, signal }));
    }),
  ]);

  const stdoutDigest = identifyCarrier(stdoutTemporary);
  const stderrDigest = identifyCarrier(stderrTemporary);
  const rawRoot = join(stateRoot(), "command-output", "raw");
  mkdirSync(rawRoot, { recursive: true });
  const stdoutPath = join(rawRoot, `${Buffer.from(sha256DigestBytesFromNiUri(stdoutDigest)).toString("hex")}.stdout`);
  const stderrPath = join(rawRoot, `${Buffer.from(sha256DigestBytesFromNiUri(stderrDigest)).toString("hex")}.stderr`);
  const reusedStdout = existsSync(stdoutPath), reusedStderr = existsSync(stderrPath);
  if (reusedStdout) rmSync(stdoutTemporary); else renameSync(stdoutTemporary, stdoutPath);
  if (reusedStderr) rmSync(stderrTemporary); else renameSync(stderrTemporary, stderrPath);

  const stdoutBytes = statSync(stdoutPath).size, stderrBytes = statSync(stderrPath).size;
  const captureComplete = stdoutCapture.complete && stderrCapture.complete;
  const compiled = compileEvidence(readFileSync(stdoutPath), { tool: "run-bounded-command" });

  return Object.freeze({
    command, cwd, exitCode: completion.code, signal: completion.signal, captureComplete,
    stdout: { path: stdoutPath, bytes: stdoutBytes, digest: stdoutDigest },
    stderr: { path: stderrPath, bytes: stderrBytes, digest: stderrDigest },
    receipt: compiled.receipt.id,
  });
}

async function main({ argv }) {
  const request = parse(argv);
  const result = await runBoundedCommand(request);
  if (result.stdout.bytes) process.stdout.write(readFileSync(result.stdout.path));
  if (result.stderr.bytes) process.stderr.write(readFileSync(result.stderr.path));
  process.stdout.write(`\n[bounded command receipt ${result.receipt}; complete=${result.captureComplete}]\n`);
  process.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : 1;
}

runMain(main, {
  moduleUrl: import.meta.url,
  isEntry: isStrictMain,
  formatError: (error) => `run-bounded-command: ${error.message}\n`,
  exitCode: 2,
});
