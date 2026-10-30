#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { semanticByteIdentity, semanticIdentity } from "../src/semiotic-circuit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const HOOK = join(ROOT, "src/codex-enterprise-hook.mjs");
const CANDIDATE_FILES = [
  "src/prompt-cycle.mjs", "src/historical-demands.mjs", "src/codex-enterprise-hook.mjs", "src/mcp-server.mjs", "scripts/admit-next-historical-demand.mjs",
  "scripts/check-codex-runtime.mjs", "agents/harness/codex-hooks.manifest.json", ".codex/hooks.json",
];
function digest(bytes) { return semanticByteIdentity(bytes, "bare-cedar-fog-codex.prompt-cycle-assay-carrier").id; }
function repositoryRoot() {
  let current = ROOT;
  while (true) {
    if (existsSync(join(current, ".git")) && existsSync(join(current, "lib/emsenn"))) return current;
    const parent = dirname(current); if (parent === current) throw new Error("cannot locate repository root"); current = parent;
  }
}
function invoke(input, stateRoot) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input), encoding: "utf8",
    env: { ...process.env, CODEX_ENTERPRISE_STATE_ROOT: stateRoot, CODEX_PROMPT_WORKER_DISABLED: "1" },
    timeout: 10_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || `hook exited ${result.status}`);
  return JSON.parse(result.stdout);
}

const repo = repositoryRoot(), stateRoot = mkdtempSync(join(tmpdir(), "codex-prompt-cycle-assay-"));
const startedAt = new Date().toISOString();
try {
  const common = { session_id: "prompt-cycle-observation", cwd: repo };
  const first = invoke({ ...common, hook_event_name: "UserPromptSubmit", turn_id: "turn-1", prompt: "continue the old plan" }, stateRoot);
  const correction = invoke({ ...common, hook_event_name: "UserPromptSubmit", turn_id: "turn-1", prompt: "correction: restart monitoring" }, stateRoot);
  const restarted = invoke({ ...common, hook_event_name: "PreToolUse", turn_id: "turn-1", tool_name: "exec_command", tool_input: { cmd: "true" } }, stateRoot);
  invoke({ ...common, hook_event_name: "UserPromptSubmit", turn_id: "turn-2", prompt: "a later correction" }, stateRoot);
  const denied = invoke({ ...common, hook_event_name: "PreToolUse", turn_id: "turn-1", tool_name: "exec_command", tool_input: { cmd: "true" } }, stateRoot);
  if (!first.hookSpecificOutput?.additionalContext?.includes("ACTIVE MAPE-K CYCLE")) throw new Error("first prompt did not start a cycle");
  if (!correction.hookSpecificOutput?.additionalContext?.includes("INTERRUPTION")) throw new Error("correction did not restart the cycle");
  if (restarted.hookSpecificOutput?.permissionDecision === "deny") throw new Error("same-turn correction generation was denied");
  if (denied.hookSpecificOutput?.permissionDecision !== "deny" || !/superseded|correction/u.test(denied.hookSpecificOutput.permissionDecisionReason ?? "")) throw new Error("superseded turn tool was not denied");
  const trajectory = readFileSync(join(stateRoot, "trajectory.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
  if (!trajectory.some(({ type }) => type === "PromptMapeCycleSuperseded") || trajectory.filter(({ type }) => type === "PromptMapeCycleStarted").length !== 3) throw new Error("persisted cycle trajectory is incomplete");
  const promptEvents = readFileSync(join(stateRoot, "prompt-events.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
  if (promptEvents.length !== 3 || promptEvents[1].interruption !== true) throw new Error("persisted correction prompt is incomplete");
  const candidate = CANDIDATE_FILES.map((file) => {
    const path = file.startsWith(".codex/") ? join(repo, file) : join(ROOT, file);
    return { file, digest: digest(readFileSync(path)) };
  });
  const completedAt = new Date().toISOString();
  const receiptBody = { type: "FreshProcessPromptCycleAssay", process: process.execPath, startedAt, completedAt, outcome: "passed", assertions: ["first prompt starts persisted MAPE cycle", "same-turn steering correction restarts and may execute", "a later correction denies the superseded generation", "correction source retained as data"], candidate };
  process.stdout.write(`${JSON.stringify({ id: semanticIdentity(receiptBody, "bare-cedar-fog-codex.prompt-cycle-assay-receipt").id, ...receiptBody }, null, 2)}\n`);
} finally {
  rmSync(stateRoot, { recursive: true, force: true });
}
