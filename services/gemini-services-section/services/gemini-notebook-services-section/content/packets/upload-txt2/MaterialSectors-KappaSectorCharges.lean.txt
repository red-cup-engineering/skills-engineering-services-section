import Obsmetrologia.AperiodicOrder.Tiling.KappaStratification
import Obsmetrologia.AperiodicOrder.Crystal.Glass

/-!
# Material sector charges for the κ interface

This module records the proved material-sector part of the Scott-face frontier.
It does not identify Landauer, Collatz, and Zeta-star as one carrier.  It proves
that the checked κ-stratification interface can already be consumed by the
material glass rung, where the Landauer side is read as a basin-indexed `H¹`
matter ledger.

## Main definitions

* `MaterialSectorReadout` is the basin-level glass readout used here.
* `SectorInterface` bundles the checked κ interface with that material readout.
* `MaterialSharedKappaCarrier` is the first carrier-shaped tightening: the
  material basin nerve is the shared Landauer/`H¹` and
  anti-Landauer/`H⁰` carrier, with its signed matter/antimatter ledger.
* `FullSharedKappaCarrier` names the remaining stronger shared-carrier
  obligation, adding Collatz and Zeta-star carrier projections.

## Main results

* `material_sector_readout` projects the existing glass `H¹`/Landauer rung.
* `material_nerve_landauer_compat`, `material_nerve_h1_compat`,
  `material_nerve_antiLandauer_compat`, and `material_nerve_h0_compat`
  prove that the material basin nerve is exactly the local
  Landauer/`H¹` and anti-Landauer/`H⁰` carrier.
* `material_nerve_matter_antimatter_ledger` proves that the local signed
  anti-matter-minus-matter charge is the basin Euler ledger.
* `material_shared_kappa_carrier` gives the inhabited material carrier package.
* `sector_interface` is the bundle.
* `material_kappa_sector_charges` states the sector charge package around
  the still-open shared-carrier frontier.
* `full_shared_carrier_implies_sector_interface` proves that the stronger
  shared-carrier obligation consumes down to the current interface.
* `twoAdic_cylinderLiftGap` records that the cylinder-lift side is already
  constructed from the proved two-adic carry gap.
* `full_shared_kappa_carrier_iff_noPositiveInfiniteBarrierStream` and
  `full_shared_kappa_carrier_iff_frontierInputs` are the tightened boundary:
  the remaining carrier gap is the no-positive-infinite-stream/frontier input,
  not an extra Landauer/Scott/Zeta/material interface problem.
* `AntimatterBarrierBoundary` is the next tightened name: the material
  carrier's matter/anti-matter ledger is present, and the remaining Collatz
  obligation is the statement that the already constructed two-adic
  cylinder-lift face forces eventual coefficient contraction.
-/

namespace Obsmetrologia
namespace AperiodicOrder.MaterialSectors.KappaSectorCharges

open Obsmetrologia.Cohomology
open Obsmetrologia.Closure.Collatz
open Obsmetrologia.Thermodynamics.Temperature

/-- The material-sector readout contributed by a rational glass basin bridge:
free-energy descent, temperature thresholding, the `H¹`/Landauer equality,
load-bearing iff positive `H¹`, balanced flux, positive Landauer cost, and
positive hard-flow discharge. -/
structure MaterialSectorReadout {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) where
  /-- The bridge step does not raise rational free energy. -/
  freeEnergyDescent : γ.Omega (γ.step b) ≤ γ.Omega b
  /-- The bridge temperature is the distinguished-basin distribution value. -/
  temperature_eq_distribution :
    γ.temperature = γ.thermalization.distribution γ.thermalization.basin
  /-- The rational threshold is classified as frozen or hopping. -/
  threshold :
    γ.thermalization.frozenAt θ ∨ γ.thermalization.hoppingAt θ
  /-- The basin `H¹` rank is the basin Landauer bit count. -/
  h1Landauer :
    γ.thermalization.h1At b = γ.thermalization.landauerBitsAt b
  /-- Load-bearing is exactly positive basin `H¹`. -/
  loadBearing_iff_positive_h1 :
    γ.thermalization.loadBearingAt b ↔ 0 < γ.thermalization.h1At b
  /-- The basin flux is balanced. -/
  balancedFlux : Balanced γ.thermalization.toBasinThermalization.flux
  /-- The distinguished basin has positive Landauer cost. -/
  positiveLandauerCost :
    0 <
      γ.thermalization.toBasinThermalization.landauerCostAt
        γ.thermalization.basin
  /-- The hard-flow discharge is positive. -/
  positiveDischarge : 0 < γ.thermalization.firing.discharge

