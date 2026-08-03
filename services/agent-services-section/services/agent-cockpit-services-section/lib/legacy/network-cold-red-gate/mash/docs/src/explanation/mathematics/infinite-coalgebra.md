# Infinite coalgebra

> **Status.** Research territory. The
> [finite-algebra chapter](finite-algebra.md) is the worked-out
> foundation MASH runs on today. This chapter is honest about which
> parts are formal (cited), which are informal (gestures at formal
> treatments in the literature), and which are open.

The finite-algebra picture treats the substrate as an object: a set
of cells valued in a four-element algebra, closed under five
homomorphisms, reaching quiescence in a bounded number of steps.
That picture is complete for the statics.

But a running MASH substrate is not static. Claims arrive over
time; the event log lengthens without bound; sessions open, live,
and close; cascades fire in sequence. Reasoning about *this*
substrate — dynamics, not configurations — wants a different
category-theoretic tool: **coalgebra**, the categorical dual of
algebra.

This chapter lays out what that means, where coalgebraic structure
is already implicit in MASH's design, what formal treatment would
buy, and what's open.

## 1. Algebra and coalgebra, dually

For an endofunctor $F : \mathcal{C} \to \mathcal{C}$:

- An **$F$-algebra** is a pair $(A, \alpha)$ with $\alpha : F(A) \to
  A$. Reading: "given an $F$-shaped combination of constituents,
  produce an $A$." Algebras encode **construction**.
- An **$F$-coalgebra** is a pair $(A, \gamma)$ with $\gamma : A \to
  F(A)$. Reading: "given an $A$, observe an $F$-shaped
  continuation." Coalgebras encode **observation**, and dually to
  algebra's constructive focus, observation reasons about what
  unfolds.

Induction reasons about algebras: to prove a property on every
constructed element, check each constructor. Coinduction reasons
about coalgebras: to prove two coalgebras indistinguishable through
any observation, exhibit a **bisimulation** — a relation closed
under the observation functor.

The two pictures handle different sides of the same story.
Construction produces a "smallest" (initial) algebra; observation
admits a "largest" (final) coalgebra. Initial algebras give rise
to inductive types; final coalgebras give rise to streams, infinite
processes, and coinductive types.

Rutten's 2000 *Universal coalgebra: a theory of systems* is the
foundational reference; Jacobs's 2017 textbook is the standard
modern treatment.

## 2. What's algebraic in MASH today

The finite-algebra chapter covers the algebraic side exhaustively:

- The bilattice $\mathbf{2} \otimes \mathbf{2}$ is the free bounded
  distributive bilattice on one generator — an *initial* object in
  its variety. `fuse` and `restrict` are operations *on* it.
- Fiber algebras $A_p$ are algebras in $\mathbf{BiLat}$.
- The fiber functor $\mathcal{F}$ takes a predicate-category to its
  bilattice-algebra assignment — covariant on predicate morphisms,
  contravariant by specialization.
- The cascade is an iteration that builds a fixed point from below
  in the knowledge ordering.

Everything here is construction: starting from witnessings, build
settled cells.

## 3. What's coalgebraic in MASH today — implicitly

Several parts of the running system have coalgebraic shape even
though we haven't formalized them that way.

### The event log as a stream

The event log is `AssertionRecord^\*` growing to the right: at each
moment there's a finite prefix, but the log as a "thing the
substrate could be in the future" is a potentially infinite
sequence. A stream $s : \mathbb{N} \to A$ is the classical example
of a coalgebra — specifically, a coalgebra for $F(X) = A \times X$,
whose final coalgebra is the type of streams.

Operationally: `mash-util-store`'s replay pumps the stream into a
fresh `Semiotics`. The substrate after replay is the finite
algebraic fold of a potentially infinite stream.

### Sessions as unfolding observations

A session at any moment has a history of witnessings and a
continuation of possible futures. The `SessionId`-indexed record on
the hub kernel (`Hub::sessions`) plus the hub's outbound channels
collectively form the observations available through that session.
A session isn't an inductive object ("assembled from constructor
applications"); it's a coinductive object ("unfolds into future
observations").

Session lifecycles (`is-newly-connected` → spawn flow → play →
`ended-at`) are naturally described as trace specifications on a
coalgebra, not as functional transformations. MASH handles them
today by composition and projection (both algebraic); a coalgebraic
treatment would let us reason about session invariants
coinductively — e.g., "an authenticated session always eventually
sees an acknowledgement of its commands, regardless of the cascade's
schedule."

