import Obsmetrologia.AperiodicOrder.Tiling.FiniteAutocorrelation
import Obsmetrologia.Calculus.Probability.Measure
import Obsmetrologia.Language.Positing.BigradedCohomology
import Obsmetrologia.AperiodicOrder.Tiling.Classification
import Obsmetrologia.AperiodicOrder.Tiling.MetallizationDichotomy
import Obsmetrologia.AperiodicOrder.Tiling.StepN.SalemRegime

/-!
# Finite diffraction measure

This module promotes finite autocorrelation into the measure carrier already
available in the probability layer. A Boolean pattern on the cyclic carrier
`Fin (n + 1)` has a counting measure over displacements; pushing that measure
forward along `autocorr n w` gives a finite intensity measure.

This is still the finite core. It does not construct Fourier transforms,
translation-bounded measures, or a Lebesgue decomposition. It does prove that
homometric patterns have the same measured boundary residue for every intensity
event.

## Main definitions

* `displacementSpace` is the finite sample space of cyclic displacements.
* `FiniteDisplacementDelone` is the finite-displacement Delone carrier
  available on `displacementSpace`.
* `finiteDiffractionMass` is the counting-measure pushforward along finite
  autocorrelation.
* `FiniteDiffractionKind` and `FiniteDiffractionDecomposition` are the finite
  component classifier and its three measured event faces.
* `finiteFourierDualKind` is the finite Fourier-side component read from the
  StepN Pisot/Salem side.
* `FiniteFourierDualReadout` packages the finite measured atom together with
  the optional Salem trace line.
* `FinitePurePointQuasicrystal` packages the finite surrogate for a
  pure-point quasicrystal: finite-displacement Delone support plus pure-point
  finite Fourier-side readout.

## Main results

* `finiteDisplacementDelone_of_full` proves that a full finite displacement
  mask is finite-displacement Delone.
* `finiteDiffractionMass_empty`, `finiteDiffractionMass_univ`, and
  `finiteDiffractionMass_mono` give the inherited finite measure laws.
* `homometric_finiteDiffractionMass_eq` proves homometry preserves the finite
  measured residue.
* `finiteDiffractionDecomposition_mass` decomposes total finite mass into the
  pure-point, singular-continuous, and absolutely-continuous component counts.
* `finite_diffraction_classifier_agreement` records the finite agreement of the
  charge, closure-regime, Pisot/Salem, and `H¹` witnesses.
* `phaseType_readings_agree` proves the single finite/predictor-level phase map
  shared by the current diffraction, charge, Pisot/Salem, and closure readings.
* `finiteFourierDual_color_readout` lifts the predictor-level color split to a
  finite measured spectral readout: Pisot is pure-point, Salem is
  singular-continuous, and the Salem component carries the trace-localized line.

## Tags

diffraction, autocorrelation, homometry, finite measure, boundary residue
-/

namespace Obsmetrologia
namespace AperiodicOrder.Tiling

open Obsmetrologia.Discrete
open Obsmetrologia.Probability.Measure

/-! ## Displacement sample space -/

/-- The finite displacement sample space for a cyclic pattern on `n + 1` sites. -/
def displacementSpace (n : Nat) : SampleSpace (Fin (n + 1)) where
  outcomes := List.finRange (n + 1)

/-! ## Finite displacement Delone support -/

/-- A finite-displacement Delone surrogate over `displacementSpace`.

On the finite cyclic displacement carrier, local finiteness and separation are
automatic, and relative density reduces to nonempty support over the listed
finite carrier. This is the finite carrier used by `Diffraction`; it is not an
analytic Delone set in a metric locally compact group. -/
structure FiniteDisplacementDelone (n : Nat) (w : Fin (n + 1) → Bool) :
    Prop where
  /-- The finite displacement sample space is locally finite. -/
  locallyFinite : True
  /-- The finite discrete carrier is separated. -/
  separated : ∀ a b, w a = true → w b = true → a = b ∨ a ≠ b
  /-- Every listed displacement is controlled by a supported point. -/
  relativelyDense : ∀ _d : Fin (n + 1), ∃ p : Fin (n + 1), w p = true

