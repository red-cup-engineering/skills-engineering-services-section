import Obsmetrologia.QuantumContextuality.MeasurementScenario
import Obsmetrologia.QuantumContextuality.PentagonSymmetry
import Obsmetrologia.Calculus.Real.IVT
import Obsmetrologia.Calculus.Real.Inverse
import Obsmetrologia.Calculus.Real.MultiplicationOrder

/-! # The KCBS pentagon, possibilistic layer: five exclusive measurements, classical bound 2

The Klyachko–Can–Binicioğlu–Shumovsky (KCBS) pentagon is the minimal contextuality witness: one
system, five yes/no measurements `v₀,…,v₄` on the vertices of `PentagonSymmetry.D5.adj`'s
five-cycle, with adjacent measurements exclusive (they cannot both answer "yes"). This module
builds the **possibilistic** layer, sketched in
`dev/content/notes/2026/06/28/2026-06-28-imaging-kcbs-pentagon.md`: the `Scenario`/`Model`
socket already built for the PR box (`MeasurementScenario`), instantiated on `C₅`, plus the
classical independence bound `α(C₅) = 2` as a finite decidable fact — no global `0/1` assignment
respecting exclusivity can answer "yes" on more than two of the five measurements.

This is the possibilistic half only. The *value* half (the quantum bound `√5`, the contextual
fraction) is real-valued and left for a sibling module, `QuantumContextuality.KCBSValue`, over
`Probability.RealStochasticInterval` — see `AperiodicOrder.Tiling.StepN.GoldenFieldBridge` for
the golden-field identity that value would land in.

## Main definitions

* `kcbsContexts`, `kcbsScenario` — the five KCBS contexts `{i,i+1}` on `Fin 5`.
* `kcbsAllowed`, `kcbsModel` — the exclusivity support: a context `[i,j]` allows `g` iff not both
  `g i` and `g j` are `true`.
* `trueCount` — the number of measurements a `Fin 5 → Bool` assignment answers "yes" on.

## Main results

* `kcbsModel_inhabited` — every context has a nonempty support (the all-`false` assignment).
* `kcbs_classical_bound` — **`α(C₅) = 2`**: any assignment satisfying the exclusivity support on
  every context answers "yes" on at most two of the five measurements.
* `kcbsQuantumValue_eq_sqrt5`, `two_lt_sqrtNat_five`,
  `kcbs_quantum_value_exceeds_classical` — the value layer: the five-vertex quantum sum is
  exactly `√5` on the internal Bishop reals, and `2 < √5` in the constructive order with
  explicit witness — the quantum value strictly exceeds the classical bound.

## Implementation notes

`kcbsModel` is not strongly contextual — the all-`false` assignment is a global section,
unlike the PR box. That is expected: KCBS's contextuality lives in the *value* (the classical
bound `2` versus the quantum `√5`), not in possibilistic non-existence of a global section. This
module supplies the classical side of that comparison only.

## References

`content/.../imaging-kcbs-pentagon`; mirrors `QuantumContextuality.prBox`.

## Tags

KCBS, contextuality, pentagon, five-cycle, independence number, exclusivity graph
-/

namespace Obsmetrologia
namespace QuantumContextuality

/-! ## The KCBS scenario -/

/-- The five KCBS contexts, the edges of the pentagon `{i, i+1 mod 5}`. -/
def kcbsContexts : List (List (Fin 5)) := [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]

/-- The KCBS scenario. -/
def kcbsScenario : Scenario (Fin 5) := ⟨kcbsContexts⟩

/-- The exclusivity support on a two-measurement context `[i, j]`: allowed iff not both `true`. -/
def kcbsAllowed (C : List (Fin 5)) (g : Fin 5 → Bool) : Bool :=
  match C with
  | [i, j] => !(g i && g j)
  | _ => false

/-- The **KCBS possibilistic model**. -/
def kcbsModel : Model (Fin 5) Bool where
  scenario := kcbsScenario
  support := fun C g => kcbsAllowed C g = true

