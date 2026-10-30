import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { officerContextBundle, selectContextWarrantedDuties } from "../src/duty-selection.mjs";

const base = (contextBundle) => ({
  actor: "urn:ame:bare-cedar-fog-codex",
  office: "bare-cedar-fog-codex-actuation-office",
  demand: "urn:sha256:demand",
  move: "urn:sha256:move",
  session: "codex-session:fresh",
  contextBundle,
  contextCompilationReceipt: "urn:sha256:compiler-receipt",
});

test("different exact contexts select different duty masks without changing Codex identity or conveying authority", () => {
  const diagnosis = officerContextBundle({ compiler: "urn:ame:context-compiler", evidence: [{ id: "urn:evidence:move", signal: "leader-move" }, { id: "urn:evidence:system", signal: "system-diagnosis-needed" }] });
  const execution = officerContextBundle({ compiler: "urn:ame:context-compiler", evidence: [{ id: "urn:evidence:authority", signal: "authorized-actuation-needed" }, { id: "urn:evidence:verify", signal: "verification-needed" }] });
  const left = selectContextWarrantedDuties(base(diagnosis));
  const right = selectContextWarrantedDuties(base(execution));
  assert.equal(left.actor, right.actor);
  assert.equal(left.provider, "urn:ame:codex-contextual-duty-selection-actuator");
  assert.deepEqual(left.selections.map(({ duty }) => duty), ["maintaining-codex-situational-knowledge", "diagnosing-the-union-system"]);
  assert.deepEqual(right.selections.map(({ duty }) => duty), ["actuating-union-change", "observing-response-and-learning"]);
  assert.deepEqual(left.conveys, []);
  assert.match(left.considerationDisposition, /unknown/u);
});

test("selection refuses inexact context, foreign identity, unknown signals, and duties absent from the office", () => {
  const context = officerContextBundle({ compiler: "urn:ame:context-compiler", evidence: [{ id: "urn:evidence:move", signal: "leader-move" }] });
  assert.throws(() => selectContextWarrantedDuties({ ...base(context), actor: "urn:ame:session" }), /actor must/u);
  assert.throws(() => selectContextWarrantedDuties(base({ ...context, compiler: "urn:ame:forged" })), /content addressed exactly/u);
  assert.throws(() => officerContextBundle({ compiler: "urn:ame:context-compiler", evidence: [{ id: "urn:evidence:x", signal: "invented-duty" }] }) && selectContextWarrantedDuties(base(officerContextBundle({ compiler: "urn:ame:context-compiler", evidence: [{ id: "urn:evidence:x", signal: "invented-duty" }] }))), /unknown context duty signal/u);
  const registry = { office: { id: "bare-cedar-fog-codex-actuation-office" }, duties: [{ id: "diagnosing-the-union-system" }] };
  assert.throws(() => selectContextWarrantedDuties(base(context), { registry }), /absent from office/u);
});

test("a fresh MCP process advertises and executes the duty-selection actuator", () => {
  const contextBundle = officerContextBundle({ compiler: "urn:ame:context-compiler", evidence: [{ id: "urn:evidence:design", signal: "architecture-needed" }] });
  const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "select_context_warranted_duties", arguments: base(contextBundle) } };
  const server = new URL("../src/mape-office-mcp.mjs", import.meta.url);
  const run = spawnSync(process.execPath, [server.pathname], { input: `${JSON.stringify(request)}\n`, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const response = JSON.parse(run.stdout);
  assert.equal(response.result.structuredContent.provider, "urn:ame:codex-contextual-duty-selection-actuator");
  assert.deepEqual(response.result.structuredContent.selections.map(({ duty }) => duty), ["designing-union-change"]);
  assert.deepEqual(response.result.structuredContent.conveys, []);
});
