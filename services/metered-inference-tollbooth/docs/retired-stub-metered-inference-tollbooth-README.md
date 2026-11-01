# Metered RMN inference

This settlement sells one exact RMN inference contract at `POST /inference`.
The HTTP boundary is x402 v2 as implemented by the official `@x402/*` SDK.
It is one optional currency-settlement route for customers that selected an
x402 consideration obligation; it is not the inference market's universal
price or settlement path.
There is no custom challenge, EIP-191 tollbooth, provider registry, inference
aggregator, or fallback route.

The submitted ActivityStreams `Accept<ServiceContract>` names the selected
provider's signed A2A Agent Card and carries this settlement's canonical RMN
effect bundle. That bundle directly embeds the exact provider effect. After
x402 settlement, the tollbooth verifies that the signed card's sovereign
account and RMN law inhabit that effect, then sends exactly one A2A task to that
provider. A refusal ends this customer act; it never selects another provider.

The middleware verifies payment before executing the handler, buffers the
result, and asks the configured facilitator to settle before releasing it.
Successful settlement is recorded as an RWIL/RDF named graph. The standard
`PAYMENT-REQUIRED` and `PAYMENT-RESPONSE` headers are the payment wire format.

## Public product

The source and operated-node offer are published through
[`market.561.group`](https://market.561.group/). The market card names this
enterprise, the `POST /inference` endpoint, supported chain policy, payee,
price, and verification evidence. The node's own `402 Payment Required`
challenge remains authoritative for the current terms; the public source and
the paid node are intentionally released together as independently usable
products.

Required configuration:

- `X402_NETWORK`: explicit EVM CAIP-2 chain, such as `eip155:84532`.
- `X402_PAY_TO`: this settlement's smart-account address on that chain.
- `X402_FACILITATOR`: contracted x402 facilitator URL.
- `X402_FACILITATOR_PROVIDER`: `cdp` for Base-mainnet production.
- `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`: runtime-only facilitator
  credentials; never source or catalog metadata.
- `X402_PRICE`: exact dollar price, such as `$0.001`.
- `RMN_CONFORMANCE_AGENT`, `WIT_TRANSITION_ASSAY_AGENT`, and
  `RWIL_RDF_AGENT`: signed Agent Cards for the hired semantic providers.

The protected route declares the official x402 v2 Bazaar extension. Coinbase
indexes it only after the CDP facilitator completes a real settlement; there
is no separate registration call.

Run `npm run verify` for the no-payment 402 proof, pre-payment refusal proof,
and direct signed-provider execution proof. The test facilitator exists only as
an injected protocol test double; production cannot omit a facilitator URL.
