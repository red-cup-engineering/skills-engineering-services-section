import Obsmetrologia.AperiodicOrder.Tiling.StepN.MetallicRoot
import Obsmetrologia.Dynamics.Flow.ChromaticTileGap
import Obsmetrologia.Calculus.Real.Inverse

/-! # The golden mean and the pentagon gap are the same field

`MetallicRoot.metallic_root` realizes the metallic means division-free, as the doubled quantity
`z = n + √(n²+4)`; the golden mean `φ = (1+√5)/2` is its `n = 1` case, `z = 1+√5`.
`ChromaticTileGap.tile5_gap_char_root` realizes the pentagon tile's spectral gap the same way, as
`w = 3-√5` (so `λ₅ = w/2`). `Calculus.Real.Inverse` now supplies `RReal` division on the
positive fragment, so this module builds `φ` and `λ₅` as actual (undoubled) reals: `half := 1/2`,
`φ := (1+√5)·half`, `λ₅ := (3-√5)·half`, and proves both the golden-field identity `φ + λ₅ = 2`
and — new content the doubled form couldn't state — the golden ratio's own defining
equation `φ·φ = φ + 1`. This is the golden-field leg of the Dervish Recurrence Conjecture: `√5`,
`φ`, `2-φ`, and `(3-√5)/2` are one field element's normalizations, not four coincidentally-similar
surds.

The doubled quantities `doubledPhi`/`doubledGap5` are kept (they are what `metallic_root` and
`tile5_gap_char_root` hand back directly, and downstream doubled-form uses stay valid); `φ`/`λ₅`
are the undoubled reals built on top via `half := RReal.inv 2 _`.

## Main definitions

* `half` — the real number `1/2`, built via `Calculus.Real.Inverse.RReal.inv` on `ofRat 2`.
* `phi`, `gap5` — the (undoubled) golden mean `φ` and pentagon gap `λ₅`.
* `doubledPhi`, `doubledGap5` — the doubled quantities `1+√5`, `3-√5` (kept for compatibility).

## Main results

* `two_mul_half` — **the field law** `2 · half = 1`.
* `phi_sq` — **the golden-ratio equation** `φ · φ = φ + 1`.
* `phi_add_gap5` — **the golden-field identity** `φ + λ₅ = 2`.
* `doubledPhi_add_doubledGap5` — the doubled-form identity `doubledPhi + doubledGap5 = 4`.

## References

`content/.../conjecture-on-dervishes` (metroplat); mirrors
`Obsmetrologia.AperiodicOrder.Tiling.StepN.MetallicRoot`, `Obsmetrologia.Flow.ChromaticTileGap`,
`Obsmetrologia.Calculus.Real.Inverse`.

## Tags

golden ratio, metallic mean, pentagon, spectral gap, quadratic field, real division
-/

namespace Obsmetrologia
namespace AperiodicOrder.Tiling.StepN

open Real.Internal

/-- **The doubled golden mean**, `2φ = 1 + √5` — the `n = 1` case of the metallic family,
division-free. -/
def doubledPhi : RReal := RReal.ofRat (Rat.ofNat 1) + sqrtNat 5

/-- **The doubled pentagon gap**, `2λ₅ = 3 - √5` — the pentagon tile's characteristic root,
doubled. -/
def doubledGap5 : RReal := RReal.ofRat (Rat.ofNat 3) + (- sqrtNat 5)

/-- `doubledPhi` satisfies the `n = 1` metallic recurrence: it is literally `metallic_root 1`,
restated at this module's name. -/
theorem doubledPhi_is_metallic_root :
    doubledPhi * doubledPhi
      = (RReal.ofRat (Rat.ofNat 1) + RReal.ofRat (Rat.ofNat 1)) * doubledPhi
          + RReal.ofRat (Rat.ofNat 4) := by
  have h := metallic_root 1
  simpa [doubledPhi] using h

/-- `doubledGap5` satisfies the pentagon-tile characteristic equation: it is literally
`Flow.tile5_gap_char_root`, restated at this module's name. -/
theorem doubledGap5_is_tile5_root :
    doubledGap5 * doubledGap5 + RReal.ofRat (Rat.ofNat 4)
      = (RReal.ofRat (Rat.ofNat 3) + RReal.ofRat (Rat.ofNat 3)) * doubledGap5 :=
  Flow.tile5_gap_char_root

