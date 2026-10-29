# Anthropic Inference Team

A **Support Node Metro-Enterprise**, owned by Red Cup Engineering's Logical
Inference Service Section.

This team exists so that chat-completion inference against Anthropic's
Messages API (`https://api.anthropic.com/v1/messages`) can be provided to
other micro-enterprises through the Internal Market (IM). Other MEs hire the
team; the team answers with a schema-validated completion or a structured
refusal. As a Support Node its immediate customer is always another ME,
never an end user directly.

Per the enterprise membrane rule, this settlement carries its own `content/`
pools — it does not read, write, or share any ancestor's content pools.

## Scope

This service owns its Anthropic boundary directly. It shares no client code
with another settlement and has no umbrella-client dependency.

## Org

- **Over:** Logical Inference Service Section (Red Cup Engineering, 561 Group).
- **Owns:** the Anthropic Inference exchange unit — the harness, its contract
  register, and its exchange records.

## Structure

- `README.md` — this file.
- `package.json` — `@emsenn/anthropic-inference-team`, a private ESM package.
- `run-one-exchange.mjs` — the exchange harness. See "The harness" below.
- `.gitignore` — excludes `node_modules/` and `.env`.
- `content/contracts/anthropic-inference-service.rml` — this settlement's
  own contract register (validated against the enterprise's seated
  `emsenn/schema/contract` class).
- `content/exchanges/` — one record per exchange run against the real
  Anthropic Messages API surface, `.outcome` always `completion` or
  `refusal`, validated against the enterprise's seated
  `emsenn/schema/inference-exchange` class — the shared chat-completion
  exchange class this team, nvidia-inference-team, and openai-inference-team
  all use (distinct from `emsenn/schema/exchange`, which is scoped to
  NotebookLM's own closed artifact-type menu).
- `content/packets/sample-chat-packet.json` — a sample context packet for
  exercising the harness without inventing one by hand.

## The harness

`run-one-exchange.mjs` reads a context packet (JSON: `model`, `messages`, and
optionally `max-tokens` and a provider-specific `params` object) from a file
path given on argv, and either:

- (`--dry-run`) validates the packet's shape, resolves the model/max-tokens
  defaults, and reports `x-api-key` credential *presence* (never validity)
  and what would actually be sent, with no network call and nothing written;
  or
- drives one `x-api-key`-authenticated HTTPS POST to
  `https://api.anthropic.com/v1/messages`, bounded by a fuel-seconds
  wall-clock budget, and settles to exactly one of two typed outcomes —
  `completion` or `refusal` — written to `content/exchanges/` and validated
  against `emsenn/schema/inference-exchange` (via `read-a-schema.js`,
  resolved by walking up from this settlement to the executive office that
  carries the schema pool) before the write.

```sh
node run-one-exchange.mjs content/packets/sample-chat-packet.json --dry-run
node run-one-exchange.mjs content/packets/sample-chat-packet.json
```

A settled refusal (a non-2xx response, an in-band API-level refusal, a
timeout, a network error, or an unparseable/incomplete response body) is not
a script failure — the harness exits 0 either way, because a refusal is a
settled outcome like any other. The harness exits non-zero only when the
bounded-pilot guard or packet validation itself refuses to proceed (see
below).

### Authentication

The harness reads `ANTHROPIC_API_KEY` and sends it as the `x-api-key` header
on the request — **not** an `Authorization: Bearer` header, which is how the
sibling NVIDIA and OpenAI teams authenticate. This is a real difference in
Anthropic's Messages API, not an oversight: every live request also carries
an `anthropic-version: 2023-06-01` header alongside `x-api-key`. `--dry-run`
checks only *presence* of `ANTHROPIC_API_KEY`; it never attempts to validate
that a key still works against Anthropic.

### API nuances

Two behaviors of Anthropic's Messages API shape this harness beyond a plain
model/messages swap from the sibling teams:

- **`max_tokens` is required by the wire API**, unlike the NVIDIA/OpenAI
  teams' optional field. If the caller's packet omits `max-tokens`, the
  harness defaults it to `4096` and sends that — it does not fail
  validation over a missing `max-tokens`. The effective value actually sent
  (caller-supplied or defaulted) is echoed back in the written exchange
  record's `packet.max-tokens`, and reported directly in `--dry-run` output,
  so it's always visible which value was used.
- **`stop_reason` can be `"refusal"` even on a 200 OK response** — Anthropic's
  own in-band safety classifier declining the request after a successful
  HTTP exchange. The harness treats that case as this contract's
  `outcome: "refusal"` too, not `"completion"`, with `refusal.grounds`
  stating it was an in-band API-level refusal (citing `stop_reason` and any
  `stop_details` category present) and `refusal.unmet: ["anthropic-api-refusal"]`.

Similarly, if `packet.model` is absent the harness defaults it to
`claude-opus-4-8` (this repository's own current default Claude model)
rather than failing validation — but `messages` must still be present and
valid, or the harness refuses with exit code 2.

### Bounded-pilot guard

Before doing anything else, the harness counts non-archived
`content/exchanges/*.json` records (any `archive/` subdirectory is excluded)
and refuses — exit code 3, a structured refusal on stderr, no packet read, no
network call — once that count reaches `ANTHROPIC_INFERENCE_PILOT_CAP`
(default 10). This is a recommendation-level mechanism scoped to keep a
pilot's own call volume visible and bounded; it is **not itself an IRB
funding authorization** — raising the cap, or authorizing ongoing volume
beyond it, is a decision for the investment review board to make, not a
flag this harness can be handed to self-authorize.
