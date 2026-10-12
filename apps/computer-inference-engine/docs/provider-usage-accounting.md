# Provider usage accounting

## Requirement and existing owner

The existing `offload-work-to-free-cloud-endpoints-and-scripts` requirement
(`../../content/requirements/offload-work-to-free-cloud-endpoints-and-scripts.json`)
needs comparable, attributable observations before work can be routed by cost.
This refinement qualifies the existing token-usage core, provider adapter and
EAVT collector; it does not add another broker, journal or accounting service.

A reported count, an unknown count and a structurally inapplicable category must
not be conflated. Provider, model, request, session, source and surface identity
remain on the existing event. A surface identifies the observed integration
channel; it is not a claim to account for messages on unobserved channels.

## Specification

- OpenAI `inputTokens` includes cached input. `cachedInputTokens` and
  `cacheWriteInputTokens` are disjoint subsets, not extra input tokens.
- Anthropic `inputTokens` is uncached input; `cacheCreationInputTokens` and
  `cacheReadInputTokens` are separate additive categories.
- `reasoningOutputTokens` is a subset of output, never additional output.
- Raw usage and sparse numeric counts remain unchanged by pricing. Missing
  applicable counts block a complete price when they can affect it. A missing
  subset can be priced as part of its known total only when both have the same
  supplied rate; the missing subset is not emitted as a measured zero.
- An explicitly observed zero remains zero. No observations yield no measured
  totals, rather than a zero-token response. Partial and overflow coverage
  remain in the existing measurement evidence.
- An impossible subset larger than its containing total has no complete price;
  subtraction must not clamp it into an invented price.
- OTel input includes caches. Project each provider's native basis before
  summing mixed-provider cohorts. Emit a complete aggregate attribute only if
  every included turn supplies that attribute and its sum is a safe integer.
- Cost units remain the existing USD microdollars and exact rational arithmetic.
  Supplied rates are not provider invoices. No rates, exchange rates, dates or
  source provenance are invented; caller rate-table custody remains required.

## Design and fabrication

`tokenUsageCostEstimate(usage, rates, { provider })` selects the native basis for
exact `openai` and `anthropic` identities. Unidentified callers retain the legacy
mixed basis and conservative missing-data checks. OpenAI-compatible routing does
not imply OpenAI accounting for another provider.

The existing collector passes the event provider to pricing. Per-event OTel
projection feeds the existing provider/surface/session/model/resource groupings;
this avoids interpreting a mixed group with the first provider's native basis.
The same provider basis crosses the existing EAVT persistence projection.
The Responses adapter preserves supplied `input_tokens_details.cache_write_tokens`
separately. No network calls, credentials or host execution are needed.

## Qualification

Baseline `45da463bfd6f6f73b1c1442c4c04bc252a48bd68` priced neither the normal
sparse OpenAI record nor the normal sparse Anthropic record in the regression
fixtures. OpenAI input and Anthropic cache-read telemetry disappeared. Empty
measurements produced seven zero fields despite no observations.

Run from this package with its declared JSON dependency installed:

    node --test test/cost/token-usage.test.mjs test/cost/provider-accounting.test.mjs

The synthetic fixture rates are expressly not live provider prices. Tests cover
native input bases, reasoning and cache-write subsets, exact rational prices,
unknown/zero distinction, invalid subsets, overflow, mixed-provider telemetry,
existing event identity, duplicate-feed handling, persistence and context size.
The pre-existing core tests now state the sparse-count contract instead of
expecting removed zero-filling and invented totals.

## Primary comparison sources

Verified 2026-10-12; these evolving interfaces need versioned release receiving:

- OpenAI Responses usage:
  https://developers.openai.com/api/reference/resources/responses/methods/create
- OpenAI SDK usage carrier (cache read/write and reasoning details):
  https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_usage.py
- Anthropic native input/cache definitions:
  https://platform.claude.com/docs/en/build-with-claude/prompt-caching#tracking-cache-performance
- Anthropic streaming usage is cumulative, not per-frame additive:
  https://platform.claude.com/docs/en/build-with-claude/streaming
- OTel GenAI spans specify cache-inclusive input totals and subset details:
  https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md

## Receiving and release boundaries

This is source-level accounting qualification, not live multi-provider activation
or whole-engine qualification. A missing final streaming usage event, a retry
that consumed tokens before refusal, and a rejected candidate can still require
additional attempt-level provider evidence in the existing fabric/broker; this
change does not fabricate that evidence. Provider-specific cache TTL pricing,
rate-card effective dates, invoice reconciliation and non-USD conversion require
actual source/rate custody. Message bodies are not accounting metadata.

Do not publish the engine wholesale: its current broad package file selection
includes historical operational exchange material, and release/license custody
must be qualified by the receiving owner. No license choice, package publication,
payment, deployment or credential change is part of this repair.
