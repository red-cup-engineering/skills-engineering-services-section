import Obsmetrologia.Calculus.Order.OrderInfra
import Obsmetrologia.Cohomology.SettlingCohomologyH1
import Obsmetrologia.Site.Sheaf

/-!
# Alexandrov topology and the Husainov comparison

Two corpus nodes of the aperiodic-settling layer.

* `…/settling/content/aperiodic-settling/content/alexandrov-topology/alexandrov-topology.md`
  — the **Alexandrov topology** on a poset `(P, ≤)`: the topology whose opens are the
  **up-sets** (sets closed under going up along `≤`). Closure under *arbitrary* (not merely
  finite) intersection is the property that characterizes Alexandrov spaces. The
  specialization order recovers `≤`, and continuous maps are exactly the monotone maps
  (Alexandrov spaces `≅` preorders; [@ayzenberg-magai2025] Appendix A.2). A sheaf on
  `(P, ≤)_Alex` is exactly a functor `P → 𝒱`.

* `…/alexandrov-topology/content/husainov-acyclicity/husainov-acyclicity.md`
  — **Husainov acyclicity** ([@husainov2026], arXiv:2310.05577): the
  necessary-and-sufficient condition under which Čech cohomology on an Alexandrov poset
  agrees with the **derived-functor** sheaf cohomology of the sheafification, phrased via
  acyclicity of the poset's **Dedekind–MacNeille cuts** (algorithmically computable for
  finite posets).

## What is proved

**Alexandrov topology.** `AlexandrovTopology P` collects the opens of `(P, ≤)` as up-sets,
as `Prop`-valued predicates `P.carrier → Prop` (so an *arbitrary*-index intersection/union
is well-typed). We prove the topology axioms including the arbitrary-intersection
strengthening (`isOpen_iInter`, `isOpen_iUnion`), that the specialization order recovers `≤`
(`specializes_iff_le`), and that continuous = monotone (`continuous_iff_monotone`). These
bundle into `alexandrov_specialization_recovers_poset`.

**Čech vanishing on the bounded sub-sites.** `husainov_cech_acyclic_on_bounded_sites` reuses
the Čech `H¹` machinery of `SettlingCohomologyH1`: on the strict/Scott regime the Čech `H¹`
of every cover vanishes (`CechAcyclic`) and Čech cohomology is trivial above degree one.

## What is not proved — the Husainov comparison is open

The interesting half of Husainov's theorem is the **comparison** `Ȟⁿ(F_U) ≅ RⁿΓ(F_U)` between
Čech and derived-functor cohomology, which holds exactly under Dedekind–MacNeille-cut
acyclicity. Derived-functor cohomology `RⁿΓ` requires injective/flasque resolutions of `F_U`,
which this dependency-free core does not construct, and without that construction there is no
non-trivial Lean statement of the comparison (any underspecified attempt is either a
definitional tautology `RΓ := Ȟ` or, conditioned on an unconstrained abstract `RΓ`, refutable).
So the derived functor is **not** modelled here; the comparison is carried as an open node in
the blueprint (`thm:husainov-cech-derived`) and awaits the resolution machinery.
-/

namespace Obsmetrologia
namespace Alexandrov

open Obsmetrologia.Order

/-! ## Up-sets — the opens of the Alexandrov topology

An **open** of the Alexandrov topology on a poset `(P, ≤)` is an **up-set**: a predicate
`U : P.carrier → Prop` closed under going up along `≤` (`x ∈ U → x ≤ y → y ∈ U`). We use
`Prop`-valued sets so that an **arbitrary** indexed intersection `⋂ᵢ Uᵢ` and union `⋃ᵢ Uᵢ`
are well-typed — the defining Alexandrov property. -/

/-- An **open set of `P`** is a `Prop`-valued predicate on the carrier. (Prop-valued, so an
arbitrary-index intersection/union exists — the Alexandrov-distinguishing closure.) -/
abbrev Opens (P : PartialOrder) : Type := P.carrier → Prop

