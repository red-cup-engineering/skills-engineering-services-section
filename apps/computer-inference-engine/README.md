# Direct inference work contracting

## Zero-cash sovereign provider market

The engine admits local Ollama and the credentialed NVIDIA NIM, Gemini, Groq,
OpenRouter, and Cloudflare Workers AI services as separate sovereign providers
through `content/dispatch/provider-admissions/direct-endpoint-providers.json`.
They share the plain-Node OpenAI-compatible endpoint adapter; provider identity,
model observation, no-overage policy, and receipts remain distinct. Provider
model catalogs are read from each provider's own listing and classified as
chat, reasoning, long-context, JSON output, code, Chinese-language,
embeddings, text-to-speech, or image generation. OpenRouter observation and
dispatch admit only model identifiers ending in `:free`.

The no-overage account lease renews when the node reloads a provider with its
current credential. It lasts one hour and is checked again immediately before
a zero-cash request. Response rate-limit headers and HTTP 429 observations
become provider availability evidence; selection filters required capability
and quality, prefers remaining observed request capacity, and continues to the
next admitted provider after a rate limit or outage. It never crosses into a
paid model or paid overage.

Cloudflare Workers AI speech and FLUX images enter through
`./media/zero-cash-generation`; both return bytes beside the same
`InferenceExchangeReceipt` carrier used for attributable inference delivery.

The agent-organization engine reaches this component at
`apps/agent-organization-engine/lib/communicating`: FeltOS supplies this
engine's call as the model-backed step passed to `translateInLanguageFamily`.
The communicating algebra remains provider- and protocol-blind.

The bounded receiving check is:

```sh
node --env-file-if-exists=/home/emsenn/info/.env scripts/dispatch/verify-zero-cash-engine.mjs
```

## Platform composition

`createInferencePlatform(configuration)` composes `INFERENCE_WORK_SYSTEM`
and the node's `inference:procure` capability on `computer-platform`. The
configuration binds the node's transports, resource reservations, cash policy,
and custody. Requests supply work data to the admitted operation; the typed
code engine checks its domain, codomain, and permitted effects.

The returned platform supports local `execute` and wire `dispatch` through
the same registered operation and bound provider. Both start the platform as
needed and retain its capabilities until pending work settles. `close()`
refuses new work and drains admitted calls before releasing capabilities.
A host can retain one configured platform for concurrent model requests.
The existing `dispatchInference` entrypoint uses one such platform for its
call and closes it afterward; all configured-customer and MCP callers using
that entrypoint share this execution path.

This composition governs provider lifetime. Existing inference demand,
resource, contract, and receiver-acceptance rules continue to govern work.

This customer-side settlement contracts one bounded work lot directly with one
customer-admitted sovereign inference provider. It is discovery and contracting
for its owning customer, not a Union-wide scheduler, execution pool, or price
authority. Batch clients make independent contracts with bounded local
concurrency; this service exports no batch allocator.

Provider process invocation is also outside this package. Each provider owns
its process adapter; for example, Claude Code exports its bounded print-mode
compiler from its existing provider package. This package retains the 561
Group operational admissions, pricing/consideration, settlement, and runtime
market state that decide whether an invocation may be contracted.

When a selected provider returns a durable A2A task, the market records the
complete pending procurement against the owning parent task and RMN
request. A dependency callback or restart replay resumes that exact child task,
compact, offer, and provider coordinate. Missing or mismatched custody is an
explicit obstruction: replay never re-solicits the market or silently creates a
second provider contract.

Each exchange has five identified typed objects:

1. `TypedRmnInferenceDemand` measures its source and states task, difficulty,
   capability, output, and customer-authored consideration bounds.
2. `TypedRmnInferenceServiceOffer` binds the demand to the provider's signed
   Agent Card, honest execution bounds, and provider-authored barter
   alternatives.
3. `ConsiderationPolicy` lists customer-acceptable obligation bundles in
   preference order. Obligations are typed as `service`, `resource`, `credit`,
   or `currency` and name an exact asset, amount ceiling, unit, and permitted
   settlement adapters.
4. `InferenceExchangeCompact` binds the exact demand, offer, parties, and one
   selected obligation bundle before work crosses the provider boundary.