/-- A full finite displacement mask is finite-displacement Delone. -/
theorem finiteDisplacementDelone_of_full {n : Nat} {w : Fin (n + 1) → Bool}
    (h : ∀ d, w d = true) : FiniteDisplacementDelone n w := by
  refine ⟨trivial, ?_, ?_⟩
  · intro a b _ _
    by_cases hab : a = b
    · exact Or.inl hab
    · exact Or.inr hab
  · intro d
    exact ⟨d, h d⟩

/-! ## Finite diffraction mass -/

/-- The finite diffraction mass of an intensity event: the pushforward of the
counting measure on displacements along the finite autocorrelation function. -/
def finiteDiffractionMass (n : Nat) (w : Fin (n + 1) → Bool)
    (A : Event Nat) : Nat :=
  (displacementSpace n).measure (fun d => A (autocorr n w d))

/-- The finite diffraction mass has zero mass on the empty intensity event. -/
theorem finiteDiffractionMass_empty (n : Nat) (w : Fin (n + 1) → Bool) :
    finiteDiffractionMass n w Set.empty = 0 := by
  unfold finiteDiffractionMass
  exact SampleSpace.measure_empty (displacementSpace n)

/-- The finite diffraction mass has total mass `n + 1` on the universal
intensity event. -/
theorem finiteDiffractionMass_univ (n : Nat) (w : Fin (n + 1) → Bool) :
    finiteDiffractionMass n w Set.univ = n + 1 := by
  unfold finiteDiffractionMass
  have hEvent :
      (fun d : Fin (n + 1) => (Set.univ : Event Nat) (autocorr n w d)) =
        (Set.univ : Event (Fin (n + 1))) := rfl
  rw [hEvent]
  unfold displacementSpace
  rw [SampleSpace.measure_univ]
  unfold SampleSpace.total
  rw [List.length_finRange]

/-- The finite diffraction mass is monotone in the intensity event. -/
theorem finiteDiffractionMass_mono (n : Nat) (w : Fin (n + 1) → Bool)
    {A B : Event Nat} (h : Set.subset A B) :
    finiteDiffractionMass n w A ≤ finiteDiffractionMass n w B := by
  unfold finiteDiffractionMass
  apply SampleSpace.measure_mono
  intro d hd
  exact h (autocorr n w d) hd

/-- Homometric patterns have the same finite diffraction mass for every
intensity event. -/
theorem homometric_finiteDiffractionMass_eq {n : Nat}
    {w w' : Fin (n + 1) → Bool} (h : Homometric n w w') (A : Event Nat) :
    finiteDiffractionMass n w A = finiteDiffractionMass n w' A := by
  unfold finiteDiffractionMass Homometric at *
  rw [h]

/-! ## Finite component decomposition -/

/-- The finite component label used by the decidable diffraction classifier.
These are component faces of the finite counting measure, not an analytic
Lebesgue decomposition. -/
inductive FiniteDiffractionKind where
  /-- The finite pure-point component face. -/
  | purePoint
  /-- The finite singular-continuous component face. -/
  | singularContinuous
  /-- The finite absolutely-continuous component face. -/
  | absolutelyContinuous
  deriving DecidableEq, Repr

/-- A finite three-component decomposition of a sample space into pure-point,
singular-continuous, and absolutely-continuous event faces. -/
structure FiniteDiffractionDecomposition (Ω : Type) where
  /-- The pure-point component event. -/
  pp : Event Ω
  /-- The singular-continuous component event. -/
  sc : Event Ω
  /-- The absolutely-continuous component event. -/
  ac : Event Ω
  /-- The pure-point and singular-continuous components are disjoint. -/
  pp_sc_disjoint : Set.inter pp sc = Set.empty
  /-- The first two components are jointly disjoint from the absolutely-continuous component. -/
  pp_sc_ac_disjoint : Set.inter (Set.union pp sc) ac = Set.empty
  /-- The three components cover the sample space. -/
  cover : Set.union (Set.union pp sc) ac = Set.univ

/-- Select a component event from a finite diffraction decomposition. -/
def FiniteDiffractionDecomposition.component {Ω : Type}
    (D : FiniteDiffractionDecomposition Ω) : FiniteDiffractionKind → Event Ω
  | .purePoint => D.pp
  | .singularContinuous => D.sc
  | .absolutelyContinuous => D.ac

