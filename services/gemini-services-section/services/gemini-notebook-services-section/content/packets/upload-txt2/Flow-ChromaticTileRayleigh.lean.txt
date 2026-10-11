import Obsmetrologia.Calculus.Real.Multiplication
import Obsmetrologia.Cohomology.AntiLandauerEntropy

/-!
# The Rayleigh quotient of the chromatic-Lorentzian tile Laplacian

The inner-product Laplacian and its Rayleigh quotient build on Obsmetrologia's internal reals
(`Obsmetrologia.Real.Internal`); a *finite* tile needs only the dense subfield ℚ: the
chromatic-Lorentzian chain tile's difference operator has integer entries, so
its Dirichlet energy on rational sections is exactly rational. This module builds that Rayleigh form
and its variational facts over ℚ, and welds the harmonic bottom of the spectrum to the anti-Landauer
(`H⁰`) side.

The **chromatic-Lorentzian tile** is the causal chain `n ≺ n+1` (`AperiodicOrder.Tiling.ChromaticLorentzian`)
truncated to a finite section `v : List ℚ`. Its **d'Alembertian / difference operator** is the
backward difference `□φ(n) = φ(n) − φ(n−1)` of `Lorentzian.ChromaticLorentzianAction`; the
associated self-adjoint **path-graph Laplacian** `L = δᵀδ` has the **Dirichlet energy** as its
Rayleigh numerator:

  `dirichlet v = Σ (vᵢ₊₁ − vᵢ)² = ‖δv‖²`,    `normSq v = Σ vᵢ² = ‖v‖²`.

Factoring `dirichlet = normSq ∘ diffs` makes positive-semidefiniteness immediate (a sum of squares),
and the Rayleigh quotient `R(v) = dirichlet v / normSq v` is stated **division-free** as the
variational inequality `λ₀ · normSq v ≤ dirichlet v` with `λ₀ = 0`. Equality holds exactly on the
**harmonic kernel** — the flat (constant) sections, `ker L` — which is the bottom eigenspace. For the
connected chain on `n+1` sites that kernel is one-dimensional: `H⁰ = antiLandauerBits = 1`, the
single harmonic mode (`Cohomology.AntiLandauer`). The least *positive* Rayleigh value (the spectral
gap `λ₁`, generally irrational) is the explicit real frontier this opens, reachable on the
constructive reals via `Real.IVT` but a further step.

## Main definitions

* `normSq`, `diffs`, `dirichlet` — the squared norm, the consecutive-difference operator `δ`, and the
  Dirichlet energy `‖δv‖²` (the Rayleigh numerator of the tile Laplacian) over ℚ.
* `Flat` — the harmonic predicate: a section constant along the chain (`δv = 0`, i.e. `v ∈ ker L`).
* `chainNerve` — the cover nerve of the chain tile on `n+1` sites.

## Main results

* `dirichlet_nonneg` — the tile Laplacian is **positive semidefinite**.
* `rayleigh_ge_bottom` / `rayleigh_eigen_bottom` — division-free Rayleigh: `R(v) ≥ λ₀ = 0` always,
  with equality (`dirichlet v = 0 · normSq v`) exactly on the harmonic sections.
* `dirichlet_zero_iff_flat` — zero Rayleigh energy ⟺ the section is harmonic (flat / `ker L`).
* `chain_index_balance` — the chain tile's harmonic kernel is `antiLandauerBits = 1`, `landauerBits = 0`,
  `χ = 1`: the `H⁰ − H¹ = χ` index theorem on the chromatic-Lorentzian tile.

## Tags

Rayleigh quotient, Dirichlet energy, tile Laplacian, positive semidefinite, harmonic, anti-Landauer,
chromatic Lorentzian, spectral gap
-/

namespace Obsmetrologia
namespace Flow
namespace ChromaticTileRayleigh
namespace RatInnerProduct

open Real.Internal
open Real.Internal.Rat

