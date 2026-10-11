import { createHash, randomUUID } from "node:crypto";
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { applyCompaction, planCompaction } from "@red-cup-engineering/computer-inference-engine/tokens/token-compactification";
import { sha256Digest, sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";

export const DEFAULT_CAPTURE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_RENDER_BYTES = 12 * 1024;

function captureRoot(options = {}) {
  return resolve(options.root ?? process.env.AGENT_TOOL_OUTPUT_STATE_ROOT ?? join(homedir(), ".local", "state", "561-group", "tool-output-capture"));
}
function safeLimit(value, fallback) { return Number.isSafeInteger(value) && value > 0 ? value : fallback; }

function pump(source, temporary, maximumBytes) {
  const hash = createHash("sha256"); let observedBytes = 0, retainedBytes = 0;
  const destination = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
  return new Promise((resolvePump, reject) => {
    source.on("data", (chunk) => {
      observedBytes += chunk.length; hash.update(chunk);
      const retained = chunk.subarray(0, Math.max(0, Math.min(chunk.length, maximumBytes - retainedBytes)));
      retainedBytes += retained.length;
      if (retained.length && !destination.write(retained)) { source.pause(); destination.once("drain", () => source.resume()); }
    });
    source.on("error", reject); source.on("end", () => destination.end()); destination.on("error", reject);
    destination.on("finish", () => resolvePump({ observedBytes, retainedBytes, complete: observedBytes === retainedBytes, fullDigest: `sha256:${hash.digest("hex")}` }));
  });
}

export async function captureCommand({ command, cwd, maximumCaptureBytes, maximumStdoutCaptureBytes, maximumStderrCaptureBytes, root, measureResources = false } = {}) {
  if (typeof command !== "string" || !command.trim()) throw new TypeError("command is required");
  if (typeof cwd !== "string" || !cwd.trim()) throw new TypeError("cwd is required");
  const limit = safeLimit(maximumCaptureBytes, DEFAULT_CAPTURE_BYTES), runRoot = join(captureRoot({ root }), "runs");
  mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  const stem = `${process.pid}-${randomUUID()}`, stdoutTemporary = join(runRoot, `${stem}.stdout.tmp`), stderrTemporary = join(runRoot, `${stem}.stderr.tmp`), timeTemporary = join(runRoot, `${stem}.time`);
  const child = measureResources
    ? spawn("/usr/bin/time", ["-f", "%e\t%U\t%S\t%M\t%x", "-o", timeTemporary, "/bin/bash", "-c", command], { cwd: resolve(cwd), env: process.env, stdio: ["ignore", "pipe", "pipe"] })
    : spawn("/bin/bash", ["-c", command], { cwd: resolve(cwd), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const stdoutLimit = safeLimit(maximumStdoutCaptureBytes, limit), stderrLimit = safeLimit(maximumStderrCaptureBytes, limit);
  const [stdout, stderr, completion] = await Promise.all([
    pump(child.stdout, stdoutTemporary, stdoutLimit), pump(child.stderr, stderrTemporary, stderrLimit),
    new Promise((resolveChild, reject) => { child.on("error", reject); child.on("close", (exitCode, signal) => resolveChild({ exitCode, signal })); }),
  ]);
  const rawRoot = join(captureRoot({ root }), "raw"); mkdirSync(rawRoot, { recursive: true, mode: 0o700 });
  const settle = (temporary, stream) => {
    const retained = readFileSync(temporary), retainedDigest = sha256Digest(retained), target = join(rawRoot, `${retainedDigest.slice(7)}.${stream}`);
    const reused = existsSync(target);
    if (reused) { if (!readFileSync(target).equals(retained)) throw new Error(`content-address conflict at ${target}`); unlinkSync(temporary); }
    else renameSync(temporary, target);
    return { carrier: target, retainedDigest, retainedBytes: retained.length, reused };
  };
  const settledStdout = settle(stdoutTemporary, "stdout"), settledStderr = settle(stderrTemporary, "stderr");
  const timing = measureResources && existsSync(timeTemporary) ? readFileSync(timeTemporary, "utf8").trim().split("\t") : null;
  if (measureResources) unlinkSync(timeTemporary, { force: true });
  const metric = (value, unit, multiplier = 1) => { const amount = Number(value) * multiplier; return Number.isFinite(amount) && amount >= 0 ? { amount, unit } : null; };
  const resources = timing ? Object.freeze({ wallTime: metric(timing[0], "seconds"), cpuUser: metric(timing[1], "seconds"), cpuSystem: metric(timing[2], "seconds"), peakRss: metric(timing[3], "bytes", 1024) }) : null;
  return Object.freeze({ type: "ToolOutputCapture", version: 1, command, cwd: resolve(cwd), exitCode: completion.exitCode, signal: completion.signal, resources,
    stdout: { ...stdout, ...settledStdout }, stderr: { ...stderr, ...settledStderr } });
}

function compact(text, exitCode, budget) {
  if (Buffer.byteLength(text) <= budget) return text;
  if (budget < 8) return "";
  const lines = text.split(/(?<=\n)/u).filter(Boolean);
  const spans = lines.map((line, index) => ({ id: `line-${index}`, kind: "tool_output", text: line, meta: { exitCode } }));
  // The pinned sentinel reserves the recency tail, leaving output lines eligible
  // for the house compactor's mask/evict protocol without inventing a second
  // head-tail compressor here.
  spans.push({ id: "sentinel", kind: "harness", text: "sentinel", meta: { pinned: true } });
  // Keep exact first and recent result lines. The shared compactor then evicts
  // middle lines into its archive/ledger; masking individual small matches
  // would expand a compact search result and hide the useful evidence.
  const characterBudget = Math.floor(budget / 4);
  let headCharacters = 0;
  for (const span of spans.slice(0, 8)) {
    if (headCharacters + span.text.length > characterBudget / 4) break;
    span.meta.pinned = true;
    headCharacters += span.text.length;
  }
  const plan = planCompaction(spans, { budget: characterBudget, keptHeadCount: 0, keptTailRatio: 0.2, toolOutputTailGuardChars: 0, oversizeToolOutputChars: 80_000 });
  // Raw sidecars already provide the compactor archive. Render only retained
  // original evidence, not the per-eviction ledger (which can itself exceed
  // the context budget for thousands of spans).
  return applyCompaction(spans, plan).spans.filter((span) => span.kind === "tool_output").map((span) => span.text).join("");
}

export function renderCapturedOutput(capture, { maximumRenderBytes } = {}) {
  const budget = safeLimit(maximumRenderBytes, DEFAULT_RENDER_BYTES);
  if (budget < 256) throw new RangeError("maximumRenderBytes must be at least 256 for evidence and readback");
  const stdout = readFileSync(capture.stdout.carrier, "utf8"), stderr = readFileSync(capture.stderr.carrier, "utf8");
  const failed = capture.exitCode !== 0 || capture.signal !== null;
  const recallPaths = `readback files: stdout=${JSON.stringify(capture.stdout.carrier)} stderr=${JSON.stringify(capture.stderr.carrier)}`;
  const recall = Buffer.byteLength(recallPaths) < budget / 2 ? recallPaths : `readback=${capture.stdout.retainedDigest},${capture.stderr.retainedDigest}`;
  const marker = `[tool output capture ${capture.stdout.observedBytes}B/${capture.stderr.observedBytes}B; complete=${capture.stdout.complete && capture.stderr.complete}; partial; ${recall}]\n`;
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) <= budget && capture.stdout.complete && capture.stderr.complete) return Object.freeze({ stdout, stderr, complete: true });
  const contentBudget = Math.max(0, budget - Buffer.byteLength(marker) - 1);
  const stderrBudget = Buffer.byteLength(stderr) <= contentBudget ? Buffer.byteLength(stderr) : failed ? Math.floor(contentBudget / 2) : Math.floor(contentBudget / 4);
  const stderrRender = compact(stderr, capture.exitCode, stderrBudget);
  const stdoutBudget = Math.max(0, contentBudget - Buffer.byteLength(stderrRender));
  const stdoutRender = compact(stdout, capture.exitCode, stdoutBudget);
  const rendered = { stdout: `${stdoutRender}${stdoutRender.endsWith("\n") ? "" : "\n"}${marker}`, stderr: stderrRender, complete: capture.stdout.complete && capture.stderr.complete };
  if (Buffer.byteLength(rendered.stdout) + Buffer.byteLength(rendered.stderr) > budget) throw new RangeError("protected evidence exceeds render budget");
  return Object.freeze(rendered);
}

export function readCapturedOutput({ digest: retainedDigest, stream, offset = 0, maximumBytes = 8192, root } = {}) {
  if (typeof retainedDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(retainedDigest)) throw new TypeError("a retained sha256 digest is required");
  const rawRoot = join(captureRoot({ root }), "raw"), prefix = retainedDigest.slice(7);
  const streams = stream === undefined ? ["stdout", "stderr"] : [stream];
  if (streams.some((name) => name !== "stdout" && name !== "stderr")) throw new TypeError("stream must be stdout or stderr");
  const candidates = streams.map((name) => ({ stream: name, carrier: join(rawRoot, `${prefix}.${name}`) })).filter(({ carrier }) => existsSync(carrier));
  if (candidates.length !== 1) throw new TypeError("captured output is unavailable or ambiguous; specify stream when needed");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a nonnegative integer");
  const selected = candidates[0], size = statSync(selected.carrier).size, start = Math.min(offset, size), length = Math.min(safeLimit(maximumBytes, 8192), 1024 * 1024, size - start);
  const bytes = Buffer.alloc(length), descriptor = openSync(selected.carrier, "r");
  let count;
  try { count = readSync(descriptor, bytes, 0, length, start); } finally { closeSync(descriptor); }
  return Object.freeze({ stream: selected.stream, digest: retainedDigest, offset: start, totalBytes: size, nextOffset: start + count < size ? start + count : null, content: bytes.subarray(0, count).toString("base64"), encoding: "base64" });
}
