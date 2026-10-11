import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileSessionContext } from "../src/codex-session-context.mjs";

function row(role, text) { return JSON.stringify({ type: "response_item", payload: { type: "message", role, content: [{ type: "input_text", input_text: text }] } }); }
test("retrieves prior user corrections from compressed rollouts without tool noise", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-context-")); mkdirSync(join(root, "day"));
  writeFileSync(join(root, "day", "old.jsonl.gz"), gzipSync(`${row("user", "The harness must use Gemini Notebook for transcript retrieval.")}\n${row("assistant", "I will preserve that correction.")}\n${JSON.stringify({ type: "response_item", payload: { type: "function_call" } })}\n`));
  const result = compileSessionContext({ query: "Gemini Notebook harness", sessionsRoot: root, maximumBytes: 4096 });
  assert.equal(result.matchCount, 1);
  assert.match(result.context, /must use Gemini Notebook/i);
  assert.match(result.context, /preserve that correction/i);
});