/-- The event cut out by a finite diffraction classifier and one component label. -/
def componentEvent {Ω : Type} (c : Ω → FiniteDiffractionKind)
    (k : FiniteDiffractionKind) : Event Ω :=
  fun x => decide (c x = k)

/-- Every finite component classifier induces a disjoint, covering decomposition. -/
def decompositionOfClassifier {Ω : Type} (c : Ω → FiniteDiffractionKind) :
    FiniteDiffractionDecomposition Ω where
  pp := componentEvent c .purePoint
  sc := componentEvent c .singularContinuous
  ac := componentEvent c .absolutelyContinuous
  pp_sc_disjoint := by
    apply Set.ext
    intro x
    unfold Set.inter Set.empty
    generalize hk : c x = k
    cases k <;> simp [componentEvent, hk]
  pp_sc_ac_disjoint := by
    apply Set.ext
    intro x
    unfold Set.inter Set.union Set.empty
    generalize hk : c x = k
    cases k <;> simp [componentEvent, hk]
  cover := by
    apply Set.ext
    intro x
    unfold Set.union Set.univ
    generalize hk : c x = k
    cases k <;> simp [componentEvent, hk]

/-- A finite component decomposition splits total counting mass into its three
component masses. -/
theorem finiteDiffractionDecomposition_mass {Ω : Type}
    (S : SampleSpace Ω) (D : FiniteDiffractionDecomposition Ω) :
    S.measure Set.univ = S.measure D.pp + S.measure D.sc + S.measure D.ac := by
  rw [← D.cover]
  rw [SampleSpace.measure_union_disjoint S (Set.union D.pp D.sc) D.ac
    D.pp_sc_ac_disjoint]
  rw [SampleSpace.measure_union_disjoint S D.pp D.sc D.pp_sc_disjoint]

/-! ## Agreement with the existing classifiers -/

/-- The finite diffraction component read from the four-valued charge regime. -/
def chargeDiffractionKind : Regime → FiniteDiffractionKind
  | .consistent => .purePoint
  | .paraconsistent => .singularContinuous
  | .mixed => .absolutelyContinuous
  | .trivial => .absolutelyContinuous

/-- The finite diffraction component read from the closure-ordinal regime. -/
def closureDiffractionKind : ClosureRegime → FiniteDiffractionKind
  | .strict => .purePoint
  | .scott => .purePoint
  | .transfiniteBounded => .absolutelyContinuous
  | .aperiodic => .singularContinuous

/-- The consistent charge face reads as finite pure-point. -/
theorem regimeOf_purePoint :
    chargeDiffractionKind (regimeOf true false) = FiniteDiffractionKind.purePoint := rfl

/-- The paraconsistent charge face reads as finite singular-continuous. -/
theorem regimeOf_singularContinuous :
    chargeDiffractionKind (regimeOf false true) =
      FiniteDiffractionKind.singularContinuous := rfl

/-- The mixed charge face reads as finite absolutely-continuous. -/
theorem regimeOf_absolutelyContinuous :
    chargeDiffractionKind (regimeOf true true) =
      FiniteDiffractionKind.absolutelyContinuous := rfl

/-- The Pisot side of the StepN split reads as finite pure-point. -/
theorem pisot_diffractionKind :
    closureDiffractionKind (StepN.inflationRegime false) =
      FiniteDiffractionKind.purePoint := rfl

/-- The Salem side of the StepN split reads as finite singular-continuous. -/
theorem salem_diffractionKind :
    closureDiffractionKind (StepN.inflationRegime true) =
      FiniteDiffractionKind.singularContinuous := rfl

/-- In strict and Scott regimes, vanishing `H¹` agrees with the finite pure-point face. -/
theorem settling_vanishing_diffractionKind (v : Settling)
    (h : v.regime = ClosureRegime.strict ∨ v.regime = ClosureRegime.scott) :
    closureDiffractionKind v.regime = FiniteDiffractionKind.purePoint ∧
      v.clInv = H1Class.zero := by
  constructor
  · cases h with
    | inl hs =>
        rw [hs]
        rfl
    | inr hs =>
        rw [hs]
        rfl
  · exact clinv_zero_of_settles v h

/-- The exhibited nonzero aperiodic witness agrees with the finite
singular-continuous face. -/
theorem aperiodicWitness_singularContinuous :
    closureDiffractionKind aperiodicWitness.regime =
        FiniteDiffractionKind.singularContinuous ∧
      aperiodicWitness.clInv ≠ H1Class.zero := by
  exact ⟨rfl, aperiodicWitness_clinv_nonzero⟩

