import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decimalToMicros, microsToDecimal, tokenCostMicros } from "../src/decimal-money.mjs";
import { findPriceClaim, loadPriceClaims, priceTokens } from "../src/published-prices.mjs";
import { readClaudeTranscript, readCodexRollout } from "../src/session-transcripts.mjs";
import { ingestAgentSessions, writeExpenseRecords } from "../src/ingest.mjs";
import { contextBudgetReport, simulateHandoff } from "../src/context-budget.mjs";
import { appendAssignmentEvent, readAssignmentEvents, workCostRollup } from "../src/work-cost.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const claims = loadPriceClaims(path.join(here, "../data/records/2026-10-19-anthropic-published-prices.json"));
const scratch = () => mkdtempSync(path.join(tmpdir(), "agent-cost-ledger-"));

const assistant = (id, at, usage, model = "claude-sonnet-5-5") => JSON.stringify({ type: "assistant", timestamp: at, uuid: `u-${id}-${at}`, message: { id, model, content: [{ type: "text", text: "TOP-SECRET-CONTENT sk-ant-should-never-be-kept" }], usage } });
const usage = (input, write5m, write1h, read, output) => ({ input_tokens: input, cache_creation_input_tokens: write5m + write1h, cache_read_input_tokens: read, output_tokens: output, cache_creation: { ephemeral_5m_input_tokens: write5m, ephemeral_1h_input_tokens: write1h } });

function fixtureProject() {
  const dir = scratch();
  writeFileSync(path.join(dir, "sess-1.jsonl"), [
    assistant("m1", "2026-10-19T01:00:00.000Z", usage(2, 1000, 0, 0, 10), "claude-opus-5-5"),
    assistant("m1", "2026-10-19T01:00:00.100Z", usage(2, 1000, 0, 0, 40), "claude-opus-5-5"), // same API message: last row wins
    assistant("m2", "2026-10-19T01:01:00.000Z", usage(3, 0, 500, 1000, 20), "claude-opus-5-5"),
    assistant("m3", "2026-10-18T23:59:00.000Z", usage(1, 0, 0, 0, 1), "claude-opus-5-5"), // other day
    assistant("m4", "2026-10-19T02:00:00.000Z", usage(0, 0, 0, 0, 0), "<synthetic>"),
    JSON.stringify({ type: "user", message: { content: "password=hunter2" } }),
  ].join("\n") + "\n");
  mkdirSync(path.join(dir, "sess-1", "subagents"), { recursive: true });
  writeFileSync(path.join(dir, "sess-1", "subagents", "agent-abc123.jsonl"), assistant("s1", "2026-10-19T03:00:00.000Z", usage(10, 2000, 0, 5000, 100)) + "\n");
  writeFileSync(path.join(dir, "sess-1", "subagents", "agent-abc123.meta.json"), JSON.stringify({ agentType: "general-purpose", description: "Fix the thing", toolUseId: "toolu_X" }));
  return dir;
}

test("decimal money is exact and rounds once per component", () => {
  assert.equal(decimalToMicros("0.125"), 125_000n);
  assert.equal(microsToDecimal(125_000n), "0.125000");
  assert.equal(microsToDecimal(tokenCostMicros(1_000_000, "4")), "4.000000");
  assert.equal(microsToDecimal(tokenCostMicros(3, "0.20")), "0.000001"); // 0.6 micro rounds half up
  assert.throws(() => decimalToMicros("1e3"));
});

