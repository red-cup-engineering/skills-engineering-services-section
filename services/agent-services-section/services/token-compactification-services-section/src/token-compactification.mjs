// token-compactification.mjs — deterministic, extractive-first compaction of an agent
// transcript under a DERIVED context budget, emitting a layered (reversible) result and
// an Obsmetrologia erasure receipt.
//
// Lineage: ported from the swarm's context-compaction.mjs (frozen prior art at
// lib/emsenn/services/561-group/services/red-cup-engineering/src/content/assets/legacy/
// 2026-06-17-archive.emsenn.net/dev/ref/src/from-content-source/apps/tools/swarm/src/).
// Kept from it: the derived-budget discipline (no magic literal — the budget is computed
// from the window), content-addressed idempotence, and the held-⊤ rule generalized as
// PINNING: pinned spans are STRUCTURALLY BARRED from every lossy path, never merely
// deprioritized. Replaced from it: summarize-first is now extractive-first (mask, don't
// summarize), per the evidence base in README.md.
//
// The pipeline, in forced order (cheapest, least lossy first):
//   0. no-op            — under budget: every span keeps, nothing is touched.
//   1. dedupe           — identical content: earlier copies point at the latest (freshest
//                         file state wins), which remains verbatim.
//   2. mask tool output — stale oversized tool results become structured placeholders that
//                         PRESERVE THE OUTCOME SIGNAL: exit/error status, size, and the
//                         head/tail lines of an error, verbatim.
//   3. evict            — lowest-scoring middle spans move to the archive sidecar, replaced
//                         by one boundary ledger line.
// Head (attention sink) and tail (recency) are verbatim; all pressure lands on the middle.
// The original spans are never mutated: compaction is a VIEW plus an ARCHIVE, so repeated
// compaction cannot collapse irrecoverably.

import { createHash } from "node:crypto";

import { tokenize } from "@lenticule-science/english-language-algebra/tag";

import { erasureReceipt } from "./erasure-nerve.mjs";

// Every bound is a NAMED default, never a literal buried in the math. Overridable.
export const COMPACTION_DEFAULTS = Object.freeze({
  window: 200_000, // tokens — declared fallback for a Claude-class window; override per model.
  reserveRatio: 0.6, // share of the window the assembled context may fill; the rest is the reply's.
  charsPerToken: 4, // DECLARED estimate (token ≈ 4 chars) — an approximation, not structural truth.
  keptHeadCount: 2, // attention-sink head: the first N spans are never touched (StreamingLLM).
  keptTailRatio: 0.35, // share of the budget reserved for the verbatim recent tail.
  toolOutputTailGuardChars: 160_000, // recent tool output protected from masking (~40k tokens).
  oversizeToolOutputChars: 80_000, // beyond the guard, outputs above this mask first (~20k tokens).
  errorEdgeLines: 5, // head/tail lines of an error output preserved verbatim inside a mask.
  recencyHalfLife: 40, // spans; exponential-decay recency for prune scoring.
});

// Role priors for prune scoring: what to sacrifice first when spans are otherwise equal.
// User speech is pinned outright (see isPinned) — the prior exists for completeness.
export const ROLE_PRIORS = Object.freeze({
  user: 1,
  system: 1,
  assistant: 0.5,
  tool_result: 0.2,
  harness: 0.1,
  placeholder: 0.1,
});

export function contentHashOf(span) {
  return createHash("sha256").update(`${span.kind}\n${span.text}`).digest("hex");
}

/**
 * budget = floor(window * reserveRatio * charsPerToken) — a CHARACTER cap, computed,
 * never a literal. (Ported doctrine; the legacy module derived it identically.)
 */
export function deriveContextBudget(opts = {}) {
  const window = Number.isFinite(Number(opts.window)) && Number(opts.window) > 0 ? Number(opts.window) : COMPACTION_DEFAULTS.window;
  const reserveRatio = Number.isFinite(Number(opts.reserveRatio)) ? Number(opts.reserveRatio) : COMPACTION_DEFAULTS.reserveRatio;
  const charsPerToken = Number.isFinite(Number(opts.charsPerToken)) ? Number(opts.charsPerToken) : COMPACTION_DEFAULTS.charsPerToken;
  return { budget: Math.floor(window * reserveRatio * charsPerToken), window, reserveRatio, charsPerToken };
}

/**
 * Pinned spans are structurally quarantined from every lossy operation. Default pins:
 * system spans, user speech, and anything marked pinned or contested. This is the
 * Constraint-Pinning result (Governance Decay, arXiv 2606.22528: 30% → 0% violations)
 * and the legacy held-⊤ bar, as one rule.
 */