/-- **The doubled golden-field identity.** `doubledPhi + doubledGap5 = 4`, i.e. `2φ + 2λ₅ = 4`.
The `√5` terms cancel by construction; the rest is `ℚ`-linear rearrangement of `RReal.add`. -/
theorem doubledPhi_add_doubledGap5 : doubledPhi + doubledGap5 = RReal.ofRat (Rat.ofNat 4) := by
  unfold doubledPhi doubledGap5
  rw [RReal.add_assoc, ← RReal.add_assoc (sqrtNat 5) (RReal.ofRat (Rat.ofNat 3)) (- sqrtNat 5),
    RReal.add_comm (sqrtNat 5) (RReal.ofRat (Rat.ofNat 3)),
    RReal.add_assoc (RReal.ofRat (Rat.ofNat 3)) (sqrtNat 5) (- sqrtNat 5),
    RReal.add_right_neg, RReal.add_zero, ← RReal.ofRat_add]
  congr 1

/-! ## The (undoubled) golden field, via real division -/

/-- The constant real `2`, as a `Real` Cauchy sequence (needed to state its `PosWitness`). -/
def twoReal : Real := Real.ofRat (Rat.ofNat 2)

/-- `2` is positive, bounded below by `1/(0+1) = 1`: the constant sequence needs no tail. -/
def twoWitness : Real.PosWitness twoReal where
  j := 0
  N := 0
  bound := by
    intro n _
    show Rat.invNatP 0 ≤ Rat.ofNat 2
    show Rat.mk ⟨1, 1, by decide⟩ ≤ Rat.mk (PreRat.ofNat 2)
    rw [Rat.mk_le]
    show (1:Int) * 1 ≤ 2 * 1
    omega

/-- **`half := 1/2`**, a real number built from `RReal.inv`. -/
def half : RReal := RReal.inv twoReal twoWitness

/-- **The field law** `2 · half = 1`. -/
theorem two_mul_half : RReal.ofRat (Rat.ofNat 2) * half = RReal.one :=
  RReal.mul_inv twoReal twoWitness

/-- A general cancellation law: if `a` has a two-sided inverse `b`, `a·x = a·y` forces `x = y`. -/
theorem RReal.mul_left_cancel_of_inv {a b x y : RReal} (hab : a * b = RReal.one)
    (h : a * x = a * y) : x = y := by
  have h2 : b * (a * x) = b * (a * y) := by rw [h]
  rw [← RReal.mul_assoc, ← RReal.mul_assoc, RReal.mul_comm b a, hab, RReal.one_mul,
    RReal.one_mul] at h2
  exact h2

/-- Two factors of a product square: `(a·b)·(a·b) = (a·a)·(b·b)`. -/
theorem RReal.sq_mul_sq (a b : RReal) : (a * b) * (a * b) = (a * a) * (b * b) := by
  calc (a * b) * (a * b)
      = a * (b * (a * b)) := by rw [RReal.mul_assoc]
    _ = a * ((b * a) * b) := by rw [RReal.mul_assoc]
    _ = a * ((a * b) * b) := by rw [RReal.mul_comm b a]
    _ = a * (a * (b * b)) := by rw [RReal.mul_assoc]
    _ = (a * a) * (b * b) := by rw [RReal.mul_assoc]

/-- **The golden mean** `φ = (1+√5) · half`. -/
def phi : RReal := doubledPhi * half

/-- **The pentagon gap** `λ₅ = (3-√5) · half`. -/
def gap5 : RReal := doubledGap5 * half

/-- `2 · φ = doubledPhi`: `φ` really is `doubledPhi` halved. -/
theorem two_mul_phi : RReal.ofRat (Rat.ofNat 2) * phi = doubledPhi := by
  show RReal.ofRat (Rat.ofNat 2) * (doubledPhi * half) = doubledPhi
  rw [← RReal.mul_assoc, RReal.mul_comm (RReal.ofRat (Rat.ofNat 2)) doubledPhi,
    RReal.mul_assoc, two_mul_half, RReal.mul_one]

/-- `1/4`, as `half·half`. -/
def quarter : RReal := half * half

