# Introduction

MASH is a **predication substrate**. It stores subject-predicate-object
claims over a four-valued algebra, closes them under five morphisms,
and exposes the result as a shared reality that agents witness into
and subscribe to.

The name expands:

- **M**odeled — *logical inference modeling* under predication logic.
- **A**gential — *agential virtual reality*; agents are the only way
  anything happens in the substrate.
- **S**emiotic — *semiotic settlement operations*; the cascade settles
  signs among possible meanings under accumulated evidence.
- **H**ub — the process that owns the substrate.

The lineage is Wiener and Barad, not Shannon and Turing — see the
three lineage chapters in [Explanation](explanation/lineage/beyond-shannon-turing.md)
for the contrast against classical computing, MASH's debt to
cybernetics, and the agential-realist move that grounds the *A* in
MASH.

The algebra is the Belnap 2⊗2 bilattice equipped with the
Busaniche–Cignoli twist-product residuation. The paper

> *The Adjoint Structure of Predication on Bilattice-Valued Fibers*,
> in `library/domains/science/domains/information/texts/`

proves two things we lean on operationally:

1. The *fuse ⊣ restrict* pair is a residuation — a Lambek-style
   adjunction on 2⊗2 — verified exhaustively on all 64 triples.
2. Every bilattice-valued SPO system is a Chu space
   (*2⊗2 ≅ Chu(2, 0)*), so the substrate's extending and restricting
   operations are the multiplicative tensor and linear implication of
   linear logic at the algebra level.

The full formal development is in the
[Mathematics](explanation/mathematics/index.md) section, which splits
into [Finite algebra](explanation/mathematics/finite-algebra.md) (the
worked-out algebraic foundation) and
[Infinite coalgebra](explanation/mathematics/infinite-coalgebra.md)
(research territory on dynamics, bisimulation, and federated
substrates).

## What the substrate is not

- It is not a knowledge graph. Knowledge graphs store facts; the
  substrate stores evidence, and evidence can disagree without
  destroying information (`T ⊔_k F = ⊤`).
- It is not a rule engine. There are five morphisms, fixed in Rust,
  proved exhaustive by the paper. New users cannot add a sixth by
  writing Rust; they declare *instances* of the five through claims
  using reserved trigger predicates.
- It is not a pub/sub bus. Subscription is a convenience layered over
  a settlement process. The wire `Assert` is a state change, not an
  RPC; nothing is returned.
- It is not a Turing machine. There is no tape, no step function, no
  halting condition separate from quiescence. The cascade reaches a
  fixed point in at most two steps (paper, Proposition 8), and that
  is the stopping rule.

## What it is for

MASH's current pilot application is a MUD engine. A MUD is useful
because it exercises every primitive: sessions open and close,
speakers emit utterances observers must receive, world state (rooms,
exits, puppets) evolves under concurrent action, and the interaction
loop is low-bandwidth enough that a newcomer can watch every wire
message go by. If the substrate can't host a MUD without special
cases, the algebra isn't doing the work we claim it is.

The ambition beyond the pilot is an operating system in the same
sense that Plan 9 was: everything is a claim, every agent is a
translator, and the surface area of the system is the set of
predicates declared by its vocab crates.

## How this manual is organized

This book follows the [Diátaxis] framework: the four sections serve
four different purposes and should be read with that in mind.

- **[Tutorial](tutorial/first-vocabulary.md)** — learning-oriented.
  A hands-on walk-through that builds a tiny vocabulary end-to-end.
  Start here if you want to *learn by doing*.
- **[How-to](how-to/write-a-vocabulary.md)** — task-oriented.
  Recipes for specific jobs: writing a vocabulary crate, writing a
  port, writing a scene. Use these when you know what you want to
  accomplish.
- **[Explanation](explanation/lineage/beyond-shannon-turing.md)** —
  understanding-oriented. Lineage, concepts, mathematics,
  architecture. Use these when you want to understand *why* MASH is
  shaped the way it is.
- **[Reference](reference/glossary.md)** — information-oriented.
  Glossary, crate taxonomy, wire protocol, trigger predicates. Use
  these for lookup.

If you are reading this because you opened the `mash/` directory
cold and want to know what you're looking at, a useful path is:

1. [Beyond Shannon and Turing](explanation/lineage/beyond-shannon-turing.md)
   — what the substrate rejects and why.
2. [Values](explanation/concepts/values.md) and
   [Claims](explanation/concepts/claims.md) — the atoms.
3. [Fibers and the cascade](explanation/concepts/fibers-and-cascade.md)
   — how those atoms settle.
4. [Port roles](explanation/architecture/port-roles.md) — how the
   substrate meets the outside world.
5. [Your first vocabulary](tutorial/first-vocabulary.md) —
   hands-on.

About an hour of reading; the code will be legible afterward.

[Diátaxis]: https://diataxis.fr/
