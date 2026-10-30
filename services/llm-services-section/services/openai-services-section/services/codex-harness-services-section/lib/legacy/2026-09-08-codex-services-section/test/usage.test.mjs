import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { observeUsage } from "../src/usage.mjs";

const root = () => mkdtempSync(join(tmpdir(), "codex-usage-"));
const row = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });
const usage = (input, cached, output, reasoning) => ({
  input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0,
  output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output,
});

function writeRollout(sessionsRoot) {
  const directory = join(sessionsRoot, "2026", "07", "26");
  mkdirSync(directory, { recursive: true });
  const rate_limits = { primary: { used_percent: 25, window_minutes: 10080, resets_at: 1785628800 }, plan_type: "pro" };
  const lines = [
    row("2026-07-26T00:00:00.000Z", "session_meta", { id: "session-1" }),
    row("2026-07-26T00:00:01.000Z", "event_msg", { type: "token_count", info: { total_token_usage: usage(100, 80, 10, 2), model_context_window: 1000 }, rate_limits }),
    row("2026-07-26T00:00:02.000Z", "event_msg", { type: "task_started", turn_id: "turn-1" }),
    row("2026-07-26T00:00:02.100Z", "turn_context", { turn_id: "turn-1", model: "gpt-test", effort: "medium" }),
    row("2026-07-26T00:00:04.000Z", "event_msg", { type: "patch_apply_end", turn_id: "turn-1", call_id: "call-1", success: true, status: "completed", changes: { "src/a.mjs": { type: "add", unified_diff: "+code" } } }),
    row("2026-07-26T00:00:05.000Z", "event_msg", { type: "token_count", info: { total_token_usage: usage(160, 120, 25, 5), model_context_window: 1000 }, rate_limits }),
    row("2026-07-26T00:00:07.000Z", "event_msg", { type: "task_complete", turn_id: "turn-1" }),
  ];
  writeFileSync(join(directory, "rollout-session-1.jsonl"), `${lines.join("\n")}\n`);
}

test("observeUsage computes exact per-turn token deltas and wall time", () => {
  const sessionsRoot = root();
  writeRollout(sessionsRoot);
  const result = observeUsage({ sessionsRoot, sessionId: "session-1", turnId: "turn-1", includeWeekly: false });
  assert.equal(result.turns.length, 1);
  const turn = result.latestTurn;
  assert.deepEqual(turn.usage, { input_tokens: 60, cached_input_tokens: 40, cache_write_input_tokens: 0, output_tokens: 15, reasoning_output_tokens: 3, total_tokens: 75 });
  assert.deepEqual(turn.exclusiveTokenMix, { uncachedInputTokens: 20, cachedInputTokens: 40, ordinaryOutputTokens: 12, reasoningOutputTokens: 3 });
  assert.equal(turn.wallTimeMs, 5000);
  assert.equal(turn.model, "gpt-test");
  assert.equal(turn.reasoningEffort, "medium");
  assert.equal(turn.complete, true);
  assert.deepEqual(turn.patches[0].files, ["src/a.mjs"]);
});

test("observeUsage returns no weekly estimate without a monthly subscription amount", () => {
  const sessionsRoot = root();
  writeRollout(sessionsRoot);
  const result = observeUsage({ sessionsRoot, sessionId: "session-1" });
  assert.equal(result.weekly, null);
});

test("observeUsage derives a weekly subscription estimate when an amount is given", () => {
  const sessionsRoot = root();
  writeRollout(sessionsRoot);
  const result = observeUsage({ sessionsRoot, sessionId: "session-1", monthlySubscription: { numerator: "200", denominator: "1" } });
  assert.deepEqual(result.weekly.weeklySubscriptionEstimate.amount, { numerator: "600", denominator: "13" });
  assert.equal(result.weekly.estimatedCostPerToken.status, "estimate-not-provider-price");
});

test("observeUsage returns an empty result for a sessions root with no rollouts", () => {
  const result = observeUsage({ sessionsRoot: root(), includeWeekly: false });
  assert.deepEqual(result.turns, []);
  assert.equal(result.latestTurn, null);
});
