# Writing a vocabulary crate

A **vocabulary crate** owns a coherent slice of the predicate space.
Its job is to mount baseline claims into the substrate at hub boot —
the predicate declarations, inversion pairs, and morphism
declarations that make every downstream claim on those predicates
intelligible.

This guide walks through `mash-vocab-mud-space` (rooms, exits,
directions, the look composition) as a worked example. It's neither
the smallest vocab nor the largest; it's the one that uses every
idiom.

## 1. Crate layout

```text
crates/mash-vocab-mud-space/
├── Cargo.toml
└── src/
    └── lib.rs
```

No `src/bin/`, no `src/main.rs`. Vocab crates never have binaries —
they run embedded in the hub, mounted by the manifest. If you want
*behavior* over these predicates, that behavior goes in a sibling
`mash-port-*` crate that imports the vocab's constants.

## 2. Cargo.toml

```toml
[package]
name         = "mash-vocab-mud-space"
description  = "Space vocabulary: rooms, exits, directions."
version.workspace      = true
edition.workspace      = true
# ... rest of workspace inheritance

[lints]
workspace = true

[dependencies]
mash-sdk-agent    = { workspace = true }
mash-sdk-client   = { workspace = true }
mash-vocab-core   = { workspace = true }
mash-vocab-intent = { workspace = true }  # for REPORTS_TO
async-trait       = { workspace = true }
```

Two rules the taxonomy check enforces:

- **No `tokio`.** Vocab crates run on the hub's executor through the
  embedded driver; they don't need their own runtime. Their
  `translate` never blocks because the default empty implementation
  is synchronous.
- **No `src/bin/`.** Vocab is declaration, not behavior.

Prefer workspace-level dependency declarations (`{ workspace = true }`)
so crate versions stay aligned.

## 3. The Agent impl

```rust,ignore
use async_trait::async_trait;
use mash_sdk_agent::Agent;
use mash_sdk_client::Claim;

#[derive(Debug, Clone, Copy, Default)]
pub struct Space;

pub const IDENTITY: &str = "mash-vocab-mud-space";

#[async_trait]
impl Agent for Space {
    fn identity(&self) -> &'static str { IDENTITY }
    fn claims(&self) -> Vec<Claim> { /* see below */ }
}
```

Four conventions:

- **Unit struct.** The type carries no data; configuration at
  construction-time belongs in scene crates (instance data) or port
  crates (runtime configuration).
- **`IDENTITY` const.** Matches the crate name, used as the owner
  subject/object on every membership claim.
- **`identity()` returns `&'static str`.** Agents are identified on
  the wire by this name; hand out a stable literal.
- **`claims()` is the only interesting hook.** `translate()` at the
  empty default, since vocabs don't react to events.

## 4. Constants for every predicate

```rust,ignore
/// Thing located at a container.
pub const LOCATED_AT: &str = "located-at";
/// Inversion of [`LOCATED_AT`].
pub const CONTAINS: &str = "contains";
/// Room → exit.
pub const HAS_EXIT: &str = "has-exit";
// ...
```

Every predicate the vocab introduces gets a `pub const &str`. Downstream
crates import and use the constant; a rename in the vocab propagates
through `cargo check` rather than silently going stale in string
literals.

## 5. Mounting the baseline claims

`claims()` returns a flat `Vec<Claim>`. In `mash-vocab-mud-space` it
does four kinds of work:

### (a) Declare the predicates

```rust,ignore
out.push(Claim::new(LOCATED_AT, IS_A_PREDICATE, IDENTITY));
out.push(Claim::new(CONTAINS,   IS_A_PREDICATE, IDENTITY));
```

Every predicate gets `(predicate, is-a-predicate, <owner-identity>)`.
This lets the substrate — and agents subscribing to `is-a-predicate`
— discover what predicates exist without reading Rust source.

### (b) Declare inversion pairs

```rust,ignore
out.push(Claim::new(LOCATED_AT, INVERTS_AS, CONTAINS));
out.push(Claim::new(HAS_EXIT,   INVERTS_AS, EXIT_OF));
out.push(Claim::new(LEADS_TO,   INVERTS_AS, REACHED_VIA));
```

