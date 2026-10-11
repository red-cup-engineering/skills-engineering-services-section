import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureCommand, readCapturedOutput, renderCapturedOutput } from "../../src/cost/tool-output-capture.mjs";
import { captureRewrite, readOnlyCommand } from "../../src/cost/pretool-capture.mjs";

test("only enumerated git status argv forms may receive a pre-tool allow", () => {
  for (const command of ["git status", "git status --short", "git status --branch", "rg -n token src", "grep -i token file.txt"]) assert.equal(readOnlyCommand(command), true, command);
  for (const command of ["git branch -D branch", "git diff --output=/tmp/file", "find . -delete", "find . -exec rm {} \\;", "rg --pre executable needle", "git status && git push", "git status > out", "git status 'quoted'", "git status --short --output=x"]) assert.equal(readOnlyCommand(command), false, command);
});

test("shell expansions and machine-readable commands stay native; Claude schema stays intact", () => {
  for (const command of ["rg pattern *", "rg pattern ?", "rg pattern [ab]", "rg pattern {a,b}", "rg pattern ~", "git status --porcelain", "rg --json token src"]) assert.equal(readOnlyCommand(command), false, command);
  const rewritten = captureRewrite({ tool_input: {command:"git status --short", timeout:1000}, cwd:"/tmp" });
  assert.equal(rewritten.timeout,1000);
  assert.equal(Object.hasOwn(rewritten,"max_output_tokens"),false);
});

test("Unicode, oversized first lines, and repeated captures respect storage and byte budgets", async () => {
  const root=mkdtempSync(join(tmpdir(),"tool-output-capture-"));
  writeFileSync(join(root,"fixture"),"🙂".repeat(6000)+"\n"+Array.from({length:1000},(_,i)=>`src/项目-${i}.mjs: useful 🙂 evidence\n`).join(""));
  const capture=await captureCommand({command:"cat fixture",cwd:root,root});
  const repeated=await captureCommand({command:"cat fixture",cwd:root,root});
  assert.deepEqual(readdirSync(join(root,"runs")),[]);
  assert.equal(capture.stdout.reused, false);
  assert.equal(repeated.stdout.reused, true);
  const rendered=renderCapturedOutput(capture,{maximumRenderBytes:12000});
  assert.ok(Buffer.byteLength(rendered.stdout+rendered.stderr)<=12000);
  assert.match(rendered.stdout,/项目-999/u);
  assert.doesNotMatch(rendered.stdout,/\uFFFD/u);
  const page=readCapturedOutput({digest:capture.stdout.retainedDigest,stream:"stdout",offset:12,maximumBytes:8,root});
  assert.equal(Buffer.from(page.content,"base64").toString(),"🙂🙂");
});

test("capture keeps exact stdout and stderr carriers while rendering a bounded context", async () => {
  const root = mkdtempSync(join(tmpdir(), "tool-output-capture-"));
  const capture = await captureCommand({ command: "printf '%05000d\\n' 0; printf 'fatal diagnostic\\n' >&2; exit 7", cwd: root, root });
  assert.equal(capture.exitCode, 7);
  assert.equal(capture.stdout.complete, true);
  assert.equal(capture.stderr.complete, true);
  const rendered = renderCapturedOutput(capture, { maximumRenderBytes: 256 });
  assert.match(rendered.stdout, /tool output masked|tool output capture/u);
  assert.match(rendered.stderr, /fatal diagnostic/u);
  const page = readCapturedOutput({ digest: capture.stdout.retainedDigest, stream: "stdout", maximumBytes: 32, root });
  assert.equal(Buffer.from(page.content, "base64").length, 32);
  assert.equal(page.totalBytes, capture.stdout.observedBytes);
});

test("a reached capture cap is explicit and never claimed as exact readback", async () => {
  const root = mkdtempSync(join(tmpdir(), "tool-output-capture-"));
  const capture = await captureCommand({ command: "head -c 100 /dev/zero", cwd: root, root, maximumCaptureBytes: 16 });
  assert.equal(capture.stdout.complete, false);
  assert.equal(capture.stdout.observedBytes, 100);
  assert.equal(capture.stdout.retainedBytes, 16);
  assert.match(renderCapturedOutput(capture).stdout, /complete=false; partial/u);
});

test("optional measurement preserves process resource units", async () => {
  const root = mkdtempSync(join(tmpdir(), "tool-output-capture-"));
  const capture = await captureCommand({ command: "printf measured", cwd: root, root, measureResources: true });
  assert.equal(capture.resources.wallTime.unit, "seconds");
  assert.equal(capture.resources.cpuUser.unit, "seconds");
  assert.equal(capture.resources.cpuSystem.unit, "seconds");
  assert.equal(capture.resources.peakRss.unit, "bytes");
});

test("optional stream limits preserve a caller's combined capture cap", async () => {
  const root = mkdtempSync(join(tmpdir(), "tool-output-capture-"));
  const capture = await captureCommand({ command: "head -c 300 /dev/zero; head -c 100 /dev/zero >&2", cwd: root, root, maximumCaptureBytes: 400, maximumStdoutCaptureBytes: 300, maximumStderrCaptureBytes: 100 });
  assert.equal(capture.stdout.retainedBytes + capture.stderr.retainedBytes, 400);
});

test("distinct search evidence compacts below the render budget while retaining exact matches", async () => {
  const root = mkdtempSync(join(tmpdir(), "tool-output-capture-"));
  const command = "for i in $(seq 1 1000); do printf 'src/item-%s.mjs:%s: important behavior %s\\n' \"$i\" \"$i\" \"$i\"; done";
  const capture = await captureCommand({ command, cwd: root, root });
  assert.equal(capture.stdout.observedBytes, 44_679);
  const rendered = renderCapturedOutput(capture, { maximumRenderBytes: 12_000 });
  assert.ok(Buffer.byteLength(rendered.stdout) <= 12_000, Buffer.byteLength(rendered.stdout));
  assert.match(rendered.stdout, /src\/item-1\.mjs:1: important behavior 1/u);
  assert.match(rendered.stdout, /src\/item-1000\.mjs:1000: important behavior 1000/u);
  const page = readCapturedOutput({ digest: capture.stdout.retainedDigest, stream: "stdout", maximumBytes: 128, root });
  assert.match(Buffer.from(page.content, "base64").toString("utf8"), /src\/item-1/u);
});
