# Shared OpenAI-compatible inference

One provider capability serves the platform, direct exchanges, typed RMN inference and the A2A transport. Provider identity and differences are rows in `content/openai/providers/catalog.json`. NVIDIA, Groq, OpenRouter and GitHub Models directories hold account/offer/evidence data; their executable packages, custom hosts and exchange launchers have been removed.

`dispatch-chat-completion <provider-id|row.json> <packet.json> [--resource-root PATH] [--dry-run]` is the file boundary. `executeProviderMessage(providerId, message, { resourceRoot })` is the platform's direct typed boundary, exported from `./provider-runtime`. `runProviderExchange(providerOrRow, packet, options)` is the common request path. `execute-provider-inference` and `serve-provider-inference` supply stdin and existing contracted-agent A2A transports when needed.

The shared runtime owns credential aliases, kernel request admission, monotone rate state, output bounds, usage, completion carriers and refusal behavior. OpenRouter family rows inherit one zero-price and free-account preflight policy. Provider rows may fix request fields on every request (`requestFields`, e.g. OpenRouter's `provider.max_price` and `usage.include`), and a provider-reported call cost (`usage.cost`) is recorded as a reported-cost value, never computed from a declared rate. Provider policy cannot be widened by packet parameters. NVIDIA preserves customer schema guidance and projected source carriers. Credentials remain in the environment or the supplied resource directory; installed packages contain references only. Account settlement loads only at the typed boundary. Historical signed cards and exchange evidence remain in their data directories.


The packet is `{ model, messages, params?, "max-tokens"? }`. Packet and exchange record contracts come from `content/schemas/inference-exchange.schema.json`, evaluated by the shared computer-data-engine. Invalid records cannot be emitted or persisted.

The catalog records observed model availability and price evidence with dates. Provider rosters change: a past successful call is evidence for that date. Unpriced provider data is excluded from automatic routing.

`dispatchFreeFirstChatCompletion` serves current application consumers through the catalog's authored `routingPolicy.order`; an explicit `zeroCashOnly` request retains the shared zero-cash admission. New standalone work uses the observed inference-work-lot dispatcher and records the receiving customer's disposition. `selectFreeFirstProvider` and `isZeroCashProvider` expose the older route's selection and exact zero-cash admission predicates.

`computePurchasePrice` reports exact rational purchase price from catalog rates and witnessed usage; it never estimates tokens. The receipt and pricing-justification CLI commands use that same price implementation.