/-- The glass rung already proves the material-sector readout. -/
def material_sector_readout {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    MaterialSectorReadout γ b θ where
  freeEnergyDescent := (γ.produces_h1_glass_rung b θ).1
  temperature_eq_distribution := (γ.produces_h1_glass_rung b θ).2.1
  threshold := (γ.produces_h1_glass_rung b θ).2.2.1
  h1Landauer := (γ.produces_h1_glass_rung b θ).2.2.2.1
  loadBearing_iff_positive_h1 := (γ.produces_h1_glass_rung b θ).2.2.2.2.1
  balancedFlux := (γ.produces_h1_glass_rung b θ).2.2.2.2.2.1
  positiveLandauerCost := (γ.produces_h1_glass_rung b θ).2.2.2.2.2.2.1
  positiveDischarge := (γ.produces_h1_glass_rung b θ).2.2.2.2.2.2.2

/-- The material basin nerve is the exact nerve used to compute the rational
basin Landauer bit count. -/
theorem material_nerve_landauer_compat {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) :
    Landauer.landauerBits
        (γ.thermalization.toBasinThermalization.nerveAt b) =
      γ.thermalization.landauerBitsAt b := rfl

/-- The material basin nerve is the exact nerve used to compute the rational
basin `H¹` rank. -/
theorem material_nerve_h1_compat {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) :
    (γ.thermalization.toBasinThermalization.nerveAt b).H1rank =
      γ.thermalization.h1At b := rfl

/-- The material basin nerve is the exact nerve used to compute the rational
basin anti-Landauer bit count. -/
theorem material_nerve_antiLandauer_compat {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) :
    AntiLandauer.antiLandauerBits
        (γ.thermalization.toBasinThermalization.nerveAt b) =
      γ.thermalization.toBasinThermalization.antiLandauerBitsAt b := rfl

/-- The material basin nerve is the exact nerve used to compute the rational
basin `H⁰` rank. -/
theorem material_nerve_h0_compat {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) :
    (γ.thermalization.toBasinThermalization.nerveAt b).H0rank =
      γ.thermalization.toBasinThermalization.h0At b := rfl

/-- On the material basin nerve, the signed matter/anti-matter charge ledger
is exactly the basin Euler ledger. -/
theorem material_nerve_matter_antimatter_ledger {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) :
    (AntiLandauer.antimatterCharge
        (γ.thermalization.toBasinThermalization.nerveAt b) : Int) -
      (AntiLandauer.matterCharge
        (γ.thermalization.toBasinThermalization.nerveAt b) : Int) =
        γ.thermalization.toBasinThermalization.ledgerAt b :=
  (AntiLandauer.matter_antimatter_balance
    (γ.thermalization.toBasinThermalization.nerveAt b)).trans
      (γ.thermalization.toBasinThermalization.ledgerAt_eq_eulerChar b).symm

/-- The material side is already a shared Landauer/`H¹` carrier: the chosen
carrier nerve is the glass basin nerve, its Landauer bits and `H¹` rank are
the same quantities exposed by the material readout, and its anti-Landauer
`H⁰` side supplies the signed matter/anti-matter ledger. -/
structure MaterialSharedKappaCarrier {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) where
  /-- The local carrier nerve at the material basin. -/
  carrierNerve : CoverNerve
  /-- The carrier is identified with the basin thermalization nerve. -/
  identifiesMaterialNerve :
    carrierNerve = γ.thermalization.toBasinThermalization.nerveAt b
  /-- Landauer bits on the carrier are the material basin bit count. -/
  carrierLandauerBits :
    Landauer.landauerBits carrierNerve =
      γ.thermalization.landauerBitsAt b
  /-- The carrier's `H¹` rank is the material basin `H¹` rank. -/
  carrierH1Rank : carrierNerve.H1rank = γ.thermalization.h1At b
  /-- Anti-Landauer bits on the carrier are the material basin bit count. -/
  carrierAntiLandauerBits :
    AntiLandauer.antiLandauerBits carrierNerve =
      γ.thermalization.toBasinThermalization.antiLandauerBitsAt b
  /-- The carrier's `H⁰` rank is the material basin `H⁰` rank. -/
  carrierH0Rank :
    carrierNerve.H0rank =
      γ.thermalization.toBasinThermalization.h0At b
  /-- The carrier's signed anti-matter-minus-matter charge is the basin
  Euler ledger. -/
  carrierMatterAntimatterLedger :
    (AntiLandauer.antimatterCharge carrierNerve : Int) -
      (AntiLandauer.matterCharge carrierNerve : Int) =
        γ.thermalization.toBasinThermalization.ledgerAt b
  /-- The carrier participates in the material sector readout. -/
  materialReadout : MaterialSectorReadout γ b θ
  /-- The carrier retains the global Landauer/`H¹` identity. -/
  carrierLandauerIsH1 :
    Landauer.landauerBits carrierNerve = carrierNerve.H1rank
  /-- The Scott face remains the reversible `κ = ω` bridge. -/
  scottBridge :
    classify Cohomology.ScottFace.regimeData = ClosureRegime.scott ∧
      cohomologyVanishes (classify Cohomology.ScottFace.regimeData) = true
  /-- Zeta-star's currently inhabited residual interface is available. -/
  zetaResidual : AperiodicOrder.Tiling.ZetaStarAnalyticRichnessRecovery

/-- The material shared carrier is inhabited for every rational glass basin
bridge. -/
def material_shared_kappa_carrier {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    MaterialSharedKappaCarrier γ b θ where
  carrierNerve := γ.thermalization.toBasinThermalization.nerveAt b
  identifiesMaterialNerve := rfl
  carrierLandauerBits := material_nerve_landauer_compat γ b
  carrierH1Rank := material_nerve_h1_compat γ b
  carrierAntiLandauerBits := material_nerve_antiLandauer_compat γ b
  carrierH0Rank := material_nerve_h0_compat γ b
  carrierMatterAntimatterLedger :=
    material_nerve_matter_antimatter_ledger γ b
  materialReadout := material_sector_readout γ b θ
  carrierLandauerIsH1 :=
    AperiodicOrder.Tiling.KappaStratification.landauer_cost_is_h1
      (γ.thermalization.toBasinThermalization.nerveAt b)
  scottBridge :=
    AperiodicOrder.Tiling.KappaStratification.scott_face_is_vanishing_bridge
  zetaResidual :=
    AperiodicOrder.Tiling.KappaStratification.zeta_star_residual_interface

/-- A Collatz projection has been identified with a chosen carrier when the
carrier is accompanied by the two-adic cylinder-lift and one-lock inputs, hence
by the strict finite κ package.  The existence of this projection for the
material carrier is one remaining frontier obligation. -/
structure CollatzCarrierProjection (_carrierNerve : CoverNerve) where
  /-- The upstream positive-seed carrier through which the Collatz package is
  read.  This field keeps the projection as carried data, not just a proof
  conjunction. -/
  positiveSeedCarrier : Type
  /-- The carried seed type is the upstream Collatz positive-seed carrier. -/
  positiveSeedCarrier_eq : positiveSeedCarrier = PositiveSeed
  /-- The two-adic cylinder-lift input. -/
  cylinderLiftGap : AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap
  /-- The one-lock collapse input. -/
  oneLock : ParentBarrierOneLockCollapse
  /-- The resulting strict finite κ package. -/
  kappaPackage :
    ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed

/-- A Zeta-star projection has been identified with a chosen carrier when the
observed residual interface is explicitly assigned to that carrier. -/
structure ZetaStarCarrierProjection (_carrierNerve : CoverNerve) where
  /-- The observed Zeta-star residual interface at this carrier. -/
  residual : AperiodicOrder.Tiling.ZetaStarAnalyticRichnessRecovery

/-- The stronger shared-carrier obligation: the material carrier is present,
and Collatz and Zeta-star have been projected to that same carrier.  This is the
named boundary of the remaining gap. -/
structure FullSharedKappaCarrier {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) where
  /-- The inhabited material Landauer/`H¹` carrier. -/
  materialCarrier : MaterialSharedKappaCarrier γ b θ
  /-- The Collatz projection to the same carrier. -/
  collatzProjection : CollatzCarrierProjection materialCarrier.carrierNerve
  /-- The Zeta-star projection to the same carrier. -/
  zetaProjection : ZetaStarCarrierProjection materialCarrier.carrierNerve

/-- The Collatz projection supplied by the two-adic cylinder-lift and one-lock
frontier inputs. -/
def collatz_carrier_projection (carrierNerve : CoverNerve)
    (hlift : AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap)
    (hlock : ParentBarrierOneLockCollapse) :
    CollatzCarrierProjection carrierNerve where
  positiveSeedCarrier := PositiveSeed
  positiveSeedCarrier_eq := rfl
  cylinderLiftGap := hlift
  oneLock := hlock
  kappaPackage :=
    AperiodicOrder.Tiling.KappaStratification.collatz_cylinder_lift_kappa_package
      hlift hlock

/-- The currently inhabited Zeta-star residual projection can be assigned to a
chosen carrier. -/
def zeta_star_carrier_projection (carrierNerve : CoverNerve) :
    ZetaStarCarrierProjection carrierNerve where
  residual :=
    AperiodicOrder.Tiling.KappaStratification.zeta_star_residual_interface

/-- Under the Collatz frontier inputs, the full shared carrier is inhabited. -/
def full_shared_kappa_carrier_of_collatz_inputs {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hlift : AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap)
    (hlock : ParentBarrierOneLockCollapse) :
    FullSharedKappaCarrier γ b θ where
  materialCarrier := material_shared_kappa_carrier γ b θ
  collatzProjection :=
    collatz_carrier_projection
      (material_shared_kappa_carrier γ b θ).carrierNerve hlift hlock
  zetaProjection :=
    zeta_star_carrier_projection
      (material_shared_kappa_carrier γ b θ).carrierNerve

/-- The two-adic cylinder-lift side is already constructed from the proved
two-adic carry gap. -/
def twoAdic_cylinderLiftGap :
    AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap :=
  AperiodicOrder.Tiling.parentBarrierTwoAdicCylinderLiftGap_iff_carryGap.2
    AperiodicOrder.Tiling.parentBarrierTwoAdicCarryGap_holds

/-- For this tightened carrier notion, the full shared-carrier gap is exactly
the remaining Collatz pair of frontier inputs: the material carrier and the
Zeta-star residual projection are already inhabited. -/
theorem full_shared_kappa_carrier_iff_collatz_inputs {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap ∧
        ParentBarrierOneLockCollapse := by
  constructor
  · intro h
    rcases h with ⟨C⟩
    exact ⟨C.collatzProjection.cylinderLiftGap,
      C.collatzProjection.oneLock⟩
  · intro h
    exact ⟨full_shared_kappa_carrier_of_collatz_inputs γ b θ h.1 h.2⟩

/-- An explicit cylinder-lift witness plus no positive infinite barrier stream
constructs the exact full shared κ carrier without using the global cylinder-lift
frontier alias. -/
def full_shared_kappa_carrier_of_cylinderLiftGap_and_noPositiveInfiniteBarrierStream
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hlift : AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap)
    (hstream : NoPositiveInfiniteBarrierStream) :
    FullSharedKappaCarrier γ b θ :=
  full_shared_kappa_carrier_of_collatz_inputs γ b θ hlift
    ((AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_noStream).mpr
      (fun _ => hstream))

/-- The exact full shared-carrier boundary can be read without the global
`twoAdic_cylinderLiftGap` alias: it is precisely an explicit cylinder-lift
witness together with no positive infinite barrier stream. -/
theorem full_shared_kappa_carrier_iff_cylinderLiftGap_and_noPositiveInfiniteBarrierStream
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap ∧
        NoPositiveInfiniteBarrierStream := by
  constructor
  · intro h
    rcases h with ⟨C⟩
    refine ⟨C.collatzProjection.cylinderLiftGap, ?_⟩
    exact
      (AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_noStream.mp
        C.collatzProjection.oneLock) C.collatzProjection.cylinderLiftGap
  · intro h
    exact
      ⟨full_shared_kappa_carrier_of_cylinderLiftGap_and_noPositiveInfiniteBarrierStream
        γ b θ h.1 h.2⟩

/-- An explicit cylinder-lift witness plus eventual contraction constructs the
exact full shared κ carrier without using the global cylinder-lift frontier
alias. -/
def full_shared_kappa_carrier_of_cylinderLiftGap_and_everyNonterminalContracts
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hlift : AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap)
    (hcontracts : EveryNonterminalContracts) :
    FullSharedKappaCarrier γ b θ :=
  full_shared_kappa_carrier_of_collatz_inputs γ b θ hlift
    ((AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_everyNonterminalContracts).mpr
      (fun _ => hcontracts))

/-- The exact full shared-carrier boundary can equivalently be read as an
explicit cylinder-lift witness together with eventual contraction of every
nonterminal seed. -/
theorem full_shared_kappa_carrier_iff_cylinderLiftGap_and_everyNonterminalContracts
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap ∧
        EveryNonterminalContracts := by
  constructor
  · intro h
    rcases h with ⟨C⟩
    refine ⟨C.collatzProjection.cylinderLiftGap, ?_⟩
    exact
      (AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_everyNonterminalContracts.mp
        C.collatzProjection.oneLock) C.collatzProjection.cylinderLiftGap
  · intro h
    exact
      ⟨full_shared_kappa_carrier_of_cylinderLiftGap_and_everyNonterminalContracts
        γ b θ h.1 h.2⟩

/-- A D4 `confSwap` bad-edge repair closure plus no positive infinite barrier
stream constructs the exact full shared κ carrier. -/
def full_shared_kappa_carrier_of_d4ConfSwap_and_noPositiveInfiniteBarrierStream
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (u : Utterance)
    (hclosed : AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u)
    (hstream : NoPositiveInfiniteBarrierStream) :
    FullSharedKappaCarrier γ b θ :=
  full_shared_kappa_carrier_of_cylinderLiftGap_and_noPositiveInfiniteBarrierStream
    γ b θ
    (AperiodicOrder.Tiling.parentBarrierTwoAdicCylinderLiftGap_of_d4ConfSwapClosesBadFirstPassageBoundary
      u hclosed)
    hstream

/-- The exact full shared-carrier boundary can be read through the D4 `confSwap`
repair face plus absence of positive infinite barrier streams. -/
theorem full_shared_kappa_carrier_iff_d4ConfSwap_and_noPositiveInfiniteBarrierStream
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u ∧
        NoPositiveInfiniteBarrierStream := by
  constructor
  · intro h
    rcases h with ⟨C⟩
    have hgap : ParentBarrierGap :=
      AperiodicOrder.Tiling.parentBarrierGap_iff_parentBarrierTwoAdicCylinderLiftGap.mpr
        C.collatzProjection.cylinderLiftGap
    refine
      ⟨(AperiodicOrder.Tiling.parentBarrierGap_iff_d4ConfSwapClosesBadFirstPassageBoundary
          u).mp hgap, ?_⟩
    exact
      (AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_noStream.mp
        C.collatzProjection.oneLock) C.collatzProjection.cylinderLiftGap
  · intro h
    exact
      ⟨full_shared_kappa_carrier_of_d4ConfSwap_and_noPositiveInfiniteBarrierStream
        γ b θ u h.1 h.2⟩

/-- A D4 `confSwap` bad-edge repair closure plus eventual contraction constructs
the exact full shared κ carrier. -/
def full_shared_kappa_carrier_of_d4ConfSwap_and_everyNonterminalContracts
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (u : Utterance)
    (hclosed : AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u)
    (hcontracts : EveryNonterminalContracts) :
    FullSharedKappaCarrier γ b θ :=
  full_shared_kappa_carrier_of_cylinderLiftGap_and_everyNonterminalContracts
    γ b θ
    (AperiodicOrder.Tiling.parentBarrierTwoAdicCylinderLiftGap_of_d4ConfSwapClosesBadFirstPassageBoundary
      u hclosed)
    hcontracts

/-- The exact full shared-carrier boundary can be read through the D4 `confSwap`
repair face plus eventual contraction of every nonterminal seed. -/
theorem full_shared_kappa_carrier_iff_d4ConfSwap_and_everyNonterminalContracts
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u ∧
        EveryNonterminalContracts := by
  constructor
  · intro h
    rcases h with ⟨C⟩
    have hgap : ParentBarrierGap :=
      AperiodicOrder.Tiling.parentBarrierGap_iff_parentBarrierTwoAdicCylinderLiftGap.mpr
        C.collatzProjection.cylinderLiftGap
    refine
      ⟨(AperiodicOrder.Tiling.parentBarrierGap_iff_d4ConfSwapClosesBadFirstPassageBoundary
          u).mp hgap, ?_⟩
    exact
      (AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_everyNonterminalContracts.mp
        C.collatzProjection.oneLock) C.collatzProjection.cylinderLiftGap
  · intro h
    exact
      ⟨full_shared_kappa_carrier_of_d4ConfSwap_and_everyNonterminalContracts
        γ b θ u h.1 h.2⟩

/-- Since the cylinder-lift input is already constructed, the full
shared-carrier gap is exactly one-lock. -/
theorem full_shared_kappa_carrier_iff_oneLock {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      ParentBarrierOneLockCollapse := by
  constructor
  · intro h
    exact (full_shared_kappa_carrier_iff_collatz_inputs γ b θ).1 h |>.2
  · intro hlock
    exact
      ⟨full_shared_kappa_carrier_of_collatz_inputs γ b θ
        twoAdic_cylinderLiftGap hlock⟩

/-- One-lock is the no-positive-infinite-stream condition once the constructed
cylinder-lift side is available. -/
theorem oneLock_iff_noPositiveInfiniteBarrierStream :
    ParentBarrierOneLockCollapse ↔ NoPositiveInfiniteBarrierStream := by
  constructor
  · intro hlock
    exact
      (AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_noStream.1
        hlock) twoAdic_cylinderLiftGap
  · intro hbar
    exact
      AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_noStream.2
        (fun _ => hbar)

/-- The full shared-carrier gap is exactly no positive infinite barrier stream. -/
theorem full_shared_kappa_carrier_iff_noPositiveInfiniteBarrierStream
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      NoPositiveInfiniteBarrierStream :=
  (full_shared_kappa_carrier_iff_oneLock γ b θ).trans
    oneLock_iff_noPositiveInfiniteBarrierStream

/-- A full shared κ carrier exposes the Collatz terminal/closure-ordinal/
total-stopping package carried by its Collatz projection. -/
theorem kappaPackage_of_fullSharedKappaCarrier {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ) :
    ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed :=
  C.collatzProjection.kappaPackage

/-- An inhabited full shared κ carrier exposes the Collatz terminal/
closure-ordinal/total-stopping package. -/
theorem kappaPackage_of_nonempty_fullSharedKappaCarrier {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (h : Nonempty (FullSharedKappaCarrier γ b θ)) :
    ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed := by
  rcases h with ⟨C⟩
  exact kappaPackage_of_fullSharedKappaCarrier C

/-- The anti-matter ledger view of the remaining barrier boundary.  It keeps
the local material matter/anti-matter index carrier in the same package as the
exact Collatz obligation that remains after the two-adic cylinder-lift side has
been constructed: cylinder-lift must force eventual coefficient contraction. -/
structure AntimatterBarrierBoundary {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) where
  /-- The local material matter/anti-matter carrier. -/
  materialCarrier : MaterialSharedKappaCarrier γ b θ
  /-- The signed anti-matter-minus-matter ledger on that carrier. -/
  carrierMatterAntimatterLedger :
    (AntiLandauer.antimatterCharge materialCarrier.carrierNerve : Int) -
      (AntiLandauer.matterCharge materialCarrier.carrierNerve : Int) =
        γ.thermalization.toBasinThermalization.ledgerAt b
  /-- The remaining dynamical obligation: the two-adic cylinder-lift face
  rules out infinite coefficient barriers by forcing eventual contraction. -/
  cylinderLiftContracts :
    AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
      EveryNonterminalContracts

/-- A material carrier plus a proof that cylinder-lift forces eventual
coefficient contraction gives the anti-matter barrier-boundary package. -/
def antimatter_barrier_boundary_of_cylinderLiftContracts {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hcontracts :
      AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
        EveryNonterminalContracts) :
    AntimatterBarrierBoundary γ b θ where
  materialCarrier := material_shared_kappa_carrier γ b θ
  carrierMatterAntimatterLedger :=
    (material_shared_kappa_carrier γ b θ).carrierMatterAntimatterLedger
  cylinderLiftContracts := hcontracts

/-- The anti-matter boundary is exactly the cylinder-lift-implies-contraction
form of the one-lock frontier.  This is the non-vacuous adapter boundary: the
ledger side is already inhabited, so the remaining content is the Collatz
contraction implication. -/
theorem antimatter_barrier_boundary_iff_cylinderLiftContracts
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    Nonempty (AntimatterBarrierBoundary γ b θ) ↔
      (AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
        EveryNonterminalContracts) := by
  constructor
  · intro h
    rcases h with ⟨B⟩
    exact B.cylinderLiftContracts
  · intro hcontracts
    exact ⟨antimatter_barrier_boundary_of_cylinderLiftContracts γ b θ hcontracts⟩

/-- The anti-matter boundary is exactly the one-lock half of the Collatz
frontier. -/
theorem antimatter_barrier_boundary_iff_parentBarrierOneLockCollapse
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    Nonempty (AntimatterBarrierBoundary γ b θ) ↔ ParentBarrierOneLockCollapse := by
  rw [antimatter_barrier_boundary_iff_cylinderLiftContracts]
  exact
    (AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_everyNonterminalContracts).symm

/-- An inhabited anti-matter boundary plus bad-edge K4 closure gives the Collatz frontier package. -/
theorem frontierInputs_of_antimatterBoundary_and_k4NegClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hclosed : AperiodicOrder.Tiling.K4NegClosesBadFirstPassageBoundary u) :
    CollatzFrontierInputs :=
  AperiodicOrder.Tiling.frontierInputs_of_k4NegClosesBadFirstPassageBoundary_and_cylinderLiftContracts
    u hclosed ((antimatter_barrier_boundary_iff_cylinderLiftContracts γ b θ).mp hanti)

/-- An inhabited anti-matter boundary plus bad-edge D4 `negSwap` closure gives
the Collatz frontier package. -/
theorem frontierInputs_of_antimatterBoundary_and_d4NegSwapClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hclosed : AperiodicOrder.Tiling.D4NegSwapClosesBadFirstPassageBoundary u) :
    CollatzFrontierInputs :=
  AperiodicOrder.Tiling.frontierInputs_of_d4NegSwapClosesBadFirstPassageBoundary_and_cylinderLiftContracts
    u hclosed ((antimatter_barrier_boundary_iff_cylinderLiftContracts γ b θ).mp hanti)

/-- An inhabited anti-matter boundary plus bad-edge D4 `confSwap` repair
closure gives the Collatz frontier package. -/
theorem frontierInputs_of_antimatterBoundary_and_d4ConfSwapClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hclosed : AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u) :
    CollatzFrontierInputs :=
  AperiodicOrder.Tiling.frontierInputs_of_d4ConfSwapClosesBadFirstPassageBoundary_and_cylinderLiftContracts
    u hclosed ((antimatter_barrier_boundary_iff_cylinderLiftContracts γ b θ).mp hanti)

