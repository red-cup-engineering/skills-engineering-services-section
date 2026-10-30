import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  boundedDiscoveryRewrite,
  classifyLine,
  compileEvidence,
  compileToolEvidence,
  DEFAULT_TOOL_BOUNDARY_BUDGET,
  declaredBudget,
  declaredToolBudget,
  readEvidence,
  readToolEvidence,
} from "../src/tool-evidence.mjs";
import { semanticFileKey } from "../src/semiotic-circuit.mjs";

const state = () => ({ stateRoot: mkdtempSync(join(tmpdir(), "codex-tool-evidence-")) });

function failureFixture() {
  const lines = [];
  for (let index = 0; Buffer.byteLength(lines.join("\n")) < 176_000; index += 1) {
    lines.push(` M lib/submodule-${String(index).padStart(5, "0")}/src/file-${index}.mjs`);
  }
  return lines.join("\n");
}

test("a failure-sized result becomes a bounded premium receipt with exact paged evidence", () => {
  const options = state(), raw = failureFixture();
  const input = { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git status --short" }, tool_response: { output: raw }, model: "gpt-5.6-sol", tool_use_id: "tool-44k" };
  const compiled = compileToolEvidence(input, options);
  assert.equal(compiled.receipt.phase, "context-discovery");
  assert.equal(compiled.receipt.premiumContext.truncated, true);
  assert.ok(Buffer.byteLength(compiled.modelContext) <= 12_288);
  assert.match(compiled.modelContext, /"type":"ToolEvidenceReceipt"/u);
  assert.match(compiled.modelContext, /"summary"/u);
  assert.equal(compiled.receipt.output.quantity.amount, Buffer.byteLength(JSON.stringify(input.tool_response)));
  assert.ok(compiled.receipt.summary.classifications.change > 1000);
  assert.ok(compiled.receipt.summary.findings.every(({ address }) => /#L[0-9]+$/u.test(address)));
  const first = readToolEvidence({ receipt: compiled.receipt.id, maximumBytes: 4096 }, options);
  assert.equal(first.returnedBytes, 4096);
  assert.equal(first.nextOffset, 4096);
  assert.equal(Buffer.from(first.content, "base64").toString("utf8"), readFileSync(compiled.receipt.output.carrier).subarray(0, 4096).toString("utf8"));
  const repeated = compileToolEvidence(input, options);
  assert.equal(repeated.receipt.id, compiled.receipt.id);
  assert.equal(repeated.reused, true);
});

test("the default raw capture cap is sixteen MiB", () => {
  assert.equal(DEFAULT_TOOL_BOUNDARY_BUDGET.maximumRawCaptureBytes, 16 * 1024 * 1024);
  assert.equal(declaredToolBudget({ tool_name: "Bash", tool_input: { command: "git status" } }).maximumRawCaptureBytes, 16 * 1024 * 1024);
});

test("ordinary small output remains direct and useful", () => {
  const compiled = compileToolEvidence({ tool_name: "Bash", tool_input: { command: "printf ok" }, tool_response: { output: "ok\n", exit_code: 0 }, model: "gpt-5.6-sol" }, state());
  assert.equal(compiled.receipt.premiumContext.truncated, false);
  assert.equal(compiled.receipt.routing.next, "direct-tool-result");
  assert.equal(compiled.receipt.summary.lineCount, 1);
  assert.match(compiled.modelContext, /"type":"ToolEvidenceReceipt"/u);
});

test("the moved toolkit API retains exact UTF-8 paging through the enterprise receipt", () => {
  const options = state(), raw = "warning: first\nsecond line\n";
  const compiled = compileEvidence(raw, { ...options, tool: "run-bounded-command", maximumSummaryBytes: 1024 });
  assert.equal(compiled.receipt.outputBytes, Buffer.byteLength(raw));
  assert.equal(compiled.receipt.carrier, compiled.receipt.output.carrier);
  assert.equal(classifyLine("warning: first"), "warning");
  assert.equal(declaredBudget({ maximumSummaryBytes: 2048 }).maximumSummaryBytes, 2048);
  const page = readEvidence({ receipt: compiled.receipt.id, maximumBytes: 9 }, options);
  assert.equal(page.encoding, "utf8");
  assert.equal(page.content, raw.slice(0, 9));
  assert.equal(page.nextOffset, 9);
});

test("pre-tool routing wraps risky discovery but respects an explicit aggregation", () => {
  const risky = { tool_name: "Bash", tool_input: { command: "find . -type f", workdir: "/home/emsenn/info", max_output_tokens: 100 }, cwd: "/home/emsenn/info", model: "gpt-5.6-sol" };
  const rewrite = boundedDiscoveryRewrite(risky, { budget: declaredToolBudget(risky) });
  assert.match(rewrite.updatedInput.command, /execute-bounded-discovery\.mjs/u);
  const request = JSON.parse(Buffer.from(rewrite.updatedInput.command.split(" ").at(-1), "base64url"));
  assert.equal(request.command, "find . -type f");
  assert.equal(request.budget.maximumRawCaptureBytes, 400);
  assert.equal(boundedDiscoveryRewrite({ ...risky, tool_input: { command: "find . -type f | head -20" } }), null);
});

test("ordinary Git commands remain native", () => {
  const input = { tool_name: "Bash", tool_input: { command: "git status --short", workdir: "/home/emsenn/info" } };
  assert.equal(boundedDiscoveryRewrite(input), null);
});

test("Claude print-mode invocations are never substituted as shell discovery", () => {
  const input = { tool_name: "functions.exec", tool_input: { cmd: "claude --model sonnet --no-session-persistence --allowedTools Read,Glob,Grep -p 'find . and explain it'", workdir: "/home/emsenn/info" } };
  assert.equal(boundedDiscoveryRewrite(input), null);
});

test("host-level exec workdir takes precedence over the harness cwd", () => {
  const target = mkdtempSync(join(tmpdir(), "codex-host-workdir-"));
  const rewrite = boundedDiscoveryRewrite({
    tool_name: "exec_command", cwd: "/home/emsenn/info", workdir: target,
    tool_input: { cmd: "find . -maxdepth 3", max_output_tokens: 100 },
  });
  assert.equal(rewrite.request.cwd, target);
});

test("discovery stays native when Codex withholds its requested workdir from the hook", () => {
  for (const tool_name of ["Bash", "exec_command", "functions.exec"]) {
    const input = { tool_name, cwd: "/home/emsenn/info", tool_input: { cmd: "find . -maxdepth 3" } };
    assert.equal(boundedDiscoveryRewrite(input), null, tool_name);
  }
});

test("the executable boundary preserves a narrow cwd, exit status, and caller-sized carriers", () => {
  const options = state(), script = new URL("../scripts/execute-bounded-discovery.mjs", import.meta.url);
  const cwd = mkdtempSync(join(tmpdir(), "codex-bounded-cwd-"));
  const request = Buffer.from(JSON.stringify({
    command: "printf '%s\\n' \"$PWD\"; head -c 10000 /dev/zero | tr '\\0' x; printf 'diagnostic\\n' >&2; exit 7",
    cwd, budget: { ...DEFAULT_TOOL_BOUNDARY_BUDGET, maximumRawCaptureBytes: 400, maximumPremiumContextBytes: 12_288 },
  })).toString("base64url");
  const run = spawnSync(process.execPath, [script.pathname, "--request", request], { encoding: "utf8", env: { ...process.env, CODEX_ENTERPRISE_STATE_ROOT: options.stateRoot }, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(run.status, 7, run.stderr);
  assert.match(run.stdout, new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(run.stdout, /x{32}/u);
  const receiptId = run.stdout.match(/ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}/u)[0];
  const receipt = JSON.parse(readFileSync(join(options.stateRoot, "tool-evidence", "receipts", `${semanticFileKey(receiptId)}.json`), "utf8"));
  const stdout = receipt.output.carriers.find(({ stream }) => stream === "stdout");
  const stderr = receipt.output.carriers.find(({ stream }) => stream === "stderr");
  assert.equal(receipt.output.complete, false);
  assert.equal(stdout.bytes + stderr.bytes <= 400, true);
  assert.equal(stdout.bytes, 300);
  assert.match(readFileSync(stdout.carrier, "utf8"), new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(readFileSync(stderr.carrier, "utf8"), /diagnostic/u);
});

test("the executable boundary reduces a 44k-token-shaped stream without losing its carrier", () => {
  const options = state(), script = new URL("../scripts/execute-bounded-discovery.mjs", import.meta.url);
  const request = Buffer.from(JSON.stringify({
    command: "for i in $(seq 1 5000); do printf ' M lib/submodule-%05d/src/file.mjs\\n' \"$i\"; done",
    cwd: process.cwd(), model: "gpt-5.6-sol", provider: "openai",
    budget: { ...declaredToolBudget({ tool_name: "Bash", tool_input: { command: "git status" } }), maximumPremiumContextBytes: 12_288 },
  })).toString("base64url");
  const run = spawnSync(process.execPath, [script.pathname, "--request", request], { encoding: "utf8", env: { ...process.env, CODEX_ENTERPRISE_STATE_ROOT: options.stateRoot }, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, / M lib\/submodule-00001\/src\/file\.mjs/u);
  assert.match(run.stdout, /bounded discovery receipt ni:\/\/\/sha-256;/u);
  const receiptId = run.stdout.match(/ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}/u)[0];
  const page = readToolEvidence({ receipt: receiptId, stream: "stdout", maximumBytes: 1024 }, options);
  assert.equal(page.returnedBytes, 1024);
  assert.equal(page.stream, "stdout");
  assert.equal(page.availableCarriers.length, 2);
  assert.ok(page.totalBytes > 176_000);
  assert.ok(existsSync(page.carrier));
  const repeated = spawnSync(process.execPath, [script.pathname, "--request", request], { encoding: "utf8", env: { ...process.env, CODEX_ENTERPRISE_STATE_ROOT: options.stateRoot }, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, / M lib\/submodule-00001\/src\/file\.mjs/u);
  assert.match(repeated.stdout, /bounded discovery receipt ni:\/\/\/sha-256;/u);
});

test("pre-tool routing preserves a top-level exec workdir", () => {
  const input = { tool_name: "exec_command", tool_input: { cmd: "find ." }, workdir: "/tmp/codex-workdir-witness", model: "gpt-5.6-sol" };
  const rewrite = boundedDiscoveryRewrite(input, { budget: declaredToolBudget(input) });
  const request = JSON.parse(Buffer.from(rewrite.updatedInput.cmd.split(" ").at(-1), "base64url"));
  assert.equal(request.cwd, "/tmp/codex-workdir-witness");
  assert.equal(rewrite.updatedInput.workdir, "/tmp/codex-workdir-witness");
});
