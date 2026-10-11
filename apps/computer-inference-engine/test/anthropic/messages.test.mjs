import assert from "node:assert/strict";
import test from "node:test";

import { anthropicMessageRequest, anthropicMessageResponse, anthropicMessageStreamEvent } from "../../src/anthropic/messages-codec.mjs";
import { streamAnthropicMessage, ANTHROPIC_API_KEY_ENV } from "../../src/anthropic/messages-client.mjs";
import { anthropicMessageStreamAccumulator } from "../../src/anthropic/messages-accumulator.mjs";

test("anthropicMessageRequest admits a well-formed request and rejects a missing model", () => {
  const wire = { model: "claude-test", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
  assert.deepEqual(anthropicMessageRequest(wire), wire);
  assert.throws(() => anthropicMessageRequest({ max_tokens: 64, messages: [] }), TypeError);
  assert.throws(() => anthropicMessageRequest({ model: "x", max_tokens: 0, messages: [] }), TypeError);
});

test("anthropicMessageResponse admits a well-formed response and rejects a missing usage", () => {
  const wire = {
    id: "msg_1", type: "message", role: "assistant",
    content: [{ type: "text", text: "hi" }],
    model: "claude-test", stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  assert.deepEqual(anthropicMessageResponse(wire), wire);
  assert.throws(() => anthropicMessageResponse({ ...wire, usage: undefined }), TypeError);
  assert.throws(() => anthropicMessageResponse({ ...wire, type: "not-message" }), TypeError);
});

test("anthropicMessageStreamEvent requires a non-empty type", () => {
  assert.deepEqual(anthropicMessageStreamEvent({ type: "message_start" }), { type: "message_start" });
  assert.throws(() => anthropicMessageStreamEvent({}), TypeError);
});

test("streamAnthropicMessage refuses with missing-api-key when no key is configured", async () => {
  const events = [];
  for await (const event of streamAnthropicMessage(
    { model: "claude-test", max_tokens: 8, messages: [{ role: "user", content: "hi" }] },
    { env: {} },
  )) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "anthropic.messages.stream.failure");
  assert.equal(events[0].condition, "missing-api-key");
});

function sseBody(events) {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

test("streamAnthropicMessage sends the real Anthropic Messages headers and parses the SSE frames it gets back", async () => {
  let observed;
  const events = [
    { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", content: [], model: "claude-test", stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "done" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  const streamed = [];
  for await (const event of streamAnthropicMessage(
    { model: "claude-test", max_tokens: 64, messages: [{ role: "user", content: "go" }] },
    {
      env: { [ANTHROPIC_API_KEY_ENV]: "test-secret", ANTHROPIC_BASE_URL: "https://anthropic.invalid" },
      fetch: async (url, init) => {
        observed = { url, headers: init.headers, body: JSON.parse(init.body) };
        return new Response(sseBody(events), { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    },
  )) streamed.push(event);

  assert.equal(observed.url, "https://anthropic.invalid/v1/messages");
  assert.equal(observed.headers["x-api-key"], "test-secret");
  assert.equal(observed.headers["anthropic-version"], "2023-06-01");
  assert.equal(observed.body.stream, true);

  const accumulator = anthropicMessageStreamAccumulator();
  for (const streamedEvent of streamed) accumulator.push(streamedEvent.event);
  const response = accumulator.read();
  assert.equal(response.content[0].text, "done");
  assert.equal(response.usage.input_tokens, 2);
  assert.equal(response.usage.output_tokens, 1);
  assert.equal(response.stop_reason, "end_turn");
});

test("streamAnthropicMessage reports unauthorized/rate-limited/rejected by status and truncated when message_stop never arrives", async () => {
  const env = { [ANTHROPIC_API_KEY_ENV]: "secret" };
  const cases = [
    [401, "unauthorized"],
    [429, "rate-limited"],
    [500, "rejected"],
  ];
  for (const [status, condition] of cases) {
    const events = [];
    for await (const event of streamAnthropicMessage(
      { model: "x", max_tokens: 8, messages: [{ role: "user", content: "go" }] },
      { env, fetch: async () => new Response(JSON.stringify({ error: { message: "boom" } }), { status }) },
    )) events.push(event);
    assert.equal(events.at(-1).kind, "anthropic.messages.stream.failure");
    assert.equal(events.at(-1).condition, condition);
  }

  const truncated = [];
  for await (const event of streamAnthropicMessage(
    { model: "x", max_tokens: 8, messages: [{ role: "user", content: "go" }] },
    { env, fetch: async () => new Response(sseBody([{ type: "message_start", message: { id: "m", model: "x", usage: {} } }]), { status: 200 }) },
  )) truncated.push(event);
  assert.equal(truncated.at(-1).kind, "anthropic.messages.stream.failure");
  assert.equal(truncated.at(-1).condition, "truncated");
});