/-- An inhabited anti-matter boundary plus bad-edge K4 closure implies
accelerated Collatz termination. -/
theorem collatz_from_antimatterBoundary_and_k4NegClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hclosed : AperiodicOrder.Tiling.K4NegClosesBadFirstPassageBoundary u) :
    ∀ seed : PositiveSeed, ReachesTerminal seed.value := by
  intro seed
  exact
    AperiodicOrder.Tiling.collatz_from_k4NegClosesBadFirstPassageBoundary_and_cylinderLiftContracts
      u hclosed ((antimatter_barrier_boundary_iff_cylinderLiftContracts γ b θ).mp hanti)
      seed.value seed.positive

/-- An inhabited anti-matter boundary plus bad-edge D4 `negSwap` closure implies
accelerated Collatz termination. -/
theorem collatz_from_antimatterBoundary_and_d4NegSwapClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hclosed : AperiodicOrder.Tiling.D4NegSwapClosesBadFirstPassageBoundary u) :
    ∀ seed : PositiveSeed, ReachesTerminal seed.value := by
  intro seed
  exact
    AperiodicOrder.Tiling.collatz_from_d4NegSwapClosesBadFirstPassageBoundary_and_cylinderLiftContracts
      u hclosed ((antimatter_barrier_boundary_iff_cylinderLiftContracts γ b θ).mp hanti)
      seed.value seed.positive

