# NVIDIA Inference Team

This settlement provides bounded NVIDIA NIM inference through one production
boundary: a signed A2A 1.0 Agent Card carrying canonical typed RMN effect
cells. The customer-side inference-work-lot market discovers the provider,
compares its provider-authored offer, forms the compact, and sends the exact
RMN operation directly to this settlement. Provider output remains advisory;
the customer owns schema assay and acceptance.

## Material path

1. `content/agent-cards/nvidia-inference-team.json` is the signed standing
   offer whose exact bounded terms the customer-side market assays.
2. `bin/serve-a2a.mjs` exposes that standard A2A face.
3. `src/execute-rmn-inference.mjs` validates the canonical RMN effect cell,
   acquires the provider-local exclusive request slot, calls the stateless
   network adapter, forms FOUR evidence and a WIT transition, and hires the
   witness-journal RDF provider to settle the witnessed result.
4. `run-one-exchange.mjs` performs only the bounded NVIDIA HTTPS exchange. It
   writes no operational record and owns no alternate settlement history.

There is no executable solicitation duplicate, LMT solicitation path, file
transport, lifetime counter, direct consumer routing, or JSON exchange ledger.
Those displaced carriers are retired by digest under `content/assets/legacy/`
and are not operational.

## Capacity and authority

`content/policies/typed-inference-capacity.json` declares exactly one
provider-request slot. The executor enforces the same shape with the host
kernel's exclusive `flock` lease and a bounded wait; the kernel releases the
lease when the owning process exits or is killed. Policy drift fails offer formation.
This is operational concurrency, not a lifetime usage ceiling or a claim over
the external NVIDIA account.

The lock path is one fixed inode. Its presence is not ownership and it does
not accumulate: only a live kernel lease is authoritative. A free-slot assay
therefore attempts a nonblocking lease; it never infers occupancy from the
file's existence.

Live execution requires provider-local credential and network authority.
Credentials never enter RMN, A2A, WitnessJournal, offers, completions, or customer
receipts. Dry-run validates the same packet without a network call.

## Canonical law and history

- Law: `content/contracts/nvidia-inference-service.rml`
- Signed interface: `content/agent-cards/nvidia-inference-team.json`
- Smart-account identity: `content/evm/accounts/eip155-31337.json`
- Durable history: the hired witness-journal RDF provider, as RDF named graphs with PROV
- Local adapter output: process memory/stdout only; never a second ledger

Accordingly, an empty operational `content/exchanges/` directory after a
successful act is required behavior. Recovery and history come from the typed
RMN object and WitnessJournal named graph, not an adapter-local JSON replay file.

Retired carriers under `content/assets/legacy/` are permanent byte-preservation
material, excluded from operational discovery and execution. They are never a
fallback. Their deletion would require a separate explicit archival amendment
that preserves the recorded digest relation.

The current `eip155:31337` account is a development binding. Production use
requires a declared production-chain account and finality profile.

## Verification

```sh
npm run verify
```

The suite checks exact law/account offer binding, capability refusal, absence
of any exchange-count lifetime cap, capacity-policy/lock equivalence, and
advertised demand bounds.
