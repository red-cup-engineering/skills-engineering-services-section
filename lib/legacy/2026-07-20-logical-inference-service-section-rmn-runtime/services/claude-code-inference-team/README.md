# Claude Code Inference Team

A **Support Node Metro-Enterprise**, owned by Red Cup Engineering's Logical
Inference Service Section.

This team exists so that chat-completion inference through the local `claude`
CLI's print mode (`claude -p`) can be provided to other micro-enterprises
through the Internal Market (IM). Other MEs hire the team; the team answers
with a schema-validated completion or a structured refusal. As a Support Node
its immediate customer is always another ME, never an end user directly.

Per the enterprise membrane rule, this settlement carries its own `content/`
pools — it does not read, write, or share any ancestor's content pools.

## Scope

This implementation is independent of every other Claude client in the tree.
It does not depend on an umbrella client or on this section's own
`anthropic-inference-team` (which drives
Anthropic's Messages API directly over HTTPS with an `x-api-key`). Those
remain separate, sovereign, and untouched. This unit shares no code and no
dependency with either of them: its own and only endpoint is the local
`claude` binary, invoked in print mode as a subprocess.

## Org

- **Over:** Logical Inference Service Section (Red Cup Engineering, 561 Group).
- **Owns:** the Claude Code Inference exchange unit — the harness, its
  contract register, and its exchange records.

## Structure

- `README.md` — this file.
- `package.json` — `@emsenn/claude-code-inference-team`, a private ESM package.
- `src/contract-claude-code.js` — the ActivityStreams Internal Market
  adapter. It authors executable offers, checks the accepted capability and
  exact packet scope, and alone invokes the harness for contracted work.
- `run-one-exchange.mjs` — the exchange harness. See "The harness" below.
- `.gitignore` — excludes `node_modules/` and `.env`.
- `content/contracts/claude-code-inference-service.rml` — this settlement's
  human-authored law; `src/law.mjs` compiles it to deterministic typed RMN and
  its sole RFC 6920 contract identity.
- `content/exchanges/` — one record per exchange run against the local
  `claude -p` surface, `.outcome` always `completion` or `refusal`,
  validated against the enterprise's seated `emsenn/schema/inference-exchange`
  class — the shared chat-completion exchange class this team,
  anthropic-inference-team, nvidia-inference-team, and openai-inference-team
  all use (distinct from `emsenn/schema/exchange`, which is scoped to
  NotebookLM's own closed artifact-type menu).
- `content/packets/sample-chat-packet.json` — a sample context packet for
  exercising the harness without inventing one by hand.

## The harness

`run-one-exchange.mjs` reads a context packet (JSON: `model`, `messages`, and
optionally `max-tokens` and a provider-specific `params` object) from a file
path given on argv, and either:

- (`--dry-run`) validates the packet's shape, resolves the model default,
  reports the local `claude` binary's PATH *presence* (never login
  validity), and prints exactly what would be run — no invocation, nothing
  written; or
- maps the packet to **one** bounded `claude -p` subprocess and settles to
  exactly one of two typed outcomes — `completion` or `refusal` — written to
  `content/exchanges/` and validated against `emsenn/schema/inference-exchange`
  (via `read-a-schema.js`, resolved by walking up from this settlement to
  the executive office that carries the schema pool, exactly as the sibling
  teams' harnesses do) before the write.

```sh
node run-one-exchange.mjs content/packets/sample-chat-packet.json --dry-run
node run-one-exchange.mjs content/packets/sample-chat-packet.json
```

A settled refusal (a non-zero exit, a timeout, an unparseable response body,
or the CLI's own in-band error/refusal) is not a script failure — the
harness exits 0 either way, because a refusal is a settled outcome like any
other. The harness exits non-zero only when the bounded-pilot guard or
packet validation itself refuses to proceed (see below).

### The one real difference from the sibling teams

Every sibling team in this section (`anthropic-inference-team`,
`nvidia-inference-team`, `openai-inference-team`) drives an HTTPS API
directly. This team's endpoint is not an HTTPS API at all — it is the local
`claude` CLI in print mode. The harness:

- flattens `packet.messages` into a single print-mode prompt and streams that
  prompt to the subprocess over standard input, so corpus-scale packets are
  governed by the model's context window rather than the host operating
  system's command-argument limit: a `system`
  message maps to `--append-system-prompt` (joined, in declared order, if
  more than one is present); every other turn is flattened, in order, into
  the prompt argument itself (a lone bare `user` turn is passed through
  verbatim rather than wrapped in a `User:` label, since `claude -p`'s
  prompt argument is already a single user turn in that case; two or more
  non-system turns are rendered as a `User: ...` / `Assistant: ...`
  transcript);
- passes `--model` from the (possibly-defaulted) packet;
- passes `--output-format json` so the reply parses as structured data
  (`.result` for the completion text, `.stop_reason`, `.is_error`,
  `.subtype`, and more — see "Reading the CLI's JSON" below);
- constrains the subprocess to pure text inference as far as the CLI
  allows: `--tools ""` (an empty tool allowlist — confirmed against
  `claude --help`'s own text: `Use "" to disable all tools`),
  `--strict-mcp-config` with no `--mcp-config` given (zero MCP servers, so
  no MCP-exposed tool can be reached either), and `--setting-sources ""`
  (no user, project, or local settings — including this repository's own
  `CLAUDE.md`, hooks, or agents — are loaded into the subprocess's session).
  Together these mean the subprocess cannot use tools or touch the
  filesystem;
- bounds the subprocess with a fuel-seconds wall-clock budget via Node's
  `child_process.spawnSync(..., { timeout, killSignal: "SIGKILL" })`, which
  sends `SIGKILL` and reports the kill via `result.signal` if the budget is
  exceeded — the harness treats that as a settled refusal, never a hang.

### Reading the CLI's JSON

`claude -p --output-format json` prints one JSON object to stdout. The
fields this harness relies on (confirmed against this repository's own
installed `claude` binary, not assumed from documentation):

- `.result` — the completion text (string), present on success.
- `.stop_reason` — the finish reason (e.g. `end_turn`), carried through
  verbatim into the exchange record's `completion["finish-reason"]`.
- `.is_error` — `true` on an API-level or CLI-level error (a bad model id,
  an auth failure, and the like); the harness settles that as `refusal`.
- `.subtype` — `"success"` on a settled, non-error turn; any other value
  is treated as an in-band refusal.
- `.total_cost_usd`, `.usage`, `.session_id`, and the rest of the object are
  carried through unmodified in `completion.raw` for audit, exactly as the
  sibling teams carry the provider's full raw response body.

A non-zero subprocess exit, a `SIGKILL` from the fuel-seconds timeout, an
unparseable stdout body, or `is_error`/non-`"success"` `.subtype`/
`stop_reason: "refusal"` in an otherwise-parseable response **all** settle as
`outcome: "refusal"` with `refusal.grounds` stating which condition fired
and `refusal.unmet` naming it, exactly mirroring the sibling teams' own
refusal taxonomy (`http-failure:*`, `fetch-timeout`,
`unparseable-response-body`, `anthropic-api-refusal`) adapted to a
subprocess boundary rather than an HTTP one.

### Authentication

This team authenticates as whatever the local `claude` CLI is **already
logged in as** — there is no separate credential this harness manages, reads,
or injects. `--dry-run` checks only PATH *presence* of the `claude` binary;
it never attempts to validate that the CLI's own login state still works.
This is a real difference from every sibling team, each of which reads and
sends its own API key: this unit has no API key of its own to read, because
the CLI carries its own authentication (OAuth session, API-key env var, or
enterprise gateway, whichever the local install is already configured for)
independent of this harness.

### Account-resource control

The original ten-file pilot cap was retired on 2026-07-18 after it began
refusing contracted work merely because durable exchange evidence existed.
File count is not an account budget. Live execution remains bounded by the
consumer's explicit `leader-inference-account` capability grant, the selected
model, the per-exchange wall-clock fuel bound, provider-owned cost evidence,
and the Claude account's actual limits. Every exchange remains visible in
`content/exchanges/`; accumulating evidence never disables the service.

## Contracting the service

The package advertisement exposes `solicit-service` and `invoke-service`.
A consumer sends an ActivityStreams `Offer<ServiceSolicitation>` whose
Leader source activity carries a `ClaudeCodeInferenceRequest` attachment.
The provider, not the consumer, authors the executable offer. Live offers
name `external-network` and `leader-inference-account` as required effects;
the accepted capability must carry both before the provider will spend the
account resource. Dry-run offers carry no effects and validate the exact
packet-to-harness route without invoking Claude or writing an exchange.

## What could not be realized as stated

The context packet's optional `max-tokens` field is read, shape-validated
(must be a positive integer when present), and echoed verbatim into the
written exchange record's `packet["max-tokens"]` — matching the sibling
teams' packet shape exactly. It is **not enforced on the wire**: `claude -p`
carries no flag that bounds completion length (confirmed against `claude
--help`; the closest related flag, `--max-budget-usd`, caps dollar spend, not
token count). Where the anthropic-inference-team sibling can default and
forward `max_tokens` because Anthropic's Messages API requires and honors it,
this unit has no equivalent lever to pull. This is not a silent substitution
of an easier requirement — it is stated here, plainly, as the one part of
the packet's declared shape this endpoint cannot actually honor.
