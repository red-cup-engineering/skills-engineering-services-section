import assert from "node:assert/strict";
import test from "node:test";
import { parseTranscriptJsonl, spansFromClaudeTranscript } from "../../src/tokens/claude-transcript-adapter.mjs";
import { isPinned, planCompaction } from "../../src/tokens/token-compactification.mjs";

const row = (role, content) => ({ type: role, message: { role, content } });

test("rows become spans with kinds that route compaction treatment", () => {
  const spans = spansFromClaudeTranscript([
    row("user", "real leader speech"),
    row("user", "<system-reminder>injected law</system-reminder>"),
    row("assistant", [{ type: "text", text: "working" }]),
    row("user", [{ type: "tool_result", content: "exit 0 output", is_error: false, tool_use_id: "t1" }]),
    { type: "summary", other: true },
  ]);
  assert.deepEqual(
    spans.map((s) => s.kind),
    ["user", "harness", "assistant", "tool_result"],
  );
  assert.equal(spans[3].meta.toolUseId, "t1");
});

test("leader speech is pinned; harness injections are not", () => {
  const spans = spansFromClaudeTranscript([row("user", "the constraint"), row("user", "<system-reminder>noise</system-reminder>")]);
  assert.equal(isPinned(spans[0]), true);
  assert.equal(isPinned(spans[1]), false);
});

test("an error tool_result carries isError for the masking pass", () => {
  const spans = spansFromClaudeTranscript([row("user", [{ type: "tool_result", content: "boom", is_error: true }])]);
  assert.equal(spans[0].meta.isError, true);
});

test("adapter output feeds planCompaction directly", () => {
  const rows = [row("user", "start"), row("assistant", "x".repeat(500)), row("user", "end")];
  const plan = planCompaction(spansFromClaudeTranscript(rows), { budget: 100, keptHeadCount: 1, keptTailRatio: 0.3 });
  assert.equal(plan.needsCompaction, true);
});

test("parseTranscriptJsonl skips malformed lines", () => {
  const rows = parseTranscriptJsonl(`not json\n${JSON.stringify(row("user", "ok"))}\n\n`);
  assert.equal(rows.length, 1);
});
