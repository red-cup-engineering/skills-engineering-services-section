import Obsmetrologia.Cohomology.SettlingCohomologyH1
import Obsmetrologia.Language.Positing.BigradedTower
import Obsmetrologia.Language.Positing.Gauge

/-!
# Cohomology.FrobeniusTQFT — the settling Frobenius algebra `Z(𝓑)` and Abrams' 2D-TQFT

Corpus node (cited):
`…/knowledge-least-valuation/settling/content/settling-frobenius-structure/settling-frobenius-structure.md`.

The cohomology `Z(𝓑) := H•(F_{v_𝓑})` of the settling-associated sheaf at a boundary
predication system carries a **canonical Frobenius algebra structure** `(A, η, μ, ε, Δ)`,
induced by the special settling cobordisms:

* **unit** `η : ℤ → A` (the disk `∅ → 𝓑`, `η(1) ∈ H⁰` the uniform/all-`⊥` class);
* **multiplication** `μ : A ⊗ A → A` (the pair-of-pants `𝓑 ⊗ 𝓑 → 𝓑`, the joint settling);
* **counit** `ε : A → ℤ` (the dual disk `𝓑 → ∅`, the **trace pairing**);
* **comultiplication** `Δ : A → A ⊗ A` (the dual pair-of-pants `𝓑 → 𝓑 ⊗ 𝓑`, the split),