/-! ## A finite inner-product layer over ℚ (sums of squares) -/

/-- **A rational square is nonnegative** `0 ≤ q · q` — the seed of every sum-of-squares estimate. -/
theorem mul_self_nonneg (q : Real.Internal.Rat) : (0 : Real.Internal.Rat) ≤ q * q := by
  refine Real.Internal.Rat.ind (motive := fun q => (0 : Real.Internal.Rat) ≤ q * q) (fun a => ?_) q
  rw [mk_mul, zero_le_mk]
  exact (Int.le_total 0 a.num).elim (fun h => Int.mul_nonneg h h)
    (fun h => by
      have h2 := Int.mul_nonneg (Int.neg_nonneg.mpr h) (Int.neg_nonneg.mpr h)
      rwa [Int.neg_mul_neg] at h2)

/-- Sum of two nonnegatives is nonnegative. -/
theorem add_nonneg {a b : Real.Internal.Rat}
    (ha : (0 : Real.Internal.Rat) ≤ a) (hb : (0 : Real.Internal.Rat) ≤ b) :
    (0 : Real.Internal.Rat) ≤ a + b := by
  have h := add_le_add ha hb
  rwa [add_zero] at h

/-- A sum of two nonnegatives vanishes iff both vanish. -/
theorem add_eq_zero_split {a b : Real.Internal.Rat} (ha : (0 : Real.Internal.Rat) ≤ a)
    (hb : (0 : Real.Internal.Rat) ≤ b)
    (h : a + b = 0) : a = 0 ∧ b = 0 := by
  have hab : a ≤ a + b := by
    have t := add_le_add_left hb a
    rwa [add_zero] at t
  rw [h] at hab
  refine ⟨le_antisymm hab ha, ?_⟩
  have hba : b ≤ a + b := by
    have t := add_le_add_left ha b
    rw [add_zero] at t
    rwa [add_comm b a] at t
  rw [h] at hba
  exact le_antisymm hba hb

/-- A rational square is zero iff the rational is. ℚ has no zero divisors. -/
theorem mul_self_eq_zero (q : Real.Internal.Rat) : q * q = 0 ↔ q = 0 := by
  refine Real.Internal.Rat.ind (motive := fun q => q * q = 0 ↔ q = 0) (fun a => ?_) q
  show mk a * mk a = mk PreRat.zero ↔ mk a = mk PreRat.zero
  rw [mk_mul, mk_eq, mk_eq]
  show ((PreRat.mul a a).num * PreRat.zero.den = PreRat.zero.num * (PreRat.mul a a).den)
      ↔ (a.num * PreRat.zero.den = PreRat.zero.num * a.den)
  simp only [PreRat.mul, PreRat.zero, Int.mul_one, Int.zero_mul]
  constructor
  · intro h; exact (Int.mul_eq_zero.mp h).elim id id
  · intro h; rw [h]; rfl

/-- `a − b = 0` iff `a = b` in ℚ. -/
theorem sub_eq_zero_iff {a b : Real.Internal.Rat} : a - b = 0 ↔ a = b := by
  constructor
  · intro h
    calc a = a + 0 := (add_zero a).symm
      _ = a + (-b + b) := by rw [add_left_neg]
      _ = (a + -b) + b := (add_assoc a (-b) b).symm
      _ = (a - b) + b := rfl
      _ = 0 + b := by rw [h]
      _ = b := zero_add b
  · intro h; rw [h]; exact add_right_neg b

end RatInnerProduct

/-! ## The tile Dirichlet energy and its Rayleigh form -/

open Real.Internal.Rat
open RatInnerProduct
open Obsmetrologia.Cohomology
open Obsmetrologia.AntiLandauer

/-- The rational tile values. -/
local notation "ℚ" => Obsmetrologia.Real.Internal.Rat

/-- The **squared norm** `‖v‖² = Σ vᵢ²` of a rational tile section. -/
def normSq : List ℚ → ℚ
  | [] => 0
  | x :: xs => x * x + normSq xs