/-- **Every KCBS context has a nonempty support.** The all-`false` assignment satisfies
exclusivity everywhere, unlike the PR box's `prBox_inhabited`, which needs a case split. -/
theorem kcbsModel_inhabited : AllContextsInhabited kcbsModel := by
  intro C hC
  refine ⟨fun _ => false, ?_⟩
  show kcbsAllowed C (fun _ => false) = true
  simp only [kcbsModel, kcbsScenario, kcbsContexts, List.mem_cons, List.not_mem_nil,
    or_false] at hC
  rcases hC with rfl | rfl | rfl | rfl | rfl <;> decide

/-! ## The classical independence bound `α(C₅) = 2` -/

/-- The number of measurements `g` answers "yes" on. -/
def trueCount (g : Fin 5 → Bool) : Nat :=
  (if g 0 then 1 else 0) + (if g 1 then 1 else 0) + (if g 2 then 1 else 0)
    + (if g 3 then 1 else 0) + (if g 4 then 1 else 0)

/-- The finite arithmetic core of the bound, over five bare `Bool`s: five pairwise exclusivity
constraints around a cycle force at most two `true`s. Decided by exhaustion over the `2⁵ = 32`
assignments. -/
theorem exclusiveBoolCount_le_two : ∀ b0 b1 b2 b3 b4 : Bool,
    (!(b0 && b1)) = true → (!(b1 && b2)) = true → (!(b2 && b3)) = true →
    (!(b3 && b4)) = true → (!(b4 && b0)) = true →
    (if b0 then 1 else 0) + (if b1 then 1 else 0) + (if b2 then 1 else 0)
      + (if b3 then 1 else 0) + (if b4 then 1 else 0) ≤ 2 := by decide

/-- **The classical independence bound `α(C₅) = 2`.** Any assignment `g` allowed by `kcbsModel`
on every context — a classical (noncontextual) valuation respecting exclusivity — answers "yes"
on at most two of the five measurements. This is the finite graph fact behind the KCBS
inequality `Σᵢ ⟨vᵢ⟩ ≤ 2`; the quantum value `√5` exceeding it is the value-layer's job. -/
theorem kcbs_classical_bound (g : Fin 5 → Bool)
    (hg : ∀ C, C ∈ kcbsScenario.contexts → kcbsModel.support C g) :
    trueCount g ≤ 2 := by
  have h0 := hg [0, 1] (by decide)
  have h1 := hg [1, 2] (by decide)
  have h2 := hg [2, 3] (by decide)
  have h3 := hg [3, 4] (by decide)
  have h4 := hg [4, 0] (by decide)
  simp only [kcbsModel, kcbsAllowed] at h0 h1 h2 h3 h4
  exact exclusiveBoolCount_le_two (g 0) (g 1) (g 2) (g 3) (g 4) h0 h1 h2 h3 h4

/-! ## The quantum value √5

The value layer of the pentagon. The KCBS quantum state assigns each vertex the exact
expectation `1/√5 = √5·(1/5)`; the five-vertex sum is `√5`, which strictly exceeds the
classical bound `2` of `kcbs_classical_bound`. Everything lives in the internal Bishop
reals: `√5` is `sqrtNat 5` with `(√5)² = 5` (`sq_sqrtNat`), `1/5` is the witnessed
inverse, and the strict excess is the constructive order's `Pos` with explicit index and
tail — rational data all the way down. -/

open Real.Internal

/-- The constant real `5` — the pentagon's context count — to witness invertibility. -/
def fiveReal : Real := Real.ofRat (Rat.ofNat kcbsContexts.length)

/-- `5` is positive, bounded below by `1`: the constant sequence needs no tail. -/
def fiveWitness : Real.PosWitness fiveReal where
  j := 0
  N := 0
  bound := by
    intro n _
    show Rat.invNatP 0 ≤ Rat.ofNat 5
    show Rat.mk ⟨1, 1, by decide⟩ ≤ Rat.mk (PreRat.ofNat 5)
    rw [Rat.mk_le]
    show (1 : Int) * 1 ≤ 5 * 1
    omega

/-- **`fifth := 1/5`**, built from `RReal.inv`. -/
def fifth : RReal := RReal.inv fiveReal fiveWitness

