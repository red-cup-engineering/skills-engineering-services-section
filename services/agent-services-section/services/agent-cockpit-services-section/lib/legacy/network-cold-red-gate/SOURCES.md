# cold-red-gate source capture

Captured 2026-07-31 over the configured SSH transport from the `emsenn`
account on `cold-red-gate` (`45.76.19.133`).

| Captured path | Collection path | Excluded material |
| --- | --- | --- |
| `/home/emsenn/561/theories/engineering/theories/tech/theories/computing/theories/continuous-computation/theories/artificial-intelligence/theories/agents/theories/agentic-orchestration-platforms/governance/assets/computing/platform/mash` | `mash/` | `.git/`, `target/`, `result/`, `node_modules/` |

- `mash/` is the working tree of the MASH agentic-orchestration platform at
  commit `8b116748571d1b19ad7cae5cb7da188e63571a2e` (committed
  2026-05-09T17:16:31Z, working tree clean at capture time). This copy is
  substantially newer than the local `2026-02-24-mash` legacy snapshot, which
  lacks `Cargo.toml`/`Cargo.lock` and whole modules (`algebra`, `inference`,
  `proof`, `planning`, `teraum`).
- `mash-full-history.bundle` is `git bundle create --all` from the same
  repository: the complete reachable history in one file. Restore with
  `git clone mash-full-history.bundle`.

This is a source snapshot, not a deployment export. The remote checkout on
cold-red-gate was left untouched.
