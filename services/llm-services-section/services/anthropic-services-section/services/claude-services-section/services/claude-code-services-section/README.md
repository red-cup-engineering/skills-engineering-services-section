# Claude Code Inference Team

This settlement provides bounded pure-text Claude inference through one
production boundary: a signed A2A 1.0 Agent Card carrying canonical typed RMN
effect cells. The customer-side inference-work-lot market selects the standing
offer, forms the compact, and sends the exact operation directly here.

## Material path

1. `content/agent-cards/claude-code-inference-team.json` is the signed offer.
2. `bin/serve-a2a.mjs` exposes the standard A2A face.
3. `src/execute-rmn-inference.mjs` validates RMN, invokes the adapter, forms
   FOUR evidence and a WIT transition, and hires witness-journal RDF for settlement.
4. `run-one-exchange.mjs` maps one packet to one tool-disabled `claude -p`
   process and returns its bounded outcome on stdout. It owns no history.

The adapter passes `--tools ""`, `--strict-mcp-config`, and
`--setting-sources ""`; model output therefore has no ambient tool or project
authority. The accepted model is exactly the model in the signed standing
offer. Provider output remains advisory until customer schema assay and
acceptance.

## Capacity

`content/policies/typed-inference-capacity.json` declares one live request.
The adapter launches the actual Claude process with `flock --no-fork`; the
model process itself owns the kernel lease for its full lifetime. If its
wrapper or caller dies, the still-running model process retains the slot. If
the model process dies, the kernel releases it without stale-lock recovery.

## History and retired carriers

Durable history is only the typed RMN completion and its hired witness-journal RDF named
graph with PROV. An empty `content/exchanges/` after execution is required.
The former JSON cache, LMT operations, executable solicitor, and ancestor
schema-pool dependency are retired by digest under `content/assets/legacy/`.
Those bytes are archival material, never a fallback or replay path.

The current `eip155:31337` account is a development binding. Production use
requires a declared production-chain account and finality profile.

```sh
npm run verify
```
