# The mathematics

MASH's substrate is a specific mathematical object: an append-only
store of claims valued in the **four-element Belnap bilattice**
$\mathbf{2} \otimes \mathbf{2}$, closed under five bilattice
homomorphisms, whose extending and restricting operations form a
residuated pair. This chapter is the formal foundation in one place.
Every theorem cited is proved in the paper

> *The Adjoint Structure of Predication on Bilattice-Valued Fibers*,
> in `library/domains/science/domains/information/texts/`

and every operation corresponds to Rust code in `mash-math-*`.

## 1. Lattices, bilattices, and the twist product

A **bounded lattice** $(L, \leq)$ is a partially ordered set with a
greatest lower bound $a \wedge b$ (meet) and a least upper bound
$a \vee b$ (join) for every pair, plus a top $\top$ and bottom
$\bot$. It is **distributive** when
$a \wedge (b \vee c) = (a \wedge b) \vee (a \wedge c)$ (and dually).

A **bilattice** (Fitting 1991) is a set carrying *two* bounded
distributive lattice structures — a truth ordering $\leq_t$ and a
knowledge ordering $\leq_k$ — linked by an involutive negation
$\sim$ that inverts $\leq_t$ while preserving $\leq_k$:

$$a \leq_t b \iff {\sim} b \leq_t {\sim} a,
\qquad a \leq_k b \iff {\sim} a \leq_k {\sim} b.$$

### The twist product

Given a bounded distributive lattice $L$, the **twist product**
$L \otimes L$ (Kalman 1958, generalized to bilattices by Fitting)
has carrier $L \times L$ and operations

$$\begin{aligned}
(a, b) \wedge_t (c, d) &= (a \wedge c,\ b \vee d), \\
(a, b) \vee_t (c, d) &= (a \vee c,\ b \wedge d), \\
(a, b) \wedge_k (c, d) &= (a \wedge c,\ b \wedge d), \\
(a, b) \vee_k (c, d) &= (a \vee c,\ b \vee d), \\
{\sim}(a, b) &= (b, a).
\end{aligned}$$

Read the pair $(a, b)$ as **positive evidence $a$, negative evidence
$b$**. Truth meet takes the weaker positive, the stronger negative
(i.e., is more restrictive in both directions toward $f$); knowledge
meet takes the weaker in both directions (toward $\bot$); negation
swaps the two components.

### The four-element bilattice

Take $L = \mathbf{2} = \{0, 1\}$ (the boolean lattice). Then
$\mathbf{2} \otimes \mathbf{2}$ has four elements:

| element       | pair     | interpretation                   |
|---------------|----------|----------------------------------|
| $\bot$ (None) | $(0, 0)$ | no evidence either way           |
| $t$ (True)    | $(1, 0)$ | positive evidence only           |
| $f$ (False)   | $(0, 1)$ | negative evidence only           |
| $\top$ (Both) | $(1, 1)$ | contradictory evidence           |

Fitting (2002) proves this is the **free bounded distributive
bilattice on one generator**. The two orderings form two
Hasse-diamond shapes sharing the same four points:

```text
     Truth (≤_t)              Knowledge (≤_k)
         t                         ⊤
         /  \                      /  \
       ⊤    ⊥                    t    f
         \  /                      \  /
         f                          ⊥
```

**In code.** `mash-math-bilattice`:

```rust,ignore
pub enum Value { None, True, False, Both }

pub fn truth_leq(a: Value, b: Value)    -> bool  { /* … */ }
pub fn knowledge_leq(a: Value, b: Value) -> bool { /* … */ }
pub fn truth_meet(a, b), truth_join(a, b)         /* ∧_t, ∨_t */
pub fn knowledge_meet(a, b), knowledge_join(a, b) /* ∧_k, ∨_k */
pub fn negate(v: Value) -> Value                  /* ∼ */
```

`knowledge_join` is **commutative, associative, idempotent** — the
CRDT merge the substrate relies on for concurrent writers.

## 2. Residuation and the Lambek calculus

A **residuated lattice** (Galatos, Jipsen, Kowalski, Ono 2007) is a
bounded lattice with a monoidal product $\cdot$ and two residuals
$\backslash$ and $/$ satisfying the **adjunction**:

$$a \cdot b \leq c \iff b \leq a \backslash c \iff a \leq c / b.$$