/-- **The field law** `4 · quarter = 1`. -/
theorem four_mul_quarter : RReal.ofRat (Rat.ofNat 4) * quarter = RReal.one := by
  have h4 : RReal.ofRat (Rat.ofNat 4) = RReal.ofRat (Rat.ofNat 2) * RReal.ofRat (Rat.ofNat 2) := by
    rw [← RReal.ofRat_mul]; congr 1
  calc RReal.ofRat (Rat.ofNat 4) * quarter
      = (RReal.ofRat (Rat.ofNat 2) * RReal.ofRat (Rat.ofNat 2)) * (half * half) := by
        rw [h4]; rfl
    _ = RReal.ofRat (Rat.ofNat 2) * (RReal.ofRat (Rat.ofNat 2) * (half * half)) := by
        rw [RReal.mul_assoc]
    _ = RReal.ofRat (Rat.ofNat 2) * ((RReal.ofRat (Rat.ofNat 2) * half) * half) := by
        rw [RReal.mul_assoc]
    _ = RReal.ofRat (Rat.ofNat 2) * (RReal.one * half) := by rw [two_mul_half]
    _ = RReal.ofRat (Rat.ofNat 2) * half := by rw [RReal.one_mul]
    _ = RReal.one := two_mul_half

/-- **The golden-ratio equation.** `φ·φ = φ + 1` — the defining equation of the golden ratio,
new content the doubled form (`doubledPhi_is_metallic_root`) could only state as
`(2φ)² = 2·(2φ)+4`. Derived by substituting `doubledPhi = 2φ` into `metallic_root 1` and
cancelling the resulting common factor `4` via its inverse `quarter`. -/
theorem phi_sq : phi * phi = phi + RReal.ofRat (Rat.ofNat 1) := by
  have hMR : doubledPhi * doubledPhi
      = (RReal.ofRat (Rat.ofNat 1) + RReal.ofRat (Rat.ofNat 1)) * doubledPhi
        + RReal.ofRat (Rat.ofNat 4) :=
    doubledPhi_is_metallic_root
  rw [← two_mul_phi] at hMR
  have h11 : RReal.ofRat (Rat.ofNat 1) + RReal.ofRat (Rat.ofNat 1) = RReal.ofRat (Rat.ofNat 2) := by
    rw [← RReal.ofRat_add]; congr 1
  rw [h11] at hMR
  rw [RReal.sq_mul_sq] at hMR
  have h4 : RReal.ofRat (Rat.ofNat 2) * RReal.ofRat (Rat.ofNat 2) = RReal.ofRat (Rat.ofNat 4) := by
    rw [← RReal.ofRat_mul]; congr 1
  have hLHS2 : RReal.ofRat (Rat.ofNat 2) * RReal.ofRat (Rat.ofNat 2) * (phi * phi)
      = RReal.ofRat (Rat.ofNat 4) * (phi * phi) := by rw [h4]
  have hRHS2 : RReal.ofRat (Rat.ofNat 2) * (RReal.ofRat (Rat.ofNat 2) * phi)
      = RReal.ofRat (Rat.ofNat 4) * phi := by rw [← RReal.mul_assoc, h4]
  rw [hLHS2, hRHS2] at hMR
  have h41 : RReal.ofRat (Rat.ofNat 4) * RReal.ofRat (Rat.ofNat 1) = RReal.ofRat (Rat.ofNat 4) := by
    rw [← RReal.ofRat_mul]; congr 1
  have hRHS : RReal.ofRat (Rat.ofNat 4) * phi + RReal.ofRat (Rat.ofNat 4)
      = RReal.ofRat (Rat.ofNat 4) * (phi + RReal.ofRat (Rat.ofNat 1)) := by
    rw [RReal.left_distrib, h41]
  rw [hRHS] at hMR
  exact RReal.mul_left_cancel_of_inv four_mul_quarter hMR

/-- **The golden-field identity, undoubled.** `φ + λ₅ = 2` — the, division-complete form
of `doubledPhi_add_doubledGap5`. -/
theorem phi_add_gap5 : phi + gap5 = RReal.ofRat (Rat.ofNat 2) := by
  show doubledPhi * half + doubledGap5 * half = RReal.ofRat (Rat.ofNat 2)
  rw [← RReal.right_distrib, doubledPhi_add_doubledGap5]
  have h4 : RReal.ofRat (Rat.ofNat 4) = RReal.ofRat (Rat.ofNat 2) + RReal.ofRat (Rat.ofNat 2) := by
    rw [← RReal.ofRat_add]; congr 1
  rw [h4, RReal.right_distrib, two_mul_half]
  show RReal.one + RReal.one = RReal.ofRat (Rat.ofNat 2)
  show RReal.ofRat (Rat.ofNat 1) + RReal.ofRat (Rat.ofNat 1) = RReal.ofRat (Rat.ofNat 2)
  rw [← RReal.ofRat_add]
  congr 1

end AperiodicOrder.Tiling.StepN
end Obsmetrologia