/-- An inhabited anti-matter boundary plus bad-edge D4 `confSwap` repair
closure implies accelerated Collatz termination. -/
theorem collatz_from_antimatterBoundary_and_d4ConfSwapClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hclosed : AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u) :
    ∀ seed : PositiveSeed, ReachesTerminal seed.value := by
  intro seed
  exact
    AperiodicOrder.Tiling.collatz_from_d4ConfSwapClosesBadFirstPassageBoundary_and_cylinderLiftContracts
      u hclosed ((antimatter_barrier_boundary_iff_cylinderLiftContracts γ b θ).mp hanti)
      seed.value seed.positive

/-- An inhabited anti-matter boundary plus bad-edge K4 closure gives the full
terminal/closure-ordinal/total-stopping package. -/
theorem kappaPackage_of_antimatterBoundary_and_k4NegClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hclosed : AperiodicOrder.Tiling.K4NegClosesBadFirstPassageBoundary u) :
    ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed := by
  intro seed
  exact
    AperiodicOrder.Tiling.kappaPackage_of_twoAdicCylinderLiftGap_and_oneLock
      (AperiodicOrder.Tiling.parentBarrierTwoAdicCylinderLiftGap_of_k4NegClosesBadFirstPassageBoundary
        u hclosed)
      ((antimatter_barrier_boundary_iff_parentBarrierOneLockCollapse γ b θ).mp
        hanti)
      seed.value seed.positive

/-- An inhabited anti-matter boundary plus bad-edge D4 `negSwap` closure gives
the full terminal/closure-ordinal/total-stopping package. -/
theorem kappaPackage_of_antimatterBoundary_and_d4NegSwapClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hclosed : AperiodicOrder.Tiling.D4NegSwapClosesBadFirstPassageBoundary u) :
    ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed := by
  intro seed
  exact
    AperiodicOrder.Tiling.kappaPackage_of_twoAdicCylinderLiftGap_and_oneLock
      (AperiodicOrder.Tiling.parentBarrierTwoAdicCylinderLiftGap_of_d4NegSwapClosesBadFirstPassageBoundary
        u hclosed)
      ((antimatter_barrier_boundary_iff_parentBarrierOneLockCollapse γ b θ).mp
        hanti)
      seed.value seed.positive

/-- An inhabited anti-matter boundary plus bad-edge D4 `confSwap` repair
closure gives the full terminal/closure-ordinal/total-stopping package. -/
theorem kappaPackage_of_antimatterBoundary_and_d4ConfSwapClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hclosed : AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u) :
    ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed := by
  intro seed
  exact
    AperiodicOrder.Tiling.kappaPackage_of_twoAdicCylinderLiftGap_and_oneLock
      (AperiodicOrder.Tiling.parentBarrierTwoAdicCylinderLiftGap_of_d4ConfSwapClosesBadFirstPassageBoundary
        u hclosed)
      ((antimatter_barrier_boundary_iff_parentBarrierOneLockCollapse γ b θ).mp
        hanti)
      seed.value seed.positive

/-- The Collatz frontier package is exactly the anti-matter boundary together
with bad-edge K4 closure. -/
theorem frontierInputs_iff_antimatterBoundary_and_k4NegClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance) :
    CollatzFrontierInputs ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) ∧
        AperiodicOrder.Tiling.K4NegClosesBadFirstPassageBoundary u := by
  constructor
  · intro hfront
    have hcontracts :
        AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
          EveryNonterminalContracts := by
      intro _hlift
      exact everyNonterminalContracts_iff_noPositiveInfiniteBarrierStream.mpr
        hfront.noPositiveInfiniteBarrierStream
    have hgap : ParentBarrierGap :=
      parentBarrierResidueGap_implies_parentBarrierGap hfront.residueGap
    exact
      ⟨⟨antimatter_barrier_boundary_of_cylinderLiftContracts γ b θ hcontracts⟩,
        (AperiodicOrder.Tiling.parentBarrierGap_iff_k4NegClosesBadFirstPassageBoundary u).mp
          hgap⟩
  · rintro ⟨hanti, hclosed⟩
    exact frontierInputs_of_antimatterBoundary_and_k4NegClosesBadFirstPassageBoundary
      γ b θ u hanti hclosed

