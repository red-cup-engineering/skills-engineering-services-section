# Mathematics

MASH's substrate is a specific mathematical object — an append-only
store of claims valued in the Belnap 2⊗2 bilattice, closed under
five bilattice homomorphisms, whose extending and restricting
operations form a residuated pair. This section gives the formal
treatment.

It splits into two chapters because the worked-out part and the
open part of the theory have different statuses.

## [Finite algebra](finite-algebra.md)

The substrate as it exists today. Every theorem here is proved in
the paper *The Adjoint Structure of Predication on Bilattice-Valued
Fibers*, and every operation corresponds to Rust code in
`mash-math-*`.

What's covered:

- Lattices, bilattices, and the twist product construction.
- The four-element algebra 2⊗2 and its two orderings.
- Residuation on the twist product (Busaniche–Cignoli 2014): the
  `fuse ⊣ restrict` adjunction, verified exhaustively on all 64
  triples.
- Jakl's identification 2⊗2 ≅ Chu(2, 0) — the substrate is a Chu
  space, and `fuse`/`restrict` are the linear-logic multiplicative
  tensor and linear implication at the algebra level.
- The fiber functor $\mathcal{F} : \mathcal{C}^{\mathrm{op}} \to
  \mathbf{BiLat}$ (paper, Theorem 2) and the five morphism kinds
  that generate it.
- Decidability (Rivieccio–Jung–Jansana 2017) and cascade
  termination (Proposition 8).
- A complete map from the math to the Rust code.

This is the foundation. Almost everything a MASH developer needs to
understand sits here.

## [Infinite coalgebra](infinite-coalgebra.md)

The research frontier. Algebra handles the finite, static picture —
a four-element algebra, finite fibers at rest, the cascade's bounded
termination. **Coalgebra** is the dual picture: the substrate as a
process *unfolding over time*, observed through continuations of
witnessings, reasoned about by coinduction rather than induction.

What this chapter covers:

- The algebra/coalgebra duality: construction versus observation.
- Where coalgebraic structure is already *implicit* in MASH's design
  (the event log as a stream, sessions as unfolding observations,
  the cascade's wavefront).
- What a formal coalgebraic treatment would buy: bisimulation
  between substrates, coinductive process invariants, and a
  principled story for federated substrates.
- Explicit open problems: coalgebraic semantics for 2⊗2-valued
  predication, bisimulation-up-to-knowledge-ordering, and the
  Priestley dual of the fiber functor.

Read this when you want to know what's *not* in the finite-algebra
chapter and why that matters.

## Prerequisites and style

The finite-algebra chapter assumes comfort with: lattice order
theory (meet, join, distributivity), basic category theory (objects,
morphisms, functors), and propositional logic. It does not assume
familiarity with bilattices, residuation, or linear logic — those
are introduced from their definitions.

The infinite-coalgebra chapter assumes the finite-algebra material
plus a tolerance for informal treatment of open questions. Where
proofs exist they are cited; where they don't, this is flagged.

Both chapters cite the paper for proofs. The paper proves things
formally; these chapters translate into prose a working programmer
can follow, with pointers back to the formal sources.

## Read the code alongside

Every operation named in these chapters has a counterpart in Rust:

| chapter section             | code                                                  |
|-----------------------------|-------------------------------------------------------|
| 2⊗2, orderings, operations  | `mash-math-bilattice/src/lib.rs`                      |
| morphism kinds              | `mash-math-inference::MorphismKind`                   |
| the cascade                 | `mash-math-proof-engine/src/lib.rs` (`Semiotics`)     |
| wire types + protocol       | `mash-math-inference::wire`                           |
| `verify_adjunction`         | `mash-math-bilattice::verify_adjunction` (64 triples) |

The `mash-math-*` crates carry extensive doctests; running `cargo
test -p mash-math-bilattice` exercises every operation on concrete
values.
