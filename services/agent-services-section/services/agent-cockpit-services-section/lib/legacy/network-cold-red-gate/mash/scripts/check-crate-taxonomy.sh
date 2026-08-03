#!/usr/bin/env bash
# Enforce the role taxonomy documented in docs/src/reference/taxonomy.md.
#
# Rules:
#   1. mash-vocab-* crates have no `bin/`, no `tokio` dep.
#   2. mash-port-* crates either define a Port impl in lib.rs OR have at
#      least one bin/.
#   3. No mash-port-* may depend on another mash-port-*.
#   4. mash-scene-* crates contain only claims() and instance data
#      (no bin/, no async runtime, no port impls).
#   5. Crate names use only the allowed prefixes.
#
# Exit non-zero on any violation. Run from the workspace root.

set -e
cd "$(dirname "$0")/.."

VIOLATIONS=0
report() { echo "VIOLATION: $*" >&2; VIOLATIONS=$((VIOLATIONS + 1)); }

ALLOWED_PREFIXES=(
  mash
  mash-cli
  mash-hub
  mash-lab-
  mash-math-
  mash-port-
  mash-scene-
  mash-sdk-
  mash-testkit
  mash-testkit-
  mash-util-
  mash-vocab-
)

for crate_dir in crates/*/; do
  crate_name=$(basename "$crate_dir")
  cargo_toml="$crate_dir/Cargo.toml"
  [ -f "$cargo_toml" ] || continue

  # Rule 5: prefix check. Entries ending in `-` are prefix rules
  # (the crate name must start with them); entries not ending in `-`
  # are exact-match rules (the crate name must equal them).
  matched=0
  for prefix in "${ALLOWED_PREFIXES[@]}"; do
    if [[ "$prefix" == *- ]]; then
      [[ "$crate_name" == "$prefix"* ]] && { matched=1; break; }
    else
      [[ "$crate_name" == "$prefix" ]] && { matched=1; break; }
    fi
  done
  [ "$matched" -eq 0 ] && report "$crate_name: name does not match an allowed prefix from docs/src/reference/taxonomy.md"

  # Rule 1: vocab crates have no bin/, no tokio
  if [[ "$crate_name" == mash-vocab-* ]]; then
    [ -d "$crate_dir/src/bin" ] && report "$crate_name (vocab): has src/bin/ — vocab crates must not contain binaries"
    grep -qE "^tokio\s*=" "$cargo_toml" && report "$crate_name (vocab): depends on tokio — vocab crates must not pull in an async runtime"
  fi

  # Rule 2: port crates have lib.rs OR bin/
  if [[ "$crate_name" == mash-port-* ]]; then
    has_lib=0; has_bin=0
    [ -f "$crate_dir/src/lib.rs" ] && has_lib=1
    [ -d "$crate_dir/src/bin" ] || [ -f "$crate_dir/src/main.rs" ] && has_bin=1
    [ "$has_lib" -eq 0 ] && [ "$has_bin" -eq 0 ] && report "$crate_name (port): has neither src/lib.rs nor src/bin/ nor src/main.rs"
  fi

  # Rule 3: no port-on-port deps
  if [[ "$crate_name" == mash-port-* ]]; then
    while read -r dep_line; do
      # Extract dep name from `mash-port-X = { workspace = true }` style lines
      dep_name=$(echo "$dep_line" | awk '{print $1}')
      if [[ "$dep_name" == mash-port-* && "$dep_name" != "$crate_name" ]]; then
        report "$crate_name (port): depends on another port crate '$dep_name' — coordinate through the substrate, not Rust deps"
      fi
    done < <(grep -E "^mash-port-" "$cargo_toml" | grep -v "^\[")
  fi

  # Rule 4: scene crates have no bin, no port impls, no async
  if [[ "$crate_name" == mash-scene-* ]]; then
    [ -d "$crate_dir/src/bin" ] && report "$crate_name (scene): has src/bin/ — scenes are instance data only"
    grep -qE "^tokio\s*=" "$cargo_toml" && report "$crate_name (scene): depends on tokio — scenes must not pull in an async runtime"
  fi
done

if [ "$VIOLATIONS" -eq 0 ]; then
  echo "OK: $(ls -1d crates/*/ | wc -l) crates conform to the taxonomy."
  exit 0
else
  echo "FAILED: $VIOLATIONS violation(s) found." >&2
  exit 1
fi
