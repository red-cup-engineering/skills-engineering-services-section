# Inference Expense Ledger Services Section

Prices the org's own token-usage records into Beancount candidates: one
operation renders provider price lists into `price` directives for
per-million-token commodities (`<MODEL>-IN`, `-OUT`, `-CACHE-READ`,
`-CACHE-WRITE`), and a second prices token-usage records against those
directives into `open`/transaction candidates posting
`Expenses:Inference-and-Compute:<Provider>` against
`Liabilities:Accounts-Payable:<Provider>`, so compute burn is booked
beside real finances (task:inference-expense-ledger, W10). This section
is seated here temporarily while `computer-ledger-system-services-section`
(the ledger engineering owner) is fenced; its operations compose that
section's published `decimal.mjs` and `beancount-render.mjs` primitives
rather than duplicating them, and never append to the main ledger — a
bookkeeper appends the candidates this section derives.

## Scripts

- `scripts/derive-set-of-usage-records-from-token-usage-summaries.mjs` —
  adapts metroplat's `metroplat.agent-session.token-usage-summary` shape
  (`src/integrations/token-usage/core.mts` in the metroplat app) into the
  `usageRecords` shape `derive-set-of-inference-expense-transactions-service`
  prices. A summary naming exactly one model becomes one usage record,
  folding `reasoningOutputTokens` into `outputTokens` (Anthropic and OpenAI
  both bill reasoning/thinking tokens at the standard output rate); a
  summary naming zero or more than one model, or carrying a non-zero
  generic `cachedInputTokens` that cannot be safely split into
  `cacheReadTokens`/`cacheCreationTokens`, is refused by name rather than
  guessed. Because `TokenUsageSummary` carries no timestamp of its own,
  each input entry must carry an `observedAt` ISO 8601 date-time supplied
  by the reader that produced the summary. When a summary carries its own
  `events` (each a `{model, usageKind, usage}` row mirroring metroplat's
  per-event rows), model attribution is instead taken from those `turn`-
  kind events — a session's `models` array can be empty even when its
  events reliably name a model (observed for Claude Code-sourced Anthropic
  summaries) — and a session whose turn events name more than one billable
  model is SPLIT into one usage record per model rather than refused;
  `duplicate`/`cumulative`/`rate-limit` events are excluded (a session's
  `total` is itself the sum of only its `turn` events), and a `<synthetic>`
  event (Claude Code's zero-cost system marker) is excluded only while its
  own usage is all-zero. Specification admitted through
  the jsnode fabrication line
  (`content/text/documents/specifications/derive-set-of-usage-records-from-token-usage-summaries-work-order.md`);
  landed as a section-owned script (not a separately published package)
  since it composes no external dependency and is consumed only by this
  section's own inference-expense pipeline.