export function isPinned(span) {
  return span.kind === "system" || span.kind === "user" || span.meta?.pinned === true || span.meta?.contested === true;
}

function normalizeSpans(spans) {
  if (!Array.isArray(spans) || spans.length === 0) throw new TypeError("spans must be a non-empty array");
  return spans.map((span, index) => {
    if (!span || typeof span.text !== "string" || typeof span.kind !== "string") {
      throw new TypeError(`span[${index}] needs {kind, text}`);
    }
    return {
      id: typeof span.id === "string" && span.id ? span.id : `s${index}`,
      kind: span.kind,
      text: span.text,
      meta: span.meta ?? {},
      index,
      hash: contentHashOf(span),
    };
  });
}

// Terms come from Lenticule Science's own english-language-algebra tokenizer —
// the settlement's linguistics instrument, not a freelance regex.
export function words(query) {
  return [...new Set(tokenize(String(query ?? "")).map((w) => w.toLowerCase()).filter((w) => w.length >= 3))];
}

/**
 * Prune priority = recency-decay × lexical-relevance-to-query × role prior — the
 * Generative Agents retrieval formula (Park et al. 2023) with an IDF-degenerate
 * surprisal term: opts.commonWords (a Set — e.g. the Basic English 850 record held by
 * Lenticule Science) removes zero-information terms before relevance is measured.
 * LOWER score prunes FIRST.
 */
export function pruneScore(span, { total, terms = [], commonWords, halfLife = COMPACTION_DEFAULTS.recencyHalfLife } = {}) {
  const recency = Math.exp(-((total - 1 - span.index) / Math.max(1, halfLife)));
  const informative = commonWords ? terms.filter((t) => !commonWords.has(t)) : terms;
  const lower = span.text.toLowerCase();
  const overlap = informative.length ? informative.filter((t) => lower.includes(t)).length / informative.length : 0;
  const prior = ROLE_PRIORS[span.kind] ?? 0.3;
  const errorBoost = span.meta?.isError || (span.meta?.exitCode != null && span.meta.exitCode !== 0) ? 2 : 1;
  return recency * (0.25 + overlap) * prior * errorBoost;
}

function maskPlaceholder(span, archiveId, edgeLines) {
  const lines = span.text.split("\n");
  const isError = span.meta?.isError === true || (span.meta?.exitCode != null && span.meta.exitCode !== 0);
  const status = span.meta?.exitCode != null ? `exit ${span.meta.exitCode}` : isError ? "errored" : "ok";
  const header = `[tool output masked: ${span.text.length} chars, ${lines.length} lines, ${status}; sha256:${span.hash.slice(0, 12)}; archived ${archiveId}]`;
  if (!isError) return header;
  // Failure evidence survives every pass, verbatim — softened failures cause agent loops.
  const head = lines.slice(0, edgeLines);
  const tail = lines.length > edgeLines * 2 ? lines.slice(-edgeLines) : lines.slice(edgeLines);
  return [header, ...head, tail.length ? `[… ${Math.max(0, lines.length - edgeLines * 2)} lines archived …]` : "", ...tail]
    .filter(Boolean)
    .join("\n");
}

/**
 * planCompaction(spans, opts) -> a deterministic, inspectable PLAN: one operation per
 * span ({op: keep|dedupe|mask|evict, …}), plus measurements. Nothing is applied here.
 * Content-addressed archive ids make replanning the same input byte-identical.
 */
