# Fibers and the cascade

## Fibers

A **fiber** is every cell currently asserted on a single predicate:

```text
Fib(p) = { (s, o, v) : (s, p, o) ∈ substrate, value v }
```

The predicate indexes. The name is from the paper: each predicate has
a *fiber algebra* `A_p`, and the five morphisms are (bilattice)
homomorphisms between fiber algebras. Specialization lifts a cell
from the source fiber to the target fiber; inversion maps a fiber to
its swap-and-negate image; composition, fusion, and implication take
two source fibers and produce a third.

Operationally, a fiber is `HashMap<(subject, object), Value>`. The
proof engine maintains one per predicate it has seen a cell on, and
exposes it as `Semiotics::fiber(p) -> impl Iterator<...>`.

## The cascade

When an agent witnesses a claim, the substrate does not merely store
it. It **cascades**:

1. Join the incoming value against the existing cell with
   `knowledge_join`. If the cell didn't rise, stop — nothing changed.
2. If the predicate has **watchers** (morphism instances that read
   that predicate as source or auxiliary), fire each watcher. Each
   fires produces zero or more derived claims.
3. Each derived claim re-enters step 1. The wavefront carries an
   **ancestry** — the set of morphism indices it has already been
   derived through — which caps each morphism instance to firing at
   most once per wave, bounding cascade depth independent of fiber
   topology.
4. Settle when the work queue empties.

The paper proves all orbits under iterated extension or restriction
reach a fixed point in at most two steps (Proposition 8). The cascade
terminates because cells monotonically rise under `≤_k` and the
algebra is finite.

The single-writer invariant holds: only the kernel runs cascade.
Multiple agents can witness concurrently, but the hub serializes
their asserts through a single command channel; the cascade sees a
strict sequence of incoming claims.

## Replay

Two mechanisms replay existing cells through new morphisms:

- **Declaration after data.** Declaring a morphism (e.g. asserting
  `(dog, specializes-as, mammal)`) after cells already exist in the
  source fiber triggers a replay: every existing cell is fed through
  the fresh morphism. So `(fido, dog, labrador)` asserted before the
  specialization still lands at `(fido, mammal, labrador)`.
- **Subscription.** When an agent subscribes to a predicate, the hub
  delivers the fiber's current cells as `Message::Event` with an
  empty derivation. This is how newly-connected agents catch up on
  bundle-mounted cells that never entered the event log.

Both replays are what you want: data before declaration and
declaration before data have the same settled outcome.

## Post-closure

After the cascade quiesces, `post_close` raises any remaining
in-scope `None` cells to `Both`. "No information within scope" becomes
"fully indeterminate." This is rare on cells an agent actually reads,
because anything in scope has usually been derived to something
non-`None`; it matters most for the algebraic reasoning in the paper.

## What you won't see

The cascade has no side effects outside the substrate. It does not
send wire messages (the kernel broadcasts *after* the cascade). It
does not call external services (that's what [ports](../architecture/port-roles.md)
are for). It does not allocate history — only the current cell value
is stored; the derivation chain returned to the broadcaster is
transient.

If you want persistence, the kernel writes externally-sourced
assertions to `.mash/`'s event log *after* cascading them; on
reboot, replay reconstructs every cell.

## Reading code

The cascade lives in `mash-math-proof-engine/src/lib.rs`, entry point
`Semiotics::assert`. Walk `propagate`, `try_install_from_trigger`,
`replay_through`, and `derive_via_idx` in that order — together they
are the whole settlement engine, about 200 lines.