/-- **Up-set / open.** `U` is open in the Alexandrov topology when it is an **up-set**:
membership is preserved by going up along `≤`. -/
def IsUpSet (P : PartialOrder) (U : Opens P) : Prop :=
  ∀ ⦃x y : P.carrier⦄, U x → P.le x y → U y

/-- **The Alexandrov topology of a poset.** The topology whose opens are exactly the
up-sets of `(P, ≤)`. We carry `P` and read `IsOpen := IsUpSet P` off it; the closure
properties are the theorems below. -/
structure AlexandrovTopology where
  /-- The underlying poset. -/
  poset : PartialOrder

namespace AlexandrovTopology
variable (T : AlexandrovTopology)

/-- `IsOpen U` — `U` is an open of the Alexandrov topology, i.e. an up-set of the poset. -/
def IsOpen (U : Opens T.poset) : Prop := IsUpSet T.poset U

/-! ### The topology axioms, with the Alexandrov *arbitrary*-intersection strengthening -/

/-- The empty set is open (vacuously an up-set). -/
theorem isOpen_empty : T.IsOpen (fun _ => False) := fun _ _ h _ => h

/-- The whole space is open. -/
theorem isOpen_univ : T.IsOpen (fun _ => True) := fun _ _ _ _ => trivial

/-- **Binary intersection** of opens is open. -/
theorem isOpen_inter (U V : Opens T.poset) (hU : T.IsOpen U) (hV : T.IsOpen V) :
    T.IsOpen (fun z => U z ∧ V z) :=
  fun _ _ h hxy => ⟨hU h.1 hxy, hV h.2 hxy⟩

/-- **Binary union** of opens is open. -/
theorem isOpen_union (U V : Opens T.poset) (hU : T.IsOpen U) (hV : T.IsOpen V) :
    T.IsOpen (fun z => U z ∨ V z) :=
  fun _ _ h hxy => h.elim (fun hu => Or.inl (hU hu hxy)) (fun hv => Or.inr (hV hv hxy))

/-- **Arbitrary intersection** of opens is open — *the Alexandrov property*. For any index
type `ι` and family `U : ι → Opens` of up-sets, the intersection `⋂ᵢ Uᵢ` is again an
up-set. This is the closure under **arbitrary** (not just finite) intersection that
characterizes Alexandrov topologies. -/
theorem isOpen_iInter {ι : Type} (U : ι → Opens T.poset) (hU : ∀ i, T.IsOpen (U i)) :
    T.IsOpen (fun z => ∀ i, U i z) :=
  fun _ _ h hxy i => hU i (h i) hxy

/-- **Arbitrary union** of opens is open. For any index type `ι` and family of up-sets, the
union `⋃ᵢ Uᵢ` is an up-set. -/
theorem isOpen_iUnion {ι : Type} (U : ι → Opens T.poset) (hU : ∀ i, T.IsOpen (U i)) :
    T.IsOpen (fun z => ∃ i, U i z) :=
  fun _ _ h hxy => h.elim (fun i hi => ⟨i, hU i hi hxy⟩)

/-! ### Principal up-sets and the specialization order

The **principal up-set** `↑x := {y | x ≤ y}` is the smallest open containing `x` — its
opens are exactly the up-sets, and `↑x` is itself an up-set (by transitivity). The
specialization preorder `x ⤳ y` is recovered through it. -/

/-- The **principal up-set** `↑a = {z | a ≤ z}`. It is the smallest open containing `a`. -/
def upperSet (a : T.poset.carrier) : Opens T.poset := fun z => T.poset.le a z

/-- The principal up-set is open (an up-set), by transitivity of `≤`. -/
theorem isOpen_upperSet (a : T.poset.carrier) : T.IsOpen (T.upperSet a) :=
  fun _ _ hx hxy => T.poset.le_trans hx hxy

/-- `a` lies in its own principal up-set (reflexivity). -/
theorem mem_upperSet_self (a : T.poset.carrier) : T.upperSet a a := T.poset.le_refl a

/-- **Specialization preorder.** `x ⤳ y` (`x` specializes to `y`, i.e. `y ∈ closure {x}`,
equivalently `x ∈ ⋂ {U open : x ∈ U}` forces `y`): **every open containing `x` contains
`y`**. For the Alexandrov topology this recovers the poset order on the nose. -/
def specializes (x y : T.poset.carrier) : Prop :=
  ∀ U : Opens T.poset, T.IsOpen U → U x → U y