/-- The finite diffraction classifier agrees with the already-proved charge,
closure-regime, Pisot/Salem, and `H¹` witnesses. -/
theorem finite_diffraction_classifier_agreement :
    chargeDiffractionKind (regimeOf true false) = FiniteDiffractionKind.purePoint ∧
      chargeDiffractionKind (regimeOf false true) =
        FiniteDiffractionKind.singularContinuous ∧
        chargeDiffractionKind (regimeOf true true) =
          FiniteDiffractionKind.absolutelyContinuous ∧
          closureDiffractionKind (StepN.inflationRegime false) =
            FiniteDiffractionKind.purePoint ∧
            closureDiffractionKind (StepN.inflationRegime true) =
              FiniteDiffractionKind.singularContinuous ∧
              closureDiffractionKind aperiodicWitness.regime =
                FiniteDiffractionKind.singularContinuous ∧
                aperiodicWitness.clInv ≠ H1Class.zero := by
  exact ⟨regimeOf_purePoint, regimeOf_singularContinuous,
    regimeOf_absolutelyContinuous, pisot_diffractionKind, salem_diffractionKind,
    aperiodicWitness_singularContinuous.1, aperiodicWitness_singularContinuous.2⟩

/-! ## Finite predictor-level phase type -/

/-- The substitution phase carrier currently generated in core.

`false` is the contracting/Pisot side and `true` is the neutral/Salem side. This
is the finite predictor-level carrier already present in `StepN.SalemRegime`,
not a general analytic substitution spectrum. -/
abbrev PhaseSubstitution : Type := Bool

/-- Truth-side content of the finite predictor-level substitution phase. -/
def phaseTruthContent (s : PhaseSubstitution) : Bool := !s

/-- Inconsistency-side content of the finite predictor-level substitution phase. -/
def phaseInconsistencyContent (s : PhaseSubstitution) : Bool := s

/-- Scaling readout of the finite predictor-level substitution phase. -/
def phaseScaling (s : PhaseSubstitution) : Bool := s

/-- The single phase map for the finite predictor-level substitution carrier. -/
def phaseType (s : PhaseSubstitution) : Regime :=
  regimeOf (phaseTruthContent s) (phaseInconsistencyContent s)

/-- The finite component-label readout as a phase regime.

This reads the finite three-component classifier already proved above. It is not
an analytic Lebesgue decomposition of a Fourier-side diffraction measure. -/
def lebesgueType : FiniteDiffractionKind → Regime
  | .purePoint => .consistent
  | .singularContinuous => .paraconsistent
  | .absolutelyContinuous => .mixed

/-- The Pisot/Salem readout as a phase regime: contracting/Pisot is consistent,
neutral/Salem is paraconsistent. -/
def pisotSalemClass (onUnitCircle : Bool) : Regime :=
  regimeOf (!onUnitCircle) onUnitCircle

/-- The finite diffraction component selected by the predictor-level phase. -/
def phaseDiffractionComponent (s : PhaseSubstitution) : FiniteDiffractionKind :=
  closureDiffractionKind (StepN.inflationRegime s)

/-- The closure-ordinal readout as a phase regime on the current predictor-level carrier. -/
def closureRegime (s : PhaseSubstitution) : Regime :=
  match StepN.inflationRegime s with
  | .strict => .consistent
  | .scott => .consistent
  | .transfiniteBounded => .mixed
  | .aperiodic => .paraconsistent

/-- The finite predictor-level phase is nontrivial, so the bigraded trichotomy applies. -/
theorem phaseType_nontrivial (s : PhaseSubstitution) :
    phaseType s = .consistent ∨ phaseType s = .paraconsistent ∨ phaseType s = .mixed := by
  exact trichotomy (phaseTruthContent s) (phaseInconsistencyContent s)
    (by cases s <;> decide)

