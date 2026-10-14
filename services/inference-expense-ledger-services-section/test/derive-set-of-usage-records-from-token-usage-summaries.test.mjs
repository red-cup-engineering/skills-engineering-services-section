import assert from "node:assert/strict";
import test from "node:test";
import { deriveSetOfUsageRecordsFromTokenUsageSummaries } from "../scripts/derive-set-of-usage-records-from-token-usage-summaries.mjs";

const baseTotal = { inputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };

test("adapts a single-model summary, folding reasoning output into output", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "anthropic",
        sessionId: "s1",
        source: "2026/09/04/session-s1.jsonl",
        observedAt: "2026-09-04T10:00:00.000Z",
        models: ["claude-sonnet-5"],
        total: { ...baseTotal, inputTokens: 1000000, outputTokens: 200000, reasoningOutputTokens: 5000, cacheReadInputTokens: 50000, cacheCreationInputTokens: 10000 },
      },
    ],
  });
  assert.equal(result.type, "InferenceUsageRecordAdaptationSet");
  assert.equal(result.usageRecordCount, 1);
  assert.equal(result.refusalCount, 0);
  const [record] = result.usageRecords;
  assert.equal(record.recordId, "s1#2026/09/04/session-s1.jsonl");
  assert.equal(record.provider, "anthropic");
  assert.equal(record.model, "claude-sonnet-5");
  assert.equal(record.timestamp, "2026-09-04T10:00:00.000Z");
  assert.equal(record.inputTokens, 1000000);
  assert.equal(record.outputTokens, 205000);
  assert.equal(record.cacheReadTokens, 50000);
  assert.equal(record.cacheCreationTokens, 10000);
});

test("refuses a summary with zero or multiple identified models", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      { kind: "metroplat.agent-session.token-usage-summary", provider: "openai", sessionId: "s2", source: "rollout-s2.jsonl", observedAt: "2026-08-26T10:47:29.000Z", models: [], total: baseTotal },
      { kind: "metroplat.agent-session.token-usage-summary", provider: "openai", sessionId: "s3", source: "rollout-s3.jsonl", observedAt: "2026-08-26T10:47:29.000Z", models: ["gpt-5-codex", "gpt-5"], total: baseTotal },
    ],
  });
  assert.equal(result.usageRecordCount, 0);
  assert.equal(result.refusalCount, 2);
  assert.equal(result.refusals[0].reason, "missing-model");
  assert.equal(result.refusals[1].reason, "ambiguous-model");
});

test("refuses a summary with non-zero generic cachedInputTokens rather than guessing its class", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "openai",
        sessionId: "s4",
        source: "rollout-s4.jsonl",
        observedAt: "2026-08-26T10:47:29.000Z",
        models: ["gpt-5-codex"],
        total: { ...baseTotal, inputTokens: 1799828, cachedInputTokens: 1686528 },
      },
    ],
  });
  assert.equal(result.usageRecordCount, 0);
  assert.equal(result.refusalCount, 1);
  assert.equal(result.refusals[0].reason, "ambiguous-cache-accounting");
});

test("refuses a malformed entry", () => {
  assert.throws(() => deriveSetOfUsageRecordsFromTokenUsageSummaries({ summaries: [{ kind: "wrong-kind" }] }), /kind must be/u);
  assert.throws(() => deriveSetOfUsageRecordsFromTokenUsageSummaries({ summaries: "not-an-array" }), /input.summaries must be an array/u);
});

test("takes model attribution from a summary's own turn events when present", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "anthropic",
        sessionId: "s5",
        source: "s5.jsonl",
        observedAt: "2026-09-05T10:00:00.000Z",
        models: [],
        total: { ...baseTotal, inputTokens: 9, outputTokens: 4420, cacheReadInputTokens: 18970, cacheCreationInputTokens: 5225 },
        events: [
          { model: "claude-haiku-4-5-20251001", usageKind: "turn", usage: { ...baseTotal, inputTokens: 9, outputTokens: 4420, cacheReadInputTokens: 18970, cacheCreationInputTokens: 5225 } },
          { model: "claude-haiku-4-5-20251001", usageKind: "duplicate", usage: { ...baseTotal, inputTokens: 9, outputTokens: 4420, cacheReadInputTokens: 18970, cacheCreationInputTokens: 5225 } },
        ],
      },
    ],
  });
  assert.equal(result.usageRecordCount, 1);
  assert.equal(result.refusalCount, 0);
  const [record] = result.usageRecords;
  assert.equal(record.recordId, "s5#s5.jsonl");
  assert.equal(record.model, "claude-haiku-4-5-20251001");
  assert.equal(record.inputTokens, 9);
  assert.equal(record.outputTokens, 4420);
  assert.equal(record.cacheReadTokens, 18970);
  assert.equal(record.cacheCreationTokens, 5225);
});

