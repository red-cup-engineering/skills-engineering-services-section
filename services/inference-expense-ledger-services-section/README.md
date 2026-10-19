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

## Agent session cost ledger

Everything here is dependency-free Node (`node --test test/agent-session-cost-ledger.test.mjs`)
and reads usage fields only from transcripts, never prompts, tool inputs or results.

- `scripts/ingest-agent-session-transcripts.mjs` reads Claude Code transcripts
  (`~/.claude/projects/<project>/<session>.jsonl` and `<session>/subagents/agent-*.jsonl`, with each
  subagent's `.meta.json`) and Codex rollouts (`~/.codex/sessions`, `archived_sessions`) for one UTC
  `--day`, and writes one JSONL file per session under `data/records/agent-inference-expense/<day>/`:
  an `agent-inference-expense` record per session, agent, model and speed, content-addressed, with
  tokens by kind (input, 5-minute cache write, 1-hour cache write, cache read, output), turns, context
  (first, final, peak, mean, turns over 200k) and cost. One record per API message id (the last row of
  an id carries its final counters). Cache writes the transcript does not split by TTL are priced as
  5-minute writes and counted in `cacheWriteTtlUnknownTokens`.
- Prices are `published-model-price-claim` records (`data/records/2026-10-19-anthropic-published-prices.json`):
  measured claims with the provider's pricing-page URL and observation date. A model, speed or token
  class with no claim is recorded `priced: false` with the reason; nothing is defaulted. A claim observed
  after the usage day is used only with `--allow-later-price-claim`, and the record then says
  `priceObservedAfterUsage`. `claude-haiku-5-5` has no claim because its price depends on prompt size.
  Codex models have no claim, so Codex records carry tokens and are unpriced.
- `--simulate-handoff THRESHOLD:HANDOFF` also writes `handoff-simulation.json`: for each agent, what its
  measured per-request series would have cost had it ended at THRESHOLD tokens of context and a fresh
  agent continued from a HANDOFF-token record (model and limits in `src/context-budget.mjs`). An agent
  whose window starts with more than THRESHOLD minus HANDOFF tokens already in context is reported not
  simulable.
- `scripts/report-agent-context-budgets.mjs --day D [--budget 200000]` reads the ledger and lists each
  agent's peak and final context, turns over budget and cost, over-budget agents first.
- `scripts/record-agent-assignment.mjs derive --session ID` derives assignments and outcomes from the lead
  transcript (Agent tool calls: description, prompt digest, tool-use and agent id; task-notification status;
  never prompts or reports) and appends the new ones, idempotently, to the assignment journal. `assigned|outcome` remain as a manual override.
  The journal is
  (`data/records/agent-assignments/journal.jsonl`): which agent (by id or tool-use id) the lead gave a Work
  item, and later its outcome. `scripts/report-work-cost.mjs` joins that journal to the ledger and prints
  each Work item's agents, turns, tokens and cost, and names any assignment matching no ledger record.
  The Work board itself is not reachable from a Claude Code session yet; the missing pieces are the
  requirement in the agent-harness section (`a-claude-code-session-opens-and-moves-work-for-each-agent-it-dispatches`).
