# Contributing

## Build and test

```bash
cargo build --workspace
cargo test  --workspace
cargo clippy --workspace --all-targets
```

The workspace sets `missing_docs = warn` and `clippy::pedantic = warn`
at the workspace root; both are load-bearing, not decorative. Public
items need a doc comment. Panics, errors, and examples are expected
on non-trivial items.

## Taxonomy

Every crate sits in exactly one prefix slot defined by
`docs/src/reference/taxonomy.md`. New crates pick an existing prefix;
introducing a new one is a charter-level decision.

Verify locally before pushing:

```bash
scripts/check-crate-taxonomy.sh
```

## Style

- **Doc comments.** Every `pub` item gets `///` (items) or `//!`
  (modules/crates). The doc tells the reader *why* or *when* to use the
  thing, not *what* it does — the type signature already shows the
  what.
- **Examples.** Concepts crates (`mash-math-*`) carry doctests on
  non-trivial operations. Port crates use integration tests under
  `tests/`.
- **Comments in code.** Default: no inline comments. Only add one when
  the *why* is non-obvious — an invariant, a workaround, a surprising
  choice. Never explain what well-named code already says.
- **`unsafe`.** `deny` at the workspace level. Crates that genuinely
  need it (supervisor, libc interop) `allow` locally with a comment
  explaining why.

## Writing docs

Long-form architecture docs live in `docs/` as an mdBook. Build locally:

```bash
cargo install mdbook
mdbook serve docs
```

Crate-level `//!` docs and the mdBook are complementary:

- Crate `//!` is the API surface. `cargo doc --open` is the target.
- The mdBook is the manual. It motivates, orients, and cross-links,
  and deep-links into rustdoc where appropriate.

## Commit messages

Body summarizes the *why*. The git log is the project's memory when
CRATES.md and the mdBook go silent; a commit that says only "fix
parser" is worse than one that says "parser: accept empty arg so that
`look` without a target resolves to the session's current room."
