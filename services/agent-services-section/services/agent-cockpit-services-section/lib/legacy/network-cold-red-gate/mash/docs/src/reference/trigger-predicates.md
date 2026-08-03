# Trigger predicates

Eleven reserved predicate names. Asserting a claim whose predicate is
one of these installs a morphism *instance* in the proof engine.

The list is closed: the algebra has five morphism kinds (paper,
§2–§3) and these are the reserved names the proof engine recognizes
for their declaration. Users cannot add trigger predicates without
changing Rust *and* extending the paper.

## One-claim triggers

A single claim completes the declaration.

| Predicate         | Morphism       | Reads as                                    |
|-------------------|----------------|---------------------------------------------|
| `specializes-as`  | Specialization | `(source, specializes-as, target)`          |
| `inverts-as`      | Inversion      | `(source, inverts-as, target)`              |

The claim's subject is the source predicate; the object is the
target predicate.

## Pair triggers

Three co-subjected claims — same declarer subject — complete one
declaration. The subject is an anchor; its role is bookkeeping.

### Composition

| Predicate                       | Role                        |
|---------------------------------|-----------------------------|
| `uses-as-composition-left`      | First operand predicate     |
| `uses-as-composition-right`     | Second operand predicate    |
| `composes-into`                 | Target predicate            |

Declares `target(s, o) := left(s, o) ∧ₖ right(s, o)`, paired by
subject. Commutative.

### Fusion

| Predicate                  | Role                        |
|----------------------------|-----------------------------|
| `uses-as-fusion-left`      | First operand predicate     |
| `uses-as-fusion-right`     | Second operand predicate    |
| `fuses-into`               | Target predicate            |

Declares `target(s, o) := left(s, o) ⊙ right(s, o)`. Commutative.

### Implication

| Predicate                | Role                  |
|--------------------------|-----------------------|
| `uses-as-antecedent`     | Antecedent predicate  |
| `uses-as-consequent`     | Consequent predicate  |
| `implies-into`           | Target predicate      |

Declares `target(s, o) := antecedent(s, o) ⇒ consequent(s, o)`.
Asymmetric — antecedent and consequent are not interchangeable.

## Rules

- **Only `Value::True` triggers install.** A trigger predicate
  asserted at `False` or `Both` is stored as an ordinary cell but
  does not install anything. You don't "un-declare" a morphism by
  disputing the declaration claim; you simply never declare it.
- **Pair triggers accumulate.** A declaration isn't live until all
  three role claims share the same subject. Partial declarations
  wait.
- **Re-asserting is idempotent.** Asserting the same trigger claim
  twice does not install two copies of the same morphism.
- **Declaration and data are order-independent.** Declaring a
  morphism after its source fiber has cells replays those cells
  through it. Declaring first and then feeding cells works the same
  way. The settled state does not depend on order.

## Canonical constants

All eleven names are exported from `mash_vocab_core`:

```rust,ignore
use mash_vocab_core::{
    SPECIALIZES_AS, INVERTS_AS,
    USES_AS_COMPOSITION_LEFT, USES_AS_COMPOSITION_RIGHT, COMPOSES_INTO,
    USES_AS_FUSION_LEFT, USES_AS_FUSION_RIGHT, FUSES_INTO,
    USES_AS_ANTECEDENT, USES_AS_CONSEQUENT, IMPLIES_INTO,
};
```

Prefer the constants over literal strings so renames or typos fail
at compile time.

## Source of truth

The recognizer table is `TRIGGERS` in
`crates/mash-math-proof-engine/src/lib.rs`. The trait-level installer
and replay logic live in the same file under
`try_install_from_trigger` / `install_one_claim` /
`install_pair_role` / `replay_through`.