/-- **The specialization order recovers `≤`.** `x` specializes to `y` **iff** `x ≤ y`
(`⤳` = `≤`). Forward: the principal up-set `↑x` is an open containing `x` (reflexively), so
`specializes x y` applied to `↑x` forces `↑x y`, i.e. `x ≤ y`. Backward: every open is an
up-set, so from `U x` and `x ≤ y` we get `U y`. This is the poset `≅` Alexandrov-space
correspondence at the level of orders. -/
theorem specializes_iff_le (x y : T.poset.carrier) :
    T.specializes x y ↔ T.poset.le x y := by
  constructor
  · intro h
    -- apply `specializes` to the principal up-set `↑x` (open, contains `x` reflexively):
    -- it yields `↑x y`, which is `x ≤ y` by definition of `upperSet`.
    exact h (T.upperSet x) (T.isOpen_upperSet x) (T.mem_upperSet_self x)
  · intro hxy U hU hUx
    -- `U` open = up-set: from `U x` and `x ≤ y` membership propagates upward to `U y`.
    exact hU hUx hxy

/-- **The specialization order is `≤` exactly** (as predicates): the Alexandrov topology's
specialization relation is, pointwise, the poset order. The poset `(P, ≤)` is therefore
recovered from its Alexandrov space, and (with `le_antisymm`) the specialization order is a partial order equal to `≤`. -/
theorem specializes_eq_le : T.specializes = T.poset.le := by
  funext x y; exact propext (T.specializes_iff_le x y)

end AlexandrovTopology

/-! ## Continuous = monotone

A map between Alexandrov spaces is **continuous** when the preimage of every open (up-set)
is open (an up-set). The corpus statement: continuous maps between Alexandrov spaces are
exactly the **monotone** maps between the underlying posets (Alexandrov `≅` preorders). -/

/-- **Continuity (Alexandrov).** `f : P → Q` is continuous when the preimage of every open
(up-set) of `Q` is an open (up-set) of `P`. -/
def Continuous (T S : AlexandrovTopology) (f : T.poset.carrier → S.poset.carrier) : Prop :=
  ∀ V : Opens S.poset, S.IsOpen V → T.IsOpen (fun x => V (f x))

/-- **Monotone.** `f` is monotone when it preserves `≤`: `x ≤ y → f x ≤ f y`. -/
def IsMonotone (T S : AlexandrovTopology) (f : T.poset.carrier → S.poset.carrier) : Prop :=
  ∀ ⦃x y : T.poset.carrier⦄, T.poset.le x y → S.poset.le (f x) (f y)

/-- **Continuous ⟺ monotone.** For Alexandrov topologies, `f` is continuous **iff** it is
monotone. Forward: apply continuity to the principal up-set `↑(f x)` of `S` (open) to learn
the preimage `{z | f x ≤ f z}` is an up-set of `P`; `f x ∈ it` reflexively, so `x ≤ y`
pushes `f x ≤ f y`. Backward: monotonicity makes the preimage of any up-set an up-set
directly. This is the equivalence Alexandrov spaces `≅` preorders. -/
theorem continuous_iff_monotone (T S : AlexandrovTopology)
    (f : T.poset.carrier → S.poset.carrier) :
    Continuous T S f ↔ IsMonotone T S f := by
  constructor
  · intro hf x y hxy
    -- preimage of the principal up-set `↑(f x)` of `S` is open in `P`; it holds at `x`
    -- (reflexivity), so the up-set property of the preimage propagates it to `y`.
    have hpre : T.IsOpen (fun z => S.upperSet (f x) (f z)) :=
      hf (S.upperSet (f x)) (S.isOpen_upperSet (f x))
    exact hpre (S.mem_upperSet_self (f x)) hxy
  · intro hf V hV x y hxV hxy
    -- preimage of an up-set `V` is an up-set: from `V (f x)` and `f x ≤ f y` (monotone),
    -- the up-set `V` gives `V (f y)`.
    exact hV hxV (hf hxy)