/-- **The field law** `|C| · (1/|C|) = 1`. -/
theorem five_mul_fifth :
    RReal.ofRat (Rat.ofNat kcbsContexts.length) * fifth = RReal.one :=
  RReal.mul_inv fiveReal fiveWitness

/-- The KCBS vertex expectation: `1/√|C| = √|C|·(1/|C|)` over the pentagon's five
contexts. -/
def kcbsWeight : RReal := sqrtNat kcbsContexts.length * fifth

/-- The KCBS quantum value: one vertex expectation per context of the pentagon,
`Σ_{C ∈ kcbsContexts} ⟨v_C⟩`. -/
def kcbsQuantumValue : RReal := RReal.sumConst kcbsContexts kcbsWeight

/-- The context fold unfolded: the pentagon has five contexts. -/
theorem kcbsQuantumValue_unfold :
    kcbsQuantumValue
      = kcbsWeight + kcbsWeight + kcbsWeight + kcbsWeight + kcbsWeight := by
  show kcbsWeight + (kcbsWeight + (kcbsWeight + (kcbsWeight + (kcbsWeight + RReal.zero))))
    = kcbsWeight + kcbsWeight + kcbsWeight + kcbsWeight + kcbsWeight
  rw [RReal.add_zero, ← RReal.add_assoc, ← RReal.add_assoc, ← RReal.add_assoc]

/-- Five copies of a real sum to five times it. -/
theorem five_fold_sum (w : RReal) :
    w + w + w + w + w = RReal.ofRat (Rat.ofNat kcbsContexts.length) * w := by
  show w + w + w + w + w = RReal.ofRat (Rat.ofNat 5) * w
  have h1 : RReal.ofRat (Rat.ofNat 5)
      = RReal.one + RReal.one + RReal.one + RReal.one + RReal.one := by
    show RReal.ofRat (Rat.ofNat 5)
      = RReal.ofRat Rat.one + RReal.ofRat Rat.one + RReal.ofRat Rat.one
        + RReal.ofRat Rat.one + RReal.ofRat Rat.one
    rw [← RReal.ofRat_add, ← RReal.ofRat_add, ← RReal.ofRat_add, ← RReal.ofRat_add]
    rfl
  rw [h1, RReal.mul_comm, RReal.left_distrib, RReal.left_distrib, RReal.left_distrib,
    RReal.left_distrib, RReal.mul_one]

/-- **The KCBS quantum value is `√5`**: the five-fold sum of `√5·(1/5)`. -/
theorem kcbsQuantumValue_eq_sqrt5 :
    kcbsQuantumValue = sqrtNat kcbsContexts.length := by
  rw [kcbsQuantumValue_unfold, five_fold_sum]
  show RReal.ofRat (Rat.ofNat 5) * (sqrtNat 5 * fifth) = sqrtNat 5
  rw [RReal.mul_comm (RReal.ofRat (Rat.ofNat 5)) (sqrtNat 5 * fifth), RReal.mul_assoc,
    RReal.mul_comm fifth (RReal.ofRat (Rat.ofNat 5))]
  show sqrtNat 5 * (RReal.ofRat (Rat.ofNat kcbsContexts.length) * fifth) = sqrtNat 5
  rw [five_mul_fifth, RReal.mul_one]

/-- The integer heart of `2 < √5`: past the tail, the floor approximation of `√5·m`
clears `11m/5`. -/
theorem sqrt_five_lower {m s : Nat} (hm : 31 ≤ m)
    (h1 : s * s ≤ 5 * (m * m)) (h2 : 5 * (m * m) < (s + 1) * (s + 1)) :
    11 * m ≤ 5 * s := by
  rcases Nat.lt_or_ge (5 * s) (11 * m) with hlt | hge
  · exfalso
    have hexpR : (s + 1) * (s + 1) = s * s + 2 * s + 1 := by
      rw [Nat.mul_succ, Nat.succ_mul]; omega
    have hV : (3 * m) * (3 * m) = 9 * (m * m) := by
      rw [Nat.mul_mul_mul_comm]
    have hs3 : s ≤ 3 * m := by
      refine le_of_mul_self_le_mul_self ?_
      omega
    have hsq : (5 * s + 1) * (5 * s + 1) ≤ (11 * m) * (11 * m) :=
      Nat.mul_self_le_mul_self (by omega)
    have hW : (5 * s) * (5 * s) = 25 * (s * s) := by
      rw [Nat.mul_mul_mul_comm]
    have hU : (11 * m) * (11 * m) = 121 * (m * m) := by
      rw [Nat.mul_mul_mul_comm]
    have hexpT : (5 * s + 1) * (5 * s + 1) = (5 * s) * (5 * s) + 2 * (5 * s) + 1 := by
      rw [Nat.mul_succ, Nat.succ_mul]; omega
    have hmm : 31 * m ≤ m * m := Nat.mul_le_mul_right m hm
    omega
  · exact hge

