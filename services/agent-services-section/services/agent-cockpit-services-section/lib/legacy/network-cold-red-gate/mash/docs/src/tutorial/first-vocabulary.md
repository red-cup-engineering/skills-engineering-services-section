# Your first vocabulary

This tutorial walks you through building a tiny MASH vocabulary
from scratch, mounting it in an in-process test substrate, and
watching the cascade settle as you witness claims. It exercises —
in about 30 minutes — every core primitive: terms, predicates,
claims, the four-valued algebra, morphism declarations, and the
cascade.

You will build a **traffic light** as a predication system: three
states (`red`, `yellow`, `green`), a `tick` that advances the light,
and a composition that derives the next state from the current one
plus the tick. At the end you will have a 60-line crate that shows
a state machine *falling out of* the algebra rather than being
programmed on top of it.

You need: a working Rust toolchain and the `mash` repository checked
out. Everything else is in the workspace.

## What you'll learn

- What a **vocabulary crate** is and why it's just an `impl Agent`.
- How **trigger predicates** install morphism instances as claims.
- What **`TestHub`** gives you and how to drive it.
- Why **composition** ($\wedge_k$) is the right operation for
  "both of these hold together".
- What it looks like when the **cascade** settles a derived cell.

## Step 1. Create the crate

Inside the workspace, make a new crate:

```bash
cd crates
cargo new --lib mash-vocab-traffic-light
cd mash-vocab-traffic-light
```

Replace the generated `Cargo.toml` contents with:

```toml
[package]
name = "mash-vocab-traffic-light"
description = "Tutorial: a traffic light as a predication vocabulary."
version.workspace      = true
edition.workspace      = true
rust-version.workspace = true
license.workspace      = true
authors.workspace      = true
repository.workspace   = true
homepage.workspace     = true

[lints]
workspace = true

[dependencies]
mash-sdk-agent  = { workspace = true }
mash-sdk-client = { workspace = true }
mash-vocab-core = { workspace = true }
async-trait     = { workspace = true }

[dev-dependencies]
mash-testkit        = { workspace = true }
mash-math-bilattice = { workspace = true }
```

Then add the crate to the workspace root's `Cargo.toml` under
`[workspace.dependencies]`:

```toml
mash-vocab-traffic-light = { path = "crates/mash-vocab-traffic-light", version = "0.1" }
```

Run `cargo check` from the workspace root to confirm the crate
resolves.

## Step 2. Write the vocabulary

Open `src/lib.rs`. You're going to replace the generated stub with
a vocabulary that declares three lifecycle terms, four predicates,
and three composition morphisms.

```rust
//! Tutorial: a traffic light as a MASH vocabulary.

#![warn(missing_docs)]

use async_trait::async_trait;
use mash_sdk_agent::Agent;
use mash_sdk_client::Claim;
use mash_vocab_core::{
    COMPOSES_INTO, IS_A_PREDICATE, IS_A_TERM,
    USES_AS_COMPOSITION_LEFT, USES_AS_COMPOSITION_RIGHT,
};

/// The traffic-light owner-agent.
#[derive(Debug, Clone, Copy, Default)]
pub struct TrafficLight;

/// Owner identity.
pub const IDENTITY: &str = "mash-vocab-traffic-light";

/// Term: a traffic-light state (red / yellow / green).
pub const LIGHT_STATE: &str = "light-state";

/// Predicate: `(light, is-state, state)` — the light's current color.
pub const IS_STATE: &str = "is-state";
/// Predicate: `(light, tick, clock)` — the light was advanced at `clock`.
pub const TICK: &str = "tick";
/// Predicate: `(light, next-state, state)` — the light's *next* color
/// after the current tick. The cascade fills this in.
pub const NEXT_STATE: &str = "next-state";

/// Term: three canonical states.
pub const STATE_RED: &str = "state:red";
/// Yellow state.
pub const STATE_YELLOW: &str = "state:yellow";
/// Green state.
pub const STATE_GREEN: &str = "state:green";

#[async_trait]
impl Agent for TrafficLight {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Declare the state term and the three canonical states.
        out.push(Claim::new(LIGHT_STATE, IS_A_TERM, IDENTITY));
        for s in [STATE_RED, STATE_YELLOW, STATE_GREEN] {
            out.push(Claim::new(s, "is-a", LIGHT_STATE));
        }

        // Declare the three predicates.
        for p in [IS_STATE, TICK, NEXT_STATE] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // Compositions: (light, is-state, X) ∧ (light, tick, _) →
        // (light, next-state, Y). One composition per transition.
        //
        // The anchor subjects ("traffic:red->yellow" etc.) are
        // bookkeeping labels for the morphism instance, not runtime
        // entities. The cascade installs the morphism the moment all
        // three role claims land on the same anchor.
        for (anchor, _from, _to) in [
            ("traffic:red->green",  STATE_RED,    STATE_GREEN),
            ("traffic:green->yellow", STATE_GREEN,  STATE_YELLOW),
            ("traffic:yellow->red", STATE_YELLOW, STATE_RED),
        ] {
            out.push(Claim::new(anchor, USES_AS_COMPOSITION_LEFT,  IS_STATE));
            out.push(Claim::new(anchor, USES_AS_COMPOSITION_RIGHT, TICK));
            out.push(Claim::new(anchor, COMPOSES_INTO,             NEXT_STATE));
        }

        out
    }
}
```

