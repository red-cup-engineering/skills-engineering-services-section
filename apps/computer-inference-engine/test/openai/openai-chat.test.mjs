import assert from "node:assert/strict";
import test from "node:test";

import { openAiChatCompletionCarrier, runOpenAiChatCompletion } from "../../src/openai/chat-completion-carriers.mjs";

test("OpenAI chat completion action projects tool_calls as playing capability invokes", () => {
  const completion = runOpenAiChatCompletion({
    model: "rck-test",
    messages: [
      { role: "system", content: "Witness every run." },
      { role: "user", content: "Invoke the probe." },
    ],
    tools: [{
      type: "function",
      function: {
        name: "probe",
        description: "Probe the RCK loop.",
        parameters: {
          type: "object",
          properties: { target: { type: "string" } },
        },
      },
    }],
    tool_choice: "required",
  }, { now: () => new Date("2026-06-26T00:00:00.000Z") });

  openAiChatCompletionCarrier.assert(completion, "completion");
  assert.equal(completion.object, "chat.completion");
  assert.equal(completion.created, 1782432000);
  assert.equal(completion.choices[0].finish_reason, "tool_calls");
  assert.equal(completion.choices[0].message.tool_calls[0].function.name, "probe");

  const args = JSON.parse(completion.choices[0].message.tool_calls[0].function.arguments);
  assert.equal(args.kind, "openai.chat.tool-call-as-playing-capability-invoke");
  assert.equal(args.playing.invocation.kind, "playing.wasi.invocation");
  assert.equal(args.playing.cut.kind, "playing.wasi.cut");
  assert.equal(args.playing.cut.converged, true);
});

test("OpenAI structured output returns JSON content as knowing reflection", () => {
  const completion = runOpenAiChatCompletion({
    model: "rck-test",
    messages: [{ role: "user", content: "Reflect as JSON." }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "reflection",
        schema: {
          type: "object",
          properties: { kind: { type: "string" } },
        },
      },
    },
  }, { now: () => new Date("2026-06-26T00:00:00.000Z") });

  assert.equal(completion.choices[0].finish_reason, "stop");
  const content = JSON.parse(completion.choices[0].message.content);
  assert.equal(content.kind, "openai.chat.structured-output-as-knowing-reflection");
  assert.equal(content.reflection.loop, "perceive->act");
});