5. `InferenceExchangeReceipt` witnesses work separately from every
   consideration obligation. Successful work initially leaves those
   obligations `pending`; later evidence produces an append-only successor
   receipt rather than changing the earlier receipt.

Selection never invents an exchange rate. Customer alternative order is
authoritative. Within one exact asset bundle, a component-wise cheaper offer
may Pareto-dominate another. Cross-asset or mixed-bundle ambiguity becomes
`customer-consideration-choice-required` residue.

The request, result, and refusal boundaries are Draft 2020-12 schemas exported
from `./carriers`. Their wire projection is a typed RMN CBOR
ascription built from the 0.0.1 split RMN grammar, CBOR codec, JSON bridge, and
typing services. The carrier preserves ordinary JSON booleans and charge-like
strings losslessly. Its operation metadata references compatible Relating
0.0.1/0.0.2 semantics; it does not copy Relating's implementation or registry.

WitnessJournal projection, custody, category indexing, and WIT transition are
optional settlement providers. Core request/refusal/result contracting imports
without that older provider cohort; a settlement operation fails explicitly if
its provider packages have not yet been cut over and installed.

The x402 v2 adapter URN is valid only on a `currency` obligation. The separately
hireable x402 Services Section turns an exact matching x402 transaction into
obligation evidence. Reciprocal service, resources, and credit do not pass
through x402.

The former scalar `maximumConsideration` input is not part of this boundary.
Customers send `considerationPolicy`; any legacy scalar migration belongs to
the legacy customer's own adapter and cannot silently normalize plural assets.

For a read-only live check of the customer-admitted RMN and WitnessJournal services and
all admitted inference-provider Agent Cards, run:

```sh
node scripts/check-inference-providers.mjs
```

The check succeeds when both customer services and at least one inference
provider present signed Agent Cards. Offline providers remain explicit in the
report; they do not make another sovereign provider's offer disappear. A
provider Agent Card that recently failed or errored is reported from the
5-minute TTL liveness cache (`data/state/provider-card-liveness-state/provider-card-liveness.json`,
`src/provider-card-liveness-cache.mjs`) rather than re-probed on every run;
such an entry carries `cached: true` alongside its `reason`.

`node scripts/smoke-inference-dispatch-mcp.mjs` starts a fresh stdio server and verifies the MCP
handshake, package-derived server version, tool registration, and published
numeric/URN bounds without buying inference. Add `--live` to contract one tiny
schema-bound lot through that fresh MCP process.

The trusted `info` checkout declares this stdio server as
`inference_work_market` in the repository's `.codex/config.toml`. Codex loads
project MCP declarations when a task starts, so a new task or application
restart is required after configuration changes. `/mcp` must show the three
tools before a session claims it can route bounded derivations through this
market. The dated activation record under `content/activation-records/` retains
the first live Codex-shaped Gemini assay without treating its candidate as an
accepted repository effect.

For a task that began before Codex loaded the MCP registration, the same
customer boundary is available through an exact JSON input carrier:

```sh
contract-codex-inference-work \
  --input /path/to/bounded-inference-request.json \
  --output /path/to/untrusted-candidate.json \
  --pricing-service http://127.0.0.1:8800
```

The optional output is create-only and mode `0600`. Omitting it writes the
result to stdout. This command contracts the lot and performs the customer
schema assay; it never records Codex receiver acceptance. The request must be
self-contained and must not contain secrets or grant ambient repository
access. Settlement attribution resolves from the checked-in public CAIP-10
account record when the launcher does not inject `SETTLEMENT_ACCOUNT`; no
private keystore is required for this journal identity.

After Codex independently assays the candidate, record its exact accepted or
refused disposition through the same observer:

```sh
record-codex-inference-outcome \
  --input /path/to/receiver-disposition.json \
  --output /path/to/receiver-observation.json \
  --pricing-service http://127.0.0.1:8800
```

The pricing observer refuses a disposition that is not bound to the exact
registered work lot, provider, task class, selected offer, receipt, and
receiver. Schema validity alone is not an acceptable receiver outcome.

Native dispatch results carry the credential-free `configuration` together
with its SignStuff content identity, `configurationIdentity`. Result admission
requires both, checks their identity, and checks the named provider. Receiving
must use that witnessed configuration, not reconstruct it from a current model
catalog. Direct and A2A deliveries retain the same configuration registered
with pricing. Dispatch without a pricing root still retains this witness;
recording a judgment requires the actual delivery to be registered in the
receiving pricing root. A pending candidate is never enterprise acceptance.