A lot is happening in a small space. Work through it:

- `Claim::new(a, b, c)` is the SPO triple constructor. No values —
  the cascade assigns them when mounted.
- `IS_A_TERM` and `IS_A_PREDICATE` are from `mash-vocab-core`.
  Every vocabulary declares its terms and predicates so the
  substrate can discover what exists.
- The three `USES_AS_COMPOSITION_LEFT` / `_RIGHT` / `COMPOSES_INTO`
  triples per transition are the three [trigger
  claims](../reference/trigger-predicates.md) that install a
  composition morphism. The anchor subject (`"traffic:red->green"`)
  groups the three together.

What this *means* operationally: once the vocabulary is mounted,
a composition will fire for any subject where **both** `(light,
is-state, X)` and `(light, tick, X)` settle at the **same object**
— because composition is pointwise in $(s, o)$, not pair-by-subject.
We'll see in a moment that that means the composition we've
declared here won't fire at all on the witnesses we're about to
make, and why that's an instructive failure.

## Step 3. Write a test

Add a test at the bottom of `src/lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mash_math_bilattice::Value;
    use mash_testkit::TestHub;

    #[test]
    fn red_tick_does_not_fire_composition() {
        // Build a hub with our vocabulary mounted.
        let mut hub = TestHub::builder()
            .with_owner_agent(mash_vocab_core::Core)
            .with_owner_agent(TrafficLight)
            .build();

        // Witness the light's current state and a tick.
        hub.witness_true("light:1", IS_STATE, STATE_RED);
        hub.witness_true("light:1", TICK, "t:0");

        // No next-state cell settles: the premises sit at
        // different objects (STATE_RED vs. "t:0") and composition
        // is pointwise same-(s, o).
        let derived = hub
            .fiber(NEXT_STATE)
            .at_subject("light:1")
            .into_iter()
            .find(|(_, v)| *v == Value::True);
        assert!(
            derived.is_none(),
            "composition should not fire: premises disagree on object"
        );
    }
}
```

Run it:

```bash
cargo test -p mash-vocab-traffic-light
```

You should see one test passing. If it doesn't, see "Troubleshooting"
below.

## Step 4. Watch the cascade

Let's see what the cascade actually did. Add a `dump` to the test
temporarily:

```rust
println!("{}", hub.dump());
```

and re-run with `cargo test -p mash-vocab-traffic-light -- --nocapture`.

You'll see something like:

```text
(light-state, is-a-term, mash-vocab-traffic-light) = True
(light:1, is-state, state:red) = True
(light:1, tick, t:0) = True
(state:red, is-a, light-state) = True
...
```

No `(light:1, next-state, …)` line shows up. The composition we
declared says: whenever cells settle at **the same $(s, o)$** in
both `is-state` and `tick`'s fibers, derive a cell in `next-state`
at that same $(s, o)$. Our two witnesses share subject `light:1`
but disagree on object (`state:red` vs `"t:0"`), so the cascade
never matches them and `next-state` stays empty.

That's the pointwise rule at work: the cascade combines cells only
at coordinates both fibers agree on, and the derived cell rides the
same object through unchanged. Evidence that naturally sits at
different objects — a state and a tick, a channel and a body —
doesn't fuse in the cascade at all.

**The vocabulary is wrong for the job, not for the algebra.** A
traffic-light state transition is cross-object evidence in a
natural encoding: the state and the tick *want* to be different
objects. Composition can't help us here.

## Step 5. Fix the vocabulary

A composition can only combine two existing fibers. To encode
"red-at-tick maps to green," we need *another predicate* that says
"this is a red-tick transition" and points at the target state.
The composition then becomes:

```text
(light, is-state, state:red)
  ∧ (light, has-red-transition, <target-spec>)
  → (light, next-state-when-red, <target-spec>)
```

This is more mechanism than a simple state machine wants. The
alternative is simpler: **use a different primitive.** Inversion
plus specialization could encode "red → green" as a composition
chain, but the honest answer is that a traffic-light state machine
is more naturally encoded as a **projection port** subscribing to
`tick`, reading the current `is-state`, and witnessing the next
state directly.