The Lambek calculus (Lambek 1958) is the logic of residuated
lattices — a substructural proof system where the two residuals
correspond exactly to the two argument positions of a non-
commutative product. When the product commutes, $\backslash$ and $/$
collapse into a single implication $\Rightarrow$ satisfying

$$a \cdot b \leq c \iff b \leq (a \Rightarrow c).$$

### The Busaniche–Cignoli residuation on the twist product

**Theorem 1** (Busaniche & Cignoli 2014; Chajda & Langer 2021).
*On the twist product $L \otimes L$ of any integral commutative
residuated lattice $L$, the operations*

$$\begin{aligned}
(x, y) \odot (z, v)        &= (x \cdot z,\ (x \to v) \wedge (z \to y)), \\
(x, y) \Rightarrow (z, v)  &= ((x \to z) \wedge (v \to y),\ x \cdot v)
\end{aligned}$$

*form a residuated pair with respect to $\leq_t$:*

$$a \odot p \leq_t q \iff p \leq_t (a \Rightarrow q).$$

Specializing to $L = \mathbf{2}$ (where $\cdot = \wedge$ and
$x \to y = \neg x \vee y$) gives the operations MASH implements as
`fuse` and `restrict`:

```rust,ignore
pub fn fuse(a: Value, b: Value)    -> Value;  // ⊙ — extending
pub fn restrict(a: Value, b: Value) -> Value; // ⇒ — restricting
```

and `verify_adjunction` (in the same crate) exhaustively checks the
biconditional on all $4^3 = 64$ triples. Zero violations.

### What $\odot$ and $\Rightarrow$ do

Read $\odot$ ("fuse") as **extending**: it combines two evidence
pairs by fusing positive evidence and cross-checking each side's
positive evidence against the other's negative. $\odot$'s identity
is $\top$ (not $t$), because the algebra treats a contradictory
cell as carrying both positive and negative witnessings in full.

Read $\Rightarrow$ ("restrict") as **restricting**: it tests
implication in both truth directions and combines negative
evidence, producing the weakest cell whose $\odot$-fusion with $a$
still lies below $q$.

Key spot-checks:

| operation            | result |
|----------------------|--------|
| $\top \odot a$       | $a$    |
| $f \odot a$          | $f$    |
| $\bot \odot \bot$    | $f$    |
| $t \odot t$          | $t$    |
| $t \odot f$          | $f$    |
| $a \Rightarrow a$    | $t$ for $a \in \{\bot, t, f\}$; $\top$ for $a = \top$ |

**Proposition (paper, §2.3).** $t$, $f$, and $\top$ are idempotent
under $\odot$; $\bot$ is not.

## 3. The Chu identification

The **Chu construction** (Barr) takes a category $\mathcal{C}$ and
a distinguished object $d$ and produces a category
$\mathrm{Chu}(\mathcal{C}, d)$ whose objects are triples
$(X, A, r)$ where $X, A$ are sets (or $\mathcal{C}$-objects) and
$r : X \times A \to d$ is a pairing. The category has a canonical
**multiplicative tensor** $\otimes$ and **linear implication**
$\multimap$, and these make it a *-autonomous model of linear
logic.

**Theorem 3** (Jakl 2025). *For $H$ a Heyting algebra and $0 \in H$
its bottom,*

$$\mathbf{FOUR} \cong \mathrm{Chu}(\mathbf{2}, 0)$$

*as residuated structures, with $\otimes \leftrightarrow \odot$ and
$\multimap \leftrightarrow \Rightarrow$.*

Spelled out: the algebra the `fuse` / `restrict` operations live in
**is** the Chu-multiplicative structure on a specific Chu space. At
the algebra level, MASH's cascade is doing linear-logic
multiplicative inference over $(\mathbf{2}, 0)$.

## 4. Predicate fibers and the fiber functor

Let $\mathcal{S}$ be a system of subject-predicate-object triples
valued in $\mathbf{2} \otimes \mathbf{2}$ — in code,
`Semiotics::claims: HashMap<(TermId, TermId, TermId), Value>`. For
each predicate $p$ occurring in $\mathcal{S}$, the **fiber** of $p$
is

$$\mathrm{Fib}(p) = \{ \langle s, o, v \rangle
  : (s, p, o) \in \mathcal{S} \text{ with value } v \}.$$

