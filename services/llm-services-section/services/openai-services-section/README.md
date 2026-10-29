# OpenAI Services Section

This locus contains operational Actor models whose provider-specific boundary
is OpenAI. It is broader than inference: Codex harness, protocol adaptation,
native artifact projection, and provider observation may occupy separate child
loci.

## Layout

- `scripts/run-one-exchange.mjs` is the standalone OpenAI chat-completions
  exchange harness. It takes a context packet, validates it, and either
  performs a bounded exchange or, with `--dry-run`, validates the packet and
  reports credential presence without making a network call.
- `content/` holds the exchange harness's packets, exchange records, and
  preserved legacy contract material.
- `services/codex-harness-services-section/` contains the Codex-specific
  harness, actuator client, and projection service.

Run the general OpenAI harness from this section:

```sh
node scripts/run-one-exchange.mjs content/packets/sample-chat-packet.json --dry-run
```
