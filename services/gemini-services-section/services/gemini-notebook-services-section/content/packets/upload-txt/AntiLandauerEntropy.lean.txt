import Obsmetrologia.Cohomology.LandauerEntropy

/-!
# Anti-Landauer entropy and the index balance `H⁰ − H¹ = χ`

`LandauerEntropy` named the *irreversible* side: `landauerBits N = N.H1rank`, the cycle rank,
one erased bit per independent coordination cycle (`coker Δ`). Its dual — the *reversible,
harmonic* side — was unnamed. This module names it and proves the conservation law that ties the
two.

The **anti-Landauer entropy** is `H⁰ = ker Δ`: the dimension of the space of global sections the
settling recovers **losslessly** — the harmonic content (`LawvereHarmonicCohomology`,
`Flow.LawvereKernelH0`), the bits no erasure touches. Where Landauer entropy counts what settling
must irreversibly discard, anti-Landauer entropy counts what it reversibly keeps.

The two are not independent: their difference is the nerve's **Euler characteristic**

  `H⁰ − H¹ = |C| − (|E| − |V| + |C|) = |V| − |E| = χ`,

a topological invariant of the cover. So `antiLandauerBits − landauerBits = χ` is a discrete
**index theorem**: the reversible (harmonic / `ker Δ`) side minus the irreversible (obstruction /
`coker Δ`) side equals `χ`, fixed by the nerve's `(|V|, |E|)` counts alone. In a
cohomology-vanishing (reversible) regime `H¹ = 0`, the whole index is harmonic — the settled
section is pure anti-Landauer content.

## Main definitions

* `antiLandauerBits` — the reversible/harmonic entropy `H⁰`, the global-section (`ker Δ`) dimension.
* `eulerChar` — the cover nerve's Euler characteristic `χ = |V| − |E|`, over `Int`.
* `consensusCharge` — the `H⁰` side of the signed ledger.
* `contradictionCharge` — the `H¹` side of the signed ledger.
* `antimatterCharge` — the `H⁰` component contribution, aliasing the anti-Landauer side.
* `matterCharge` — the `H¹` cycle contribution, aliasing the Landauer side.
* `netCharge` — the conserved Euler index in charge notation.
* `Vacuum` — the zero-net ledger condition.
* `PreservesEuler` — the allowed index-preserving transition relation on finite nerves.
* `ClosureIndexStep` — a closure-step witness after projection to the index ledger.

## Main results

* `index_balance` — `antiLandauerBits − landauerBits = χ` (over `Int`): the discrete index theorem.
* `net_charge_balance` — the same index theorem in charge notation.
* `matter_antimatter_balance` — the signed matter/antimatter ledger is the same conserved net charge.
* `vacuum_iff_charge_balance` — zero net means the two charges cancel.
* `equal_pair_creation_preserves_net` — equal consensus/contradiction creation preserves the net.
* `fixed_net_cycle_requires_consensus` — at fixed net, contradiction creation forces consensus creation.
* `fixed_net_consensus_annihilation_requires_cycle_annihilation` — at fixed net, consensus annihilation
  forces contradiction annihilation.
* `preservesEuler_iff_balanced_h0_h1_delta` — preserving `χ` is exactly balanced movement of `H⁰`
  and `H¹`.
* `ClosureIndexStep.preserves_net_charge` — every index-preserving closure step conserves the
  signed charge.
* `reversible_index_all_harmonic` — when Landauer entropy vanishes, `χ` is carried entirely by the
  anti-Landauer (harmonic) side.
* `tree_index_balance` — the assumption-free tree witness: `H⁰ = 1`, `H¹ = 0`, `χ = 1`.

## Tags

anti-Landauer entropy, harmonic, index theorem, Euler characteristic, coordination cohomology
-/

namespace Obsmetrologia
namespace AntiLandauer

open Obsmetrologia.Cohomology

/-- The **anti-Landauer entropy** of a cover nerve, in bits: its `Ȟ⁰` — the dimension of the space
of global sections (`ker Δ`, the harmonic kernel). The reversible, information-lossless content the
settling keeps; dual to `Landauer.landauerBits = Ȟ¹`. -/
def antiLandauerBits (N : CoverNerve) : Nat := N.H0rank

/-- **Anti-Landauer entropy is the harmonic kernel dimension** `H⁰ = |C|` — the component count,
the `ker Δ` side of the incidence Laplacian (`CoverNerve.laplacian_kernel_cokernel`). -/
theorem antiLandauer_eq_components (N : CoverNerve) :
    antiLandauerBits N = N.components := rfl

/-- The **Euler characteristic** of the cover nerve, `χ = |V| − |E|`, over `Int` (the difference
can be negative — a cyclic nerve has more 1-cells than 0-cells). -/
def eulerChar (N : CoverNerve) : Int := (N.entities : Int) - (N.cells : Int)