/-- The Collatz frontier package is exactly the anti-matter boundary together
with bad-edge D4 `negSwap` closure. -/
theorem frontierInputs_iff_antimatterBoundary_and_d4NegSwapClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance) :
    CollatzFrontierInputs ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) ∧
        AperiodicOrder.Tiling.D4NegSwapClosesBadFirstPassageBoundary u := by
  constructor
  · intro hfront
    have hcontracts :
        AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
          EveryNonterminalContracts := by
      intro _hlift
      exact everyNonterminalContracts_iff_noPositiveInfiniteBarrierStream.mpr
        hfront.noPositiveInfiniteBarrierStream
    have hgap : ParentBarrierGap :=
      parentBarrierResidueGap_implies_parentBarrierGap hfront.residueGap
    exact
      ⟨⟨antimatter_barrier_boundary_of_cylinderLiftContracts γ b θ hcontracts⟩,
        (AperiodicOrder.Tiling.parentBarrierGap_iff_d4NegSwapClosesBadFirstPassageBoundary u).mp
          hgap⟩
  · rintro ⟨hanti, hclosed⟩
    exact frontierInputs_of_antimatterBoundary_and_d4NegSwapClosesBadFirstPassageBoundary
      γ b θ u hanti hclosed

/-- The Collatz frontier package is exactly the anti-matter boundary together
with bad-edge D4 `confSwap` repair closure. -/
theorem frontierInputs_iff_antimatterBoundary_and_d4ConfSwapClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance) :
    CollatzFrontierInputs ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) ∧
        AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u := by
  constructor
  · intro hfront
    have hcontracts :
        AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
          EveryNonterminalContracts := by
      intro _hlift
      exact everyNonterminalContracts_iff_noPositiveInfiniteBarrierStream.mpr
        hfront.noPositiveInfiniteBarrierStream
    have hgap : ParentBarrierGap :=
      parentBarrierResidueGap_implies_parentBarrierGap hfront.residueGap
    exact
      ⟨⟨antimatter_barrier_boundary_of_cylinderLiftContracts γ b θ hcontracts⟩,
        (AperiodicOrder.Tiling.parentBarrierGap_iff_d4ConfSwapClosesBadFirstPassageBoundary u).mp
          hgap⟩
  · rintro ⟨hanti, hclosed⟩
    exact frontierInputs_of_antimatterBoundary_and_d4ConfSwapClosesBadFirstPassageBoundary
      γ b θ u hanti hclosed

/-- The Collatz frontier package is exactly the anti-matter boundary together
with absence of ungrounded claim-side firing. -/
theorem frontierInputs_iff_antimatterBoundary_and_noUngroundedClaimSideFiringAtParentBarrier
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    CollatzFrontierInputs ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) ∧
        AperiodicOrder.Tiling.NoUngroundedClaimSideFiringAtParentBarrier := by
  constructor
  · intro hfront
    have hp := frontierInputs_iff_parentBarrierGap_and_oneLock.mp hfront
    exact
      ⟨(antimatter_barrier_boundary_iff_parentBarrierOneLockCollapse γ b θ).mpr hp.2,
        AperiodicOrder.Tiling.parentBarrierGap_iff_noUngroundedClaimSideFiringAtParentBarrier.mp
          hp.1⟩
  · rintro ⟨hanti, hno⟩
    exact frontierInputs_iff_parentBarrierGap_and_oneLock.mpr
      ⟨AperiodicOrder.Tiling.parentBarrierGap_iff_noUngroundedClaimSideFiringAtParentBarrier.mpr
          hno,
        (antimatter_barrier_boundary_iff_parentBarrierOneLockCollapse γ b θ).mp hanti⟩

/-- An inhabited anti-matter boundary plus absence of ungrounded claim-side
firing gives the Collatz frontier package. -/
theorem frontierInputs_of_antimatterBoundary_and_noUngroundedClaimSideFiringAtParentBarrier
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hno : AperiodicOrder.Tiling.NoUngroundedClaimSideFiringAtParentBarrier) :
    CollatzFrontierInputs :=
  (frontierInputs_iff_antimatterBoundary_and_noUngroundedClaimSideFiringAtParentBarrier
    γ b θ).mpr ⟨hanti, hno⟩

/-- An inhabited anti-matter boundary plus absence of ungrounded claim-side
firing implies accelerated Collatz termination. -/
theorem collatz_from_antimatterBoundary_and_noUngroundedClaimSideFiringAtParentBarrier
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hno : AperiodicOrder.Tiling.NoUngroundedClaimSideFiringAtParentBarrier) :
    ∀ seed : PositiveSeed, ReachesTerminal seed.value := by
  intro seed
  exact collatz_from_frontierInputs
    (frontierInputs_of_antimatterBoundary_and_noUngroundedClaimSideFiringAtParentBarrier
      γ b θ hanti hno)
    seed.value seed.positive

/-- An inhabited anti-matter boundary plus absence of ungrounded claim-side
firing gives the full terminal/closure-ordinal/total-stopping package. -/
theorem kappaPackage_of_antimatterBoundary_and_noUngroundedClaimSideFiringAtParentBarrier
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hno : AperiodicOrder.Tiling.NoUngroundedClaimSideFiringAtParentBarrier) :
    ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed := by
  intro seed
  exact
    AperiodicOrder.Tiling.kappaPackage_of_twoAdicCylinderLiftGap_and_oneLock
      (AperiodicOrder.Tiling.parentBarrierResidueGap_iff_parentBarrierTwoAdicCylinderLiftGap.mp
        ((AperiodicOrder.Tiling.noUngroundedClaimSideFiringAtParentBarrier_iff_parentBarrierResidueGap).mp
          hno))
      ((antimatter_barrier_boundary_iff_parentBarrierOneLockCollapse γ b θ).mp
        hanti)
      seed.value seed.positive

/-- The Collatz frontier package is exactly the anti-matter boundary together
with the sharp parent-barrier residue inequality. -/
theorem frontierInputs_iff_antimatterBoundary_and_parentBarrierResidueGap
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    CollatzFrontierInputs ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) ∧ ParentBarrierResidueGap := by
  constructor
  · intro hfront
    have hsplit :=
      (frontierInputs_iff_antimatterBoundary_and_noUngroundedClaimSideFiringAtParentBarrier
        γ b θ).mp hfront
    exact
      ⟨hsplit.1,
        (AperiodicOrder.Tiling.noUngroundedClaimSideFiringAtParentBarrier_iff_parentBarrierResidueGap).mp
          hsplit.2⟩
  · rintro ⟨hanti, hres⟩
    exact
      (frontierInputs_iff_antimatterBoundary_and_noUngroundedClaimSideFiringAtParentBarrier
        γ b θ).mpr
        ⟨hanti,
          (AperiodicOrder.Tiling.noUngroundedClaimSideFiringAtParentBarrier_iff_parentBarrierResidueGap).mpr
            hres⟩

/-- An inhabited anti-matter boundary plus the sharp residue gap implies
accelerated Collatz termination. -/
theorem collatz_from_antimatterBoundary_and_parentBarrierResidueGap
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hres : ParentBarrierResidueGap) :
    ∀ seed : PositiveSeed, ReachesTerminal seed.value := by
  intro seed
  exact collatz_from_frontierInputs
    ((frontierInputs_iff_antimatterBoundary_and_parentBarrierResidueGap
      γ b θ).mpr ⟨hanti, hres⟩)
    seed.value seed.positive

/-- An inhabited anti-matter boundary plus the sharp residue gap gives the full
terminal/closure-ordinal/total-stopping package. -/
theorem kappaPackage_of_antimatterBoundary_and_parentBarrierResidueGap
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hres : ParentBarrierResidueGap) :
    ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed := by
  intro seed
  exact
    AperiodicOrder.Tiling.kappaPackage_of_twoAdicCylinderLiftGap_and_oneLock
      (AperiodicOrder.Tiling.parentBarrierResidueGap_iff_parentBarrierTwoAdicCylinderLiftGap.mp
        hres)
      ((antimatter_barrier_boundary_iff_parentBarrierOneLockCollapse γ b θ).mp
        hanti)
      seed.value seed.positive

