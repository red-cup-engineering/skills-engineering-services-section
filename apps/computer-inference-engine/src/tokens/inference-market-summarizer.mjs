// inference-market-summarizer.mjs — the sanctioned abstractive tier.
//
// This package never authors a provider call and never reaches for one by itself:
// it is a pure function from an explicitly-injected procurement capability to a
// summarizer. The caller supplies `contract` — bound to whatever the settlement's
// current real inference-contracting provider is (e.g.
// @red-cup-engineering/computer-inference-engine/dispatch's typed procurement) — at the
// composition boundary that actually wants the abstractive tier; this package
// declares no dependency on, and holds no default fallback to, any specific
// provider package, so a provider's rename, replacement, or decommission never
// requires a change here. A market refusal is surfaced as a throw, which
// compactWithSummary degrades to the extractive result: a summary is never
// fabricated, and provider failure never silently falls back to local invention.

export const MARKET_ACCEPTED = "candidate-pending-codex-acceptance";

export const DEFAULT_OBJECTIVE =
  "Produce a token-reduced compaction of the supplied agent-transcript segment, preserving accomplishments, work in progress, exact file paths, next steps, and unsoftened failures.";

/**
 * marketSummarizer({workType, objective, contract}) -> async (prompt) => summaryText
 * `contract` is a required, explicitly-injected procurement capability
 * (`async (input: {objective, context, workType}) => {outcome, candidate?, reason?}`) —
 * this function holds no default provider of its own.
 */
export function marketSummarizer({ workType = "summarization", objective = DEFAULT_OBJECTIVE, contract }) {
  if (typeof contract !== "function") throw new TypeError("marketSummarizer: contract capability is required (no default provider is held here)");
  return async (prompt) => {
    const result = await contract({ objective, context: String(prompt), workType });
    if (result?.outcome !== MARKET_ACCEPTED) {
      throw new Error(`inference market did not admit: ${result?.outcome ?? "no-outcome"}${result?.reason ? ` (${result.reason})` : ""}`);
    }
    return typeof result.candidate === "string" ? result.candidate : JSON.stringify(result.candidate);
  };
}