## Subscription allowances

A zero-cash subscription sells capacity per window, and what is not spent
before the window turns is lost. Its shape is an allowance of
`@red-cup-engineering/organizing/enterprise`: meters (a budget under
`from-first-spend` hours, a `period` of day/week/month from an anchor,
`sliding` hours, or a window the provider itself `stated`, its level and reset
read off the provider's own report), how a spend draws on them (`every` meter, as a five-hour
window under a weekly cap, or `first`-available, as daily credits before
monthly ones), and the price of each kind of work, known or an interval still
to learn. The provider section that owns the account declares it (Gemini
Notebook's `content/config/allowances.json`, Google Flow's
`flow-allowance.json`, the Antigravity row of `content/openai/providers/catalog.json`).
The subscriptions the house's agent CLIs run on are declared here, in
`content/allowances/` (`chatgpt-codex`, `claude-max`): `stated` windows each
CLI reports on every turn (Codex's `rate_limits`, Claude Code's
`rate_limit_event`), never summed from the house's own sessions, since the
account's other sessions draw on them too. `./media/subscription-allowances`
loads them and turns a CLI's statement into readings; the carrier contract
(agent-harness `src/carrier/`) records each carrier session's statement and the
session itself, as a spend its consumer drew.

`./media/allowance-ledger` is the one host-wide store every consumer of an
allowance draws through. It keeps the provider's evidence (spends, quota
refusals, balances, each under the provider's own source name, so a consumer's
record and a sync of the provider's history are one spend) and consumers'
holds:

- `holdAllowance` reserves a kind of work when the allowance, read with every
  live hold pending, holds it to fit; with `probe`, one hold per allowance may
  go where the fit is unknown, which is how an unstated limit is learned.
- `attemptAllowance` re-reads the fit at submission and moves the hold to that
  instant; `settleAllowance` records the answer as `spent` (with the
  provider's source), `refused` (quota) or `void` (failed for another reason);
  `releaseAllowance` returns an unsubmitted hold.
- `recordAllowanceEvidence` adds what was read elsewhere (Studio history, a
  balance page, a stated window), with the `consumer` that drew a spend where
  one is known; `readAllowanceLedger` reads fit, counts, windows and slack;
  `allowanceLedgerLapses` reads what each window spent and lost since an
  instant, and the windows that never opened. That is the measure a consumer
  schedule is tuned against; organizing's `shareAllowance` divides what is
  left among consumers.

The ledger keeps every allowance as the consumer that drew on it last
presented it, so it knows every pool on the host. `inference-allowance status`
(`scripts/media/allowance-status.mjs`) shows each one: each window as it stands
(opened, resets, spent, left), what used it since (`allowanceLedgerUse`: holds
by principal, recorded spends by consumer or source), and what lapsed unspent
at each turn.

A live hold counts only against the window holding its instant, so a hold
whose consumer died frees itself when that window turns. The store defaults
to `$XDG_STATE_HOME/561-group/computer-inference-engine/allowance-ledger.sqlite`
(`INFERENCE_ALLOWANCE_LEDGER_FILE` overrides it). Operator-mediated UI
readings for one-off account work (thumbnails) stay on
`./media/account-artifact-capacity`.

## Expected-resolution pricing

`src/expected-resolution-pricing.mjs` prices a declared amount by its
observed accepted-resolution rate: `declaredAmount *
(terminalResolutions + 2) / (successfulResolutions + 1)`, a Laplace-smoothed
rate inverted into a multiplier over the receipts journal's own observed
deliveries and outcomes (never a hand-set penalty constant). A provider with
no observations prices at 2x its declared amount; one that always succeeds
converges toward it; one that often refuses prices higher. `rankOffers`
orders candidate offers by this expected price, cheapest first.

When `EXPECTED_RESOLUTION_PRICE_URL` names a running
`scripts/serve-expected-resolution-pricing.mjs` daemon, `procureTypedInference`
selects the winning offer through this expected price instead of plain
declared-amount Pareto dominance, and the delivered result carries the
winning offer's `expectedResolutionPrice` (declared amount, expected price,
and reliability basis) beside its declared `consideration` -- present only
when a pricing service ranked the market, never fabricated when it did not.
On `bare-cedar-fog` this daemon runs as the `systemctl --user` unit
`expected-resolution-pricing.service`, serving `http://127.0.0.1:8800`; export
`EXPECTED_RESOLUTION_PRICE_URL=http://127.0.0.1:8800` (or pass
`--pricing-service http://127.0.0.1:8800` to the CLI commands below) to route
through it.