/-! ## The Alexandrov topology recovers the poset (and continuous = monotone)

The opens are exactly the up-sets, **closed under arbitrary intersection** (the defining
Alexandrov property) and arbitrary union; the **specialization order recovers `≤`**; and
**continuous = monotone**. Together this is the poset `≅` Alexandrov-space correspondence. -/

/-- **The Alexandrov topology recovers the poset.** For the Alexandrov topology
`T` of a poset `(P, ≤)`:

* (opens are up-sets) `T.IsOpen U = IsUpSet P U` — the opens are exactly the up-sets;
* (Alexandrov property) the opens are closed under **arbitrary** intersection
  `⋂ᵢ Uᵢ` and arbitrary union `⋃ᵢ Uᵢ`, plus `∅`/`univ` — the *arbitrary*-intersection
  closure that distinguishes Alexandrov topologies;
* (specialization recovers `≤`) `T.specializes x y ↔ P.le x y`, and as predicates
  `T.specializes = P.le` — the poset is recovered from its Alexandrov space;
* (continuous = monotone) for any second Alexandrov space `S` and map `f`,
  `Continuous T S f ↔ IsMonotone T S f`.

This is the classical equivalence Alexandrov spaces `≅` preorders, proven for our derived
poset infrastructure. -/
theorem alexandrov_specialization_recovers_poset (T : AlexandrovTopology) :
    -- opens are exactly the up-sets
    (∀ U : Opens T.poset, T.IsOpen U = IsUpSet T.poset U)
    -- the Alexandrov property: arbitrary intersection of opens is open
    ∧ (∀ {ι : Type} (U : ι → Opens T.poset), (∀ i, T.IsOpen (U i)) →
        T.IsOpen (fun z => ∀ i, U i z))
    -- arbitrary union of opens is open
    ∧ (∀ {ι : Type} (U : ι → Opens T.poset), (∀ i, T.IsOpen (U i)) →
        T.IsOpen (fun z => ∃ i, U i z))
    -- ∅ and univ are open
    ∧ (T.IsOpen (fun _ => False) ∧ T.IsOpen (fun _ => True))
    -- the specialization order recovers ≤ (pointwise and as predicates)
    ∧ (∀ x y, T.specializes x y ↔ T.poset.le x y)
    ∧ (T.specializes = T.poset.le)
    -- continuous = monotone for any target Alexandrov space
    ∧ (∀ (S : AlexandrovTopology) (f : T.poset.carrier → S.poset.carrier),
        Continuous T S f ↔ IsMonotone T S f) :=
  ⟨fun _ => rfl,
    fun U hU => T.isOpen_iInter U hU,
    fun U hU => T.isOpen_iUnion U hU,
    ⟨T.isOpen_empty, T.isOpen_univ⟩,
    fun x y => T.specializes_iff_le x y,
    T.specializes_eq_le,
    fun S f => continuous_iff_monotone T S f⟩

/-! ## Connected open regions

The connectedness notion here is topological connectedness internal to the Alexandrov topology,
not graph edge-connectedness. A subset `U` is connected when it is nonempty and every partition
of `U` into two disjoint, nonempty, relatively-open subsets is impossible. -/

/-- A subset of an Alexandrov space is nonempty. -/
def SetNonempty (T : AlexandrovTopology) (U : Opens T.poset) : Prop :=
  ∃ x, U x

/-- A subset `A` of `U` is relatively open when it is the intersection of `U` with an open set. -/
def RelativelyOpen (T : AlexandrovTopology) (U A : Opens T.poset) : Prop :=
  ∃ V : Opens T.poset, T.IsOpen V ∧ ∀ x, A x ↔ U x ∧ V x

/-- Two subsets are disjoint. -/
def DisjointSubsets {P : Order.PartialOrder} (A B : Opens P) : Prop :=
  ∀ x, ¬ (A x ∧ B x)

/-- Two subsets cover a parent subset. -/
def CoversSubset {P : Order.PartialOrder} (U A B : Opens P) : Prop :=
  ∀ x, U x ↔ A x ∨ B x

