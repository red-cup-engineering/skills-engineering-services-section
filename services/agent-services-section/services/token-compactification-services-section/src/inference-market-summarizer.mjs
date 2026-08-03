// inference-market-summarizer.mjs — the sanctioned abstractive tier.
//
// This package never authors a provider call. The summarizer is BOUGHT on the
// settlement's own inference-work-lot-market — the same `contractCodexInferenceWork`
// route the compacting-a-markdown-document skill has already proven — via the market
// package's declared export. A market refusal is surfaced as a throw, which
// compactWithSummary degrades to the extractive result: a summary is never fabricated,
// and provider failure never silently falls back to local invention.

export const MARKET_ACCEPTED = "candidate-pending-codex-acceptance";

export const DEFAULT_OBJECTIVE =
  "Produce a token-reduced compaction of the supplied agent-transcript segment, preserving accomplishments, work in progress, exact file paths, next steps, and unsoftened failures.";

/**
 * marketSummarizer({workType, objective, contract}?) -> async (prompt) => summaryText
 * `contract` is injectable for tests; by default the market package is imported
 * lazily so the deterministic core never pays for it.
 */
export function marketSummarizer({ workType = "summarization", objective = DEFAULT_OBJECTIVE, contract } = {}) {
  return async (prompt) => {
    const contractFn =
      contract ?? (await import("@red-cup-engineering/inference-work-lot-service/codex-inference-market")).contractCodexInferenceWork;
    const result = await contractFn({ objective, context: String(prompt), workType });
    if (result?.outcome !== MARKET_ACCEPTED) {
      throw new Error(`inference market did not admit: ${result?.outcome ?? "no-outcome"}${result?.reason ? ` (${result.reason})` : ""}`);
    }
    return typeof result.candidate === "string" ? result.candidate : JSON.stringify(result.candidate);
  };
}