/-- The current finite/predictor-level phase map is the common value of the
finite diffraction component, bigraded charge, Pisot/Salem scaling, and
closure-regime readings. -/
theorem phaseType_readings_agree (s : PhaseSubstitution) :
    (lebesgueType (phaseDiffractionComponent s) = phaseType s)
      ∧ (regimeOf (phaseTruthContent s) (phaseInconsistencyContent s) = phaseType s)
      ∧ (pisotSalemClass (phaseScaling s) = phaseType s)
      ∧ (closureRegime s = phaseType s) := by
  cases s
  · exact ⟨rfl, rfl, rfl, rfl⟩
  · exact ⟨rfl, rfl, rfl, rfl⟩

/-- The phase-type evidence bundle: the common
finite/predictor-level phase map, the bigraded trichotomy on that carrier, the
Salem/Pisot regime split, the StepN metallization dichotomy, and the finite total-mass
law inherited from the measure layer. The metallization component here is the finite algebraic
recurrence face; it is not the load-bearing/conduction proof, which lives over `H¹` in
`MatterTopology` and `Percolation`. -/
theorem phaseType_evidence :
    (∀ s : PhaseSubstitution,
      (lebesgueType (phaseDiffractionComponent s) = phaseType s)
        ∧ (regimeOf (phaseTruthContent s) (phaseInconsistencyContent s) = phaseType s)
        ∧ (pisotSalemClass (phaseScaling s) = phaseType s)
        ∧ (closureRegime s = phaseType s))
    ∧ (∀ s : PhaseSubstitution,
      phaseType s = .consistent ∨ phaseType s = .paraconsistent ∨ phaseType s = .mixed)
    ∧ (StepN.inflationRegime true = ClosureRegime.aperiodic
      ∧ StepN.inflationRegime false = ClosureRegime.strict
      ∧ (0 < StepN.evalIntPoly StepN.salemTraceResolvent (-2) ∧ StepN.evalIntPoly StepN.salemTraceResolvent 0 < 0)
      ∧ (0 < StepN.evalIntPoly (StepN.charPolyMetallic 1) (-1)
        ∧ StepN.evalIntPoly (StepN.charPolyMetallic 1) 0 < 0))
    ∧ ((∀ (n k : Nat),
      StepN.zpow (StepN.metallicZ n) k =
        (StepN.coef n k).1 * StepN.metallicZ n + (StepN.coef n k).2)
      ∧ (ChromaticLorentzian.step (ChromaticLorentzian.step ChromaticLorentzian.mark0) ≠
        ChromaticLorentzian.step ChromaticLorentzian.mark0)
      ∧ (∀ (N M : Nat),
        1 ≤ N → Real.Internal.expSeq (N + M) ≤
          Real.Internal.expSeq N + (Real.Internal.expTerm N + Real.Internal.expTerm N)))
    ∧ (∀ (n : Nat) (w : Fin (n + 1) → Bool),
      finiteDiffractionMass n w Set.univ = n + 1) :=
  ⟨phaseType_readings_agree, phaseType_nontrivial, StepN.salem_vs_pisot_regime,
    metallization_dichotomy, finiteDiffractionMass_univ⟩

/-! ## Finite Fourier-side readout -/

/-- The Pisot side of the StepN inflation carrier. -/
def IsPisotInflation (s : Bool) : Prop := s = false

/-- The Salem side of the StepN inflation carrier. -/
def IsSalemInflation (s : Bool) : Prop := s = true

/-- The finite Fourier-side component read from the StepN inflation side. -/
def finiteFourierDualKind (s : Bool) : FiniteDiffractionKind :=
  closureDiffractionKind (StepN.inflationRegime s)

/-- The finite Fourier-side component is pure-point exactly on the Pisot side. -/
theorem finiteFourierDualKind_purePoint_iff_pisot (s : Bool) :
    finiteFourierDualKind s = FiniteDiffractionKind.purePoint ↔ IsPisotInflation s := by
  cases s
  · constructor
    · intro _; rfl
    · intro _; exact pisot_diffractionKind
  · constructor
    · intro h
      rw [finiteFourierDualKind, salem_diffractionKind] at h
      cases h
    · intro h
      cases h

/-- The finite Fourier-side component is singular-continuous exactly on the Salem side. -/
theorem finiteFourierDualKind_singularContinuous_iff_salem (s : Bool) :
    finiteFourierDualKind s = FiniteDiffractionKind.singularContinuous ↔
      IsSalemInflation s := by
  cases s
  · constructor
    · intro h
      rw [finiteFourierDualKind, pisot_diffractionKind] at h
      cases h
    · intro h
      cases h
  · constructor
    · intro _; rfl
    · intro _; exact salem_diffractionKind