/-- **`2 < √5`** in the constructive order: the excess is at least `1/5`, witnessed past
tail index `30` on the floor-approximation sequence. -/
theorem two_lt_sqrtNat_five :
    RReal.ofRat (Rat.ofNat 2) < sqrtNat kcbsContexts.length := by
  show RReal.ofRat (Rat.ofNat 2) < sqrtNat 5
  show RReal.Pos (sqrtNat 5 + (-(RReal.ofRat (Rat.ofNat 2))))
  refine ⟨4, ?_⟩
  show Real.le (Real.ofRat (Rat.invNatP 4))
    (Real.add (sqrtReal 5) (Real.neg (Real.ofRat (Rat.ofNat 2))))
  intro k
  refine ⟨30, fun n hn => ?_⟩
  show Rat.invNatP 4 ≤ sqrtSeq 5 n + (-(Rat.ofNat 2)) + Rat.invNatP k
  have hstep : sqrtSeq 5 n + (-(Rat.ofNat 2))
      ≤ sqrtSeq 5 n + (-(Rat.ofNat 2)) + Rat.invNatP k :=
    Rat.le_add_nonneg _ (Rat.invNatP_nonneg k)
  refine Real.Internal.Rat.le_trans ?_ hstep
  show Rat.invNatP 4 ≤ sqrtSeq 5 n + (-(Rat.ofNat 2))
  have hspec := natSqrt_spec (5 * ((n + 1) * (n + 1)))
  have hkey : 11 * (n + 1) ≤ 5 * natSqrt (5 * ((n + 1) * (n + 1))) :=
    sqrt_five_lower (by omega) hspec.1 hspec.2
  show Rat.mk ⟨1, (4 : Int) + 1, by omega⟩
    ≤ Rat.mk ⟨(natSqrt (5 * ((n + 1) * (n + 1))) : Int), (n : Int) + 1, by omega⟩
      + Rat.mk ⟨-(2 : Int), 1, by decide⟩
  show Rat.mk ⟨1, (4 : Int) + 1, by omega⟩
    ≤ Rat.mk (PreRat.add ⟨(natSqrt (5 * ((n + 1) * (n + 1))) : Int), (n : Int) + 1, by omega⟩
        ⟨-(2 : Int), 1, by decide⟩)
  rw [Rat.mk_le]
  show (1 : Int) * (((n : Int) + 1) * 1)
    ≤ ((natSqrt (5 * ((n + 1) * (n + 1))) : Int) * 1 + (-(2 : Int)) * ((n : Int) + 1))
      * ((4 : Int) + 1)
  omega

/-- **The KCBS quantum value strictly exceeds the classical bound**: `Σᵢ ⟨vᵢ⟩ = √5 > 2`,
against `kcbs_classical_bound`'s `≤ 2` for every exclusive Boolean assignment. -/
theorem kcbs_quantum_value_exceeds_classical :
    kcbsQuantumValue = sqrtNat kcbsContexts.length
    ∧ RReal.ofRat (Rat.ofNat 2) < kcbsQuantumValue := by
  refine ⟨kcbsQuantumValue_eq_sqrt5, ?_⟩
  rw [kcbsQuantumValue_eq_sqrt5]
  exact two_lt_sqrtNat_five

end QuantumContextuality
end Obsmetrologia
