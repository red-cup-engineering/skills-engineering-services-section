---
kind: tool-flake-contribution
title: "mash contributions to a parent polity's Nix flake"
description: "What mash contributes when consumed as a flake input by a parent polity. Schema defined in the polity's `governance/assets/computing/nix-flake.md` (section 13)."

contributes-shell-packages:
  source: "this tool's flake `devShells.${system}.default.nativeBuildInputs`"
  notes: "Provides rustc + cargo + rust-analyzer + clippy + rustfmt + pkg-config. Auto-merged when a polity task-shell lists `mash` in `tool-shell-merge` (e.g., the `.#dev` task-shell)."

contributes-apps: []
contributes-extra-inputs: []
contributes-nixos-modules: []

# mash currently exposes only a devShell from its flake — no
# `packages.default` yet because the workspace MSRV is rust 1.86 and
# nixpkgs-unstable's rustc may lag. When that's resolved, add a
# `mash` (or `mash-engine`) app entry here naming the binary the
# parent flake should expose.

related:
  polity-asset: "../../governance/assets/computing/nix-flake.md (in any consuming polity)"
  this-tools-flake: "flake.nix"
  this-tools-index: "_index.md"
---

# mash — flake contributions

Contribution declaration for mash into a parent polity's Nix flake. Today mash contributes a devShell (Rust toolchain) only. Once the workspace builds reliably under nixpkgs's rustc, add `packages.default` to mash's flake and a `contributes-apps:` entry here so a parent polity can expose `nix run .#mash`.

See the polity's `governance/assets/computing/nix-flake.md` for the schema and the harness migration status.
