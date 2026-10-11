import { applyCompaction, deriveContextBudget, planCompaction } from "@red-cup-engineering/computer-inference-engine/tokens/token-compactification";

function packetSpans(packet) {
  return packet.segments.map((segment, index) => {
    const policy = segment.compaction;
    const eligible = policy?.eligibility === "tool-output";
    return {
      id: segment.ni,
      // Everything without an explicit tool-output declaration is protected.
      kind: eligible ? "tool_result" : "user",
      text: segment.content,
      meta: eligible ? { isError: policy.isError === true, ...(policy.exitCode === undefined ? {} : { exitCode: policy.exitCode }) } : { pinned: true },
      index,
    };
  });
}

/**
 * Form the provider view of admitted context. Character/token quantities are
 * estimates unless a caller supplies its own estimator; this boundary never
 * calls a model-specific tokenizer.
 */
export function optimizeInferenceContext(input, admittedContext) {
  const options = input.contextOptimization ?? {};
  const exact = options.mode === "exact";
  const chatPayload = input.chatCompletion === undefined ? null : JSON.stringify(input.chatCompletion);
  const spans = [{ id: "objective", kind: "user", text: input.objective, meta: { pinned: true } }, ...(input.contextPacket
    ? packetSpans(input.contextPacket)
    : input.context === undefined ? [] : [{ id: "raw-context", kind: "user", text: input.context, meta: { pinned: true } }]),
  ...(chatPayload === null ? [] : [{ id: "chat-completion", kind: "user", text: chatPayload, meta: { pinned: true } }])];
  const budget = deriveContextBudget(options.maximumInputTokens === undefined
    ? { charsPerToken: options.estimatedCharsPerToken }
    : { window: options.maximumInputTokens, reserveRatio: 1, charsPerToken: options.estimatedCharsPerToken });
  const originalBytes = spans.reduce((bytes, span, index) => bytes + Buffer.byteLength(span.text) + (index === 0 ? 0 : 2), 0);
  if (exact) return Object.freeze({
    suppliedContext: admittedContext.suppliedContext,
    overflow: originalBytes > budget.budget,
    evidence: Object.freeze({ mode: "exact", estimated: true, budget, beforeBytes: originalBytes, afterBytes: originalBytes, retained: spans.map(({ id }) => id), dropped: [], rawRecall: [] }),
  });
  const plan = planCompaction(spans, { budget: budget.budget, query: input.objective });
  const applied = applyCompaction(spans, plan);
  // Chat messages are sent through their own exact carrier, never copied into context.
  const suppliedContext = applied.spans.filter(({ id }) => id !== "objective" && id !== "chat-completion").map(({ text }) => text).join("\n\n");
  // The plan's measuredAfter intentionally prices evictions at zero, while
  // applyCompaction emits a ledger line. Guard the actual serialized view so
  // a placeholder can never expand past the caller's input budget.
  const actualViewBytes = Buffer.byteLength([input.objective, suppliedContext, ...(chatPayload === null ? [] : [chatPayload])].join("\n\n"));
  const dropped = plan.ops.filter(({ op }) => op !== "keep").map(({ id, op, archiveId, witness }) => ({ id, op, ...(archiveId ? { archiveId } : {}), ...(witness ? { witness } : {}) }));
  return Object.freeze({
    suppliedContext,
    overflow: plan.unmet || actualViewBytes > budget.budget,
    evidence: Object.freeze({
      mode: "automatic", estimated: true, budget, beforeBytes: originalBytes, afterBytes: actualViewBytes,
      retained: applied.spans.map(({ id }) => id), dropped, rawRecall: applied.archive,
    }),
  });
}
