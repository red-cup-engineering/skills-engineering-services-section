import assert from "node:assert/strict";
import test from "node:test";
import { MARKET_ACCEPTED, marketSummarizer } from "../../src/tokens/inference-market-summarizer.mjs";
import { compactWithSummary } from "../../src/tokens/token-compactification.mjs";

test("an admitted market candidate becomes the summary text", async () => {
  const calls = [];
  const summarize = marketSummarizer({
    contract: async (input) => {
      calls.push(input);
      return { outcome: MARKET_ACCEPTED, candidate: "compacted narrative" };
    },
  });
  assert.equal(await summarize("older text"), "compacted narrative");
  assert.equal(calls[0].workType, "summarization");
  assert.equal(calls[0].context, "older text");
});

test("a market refusal throws the typed outcome — never a fabricated summary", async () => {
  const summarize = marketSummarizer({
    contract: async () => ({ outcome: "refused", reason: "no admitted provider" }),
  });
  await assert.rejects(summarize("text"), /did not admit: refused \(no admitted provider\)/u);
});

test("through compactWithSummary, a refusal degrades to the extractive result", async () => {
  const spans = [
    { id: "sys", kind: "system", text: "law" },
    { id: "u1", kind: "user", text: "go" },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, kind: "assistant", text: `filler ${i} ${"pad".repeat(25)}` })),
    { id: "u2", kind: "user", text: "done" },
  ];
  const result = await compactWithSummary(spans, {
    budget: 250,
    keptTailRatio: 0.2,
    summarize: marketSummarizer({ contract: async () => ({ outcome: "refused" }) }),
  });
  assert.equal(result.summary, null);
  assert.match(result.summaryError, /did not admit/u);
  assert.ok(result.spans.length > 0);
});