/-- The Collatz frontier package is exactly the anti-matter boundary together
with emptiness of the bad first-passage backward-seed language. -/
theorem frontierInputs_iff_antimatterBoundary_and_noBadFirstPassageBackwardSeed
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    CollatzFrontierInputs ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) ∧
        NoBadFirstPassageBackwardSeed := by
  constructor
  · intro hfront
    have hsplit :=
      (frontierInputs_iff_antimatterBoundary_and_parentBarrierResidueGap
        γ b θ).mp hfront
    have htwo :
        AperiodicOrder.Tiling.ParentBarrierTwoAdicCarryGap :=
      AperiodicOrder.Tiling.parentBarrierResidueGap_iff_parentBarrierTwoAdicCarryGap.mp
        hsplit.2
    exact
      ⟨hsplit.1,
        AperiodicOrder.Tiling.parentBarrierTwoAdicCarryGap_iff_no_badBackwardSeed.mp
          htwo⟩
  · rintro ⟨hanti, hnoBad⟩
    have htwo :
        AperiodicOrder.Tiling.ParentBarrierTwoAdicCarryGap :=
      AperiodicOrder.Tiling.parentBarrierTwoAdicCarryGap_iff_no_badBackwardSeed.mpr
        hnoBad
    have hres : ParentBarrierResidueGap :=
      AperiodicOrder.Tiling.parentBarrierResidueGap_iff_parentBarrierTwoAdicCarryGap.mpr
        htwo
    exact
      (frontierInputs_iff_antimatterBoundary_and_parentBarrierResidueGap
        γ b θ).mpr ⟨hanti, hres⟩

/-- An inhabited anti-matter boundary plus emptiness of bad first-passage
backward seeds implies accelerated Collatz termination. -/
theorem collatz_from_antimatterBoundary_and_noBadFirstPassageBackwardSeed
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hnoBad : NoBadFirstPassageBackwardSeed) :
    ∀ seed : PositiveSeed, ReachesTerminal seed.value := by
  intro seed
  exact collatz_from_frontierInputs
    ((frontierInputs_iff_antimatterBoundary_and_noBadFirstPassageBackwardSeed
      γ b θ).mpr ⟨hanti, hnoBad⟩)
    seed.value seed.positive

/-- An inhabited anti-matter boundary plus emptiness of bad first-passage
backward seeds gives the full terminal/closure-ordinal/total-stopping package. -/
theorem kappaPackage_of_antimatterBoundary_and_noBadFirstPassageBackwardSeed
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hnoBad : NoBadFirstPassageBackwardSeed) :
    ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed := by
  intro seed
  have htwo :
      AperiodicOrder.Tiling.ParentBarrierTwoAdicCarryGap :=
    AperiodicOrder.Tiling.parentBarrierTwoAdicCarryGap_iff_no_badBackwardSeed.mpr
      hnoBad
  exact
    AperiodicOrder.Tiling.kappaPackage_of_twoAdicCarryGap_and_oneLock htwo
      ((antimatter_barrier_boundary_iff_parentBarrierOneLockCollapse γ b θ).mp
        hanti)
      seed.value seed.positive

/-- The Collatz frontier package is exactly the anti-matter boundary together
with token-grounded first-passage backward seed cells. -/
theorem frontierInputs_iff_antimatterBoundary_and_tokenGroundedFirstPassageBackwardSeeds
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance) :
    CollatzFrontierInputs ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) ∧
        AperiodicOrder.Tiling.TokenGroundedFirstPassageBackwardSeeds u := by
  constructor
  · intro hfront
    have hsplit :=
      (frontierInputs_iff_antimatterBoundary_and_noBadFirstPassageBackwardSeed
        γ b θ).mp hfront
    exact
      ⟨hsplit.1,
        (AperiodicOrder.Tiling.noBadFirstPassageBackwardSeed_iff_tokenGroundedFirstPassageBackwardSeeds
          u).mp hsplit.2⟩
  · rintro ⟨hanti, hgrounded⟩
    have hnoBad : NoBadFirstPassageBackwardSeed :=
      (AperiodicOrder.Tiling.noBadFirstPassageBackwardSeed_iff_tokenGroundedFirstPassageBackwardSeeds
        u).mpr hgrounded
    exact
      (frontierInputs_iff_antimatterBoundary_and_noBadFirstPassageBackwardSeed
        γ b θ).mpr ⟨hanti, hnoBad⟩

/-- An inhabited anti-matter boundary plus token-grounded first-passage
backward seed cells implies accelerated Collatz termination. -/
theorem collatz_from_antimatterBoundary_and_tokenGroundedFirstPassageBackwardSeeds
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hgrounded :
      AperiodicOrder.Tiling.TokenGroundedFirstPassageBackwardSeeds u) :
    ∀ seed : PositiveSeed, ReachesTerminal seed.value := by
  intro seed
  exact collatz_from_frontierInputs
    ((frontierInputs_iff_antimatterBoundary_and_tokenGroundedFirstPassageBackwardSeeds
      γ b θ u).mpr ⟨hanti, hgrounded⟩)
    seed.value seed.positive

/-- An inhabited anti-matter boundary plus token-grounded first-passage
backward seed cells gives the full terminal/closure-ordinal/total-stopping
package. -/
theorem kappaPackage_of_antimatterBoundary_and_tokenGroundedFirstPassageBackwardSeeds
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hgrounded :
      AperiodicOrder.Tiling.TokenGroundedFirstPassageBackwardSeeds u) :
    ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed :=
  kappaPackage_of_antimatterBoundary_and_noBadFirstPassageBackwardSeed
    γ b θ hanti
    ((AperiodicOrder.Tiling.noBadFirstPassageBackwardSeed_iff_tokenGroundedFirstPassageBackwardSeeds
      u).mpr hgrounded)

/-- The Collatz frontier package is exactly the anti-matter boundary together
with positivity of the first-passage backward carry quotient face. -/
theorem frontierInputs_iff_antimatterBoundary_and_parentBarrierTwoAdicCarryQuotientPositive
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    CollatzFrontierInputs ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) ∧
        AperiodicOrder.Tiling.ParentBarrierTwoAdicCarryQuotientPositive := by
  constructor
  · intro hfront
    have hsplit :=
      (frontierInputs_iff_antimatterBoundary_and_parentBarrierResidueGap
        γ b θ).mp hfront
    exact
      ⟨hsplit.1,
        (AperiodicOrder.Tiling.parentBarrierResidueGap_iff_parentBarrierTwoAdicCarryQuotientPositive).mp
          hsplit.2⟩
  · rintro ⟨hanti, hquot⟩
    exact
      (frontierInputs_iff_antimatterBoundary_and_parentBarrierResidueGap
        γ b θ).mpr
        ⟨hanti,
          (AperiodicOrder.Tiling.parentBarrierResidueGap_iff_parentBarrierTwoAdicCarryQuotientPositive).mpr
            hquot⟩

/-- An inhabited anti-matter boundary plus the positive carry-quotient face
implies accelerated Collatz termination. -/
theorem collatz_from_antimatterBoundary_and_parentBarrierTwoAdicCarryQuotientPositive
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hquot : AperiodicOrder.Tiling.ParentBarrierTwoAdicCarryQuotientPositive) :
    ∀ seed : PositiveSeed, ReachesTerminal seed.value := by
  intro seed
  exact collatz_from_frontierInputs
    ((frontierInputs_iff_antimatterBoundary_and_parentBarrierTwoAdicCarryQuotientPositive
      γ b θ).mpr ⟨hanti, hquot⟩)
    seed.value seed.positive

/-- An inhabited anti-matter boundary plus the positive carry-quotient face
gives the full terminal/closure-ordinal/total-stopping package. -/
theorem kappaPackage_of_antimatterBoundary_and_parentBarrierTwoAdicCarryQuotientPositive
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat)
    (hanti : Nonempty (AntimatterBarrierBoundary γ b θ))
    (hquot : AperiodicOrder.Tiling.ParentBarrierTwoAdicCarryQuotientPositive) :
    ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed := by
  intro seed
  exact
    AperiodicOrder.Tiling.kappaPackage_of_twoAdicCylinderLiftGap_and_oneLock
      (AperiodicOrder.Tiling.parentBarrierTwoAdicCylinderLiftGap_iff_carryQuotientPositive.mpr
        hquot)
      ((antimatter_barrier_boundary_iff_parentBarrierOneLockCollapse γ b θ).mp
        hanti)
      seed.value seed.positive

