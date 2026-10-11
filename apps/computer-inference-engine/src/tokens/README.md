# token-compactification-services-section

Deterministic, extractive-first, receipt-bearing compaction of LLM agent transcripts
under a derived context budget. `@red-cup-engineering/computer-inference-engine/tokens`
on the union private package registry.

In the Union's own energetic terms: compaction is **zeolitization** — raw transcript
prose prices the attention solvent; compacting it into structured, content-addressed
records buries that surface and releases the solvent back to the session (Energetics
of Civilizational Cognition corpus). The archive sidecar is the rigid phase; it is
never silently rewritten.

## Lineage

Ported from the swarm's `context-compaction.mjs` (frozen prior art under
`red-cup-engineering/src/content/assets/legacy/2026-06-17-archive.emsenn.net/.../swarm/src/`),
per the standing rule that legacy code is ported into `services/`, never extended in
place. Kept: the derived-budget discipline (no magic literals), content-addressed
idempotence, and the held-⊤ bar generalized as pinning. Replaced: summarize-first is
now extractive-first, on the evidence below.

## The doctrine, and where each rule comes from

1. **Extractive-first; mask, don't summarize.** Observation masking matches LLM
   summarization on SWE-bench Verified at ~52% lower cost, and summaries that soften
   failures *lengthen* trajectories (JetBrains, The Complexity Trap, arXiv 2508.21433).
   Dropped text is never hallucinated text (LLMLingua-2 line, arXiv 2403.12968).
2. **Pinning is structural.** System spans, user speech, and anything marked
   `pinned`/`contested` cannot enter a lossy path — not deprioritized, unreachable.
   In-context constraints silently dropped by compaction took policy violations from
   0% to 30%; quarantining them restored 0% (Governance Decay, arXiv 2606.22528).
   The behavioral corpus's pre-compact correction erasure is the same failure observed
   locally.
3. **Head and tail verbatim; pressure lands on the middle.** Attention sinks
   (StreamingLLM, arXiv 2309.17453) and the U-shaped position curve (Lost in the
   Middle) make the first and most recent spans disproportionately load-bearing.
4. **Stale oversized tool outputs mask first, biggest-oldest,** behind a recent
   tool-output guard (industry-converged numbers; OpenCode's shipped policy).
5. **Failure evidence survives verbatim.** Exit codes, error heads/tails outlive
   every pass — softened failures cause agent loops (Manus; Complexity Trap).
6. **Dedupe keeps the latest occurrence** (freshest file state) and back-references
   earlier copies.
7. **Prune order = recency-decay × lexical-relevance × role prior** (the Generative
   Agents formula), with common-word filtering as degenerate surprisal — an IDF-style
   prior under a unigram model. Terms come from
   `@lenticule-science/english-language-algebra/tag`'s `tokenize`.
8. **Layered and reversible.** Originals are never mutated; compaction is a view plus
   a content-addressed archive sidecar. Repeated compaction cannot collapse
   irrecoverably (context-collapse failure class).
9. **Summaries are narration, not authority.** A summary span is marked
   `authoritative: false` and says so in its text — the behavioral corpus's
   self-citation ratchet (a session quoting its own compaction back as law) is the
   named failure this blocks. File paths in evicted spans survive verbatim on the
   eviction ledger (lost-path failure class, same corpus).
10. **The abstractive tier is bought, not built, and its provider is never this
    package's concern.** `marketSummarizer({workType, objective, contract})` is a
    pure function from an explicitly-injected procurement capability (`contract`)
    to a summarizer; this package holds no default provider and declares no
    dependency on one. The caller binds `contract` to whatever the settlement's
    current real inference-contracting provider is (e.g.
    `@red-cup-engineering/computer-inference-engine/dispatch`'s typed procurement) at the
    composition boundary that wants the abstractive tier. A market refusal degrades
    to the extractive result; a summary is never fabricated. Pinned content is
    routed *around* the call, structurally.

## The erasure receipt (Obsmetrologia)

Every compaction is priced by `erasureReceipt`, on the corpus's proved machinery:

- `Ȟ¹ = cells − (entities − components)` — the incidence-Laplacian cokernel rank
  (`Obsmetrologia/Cohomology/CoordinationCohomology.lean:341-349`, sorry-free).
- `landauerBits N := N.H1rank`; `landauer_zero_iff_reversible`: bits = 0 iff the
  nerve is a forest (`Obsmetrologia/Cohomology/LandauerEntropy.lean:44,50-58`).
- `loadBearing N ↔ 0 < landauerBits N`
  (`ObsmetrologiaPhysicalScience/CondensedMatter/MatterTopology.lean:44-51`).

Our carrier is the **erasure nerve**: erased spans and their surviving witnesses as
vertices, witness links as cells. Every archived erasure keeps a witness, so a normal
compaction is a forest — 0 bits, `reversible: true`. Erasing with `archive: false`
is counted `irrecoverable`, never priced at zero.

Stated limits, per the corpus's own ledger: the bit-counting identification is the
machine-checked part; the physical `kT ln 2` scaling is analytic dressing the corpus
marks unproved, and the value-level converse (that a charged cycle defeats every
reordering) is an open frontier. This package cites the rank count and stops there.
The corpus defines no "yield k > 1" and none is claimed here.

## Use

```js
import {
  planCompaction, applyCompaction, compactWithSummary, deriveContextBudget,
} from "@red-cup-engineering/computer-inference-engine/tokens";
import { spansFromClaudeTranscript, parseTranscriptJsonl }
  from "@red-cup-engineering/computer-inference-engine/tokens/claude-transcript-adapter";
import { marketSummarizer }
  from "@red-cup-engineering/computer-inference-engine/tokens/inference-market-summarizer";

const spans = spansFromClaudeTranscript(parseTranscriptJsonl(jsonlText));
const plan = planCompaction(spans, { window: 200_000, query: latestUserMessage });
const { spans: compacted, archive, receipt } = applyCompaction(spans, plan);
// receipt: { landauerBits, reversible, irrecoverable, nerve }

// Optional abstractive tier: inject your own procurement capability, bound to
// whatever the settlement's current real inference-contracting provider is.
const result = await compactWithSummary(spans, {
  summarize: marketSummarizer({ contract: yourInferenceProcurementCapability }),
});
```

`npm run check && npm run test` (check + test) before calling a change done.
