{
  description = "MASH — Modeled Agential Semiotic Hub: a predication substrate over the Belnap 2⊗2 bilattice (Rust)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Workspace package version, pulled from Cargo.toml. Single
        # source of truth — bump in Cargo.toml [workspace.package],
        # not here.
        cargoToml = builtins.fromTOML (builtins.readFile ./Cargo.toml);
        version = cargoToml.workspace.package.version;

        # Build the entire mash workspace with rustPlatform. nixpkgs's
        # rustc is 1.94+, well past mash's 1.86 MSRV. If a future
        # MSRV or specific channel pin becomes load-bearing, swap to
        # `fenix.toolchainOf { ... }` and the rest of this stays.
        mash = pkgs.rustPlatform.buildRustPackage {
          pname = "mash";
          inherit version;
          src = ./.;
          # Local dev iteration uses Cargo.lock; vendoring is automatic.
          cargoLock = {
            lockFile = ./Cargo.lock;
          };
          # Build all workspace crates. The mash-library crate ships
          # multiple binaries (mash, mash-conduit-stdio, mash-conduit-telnet,
          # mash-sensor-file, mash-effector-shell, mash-effector-container,
          # mash-effector-llm) — all land in result/bin/.
          cargoBuildFlags = [ "--workspace" ];
          # Tests run under `nix flake check`. Deferred for now —
          # workspace tests are slow on cold paths and a binary cache
          # makes that better. Re-enable once one is in place.
          doCheck = false;
        };

      in {
        packages = {
          inherit mash;
          default = mash;
        };

        apps.mash = {
          type = "app";
          program = "${mash}/bin/mash";
        };
        apps.default = self.apps.${system}.mash;

        devShells.default = pkgs.mkShell {
          name = "mash-dev";
          packages = with pkgs; [
            rustc
            cargo
            rust-analyzer
            clippy
            rustfmt
            git
            pkg-config
          ];
          shellHook = ''
            echo "MASH development shell"
            echo "  rustc:  $(rustc --version 2>/dev/null || echo missing)"
            echo "  cargo:  $(cargo --version 2>/dev/null || echo missing)"
            echo "  build:  cargo build --workspace"
            echo "  test:   cargo test --workspace"
          '';
        };
      });
}