test("every published price is a measured claim with a source and a date", () => {
  assert.ok(claims.length >= 7);
  for (const claim of claims) {
    assert.equal(claim.epistemicStatus, "measured");
    assert.match(claim.source, /^https:\/\//u);
    assert.match(claim.observedAt, /^\d{4}-\d{2}-\d{2}$/u);
  }
  const opus = findPriceClaim(claims, { provider: "anthropic", model: "claude-opus-5-5", day: "2026-10-19" });
  assert.deepEqual(opus.usdPerMillionTokens, { input: "4", cacheWrite5m: "5", cacheWrite1h: "8", cacheRead: "0.20", output: "20" });
  const sonnet = findPriceClaim(claims, { provider: "anthropic", model: "claude-sonnet-5-5", day: "2026-10-19" });
  assert.equal(sonnet.usdPerMillionTokens.cacheRead, "0.10");
});

test("a price observed after the usage day is not used unless asked for", () => {
  assert.equal(findPriceClaim(claims, { provider: "anthropic", model: "claude-opus-5-5", day: "2026-10-18" }), null);
  assert.ok(findPriceClaim(claims, { provider: "anthropic", model: "claude-opus-5-5", day: "2026-10-18", allowLater: true }));
});

test("pricing a million of each class sums the published rates; an unpublished price never defaults", () => {
  const claim = findPriceClaim(claims, { provider: "anthropic", model: "claude-opus-5-5", day: "2026-10-19" });
  const million = { input: 1e6, cacheWrite5m: 1e6, cacheWrite1h: 1e6, cacheRead: 1e6, output: 1e6 };
  assert.equal(priceTokens(million, claim).costUsd.total, "37.200000");
  const fast = findPriceClaim(claims, { provider: "anthropic", model: "claude-opus-5-5", speed: "fast", day: "2026-10-19" });
  assert.equal(priceTokens({ input: 1e6, output: 1e6 }, fast).costUsd.total, "48.000000");
  assert.equal(priceTokens({ input: 1, cacheRead: 1 }, fast).priced, false);
  assert.equal(priceTokens(million, null).priced, false);
});

test("a transcript yields one request per API message and keeps no content", () => {
  const dir = fixtureProject();
  const requests = readClaudeTranscript(path.join(dir, "sess-1.jsonl"));
  assert.equal(requests.length, 3);
  assert.equal(requests[1].tokens.output, 40);
  assert.equal(requests.some((request) => request.model === "<synthetic>"), false);
  assert.doesNotMatch(JSON.stringify(requests), /SECRET|hunter2|sk-ant/u);
});

test("ingest writes priced records per session, agent and model for one UTC day", () => {
  const dir = fixtureProject();
  const { records } = ingestAgentSessions({ claudeProjects: [dir], claims, day: "2026-10-19", now: new Date("2026-10-19T12:00:00Z") });
  assert.equal(records.length, 2);
  const lead = records.find((record) => record.agent.role === "lead");
  assert.equal(lead.turns, 2);
  assert.deepEqual(lead.tokens, { input: 5, cacheWrite5m: 1000, cacheWrite1h: 500, cacheRead: 1000, output: 60 });
  assert.equal(lead.context.peak, 1503);
  // 5*4/1e6 + 1000*5/1e6 + 500*8/1e6 + 1000*0.20/1e6 + 60*20/1e6
  assert.equal(lead.costUsd.total, "0.010420");
  const sub = records.find((record) => record.agent.role === "subagent");
  assert.equal(sub.agent.id, "abc123");
  assert.equal(sub.agent.description, "Fix the thing");
  assert.equal(sub.agent.toolUseId, "toolu_X");
  assert.equal(sub.model, "claude-sonnet-5-5");
  assert.doesNotMatch(JSON.stringify(records), /SECRET|hunter2|sk-ant/u);
  const out = scratch();
  const files = writeExpenseRecords(records, out, "2026-10-19");
  assert.equal(files.length, 1);
  assert.equal(readFileSync(files[0], "utf8").trim().split("\n").length, 2);
});

test("a record's id is the address of its content", () => {
  const dir = fixtureProject();
  const first = ingestAgentSessions({ claudeProjects: [dir], claims, day: "2026-10-19", now: new Date("2026-10-19T12:00:00Z") }).records;
  const second = ingestAgentSessions({ claudeProjects: [dir], claims, day: "2026-10-19", now: new Date("2026-10-19T12:00:00Z") }).records;
  assert.deepEqual(first.map((record) => record.id), second.map((record) => record.id));
  assert.match(first[0].id, /^sha256:[0-9a-f]{64}$/u);
});

test("a Codex rollout is read as increases of its running total, unpriced for want of a claim", () => {
  const dir = scratch();
  const tokenCount = (at, input, cached, output) => JSON.stringify({ timestamp: at, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, total_tokens: input + output } } } });
  writeFileSync(path.join(dir, "rollout-x.jsonl"), [
    JSON.stringify({ timestamp: "2026-10-19T00:00:00.000Z", type: "session_meta", payload: { id: "cx-1" } }),
    JSON.stringify({ timestamp: "2026-10-19T00:00:01.000Z", type: "turn_context", payload: { model: "gpt-x" } }),
    tokenCount("2026-10-19T00:00:02.000Z", 100, 40, 10),
    tokenCount("2026-10-19T00:00:03.000Z", 100, 40, 10), // repeated total: not a new request
    tokenCount("2026-10-19T00:00:04.000Z", 250, 140, 30),
  ].join("\n") + "\n");
  const { sessionId, requests } = readCodexRollout(path.join(dir, "rollout-x.jsonl"));
  assert.equal(sessionId, "cx-1");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].tokens, { input: 50, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 100, output: 20 });
  const { records } = ingestAgentSessions({ claudeProjects: [], codexRoots: [dir], claims, day: "2026-10-19" });
  assert.equal(records[0].priced, false);
  assert.equal(records[0].provider, "openai");
});

