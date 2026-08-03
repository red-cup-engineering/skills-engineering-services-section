---
title: "MASH"
description: "Modeled Agential Semiotic Hub — a Rust predication substrate over the Belnap 2⊗2 bilattice. The Rust port of pypredcomp; both pass the same conformance vectors byte-identically."
component-of: predicated-computing
nix-package:
  input-name: mash
  flake-url: "git+ssh://git@github.com/emsenn/mash"
  follows-inputs: [nixpkgs, flake-utils]
  package-name: mash
  notes: "devShell-only; packages.default deferred until rust-toolchain MSRV (1.86) story is settled. Consumed by the polity flake via tool-shell-merge for the .#dev shell."
---

# MASH

The Rust implementation of the predicated-computing OS substrate. One process, one Unix-domain socket, one append-only store of subject–predicate–object claims closed under five morphisms and behaving as a CRDT under concurrent writers. The lineage is Wiener and Barad, not Shannon and Turing.

The name is load-bearing:

- **M**odeled — *logical inference modeling* under predication logic.
- **A**gential — *agential virtual reality*; agents are the only way anything happens.
- **S**emiotic — *semiotic settlement operations*; the cascade settles signs among possible meanings.
- **H**ub — the process that owns the substrate.

See:

- [`README.md`](README.md) — current shape, boot instructions, source layout
- [`flake.nix`](flake.nix) — mash's own flake (devShell only for now)
- [`Cargo.toml`](Cargo.toml) — workspace declaration; crates live under [`crates/`](crates/)
- [`docs/`](docs/) — developer documentation

## Maintainer note

This entry's `nix-package:` block is what the parent polity's `nix-flake` harness reads to declare mash as a flake input. Update `flake-url:` if mash's canonical remote changes; update `package-name:` once a default package is added to the flake.
