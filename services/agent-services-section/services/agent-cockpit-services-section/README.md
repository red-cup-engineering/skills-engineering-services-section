# Agent Cockpit Services Section

This section is the locus for agent-cockpit code — operator-facing surfaces
for supervising multi-agent work: window plans, agent endpoints, personas,
stream sources, and capability-claim coordination. It sits under
`services/agent-services-section`, whose README states that section's scope
as "the root locus for services which project, harness, or write capability
for an agent Actor"; this section specializes that root to the cockpit slice
of the problem — the surfaces a human or supervising Actor watches and drives
multi-agent work through, rather than the harness plumbing that runs an
agent's turns.

## Holdings

- `lib/legacy/computing-with-emacs-cockpit/` — the cockpit module set (8
  `.mts` files under `src/cockpit/`: `agent-endpoint`, `cockpit-config`,
  `cockpit-plan`, `index`, `persona`, `resolve`, `session`,
  `stream-source`), its test (`test/cockpit.test.mjs`), and its serve
  scripts (`scripts/cwe-serve.mts`, `scripts/cwe.mts`), promoted from the
  `2026-07-02-computing-with-emacs` legacy asset archive.
- `lib/legacy/agential-relationality-organizing/` — `cockpit-coordination.mts`
  and `theatre.mts`, plus `cockpit-coordination.test.mjs`, promoted from the
  `2026-06-27-agential-relationality/organizing` legacy asset archive.
- `lib/legacy/bare-cedar-fog-scripts/` — `inject-cockpit.mjs`, promoted from
  the `2026-06-04-bare-cedar-fog-scripts` legacy asset archive.
- `lib/legacy/obsidian-knowledge-vault/` — `src/cockpit.mts` and
  `src/scripts/cockpit.mts`, promoted from the
  `2026-06-20-obsidian-knowledge-vault` legacy asset archive.
- `lib/legacy/network-cold-red-gate/` — MASH platform capture (tree +
  full-history git bundle), pulled 2026-07-31 from cold-red-gate, added
  separately by the coordinator.

## Preserved promotions, not wired packages

Everything under `lib/legacy/` is a preserved promotion: content copied out
of the legacy asset archives into this section so the firm's
cockpit-coordination lineage lives under a service section instead of only
under scattered archive snapshots. None of it is a wired workspace package —
nothing here is linked through `pnpm-workspace.yaml`, has its own
`package.json` participating in the workspace graph, or is otherwise live.
The source archives remain in place at their original legacy paths under
`red-cup-engineering/src/content/assets/legacy/`; nothing was moved or
deleted. See `AGENTS.md` for the operative rules governing this section and
`lib/legacy/SOURCES.md` for exact provenance (source path, sha256, byte
count) of every promoted file.
