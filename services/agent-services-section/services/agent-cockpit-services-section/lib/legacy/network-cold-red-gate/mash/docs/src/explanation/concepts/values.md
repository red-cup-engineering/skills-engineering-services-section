# Values

Every claim in MASH carries a value drawn from the four-element Belnap
bilattice **2⊗2**:

| Value  | pair   | meaning                   |
|--------|--------|---------------------------|
| `None` | `(0,0)`| no evidence either way    |
| `True` | `(1,0)`| positive evidence only    |
| `False`| `(0,1)`| negative evidence only    |
| `Both` | `(1,1)`| contradictory evidence    |

The first coordinate of the pair tracks positive evidence; the second
tracks negative evidence. The type is `mash_math_bilattice::Value`.

## Two orderings

The four values carry two simultaneous orderings.

The **truth ordering** (`≤_t`) has `False` at the bottom and `True`
at the top. `None` and `Both` sit as incomparable middles: neither is
more true than the other, because one has no evidence and the other
has all of it.

The **knowledge ordering** (`≤_k`) has `None` at the bottom and `Both`
at the top. `True` and `False` are incomparable middles here: each
carries one piece of evidence, and neither carries more *information*
than the other.

```text
     Truth (≤_t)              Knowledge (≤_k)
         True                      Both
         /  \                      /  \
      Both   None                True  False
         \  /                      \  /
         False                      None
```

Use `truth_leq(a, b)` and `knowledge_leq(a, b)` respectively.

## Merging evidence: knowledge_join

Two agents can independently assert evidence about the same cell and
converge without coordination:

```rust
# use mash_math_bilattice::{knowledge_join, Value};
assert_eq!(knowledge_join(Value::True, Value::False), Value::Both);
assert_eq!(knowledge_join(Value::True, Value::True),  Value::True);
```

`knowledge_join` is commutative, associative, and idempotent — a CRDT
merge. That is why the substrate can accept concurrent writers
without needing total order: whoever asserts later is still joining
against the current value.

When the substrate stores a new claim, it joins the incoming value
against the existing cell and keeps the result. An assertion that
would *lower* the cell is a no-op; an assertion that contradicts the
existing cell raises it to `Both`.

## Negation

`negate(v)` swaps positive and negative evidence: `True ↔ False`;
`None` and `Both` fix. It is involutive (`negate(negate(v)) == v`)
and is how the `Inversion` morphism flips values across a converse
predicate.

## The adjunction: fuse and restrict

Two more operations on 2⊗2 form a residuated pair:

- `fuse(a, b)` — the Lambek product `⊙`, the extending operation.
- `restrict(a, b)` — the Lambek implication `⇒`, the restricting
  operation.

They satisfy, for every `(a, p, q)`:

```text
fuse(a, p) ≤_t q    iff    p ≤_t restrict(a, q)
```

This is the residuation proved in the paper and verified exhaustively
by `mash_math_bilattice::verify_adjunction` on all 64 triples of 2⊗2.

Under the Chu identification *2⊗2 ≅ Chu(2, 0)*, `fuse` is the
multiplicative tensor `⊗` and `restrict` is the linear implication
`⊸` of linear logic — at the algebra level. The cascade's Fusion and
Implication morphisms are these operations lifted to fibers (see
[Morphisms](morphisms.md)).

## Post-closure

After a cascade settles, `post_close` raises `None` to `Both`. The
intuition: within the scope of settlement, "no information" and
"fully indeterminate" are the same state. Outside that scope they
would differ — a cell we haven't asked about yet is genuinely `None`
— but a settled cascade has asked. The operation is a no-op on
`True`, `False`, and `Both`.

The adjunction restricts cleanly to `{True, False, Both}` (paper,
Theorem 5), so post-closure does not break anything.

## Summary

- `Value::{None, True, False, Both}` encodes `(pos, neg)` evidence.
- `truth_leq` is for "is this at least as true as that."
- `knowledge_leq` is for "is this at least as informative."
- `knowledge_join` is the CRDT merge.
- `negate` swaps evidence; it is what inversion uses.
- `fuse ⊣ restrict` is the residuation that drives Fusion and
  Implication morphisms.
- `post_close` cleans up after settlement.

All of this lives in the `mash-math-bilattice` crate. Read its
`src/lib.rs` to see the operations, their doctests, and the
exhaustive verification tests.