/-- A trace-localized angle line. The intended reading is
`θ = arccos(root / 2)`, with the trace root localized by the stored sign-change
certificate. -/
structure TraceAngleLine where
  /-- The trace polynomial whose root localizes the line. -/
  trace : List Int
  /-- The left endpoint of the sign-change bracket. -/
  left : Int
  /-- The right endpoint of the sign-change bracket. -/
  right : Int
  /-- The trace-root localization certificate. -/
  localized : 0 < StepN.evalIntPoly trace left ∧ StepN.evalIntPoly trace right < 0

/-- The Salem trace line localized by `salemTraceResolvent_unit_circle`. -/
def salemTraceAngleLine : TraceAngleLine where
  trace := StepN.salemTraceResolvent
  left := -2
  right := 0
  localized := StepN.salemTraceResolvent_unit_circle

/-- A finite Fourier-side readout of the finite diffraction mass. It records
the component label, the positive finite atom mass, and the optional trace line
carried by the Salem component. -/
structure FiniteFourierDualReadout (n : Nat) (w : Fin (n + 1) → Bool) where
  /-- The StepN side being read: `false` for Pisot, `true` for Salem. -/
  side : Bool
  /-- The finite component read from that side. -/
  component : FiniteDiffractionKind
  /-- The measured finite atom mass. -/
  atomMass : Nat
  /-- The atom has positive finite mass. -/
  atomPositive : 0 < atomMass
  /-- The Salem trace line when the component carries one. -/
  line : Option TraceAngleLine
  /-- The component agrees with the finite Fourier-side classifier. -/
  component_eq : component = finiteFourierDualKind side
  /-- The atom mass is the total finite diffraction mass. -/
  mass_eq : atomMass = finiteDiffractionMass n w Set.univ

/-- The canonical finite Fourier-side readout for a pattern and StepN side. -/
def finiteFourierDualReadout (n : Nat) (w : Fin (n + 1) → Bool) (side : Bool) :
    FiniteFourierDualReadout n w where
  side := side
  component := finiteFourierDualKind side
  atomMass := n + 1
  atomPositive := Nat.succ_pos n
  line := if side then some salemTraceAngleLine else none
  component_eq := rfl
  mass_eq := by rw [finiteDiffractionMass_univ]

/-- The canonical readout atom has the total finite diffraction mass, hence
positive mass. -/
theorem finiteFourierDualReadout_mass (n : Nat) (w : Fin (n + 1) → Bool)
    (side : Bool) :
    (finiteFourierDualReadout n w side).atomMass =
        finiteDiffractionMass n w Set.univ ∧
      0 < (finiteFourierDualReadout n w side).atomMass := by
  exact ⟨(finiteFourierDualReadout n w side).mass_eq,
    (finiteFourierDualReadout n w side).atomPositive⟩

