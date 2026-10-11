import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CHAT_COMPLETION_TURN_INPUT_SCHEMA } from "../../src/openai/chat-turn-contract.mjs";

test("chat turn contract exposes the supported OpenAI wire profile", () => {
  assert.equal(CHAT_COMPLETION_TURN_INPUT_SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(CHAT_COMPLETION_TURN_INPUT_SCHEMA.$id, "urn:red-cup-engineering:schema:chat-completion-turn-input:1");
  assert.deepEqual(CHAT_COMPLETION_TURN_INPUT_SCHEMA.properties.messages.items.properties.role.enum, ["system", "developer", "user", "assistant", "tool"]);
  assert.equal(CHAT_COMPLETION_TURN_INPUT_SCHEMA.additionalProperties, false);
  assert.equal(Object.hasOwn(CHAT_COMPLETION_TURN_INPUT_SCHEMA.properties, "model"), false);
  assert.equal(CHAT_COMPLETION_TURN_INPUT_SCHEMA.properties.messages.items.properties.tool_calls.items.properties.function.properties.arguments.type, "string");
});

test("chat turn contract exposes declarations through its public export", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".chat-turn-contract-types-"));
  try {
    const source = path.join(directory, "consumer.mts");
    writeFileSync(source, [
      'import { CHAT_COMPLETION_TURN_INPUT_SCHEMA } from "@red-cup-engineering/computer-inference-engine/openai/chat-turn-contract";',
      "const fields: readonly string[] = Object.keys(CHAT_COMPLETION_TURN_INPUT_SCHEMA.properties);",
      "void fields;",
    ].join("\n"));
    execFileSync(process.execPath, [
      fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
      "--noEmit", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--skipLibCheck", source,
    ], { cwd: process.cwd(), stdio: "pipe" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
