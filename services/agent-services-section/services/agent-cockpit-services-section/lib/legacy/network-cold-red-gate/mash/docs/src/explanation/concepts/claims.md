# Claims

A **claim** is the atom of the substrate: four fields.

```text
(subject, predicate, object, value)
```

The first three name the triple. The fourth is a [value](values.md) —
`None`, `True`, `False`, or `Both`.

Two flavors of claim type exist in the codebase and the distinction
matters:

- `mash_sdk_client::Claim` — **SPO only**, no value. This is what
  agent code builds to witness into the substrate. The cascade
  assigns the value.
- `mash_math_proof_engine::Claim` — the runtime claim: four fields,
  with `subject/predicate/object` interned as `TermId`s and `value` a
  `Value`. This is what the substrate stores and propagates.
- `mash_math_inference::wire::WireClaim` — the wire-format claim:
  four fields as strings/`Value`, with an ISO-8601 timestamp. This
  crosses the socket.

You can read the distinction as: **agents name things, the substrate
values them, the wire carries both.**

## Interning

Subjects, predicates, and objects are plain strings when they're
entered, but the proof engine interns them into integer `TermId`s on
arrival. Two consequences:

1. A triple is three `u64`s at rest. The cascade is fast because
   every lookup is a `HashMap<(u64, u64, u64), Value>`.
2. Terms are strings, not types. `room:void` and `"character:alice"`
   are terms because they are strings the interner knows. There is
   no prior typing — a predicate does not have a declared domain or
   codomain. The vocab crates establish shapes by declaring morphisms,
   not by declaring schemas.

## Witnessing

Agent code doesn't "store", "insert", or "post" a claim. It
**witnesses** it:

```rust,ignore
handle.witness("alice", "located-at", "room:void")?;
```

The verb is intentional. To witness is to emit evidence — to be the
reason the substrate now carries a cell at this triple. If another
agent also witnesses `("alice", "located-at", "room:brass-ward")`,
the cell is not overwritten: both witnessings stand, and the
knowledge-join of their values is what the substrate carries.

The wire form is `Message::Assert` (the bare SPO with no value; the
kernel folds it in with `Value::True` through `knowledge_join`).

## The cell identity

A **cell** is a specific `(subject, predicate, object)` triple. The
substrate holds at most one cell per triple, and that cell's current
value is the knowledge-join of every witnessing that ever landed on
it. Cells never lower; they only rise under `≤_k`. This monotonicity
is what makes the cascade terminate.

An unasserted triple reads as `Value::None` — the bottom of the
knowledge ordering — but no memory is allocated for it. The substrate
is a sparse map indexed by triple.

## Read paths

The proof engine's `Semiotics` exposes three read shapes:

- `value(s, p, o)` — the cell's current value.
- `fiber(p)` — every `(subject, object, value)` currently asserted
  on predicate `p`. See [Fibers](fibers-and-cascade.md).
- `read_object(subject, predicate)` / `read_subject(predicate, object)`
  — shortcuts for "the unique `True` cell at this partially-specified
  triple," the common functional-fact lookup.

Across the wire, there is no read message. Agents subscribe to a
predicate and the hub replays the fiber's current cells, then streams
future settlements as `Message::Event`. The wire is settlement-oriented;
reads are derived from subscription.

## Provenance

A claim's provenance — who asserted it, when, via what morphism chain
— is not stored on the claim itself. It is stored as *other* claims
in the substrate, using predicates declared by `mash-vocab-core`:
`asserted-by`, `at-time`, `derived-via`, `derived-from`, and so on.
This is self-describing by design: an agent that wants to reason
about provenance subscribes to those predicates; an agent that does
not, doesn't.

## What a claim is not

- A claim is not a message. Messages carry claims across the wire;
  the claim persists and the message does not.
- A claim is not a fact. A fact is a proposition you have settled on;
  a claim is a witnessing of evidence, and a cell can carry `Both`.
- A claim is not a row. Rows live in tables with declared schemas.
  A claim lives in a fiber whose shape is declared, if at all, by
  morphism claims the vocab mounted at boot.