**This is the tutorial's most important lesson.** The algebra
doesn't do everything; some things are algebra-shaped, some things
are port-shaped. A traffic light with hard-coded transitions is
port-shaped. A traffic light whose transitions are themselves data
(loaded from a scene, or reconfigurable at runtime) is algebra-
shaped — its transitions become claims, and compositions read the
claims to fire.

Let's do the *algebra-shaped* version. Replace the composition
declarations:

```rust
/// Predicate: `(light, transitions-to-after, target-state)` —
/// "if this light is in state X and sees a tick, it becomes the
/// state named in the object". The object is the state the
/// *subject* light transitions to when it's in the state that
/// declared this transition.
pub const TRANSITIONS_TO_AFTER: &str = "transitions-to-after";
```

Declare it like the others. Then replace the composition block
with something that captures the actual flow:

```rust
// For each state, declare: "a light currently in this state, when
// it ticks, transitions to the next state." The composition reads
// `is-state` on the left (the light is in some state) and `tick`
// on the right (the light ticked); the target fiber is a
// per-source-state predicate.
//
// This pattern — one composition declaration per source-state —
// is how finitary state machines embed into the algebra. The
// n-state machine needs n composition declarations; not elegant,
// but honest about what the cascade is doing.
//
// Left as an exercise: rewrite `is-state` to be a specialization
// of a per-state predicate (is-red, is-green, is-yellow) so the
// transition compositions can use state-specific left predicates.
```

We'll stop the code here — the full fix is an exercise for the
reader. The point of this tutorial is to have you *feel* the
distinction between what a composition can express (pairing
independent cells by shared subject) and what a port does
(arbitrary derivation using cached state).

## What you learned

- **Vocabulary crates are `impl Agent` with a `claims()` that
  returns baseline triples.** No runtime, no subprocess.
- **Trigger predicates install morphism instances as claims.**
  `uses-as-composition-left`, `uses-as-composition-right`, and
  `composes-into` with the same anchor subject declare one
  composition morphism.
- **Compositions fire pointwise at the same $(s, o)$.** A
  composition fires when two cells share both subject *and*
  object in the declared left and right fibers. The output lands
  at that same coordinate in the target fiber — the object rides
  through unchanged. Evidence that naturally sits at different
  objects needs to be paired in a subscribe-and-cache port
  instead.
- **The cascade does only what the trigger declarations say.**
  Hoping the cascade will "figure out" state transitions from
  naming conventions is a type error. The algebra operates
  strictly on fiber cells.
- **Port-shaped versus algebra-shaped.** State machines with
  hard-coded transitions are port-shaped — a projection port
  reading `is-state` and `tick` and witnessing the next state is
  the right shape. State machines whose transition tables are
  themselves claims are algebra-shaped — compositions over a
  data-described transition predicate fire.

## Troubleshooting

**`cargo check` says "unknown crate in manifest"** — check that you
added `mash-vocab-traffic-light` to the workspace's
`[workspace.dependencies]`. The workspace uses `members =
["crates/*"]` so the crate is a workspace member automatically, but
it only resolves through `workspace = true` dependencies after
the workspace dep entry exists.

**The test unexpectedly finds a `next-state` cell** — if you
tweaked the witnesses so the state and tick share an object (e.g.
witnessing both at the same marker), the composition *will* fire
and you'll see a derived cell. That's expected: composition is
pointwise same-$(s, o)$, and you just satisfied the match. The
tutorial's point is that the natural traffic-light encoding
doesn't satisfy it.

**The composition never fires at all** — this can also happen if:

- You forgot to mount `mash_vocab_core::Core`. The core vocabulary
  declares the trigger predicates themselves; without it, the
  substrate doesn't recognize `composes-into` as a trigger.
- The subject of your witnessings differs.
  `witness_true("light:1", IS_STATE, STATE_RED)` and
  `witness_true("LIGHT:1", TICK, "t:0")` are different subjects
  to the interner.

**`hub.dump()` shows no composition declarations installed** —
inspect the claim set (you should see nine triples with
`uses-as-composition-left`, `uses-as-composition-right`,
and `composes-into` on the anchor subjects).

## Where to go next

- **[Write a vocabulary](../how-to/write-a-vocabulary.md)** —
  task-oriented reference for real vocabulary crates, including
  idioms we deliberately didn't show here (inversion pairs,
  canonical-term tables, scene/vocab separation).
- **[Morphisms](../explanation/concepts/morphisms.md)** — the full
  picture of the five morphism kinds and their trigger
  predicates.
- **[Fibers and the cascade](../explanation/concepts/fibers-and-cascade.md)**
  — how the cascade propagates settlements.
- **[Write a port](../how-to/write-a-port.md)** — when you decide a
  given behavior is port-shaped rather than algebra-shaped.