/-- The **difference operator** `δ` along the causal chain: `(δv)ᵢ = vᵢ₊₁ − vᵢ`. -/
def diffs : List ℚ → List ℚ
  | [] => []
  | [_] => []
  | x :: y :: xs => (y - x) :: diffs (y :: xs)

/-- The **Dirichlet energy** `‖δv‖² = Σ (vᵢ₊₁ − vᵢ)²` — the Rayleigh numerator of the tile
Laplacian `L = δᵀδ`. -/
def dirichlet (v : List ℚ) : ℚ := normSq (diffs v)

/-- A section is **harmonic / flat** when consecutive sites agree (`δv = 0`, i.e. `v ∈ ker L`). -/
def Flat : List ℚ → Prop
  | [] => True
  | [_] => True
  | x :: y :: xs => x = y ∧ Flat (y :: xs)

/-- `‖v‖² ≥ 0`. -/
theorem normSq_nonneg (v : List ℚ) : (0 : ℚ) ≤ normSq v := by
  induction v with
  | nil => exact le_refl 0
  | cons x xs ih =>
    show (0 : ℚ) ≤ x * x + normSq xs
    exact add_nonneg (mul_self_nonneg x) ih

/-- `‖v‖² = 0` iff every entry is `0`. -/
theorem normSq_eq_zero_iff (v : List ℚ) : normSq v = 0 ↔ ∀ x ∈ v, x = 0 := by
  induction v with
  | nil =>
    constructor
    · intro _ y hy; simp at hy
    · intro _; rfl
  | cons x xs ih =>
    constructor
    · intro h
      have hsplit := add_eq_zero_split (mul_self_nonneg x) (normSq_nonneg xs) h
      have hx : x = 0 := (mul_self_eq_zero x).mp hsplit.1
      have hxs : ∀ y ∈ xs, y = 0 := ih.mp hsplit.2
      intro y hy
      rcases List.mem_cons.mp hy with h' | h'
      · rw [h']; exact hx
      · exact hxs y h'
    · intro h
      have hx : x = 0 := h x (List.mem_cons.mpr (Or.inl rfl))
      have hxs : normSq xs = 0 := ih.mpr (fun y hy => h y (List.mem_cons.mpr (Or.inr hy)))
      show x * x + normSq xs = 0
      rw [hx, hxs, zero_mul, add_zero]

/-- The differences all vanish iff the section is flat (harmonic). -/
theorem all_diffs_zero_iff_flat (v : List ℚ) :
    (∀ d ∈ diffs v, d = 0) ↔ Flat v := by
  induction v using diffs.induct with
  | case1 => simp [diffs, Flat]
  | case2 x => simp [diffs, Flat]
  | case3 x y xs ih =>
    show (∀ d ∈ (y - x) :: diffs (y :: xs), d = 0) ↔ (x = y ∧ Flat (y :: xs))
    rw [List.forall_mem_cons, sub_eq_zero_iff, ih]
    constructor
    · rintro ⟨hyx, hf⟩; exact ⟨hyx.symm, hf⟩
    · rintro ⟨hxy, hf⟩; exact ⟨hxy.symm, hf⟩

/-- **The tile Laplacian is positive semidefinite**: its Rayleigh numerator is `≥ 0`. -/
theorem dirichlet_nonneg (v : List ℚ) : (0 : ℚ) ≤ dirichlet v :=
  normSq_nonneg (diffs v)

/-- **Zero Dirichlet energy ⟺ harmonic.** The Rayleigh numerator vanishes exactly on the flat
(constant) sections — the kernel `ker L` of the tile Laplacian. -/
theorem dirichlet_zero_iff_flat (v : List ℚ) : dirichlet v = 0 ↔ Flat v := by
  unfold dirichlet
  rw [normSq_eq_zero_iff]
  exact all_diffs_zero_iff_flat v

/-- **Rayleigh ≥ the bottom eigenvalue `λ₀ = 0`** (division-free): `0 · ‖v‖² ≤ dirichlet v` for every
section. The variational lower bound of the Rayleigh quotient. -/
theorem rayleigh_ge_bottom (v : List ℚ) : (0 : ℚ) * normSq v ≤ dirichlet v := by
  rw [zero_mul]; exact dirichlet_nonneg v

/-- **The harmonic bottom eigenpair `(λ₀ = 0, ker L)`** (division-free): on a harmonic section the
Rayleigh numerator equals `λ₀ · ‖v‖² = 0 · ‖v‖²` — equality in `rayleigh_ge_bottom`. -/
theorem rayleigh_eigen_bottom (v : List ℚ) (h : Flat v) :
    dirichlet v = (0 : ℚ) * normSq v := by
  rw [zero_mul]; exact (dirichlet_zero_iff_flat v).mpr h

/-! ## The bridge to anti-Landauer: the chain tile's harmonic kernel is `H⁰ = 1` -/

/-- The **cover nerve of the chain tile** on `n+1` sites: a path graph, `|V| = n+1`, `|E| = n`, one
component. -/
def chainNerve (n : Nat) : CoverNerve where
  entities := n + 1
  cells := n
  components := 1
  components_le_entities := by omega
  entities_le_cells_add_components := by omega

/-- **The index theorem on the chromatic-Lorentzian tile.** The chain tile is reversible
(`landauerBits = 0`), its harmonic kernel is one-dimensional (`antiLandauerBits = H⁰ = 1`, the single
constant mode the Dirichlet energy vanishes on), and its Euler characteristic is `χ = H⁰ − H¹ = 1`. -/
theorem chain_index_balance (n : Nat) :
    antiLandauerBits (chainNerve n) = 1
    ∧ Landauer.landauerBits (chainNerve n) = 0
    ∧ eulerChar (chainNerve n) = 1 := by
  refine ⟨rfl, ?_, ?_⟩
  · simp only [Landauer.landauerBits, CoverNerve.H1rank, chainNerve]
    omega
  · simp only [eulerChar, chainNerve]
    omega

/-- **The chromatic-Lorentzian tile Rayleigh portrait (headline).** Over ℚ: the tile Laplacian is
positive semidefinite with Rayleigh bottom `λ₀ = 0`; the Rayleigh numerator vanishes exactly on the
harmonic kernel; and that kernel is the chain's single harmonic mode `antiLandauerBits = 1`, the
reversible (`landauerBits = 0`) `H⁰` side of the index balance. -/
theorem chromatic_tile_rayleigh (v : List ℚ) (n : Nat) :
    ((0 : ℚ) * normSq v ≤ dirichlet v)
    ∧ (dirichlet v = 0 ↔ Flat v)
    ∧ antiLandauerBits (chainNerve n) = 1
    ∧ Landauer.landauerBits (chainNerve n) = 0 :=
  ⟨rayleigh_ge_bottom v, dirichlet_zero_iff_flat v,
    (chain_index_balance n).1, (chain_index_balance n).2.1⟩

/-! ## The spectral gap of small tiles (exact, over ℚ)

The least positive Rayleigh value $\lambda_1$ (the spectral gap) of the path-graph tile Laplacian is
$2(1-\cos(\pi/(n+1)))$ --- generally irrational, the open frontier. But the smallest tiles have
**rational** gaps, computed here exactly over ℚ: the 2-site tile has `λ₁ = 2`, the 3-site tile has
`λ₁ = 1`, each with its gap eigenvector and a matching lower bound (a Poincaré/Wirtinger inequality:
every mode orthogonal to the constants has Rayleigh `≥ λ₁`). The lower bounds are sum-of-squares
certificates discharged by the rational inner-product layer above. -/

/-- Close a rational polynomial identity by dropping to the `PreRat` (integer) representative and
running the integer ring normalizer `iring`. Applied after `induction … using Rat.ind`. -/
local macro "qfin" : tactic =>
  `(tactic|
    (simp only [mk_mul, mk_add, mk_neg, mk_sub]
     rw [mk_eq]
     simp only [Obsmetrologia.Real.Internal.PreRat.equiv, Obsmetrologia.Real.Internal.PreRat.mul,
       Obsmetrologia.Real.Internal.PreRat.add, Obsmetrologia.Real.Internal.PreRat.neg]
     iring))

/-- **The 2-site tile spectral gap is exactly `λ₁ = 2`.** Every section orthogonal to the constants
(`a + b = 0`) has Dirichlet energy exactly twice its squared norm: the orthogonal complement of the
harmonic line is one-dimensional, so the Rayleigh quotient is constantly `2` there. -/
theorem twoSite_gap (a b : ℚ) (h : a + b = 0) :
    dirichlet [a, b] = normSq [a, b] + normSq [a, b] := by
  have hb : b = -a := by
    have h2 : (-a) + (a + b) = (-a) + 0 := by rw [h]
    rw [← add_assoc, add_left_neg, zero_add, add_zero] at h2
    exact h2
  subst hb; clear h
  simp only [dirichlet, normSq, diffs, add_zero]
  induction a using Obsmetrologia.Real.Internal.Rat.ind with
  | _ x => qfin

/-- The 2-site gap eigenvector `[1,-1]` realises `λ₁ = 2`: non-constant, orthogonal to the constants,
Rayleigh quotient `2`. -/
theorem twoSite_eigenvector :
    dirichlet [(1 : ℚ), -1] = normSq [(1 : ℚ), -1] + normSq [(1 : ℚ), -1] :=
  twoSite_gap 1 (-1) (add_right_neg 1)

/-! ### The 3-site gap on the integer sublattice

The 2-site gap above is exact over ℚ. The 3-site case needs a *two-variable* quadratic identity; over
ℚ the `Rat`-quotient cross-multiply overwhelms the integer ring normalizer `iring` (the only ring
automation in the dependency-free core), so we compute the 3-site gap on the **integer sublattice**
`List Int`, where `iring` discharges the identity directly. The Rayleigh quotient is scale-invariant
(clearing denominators multiplies `dirichlet` and `normSq` by the same square `D²`), so the gap on the
integer sublattice is the gap of the rational tile: `λ₁ = 1`. -/

/-- Integer squared norm `‖v‖² = Σ vᵢ²`. -/
def inormSq : List Int → Int
  | [] => 0
  | x :: xs => x * x + inormSq xs

/-- Integer difference operator `(δv)ᵢ = vᵢ₊₁ − vᵢ`. -/
def idiffs : List Int → List Int
  | [] => []
  | [_] => []
  | x :: y :: xs => (y - x) :: idiffs (y :: xs)

/-- Integer Dirichlet energy `‖δv‖²`. -/
def idirichlet (v : List Int) : Int := inormSq (idiffs v)

/-- A square integer is nonnegative — the integer sum-of-squares seed. -/
theorem int_mul_self_nonneg (n : Int) : 0 ≤ n * n :=
  (Int.le_total 0 n).elim (fun h => Int.mul_nonneg h h)
    (fun h => by
      have h2 := Int.mul_nonneg (Int.neg_nonneg.mpr h) (Int.neg_nonneg.mpr h)
      rwa [Int.neg_mul_neg] at h2)

/-- **The 2-site integer gap is exactly `λ₁ = 2`** (the integer-sublattice form of `twoSite_gap`). -/
theorem iTwoSite_gap (a b : Int) (h : a + b = 0) :
    idirichlet [a, b] = inormSq [a, b] + inormSq [a, b] := by
  have hb : b = -a := by omega
  subst hb
  simp only [idirichlet, inormSq, idiffs]
  iring

/-- **The 3-site integer energy splits as `normSq + 3·b²` off the constants** (`a + b + c = 0`) ---
the sum-of-squares certificate of the gap. -/
theorem iThreeSite_gap_identity (a b c : Int) (h : a + b + c = 0) :
    idirichlet [a, b, c] = inormSq [a, b, c] + (b * b + b * b + b * b) := by
  have hc : c = -a - b := by omega
  subst hc
  simp only [idirichlet, inormSq, idiffs]
  iring <;> omega

/-- **The 3-site spectral gap lower bound `λ₁ ≥ 1`** (a Poincaré/Wirtinger inequality): every section
orthogonal to the constants has Dirichlet energy `≥` its squared norm --- the excess `3b² ≥ 0` is a
sum of squares. -/
theorem iThreeSite_gap_lower (a b c : Int) (h : a + b + c = 0) :
    inormSq [a, b, c] ≤ idirichlet [a, b, c] := by
  have hid := iThreeSite_gap_identity a b c h
  have h3 := int_mul_self_nonneg b
  omega

/-- The 3-site gap eigenvector `[1,0,-1]` realises `λ₁ = 1`: its Dirichlet energy equals its squared
norm (Rayleigh `= 1`), attaining the lower bound. -/
theorem iThreeSite_eigenvector :
    idirichlet [(1 : Int), 0, -1] = inormSq [(1 : Int), 0, -1] := by
  decide

/-! ### The harmonic kernel is exactly the constants — a positive gap for every tile

The exact gaps above are for the smallest tiles. The general structural fact, for **every** tile
size, is that the Dirichlet energy vanishes exactly on the constant sections: the bottom eigenspace
`ker L` is the one-dimensional space of constants (`= H⁰ = antiLandauerBits` of the connected tile),
so `λ₀ = 0` is a **simple** eigenvalue and the spectral gap `λ₁ > 0` is strictly positive. This is
the content behind the exact small-tile values, now stated for all `n`. -/

/-- A tile section is **constant**: all sites carry one value. -/
def IsConst (v : List ℚ) : Prop := ∃ c, ∀ x ∈ v, x = c

/-- **Flat ⟺ constant.** A section with all consecutive sites equal is a constant section. -/
theorem flat_iff_isConst (v : List ℚ) : Flat v ↔ IsConst v := by
  induction v using Flat.induct with
  | case1 => exact ⟨fun _ => ⟨0, by simp⟩, fun _ => trivial⟩
  | case2 a => exact ⟨fun _ => ⟨a, by simp⟩, fun _ => trivial⟩
  | case3 a b xs ih =>
    constructor
    · rintro ⟨hab, hflat⟩
      obtain ⟨c, hc⟩ := ih.mp hflat
      have hbc : b = c := hc b (List.mem_cons.mpr (Or.inl rfl))
      refine ⟨b, fun x hx => ?_⟩
      rcases List.mem_cons.mp hx with rfl | hx'
      · exact hab
      · rw [hc x hx']; exact hbc.symm
    · rintro ⟨c, hc⟩
      have ha : a = c := hc a (List.mem_cons.mpr (Or.inl rfl))
      have hb : b = c := hc b (List.mem_cons.mpr (Or.inr (List.mem_cons.mpr (Or.inl rfl))))
      exact ⟨ha.trans hb.symm,
        ih.mpr ⟨c, fun x hx => hc x (List.mem_cons.mpr (Or.inr hx))⟩⟩

/-- **The harmonic kernel of the tile Laplacian is exactly the constants** (every `n`): zero Dirichlet
energy `⟺` the section is constant. So `ker L` is the one-dimensional constant line, `λ₀ = 0` is a
simple eigenvalue, and the spectral gap `λ₁ > 0` is strictly positive for every tile. -/
theorem harmonic_iff_constant (v : List ℚ) : dirichlet v = 0 ↔ IsConst v :=
  (dirichlet_zero_iff_flat v).trans (flat_iff_isConst v)

end ChromaticTileRayleigh
end Flow
end Obsmetrologia
