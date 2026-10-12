# Engine source distribution boundary

This is an inert source-packaging correction, not a registry release, deployment,
license decision, dependency-resolution claim, or proof of live provider readiness.

## Inclusion contract

The package manifest uses an allowlist instead of `**`. It carries JavaScript
modules under `src` and `scripts` (excluding the historical ledger receiver), plus
exactly named runtime JSON declarations. npm also includes package.json and the
root README automatically. `test/package/distribution-files.json` is the reviewed,
sorted inventory; an additional source file requires updating that inventory.

The runtime JSON closure is deliberate:

- Context and dispatch schemas are loaded by packet/work carriers.
- The OpenAI exchange schema and provider catalog are imported directly; the
  inference CLI and fabric JSONL dispatcher also read that catalog.
- Five allowance declarations are read dynamically by subscription allowances,
  resource pricing and the allowance CLI. These are declarations, not usage logs.
- The customer, provider and semantic-service admission carriers are loaded during
  dispatch/MCP initialization. Excluding them breaks existing public exports.
- The direct-endpoint provider catalog and market agent card preserve the existing
  dispatch CLI resource contracts.

The admission carriers contain existing actor identifiers, display tokens and
loopback addresses. Display tokens are actor labels, not authentication secrets.
No admission policy or credential is created or changed by this patch. These
existing declarations remain explicit reviewed files, not wildcard directories.

## Exclusion contract

All `data` records, state and logs; legacy assets; exchanges; resource environment
files; activation/deployment receipts; account and signing files; historical
ledger scripts; tests; and source-provenance inventories stay outside the tarball.
No repository history or operational record is deleted. Newly added JSON beside
an allowed catalog, allowance or admission file is excluded by default.

Live integrations may still require separately provisioned accounts, machine
state, endpoints and external sibling services. In particular, settlement-account
resolution and resource-price records are environment requirements. Packaging
source does not provision those resources or authorize their use.

## Reproduce without lifecycle scripts or network

From this package directory, run `node --test test/package/distribution.test.mjs`.
The test calls `npm pack --dry-run --json --ignore-scripts --offline` with a fresh
local cache, asserts the exact inventory, checks every exports/bin target and
literal relative module import, and tests exclusion canaries in an isolated
staging directory. Staging lifecycle scripts deliberately fail if executed.
The inventory test prints counts rather than unreviewed historical filenames on
failure. It never calls a provider or publishes a package.

Literal-import checking is not an execution-level integration test or a complete
parser for computed resource paths. The dynamic runtime JSON readers were
reviewed separately above. External workspace dependencies still require the
owning workspace's full verification.

## Qualification scope

The audited baseline is commit `45da463bfd6f6f73b1c1442c4c04bc252a48bd68`.
The Git tree contains 2,244 package files, including 1,824 legacy assets. The
corrected npm inventory contains 212 files. Every included source/resource byte
was fetched from that commit and verified against its Git blob SHA (apart from
the changed package manifest). Excluded paths were represented by inert
placeholders for a filename-complete pack-boundary test; their operational bodies
were not downloaded. Therefore this verifies the corrected pack selection and
included-byte closure, not a byte-identical baseline tarball.

The package remains at its existing version. Workspace dependency versions,
license/provenance approval, full installed-consumer execution and any release
activation remain separate gates. No license is selected or added here.