test("splits a session across models instead of refusing it, when its turn events name more than one billable model", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "anthropic",
        sessionId: "s6",
        source: "s6.jsonl",
        observedAt: "2026-09-05T10:00:00.000Z",
        models: ["claude-fable-5-1", "claude-opus-4-8"],
        total: { ...baseTotal, inputTokens: 1050, outputTokens: 224466, cacheReadInputTokens: 35947868, cacheCreationInputTokens: 587963 },
        events: [
          { model: "claude-opus-4-8", usageKind: "turn", usage: { ...baseTotal, inputTokens: 144, outputTokens: 159046, cacheReadInputTokens: 32549729, cacheCreationInputTokens: 292162 } },
          { model: "claude-fable-5-1", usageKind: "turn", usage: { ...baseTotal, inputTokens: 906, outputTokens: 65420, cacheReadInputTokens: 3398139, cacheCreationInputTokens: 295801 } },
        ],
      },
    ],
  });
  assert.equal(result.refusalCount, 0);
  assert.equal(result.usageRecordCount, 2);
  const byModel = Object.fromEntries(result.usageRecords.map((r) => [r.model, r]));
  assert.equal(byModel["claude-opus-4-8"].recordId, "s6#s6.jsonl#claude-opus-4-8");
  assert.equal(byModel["claude-opus-4-8"].inputTokens, 144);
  assert.equal(byModel["claude-fable-5-1"].inputTokens, 906);
  const totalInput = result.usageRecords.reduce((sum, r) => sum + r.inputTokens, 0);
  assert.equal(totalInput, 1050);
});

test("excludes a zero-usage <synthetic> event from model attribution, but keeps a non-zero one as its own group", () => {
  const zeroSynthetic = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "anthropic",
        sessionId: "s7",
        source: "s7.jsonl",
        observedAt: "2026-09-05T10:00:00.000Z",
        models: [],
        total: baseTotal,
        events: [
          { model: "<synthetic>", usageKind: "turn", usage: baseTotal },
          { model: "claude-sonnet-5", usageKind: "turn", usage: { ...baseTotal, inputTokens: 10 } },
        ],
      },
    ],
  });
  assert.equal(zeroSynthetic.usageRecordCount, 1);
  assert.equal(zeroSynthetic.usageRecords[0].model, "claude-sonnet-5");

  const nonZeroSynthetic = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "anthropic",
        sessionId: "s8",
        source: "s8.jsonl",
        observedAt: "2026-09-05T10:00:00.000Z",
        models: [],
        total: baseTotal,
        events: [{ model: "<synthetic>", usageKind: "turn", usage: { ...baseTotal, inputTokens: 5 } }],
      },
    ],
  });
  assert.equal(nonZeroSynthetic.usageRecordCount, 1);
  assert.equal(nonZeroSynthetic.usageRecords[0].model, "<synthetic>");
});

test("refuses a model group whose turn events carry non-zero generic cachedInputTokens", () => {
  const result = deriveSetOfUsageRecordsFromTokenUsageSummaries({
    summaries: [
      {
        kind: "metroplat.agent-session.token-usage-summary",
        provider: "openai",
        sessionId: "s9",
        source: "s9.jsonl",
        observedAt: "2026-09-05T10:00:00.000Z",
        models: [],
        total: baseTotal,
        events: [{ model: "gpt-5-codex", usageKind: "turn", usage: { ...baseTotal, inputTokens: 100, cachedInputTokens: 50 } }],
      },
    ],
  });
  assert.equal(result.usageRecordCount, 0);
  assert.equal(result.refusalCount, 1);
  assert.equal(result.refusals[0].reason, "ambiguous-cache-accounting");
  assert.equal(result.refusals[0].model, "gpt-5-codex");
});

test("refuses token counts above safe integer precision before pricing an untrustworthy quantity",()=>{
 const summary={
  kind:"metroplat.agent-session.token-usage-summary",provider:"provider",
  sessionId:"large",source:"test/unsafe",observedAt:"2026-10-13T20:00:00Z",
  models:["model"],total:{...baseTotal,inputTokens:Number.MAX_SAFE_INTEGER+1}
 };
 assert.throws(()=>deriveSetOfUsageRecordsFromTokenUsageSummaries({summaries:[summary]}),
  /non-negative safe integer/u);
});

test("refuses a multi-turn model aggregate that loses integer precision even when each turn is valid",()=>{
 const summary={
  kind:"metroplat.agent-session.token-usage-summary",provider:"provider",
  sessionId:"large",source:"test/turn-overflow",observedAt:"2026-10-13T20:00:00Z",
  models:["model"],total:baseTotal,events:[
   {model:"model",usageKind:"turn",usage:{...baseTotal,inputTokens:Number.MAX_SAFE_INTEGER}},
   {model:"model",usageKind:"turn",usage:{...baseTotal,inputTokens:1}}
  ]
 };
 assert.throws(()=>deriveSetOfUsageRecordsFromTokenUsageSummaries({summaries:[summary]}),
  /aggregate exceeds exact safe integer range/u);
});

test("refuses double-rounded output and reasoning quantities but retains exact boundary values",()=>{
 const summary={
  kind:"metroplat.agent-session.token-usage-summary",provider:"provider",
  sessionId:"large",source:"test/reasoning-overflow",observedAt:"2026-10-13T20:00:00Z",
  models:["model"],total:{...baseTotal,outputTokens:Number.MAX_SAFE_INTEGER,reasoningOutputTokens:1}
 };
 assert.throws(()=>deriveSetOfUsageRecordsFromTokenUsageSummaries({summaries:[summary]}),
  /output and reasoning usage exceeds exact safe integer range/u);
 summary.total={...baseTotal,outputTokens:Number.MAX_SAFE_INTEGER-1,reasoningOutputTokens:1};
 const accepted=deriveSetOfUsageRecordsFromTokenUsageSummaries({summaries:[summary]});
 assert.equal(accepted.usageRecords[0].outputTokens,Number.MAX_SAFE_INTEGER);
});