In code, `Semiotics::fiber(p)` returns this as an iterator over
`(TermId, TermId, Value)` triples.

The pointwise bilattice operations on $\mathrm{Fib}(p) \to
\{\bot, t, f, \top\}$ define a **fiber algebra** $A_p$.

**Proposition 7** (paper). *Each $A_p$ is a distributive bilattice*
(pointwise products of distributive bilattices are distributive).

### The category of predicates

Let $\mathcal{C}$ be the category whose objects are the predicates
occurring in $\mathcal{S}$ and whose morphisms are generated by three
classes of *predicate relationships*:

- **Specialization.** $q$ is a sub-predicate of $p$: whenever $p$ is
  asserted on $(s, o)$, so is $q$ with the same value.
- **Inversion.** $q$ is the subject/object swap of $p$ with negated
  value: $(o, q, s) = \sim (s, p, o)$.
- **Composition.** $r$ is a pointwise conjunction of $p$ and $q$
  under some lattice operation — $\wedge_k$, $\odot$, or
  $\Rightarrow$.

These are exhaustive within the homomorphism constraint that defines
$\mathcal{F}$ (paper, §3.2).

### The fiber functor (paper, Theorem 2)

**Theorem 2.** *The assignment $p \mapsto A_p$ extends to a
contravariant functor*

$$\mathcal{F} : \mathcal{C}^{\mathrm{op}} \to \mathbf{BiLat}.$$

*Proof sketch.* Each of the three morphism classes of $\mathcal{C}$
maps to a bilattice homomorphism in $\mathbf{BiLat}$: specialization
induces restriction of valuations; inversion applies $\sim$
pointwise (which is a bilattice homomorphism); composition applies
the chosen pointwise operation. Functoriality (identity,
composition) follows from the identities of the underlying
operations. $\square$

**Corollary 1.** *The adjunction $\odot \dashv \Rightarrow$ lifts to
fibers: for each predicate $p$, extending and restricting on $A_p$
are adjoint fiber-wise.*

This is what MASH's cascade computes: residuations happening *inside
each predicate fiber*, with the three cross-fiber morphism classes
connecting them functorially.

## 5. The five morphisms, precisely

The Rust enum `MorphismKind` has exactly five variants. They are
exhaustive in the sense that every bilattice homomorphism generated
by a finite combination of the three primitive relationships above
reduces to a composition of these:

| kind               | arity | derivation                               | lattice operation |
|--------------------|-------|------------------------------------------|-------------------|
| **Specialization** | 1 → 1 | $(s, q, o) := (s, p, o)$                 | identity          |
| **Inversion**      | 1 → 1 | $(o, q, s) := \sim (s, p, o)$            | $\sim$            |
| **Composition**    | 2 → 1 | $(s, r, o) := v_p \wedge_k v_q$          | $\wedge_k$        |
| **Fusion**         | 2 → 1 | same shape                               | $\odot$           |
| **Implication**    | 2 → 1 | same shape, asymmetric                   | $\Rightarrow$     |

Composition, Fusion, and Implication — the binary morphisms —
fire **pointwise** at a shared $(s, o)$: for a pair declared on
$(p, q, r)$, every matched pair of cells $(s, p, o)$ and
$(s, q, o)$ — same subject, same object — combines via the named
binary operation and the derived cell lands at $(s, r, o)$. The
object rides through unchanged; there is no structured pair-O.

The cascade therefore does not combine cells across differing
objects. Two pieces of evidence that naturally sit at different
objects (e.g. a message's `was-said-in` channel and its `has-body`
text) are fused in a subscribe-and-cache port instead — see
`mash-port-projection-comms-surface`, `-run-dispatcher`, and the
dispatch `Promoter` for worked examples.

**In code.** `mash-math-proof-engine`:

- `MorphismKind` in `mash-math-inference::MorphismKind`.
- The full cascade in `Semiotics::assert`, with `propagate` /
  `derive_via_idx` / `pointwise_combine` implementing the five cases.
- `pointwise_combine` in `Semiotics` does the shared-coordinate
  lookup: given the triggering cell and the partner predicate, it
  fetches the partner's value at the same $(s, o)$ and combines with
  the named binary operation.

## 6. Termination and decidability

