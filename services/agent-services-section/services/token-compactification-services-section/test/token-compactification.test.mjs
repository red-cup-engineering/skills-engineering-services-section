import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPACTION_DEFAULTS,
  applyCompaction,
  compactWithSummary,
  contentHashOf,
  deriveContextBudget,
  isPinned,
  planCompaction,
  pruneScore,
} from "../src/token-compactification.mjs";

const span = (id, kind, text, meta = {}) => ({ id, kind, text, meta });

function transcript({ noisy = 6 } = {}) {
  const spans = [
    span("sys", "system", "You are the settlement's agent. LAW: never touch data/ by hand."),
    span("u1", "user", "Fix the retrieval module; the constraint is: never delete the ledger."),
    span("a1", "assistant", "Reading the module now."),
    span("big-ok", "tool_result", `${"x".repeat(400)}\nfinal line ok`, { exitCode: 0 }),
    span("err", "tool_result", ["Error: ENOENT /lib/services/foo/bar.mjs", "at readFileSync", "at main", "deep frame", "deeper frame", "more", "even more", "last frame"].join("\n"), { exitCode: 1 }),
    span("dup1", "tool_result", "identical file contents"),
  ];
  for (let i = 0; i < noisy; i += 1) spans.push(span(`noise${i}`, "assistant", `intermediate narration ${i} ${"pad".repeat(30)}`));
  spans.push(span("dup2", "tool_result", "identical file contents"));
  spans.push(span("u2", "user", "Now wire it into the registry."));
  spans.push(span("a-last", "assistant", "Wiring it in."));
  return spans;
}

test("the budget is computed from the window, never a literal", () => {
  const { budget } = deriveContextBudget({ window: 1000, reserveRatio: 0.5, charsPerToken: 4 });
  assert.equal(budget, 2000);
  const defaulted = deriveContextBudget();
  assert.equal(defaulted.budget, Math.floor(COMPACTION_DEFAULTS.window * COMPACTION_DEFAULTS.reserveRatio * COMPACTION_DEFAULTS.charsPerToken));
});

test("under budget, compaction is a structural no-op", () => {
  const spans = transcript();
  const plan = planCompaction(spans, { budget: 1_000_000 });
  assert.equal(plan.needsCompaction, false);
  assert.ok(plan.ops.every((op) => op.op === "keep"));
  const { spans: out, receipt } = applyCompaction(spans, plan);
  assert.equal(out.length, spans.length);
  assert.equal(receipt.landauerBits, 0);
  assert.equal(receipt.reversible, true);
});

test("pinned spans are structurally barred from every lossy operation", () => {
  const spans = transcript({ noisy: 12 });
  const plan = planCompaction(spans, { budget: 300, keptTailRatio: 0.2 });
  assert.equal(plan.needsCompaction, true);
  for (const op of plan.ops) {
    const source = spans.find((s) => s.id === op.id);
    if (source && isPinned(source)) assert.equal(op.op, "keep", `${op.id} is pinned and must keep`);
  }
});

test("head and tail stay verbatim; pressure lands on the middle", () => {
  const spans = transcript({ noisy: 12 });
  const plan = planCompaction(spans, { budget: 400, keptHeadCount: 2, keptTailRatio: 0.2 });
  assert.equal(plan.ops[0].op, "keep");
  assert.equal(plan.ops[1].op, "keep");
  assert.equal(plan.ops[plan.ops.length - 1].op, "keep");
  assert.ok(plan.ops.some((op) => op.op !== "keep"), "middle took the pressure");
});

test("masking preserves the outcome signal and error edges verbatim", () => {
  const spans = transcript();
  const plan = planCompaction(spans, { budget: 250, keptTailRatio: 0.1, toolOutputTailGuardChars: 0, oversizeToolOutputChars: 100 });
  const errOp = plan.ops.find((op) => op.id === "err");
  if (errOp?.op === "mask") {
    assert.match(errOp.placeholder, /exit 1/u);
    assert.match(errOp.placeholder, /Error: ENOENT \/lib\/services\/foo\/bar\.mjs/u, "error head survives verbatim");
  }
  const bigOp = plan.ops.find((op) => op.id === "big-ok");
  assert.equal(bigOp.op, "mask");
  assert.match(bigOp.placeholder, /exit 0/u);
  assert.match(bigOp.placeholder, /sha256:/u);
});

test("dedupe keeps the latest occurrence and back-references it", () => {
  const spans = transcript({ noisy: 10 });
  const plan = planCompaction(spans, { budget: 350, keptTailRatio: 0.9 });
  const dup1 = plan.ops.find((op) => op.id === "dup1");
  assert.equal(dup1.op, "dedupe");
  assert.equal(dup1.witness, "dup2");
  const dup2 = plan.ops.find((op) => op.id === "dup2");
  assert.equal(dup2.op, "keep", "the freshest copy stays verbatim");
});

test("planning is deterministic and content-addressed: same input, same plan", () => {
  const spans = transcript({ noisy: 10 });
  const a = planCompaction(spans, { budget: 300 });
  const b = planCompaction(spans, { budget: 300 });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(a.id, b.id);
});

