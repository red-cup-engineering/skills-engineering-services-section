import assert from "node:assert/strict";
import test from "node:test";
import { projectChatCompletion } from "../../src/openai/project-chat-completion.mjs";

test("preserves reasoning before a visible answer", () => {
  const result = projectChatCompletion({
    choices: [{
      finish_reason: "stop",
      message: {
        role: "assistant",
        reasoning_content: "I should inspect the target first.",
        content: '{"action":"read","args":{"path":"src/target.mjs"}}',
      },
    }],
  });
  assert.equal(
    result.text,
    'I should inspect the target first.\n{"action":"read","args":{"path":"src/target.mjs"}}',
  );
  assert.deepEqual(result.carriers, ["reasoning", "content"]);
});

test("projects a null-content native tool call without asking the model for JSON", () => {
  const result = projectChatCompletion({
    choices: [{
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"src/target.mjs"}' },
        }],
      },
    }],
  });
  assert.equal(
    result.text,
    '<tool_call>read_file {"path":"src/target.mjs"}</tool_call>',
  );
  assert.deepEqual(result.carriers, ["tool-call"]);
});

test("does not mistake an empty assistant turn for a completion carrier", () => {
  assert.deepEqual(
    projectChatCompletion({ choices: [{ message: { role: "assistant", content: null } }] }),
    { text: "", carriers: [], choice: { message: { role: "assistant", content: null } } },
  );
});
