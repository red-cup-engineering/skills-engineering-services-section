#!/usr/bin/env node
import { createReadStream, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { captureCommand } from "@red-cup-engineering/llm-cost-optimization-services-section/tool-output-capture";

import { isStrictMain, runMain } from "@red-cup-engineering/javascript-file-main-guard-service";
import { DEFAULT_TOOL_BOUNDARY_BUDGET, classifyEvidenceLine, compileToolEvidence } from "../src/tool-evidence.mjs";
import { DEFAULT_STATE_ROOT } from "../src/enterprise.mjs";
import { semanticIdentity } from "../src/semiotic-circuit.mjs";

function fail(message) { throw new Error(message); }
function parse(argv) {
  const at = argv.indexOf("--request"); if (at < 0 || !argv[at + 1]) fail("--request is required");
  let value; try { value = JSON.parse(Buffer.from(argv[at + 1], "base64url")); } catch { fail("--request is not valid base64url JSON"); }
  if (typeof value.command !== "string" || !value.command.trim()) fail("request.command is required");
  if (typeof value.cwd !== "string") fail("request.cwd is required");
  return value;
}
function stateRoot() { return resolve(process.env.CODEX_ENTERPRISE_STATE_ROOT ?? DEFAULT_STATE_ROOT); }
function identifyCarrier(path, objectKind) {
  return semanticIdentity({ encoding: "base64", bytes: readFileSync(path).toString("base64") }, objectKind).id;
}
const PRIORITY = { fatal: 0, failure: 1, warning: 2, change: 3, address: 4, success: 5, other: 6 };
async function summarizeCarrier(path, label, budget) {
  const counts = { fatal: 0, failure: 0, warning: 0, change: 0, success: 0, address: 0, other: 0 };
  const findings = [], seen = new Set(); let line = 0, carry = "", discarding = false;
  const acceptLine = (text) => {
    line += 1; if (!text.trim()) return;
    const kind = classifyEvidenceLine(text); counts[kind] += 1;
    const excerpt = Buffer.from(text).subarray(0, budget.maximumFindingBytes).toString("utf8");
    const key = excerpt.replace(/\b[0-9]+\b/gu, "#").replace(/\s+/gu, " ").trim();
    if (!seen.has(key)) { seen.add(key); findings.push({ line, stream: label, category: kind, excerpt, address: `${path}#L${line}` }); }
  };
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    for (const character of chunk) {
      if (character === "\n") { acceptLine(carry); carry = ""; discarding = false; }
      else if (!discarding) {
        carry += character;
        if (Buffer.byteLength(carry) >= budget.maximumFindingBytes) discarding = true;
      }
    }
  }
  if (carry || discarding) acceptLine(carry);
  findings.sort((left, right) => PRIORITY[left.category] - PRIORITY[right.category] || left.line - right.line);
  return { lineCount: line, classifications: counts, findings: findings.slice(0, budget.maximumFindingCount) };
}
function mergeSummaries(summaries, budget) {
  const classifications = { fatal: 0, failure: 0, warning: 0, change: 0, success: 0, address: 0, other: 0 };
  for (const summary of summaries) for (const [kind, count] of Object.entries(summary.classifications)) classifications[kind] += count;
  const findings = summaries.flatMap((summary) => summary.findings).sort((left, right) => PRIORITY[left.category] - PRIORITY[right.category] || left.stream.localeCompare(right.stream) || left.line - right.line).slice(0, budget.maximumFindingCount);
  return { lineCount: summaries.reduce((sum, item) => sum + item.lineCount, 0), classifications, findings };
}
async function run(request) {
  const budget = { ...DEFAULT_TOOL_BOUNDARY_BUDGET, ...(request.budget ?? {}), phase: request.budget?.phase ?? "context-discovery" };
  const stderrBudget = Math.min(Math.floor(budget.maximumRawCaptureBytes / 4), 4096);
  const capture = await captureCommand({ command: request.command, cwd: request.cwd, maximumCaptureBytes: budget.maximumRawCaptureBytes, maximumStdoutCaptureBytes: budget.maximumRawCaptureBytes - stderrBudget, maximumStderrCaptureBytes: stderrBudget, root: join(stateRoot(), "tool-evidence"), measureResources: true });
  const stdoutPath = capture.stdout.carrier, stderrPath = capture.stderr.carrier;
  const stdoutBytes = capture.stdout.retainedBytes, stderrBytes = capture.stderr.retainedBytes;
  const stdoutDigest = identifyCarrier(stdoutPath, "bare-cedar-fog-codex.tool-stdout-carrier");
  const stderrDigest = identifyCarrier(stderrPath, "bare-cedar-fog-codex.tool-stderr-carrier");
  const carrier = {
    type: "BoundedDiscoveryCommandResult", command: request.command, cwd: request.cwd,
    exitCode: capture.exitCode, signal: capture.signal, captureComplete: capture.stdout.complete && capture.stderr.complete,
    stdout: { digest: stdoutDigest, carrier: stdoutPath, bytes: stdoutBytes, reused: capture.stdout.reused },
    stderr: { digest: stderrDigest, carrier: stderrPath, bytes: stderrBytes, reused: capture.stderr.reused },
    resources: capture.resources,
  };
  const summary = mergeSummaries(await Promise.all([summarizeCarrier(stdoutPath, "stdout", budget), summarizeCarrier(stderrPath, "stderr", budget)]), budget);
  const aggregateDigest = semanticIdentity({ stdout: stdoutDigest, stderr: stderrDigest, exitCode: capture.exitCode, signal: capture.signal }, "bare-cedar-fog-codex.tool-output-descriptor").id;
  const outputDescriptor = { digest: aggregateDigest, complete: carrier.captureComplete, carriers: [{ stream: "stdout", ...carrier.stdout }, { stream: "stderr", ...carrier.stderr }] };
  const compiled = compileToolEvidence({ tool_name: "bounded-discovery", tool_input: { command: request.command, cwd: request.cwd }, tool_response: carrier, model: request.model, tool_use_id: request.toolUseId }, { provider: request.provider, budget, observedAt: new Date().toISOString(), summary, outputBytes: stdoutBytes + stderrBytes, outputDescriptor, resources: carrier.resources });
  // The caller asked for command output, not a receipt in place of it.  Replay
  // the bounded carriers even after truncation; the receipt remains a
  // secondary, addressable record rather than consuming the useful result.
  if (stdoutBytes) process.stdout.write(readFileSync(stdoutPath));
  if (stderrBytes) process.stderr.write(readFileSync(stderrPath));
  process.stdout.write(`\n[bounded discovery receipt ${compiled.receipt.id}; raw carriers retained; complete=${carrier.captureComplete}; cache reused=${compiled.reused}]\n`);
  process.exitCode = Number.isInteger(capture.exitCode) ? capture.exitCode : 1;
}

runMain((options) => run(parse(options.argv)), {
  moduleUrl: import.meta.url,
  isEntry: isStrictMain,
  formatError: (error) => `bounded-discovery: ${error.message}\n`,
  exitCode: 2,
});