test("every archived erasure is witnessed: landauerBits 0, reversible", () => {
  const spans = transcript({ noisy: 14 });
  const plan = planCompaction(spans, { budget: 300, keptTailRatio: 0.2 });
  const { receipt, archive, links } = applyCompaction(spans, plan);
  assert.ok(links.length > 0, "something was erased");
  assert.equal(receipt.landauerBits, 0);
  assert.equal(receipt.reversible, true);
  assert.equal(receipt.irrecoverable.length, 0);
  for (const entry of archive) assert.ok(entry.span.text.length > 0, "the archive holds the full span");
});

test("archive:false is priced honestly — irrecoverable, not reversible", () => {
  const spans = transcript({ noisy: 14 });
  const plan = planCompaction(spans, { budget: 300, keptTailRatio: 0.2 });
  const { receipt } = applyCompaction(spans, plan, { archive: false });
  assert.equal(receipt.reversible, false);
  assert.ok(receipt.irrecoverable.length > 0);
});

test("file paths in evicted spans survive on the eviction ledger", () => {
  const spans = [
    span("sys", "system", "law"),
    span("u1", "user", "go"),
    span("evictme", "assistant", `working on lib/services/foo/bar.mjs today ${"pad".repeat(40)}`),
    ...Array.from({ length: 10 }, (_, i) => span(`n${i}`, "assistant", `filler ${i} ${"pad".repeat(20)}`)),
    span("u2", "user", "done"),
  ];
  const plan = planCompaction(spans, { budget: 200, keptTailRatio: 0.15, keptHeadCount: 1 });
  const { spans: out } = applyCompaction(spans, plan);
  const evicted = plan.ops.find((op) => op.id === "evictme");
  if (evicted.op === "evict") {
    const ledger = out.find((s) => s.meta?.op === "evict-ledger" && s.text.includes("lib/services/foo/bar.mjs"));
    assert.ok(ledger, "the ledger names the path verbatim");
  } else {
    assert.ok(["keep", "mask", "dedupe"].includes(evicted.op));
  }
});

test("recited spans move to the tail verbatim", () => {
  const spans = [...transcript(), span("plan", "assistant", "TODO: 1) adapter 2) tests", { recite: true })];
  const compactionPlan = planCompaction(spans, { budget: 1_000_000 });
  const { spans: out } = applyCompaction(spans, compactionPlan);
  assert.equal(out[out.length - 1].id, "plan");
});

test("the summarizer narrates the archive, never sees pinned text, cannot fabricate", async () => {
  const spans = transcript({ noisy: 14 });
  let seen = null;
  const result = await compactWithSummary(spans, {
    budget: 300,
    keptTailRatio: 0.2,
    summarize: async (prompt) => {
      seen = prompt;
      return "older work archived";
    },
  });
  if (result.summary) {
    assert.ok(seen, "summarizer was called");
    assert.doesNotMatch(seen, /never delete the ledger/u, "pinned user constraint routed AROUND the call");
    assert.doesNotMatch(seen, /LAW: never touch data/u, "system law routed AROUND the call");
    const summarySpan = result.spans.find((s) => s.meta?.op === "summary");
    assert.equal(summarySpan.meta.authoritative, false);
    assert.match(summarySpan.text, /not a record of authority/u);
  }
  const failed = await compactWithSummary(spans, {
    budget: 300,
    keptTailRatio: 0.2,
    summarize: async () => {
      throw new Error("provider down");
    },
  });
  assert.equal(failed.summary, null);
  assert.equal(failed.summaryError, "provider down");
  assert.ok(failed.spans.length > 0, "extractive result stands without the model");
});

test("prune scoring favors recency, relevance, and errors; commonWords is degenerate surprisal", () => {
  const total = 100;
  const old = { index: 10, kind: "assistant", text: "retrieval module work", meta: {} };
  const recent = { index: 95, kind: "assistant", text: "retrieval module work", meta: {} };
  assert.ok(pruneScore(recent, { total }) > pruneScore(old, { total }));
  const err = { index: 50, kind: "tool_result", text: "boom", meta: { exitCode: 1 } };
  const ok = { index: 50, kind: "tool_result", text: "boom", meta: { exitCode: 0 } };
  assert.ok(pruneScore(err, { total }) > pruneScore(ok, { total }));
  const terms = ["the", "retrieval"];
  const common = new Set(["the"]);
  const relevant = { index: 50, kind: "assistant", text: "retrieval only", meta: {} };
  assert.ok(
    pruneScore(relevant, { total, terms, commonWords: common }) > pruneScore(relevant, { total, terms: ["the"], commonWords: common }),
    "a common word contributes no relevance",
  );
});

test("contentHashOf is stable over kind and text", () => {
  assert.equal(contentHashOf({ kind: "a", text: "b" }), contentHashOf({ kind: "a", text: "b" }));
  assert.notEqual(contentHashOf({ kind: "a", text: "b" }), contentHashOf({ kind: "c", text: "b" }));
});
