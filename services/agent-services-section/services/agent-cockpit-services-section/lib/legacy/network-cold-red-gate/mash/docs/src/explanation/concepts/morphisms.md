# Morphisms

A **morphism** is a rule that derives new claims from existing ones.
The paper proves exactly five morphism kinds exist in this algebra:

| Kind           | Arity | Derivation                                      |
|----------------|-------|-------------------------------------------------|
| Specialization | 1→1   | `target(s, o) := source(s, o)`                  |
| Inversion      | 1→1   | `target(o, s) := ∼ source(s, o)`                |
| Composition    | 2→1   | `target(s, o) := source(s, o) ∧ₖ aux(s, o)`     |
| Fusion         | 2→1   | `target(s, o) := source(s, o) ⊙ aux(s, o)`      |
| Implication    | 2→1   | `target(s, o) := source(s, o) ⇒ aux(s, o)`      |

These five *kinds* are fixed in Rust as `MorphismKind`. You can
declare as many *instances* of each kind as you like — `dog
specializes-as mammal`, `mammal specializes-as animal`, `animal
specializes-as lifeform`, and so on, each an independent instance.
You cannot add a sixth kind without changing the Rust and the paper.

## Specialization

`(source, specializes-as, target)` says: whatever carries value `v`
in `source`'s fiber also carries `v` in `target`'s fiber, with the
same subject and object.

```text
(fido, dog,    labrador) = T
(dog,  specializes-as, mammal)   ⇒   (fido, mammal, labrador) = T
```

The object rides along as witness — `labrador` is the evidence for
`fido`'s dog-hood, and the same evidence survives the lift.

## Inversion

`(source, inverts-as, target)` says: the subject/object swap of
`source` is `target`, with the value negated.

```text
(alice, loves,       bob)   = T
(loves, inverts-as, loved-by)   ⇒   (bob, loved-by, alice) = F
```

The value negates because inversion in the paper is the
converse-and-negation map. For plain converse lookup without
negation, use `Semiotics::read_subject` directly.

## Composition

Composition is pointwise knowledge-meet (`∧_k`) of two fibers at the
**same** `(s, o)` coordinate. It does not pair across differing
objects; the cell-level rule is

```text
(s, R, o) := ∧_k( (s, P, o), (s, Q, o) )
```

Declaration form — three co-subjected claims assemble one instance:

```text
(anchor, uses-as-composition-left,  P)
(anchor, uses-as-composition-right, Q)
(anchor, composes-into,             R)
```

The declared instance fires only when both premise cells share both
subject and object; the derived cell sits at that same coordinate.
There is no structured pair-O: the object rides through unchanged,
so downstream consumers can filter `claim.object == …` naturally.

When two pieces of evidence you want to combine naturally land at
different objects — `(msg, was-said-in, channel)` and `(msg,
has-body, body)`, say — the cascade will not fuse them. Either
re-encode so the cells share an object, or move the combination
into a port that subscribes-and-caches (the pattern used by
`mash-port-projection-comms-surface`, `-run-dispatcher`, and the
dispatch `Promoter`).

## Fusion

Identical form to composition but with `⊙` instead of `∧_k`:

```text
(anchor, uses-as-fusion-left,  P)
(anchor, uses-as-fusion-right, Q)
(anchor, fuses-into,           R)
```

Same pointwise same-`(s, o)` rule applies:

```text
(s, R, o) := ⊙( (s, P, o), (s, Q, o) )
```

Fusion is the extending operation of the adjunction. `T ⊙ T = T`,
`T ⊙ F = F`, `F ⊙ a = F`, `⊤ ⊙ a = a`. Use it when pairing two
pieces of positive evidence should produce negative evidence if
either side is negative — different from composition, where
disagreement rises to `Both`.

## Implication

```text
(anchor, uses-as-antecedent, P)
(anchor, uses-as-consequent, Q)
(anchor, implies-into,       R)
```

Same pointwise same-`(s, o)` rule:

```text
(s, R, o) := ⇒( (s, P, o), (s, Q, o) )
```

Implication is the restricting operation and is asymmetric — the
antecedent/consequent distinction matters. Under the Chu
identification, implication is linear implication `⊸`.

## Trigger predicates

The eleven names above are **trigger predicates**: reserved
identifiers the proof engine recognizes. Asserting a claim whose
predicate is a trigger installs a morphism *instance*:

| Trigger predicate               | Role                       |
|---------------------------------|----------------------------|
| `specializes-as`                | One-claim (Specialization) |
| `inverts-as`                    | One-claim (Inversion)      |
| `uses-as-composition-left`      | Pair role L (Composition)  |
| `uses-as-composition-right`     | Pair role R (Composition)  |
| `composes-into`                 | Pair target (Composition)  |
| `uses-as-fusion-left`           | Pair role L (Fusion)       |
| `uses-as-fusion-right`          | Pair role R (Fusion)       |
| `fuses-into`                    | Pair target (Fusion)       |
| `uses-as-antecedent`            | Pair role L (Implication)  |
| `uses-as-consequent`            | Pair role R (Implication)  |
| `implies-into`                  | Pair target (Implication)  |

One-claim triggers install on the single claim `(source, trigger,
target)`. Pair triggers accumulate by **declarer subject**: three
claims sharing the same subject (the anchor) complete a declaration
and install the morphism. Incomplete pairs wait; the completing
claim triggers the install and replays existing cells.

See the source table in `mash-math-proof-engine/src/lib.rs`
(`TRIGGERS`) for the canonical list.

## Order doesn't matter

A morphism instance works the same whether the declaration arrives
before the data or after. If the source fiber has cells when the
declaration completes, they replay through the new instance
immediately. The cascade is order-agnostic at the specification
level even though the implementation is strictly sequential.