/-- Topological connectedness of a subset of an Alexandrov space.

This is the standard separation definition, stated directly for the local `Opens`
representation: `U` is nonempty, and no two disjoint nonempty relatively-open subsets cover
`U`. -/
def IsConnected (T : AlexandrovTopology) (U : Opens T.poset) : Prop :=
  SetNonempty T U ∧
    ∀ A B : Opens T.poset,
      RelativelyOpen T U A →
      RelativelyOpen T U B →
      DisjointSubsets A B →
      CoversSubset U A B →
      ¬ SetNonempty T A ∨ ¬ SetNonempty T B

/-- Connectedness is invariant under pointwise equality of subsets. -/
theorem isConnected_congr (T : AlexandrovTopology) {U V : Opens T.poset}
    (hUV : ∀ x, U x ↔ V x) (hU : IsConnected T U) : IsConnected T V := by
  constructor
  · obtain ⟨x, hx⟩ := hU.1
    exact ⟨x, (hUV x).mp hx⟩
  · intro A B hA hB hdisj hcover
    rcases hA with ⟨VA, hVA, hAiff⟩
    rcases hB with ⟨VB, hVB, hBiff⟩
    have hArelU : RelativelyOpen T U A := by
      refine ⟨VA, hVA, ?_⟩
      intro x
      constructor
      · intro hx
        have hVx : V x ∧ VA x := (hAiff x).mp hx
        exact ⟨(hUV x).mpr hVx.1, hVx.2⟩
      · intro hx
        exact (hAiff x).mpr ⟨(hUV x).mp hx.1, hx.2⟩
    have hBrelU : RelativelyOpen T U B := by
      refine ⟨VB, hVB, ?_⟩
      intro x
      constructor
      · intro hx
        have hVx : V x ∧ VB x := (hBiff x).mp hx
        exact ⟨(hUV x).mpr hVx.1, hVx.2⟩
      · intro hx
        exact (hBiff x).mpr ⟨(hUV x).mp hx.1, hx.2⟩
    have hcoverU : CoversSubset U A B := by
      intro x
      exact (hUV x).trans (hcover x)
    exact hU.2 A B hArelU hBrelU hdisj hcoverU

/-- A singleton is connected in an Alexandrov topology: a one-point set admits no
nontrivial separation at all, since any relatively-open piece containing the point is
disjoint from (hence forces the emptiness of) whichever piece does not. The trivial base
case alongside `isConnected_upperSet`. -/
theorem isConnected_singleton (T : AlexandrovTopology) (a : T.poset.carrier) :
    IsConnected T (fun x => x = a) := by
  constructor
  · exact ⟨a, rfl⟩
  · intro A B hA hB hdisj hcover
    rcases hA with ⟨VA, hVA, hAiff⟩
    rcases hB with ⟨VB, hVB, hBiff⟩
    rcases (hcover a).mp rfl with haA | haB
    · right
      rintro ⟨x, hx⟩
      have hxa : x = a := ((hBiff x).mp hx).1
      rw [hxa] at hx
      exact hdisj a ⟨haA, hx⟩
    · left
      rintro ⟨x, hx⟩
      have hxa : x = a := ((hAiff x).mp hx).1
      rw [hxa] at hx
      exact hdisj a ⟨hx, haB⟩