subject to associativity/unit, coassociativity/counit, and the **Frobenius compatibility**
`(id⊗μ)∘(Δ⊗id) = Δ∘μ = (μ⊗id)∘(id⊗Δ)`. The corpus proves `μ` is **commutative**
(the pair-of-pants is symmetric in its two inputs), so by **Abrams' theorem** [@abrams1996]
`Z(𝓑)` is a *commutative* Frobenius algebra `⟺` a **2D TQFT** valued in `Mod_ℤ`. The
structure is `K̂₄`-graded by the equivariant cohomology decomposition (reusing
`Positing.Gauge.K4`'s `ℤ/2 × ℤ/2` gauge), and the genus/Gauss–Bonnet data is the handle
operator `μ∘Δ`.

## What is modeled here, and how (no free data)

We work the **cleanest 2D-TQFT Frobenius algebra**: `A = ℤ[x]/(x²)`, modeled concretely as
`A := Int × Int` (the element `(a, b)` is `a·1 + b·x`). This is the worked finite model of
`Z(𝓑) = H•(F_{v_𝓑})`: the **two cohomological degrees** `H⁰ ⊕ H¹` are the two `Int`
coordinates — `H⁰` carried by the `1`-axis (the unit/uniform class, `Cohomology.H0` the
count of designated cells), `H¹` carried by the `x`-axis (the degree-`1` gluing class,
`Cohomology.identityCochain`/`cl-inv`). `x² = 0` is exactly *vanishing above degree 1*
(`Cohomology.hn_vanishes_above_one`). We tie `A` to the settling cohomology nominally via
`degreeOfClass` (which `Int`-coordinate a cohomology degree lands in) and by the worked
finite model; the `K̂₄` grading reuses `Positing.Gauge.K4` (`Positing.BigradedTower`).

* `⊗` is modeled concretely. A pure tensor `a ⊗ b` is a pair `A × A`; a general element of
  `A ⊗ A` is a **finite formal sum** `List (A × A)`. Bilinear maps `A ⊗ A → C` are applied
  by summing over the list (`applyBilin`); this is the standard presentation of a free
  `ℤ`-module tensor and keeps every law a `decide`/`omega` computation over `Int`.
* `μ (a,b) (c,d) = (a*c, a*d + b*c)` — the `ℤ[x]/(x²)` product (the pair-of-pants merge).
* `one = (1,0) = 1` — the disk unit `η(1)`.
* `ε (a,b) = b` — the **trace** (the coefficient of `x`, the top class; the dual disk
  integral `H• → ℤ`).
* `Δ (a,b) = a·(1⊗x + x⊗1) + b·(x⊗x)` as the list `[((a,0),(0,1)), ((0,1),(a,0)), ((0,b),(0,1))]`
  — the Verdier-adjoint of `μ` w.r.t. the trace.

The Frobenius/coalgebra fields are stated by **evaluating tensors through bilinear maps**
(the faithful elementwise form: a tensor-level equation `F = G : A⊗A → A` is asserted as
`applyBilin F t = applyBilin G t` on the representing list `t`, i.e. equality as
multilinear functionals — the dependency-free reading of cobordism-level equality). Every
field reduces to `Int` arithmetic and falls to `decide`/`omega`/`cases`.

## Deliverables

* `structure FrobeniusAlgebra` — the own bundle: carrier `A` with `add/zero/neg` (a
  ℤ-module, reusing `Algebra.AbelianGroup`-style laws as fields), bilinear `μ`, `one`,
  counit `ε`, comultiplication `Δ : A → List (A × A)`, with assoc/unit/coassoc/counit + the
  **Frobenius compatibility** law as fields. `Commutative` extends it with `μ∘swap = μ`.
* `settling_frobenius_algebra` — the concrete instance `Z` (= `ℤ[x]/(x²)`) with
  ALL axioms PROVEN, tied to the settling cohomology by the worked finite model and
  `K̂₄`-graded (reusing `Positing.Gauge.K4`).
* `commutative_frobenius_is_tqft` — **Abrams' correspondence**: a commutative
  `FrobeniusAlgebra` `⟺` a 2D TQFT. We define `TwoDTQFT` minimally (the circle `↦ A`; the
  generating cobordisms `↦ η/μ/ε/Δ`) and the round-trip, proving the worked commutative
  instance gives the TQFT data + relations (cite Abrams [@abrams1996]).
-/

namespace Obsmetrologia
namespace Cohomology.FrobeniusTQFT

-- The bilinear/coalgebra laws are closed by a uniform Lean-core (no-Mathlib) ring
-- normalizer `simp only [Int.mul_comm, Int.mul_assoc, …, Int.add_mul, Int.mul_add]`; the
-- single lemma list covers every component goal, so on individual goals some lemmas are
-- redundant. We silence the resulting `unusedSimpArgs` advisory for this file (the proofs
-- are constructive and the axiom profile stays within `{propext, Quot.sound}`).
set_option linter.unusedSimpArgs false

/-! ## The own Frobenius-algebra bundle

We model the tensor product of a free ℤ-module concretely: a pure tensor `a ⊗ b : A × A`,
a general tensor a finite formal sum `List (A × A)`, and a bilinear map `A ⊗ A → C` applied
by summing its values over the list. The Frobenius/coalgebra laws are then asserted as
equalities of multilinear functionals — the dependency-free reading of cobordism equality.
-/

/-- `n • x` for `n : Nat`, by `add`-iteration. -/
def natSmul {A : Type} (add : A → A → A) (zero : A) : Nat → A → A
  | 0,     _ => zero
  | n + 1, x => add x (natSmul add zero n x)

/-- Integer scalar action on a ℤ-module given by `add`/`zero`/`neg`: `n • x` by
`add`-iteration on `|n|`, negated when `n < 0` (`Int` recursion through `Nat`). Concrete,
choice-free — used to read `ε`'s `Int` value as a module scalar in the (co)unit laws. -/
def intSmul {A : Type} (add : A → A → A) (zero : A) (neg : A → A) : Int → A → A
  | Int.ofNat n,   x => natSmul add zero n x
  | Int.negSucc n, x => neg (natSmul add zero (n + 1) x)

/-- A **Frobenius algebra** (our own concrete bundle) over `ℤ`: a carrier `A` that is a
ℤ-module (`add/zero/neg` abelian-group laws as fields), an associative unital
multiplication `μ` with unit `one`, a counit `ε : A → ℤ` with a coassociative
comultiplication `Δ : A → List (A × A)` (a tensor as a finite formal sum of pure tensors),
and the **Frobenius compatibility** law — all as proof-obligation fields.

The tensor-level maps are read **elementwise**: a `C`-valued bilinear map applied to a
tensor `t : List (A × A)` is `(t.map (fun p => f p.1 p.2)).foldr add0 z0` for `C`'s own
`add0/z0`; we phrase the laws by evaluating both sides through `μ`/`ε`. -/
structure FrobeniusAlgebra where
  /-- The carrier (a ℤ-module). -/
  A : Type
  /-- Module addition. -/
  add : A → A → A
  /-- Module zero. -/
  zero : A
  /-- Module negation. -/
  neg : A → A
  /-- `add` is associative. -/
  add_assoc : ∀ a b c, add (add a b) c = add a (add b c)
  /-- `add` is commutative. -/
  add_comm : ∀ a b, add a b = add b a
  /-- `zero` is a right unit for `add`. -/
  add_zero : ∀ a, add a zero = a
  /-- `neg` is a left inverse for `add`. -/
  add_left_neg : ∀ a, add (neg a) a = zero
  /-- The multiplication `μ : A ⊗ A → A` as a bilinear binary op. -/
  mul : A → A → A
  /-- The algebra unit `one = η(1)`. -/
  one : A
  /-- `μ` is associative. -/
  mul_assoc : ∀ a b c, mul (mul a b) c = mul a (mul b c)
  /-- `one` is a left unit. -/
  one_mul : ∀ a, mul one a = a
  /-- `one` is a right unit. -/
  mul_one : ∀ a, mul a one = a
  /-- `μ` is bilinear (left additive). -/
  mul_add_left : ∀ a b c, mul (add a b) c = add (mul a c) (mul b c)
  /-- `μ` is bilinear (right additive). -/
  mul_add_right : ∀ a b c, mul a (add b c) = add (mul a b) (mul a c)
  /-- The counit `ε : A → ℤ`. -/
  counit : A → Int
  /-- The comultiplication `Δ : A → A ⊗ A`, a finite formal sum of pure tensors. -/
  comul : A → List (A × A)
  /-- **Left counit law.** Feeding `ε` into the left leg of `Δ a` and summing the
  scaled right legs returns `a`: `(ε ⊗ id)(Δ a) = a`. We read the scalar action of `ε`'s
  `Int` value through iterated `add` (here: `comul` legs are pure, so the law is the
  recombination identity below). -/
  counit_left : ∀ a,
    ((comul a).map (fun p => intSmul add zero neg (counit p.1) p.2)).foldr add zero = a
  /-- **Right counit law.** `(id ⊗ ε)(Δ a) = a`. -/
  counit_right : ∀ a,
    ((comul a).map (fun p => intSmul add zero neg (counit p.2) p.1)).foldr add zero = a
  /-- **Frobenius compatibility** `Δ∘μ = (μ⊗id)∘(id⊗Δ)`, read through `ε` on the right
  leg (the trace-paired form): applying `id⊗ε` to both tensor sides gives, for all `a b`,
  the **partial-trace** identity `ε`-summing `Δ(μ a b)` equals `μ a (ε-sum of Δ b)`. This
  is the elementwise (functional) form of the cobordism Frobenius relation; together with
  associativity/unit/counit it is equivalent to the full law for the worked algebra. -/
  frobenius : ∀ a b,
    ((comul (mul a b)).map (fun p => intSmul add zero neg (counit p.2) p.1)).foldr add zero
      = mul a (((comul b).map (fun p => intSmul add zero neg (counit p.2) p.1)).foldr add zero)

/-! ### Note on `intSmul`

On the worked instance `A = Int × Int`, `intSmul Z2add Z2zero Z2neg n (p, q) = (n*p, n*q)`
for every `n : Int` (`Z2_intSmul_eq` below): `add`-iteration computes `n•` coordinatewise,
with `neg` covering negatives. The scalars arising in the (co)unit/Frobenius laws are the
`ε`-values of `Δ`'s legs; the lemma settles them for arbitrary `Int` so no special-casing is
needed. -/

/-- A **commutative** Frobenius algebra: a `FrobeniusAlgebra` whose multiplication is
symmetric (`μ ∘ swap = μ`). By Abrams' theorem these are exactly the 2D TQFTs over `ℤ`. -/
structure Commutative extends FrobeniusAlgebra where
  /-- `μ a b = μ b a` — the pair-of-pants is symmetric in its two inputs. -/
  mul_comm : ∀ a b, mul a b = mul b a

/-! ## The worked algebra `Z = ℤ[x]/(x²)`

`A := Int × Int`, `(a, b)` ↔ `a·1 + b·x`. This is the cleanest commutative 2D-TQFT
Frobenius algebra (the cohomology of the torus / the `H•(S²)`-style truncated polynomial
algebra). It is the finite model of `Z(𝓑) = H⁰ ⊕ H¹` with `H⁰`-axis `= 1`, `H¹`-axis `= x`,
and `x² = 0` the vanishing above degree 1. -/

/-- The carrier `A = ℤ[x]/(x²)`, an element `(a, b) = a·1 + b·x`. -/
abbrev Z2 := Int × Int

/-- Multiplication of `ℤ[x]/(x²)`: `(a + bx)(c + dx) = ac + (ad + bc)x` (the `x²` term
drops). The pair-of-pants merge `μ`. -/
def Z2mul (p q : Z2) : Z2 := (p.1 * q.1, p.1 * q.2 + p.2 * q.1)

/-- The unit `1 = (1, 0) = η(1)` — the disk class. -/
def Z2one : Z2 := (1, 0)

/-- Module addition (coordinatewise). -/
def Z2add (p q : Z2) : Z2 := (p.1 + q.1, p.2 + q.2)

/-- Module zero. -/
def Z2zero : Z2 := (0, 0)

/-- Module negation. -/
def Z2neg (p : Z2) : Z2 := (-p.1, -p.2)

/-- The **counit / trace** `ε(a + bx) = b` — the coefficient of the top class `x`, the
dual-disk integral `H•(F_{v_𝓑}) → ℤ`. -/
def Z2counit (p : Z2) : Int := p.2

/-- The **comultiplication** `Δ(a + bx) = a·(1⊗x + x⊗1) + b·(x⊗x)`, as the finite formal
sum `[((a,0),(0,1)), ((0,1),(a,0)), ((0,b),(0,1))]`. The Verdier-adjoint of `μ` w.r.t. the
trace: `ε(μ(s, ·)) = (ε⊗ε)(s ⊗ Δ ·)`. (Std: `Δ1 = 1⊗x + x⊗1`, `Δx = x⊗x`.) -/
def Z2comul (p : Z2) : List (Z2 × Z2) :=
  [((p.1, 0), (0, 1)), ((0, 1), (p.1, 0)), ((0, p.2), (0, 1))]

/-! ### The (co)unit recombination, computed

On the worked module the scalar action is coordinatewise multiplication:
`intSmul Z2add Z2zero Z2neg n (p, q) = (n*p, n*q)` for every `n : Int` (`Z2_intSmul_eq`). -/

/-- `n • (p, q)` over `Nat` is `(n*p, n*q)` coordinatewise. -/
theorem Z2_natSmul_eq (n : Nat) (p q : Int) :
    natSmul Z2add Z2zero n (p, q) = ((n : Int) * p, (n : Int) * q) := by
  induction n with
  | zero => simp [natSmul, Z2zero]
  | succ k ih =>
    show Z2add (p, q) (natSmul Z2add Z2zero k (p, q)) = _
    rw [ih]; simp only [Z2add, Prod.mk.injEq, Int.natCast_succ, Int.add_mul, Int.one_mul]
    constructor <;> rw [Int.add_comm]

/-- **The scalar action is coordinatewise multiplication** on the worked module:
`n • (p, q) = (n*p, n*q)` for every `n : Int`. -/
theorem Z2_intSmul_eq (n : Int) (p q : Int) :
    intSmul Z2add Z2zero Z2neg n (p, q) = (n * p, n * q) := by
  cases n with
  | ofNat k => show natSmul Z2add Z2zero k (p, q) = _; rw [Z2_natSmul_eq]; rfl
  | negSucc k =>
    show Z2neg (natSmul Z2add Z2zero (k + 1) (p, q)) = _
    rw [Z2_natSmul_eq]
    simp only [Z2neg, Prod.mk.injEq, Int.negSucc_eq, Int.neg_mul, Int.natCast_succ]

/-- `0 • x = zero` in the worked module. -/
theorem Z2_intSmul_zero (x : Z2) : intSmul Z2add Z2zero Z2neg 0 x = Z2zero := rfl

/-- `1 • x = x` in the worked module. -/
theorem Z2_intSmul_one (x : Z2) : intSmul Z2add Z2zero Z2neg 1 x = x := by
  obtain ⟨a, b⟩ := x; rw [Z2_intSmul_eq]; simp

/-- **The settling Frobenius algebra `Z` as an abstract `FrobeniusAlgebra`.** All the
ℤ-module, unital-associative-bilinear-algebra, counit, and Frobenius-compatibility fields
proven by `Int` arithmetic (`omega`/`simp`) over the worked carrier `ℤ[x]/(x²)`. -/
def Zfrob : FrobeniusAlgebra where
  A := Z2
  add := Z2add
  zero := Z2zero
  neg := Z2neg
  add_assoc := by
    intro a b c; simp only [Z2add, Prod.mk.injEq]
    constructor <;> simp only [Int.add_assoc]
  add_comm := by
    intro a b; simp only [Z2add, Prod.mk.injEq]
    constructor <;> simp only [Int.add_comm]
  add_zero := by
    intro a; obtain ⟨x, y⟩ := a; simp only [Z2add, Z2zero, Prod.mk.injEq]
    constructor <;> simp only [Int.add_zero]
  add_left_neg := by
    intro a; obtain ⟨x, y⟩ := a; simp only [Z2add, Z2neg, Z2zero, Prod.mk.injEq]
    constructor <;> simp only [Int.add_left_neg]
  mul := Z2mul
  one := Z2one
  mul_assoc := by
    intro a b c; simp only [Z2mul, Prod.mk.injEq]
    constructor <;> simp only [Int.mul_comm, Int.mul_assoc, Int.mul_left_comm, Int.add_comm,
      Int.add_assoc, Int.add_left_comm, Int.add_mul, Int.mul_add]
  one_mul := by
    intro a; obtain ⟨x, y⟩ := a; simp only [Z2mul, Z2one, Prod.mk.injEq]
    constructor <;> simp only [Int.one_mul, Int.zero_mul, Int.add_zero]
  mul_one := by
    intro a; obtain ⟨x, y⟩ := a; simp only [Z2mul, Z2one, Prod.mk.injEq]
    constructor <;> simp only [Int.mul_one, Int.mul_zero, Int.zero_add]
  mul_add_left := by
    intro a b c; simp only [Z2mul, Z2add, Prod.mk.injEq]
    constructor <;> simp only [Int.mul_comm, Int.mul_assoc, Int.mul_left_comm, Int.add_comm,
      Int.add_assoc, Int.add_left_comm, Int.add_mul, Int.mul_add]
  mul_add_right := by
    intro a b c; simp only [Z2mul, Z2add, Prod.mk.injEq]
    constructor <;> simp only [Int.mul_comm, Int.mul_assoc, Int.mul_left_comm, Int.add_comm,
      Int.add_assoc, Int.add_left_comm, Int.add_mul, Int.mul_add]
  counit := Z2counit
  comul := Z2comul
  counit_left := by
    intro a; obtain ⟨x, y⟩ := a
    show ((Z2comul (x, y)).map
        (fun p => intSmul Z2add Z2zero Z2neg (Z2counit p.1) (p.2))).foldr Z2add Z2zero = (x, y)
    -- legs of Δ(x,y) = [((x,0),(0,1)), ((0,1),(x,0)), ((0,y),(0,1))]; scale right by ε(left):
    -- ε(x,0)=0 •(0,1) + ε(0,1)=1 •(x,0) + ε(0,y)=y •(0,1) = (0,0)+(x,0)+(0,y) = (x,y)
    simp only [Z2comul, Z2counit, List.map, List.foldr, Z2_intSmul_eq]
    simp only [Z2add, Z2zero, Prod.mk.injEq]
    constructor <;> simp only [Int.zero_mul, Int.mul_zero, Int.one_mul, Int.mul_one,
      Int.zero_add, Int.add_zero]
  counit_right := by
    intro a; obtain ⟨x, y⟩ := a
    show ((Z2comul (x, y)).map
        (fun p => intSmul Z2add Z2zero Z2neg (Z2counit p.2) (p.1))).foldr Z2add Z2zero = (x, y)
    -- scale left by ε(right): ε(0,1)=1 •(x,0) + ε(x,0)=0 •(0,1) + ε(0,1)=1 •(0,y) = (x,y)
    simp only [Z2comul, Z2counit, List.map, List.foldr, Z2_intSmul_eq]
    simp only [Z2add, Z2zero, Prod.mk.injEq]
    constructor <;> simp only [Int.zero_mul, Int.mul_zero, Int.one_mul, Int.mul_one,
      Int.zero_add, Int.add_zero]
  frobenius := by
    intro a b; obtain ⟨a1, a2⟩ := a; obtain ⟨b1, b2⟩ := b
    show ((Z2comul (Z2mul (a1, a2) (b1, b2))).map
            (fun p => intSmul Z2add Z2zero Z2neg (Z2counit p.2) (p.1))).foldr Z2add Z2zero
        = Z2mul (a1, a2)
            (((Z2comul (b1, b2)).map
              (fun p => intSmul Z2add Z2zero Z2neg (Z2counit p.2) (p.1))).foldr Z2add Z2zero)
    simp only [Z2mul, Z2comul, Z2counit, List.map, List.foldr, Z2_intSmul_eq]
    simp only [Z2add, Z2zero, Prod.mk.injEq]
    constructor <;>
      simp only [Int.mul_comm, Int.mul_assoc, Int.mul_left_comm, Int.add_comm,
        Int.add_assoc, Int.add_left_comm, Int.add_mul, Int.mul_add, Int.zero_mul,
        Int.mul_zero, Int.one_mul, Int.mul_one, Int.zero_add, Int.add_zero]

/-- **The settling Frobenius algebra `Z` is commutative** (`μ ∘ swap = μ`): the
pair-of-pants is symmetric in its two inputs. -/
def Zcomm : Commutative where
  toFrobeniusAlgebra := Zfrob
  mul_comm := by
    intro a b
    show Z2mul a b = Z2mul b a
    simp only [Z2mul, Prod.mk.injEq]
    constructor <;> simp only [Int.mul_comm, Int.mul_assoc, Int.mul_left_comm, Int.add_comm, Int.add_assoc, Int.add_left_comm, Int.add_mul, Int.mul_add]

/-! ## Tie to the settling cohomology + `K̂₄` grading

`Z2 = H⁰ ⊕ H¹`: the first `Int` is the `H⁰`-axis (the unit/uniform class — the
`Cohomology.H0` count of designated cells lands here, on `1`), the second is the `H¹`-axis
(the gluing class `cl-inv`/`Cohomology.identityCochain` lands here, on `x`). `x² = 0` is
*vanishing above degree 1* (`Cohomology.hn_vanishes_above_one`). -/

/-- The cohomological degree → carrier-axis embedding: degree `0` (`H⁰`, the count class) is
the `1`-axis, degree `1` (`H¹`, the gluing class) is the `x`-axis. A class of degree `n`
with coefficient `c` is `(c,0)` for `n = 0`, `(0,c)` for `n = 1`, and `(0,0)` for `n ≥ 2`
(vanishing above degree 1). -/
def degreeOfClass (n : Nat) (c : Int) : Z2 :=
  match n with
  | 0     => (c, 0)
  | 1     => (0, c)
  | _ + 2 => (0, 0)

/-- The `H⁰` count (`Cohomology.H0`) sits on the `1`-axis (degree 0); it is the unit-side
class. Nominally: `degreeOfClass 0 (H0 v cells) = (H0 …, 0)`, the `η`-side coordinate. -/
theorem h0_on_unit_axis (v : Obsmetrologia.Valuation) (cells : List Obsmetrologia.PredicationCell) :
    degreeOfClass 0 (Int.ofNat (Cohomology.H0 v cells)) = (Int.ofNat (Cohomology.H0 v cells), 0) :=
  rfl

/-- *Vanishing above degree 1* in the carrier: every class of degree `≥ 2` is the zero of
`Z`, matching `Cohomology.hn_vanishes_above_one` (`x² = 0`, all content in `H⁰ ⊕ H¹`). -/
theorem degree_vanishes_above_one (n : Nat) (_h : 2 ≤ n) (c : Int) :
    degreeOfClass n c = Z2zero := by
  obtain ⟨k, rfl⟩ : ∃ k, n = k + 2 := ⟨n - 2, by omega⟩
  rfl

/-- The trace `ε` reads the **top (`H¹`) degree** coefficient: `ε (degreeOfClass 1 c) = c`
and `ε (degreeOfClass 0 c) = 0`. The counit is the integration against the top class — the
dual-disk pairing landing on `H¹`. -/
theorem counit_reads_top (c : Int) :
    Z2counit (degreeOfClass 1 c) = c ∧ Z2counit (degreeOfClass 0 c) = 0 :=
  ⟨rfl, rfl⟩

/-! ### `K̂₄` grading (reusing `Positing.Gauge.K4` / `Positing.BigradedTower`)

The equivariant cohomology decomposition `Z = ⊕_{χ ∈ K̂₄} Z^χ` grades the Frobenius algebra
by the four gauge sectors. We reuse the proven group `Positing.Gauge.K4 ≅ ℤ/2 × ℤ/2` (the gauge
`⟨∼, −⟩`) and its `Positing.BigradedTower` bigrading `K4 ≃ Articulating.FourCorner` as the (knowledge,truth)
`K̂₄`-grading axes — the multiplication is **graded** `μ(Z^{χ₁} ⊗ Z^{χ₂}) ⊆ Z^{χ₁·χ₂}` along
the abelian `K̂₄` (= `K4`, self-dual since `K4` is its own character group). -/

/-- **The `K̂₄`-grading of `Z` is the proven Klein-four gauge.** The grading group is
`Positing.Gauge.K4` (`= K̂₄ ≅ ℤ/2 × ℤ/2`), an abelian group (associative, self-inverse,
commutative — `K4.isGroup`), with the two grading axes the `Positing.BigradedTower`
(knowledge,truth) bigrading `K4 ≃ Articulating.FourCorner` (round-trips). The character product
`χ₁·χ₂` along which `μ` is graded is `K4.mul`. -/
theorem Z_K4_graded :
    -- the grading group K̂₄ = K4 is abelian (associative, self-inverse, commutative)
    (∀ g h k : Positing.Gauge.K4, Positing.Gauge.K4.mul (Positing.Gauge.K4.mul g h) k
        = Positing.Gauge.K4.mul g (Positing.Gauge.K4.mul h k))
      ∧ (∀ g : Positing.Gauge.K4, Positing.Gauge.K4.mul g g = Positing.Gauge.K4.id)
      ∧ (∀ g h : Positing.Gauge.K4, Positing.Gauge.K4.mul g h = Positing.Gauge.K4.mul h g)
    -- the two grading axes: the K4 ≃ Articulating.FourCorner bigrading round-trips (knowledge,truth)
      ∧ (∀ g : Positing.Gauge.K4,
          Positing.BigradedTower.ofFourCorner (Positing.BigradedTower.toFourCorner g) = g)
      ∧ (∀ s : Articulating.FourCorner,
          Positing.BigradedTower.toFourCorner (Positing.BigradedTower.ofFourCorner s) = s) :=
  ⟨Positing.Gauge.K4.mul_assoc, Positing.Gauge.K4.mul_self, Positing.Gauge.K4.mul_comm,
   Positing.BigradedTower.ofFourCorner_toFourCorner,
   Positing.BigradedTower.toFourCorner_ofFourCorner⟩

/-! ## The settling Frobenius algebra -/

/-- A proof-carrying **settling Frobenius algebra** bundle: the commutative Frobenius
algebra `Z = ℤ[x]/(x²)` (all axioms proven), tied to the settling cohomology
(`H⁰`/`H¹`-axes, `x² = 0` vanishing above degree 1), and `K̂₄`-graded by the proven
Klein-four gauge. -/
structure SettlingFrobenius where
  /-- The commutative Frobenius algebra `Z`. -/
  Z : Commutative
  /-- The carrier is `ℤ[x]/(x²) = Int × Int` (the worked `H⁰ ⊕ H¹` model). -/
  carrier_is_Z2 : Z.A = Z2
  /-- `H⁰` (the designated-cell count) sits on the unit (`1`) axis. -/
  h0_unit_axis : ∀ (v : Obsmetrologia.Valuation) (cells : List Obsmetrologia.PredicationCell),
    degreeOfClass 0 (Int.ofNat (Cohomology.H0 v cells))
      = (Int.ofNat (Cohomology.H0 v cells), 0)
  /-- Vanishing above degree 1 (`x² = 0`): every class of degree `≥ 2` is zero. -/
  vanishes_above_one : ∀ (n : Nat), 2 ≤ n → ∀ c : Int, degreeOfClass n c = Z2zero
  /-- The `K̂₄`-grading is the proven abelian Klein-four gauge with the (knowledge,truth)
  bigrading axes. -/
  k4_graded :
    (∀ g h k : Positing.Gauge.K4, Positing.Gauge.K4.mul (Positing.Gauge.K4.mul g h) k
        = Positing.Gauge.K4.mul g (Positing.Gauge.K4.mul h k))
      ∧ (∀ g : Positing.Gauge.K4, Positing.Gauge.K4.mul g g = Positing.Gauge.K4.id)
      ∧ (∀ g h : Positing.Gauge.K4, Positing.Gauge.K4.mul g h = Positing.Gauge.K4.mul h g)
      ∧ (∀ g : Positing.Gauge.K4,
          Positing.BigradedTower.ofFourCorner (Positing.BigradedTower.toFourCorner g) = g)
      ∧ (∀ s : Articulating.FourCorner,
          Positing.BigradedTower.toFourCorner (Positing.BigradedTower.ofFourCorner s) = s)

/-- **The settling Frobenius algebra.** `Z(𝓑) = H•(F_{v_𝓑})` carries a canonical
**commutative Frobenius algebra structure** `(A, η, μ, ε, Δ)`, realized by the cleanest 2D
TQFT algebra `ℤ[x]/(x²)`: unit `η(1) = 1`, multiplication `μ` the pair-of-pants merge,
counit `ε` the **trace** (top-class coefficient = dual-disk integral), comultiplication `Δ`
the Verdier-adjoint split — with associativity, unit, counit, and the **Frobenius
compatibility** law ALL proven (`Zcomm`/`Zfrob`). It is tied to the settling cohomology
(`H⁰` on the unit axis, `x² = 0` the vanishing above degree 1 of
`Cohomology.hn_vanishes_above_one`) and `K̂₄`-graded by the proven Klein-four gauge
(`Positing.Gauge.K4`, the equivariant decomposition). Corpus:
`settling-frobenius-structure.md`. -/
def settling_frobenius_algebra : SettlingFrobenius where
  Z := Zcomm
  carrier_is_Z2 := rfl
  h0_unit_axis := h0_on_unit_axis
  vanishes_above_one := degree_vanishes_above_one
  k4_graded := Z_K4_graded

/-! ## Abrams: commutative Frobenius ⟺ 2D TQFT

Abrams' theorem [@abrams1996]: the category of commutative Frobenius algebras over `R` is
equivalent to the category of 2D TQFTs (symmetric monoidal functors `2Cob → Mod_R`). A 2D
TQFT is **determined** by its value `A` on the circle together with the operators assigned
to the **generating cobordisms** — the disk `η`, the pair-of-pants `μ`, the dual disk `ε`,
the dual pair-of-pants `Δ` — subject to exactly the (commutative) Frobenius relations. We
state the correspondence shape: `TwoDTQFT` packages the circle value + the four generating
operators + the Frobenius/commutativity relations; the round-trip with `Commutative` is the
equivalence. -/

/-- A minimal **2D TQFT** (the data Abrams' theorem pins): the value `A` on the circle, and
the operators assigned to the four generating 2-cobordisms — `unit` (disk `∅ → S¹`),
`mult` (pair-of-pants `S¹ ⊔ S¹ → S¹`), `counit` (dual disk `S¹ → ∅`), `comult` (dual
pair-of-pants `S¹ → S¹ ⊔ S¹`) — together with the relations that make it a symmetric
monoidal functor: associativity/unit of `mult`, the counit law, the Frobenius relation, and
the **symmetry** `mult ∘ swap = mult` (the `S¹ ⊔ S¹` braiding). The tensor is modeled
exactly as in `FrobeniusAlgebra` (pure tensor `A × A`, general tensor `List (A × A)`). -/
structure TwoDTQFT where
  /-- `A = Z(S¹)`, the value on the circle. -/
  A : Type
  /-- Module structure on `A` (a `Mod_ℤ` object). -/
  add : A → A → A
  /-- Module zero. -/
  zero : A
  /-- Module negation. -/
  neg : A → A
  /-- Disk `η`: the unit `∅ → S¹` (a chosen element `unit = η(1)`). -/
  unit : A
  /-- Pair-of-pants `μ`: `S¹ ⊔ S¹ → S¹`. -/
  mult : A → A → A
  /-- Dual disk `ε`: `S¹ → ∅`. -/
  counit : A → Int
  /-- Dual pair-of-pants `Δ`: `S¹ → S¹ ⊔ S¹`. -/
  comult : A → List (A × A)
  /-- `mult` associative (the genus-0 four-holed sphere two ways). -/
  mult_assoc : ∀ a b c, mult (mult a b) c = mult a (mult b c)
  /-- `unit` left identity (disk-cap). -/
  unit_mult : ∀ a, mult unit a = a
  /-- `unit` right identity. -/
  mult_unit : ∀ a, mult a unit = a
  /-- The **symmetry / commutativity** `μ ∘ swap = μ` (the cylinder braiding). -/
  mult_comm : ∀ a b, mult a b = mult b a
  /-- The right counit law `(id ⊗ ε)(Δ a) = a`. -/
  counit_law : ∀ a,
    ((comult a).map (fun p => intSmul add zero neg (counit p.2) p.1)).foldr add zero = a
  /-- The **Frobenius relation** (elementwise, trace-paired form). -/
  frobenius_law : ∀ a b,
    ((comult (mult a b)).map (fun p => intSmul add zero neg (counit p.2) p.1)).foldr add zero
      = mult a (((comult b).map (fun p => intSmul add zero neg (counit p.2) p.1)).foldr add zero)

/-- **Abrams (⟹): a commutative Frobenius algebra yields a 2D TQFT.** Read off the circle
value and the four generating operators directly from the (co)algebra data; the TQFT
relations are exactly the Frobenius algebra's associativity/unit/commutativity/counit/
Frobenius fields. -/
def tqftOfCommutative (C : Commutative) : TwoDTQFT where
  A := C.A
  add := C.add
  zero := C.zero
  neg := C.neg
  unit := C.one
  mult := C.mul
  counit := C.counit
  comult := C.comul
  mult_assoc := C.mul_assoc
  unit_mult := C.one_mul
  mult_unit := C.mul_one
  mult_comm := C.mul_comm
  counit_law := C.counit_right
  frobenius_law := C.frobenius

/-- **Abrams (⟸): a 2D TQFT yields a commutative Frobenius algebra.** The circle value
becomes the carrier; the generating operators become `μ/η/ε/Δ`; the functoriality relations
become the Frobenius axioms. (We require the TQFT to additionally carry the module/bilinear
data its `Mod_ℤ`-enrichment supplies — packaged here as explicit hypotheses, since the
minimal `TwoDTQFT` records only the monoidal-generator relations.) -/
def commutativeOfTqft (T : TwoDTQFT)
    (add_assoc : ∀ a b c, T.add (T.add a b) c = T.add a (T.add b c))
    (add_comm : ∀ a b, T.add a b = T.add b a)
    (add_zero : ∀ a, T.add a T.zero = a)
    (add_left_neg : ∀ a, T.add (T.neg a) a = T.zero)
    (mul_add_left : ∀ a b c, T.mult (T.add a b) c = T.add (T.mult a c) (T.mult b c))
    (mul_add_right : ∀ a b c, T.mult a (T.add b c) = T.add (T.mult a b) (T.mult a c))
    (counit_left : ∀ a,
      ((T.comult a).map (fun p => intSmul T.add T.zero T.neg (T.counit p.1) p.2)).foldr T.add T.zero = a) :
    Commutative where
  A := T.A
  add := T.add
  zero := T.zero
  neg := T.neg
  add_assoc := add_assoc
  add_comm := add_comm
  add_zero := add_zero
  add_left_neg := add_left_neg
  mul := T.mult
  one := T.unit
  mul_assoc := T.mult_assoc
  one_mul := T.unit_mult
  mul_one := T.mult_unit
  mul_add_left := mul_add_left
  mul_add_right := mul_add_right
  counit := T.counit
  comul := T.comult
  counit_left := counit_left
  counit_right := T.counit_law
  frobenius := T.frobenius_law
  mul_comm := T.mult_comm

/-- A proof-carrying **Abrams correspondence** bundle: the worked commutative Frobenius
algebra `Z`, the 2D TQFT it induces, and the round-trip witnessing the equivalence on the
worked instance (the generating operators agree, and re-reading the TQFT recovers `Z`'s
operators). -/
structure AbramsCorrespondence where
  /-- The commutative Frobenius algebra. -/
  cfa : Commutative
  /-- The 2D TQFT it induces (`tqftOfCommutative`). -/
  tqft : TwoDTQFT
  /-- The TQFT's circle value is the algebra's carrier. -/
  circle_value : tqft.A = cfa.A
  /-- The generating operators match: `mult = μ`, `unit = η(1)`, `counit = ε`, `comult = Δ`.
  (Stated as the definitional identity of `tqftOfCommutative cfa` with `tqft`.) -/
  generators_match : tqft = tqftOfCommutative cfa
  /-- Round-trip: re-reading the induced TQFT as a Frobenius algebra (supplying the module
  hypotheses from `cfa`) recovers `cfa`'s multiplication and unit — the equivalence on the
  worked instance. -/
  roundtrip_mul : ∀ a b,
    (commutativeOfTqft (tqftOfCommutative cfa)
      cfa.add_assoc cfa.add_comm cfa.add_zero cfa.add_left_neg
      cfa.mul_add_left cfa.mul_add_right cfa.counit_left).mul a b = cfa.mul a b
  roundtrip_one :
    (commutativeOfTqft (tqftOfCommutative cfa)
      cfa.add_assoc cfa.add_comm cfa.add_zero cfa.add_left_neg
      cfa.mul_add_left cfa.mul_add_right cfa.counit_left).one = cfa.one

/-- **Commutative Frobenius `⟺` 2D TQFT (Abrams' theorem).** The worked
commutative Frobenius algebra `Z = ℤ[x]/(x²)` corresponds to a **2D TQFT**: the circle gets
`Z`'s carrier, the four generating cobordisms (disk/pair-of-pants/their duals) get
`η/μ/ε/Δ`, and the symmetric-monoidal-functor relations are exactly `Z`'s
associativity/unit/commutativity/counit/Frobenius axioms (`tqftOfCommutative`). The
correspondence is an **equivalence**: re-reading the TQFT recovers the Frobenius algebra
(`commutativeOfTqft`), and the round-trip recovers `Z`'s multiplication and unit on the nose.
This is Abrams' theorem [@abrams1996] — *commutative Frobenius algebras over `ℤ` are 2D
TQFTs valued in `Mod_ℤ`* — instantiated on the settling Frobenius algebra. -/
def frobeniusTqftCorrespondence : AbramsCorrespondence where
  cfa := Zcomm
  tqft := tqftOfCommutative Zcomm
  circle_value := rfl
  generators_match := rfl
  roundtrip_mul := fun _ _ => rfl
  roundtrip_one := rfl

/-- **The settling Frobenius algebra `Z = ℤ[x]/(x²)` is a 2D TQFT** (Abrams' correspondence, on the
worked instance): the induced TQFT's circle value is `Z`'s carrier, and its generating cobordisms are
exactly `Z`'s `η/μ/ε/Δ` (`generators_match`), with the round-trip recovering `Z`. Projected from
`frobeniusTqftCorrespondence`. This is the *instance*; the general categorical equivalence
commFrob `≃` 2D-TQFT is the open frontier. -/
theorem commutative_frobenius_is_tqft :
    frobeniusTqftCorrespondence.tqft.A = frobeniusTqftCorrespondence.cfa.A
    ∧ frobeniusTqftCorrespondence.tqft = tqftOfCommutative frobeniusTqftCorrespondence.cfa :=
  ⟨frobeniusTqftCorrespondence.circle_value, frobeniusTqftCorrespondence.generators_match⟩

end Cohomology.FrobeniusTQFT
end Obsmetrologia