An inversion declaration (`(p, inverts-as, q)`) installs an Inversion
morphism instance: for every `(s, p, o) = v`, the substrate derives
`(o, q, s) = ~v`. See [Morphisms](../explanation/concepts/morphisms.md).

### (c) Canonical terms

```rust,ignore
out.push(Claim::new(DIRECTION_TERM, IS_A_TERM, IDENTITY));
for (long, short) in DIRECTIONS_AND_ALIASES {
    out.push(Claim::new(*long, "is-a", DIRECTION_TERM));
    out.push(Claim::new(*long, SHORTENS_TO, *short));
}
```

Directions aren't *predicates*, they're *terms* — `north`, `south`,
`up`. The vocab declares them as canonical so later crates don't have
to argue about whether "N" and "north" are the same thing.

### (d) Declare composition triggers

Composition fires **pointwise**: both premise cells must share both
subject *and* object for the derived cell to land at that same
coordinate. A good composition candidate is lifecycle gating where
every cell naturally uses the same marker object (often the subject
itself, or a shared sentinel like `"true"`):

```rust,ignore
// is-open ∧ has-all-dependencies-satisfied → is-task-routable
out.push(Claim::new(ROUTABLE_TRIGGER, USES_AS_COMPOSITION_LEFT,  IS_OPEN));
out.push(Claim::new(ROUTABLE_TRIGGER, USES_AS_COMPOSITION_RIGHT, HAS_ALL_DEPENDENCIES_SATISFIED));
out.push(Claim::new(ROUTABLE_TRIGGER, COMPOSES_INTO,             IS_TASK_ROUTABLE));
```

The three co-subjected claims (`ROUTABLE_TRIGGER` is the anchor)
declare: whenever `(task, is-open, "true") = T` and
`(task, has-all-dependencies-satisfied, "true") = T`, derive
`(task, is-task-routable, "true") = T`. The object `"true"` is
carried through unchanged — no structured pair-O.

`ROUTABLE_TRIGGER` is a bookkeeping anchor name
(`"task:routable-trigger"`), not a real entity. A convention: use
`{domain}:{what-it-declares}` so declarations don't collide.

**Different-object pairings go in a port, not the cascade.** If the
two pieces of evidence naturally land at different objects (e.g.
`(msg, was-said-in, channel)` and `(msg, has-body, body)`), the
cascade will not combine them. Re-encode so both cells share an
object, or move the pairing into a subscribe-and-cache port — see
`mash-port-projection-comms-surface` for a worked example.

## 6. A unit test for shape

```rust,ignore
#[test]
fn routable_composition_wired() {
    assert!(Task.claims().iter().any(|c|
        c.subject == ROUTABLE_TRIGGER
        && c.predicate == COMPOSES_INTO
        && c.object == IS_TASK_ROUTABLE
    ));
}
```

Vocab crates test that their `claims()` shape holds — not that the
substrate behaves correctly under them (that's for integration tests
in port crates).

## 7. Mount it

Add the vocab to `mash.toml`:

```toml
[[vocab]]
crate = "mash-vocab-mud-space"
```

The `mash-cli` registry resolves the crate name to its `Agent`
factory. For the resolution to work, you also have to list the
vocab in `mash-cli`'s registry table. (The registry is a
compile-time map; it is verbose on purpose — booting into
arbitrary-named Rust crates isn't something to gain by magic.)

Boot order in the manifest is claims-mount order. If vocab B depends
on vocab A's predicates for its compositions, list A first.

## 8. What vocab claims should *not* do

- **Reference specific instances.** `(alice, located-at, room:void)`
  is scene data, not vocabulary. Vocab declares the shape; scenes
  populate it.
- **Subscribe.** Vocabularies have no `subscriptions()`. Subscribing
  is behavior, which belongs in a port.
- **Side-effect.** `claims()` is pure; it is called once per boot
  and each returned `Claim` is mounted via `knowledge_join`.

## See also

- `mash-vocab-core` — the foundational trigger predicates and
  witnessing primitives.
- `mash-vocab-mud-space` — the example walked through here.
- `mash-vocab-command` — the framework vocab for commands,
  arg-patterns, and the authorization fusion chain; shows how
  `use_as_composition_left/right` + `composes-into` wire up a
  multi-phase gate (environment ∧ capability ∧ state → authorized).