/-- A principal up-set is connected in an Alexandrov topology. -/
theorem isConnected_upperSet (T : AlexandrovTopology) (a : T.poset.carrier) :
    IsConnected T (T.upperSet a) := by
  constructor
  · exact ⟨a, T.mem_upperSet_self a⟩
  · intro A B hA hB hdisj hcover
    rcases hA with ⟨VA, hVA, hAiff⟩
    rcases hB with ⟨VB, hVB, hBiff⟩
    rcases (hcover a).mp (T.mem_upperSet_self a) with haA | haB
    · have hBempty : ¬ SetNonempty T B := by
        intro hBn
        obtain ⟨b, hb⟩ := hBn
        have hbUpper : T.upperSet a b := ((hBiff b).mp hb).1
        have hVAa : VA a := ((hAiff a).mp haA).2
        have hVAb : VA b := hVA hVAa hbUpper
        have hAb : A b := (hAiff b).mpr ⟨hbUpper, hVAb⟩
        exact hdisj b ⟨hAb, hb⟩
      exact Or.inr hBempty
    · have hAempty : ¬ SetNonempty T A := by
        intro hAn
        obtain ⟨a', ha'⟩ := hAn
        have ha'Upper : T.upperSet a a' := ((hAiff a').mp ha').1
        have hVBa : VB a := ((hBiff a).mp haB).2
        have hVBa' : VB a' := hVB hVBa ha'Upper
        have hBa' : B a' := (hBiff a').mpr ⟨ha'Upper, hVBa'⟩
        exact hdisj a' ⟨ha', hBa'⟩
      exact Or.inl hAempty

/-- A connected cofinal subset connects the whole parent subset.

If `K` is connected, lies inside `U`, and every point of `U` lies below some
point of `K`, then no separation of `U` can split off a nonempty part: relative
openness propagates each point upward to its `K`-anchor. -/
theorem isConnected_of_connected_cofinal_subset (T : AlexandrovTopology)
    {U K : Opens T.poset}
    (hK : IsConnected T K)
    (hKsub : ∀ x, K x → U x)
    (hcofinal : ∀ x, U x → ∃ k, K k ∧ T.poset.le x k) :
    IsConnected T U := by
  constructor
  · obtain ⟨k, hk⟩ := hK.1
    exact ⟨k, hKsub k hk⟩
  · intro A B hA hB hdisj hcover
    rcases hA with ⟨VA, hVA, hAiff⟩
    rcases hB with ⟨VB, hVB, hBiff⟩
    have hAKrel : RelativelyOpen T K (fun x => K x ∧ A x) := by
      refine ⟨VA, hVA, ?_⟩
      intro x
      constructor
      · intro hx
        exact ⟨hx.1, ((hAiff x).mp hx.2).2⟩
      · intro hx
        exact ⟨hx.1, (hAiff x).mpr ⟨hKsub x hx.1, hx.2⟩⟩
    have hBKrel : RelativelyOpen T K (fun x => K x ∧ B x) := by
      refine ⟨VB, hVB, ?_⟩
      intro x
      constructor
      · intro hx
        exact ⟨hx.1, ((hBiff x).mp hx.2).2⟩
      · intro hx
        exact ⟨hx.1, (hBiff x).mpr ⟨hKsub x hx.1, hx.2⟩⟩
    have hKdisj : DisjointSubsets (fun x => K x ∧ A x) (fun x => K x ∧ B x) := by
      intro x hx
      exact hdisj x ⟨hx.1.2, hx.2.2⟩
    have hKcover : CoversSubset K (fun x => K x ∧ A x) (fun x => K x ∧ B x) := by
      intro x
      constructor
      · intro hx
        rcases (hcover x).mp (hKsub x hx) with hAx | hBx
        · exact Or.inl ⟨hx, hAx⟩
        · exact Or.inr ⟨hx, hBx⟩
      · intro hx
        rcases hx with hAx | hBx
        · exact hAx.1
        · exact hBx.1
    have hA_to_AK :
        SetNonempty T A → SetNonempty T (fun x => K x ∧ A x) := by
      intro hAn
      obtain ⟨a, ha⟩ := hAn
      have hUa : U a := ((hAiff a).mp ha).1
      have hVAa : VA a := ((hAiff a).mp ha).2
      obtain ⟨k, hk, hak⟩ := hcofinal a hUa
      have hVAk : VA k := hVA hVAa hak
      exact ⟨k, hk, (hAiff k).mpr ⟨hKsub k hk, hVAk⟩⟩
    have hB_to_BK :
        SetNonempty T B → SetNonempty T (fun x => K x ∧ B x) := by
      intro hBn
      obtain ⟨b, hb⟩ := hBn
      have hUb : U b := ((hBiff b).mp hb).1
      have hVBb : VB b := ((hBiff b).mp hb).2
      obtain ⟨k, hk, hbk⟩ := hcofinal b hUb
      have hVBk : VB k := hVB hVBb hbk
      exact ⟨k, hk, (hBiff k).mpr ⟨hKsub k hk, hVBk⟩⟩
    rcases hK.2 (fun x => K x ∧ A x) (fun x => K x ∧ B x)
        hAKrel hBKrel hKdisj hKcover with hAempty | hBempty
    · exact Or.inl (fun hAn => hAempty (hA_to_AK hAn))
    · exact Or.inr (fun hBn => hBempty (hB_to_BK hBn))

/-- A general topological region: a nonempty, open, connected subset of an Alexandrov poset. -/
def Region (T : AlexandrovTopology) : Type :=
  { U : Opens T.poset // T.IsOpen U ∧ IsConnected T U }

namespace Region

variable {T : AlexandrovTopology} (R : Region T)

/-- The underlying open set of a topological region is open. -/
theorem isOpen : T.IsOpen R.val := R.property.1

/-- A topological region is connected. -/
theorem connected : IsConnected T R.val := R.property.2

/-- A topological region is nonempty. -/
theorem nonempty : SetNonempty T R.val := R.property.2.1

end Region

/-! ## Husainov acyclicity — the Čech vs derived-functor comparison

`…/husainov-acyclicity.md`: on an Alexandrov-topology poset, Čech cohomology *agrees with the
derived-functor sheaf cohomology of the sheafification* exactly when the poset's
**Dedekind–MacNeille cuts** are acyclic — a necessary-and-sufficient condition, algorithmically
computable for finite posets ([@husainov2026]).

What this core establishes is the **Čech-side** statement alone: on the bounded sub-sites the
Čech `H¹` of every cover vanishes. It says nothing about the derived functor. The comparison `Ȟⁿ(F_U) ≅ RⁿΓ(F_U)` is the load-bearing content of Husainov's theorem, and
`RⁿΓ(F_U)` — the right-derived functors of global sections, built from an injective or flasque
resolution of `F_U` — is heavier machinery than this dependency-free core constructs. We do
**not** model the derived functor by the Čech computation. The comparison is left open and
recorded as a red node in the blueprint (`thm:husainov-cech-derived`); see the chapter note
there for why no in-Lean statement is available without that machinery. -/

/-- **Čech `H¹` vanishing for every cover.** Every agreeing family of local `F_U`-sections
glues to a unique global section (`Cohomology.h1_vanishes`), so the Čech `H¹` of every cover
vanishes — unconditionally in this model. This is the Čech specialization of Husainov's
acyclicity hypothesis, *not* the full Dedekind–MacNeille-cut criterion. -/
def CechAcyclic : Prop := ∀ D : Cohomology.Cech1, Cohomology.H1Vanishes D

/-- The Čech `H¹` of every cover vanishes, directly from the gluing theorem. -/
theorem cechAcyclic : CechAcyclic := fun D => Cohomology.h1_vanishes D

/-- **Čech cohomology vanishes on the bounded sub-sites.** For a regime `r` whose cohomology
vanishes (`cohomologyVanishes r = true`, i.e. `r` is `strict` or `scott`): the Čech `H¹` of
every cover vanishes (`CechAcyclic`), Čech cohomology is trivial above degree one
(`Cohomology.hn_vanishes_above_one`), and `r` is `strict`/`scott`.

This claims only the **Čech** computation; it asserts nothing about derived-functor
cohomology. (The Čech vanishing is unconditional here — the regime governs the *general*
dichotomy, where `H¹` can be nonzero in the non-Scott regimes.) -/
theorem husainov_cech_acyclic_on_bounded_sites (r : ClosureRegime)
    (hr : Obsmetrologia.cohomologyVanishes r = true) :
    CechAcyclic
    ∧ (∀ n : Nat, 2 ≤ n → ∀ x y : Cohomology.Hn n, x = y)
    ∧ (r = ClosureRegime.strict ∨ r = ClosureRegime.scott) :=
  ⟨cechAcyclic, Cohomology.hn_vanishes_above_one, (Obsmetrologia.cohomologyVanishes_iff r).mp hr⟩

end Alexandrov
end Obsmetrologia
