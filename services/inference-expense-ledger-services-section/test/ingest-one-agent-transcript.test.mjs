import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ingestAgentTranscript, writeAgentExpenseRecords, writeExpenseRecords } from "../src/ingest.mjs";
import { loadPriceClaims } from "../src/published-prices.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const claims = loadPriceClaims(path.join(here, "../data/records/2026-10-19-anthropic-published-prices.json"));
const row = (id, at, usage) => JSON.stringify({ type: "assistant", timestamp: at, uuid: `u-${id}`, message: { id, model: "claude-opus-5-5", content: [{ type: "text", text: "SECRET-PROSE" }], usage } });
const usage = (input, write, read, output) => ({ input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output, cache_creation: { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: 0 } });
const agent = { harness: "claude-code", sessionId: "sess-1", agentId: "abc123", role: "subagent", meta: { agentType: "general-purpose", description: "Fix the thing", toolUseId: null } };
const transcript = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "one-agent-"));
  const file = path.join(dir, "agent-abc123.jsonl");
  writeFileSync(file, [row("m1", "2026-10-19T23:59:00.000Z", usage(2, 1000, 0, 10)), row("m2", "2026-10-20T00:01:00.000Z", usage(3, 0, 1000, 20)), "{not json \"usage\"", JSON.stringify({ type: "user", message: { content: "password=hunter2" } })].join("\n") + "\n");
  return { dir, file };
};

test("one agent's transcript yields priced records per UTC day it spans, with no content", () => {
  const { file } = transcript();
  const records = ingestAgentTranscript({ file, agent, claims, allowLaterPrices: true, now: new Date("2026-10-20T01:00:00Z") });
  assert.deepEqual(records.map((r) => [r.day, r.turns, r.priced]), [["2026-10-19", 1, true], ["2026-10-20", 1, true]]);
  assert.equal(records[0].agent.id, "abc123");
  assert.equal(records[0].agent.description, "Fix the thing");
  assert.doesNotMatch(JSON.stringify(records), /SECRET-PROSE|hunter2/);
});

test("records land at <out>/<day>/<session>/<agent>.jsonl, are replaced on rerun, and the day ingest supersedes them", () => {
  const { dir, file } = transcript();
  const records = ingestAgentTranscript({ file, agent, claims, allowLaterPrices: true });
  const out = path.join(dir, "out");
  const files = writeAgentExpenseRecords(records, out);
  assert.deepEqual(files.map((f) => path.relative(out, f)), ["2026-10-19/sess-1/abc123.jsonl", "2026-10-20/sess-1/abc123.jsonl"]);
  writeAgentExpenseRecords(records, out);
  assert.equal(readFileSync(files[0], "utf8").trim().split("\n").length, 1);
  writeExpenseRecords(records.filter((r) => r.day === "2026-10-19"), out, "2026-10-19");
  assert.ok(!existsSync(files[0]), "the day ingest removed the per-agent file it supersedes");
  assert.ok(existsSync(files[1]), "another day's file is untouched");
});

test("the script prices one transcript and prints one JSON line; missing arguments exit 2", () => {
  const { dir, file } = transcript();
  const script = path.join(here, "../scripts/ingest-one-agent-transcript.mjs");
  const ok = spawnSync(process.execPath, [script, "--transcript", file, "--session", "sess-1", "--agent", "abc123", "--type", "general-purpose", "--out", path.join(dir, "o"), "--allow-later-price-claim"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const result = JSON.parse(ok.stdout);
  assert.equal(result.records, 2);
  assert.equal(result.turns, 2);
  assert.match(result.pricedUsd, /^\d+\.\d+$/u);
  assert.equal(spawnSync(process.execPath, [script, "--transcript", file], { encoding: "utf8" }).status, 2);
});


test("ledger file identifiers refuse traversal, invalid dates and mixed-day writes before filesystem effects", () => {
  const { dir, file } = transcript();
  try {
    const [record] = ingestAgentTranscript({ file, agent, claims, allowLaterPrices: true });
    const out = path.join(dir, "refused-out");
    const bad = [
      { ...record, sessionId: "../outside" },
      { ...record, sessionId: "..\\\\outside" },
      { ...record, agent: { ...record.agent, id: "../../outside" } },
      { ...record, agent: { ...record.agent, id: "bad\\\\name" } },
      { ...record, agent: { ...record.agent, id: "." } },
      { ...record, day: "../outside" },
      { ...record, day: "2026-02-30" },
    ];
    for (const row of bad) {
      assert.throws(() => writeAgentExpenseRecords([row], out), /invalid (sessionId|agentId|ledger UTC day)/);
      assert.ok(!existsSync(out), "invalid record must not create a destination directory");
    }
    assert.throws(() => writeExpenseRecords([{ ...record, sessionId: "../escape" }], out, record.day), /sessionId/);
    assert.throws(() => writeExpenseRecords([record], out, "../outside"), /UTC day/);
    assert.throws(() => writeExpenseRecords([record], out, "2026-10-20"), /record.day mismatch/);
    assert.ok(!existsSync(out), "day ingest refuses all malformed input before creating directories");
    const script = path.join(here, "../scripts/ingest-one-agent-transcript.mjs");
    const badCli = spawnSync(process.execPath, [script, "--transcript", file, "--session", "../escape", "--agent", "abc123", "--out", out, "--allow-later-price-claim"], { encoding: "utf8" });
    assert.equal(badCli.status, 2, "CLI refuses untrusted session names");
    assert.ok(!existsSync(out), "invalid CLI input cannot write an expense receipt");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ledger refuses redirected day and session parents, without modifying outside files", () => {
  const { dir, file } = transcript();
  try {
    const [record] = ingestAgentTranscript({ file, agent, claims, allowLaterPrices: true });
    const out = path.join(dir, "out"), external = path.join(dir, "external");
    mkdirSync(external);
    const sentinel = path.join(external, "abc123.jsonl");
    writeFileSync(sentinel, "original receipt");
    mkdirSync(out);
    symlinkSync(external, path.join(out, record.day), "dir");
    assert.throws(() => writeAgentExpenseRecords([record], out), /redirected/);
    assert.throws(() => writeExpenseRecords([record], out, record.day), /redirected/);
    rmSync(path.join(out, record.day));
    mkdirSync(path.join(out, record.day));
    symlinkSync(external, path.join(out, record.day, record.sessionId), "dir");
    assert.throws(() => writeAgentExpenseRecords([record], out), /redirected/);
    assert.throws(() => writeExpenseRecords([record], out, record.day), /redirected/);
    assert.equal(readFileSync(sentinel, "utf8"), "original receipt");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