**The free-goods rule.** A $0 declared amount (a free-tier or quota offer)
prices at exactly 0 regardless of reliability, since the multiplier scales
nothing -- so price alone cannot order two such offers. `rankOffers` breaks
that tie (and any other exact price tie) on the same smoothed
accepted-resolution rate the multiplier inverts: the more reliable free offer
ranks first. A remaining tie (equal or absent observations on both sides)
falls back to provider order for a deterministic result. Latency is not yet
part of this ladder -- no observation this journal records carries it today,
so it is not fabricated as a criterion; it joins the tie-break once the
observation carrier gains it.

## Knowledge-vault work lots

`./knowledge-vault-work-lots` forms three finite, source-bound lot kinds on the
same market: `term-normalization`, `alias-suggestions`, and
`keyword-enrichment`. They route through providers' existing `extraction` or
`inquiry` capabilities while retaining distinct versioned task classes for
pricing and disposition. Each formed lot includes a closed JSON Schema, a
stable work-lot identity, and an exact source-content identity.

`assayKnowledgeVaultCandidate(workLot, candidate)` independently checks that
the candidate has the contracted shape, names the exact source, contains no
duplicate or non-suggestions, and binds every suggestion to a quote
whose character offsets reproduce the supplied source exactly. A successful
assay still sets `receiverAcceptanceGranted: false`: it makes a candidate safe
to judge, but does not write to or accept anything into a vault or glossary.

The MCP contract accepts the formed lot's `taskClass` alongside its ordinary
`workType`, context, output schema, and stable work-lot identifier. No separate
knowledge-vault inference server or provider capability namespace is required.

The Codex MCP façade currently closes only direct-witness relative-resolution
credit. Its default policy therefore admits that one asset within a ceiling of
100 milliquanta, and any caller-supplied policy must be a subpolicy of that
ceiling. The wider market remains able to represent plural assets; those need
their own settlement adapters before they can be offered through this façade.

## Direct-endpoint provider lanes

When the A2A market admits no offer, `dispatchInference` can use a
direct endpoint lane read from
`content/provider-admissions/direct-endpoint-providers.json`
(`src/direct-endpoint-provider.mjs`). The admitted roster is
`bare-cedar-fog-npu-inference-team` (the local Ollama NPU, excluded from most
dispatch tests via `excludeProviders` so a network lane can answer) and six
network-facing lanes: `groq-inference-team`, `openrouter-inference-team`,
`openrouter-alternate-inference-team`, `gemini-inference-team`,
`nvidia-inference-team`, and `cloudflare-workers-ai-inference-team`.
The exact derivation capability is available through SignCraft, not as a chat
model. Each descriptor's `apiKeyEnv` names the `.env`
variable its bearer auth loads; a descriptor whose variable is unset, or
whose endpoint carries an unresolved `{ENV_VAR_NAME}` placeholder, is skipped
rather than dispatched. `scripts/assay-direct-endpoint-providers.mjs` measures
which lanes currently answer a real chat round trip and which models they
serve; re-pin a retired model there rather than assuming a prior pin still
resolves.

A descriptor's `capabilities` list carries `json-schema-output` only after a
live `response_format: {type: "json_schema", ...}` probe against that exact
model, repeated across a realistic prompt, actually returned a
schema-matching completion more than once -- a single successful probe is
never sufficient (see the admission carrier's `note` field for the dated
finding per provider). When a customer sets `enforceProviderSchema: true`
and the route selects a descriptor carrying that capability,
`attemptDirectEndpointLane` (`src/inference-dispatch.mjs`) builds the
`response_format` body field with `openAiJsonSchemaResponseFormat`
(`src/direct-endpoint-provider.mjs`), which sets `strict: true` only when
the schema passes `isClosedJsonSchema` (every object level declares
`additionalProperties: false` with `required` covering exactly its declared
properties, checked recursively) -- OpenAI's own documented precondition for
strict enforcement. The delivered result's `providerSchemaEnforcement` field
reports whether shaping was attempted and, if so, whether it was strict.
Provider-side shaping is an attempt to improve compliance odds, never a
substitute for the customer's own schema assay, which runs unconditionally
either way and is the sole gate when `enforceProviderSchema` is not set (or
the winning provider lacks the capability) -- `scripts/smoke-inference-dispatch-mcp.mjs --live`
exercises both paths.