export function planCompaction(rawSpans, opts = {}) {
  const spans = normalizeSpans(rawSpans);
  const defaults = COMPACTION_DEFAULTS;
  const budget = Number.isFinite(Number(opts.budget)) ? Number(opts.budget) : deriveContextBudget(opts).budget;
  const keptHeadCount = Number.isFinite(Number(opts.keptHeadCount)) ? Number(opts.keptHeadCount) : defaults.keptHeadCount;
  const keptTailRatio = Number.isFinite(Number(opts.keptTailRatio)) ? Number(opts.keptTailRatio) : defaults.keptTailRatio;
  const tailGuard = Number.isFinite(Number(opts.toolOutputTailGuardChars)) ? Number(opts.toolOutputTailGuardChars) : defaults.toolOutputTailGuardChars;
  const oversize = Number.isFinite(Number(opts.oversizeToolOutputChars)) ? Number(opts.oversizeToolOutputChars) : defaults.oversizeToolOutputChars;
  const edgeLines = Number.isFinite(Number(opts.errorEdgeLines)) ? Number(opts.errorEdgeLines) : defaults.errorEdgeLines;
  const pinned = opts.isPinned ?? isPinned;
  const terms = words(opts.query);

  const measuredBefore = spans.reduce((sum, s) => sum + s.text.length, 0);
  const ops = new Map(spans.map((s) => [s.id, { op: "keep", id: s.id }]));
  const plan = (needsCompaction) => {
    const opList = spans.map((s) => ops.get(s.id));
    const measuredAfter = spans.reduce((sum, s) => {
      const op = ops.get(s.id);
      if (op.op === "keep") return sum + s.text.length;
      if (op.op === "evict") return sum;
      return sum + op.placeholder.length;
    }, 0);
    return Object.freeze({
      id: createHash("sha256").update(JSON.stringify([spans[0].hash, spans[spans.length - 1].hash, budget])).digest("hex").slice(0, 16),
      needsCompaction,
      budget,
      measuredBefore,
      measuredAfter,
      unmet: measuredAfter > budget,
      ops: Object.freeze(opList),
    });
  };
  if (measuredBefore <= budget) return plan(false);

  // The protected set: head + pinned + verbatim recent tail. All pressure is middle-only.
  const protectedIds = new Set(spans.slice(0, keptHeadCount).map((s) => s.id));
  for (const s of spans) if (pinned(s)) protectedIds.add(s.id);
  const tailBudget = Math.floor(budget * keptTailRatio);
  let tailUsed = 0;
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    if (tailUsed > 0 && tailUsed + spans[i].text.length > tailBudget) break;
    tailUsed += spans[i].text.length;
    protectedIds.add(spans[i].id);
  }
  const middle = spans.filter((s) => !protectedIds.has(s.id));
  const over = () => plan(true).measuredAfter > budget;

  // Pass 1 — dedupe: identical content keeps its LATEST occurrence; earlier middle copies
  // become references to it. Freshest file state wins; the witness stays verbatim.
  const latestByHash = new Map();
  for (const s of spans) latestByHash.set(s.hash, s);
  for (const s of middle) {
    const latest = latestByHash.get(s.hash);
    if (latest.id !== s.id) {
      ops.set(s.id, { op: "dedupe", id: s.id, witness: latest.id, placeholder: `[duplicate of ${latest.id} (sha256:${s.hash.slice(0, 12)}) masked]` });
    }
  }

  // Pass 2 — mask stale oversized tool outputs, biggest-oldest first, sparing everything
  // within the recent tool-output guard.
  let guardUsed = 0;
  const guarded = new Set();
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    if (spans[i].kind !== "tool_result") continue;
    if (guardUsed >= tailGuard) break;
    guardUsed += spans[i].text.length;
    guarded.add(spans[i].id);
  }
  const maskable = middle
    .filter((s) => s.kind === "tool_result" && !guarded.has(s.id) && ops.get(s.id).op === "keep")
    .sort((a, b) => b.text.length - a.text.length || a.index - b.index);
  for (const s of maskable) {
    if (!over()) break;
    if (s.text.length < oversize && !over()) break;
    const archiveId = `a-${s.hash.slice(0, 16)}`;
    ops.set(s.id, { op: "mask", id: s.id, archiveId, placeholder: maskPlaceholder(s, archiveId, edgeLines) });
  }

  // Pass 3 — evict lowest-scoring middle spans until the budget settles or nothing lossy
  // remains. Pinned spans never reached this list; that is structural, not a preference.
  const evictable = middle
    .filter((s) => ops.get(s.id).op === "keep")
    .map((s) => ({ s, score: pruneScore(s, { total: spans.length, terms, commonWords: opts.commonWords }) }))
    .sort((a, b) => a.score - b.score || a.s.index - b.s.index);
  for (const { s } of evictable) {
    if (!over()) break;
    ops.set(s.id, { op: "evict", id: s.id, archiveId: `a-${s.hash.slice(0, 16)}` });
  }
  return plan(true);
}

/**
 * applyCompaction(spans, plan) -> { spans, archive, links, receipt }
 * The original spans are untouched; the result is a layered view. Every lossy operation
 * archives its full span (the reversibility witness) and contributes a link to the
 * erasure nerve; the receipt prices the compaction in proved Landauer bits (0 ⟺ every
 * erasure is recoverable from what survives — see src/erasure-nerve.mjs).
 * Consecutive evictions collapse into one boundary ledger line.
 */
