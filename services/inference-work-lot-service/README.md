# Direct inference work contracting

This customer-side settlement contracts one bounded work lot directly with one
customer-admitted sovereign inference provider. It is discovery and contracting
for its owning customer, not a Union-wide scheduler, execution pool, or price
authority. Batch clients make independent contracts with bounded local
concurrency; this service exports no batch allocator.

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
from `./carriers`. Their wire projection is a canonical typed RMN CBOR
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
node scripts/check-codex-market.mjs
```

The check succeeds when both customer services and at least one inference
provider present signed Agent Cards. Offline providers remain explicit in the
report; they do not make another sovereign provider's offer disappear.

`node scripts/smoke-codex-mcp.mjs` starts a fresh stdio server and verifies the MCP
handshake, package-derived server version, tool registration, and published
numeric/URN bounds without buying inference. Add `--live` to contract one tiny
schema-bound lot through that fresh MCP process.

The Codex MCP façade currently closes only direct-witness relative-resolution
credit. Its default policy therefore admits that one asset within a ceiling of
100 milliquanta, and any caller-supplied policy must be a subpolicy of that
ceiling. The wider market remains able to represent plural assets; those need
their own settlement adapters before they can be offered through this façade.
