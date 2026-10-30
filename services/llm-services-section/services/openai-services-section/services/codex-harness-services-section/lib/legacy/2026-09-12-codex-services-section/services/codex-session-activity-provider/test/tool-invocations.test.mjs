import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listToolInvocations } from "../src/tool-invocations.mjs";

function fixture(rows) {
  const root = mkdtempSync(join(tmpdir(), "codex-tool-invocations-"));
  const directory = join(root, "2026", "07", "29");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "rollout.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return root;
}

const window = { fromExclusive: "2026-07-29T08:00:00.000Z", toInclusive: "2026-07-29T09:00:00.000Z" };

test("lists requested tools by name, transport, and status, without arguments or output", async () => {
  const secret = "DO-NOT-DISCLOSE-PROMPT-OR-TOOL-INPUT";
  const root = fixture([
    { timestamp: "2026-07-29T08:01:00.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "call-1", input: secret, status: "completed" } },
    { timestamp: "2026-07-29T08:02:00.000Z", type: "response_item", payload: { type: "function_call", name: "spawn_agent", call_id: "call-2", arguments: secret } },
    { timestamp: "2026-07-29T08:03:00.000Z", type: "event_msg", payload: { type: "patch_apply_end", stdout: secret } },
  ]);
  const { invocations, malformedRows } = await listToolInvocations({ window, sessionRoot: root });

  assert.equal(malformedRows, 0);
  assert.deepEqual(invocations.map((invocation) => invocation.tool), ["exec", "spawn_agent"]);
  assert.equal(invocations[0].status, "completed");
  assert.equal(invocations[0].transport, "custom_tool_call");
  const serialized = JSON.stringify(invocations);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("call-1"), false);
});

test("rows outside the window are excluded", async () => {
  const root = fixture([
    { timestamp: "2026-07-29T07:00:00.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "call-1", status: "completed" } },
  ]);
  const { invocations } = await listToolInvocations({ window, sessionRoot: root });
  assert.deepEqual(invocations, []);
});

test("a missing session directory is an explicit failure", async () => {
  await assert.rejects(
    listToolInvocations({ window, sessionRoot: join(tmpdir(), "not-a-codex-session-directory") }),
    /Codex session directory not found/u,
  );
});