/-- The full shared carrier is equivalently the anti-matter barrier boundary:
the material matter/anti-matter ledger is already proved, while the remaining
Collatz component is cylinder-lift forcing eventual coefficient contraction. -/
theorem full_shared_kappa_carrier_iff_antimatter_barrier_boundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) := by
  constructor
  · intro h
    rcases h with ⟨C⟩
    have hlock : ParentBarrierOneLockCollapse :=
      (full_shared_kappa_carrier_iff_oneLock γ b θ).1 ⟨C⟩
    have hcontracts :
        AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
          EveryNonterminalContracts :=
      (AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_everyNonterminalContracts.1
        hlock)
    exact
      ⟨{ materialCarrier := C.materialCarrier
         carrierMatterAntimatterLedger :=
          C.materialCarrier.carrierMatterAntimatterLedger
         cylinderLiftContracts := hcontracts }⟩
  · intro h
    have hcontracts :
        AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
          EveryNonterminalContracts :=
      (antimatter_barrier_boundary_iff_cylinderLiftContracts γ b θ).1 h
    have hlock : ParentBarrierOneLockCollapse :=
      (AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_everyNonterminalContracts.2
        hcontracts)
    exact (full_shared_kappa_carrier_iff_oneLock γ b θ).2 hlock

/-- Equivalently, the full shared-carrier gap is exactly the current Collatz
frontier-input package. -/
theorem full_shared_kappa_carrier_iff_frontierInputs {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      CollatzFrontierInputs := by
  constructor
  · intro h
    have hlock : ParentBarrierOneLockCollapse :=
      (full_shared_kappa_carrier_iff_oneLock γ b θ).1 h
    exact
      AperiodicOrder.Tiling.frontierInputs_iff_twoAdicCylinderLiftGap_and_oneLock.2
        ⟨twoAdic_cylinderLiftGap, hlock⟩
  · intro hfront
    have hp :=
      AperiodicOrder.Tiling.frontierInputs_iff_twoAdicCylinderLiftGap_and_oneLock.1
        hfront
    exact (full_shared_kappa_carrier_iff_collatz_inputs γ b θ).2 hp

/-- Equivalently, the full shared-carrier gap is the anti-matter boundary
together with emptiness of the bad first-passage backward-seed language. -/
theorem full_shared_kappa_carrier_iff_antimatterBoundary_and_noBadFirstPassageBackwardSeed
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) ∧
        NoBadFirstPassageBackwardSeed := by
  constructor
  · intro h
    rcases h with ⟨C⟩
    have hcontracts :
        AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
          EveryNonterminalContracts :=
      (AperiodicOrder.Tiling.parentBarrierOneLockCollapse_iff_twoAdicCylinderLiftGap_implies_everyNonterminalContracts.1
        C.collatzProjection.oneLock)
    have hanti : Nonempty (AntimatterBarrierBoundary γ b θ) :=
      ⟨{ materialCarrier := C.materialCarrier
         carrierMatterAntimatterLedger :=
          C.materialCarrier.carrierMatterAntimatterLedger
         cylinderLiftContracts := hcontracts }⟩
    have hnoBad :
        NoBadFirstPassageBackwardSeed :=
      AperiodicOrder.Tiling.parentBarrierTwoAdicCylinderLiftGap_iff_no_badBackwardSeed.mp
        C.collatzProjection.cylinderLiftGap
    exact ⟨hanti, hnoBad⟩
  · rintro ⟨hanti, hnoBad⟩
    have hlift : AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap :=
      AperiodicOrder.Tiling.parentBarrierTwoAdicCylinderLiftGap_iff_no_badBackwardSeed.mpr
        hnoBad
    have hlock : ParentBarrierOneLockCollapse :=
      (antimatter_barrier_boundary_iff_parentBarrierOneLockCollapse γ b θ).mp hanti
    exact ⟨full_shared_kappa_carrier_of_collatz_inputs γ b θ hlift hlock⟩

/-- Equivalently, the full shared-carrier gap is the anti-matter boundary
together with token-grounded first-passage backward seed cells. -/
theorem full_shared_kappa_carrier_iff_antimatterBoundary_and_tokenGroundedFirstPassageBackwardSeeds
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) ∧
        AperiodicOrder.Tiling.TokenGroundedFirstPassageBackwardSeeds u := by
  constructor
  · intro hcarrier
    have hsplit :=
      (full_shared_kappa_carrier_iff_antimatterBoundary_and_noBadFirstPassageBackwardSeed
        γ b θ).mp hcarrier
    exact
      ⟨hsplit.1,
        (AperiodicOrder.Tiling.noBadFirstPassageBackwardSeed_iff_tokenGroundedFirstPassageBackwardSeeds
          u).mp hsplit.2⟩
  · rintro ⟨hanti, hgrounded⟩
    have hnoBad : NoBadFirstPassageBackwardSeed :=
      (AperiodicOrder.Tiling.noBadFirstPassageBackwardSeed_iff_tokenGroundedFirstPassageBackwardSeeds
        u).mpr hgrounded
    exact
      (full_shared_kappa_carrier_iff_antimatterBoundary_and_noBadFirstPassageBackwardSeed
        γ b θ).mpr ⟨hanti, hnoBad⟩

/-- Equivalently, the full shared-carrier gap is the anti-matter boundary
together with D4 `confSwap` repair closure of the bad first-passage edge. -/
theorem full_shared_kappa_carrier_iff_antimatterBoundary_and_d4ConfSwapClosesBadFirstPassageBoundary
    {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) (u : Utterance) :
    Nonempty (FullSharedKappaCarrier γ b θ) ↔
      Nonempty (AntimatterBarrierBoundary γ b θ) ∧
        AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u :=
  Iff.trans
    (full_shared_kappa_carrier_iff_antimatterBoundary_and_noBadFirstPassageBackwardSeed
      γ b θ)
    (by
      constructor
      · rintro ⟨hanti, hnoBad⟩
        exact
          ⟨hanti,
            (AperiodicOrder.Tiling.d4ConfSwapClosesBadFirstPassageBoundary_iff_no_badBackwardSeed
              u).mpr hnoBad⟩
      · rintro ⟨hanti, hclosed⟩
        exact
          ⟨hanti,
            (AperiodicOrder.Tiling.d4ConfSwapClosesBadFirstPassageBoundary_iff_no_badBackwardSeed
              u).mp hclosed⟩)

/-- A full shared κ carrier directly grounds every realized first-passage
backward seed cell at the fully tokened corner. -/
theorem tokenGroundedFirstPassageBackwardSeeds_of_fullSharedKappaCarrier
    {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ) (u : Utterance) :
    AperiodicOrder.Tiling.TokenGroundedFirstPassageBackwardSeeds u :=
  AperiodicOrder.Tiling.tokenGroundedFirstPassageBackwardSeeds_of_noBadFirstPassageBackwardSeed
    u
    (AperiodicOrder.Tiling.parentBarrierTwoAdicCylinderLiftGap_iff_no_badBackwardSeed.mp
      C.collatzProjection.cylinderLiftGap)

/-- A full shared κ carrier directly supplies the D4 `confSwap` repair closure
of the bad first-passage edge. -/
theorem d4ConfSwapClosesBadFirstPassageBoundary_of_fullSharedKappaCarrier
    {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ) (u : Utterance) :
    AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u := by
  have hnoBad : NoBadFirstPassageBackwardSeed :=
    AperiodicOrder.Tiling.parentBarrierTwoAdicCylinderLiftGap_iff_no_badBackwardSeed.mp
      C.collatzProjection.cylinderLiftGap
  exact
    (AperiodicOrder.Tiling.d4ConfSwapClosesBadFirstPassageBoundary_iff_no_badBackwardSeed
      u).mpr hnoBad

/-- A full shared κ carrier closes the original parent-barrier semigroup gap. -/
theorem parentBarrierGap_of_fullSharedKappaCarrier
    {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ) :
    ParentBarrierGap :=
  AperiodicOrder.Tiling.parentBarrierGap_iff_parentBarrierTwoAdicCylinderLiftGap.mpr
    C.collatzProjection.cylinderLiftGap

/-- A full shared κ carrier closes the sharp residue form of the parent-barrier
gap. -/
theorem parentBarrierResidueGap_of_fullSharedKappaCarrier
    {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ) :
    ParentBarrierResidueGap :=
  parentBarrierGap_iff_parentBarrierResidueGap.mp
    (parentBarrierGap_of_fullSharedKappaCarrier C)