### The cascade wavefront as a transition

`Semiotics::assert` runs one wave to quiescence. But externally, a
substrate goes through a sequence of such waves as external
assertions arrive. Viewing `Semiotics` as a state machine:

$$\gamma : \mathrm{Semiotics} \to \mathrm{Semiotics} \times
(\text{wire event})^*$$

is a coalgebraic description of the substrate-as-dynamical-system.
Two substrates are **bisimilar** if they cannot be distinguished
by any sequence of external assertions (coalgebra-morphism level):
for every assertion one reacts to, the other reacts equivalently.
This is a formal candidate for "functionally equivalent substrate
configurations" — useful for migration, federation, and testing.

### Priestley duality, already done on the small side

Jung & Rivieccio (2012, "Priestley Duality for Bilattices") already
supply the dual-topological side of our bilattice algebra. The
Priestley dual of $\mathbf{2} \otimes \mathbf{2}$ is a specific
two-point space with an involution. That's the starting point of a
coalgebraic semantics for the modal calculus living on fibers:
Priestley spaces compose with the coalgebraic modal operators of
Rivieccio, Jung, & Jansana (2017) to produce a coalgebraic semantics
of the decidable four-valued modal logic.

MASH doesn't use modal operators in its cascade yet (composition,
fusion, implication are finitary). They are available in the
algebra and decidable; using them would pull in the coalgebraic
side formally.

## 4. What a formal coalgebraic treatment would buy

### Bisimulation as substrate equivalence

Today, "these two substrates have the same claims" reduces to
deep-equal on `HashMap<(TermId, TermId, TermId), Value>` after
alpha-normalizing interner identities — a syntactic test. Syntactic
equality is the wrong equivalence: two substrates that differ only
in interner id ordering are operationally identical but syntactically
different; two substrates with identical cells but divergent
derivation histories are operationally different but syntactically
identical.

**Bisimulation** is the observationally-correct equivalence. Two
substrates $S_1, S_2$ are bisimilar iff there's a relation $R$ on
their states such that every external assertion $a$ takes $R$-related
pairs to $R$-related pairs, with matching outbound events.
Concretely: they are indistinguishable to any possible observer
using only the wire protocol.

A bisimulation-based equivalence would unlock:

- **Principled snapshot testing.** Tests that don't break under
  interner renumbering, event ordering permutations that happen to
  produce the same settled cells, etc.
- **Substrate migration.** Moving a live substrate between hosts is
  correct iff the destination is bisimilar to the source; this gives
  a formal spec for what "correctly migrated" means.
- **Federation.** Two substrates merged via some combinator are
  bisimilar to a single substrate iff the combinator respects the
  coalgebraic structure. Federation is currently ill-defined in
  MASH; coalgebra names what a correct notion would look like.

### Coinductive invariants

Algebraic invariants are proved by induction on witnessing history:
"if we assert no claims violating P, then no cell ever violates P."
Useful but finite-history.

**Coinductive invariants** are of the form "from *any* reachable
substrate state, the continuation satisfies Q." Example: "any
session whose welcome flow completes eventually receives an
`ended-at`" — this is a coinductive property about the session's
future, not about its history. Proving it requires coinductive
methods (a bisimulation showing the "Q holds" relation is
preserved by every transition).

For long-running systems — MUD worlds, federated realities,
autonomous-agent deployments — coinductive invariants are the
interesting ones. MASH cannot currently state them formally.

### A principled story for federation

MASH's wire protocol is one-substrate-one-socket. A federation
between substrates would want them to exchange cells under
constraints (privacy, partial views, authority boundaries) without
collapsing into a single state.

Coalgebraic composition provides the formal tools. Products of
final coalgebras, span morphisms, coalgebraic refinement — these
are how one reasons about "two systems that observe each other
partially" in a way that doesn't presuppose a global state.

MASH hasn't designed federation yet. When it does, coalgebra is
the framework to use.

## 5. Concrete open problems

A non-exhaustive list of research directions:

1. **Coalgebraic semantics for 2⊗2-valued predication.** Rivieccio,
   Jung, & Jansana 2017 gives decidability for the modal calculus
   via a Kripke-style semantics. Restating this coalgebraically
   (for a specific endofunctor on Priestley spaces) would give a
   uniform framework for adding modal operators to MASH's cascade.

