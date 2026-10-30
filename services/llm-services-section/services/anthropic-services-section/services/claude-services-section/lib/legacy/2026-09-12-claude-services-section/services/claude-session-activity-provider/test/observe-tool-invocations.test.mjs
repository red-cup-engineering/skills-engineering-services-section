import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { observeClaudeToolInvocations } from "../src/observe-tool-invocations.mjs";

function fixture(rows) {
  const root = mkdtempSync(join(tmpdir(), "claude-tool-observation-"));
  const path = join(root, "11111111-1111-4111-8111-111111111111.jsonl");
  const lines = rows.map((row) => typeof row === "string" ? row : JSON.stringify(row));
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  const mtime = new Date("2026-07-30T12:30:00.000Z");
  utimesSync(path, mtime, mtime);
  return root;
}

const window = { fromExclusive: "2026-07-30T12:00:00.000Z", toInclusive: "2026-07-30T13:00:00.000Z" };

test("observes every Claude tool_use block without disclosing content or call ids", async () => {
  const secret = "DO-NOT-DISCLOSE-PROMPT-ARGUMENT-OR-OUTPUT";
  const root = fixture([
    {
      type: "assistant",
      timestamp: "2026-07-30T12:02:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: secret },
          { type: "tool_use", id: "private-call-one", name: "Bash", input: { command: secret } },
          { type: "tool_use", id: "private-call-two", name: "Edit", input: { file_path: secret } },
        ],
      },
    },
    { type: "user", timestamp: "2026-07-30T12:02:05.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "private-call-one", content: secret }] } },
  ]);
  const receipt = await observeClaudeToolInvocations({ window, recordedAt: window.toInclusive, sessionRoot: root });
  assert.equal(receipt.type, "ClaudeToolInvocationObservationReceipt");
  assert.equal(receipt.observations.length, 2);
  assert.deepEqual(receipt.observations.map(({ requestedTool }) => requestedTool.name), ["Bash", "Edit"]);
  assert.equal(receipt.observations[0].actuator.status, "not-bound-by-transcript-observation");
  assert.equal(receipt.authority.execution, false);
  assert.equal(receipt.authority.actuatorBinding, false);
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("private-call-one"), false);
  assert.equal(serialized.includes("private-call-two"), false);
});

test("uses the exact open-closed observation interval", async () => {
  const row = (timestamp, id) => ({ type: "assistant", timestamp, message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: {} }] } });
  const root = fixture([
    row(window.fromExclusive, "excluded-at-start"),
    row(window.toInclusive, "included-at-end"),
    row("2026-07-30T13:00:00.001Z", "excluded-after-end"),
  ]);
  const receipt = await observeClaudeToolInvocations({ window, sessionRoot: root });
  assert.equal(receipt.observations.length, 1);
});

test("retains malformed transcript rows as a bounded refusal", async () => {
  const root = fixture([
    "{malformed-json",
    { type: "assistant", timestamp: "2026-07-30T12:10:00.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "valid", name: "Bash", input: {} }] } },
  ]);
  const receipt = await observeClaudeToolInvocations({ window, sessionRoot: root });
  assert.equal(receipt.observations.length, 1);
  assert.deepEqual(receipt.refusals.map(({ code }) => code), ["malformed-transcript-row-excluded"]);
});

test("a missing session store remains an explicit observation failure", async () => {
  await assert.rejects(observeClaudeToolInvocations({ window, sessionRoot: join(tmpdir(), "not-a-claude-session-store") }), /unavailable/u);
});