function growingAgent(turns, perTurnGrowth, base = 20_000) {
  const requests = [];
  let context = base;
  for (let i = 0; i < turns; i += 1) {
    const growth = i === 0 ? base : perTurnGrowth;
    const read = i === 0 ? 0 : context;
    context = i === 0 ? base : context + growth;
    requests.push({ id: `r${i}`, at: `2026-10-19T00:${String(i % 60).padStart(2, "0")}:00.000Z`, model: "claude-opus-5-5", speed: "standard", cacheWriteUnsplit: 0, context, tokens: { input: 1, cacheWrite5m: 0, cacheWrite1h: growth, cacheRead: read, output: 200 } });
  }
  return requests;
}

test("a threshold the agent never reaches changes nothing", () => {
  const claim = findPriceClaim(claims, { provider: "anthropic", model: "claude-opus-5-5", day: "2026-10-19" });
  const result = simulateHandoff(growingAgent(50, 1000), claim, { thresholdTokens: 10_000_000, handoffTokens: 15_000 });
  assert.equal(result.handoffs, 0);
  assert.ok(Math.abs(Number(result.savedMicros)) < 50, `drift ${result.savedMicros}`);
});

test("ending a growing agent at the threshold costs less and bounds its context", () => {
  const claim = findPriceClaim(claims, { provider: "anthropic", model: "claude-opus-5-5", day: "2026-10-19" });
  const result = simulateHandoff(growingAgent(400, 2000), claim, { thresholdTokens: 200_000, handoffTokens: 15_000 });
  assert.ok(result.handoffs >= 3);
  assert.ok(result.savedMicros > 0n);
  assert.ok(result.peakVirtualContext <= 200_000 + 2000);
  assert.ok(result.peakActualContext > 700_000);
});

test("a window that starts above the threshold is reported not simulable, not guessed", () => {
  const claim = findPriceClaim(claims, { provider: "anthropic", model: "claude-opus-5-5", day: "2026-10-19" });
  const result = simulateHandoff(growingAgent(10, 1000, 250_000), claim, { thresholdTokens: 200_000, handoffTokens: 15_000 });
  assert.equal(result.simulable, false);
});

test("budget report puts over-budget agents first, dearest first", () => {
  const dir = fixtureProject();
  const { records } = ingestAgentSessions({ claudeProjects: [dir], claims, day: "2026-10-19" });
  const rows = contextBudgetReport(records, { budgetTokens: 1600 });
  assert.equal(rows[0].agentId, "abc123");
  assert.equal(rows[0].overBudget, true);
  assert.equal(rows[1].overBudget, false);
});

test("per-Work roll-up joins assignments to the ledger and names assignments it cannot match", () => {
  const dir = fixtureProject();
  const { records } = ingestAgentSessions({ claudeProjects: [dir], claims, day: "2026-10-19" });
  const journal = path.join(scratch(), "journal.jsonl");
  appendAssignmentEvent(journal, { event: "assigned", workId: "work:alpha", sessionId: "sess-1", agentId: "abc123", title: "Alpha" }, new Date("2026-10-19T03:00:00Z"));
  appendAssignmentEvent(journal, { event: "assigned", workId: "work:alpha", sessionId: "sess-1", toolUseId: "toolu_X" }, new Date("2026-10-19T03:00:01Z"));
  appendAssignmentEvent(journal, { event: "assigned", workId: "work:beta", sessionId: "sess-1", agentId: "gone" }, new Date("2026-10-19T03:01:00Z"));
  appendAssignmentEvent(journal, { event: "outcome", workId: "work:alpha", sessionId: "sess-1", agentId: "abc123", status: "done", summary: "merged" }, new Date("2026-10-19T04:00:00Z"));
  assert.throws(() => appendAssignmentEvent(journal, { event: "outcome", workId: "w", sessionId: "s", agentId: "a", status: "great" }));
  const rollup = workCostRollup(readAssignmentEvents(journal), records);
  const alpha = rollup.find((work) => work.workId === "work:alpha");
  assert.equal(alpha.status, "done");
  assert.equal(alpha.agents.length, 1); // agent id and tool-use id name the same record once
  assert.equal(alpha.turns, 1);
  const sub = records.find((record) => record.agent.id === "abc123");
  assert.equal(alpha.costUsd, sub.costUsd.total);
  const beta = rollup.find((work) => work.workId === "work:beta");
  assert.deepEqual(beta.unmatchedAssignments, ["gone"]);
  assert.equal(beta.status, "open");
});