export function applyCompaction(rawSpans, plan, opts = {}) {
  const spans = normalizeSpans(rawSpans);
  const byId = new Map(plan.ops.map((op) => [op.id, op]));
  const archive = [];
  const links = [];
  const out = [];
  let pendingEvictions = [];
  const flushEvictions = () => {
    if (!pendingEvictions.length) return;
    // Lost file paths are a named erasure casualty (Claude behavioral corpus,
    // 2026-07-30): sessions re-ran commands against stale paths after compaction.
    // Paths in evicted text survive verbatim on the ledger line.
    const paths = [...new Set(pendingEvictions.flatMap((p) => p.paths))].slice(0, 12);
    out.push({
      id: `ledger-${pendingEvictions[0].id}`,
      kind: "placeholder",
      text:
        `[compacted: ${pendingEvictions.length} spans evicted to archive: ${pendingEvictions.map((p) => p.archiveId).join(", ")}` +
        `${paths.length ? `; paths mentioned: ${paths.join(" ")}` : ""}]`,
      meta: { op: "evict-ledger" },
    });
    pendingEvictions = [];
  };
  const pathsIn = (text) => text.match(/(?:^|[\s"'`(=])((?:\.{0,2}\/)?(?:[\w.@-]+\/){2,}[\w.@-]+)/gmu)?.map((m) => m.replace(/^[\s"'`(=]+/u, "")) ?? [];
  for (const span of spans) {
    const op = byId.get(span.id) ?? { op: "keep" };
    if (op.op === "keep") {
      flushEvictions();
      out.push({ id: span.id, kind: span.kind, text: span.text, meta: span.meta });
    } else if (op.op === "dedupe") {
      flushEvictions();
      links.push({ erased: span.id, witness: op.witness });
      out.push({ id: span.id, kind: "placeholder", text: op.placeholder, meta: { op: "dedupe", witness: op.witness } });
    } else if (op.op === "mask") {
      flushEvictions();
      if (opts.archive !== false) archive.push({ archiveId: op.archiveId, span: { id: span.id, kind: span.kind, text: span.text, meta: span.meta } });
      links.push({ erased: span.id, witness: opts.archive === false ? null : op.archiveId });
      out.push({ id: span.id, kind: "placeholder", text: op.placeholder, meta: { op: "mask", archiveId: op.archiveId } });
    } else if (op.op === "evict") {
      if (opts.archive !== false) archive.push({ archiveId: op.archiveId, span: { id: span.id, kind: span.kind, text: span.text, meta: span.meta } });
      links.push({ erased: span.id, witness: opts.archive === false ? null : op.archiveId });
      pendingEvictions.push({ id: span.id, archiveId: op.archiveId, paths: pathsIn(span.text) });
    }
  }
  flushEvictions();
  // Recitation: spans marked meta.recite (a live plan/todo) move to the tail verbatim,
  // the recency-favored position (Manus recitation).
  const recited = out.filter((s) => s.meta?.recite === true);
  const rest = out.filter((s) => s.meta?.recite !== true);
  return { spans: [...rest, ...recited], archive, links, receipt: erasureReceipt(links) };
}

/**
 * The optional abstractive tier. Extractive work happens FIRST and stands alone; the
 * summarizer (an injected async fn — this package never authors a provider call) only
 * narrates what was already archived, and PINNED CONTENT IS ROUTED AROUND THE CALL —
 * it is not in the input, so no summarizer defect can erode it. A summarizer failure
 * degrades to the extractive result; a summary is never fabricated.
 */
export const SUMMARY_INSTRUCTION =
  "Summarize this archived transcript segment for an agent resuming work. Preserve, in order: " +
  "what was accomplished; what is in progress; exact file paths involved; next steps; open failures " +
  "with their error text. Do not restate system rules or user constraints (they survive verbatim elsewhere). " +
  "Do not soften failures.";

export async function compactWithSummary(rawSpans, opts = {}) {
  const plan = planCompaction(rawSpans, opts);
  const applied = applyCompaction(rawSpans, plan, opts);
  if (!plan.needsCompaction || typeof opts.summarize !== "function" || applied.archive.length === 0) {
    return { ...applied, plan, summary: null };
  }
  const archivedText = applied.archive.map((entry) => `${entry.span.kind}: ${entry.span.text}`).join("\n");
  try {
    const summary = String(await opts.summarize(`${SUMMARY_INSTRUCTION}\n\n${archivedText}`));
    const keptHeadCount = Number.isFinite(Number(opts.keptHeadCount)) ? Number(opts.keptHeadCount) : COMPACTION_DEFAULTS.keptHeadCount;
    const spans = [...applied.spans];
    // The self-citation ratchet (Claude behavioral corpus): a summary read back as
    // authority becomes fake law. The span says what it is, and is never pinnable.
    spans.splice(Math.min(keptHeadCount, spans.length), 0, {
      id: `summary-${plan.id}`,
      kind: "placeholder",
      text: `[compacted summary — a derived narrative, not a record of authority; originals in archive of plan ${plan.id}] ${summary}`,
      meta: { op: "summary", planId: plan.id, authoritative: false },
    });
    return { ...applied, spans, plan, summary };
  } catch (error) {
    return { ...applied, plan, summary: null, summaryError: error?.message ?? "summarize-failed" };
  }
}