Every direct-lane prompt that carries an `outputSchema` states the schema's
exact top-level shape as one instruction sentence (`outputShapeInstruction`
in `src/inference-dispatch.mjs`) before the schema itself, serialized once:
an object schema names its required top-level properties and, when
`additionalProperties` is `false`, says no others are allowed; an array
schema states its `minItems`/`maxItems` when the schema gives them and that
the output is a bare array, never wrapped in an object. This runs
independently of `enforceProviderSchema`/`response_format` shaping above --
every provider gets the shape stated in plain language, whether or not it
also gets the provider-side JSON-schema hint. When the customer schema
assay then fails with errors confined to the top level (a missing wrapper
property, a top-level `type` mismatch, or a disallowed top-level property --
`topLevelShapeFailureOnly` in `src/inference-dispatch.mjs`), the same
provider is re-asked once, its own prior answer and the exact assay errors
quoted back to it verbatim alongside the shape instruction, before
`candidate-failed-customer-schema-assay` is ever recorded. A nested-field
violation, or a candidate that is not JSON at all, is never re-asked. An
accepted re-ask candidate carries `reasks: 1` on the delivered result's
`providerEvidence`, its `exchanges`/`toolInvocations`/`tokenUsage` covering
both provider calls; a refusal reached after a re-ask carries `reasks: 1` on
its own refusal entry the same way -- the re-ask is never silent evidence
either way, and a second failure is otherwise recorded exactly as before.

## Dispatch timing

Every `dispatchInference`/`dispatchInferenceAsConfiguredCustomer` result
carries a `timing` object (`DispatchTiming` in `src/inference-dispatch.mjs`):
`solicitation` (the full A2A market procurement call, including offer
solicitation and, when an offer is selected, its settlement), `routeDecision`
and `execution` (the direct-endpoint lane's Pareto route decision and
transport call), `assay` and `receipt` (schema assay and consideration-close
write for a market-selected offer), and `total`. All values are milliseconds,
rounded. A provider Agent Card cached as offline (see above) keeps
`solicitation` low on repeat dispatches instead of re-paying a live probe for
every dead lane.

## Data custody

Settlement and witness-journal records live in `data/records/`, written by
`@red-cup-engineering/semiotic-eavt-services-section` through its `./store`
(`put`) in `src/dispatch/witness-journal-settlement-store.mjs`.
observations and deliveries live in
`data/state/expected-resolution-pricing-state/`, resolved through
`@red-cup-engineering/data-custody-directory-service`'s
`dataCustodyDirectory(root, "state", "expected-resolution-pricing-state")` in
`src/expected-resolution-pricing.mjs`. The pricing daemon's systemd unit is
`content/deployments/bare-cedar-fog/expected-resolution-pricing.service`.

The optional A2A-provider listener is `scripts/server.mjs`. Its origin and
credentials must be supplied by the chosen host. The A2A-customer role runs locally
through the MCP handler built by `openInferenceDispatchMcp` in
`src/dispatch/inference-dispatch-mcp.mjs`, which a host mounts in its own process
and which dispatches solicited work to agent cards admitted in
`content/provider-admissions/` — local
agent-card servers on `127.0.0.1` (see
`content/provider-admissions/inference-providers.json`). Procurement requiring
remote RMN conformance must explicitly set `RMN_CONFORMANCE_AGENT`; no
retired hosting endpoint is admitted by default. Every outbound
`sendRmnTask`/`submitRmnTask` call
(`src/typed-rmn-inference-procurement.mjs`, `src/client.mjs`,
`src/rmn-conformance-client.mjs`) passes an explicit `outboundTaskRoot`
resolved through `@red-cup-engineering/data-custody-directory-service`'s
`dataCustodyDirectory(root, "state", "a2a")`, so outbound-task dedup and
custody records accumulate under `data/state/a2a/` on this devbox.
