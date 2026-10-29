import assert from "node:assert/strict";
import test from "node:test";

import {
  openAiCompletionFromLoopStep,
  openAiCompletionToLoopStep,
  openAiRequestFromAnimatingLoopContext,
  openAiRequestToAnimatingLoopContext,
  roleToIllocutionaryForce,
} from "../dist/codecs/openai-chat/index.mjs";

test("OpenAI chat request maps to animating loop context and back", () => {
  const request = {
    model: "local-test-model",
    messages: [
      { role: "system", content: "Keep the ledger." },
      { role: "user", content: "Use the probe tool." },
    ],
    tools: [{
      type: "function",
      function: {
        name: "probe",
        description: "Probe the witnessed loop.",
        parameters: {
          type: "object",
          properties: { target: { type: "string" } },
          required: ["target"],
        },
      },
    }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "probe_result",
        strict: true,
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
      },
    },
  };

  const context = openAiRequestToAnimatingLoopContext(request, { threadId: "thread:test" });
  assert.equal(context.threadId, "thread:test");
  assert.equal(context.kind, "openai.chat.thread-as-animating-loop");
  assert.equal(context.utterances[0].force, "declarative");
  assert.equal(context.utterances[1].force, "directive");
  assert.equal(context.context.playing.tools[0].name, "probe");
  assert.equal(context.context.knowing.responseFormat.type, "json_schema");
  assert.equal(roleToIllocutionaryForce("assistant"), "assertive");

  const roundTripped = openAiRequestFromAnimatingLoopContext(context);
  assert.deepEqual(roundTripped.messages, request.messages);
  assert.equal(roundTripped.tools[0].function.name, "probe");
  assert.equal(roundTripped.response_format.json_schema.name, "probe_result");
});

test("OpenAI completion maps to reflect/act step and back", () => {
  const completion = {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1782450000,
    model: "local-test-model",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_probe",
          type: "function",
          function: {
            name: "probe",
            arguments: "{\"target\":\"ledger\"}",
          },
        }],
      },
      finish_reason: "tool_calls",
    }],
    usage: {
      prompt_tokens: 7,
      completion_tokens: 3,
      total_tokens: 10,
    },
  };

  const step = openAiCompletionToLoopStep(completion);
  assert.equal(step.reflection.value, "active");
  assert.equal(step.acts[0].kind, "openai.chat.tool-call-as-playing-cut");
  assert.equal(step.acts[0].call.name, "probe");
  assert.deepEqual(step.acts[0].call.arguments, { target: "ledger" });

  const projected = openAiCompletionFromLoopStep(step);
  assert.equal(projected.object, "chat.completion");
  assert.equal(projected.choices[0].finish_reason, "tool_calls");
  assert.equal(projected.choices[0].message.tool_calls[0].function.name, "probe");
});