/-- **The index balance `H⁰ − H¹ = χ`.** The reversible (anti-Landauer / harmonic / `ker Δ`) side
minus the irreversible (Landauer / obstruction / `coker Δ`) side equals the nerve's Euler
characteristic — a topological invariant fixed by `(|V|, |E|)` alone. The discrete index theorem:
settling conserves `χ`, redistributing it between harmonic and obstruction content. -/
theorem index_balance (N : CoverNerve) :
    (antiLandauerBits N : Int) - (Landauer.landauerBits N : Int) = eulerChar N := by
  have h := N.entities_le_cells_add_components
  simp only [antiLandauerBits, Landauer.landauerBits, eulerChar,
    CoverNerve.H0rank, CoverNerve.H1rank]
  omega

/-! ## Charge notation for the same index ledger -/

/-- The **consensus charge** of a cover nerve: the `H⁰` side, counted by independent connected
components or global-section modes. -/
def consensusCharge (N : CoverNerve) : Nat := antiLandauerBits N

/-- The **contradiction charge** of a cover nerve: the `H¹` side, counted by independent
coordination cycles. -/
def contradictionCharge (N : CoverNerve) : Nat := Landauer.landauerBits N

/-- The signed **net charge** of the finite ledger: the Euler characteristic `χ`. -/
def netCharge (N : CoverNerve) : Int := eulerChar N

/-- The anti-matter contribution of the finite ledger: the `H⁰` component/global-section side. -/
def antimatterCharge (N : CoverNerve) : Nat := consensusCharge N

/-- The matter contribution of the finite ledger: the `H¹` cycle/obstruction side. -/
def matterCharge (N : CoverNerve) : Nat := contradictionCharge N

/-- The finite-index **vacuum** condition: consensus and contradiction charges have zero net. -/
def Vacuum (N : CoverNerve) : Prop := netCharge N = 0

/-- Consensus charge is exactly the zeroth cohomology rank. -/
theorem consensusCharge_eq_H0rank (N : CoverNerve) :
    consensusCharge N = N.H0rank := rfl

/-- Contradiction charge is exactly the first cohomology rank. -/
theorem contradictionCharge_eq_H1rank (N : CoverNerve) :
    contradictionCharge N = N.H1rank := rfl

/-- Anti-matter charge is exactly the anti-Landauer side. -/
theorem antimatterCharge_eq_antiLandauer (N : CoverNerve) :
    antimatterCharge N = antiLandauerBits N := rfl

/-- Matter charge is exactly the Landauer side. -/
theorem matterCharge_eq_landauer (N : CoverNerve) :
    matterCharge N = Landauer.landauerBits N := rfl

/-- The index balance in charge notation: consensus minus contradiction equals the net charge. -/
theorem net_charge_balance (N : CoverNerve) :
    (consensusCharge N : Int) - (contradictionCharge N : Int) = netCharge N :=
  index_balance N

/-- The same signed ledger in matter/anti-matter notation: anti-matter minus matter is the net
Euler charge. -/
theorem matter_antimatter_balance (N : CoverNerve) :
    (antimatterCharge N : Int) - (matterCharge N : Int) = netCharge N :=
  net_charge_balance N

/-- A vacuum ledger is exactly a ledger where consensus and contradiction charges cancel. -/
theorem vacuum_iff_charge_balance (N : CoverNerve) :
    Vacuum N ↔ (consensusCharge N : Int) = (contradictionCharge N : Int) := by
  unfold Vacuum
  rw [← net_charge_balance N]
  constructor <;> intro h <;> omega