/-- A full shared κ carrier closes the high two-adic carry form of the
parent-barrier gap. -/
theorem parentBarrierResidueCarryGap_of_fullSharedKappaCarrier
    {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ) :
    ParentBarrierResidueCarryGap :=
  parentBarrierGap_iff_parentBarrierResidueCarryGap.mp
    (parentBarrierGap_of_fullSharedKappaCarrier C)

/-- A full shared κ carrier rules out concrete two-generator semigroup
certificates at every nontrivial parent barrier. -/
theorem not_inTwoGenSemigroup_of_fullSharedKappaCarrier
    {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ)
    {p : List Branch}
    (hp : ParentBarrier p) (hnt : ¬ TrivialParentBarrier p) :
    ¬ InTwoGenSemigroup (parentC p) (parentD p) (parentM p) :=
  parentBarrierGap_of_fullSharedKappaCarrier C p hp hnt

/-- A full shared κ carrier supplies the sharp residue inequality at every
nontrivial parent barrier. -/
theorem parentBarrier_residue_lt_of_fullSharedKappaCarrier
    {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ)
    {p : List Branch}
    (hp : ParentBarrier p) (hnt : ¬ TrivialParentBarrier p)
    {r : Nat}
    (hrM : r < parentM p)
    (hrmod : (parentD p * r) % parentM p = parentC p % parentM p) :
    parentC p < parentD p * r :=
  parentBarrierResidueGap_of_fullSharedKappaCarrier C p hp hnt r hrM hrmod

/-- A full shared κ carrier supplies the positive whole-modulus carry at every
nontrivial parent-barrier residue. -/
theorem parentBarrier_residue_carry_of_fullSharedKappaCarrier
    {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ)
    {p : List Branch}
    (hp : ParentBarrier p) (hnt : ¬ TrivialParentBarrier p)
    {r : Nat}
    (hrM : r < parentM p)
    (hrmod : (parentD p * r) % parentM p = parentC p % parentM p) :
    parentM p ≤ parentD p * r - parentC p :=
  parentBarrierResidueCarryGap_of_fullSharedKappaCarrier C p hp hnt r hrM hrmod

/-- A full shared κ carrier refutes any concrete bad first-passage backward
seed by token-grounding its realized seed cell. -/
theorem badBackwardSeed_contradiction_of_fullSharedKappaCarrier
    {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ) (u : Utterance)
    {p : List Branch} {n : Nat}
    (hp : ParentBarrier p) (hnt : ¬ TrivialParentBarrier p)
    (hseed : FirstPassageBackwardSeed p n)
    (hbad : BadFirstPassageBackwardSeed p n) :
    False :=
  AperiodicOrder.Tiling.badBackwardSeed_contradiction_of_tokenGroundedFirstPassageBackwardSeeds
    u (tokenGroundedFirstPassageBackwardSeeds_of_fullSharedKappaCarrier C u)
    hp hnt hseed hbad

/-- The sector interface bundles the κ ports with the material `H¹`/Landauer
readout. It is still an interface bundle, not a single shared carrier. -/
structure SectorInterface where
  /-- The Scott/Landauer/Collatz/Zeta κ interface. -/
  kappaInterface : AperiodicOrder.Tiling.KappaStratification.Interface
  /-- The material glass `H¹`/Landauer sector readout. -/
  materialSectorReadout :
    ∀ {G : AperiodicOrder.Crystal.Glass}
      (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
      (b : G.basins.Basin) (θ : Real.Internal.Rat),
        MaterialSectorReadout γ b θ

/-- The bundled sector interface. -/
def sector_interface : SectorInterface where
  kappaInterface := AperiodicOrder.Tiling.KappaStratification.interface
  materialSectorReadout := material_sector_readout

/-- A full shared carrier forgets to the current sector interface. -/
def full_shared_carrier_implies_sector_interface {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (_C : FullSharedKappaCarrier γ b θ) :
    SectorInterface :=
  sector_interface

/-- A full shared carrier exposes both the sector interface and the D4 `confSwap`
repair closure at the bad first-passage edge. -/
def full_shared_carrier_sector_interface_and_d4ConfSwap {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ) (u : Utterance) :
    PProd SectorInterface
      (AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u) :=
  ⟨full_shared_carrier_implies_sector_interface C,
    d4ConfSwapClosesBadFirstPassageBoundary_of_fullSharedKappaCarrier C u⟩

/-- The κ interface carries the material-sector charges now: a glass basin
readout supplies the `H¹`/Landauer matter ledger, the Scott face is the
vanishing `κ = ω` bridge, Collatz has the cylinder-lift κ package under
one-lock, and Zeta-star has the observed residual interface.  The theorem keeps
these as coordinated ports rather than identifying them as one shared carrier. -/
theorem material_kappa_sector_charges {G : AperiodicOrder.Crystal.Glass}
    (γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G)
    (b : G.basins.Basin) (θ : Real.Internal.Rat) :
    Nonempty (MaterialSectorReadout γ b θ) ∧
      (classify Cohomology.ScottFace.regimeData = ClosureRegime.scott ∧
        cohomologyVanishes (classify Cohomology.ScottFace.regimeData) = true) ∧
      (∀ N : CoverNerve, Landauer.landauerBits N = N.H1rank) ∧
      (AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
        ParentBarrierOneLockCollapse →
          ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed) ∧
      Nonempty AperiodicOrder.Tiling.ZetaStarAnalyticRichnessRecovery :=
  ⟨⟨material_sector_readout γ b θ⟩,
    AperiodicOrder.Tiling.KappaStratification.scott_face_is_vanishing_bridge,
    AperiodicOrder.Tiling.KappaStratification.landauer_cost_is_h1,
    AperiodicOrder.Tiling.KappaStratification.collatz_cylinder_lift_kappa_package,
    ⟨AperiodicOrder.Tiling.KappaStratification.zeta_star_residual_interface⟩⟩

/-- A full shared carrier supplies the material κ-sector charge theorem through
its carrier projections. -/
theorem full_shared_carrier_material_kappa_sector_charges {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ) :
    Nonempty (MaterialSectorReadout γ b θ) ∧
      (classify Cohomology.ScottFace.regimeData = ClosureRegime.scott ∧
        cohomologyVanishes (classify Cohomology.ScottFace.regimeData) = true) ∧
      (∀ N : CoverNerve, Landauer.landauerBits N = N.H1rank) ∧
      (AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
        ParentBarrierOneLockCollapse →
          ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed) ∧
      Nonempty AperiodicOrder.Tiling.ZetaStarAnalyticRichnessRecovery :=
  ⟨⟨C.materialCarrier.materialReadout⟩,
    C.materialCarrier.scottBridge,
    AperiodicOrder.Tiling.KappaStratification.landauer_cost_is_h1,
    fun _ _ => C.collatzProjection.kappaPackage,
    ⟨C.zetaProjection.residual⟩⟩

/-- The full shared material κ-sector package carries the D4 `confSwap` repair
closure as an explicit companion invariant. -/
theorem full_shared_carrier_material_kappa_sector_charges_and_d4ConfSwap
    {G : AperiodicOrder.Crystal.Glass}
    {γ : AperiodicOrder.Crystal.Glass.RatBasinFreeEnergyBridge G}
    {b : G.basins.Basin} {θ : Real.Internal.Rat}
    (C : FullSharedKappaCarrier γ b θ) (u : Utterance) :
    (Nonempty (MaterialSectorReadout γ b θ) ∧
      (classify Cohomology.ScottFace.regimeData = ClosureRegime.scott ∧
        cohomologyVanishes (classify Cohomology.ScottFace.regimeData) = true) ∧
      (∀ N : CoverNerve, Landauer.landauerBits N = N.H1rank) ∧
      (AperiodicOrder.Tiling.ParentBarrierTwoAdicCylinderLiftGap →
        ParentBarrierOneLockCollapse →
          ∀ seed : PositiveSeed, PositiveSeed.KappaPackage seed) ∧
      Nonempty AperiodicOrder.Tiling.ZetaStarAnalyticRichnessRecovery) ∧
      AperiodicOrder.Tiling.D4ConfSwapClosesBadFirstPassageBoundary u :=
  ⟨full_shared_carrier_material_kappa_sector_charges C,
    d4ConfSwapClosesBadFirstPassageBoundary_of_fullSharedKappaCarrier C u⟩

end AperiodicOrder.MaterialSectors.KappaSectorCharges
end Obsmetrologia
