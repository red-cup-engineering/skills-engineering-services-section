import Obsmetrologia.Cohomology.CoordinationCohomology
import Obsmetrologia.Calculus.Probability.PoissonSettling

/-!
# Landauer entropy — the thermodynamic name of the coordination obstruction

Landauer's principle: erasing one bit of information costs `kT ln2` of entropy, while *reversible*
(information-preserving) operations are thermodynamically free. The deep content is **irreversibility
⟺ entropy generation** — and that is exactly the reversibility structure this development proved, at
two levels.

* **Incidence / cohomology.** The Möbius orthogonality `μ * ζ = δ` makes the down-summation `ζ`
  *invertible* — information-lossless, hence Landauer-free. Where the inversion fails — the
  coordination cohomology `Ȟ¹ ≠ 0`, the cyclic (non-forest) nerve — information is irreversibly lost.
  So `Ȟ¹` *is* the **Landauer entropy** in bits: one erased bit per independent cycle.
* **Stochastic.** The same principle for kernels: a **detailed-balance (reversible)** chain produces
  no entropy, so its stationary distribution is a settling fixed point with no obstruction.

This module names the identification and reuses the proved theorems on each side. The `kT ln2`
scaling (one bit per class) is the `edge_colouring_entropy` quantum; here the entropy is counted in
bits (the cohomology rank).

## Main results

* `landauer_zero_iff_reversible` — Landauer entropy vanishes iff the nerve is a forest (reversible).
* `landauer_eq_coordination_cost` — the entropy is the cycle count `|E| − (|V| − |C|)`.
* `reversible_is_landauer_free` — a detailed-balance kernel is stationary (the stochastic face).

## Tags

Landauer principle, entropy, reversibility, coordination cohomology, detailed balance
-/

namespace Obsmetrologia
namespace Landauer

open Obsmetrologia.Cohomology
open Obsmetrologia.Probability.Stochastic
open Obsmetrologia.Probability.PoissonSettling

/-- The **Landauer entropy** of a cover nerve, in bits: its `Ȟ¹` cycle rank — the irreducible
coordination obstructions, the bits the settling cannot reversibly recover. Each independent cycle
is one erased bit (`kT ln2` of thermodynamic entropy). -/
def landauerBits (N : CoverNerve) : Nat := N.H1rank

/-- **Landauer entropy vanishes iff the settling is reversible.** `landauerBits N = 0` exactly when
the cover nerve is a forest (acyclic) — the coordination-free, information-lossless case; the nonzero
classes are the irreversibly-lost bits. This is `h1_vanishes_iff_forest` read thermodynamically: the
cohomological gluing obstruction *is* the Landauer entropy. -/
theorem landauer_zero_iff_reversible (N : CoverNerve) :
    landauerBits N = 0 ↔ N.entities = N.cells + N.components :=
  CoverNerve.h1_vanishes_iff_forest N

/-- **The Landauer entropy is the coordination cost** `|E| − (|V| − |C|)` — the number of independent
cycles, each an irreducibly-erased bit. -/
theorem landauer_eq_coordination_cost (N : CoverNerve) :
    landauerBits N = N.cells - (N.entities - N.components) :=
  (CoverNerve.h1rank_is_coordination_cost N).1

/-- **Microscopic reversibility is Landauer-free.** A detailed-balance (reversible) kernel — rows
summing to `1`, `π(z)·P(z,o) = π(o)·P(o,z)` — has its distribution as a stationary settling fixed
point, with no entropy production. The stochastic face of "reversible ⟺ Landauer-free", the same
principle as the cohomological vanishing above. -/
theorem reversible_is_landauer_free {S : Type} {V : StochSemiring} (K : MarkovKernel S V)
    (π : S → V.carrier)
    (hrev : ∀ z o, V.mul (π z) (K.P z o) = V.mul (π o) (K.P o z))
    (hrow : ∀ o, K.sum (fun z => K.P o z) = V.one) :
    IsStationary K π :=
  detailed_balance_implies_stationary K π hrev hrow

end Landauer
end Obsmetrologia