/-- Equal pair creation on the two sides of the ledger preserves the net charge. -/
theorem equal_pair_creation_preserves_net (N N' : CoverNerve) (d : Nat)
    (h0 : consensusCharge N' = consensusCharge N + d)
    (h1 : contradictionCharge N' = contradictionCharge N + d) :
    netCharge N' = netCharge N := by
  have bN := net_charge_balance N
  have bN' := net_charge_balance N'
  omega

/-- At fixed net charge, creating `d` units of contradiction forces `d` units of consensus. -/
theorem fixed_net_cycle_requires_consensus (N N' : CoverNerve) (d : Nat)
    (hnet : netCharge N' = netCharge N)
    (h1 : contradictionCharge N' = contradictionCharge N + d) :
    consensusCharge N' = consensusCharge N + d := by
  have bN := net_charge_balance N
  have bN' := net_charge_balance N'
  omega

/-- At fixed net charge, annihilating `d` units of consensus forces `d` units of contradiction
annihilation. -/
theorem fixed_net_consensus_annihilation_requires_cycle_annihilation
    (N N' : CoverNerve) (d : Nat)
    (hnet : netCharge N' = netCharge N)
    (h0 : consensusCharge N = consensusCharge N' + d) :
    contradictionCharge N = contradictionCharge N' + d := by
  have bN := net_charge_balance N
  have bN' := net_charge_balance N'
  omega

/-! ## Index-preserving closure steps -/

/-- An allowed finite index transition: the cover nerve may change, but its Euler index is
preserved. This is the cover-nerve projection of a closure step that conserves the ledger. -/
def PreservesEuler (N N' : CoverNerve) : Prop := eulerChar N' = eulerChar N

/-- Preserving the Euler index is the same as preserving the signed net charge. -/
theorem preservesEuler_iff_preserves_netCharge (N N' : CoverNerve) :
    PreservesEuler N N' ↔ netCharge N' = netCharge N := Iff.rfl

/-- Preserving `χ` is exactly balanced movement of the two cohomology ranks:
the change in `H⁰` equals the change in `H¹`, over the signed ledger. -/
theorem preservesEuler_iff_balanced_h0_h1_delta (N N' : CoverNerve) :
    PreservesEuler N N' ↔
      (antiLandauerBits N' : Int) - (antiLandauerBits N : Int) =
        (Landauer.landauerBits N' : Int) - (Landauer.landauerBits N : Int) := by
  unfold PreservesEuler
  have bN := index_balance N
  have bN' := index_balance N'
  constructor <;> intro h <;> omega

/-- A closure step projected to the finite index ledger: it records the before and after nerves
and the proof that the step preserves the Euler index. -/
structure ClosureIndexStep where
  /-- The nerve before the closure step. -/
  before : CoverNerve
  /-- The nerve after the closure step. -/
  after : CoverNerve
  /-- The closure step preserves the Euler index. -/
  preserves_euler : PreservesEuler before after

namespace ClosureIndexStep

/-- The before-step `(H⁰, H¹)` ledger. -/
def beforeLedger (s : ClosureIndexStep) : Nat × Nat :=
  (antiLandauerBits s.before, Landauer.landauerBits s.before)

/-- The after-step `(H⁰, H¹)` ledger. -/
def afterLedger (s : ClosureIndexStep) : Nat × Nat :=
  (antiLandauerBits s.after, Landauer.landauerBits s.after)

/-- Every index-preserving closure step conserves the signed net charge. -/
theorem preserves_net_charge (s : ClosureIndexStep) :
    netCharge s.after = netCharge s.before :=
  s.preserves_euler

/-- Every index-preserving closure step moves `H⁰` and `H¹` by the same signed amount. -/
theorem balanced_h0_h1_delta (s : ClosureIndexStep) :
    (antiLandauerBits s.after : Int) - (antiLandauerBits s.before : Int) =
      (Landauer.landauerBits s.after : Int) - (Landauer.landauerBits s.before : Int) :=
  (preservesEuler_iff_balanced_h0_h1_delta s.before s.after).mp s.preserves_euler

/-- In matter/anti-matter notation, every index-preserving closure step keeps
`anti-matter − matter` fixed. -/
theorem preserves_matter_antimatter_balance (s : ClosureIndexStep) :
    (antimatterCharge s.after : Int) - (matterCharge s.after : Int) =
      (antimatterCharge s.before : Int) - (matterCharge s.before : Int) := by
  have hb := matter_antimatter_balance s.before
  have ha := matter_antimatter_balance s.after
  have hc := preserves_net_charge s
  omega

end ClosureIndexStep

/-- **A reversible nerve's index is entirely harmonic.** When the Landauer entropy vanishes
(`H¹ = 0`, the forest/coordination-free case), the Euler characteristic is carried wholly by the
anti-Landauer side: `χ = H⁰`. The cohomological reading of "the settled section is pure harmonic
form." -/
theorem reversible_index_all_harmonic (N : CoverNerve) (h : Landauer.landauerBits N = 0) :
    eulerChar N = (antiLandauerBits N : Int) := by
  have := index_balance N
  rw [h] at this
  omega

/-- **A forest's anti-Landauer entropy is its component count, and equals `χ`.** On the reversible
side (`H¹ = 0`) the harmonic content is `|C|` and that is the whole Euler characteristic. -/
theorem forest_antiLandauer (N : CoverNerve) (h : N.entities = N.cells + N.components) :
    antiLandauerBits N = N.components ∧ eulerChar N = (N.components : Int) := by
  refine ⟨rfl, ?_⟩
  simp only [eulerChar]
  omega

/-! ## The assumption-free tree witness -/

/-- **The tree index balance.** A finite tree's source–stance nerve has anti-Landauer entropy `1`
(one global section / harmonic mode), Landauer entropy `0` (reversible), and Euler characteristic
`1` — the `H⁰ − H¹ = χ` law on the connected, acyclic case, with everything graph-backed by the
tree's spanning identity `|E| + 1 = |V|` (`Discrete.Graph.FinTree.edge_count`). -/
theorem tree_index_balance {V : Type} [DecidableEq V]
    (T : Obsmetrologia.Discrete.Graph.FinTree V) :
    antiLandauerBits (CoverNerve.ofTree T) = 1
    ∧ Landauer.landauerBits (CoverNerve.ofTree T) = 0
    ∧ eulerChar (CoverNerve.ofTree T) = 1 := by
  have hc := T.edge_count
  refine ⟨rfl, tree_coordination_free T, ?_⟩
  show (T.fin.vcard : Int) - (T.fin.ecard : Int) = 1
  omega

end AntiLandauer
end Obsmetrologia
