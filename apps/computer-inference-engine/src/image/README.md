# image-generation-inference-team

`@red-cup-engineering/image-generation-inference-team` is the house
primitive for provider-fallback image generation: Cloudflare Workers AI
with a sharp-based
print-DPI upscale and a provenance sidecar per generated image
(`src/image-generation.mjs`, `scripts/generate-image.mjs`,
`apps/image-generation-cli.mjs`). It consolidates image-generation client
code that was duplicated between print-on-demand-design-factory-service
and emsenn-one-of-one-artifacts-services-section — both now import it as
their engineering thread-mate rather than hand-rolling provider calls.

## Thread

Five-custody thread (org-layering.md, 2026-09-01):
- science: [artificial-intelligence-science-services-section](../../../../../../../../../science-services-section/services/engineering-science-services-section/services/computer-science-services-section/services/artificial-intelligence-science-services-section) — `content/text/glossary/terms/neural-network.md` grounds the models this package calls (Cloudflare's flux-1-schnell) as neural-network image generators.
- engineering: **this section itself** — `src/image-generation.mjs` is the house primitive.
- operations: [inference-dispatch-service](../inference-dispatch-service) — sibling package under this same parent that governs how inference work is actually contracted/routed to a provider; this package is a provider-facing implementation, not its own dispatcher.
- 561-group: the 561 Group's Cloudflare account custody — the custody this package's default free-tier provider (`callCloudflareWorkersAIImage`) actually runs under.
- public: [public-print-on-demand-services-section](../../../../../../../../../public-services-section/services/public-resources-services-section/services/public-consumer-resources-services-section/services/public-print-on-demand-services-section) — the Fine Print Mercantile shop is the consumer-facing product surfacing this package's generated art (a second consumer, emsenn-one-of-one-artifacts-services-section, is outside this section's custody).

## Entanglement debts

None found: `src/image-generation.mjs` and `scripts/generate-image.mjs`
have no hand-rolled record/receipt writing, evidence math, or EAVT rows —
`buildProvenance` returns a plain object, and any receipt writing happens
in the calling package (see print-on-demand-design-factory-service's own
debt for that pattern).
