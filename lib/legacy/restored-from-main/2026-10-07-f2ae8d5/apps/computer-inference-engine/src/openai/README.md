# Shared OpenAI-compatible inference

One provider capability serves the platform, direct exchanges, typed RMN inference and the A2A transport. Provider identity and differences are rows in `content/openai/providers/catalog.json`. NVIDIA, Groq, OpenRouter and GitHub Models directories hold account/offer/evidence data; their executable packages, custom hosts and exchange launchers have been removed.

`dispatch-chat-completion <provider-id|row.json> <packet.json> [--resource-root PATH] [--dry-run]` is the file boundary. `executeProviderMessage(providerId, message, { resourceRoot })` is the platform's direct typed boundary, exported from `./provider-runtime`. `runProviderExchange(providerOrRow, packet, options)` is the common request path. `execute-provider-inference` and `serve-provider-inference` supply stdin and existing contracted-agent A2A transports when needed.

The shared runtime owns credential aliases, kernel request admission, monotone rate state, output bounds, usage, completion carriers and refusal behavior. OpenRouter family rows inherit one execution policy: `requestFields` sends `provider.max_price` of zero (the spend limit no one has raised) and `usage.include`, so each response reports what it cost. Provider policy cannot be widened by packet parameters. NVIDIA preserves customer schema guidance and projected source carriers. Credentials remain in the environment or the supplied resource directory; installed packages contain references only. Account settlement loads only at the typed boundary. Historical signed cards and exchange evidence remain in their data directories.


The packet is `{ model, messages, params?, "max-tokens"? }`. Packet and exchange record contracts come from `content/schemas/inference-exchange.schema.json`, evaluated by the shared computer-data-engine. Invalid records cannot be emitted or persisted.

The catalog records observed model availability and account terms with dates. Provider rosters change: a past successful call is evidence for that date.

`dispatchChatCompletionInOrder` walks `routingPolicy.order` for current application consumers. New standalone work uses the observed inference-work-lot dispatcher and records the receiving customer's disposition. `selectNextProvider` exposes the loop's selection.

What a call cost is the provider's own report on its exchange (`usage.cost`), measured, never computed from a declared rate.