**Proposition 8** (paper). *All orbits under iterated left-$\odot$
or left-$\Rightarrow$ on $\{\bot, t, f, \top\}$ reach fixed points
in at most two steps.*

This is what guarantees cascade termination: cells only rise under
$\leq_k$ (because `knowledge_join` is monotonic), the algebra is
finite, and the orbit bound caps propagation depth per morphism
instance. In practice MASH's cascade settles in a handful of
iterations; the worst case is constant-bounded per cell, though
global work can be quadratic in the worst binary-morphism
population.

**Corollary 2** (paper). *The modal calculus arising from
$\mathcal{F}$ is decidable.*

This follows from Rivieccio, Jung, & Jansana 2017: four-valued modal
logic on $\mathbf{2} \otimes \mathbf{2}$ has the finite model
property and is decidable. The fiber algebras are distributive
bilattices over $\mathbf{2} \otimes \mathbf{2}$, so the result
lifts.

### Post-closure restriction

**Theorem 5** (paper). *The set $\{t, f, \top\}$ is closed under
$\odot$ and $\Rightarrow$. The adjunction holds on $\{t, f, \top\}$
with zero violations.*

Operationally: after a cascade settles, `post_close` raises any
remaining in-scope $\bot$ cells to $\top$. The resulting effective
algebra is the three-element sub-algebra on $\{t, f, \top\}$, which
still carries the full residuation — so the adjunction doesn't break
across closure.

## 7. Naming theorem: the substrate is a Chu space

**Theorem 4** (paper). *Every bilattice-valued SPO system is a
**predication modal geometry** — a predicate-indexed Chu space over
$(\mathbf{2}, 0)$.*

This is the naming theorem. "Predication" from the SPO indexing;
"modal" from the paired Priestley-dual geometry of
$\mathbf{2} \otimes \mathbf{2}$ (Jung & Rivieccio 2012);
"geometry" from the Chu-space structure established by Theorem 3.
The fiber functor $\mathcal{F}$ factors through this Chu category:

$$\mathcal{F} = \jmath \circ \mathcal{F}_{\mathrm{Chu}}, \qquad
\mathcal{F}_{\mathrm{Chu}} : \mathcal{C}^{\mathrm{op}}
\to \mathrm{Chu}(\mathbf{2}, 0).$$

The cascade is not "running rules on a database." It is performing
Chu-multiplicative inference on a predicate-indexed Chu space over
the two-element Heyting algebra, and the `fuse` / `restrict`
operations *are* the linear tensor and linear implication of linear
logic at the algebra level.

## 8. Map to code

| math                                      | Rust                                       |
|-------------------------------------------|--------------------------------------------|
| $\mathbf{2} \otimes \mathbf{2}$           | `mash_math_bilattice::Value`               |
| $\leq_t$, $\leq_k$                        | `truth_leq`, `knowledge_leq`               |
| $\wedge_t$, $\vee_t$, $\wedge_k$, $\vee_k$ | `truth_meet`/`join`, `knowledge_meet`/`join` |
| $\sim$                                    | `negate`                                   |
| $\odot$ (fuse)                            | `fuse`                                     |
| $\Rightarrow$ (restrict)                  | `restrict`                                 |
| post-closure lift                         | `post_close`                               |
| verify adjunction on 64 triples           | `verify_adjunction`                        |
| five morphism kinds                       | `mash_math_inference::MorphismKind`        |
| fiber of predicate $p$                    | `Semiotics::fiber(p)`                      |
| append-only SPO store                     | `Semiotics::claims`                        |
| cascade                                   | `Semiotics::assert` + `propagate`          |

## 9. Further reading

- The paper: the full formal development, proofs, and references.
- `mash-math-bilattice/src/lib.rs`: doctests show every operation on
  specific values; the `verify_adjunction` test is the end-to-end
  check.
- `mash-math-proof-engine/src/lib.rs`: the cascade engine; walk
  `Semiotics::assert` downward through `propagate`,
  `try_install_from_trigger`, `replay_through`, and
  `derive_via_idx` to see the algebra become code.
- Arieli & Avron 1996 for the logic; Fitting 1991/2002 for the
  bilattice; Galatos, Jipsen, Kowalski, Ono 2007 for residuation;
  Jakl 2025 for the Chu identification; Rivieccio, Jung, Jansana
  2017 for decidability.