/-- Homometric patterns have the same finite Fourier-side atom mass. -/
theorem homometric_finiteFourierDualReadout_atomMass_eq {n : Nat}
    {w w' : Fin (n + 1) → Bool} (h : Homometric n w w') (side : Bool) :
    (finiteFourierDualReadout n w side).atomMass =
      (finiteFourierDualReadout n w' side).atomMass := by
  rw [(finiteFourierDualReadout n w side).mass_eq,
    (finiteFourierDualReadout n w' side).mass_eq,
    homometric_finiteDiffractionMass_eq h Set.univ]

/-- The Salem finite readout is singular-continuous, carries the Salem trace
line, and has positive measured atom mass. -/
theorem salem_finiteFourierDualReadout_carries_line (n : Nat)
    (w : Fin (n + 1) → Bool) :
    (finiteFourierDualReadout n w true).component =
        FiniteDiffractionKind.singularContinuous ∧
      (finiteFourierDualReadout n w true).line = some salemTraceAngleLine ∧
        (finiteFourierDualReadout n w true).atomMass =
            finiteDiffractionMass n w Set.univ ∧
          0 < (finiteFourierDualReadout n w true).atomMass := by
  exact ⟨rfl, rfl, (finiteFourierDualReadout n w true).mass_eq,
    (finiteFourierDualReadout n w true).atomPositive⟩

/-- The Pisot finite readout is pure-point, carries no Salem trace line, and has
positive measured atom mass. -/
theorem pisot_finiteFourierDualReadout_purePoint (n : Nat)
    (w : Fin (n + 1) → Bool) :
    (finiteFourierDualReadout n w false).component =
        FiniteDiffractionKind.purePoint ∧
      (finiteFourierDualReadout n w false).line = none ∧
        (finiteFourierDualReadout n w false).atomMass =
            finiteDiffractionMass n w Set.univ ∧
          0 < (finiteFourierDualReadout n w false).atomMass := by
  exact ⟨rfl, rfl, (finiteFourierDualReadout n w false).mass_eq,
    (finiteFourierDualReadout n w false).atomPositive⟩

/-- The finite color readout: pure-point iff Pisot, singular-continuous iff
Salem, and the Salem side carries a trace-localized finite atom. -/
theorem finiteFourierDual_color_readout (n : Nat) (w : Fin (n + 1) → Bool) :
    (∀ s : Bool,
        finiteFourierDualKind s = FiniteDiffractionKind.purePoint ↔
          IsPisotInflation s) ∧
      (∀ s : Bool,
        finiteFourierDualKind s = FiniteDiffractionKind.singularContinuous ↔
          IsSalemInflation s) ∧
        (finiteFourierDualReadout n w true).component =
            FiniteDiffractionKind.singularContinuous ∧
          (finiteFourierDualReadout n w true).line = some salemTraceAngleLine ∧
            (finiteFourierDualReadout n w true).atomMass =
                finiteDiffractionMass n w Set.univ ∧
              0 < (finiteFourierDualReadout n w true).atomMass := by
  exact ⟨finiteFourierDualKind_purePoint_iff_pisot,
    finiteFourierDualKind_singularContinuous_iff_salem,
    salem_finiteFourierDualReadout_carries_line n w⟩

/-! ## Finite pure-point quasicrystal surrogate -/

/-- The finite pure-point quasicrystal surrogate available in this corpus:
finite-displacement Delone support together with a finite Fourier-side readout
whose component is pure point and whose atom is the total finite diffraction
mass. This is still a finite carrier statement, not an analytic diffraction
measure theorem. -/
structure FinitePurePointQuasicrystal (n : Nat) (w : Fin (n + 1) → Bool)
    (side : Bool) : Prop where
  /-- The support is Delone in the finite displacement carrier. -/
  delone : FiniteDisplacementDelone n w
  /-- The finite Fourier-side component is pure-point. -/
  purePoint :
    (finiteFourierDualReadout n w side).component =
      FiniteDiffractionKind.purePoint
  /-- The readout atom is the total finite diffraction mass. -/
  atomMass :
    (finiteFourierDualReadout n w side).atomMass =
      finiteDiffractionMass n w Set.univ
  /-- The finite readout atom has positive mass. -/
  atomPositive : 0 < (finiteFourierDualReadout n w side).atomMass

/-- A finite-displacement Delone support with Pisot-side readout is a finite
pure-point quasicrystal surrogate. -/
theorem finitePurePointQuasicrystal_of_pisot {n : Nat}
    {w : Fin (n + 1) → Bool} {side : Bool}
    (hdelone : FiniteDisplacementDelone n w)
    (hpisot : IsPisotInflation side) :
    FinitePurePointQuasicrystal n w side := by
  refine ⟨hdelone, ?_, (finiteFourierDualReadout_mass n w side).1,
    (finiteFourierDualReadout_mass n w side).2⟩
  change finiteFourierDualKind side = FiniteDiffractionKind.purePoint
  exact (finiteFourierDualKind_purePoint_iff_pisot side).mpr hpisot

/-- A full finite displacement mask on the Pisot side is a finite pure-point
quasicrystal surrogate. -/
theorem finitePurePointQuasicrystal_of_full_pisot {n : Nat}
    {w : Fin (n + 1) → Bool} {side : Bool}
    (hfull : ∀ d, w d = true) (hpisot : IsPisotInflation side) :
    FinitePurePointQuasicrystal n w side :=
  finitePurePointQuasicrystal_of_pisot
    (finiteDisplacementDelone_of_full hfull) hpisot

end AperiodicOrder.Tiling
end Obsmetrologia
