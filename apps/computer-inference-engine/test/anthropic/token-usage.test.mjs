import assert from "node:assert/strict";
import test from "node:test";

import {
  anthropicMessageTokenUsage,
  anthropicMessageStreamTokenUsageOfContent,
  claudeSessionTokenUsageOfContent,
} from "../../src/anthropic/token-usage.mjs";

test("anthropicMessageTokenUsage reads a batched response's own usage object", () => {
  const message = {
    id: "msg_1",
    model: "claude-test",
    usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 1 },
  };
  const summary = anthropicMessageTokenUsage(message);
  assert.equal(summary.turns, 1);
  assert.equal(summary.total.inputTokens, 5);
  assert.equal(summary.total.outputTokens, 2);
  assert.equal(summary.total.cacheReadInputTokens, 1);
  assert.deepEqual(summary.requests, ["msg_1"]);
  assert.deepEqual(summary.models, ["claude-test"]);
});

test("anthropicMessageTokenUsage reports zero events when the response carries no token usage", () => {
  const summary = anthropicMessageTokenUsage({ id: "msg_2", model: "claude-test", usage: {} });
  assert.equal(summary.events, 0);
  assert.equal(summary.turns, 0);
});

test("anthropicMessageStreamTokenUsageOfContent folds cumulative message_delta usage into one final turn event", () => {
  const frames = [
    { type: "message_start", message: { id: "msg_stream", model: "claude-stream", usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: "message_delta", usage: { output_tokens: 3 } },
    { type: "message_stop" },
  ];
  const content = frames.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const summary = anthropicMessageStreamTokenUsageOfContent(content);
  assert.equal(summary.turns, 1);
  assert.equal(summary.total.inputTokens, 5);
  assert.equal(summary.total.outputTokens, 3);
  assert.deepEqual(summary.requests, ["msg_stream"]);
});

test("claudeSessionTokenUsageOfContent reads assistant-turn usage from a Claude Code transcript and marks repeats duplicate", () => {
  const at = "2026-09-11T12:00:00.000Z";
  const row = (requestId, tokens) => JSON.stringify({
    type: "assistant",
    sessionId: "claude-test",
    requestId,
    timestamp: at,
    message: { id: `message-${requestId}`, model: "claude-test", role: "assistant", usage: { input_tokens: tokens, output_tokens: 1 } },
  });
  const content = `${row("req-1", 5)}\n${row("req-2", 3)}\n${row("req-1", 5)}\n`;
  const summary = claudeSessionTokenUsageOfContent(content);
  assert.equal(summary.sessionId, "claude-test");
  assert.equal(summary.rawEvents.length, 3);
  assert.deepEqual(summary.rawEvents.map((e) => e.usageKind), ["turn", "turn", "duplicate"]);
  assert.equal(summary.turns, 2);
  assert.equal(summary.total.inputTokens, 8);
});