2. **Bisimulation-up-to-knowledge-ordering.** Two cells are
   operationally equivalent if their settlement under *any
   continuation* agrees. Standard bisimulation asks for exact
   equivalence; a bilattice-valued bisimulation would be
   "$\leq_k$-refined," relating cells whose future can only become
   $\leq_k$-compatible.

3. **Final coalgebra of substrates.** Characterize the final
   coalgebra of the endofunctor $F(S) = S \times \mathrm{Event}^*$.
   This should give the "universal substrate" against which any
   concrete substrate is a homomorphism — useful for stating
   implementation correctness as a morphism into this universal
   object.

4. **The fiber functor's dual.** $\mathcal{F} : \mathcal{C}^{\mathrm{op}}
   \to \mathbf{BiLat}$ is defined algebraically. Via Priestley
   duality, there is a dual functor $\mathcal{F}^\circ$ from
   $\mathcal{C}$ to a category of Priestley spaces with involution.
   Characterizing $\mathcal{F}^\circ$ explicitly should give the
   coalgebraic side of the substrate "for free."

5. **Productive sessions as corecursive types.** Sessions that never
   halt (a MUD's telnet listener, a log-forwarder) are productive:
   they always produce the next observation, never stuck, never
   diverging in a non-productive way. A corecursive type theory
   (Sized Types, Copatterns) captures this — and could give MASH
   typed guarantees about session liveness.

6. **Coalgebraic treatment of cross-object evidence joining.**
   Composition, fusion, and implication do not manufacture
   structured pair-O objects — they fire pointwise at a shared
   $(s, o)$ — but combining evidence across differing objects is
   still a real need, handled now by subscribe-and-cache ports
   (`comms-surface`,
   `run-dispatcher`, dispatch `Promoter`). A coalgebraic account
   would characterize those ports as stateful corecursive
   observers of the cascade's fibers, possibly as the greatest
   fixed point of the "accumulate-until-quorum-then-emit"
   endofunctor.

These are not blockers. MASH runs today without any of them. They
are directions to look when the finite-algebra picture starts to
feel like it's missing tools — and it will, as the substrate grows
into long-running, multi-substrate, or formally-verified
territory.

## 6. What this chapter is *not*

- Not a prescription. MASH may never formalize any of this; the
  finite algebra may turn out to be sufficient for every
  application we care about.
- Not a promise. No concrete code in `mash-math-*` realizes any of
  the above. If you search for `trait Coalgebra` you will not find
  it.
- Not a definition of what the substrate *ought* to be. The
  finite-algebra picture is a complete story of what MASH *is*.
  Coalgebra offers additional vocabulary for phenomena *at a
  running substrate's scale*, not a replacement foundation.

## Further reading

- Rutten, Jan (2000). *Universal coalgebra: a theory of systems.*
  Theoretical Computer Science 249.1, 3–80. The foundational
  paper.
- Jacobs, Bart (2017). *Introduction to Coalgebra: Towards
  Mathematics of States and Observation.* Cambridge University
  Press. The standard modern textbook.
- Kupke, Clemens & Pattinson, Dirk (2011). *Coalgebraic semantics
  of modal logics: an overview.* TCS 412.38. Modal-logic framing
  directly applicable to the fiber modal calculus.
- Jung, Achim & Rivieccio, Umberto (2012). *Priestley Duality for
  Bilattices.* Studia Logica 100.1–2. The dual side of our
  algebra; a direct starting point.
- Rivieccio, Umberto; Jung, Achim; Jansana, Ramon (2017). *Four-
  Valued Modal Logic: Kripke Semantics and Duality.* J. Logic and
  Computation 27.1. Decidability + the path to coalgebraic
  modalities.
- Maruyama, Yoshihiro (2021). *Fibred Algebraic Semantics …* The
  fiber-functor setting the paper builds on; a coalgebraic
  extension would start here.

## Related chapters

- [Finite algebra](finite-algebra.md) — the foundation this chapter
  is the dual of.
- [Fibers and the cascade](../concepts/fibers-and-cascade.md) — the
  operational side of the cascade, which a coalgebraic treatment
  would formalize as a transition system.
- [Agential realism](../lineage/agential-realism.md) — the
  philosophical register in which "substrate as process unfolding
  under observation" is the natural framing.
