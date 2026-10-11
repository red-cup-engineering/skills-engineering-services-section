import Obsmetrologia.Cohomology.SettlingCohomologyH1
import Obsmetrologia.Calculus.Order.SetNumberGraphTheory

/-!
# Coordination cohomology — the cover-nerve Čech `Ȟ¹` as coordination cost

This certifies the corpus construction
`…/settling/monotonicity-certificate.mts` (+ its `cohomology.mts`): for a federated
cover, each logical cell builds the **source–stance bipartite nerve**, and the
**coordination cost** of that cell is the rank of `Ȟ¹` of the nerve. The shipped
`cohomologyOfCells` computes, over the integer incidence matrix:

* `Ȟ⁰` = the number of **connected components** (union-find over the 0-cells / entities),
  the global-section dimension;
* `Ȟ¹` = the **cycle rank** `|E| − |V| + |C|` (cells − entities + components), the number
  of independent gluing obstructions;
* the **Laplacian view** `L = δ⁰ᵀ δ⁰` recovers both as kernel/cokernel ranks around the
  incidence rank `ρ`: `Ȟ⁰ = |V| − ρ`, `Ȟ¹ = |E| − ρ`.

## What is proved here (faithful scope)

The shipped invariant is the **Euler/cycle-rank** of the nerve. We carry a nerve by its
three counts together with the **union-find invariant** the shipped component count
guarantees (`|V| ≤ |E| + |C|`: starting from `|V|` singleton components, each of the `|E|`
cells merges at most one pair, so at least `|V| − |E|` components survive), and prove:

* **(the iff, direction (1))** `Ȟ¹ = 0 ⟺ |V| = |E| + |C|` — the obstruction vanishes **iff
  the nerve is a forest** (Euler characteristic equals the component count). This is the
  discrete/finite form of "a family of local sections glues to a monotone
  (CALM / coordination-free) global section **iff** its Čech class `[δs] ∈ Ȟ¹` is zero":
  `Ȟ¹` carries no cycle exactly when the source–stance nerve is acyclic;
* **(rank = coordination cost, corollary)** `Ȟ¹ = |E| − (|V| − |C|)` counts the cells in
  excess of a spanning forest — the irreducible coordination obstructions, each a cell that
  needs a total order; coordination-free ⟺ `Ȟ¹ = 0`;
* **(the connected witness, fully graph-backed)** a finite **tree** (`Discrete.FinTree`,
  with its spanning identity `|E| + 1 = |V|`) has `Ȟ¹ = 0` — `tree_coordination_free`, with
  no assumed invariant: `edge_count` supplies everything;
* **(the Laplacian dual)** `Ȟ⁰ = |V| − ρ` (kernel) and `Ȟ¹ = |E| − ρ` (cokernel) around the
  incidence rank `ρ = |V| − |C|` — matching the shipped `cohomologyLaplacian` rank
  identities; `Ȟ⁰ = |C|` is the harmonic / `ker L` side
  (`LawvereLaplacian.IsHarmonic`, `LawvereHarmonicCohomology`), `Ȟ¹` its dual.

## Frontier

The incidence graph below now derives the general component count and spanning
bound. The remaining open piece is the **value-level converse** — that a cycle (`Ȟ¹ ≠ 0`) actually *obstructs* a
  monotone global section unless a total order is imposed on the cycle's cells — beyond the
  rank count. The existence half (an agreeing family over an acyclic cover glues) is the
  settling sheaf model's `Cohomology.h1_vanishes`, cited below.
-/

namespace Obsmetrologia
namespace Cohomology

open Obsmetrologia.AssocSheaf (Cochain)

/-! ## Indexed cover incidence -/

/-- A Čech datum together with the finite cells on which overlap is observed. -/
structure IndexedCoverIncidence where
  datum : Cech1
  observedCells : List PredicationCell

namespace IndexedCoverIncidence

abbrev Vertex (I : IndexedCoverIncidence) :=
  Fin I.datum.cover.patches.length

def patch (I : IndexedCoverIncidence) (i : I.Vertex) : PredicationCell → Bool :=
  I.datum.cover.patches.get i

private def cleanFinRange (n : Nat) : List (Fin n) :=
  Fin.foldr n (fun i acc => i :: acc) []

private theorem foldLoopKeepsMem {n i : Nat} (h : i ≤ n)
    (acc : List (Fin n)) {x : Fin n} (hx : x ∈ acc) :
    x ∈ Fin.foldr.loop n (fun j rest => j :: rest) i h acc := by
  induction i generalizing acc with
  | zero => exact hx
  | succ i ih =>
      change x ∈ Fin.foldr.loop n (fun j rest => j :: rest) i
        (Nat.le_of_lt h) (⟨i, h⟩ :: acc)
      exact ih (Nat.le_of_lt h) (⟨i, h⟩ :: acc) (List.Mem.tail _ hx)

private theorem foldLoopLength {n i : Nat} (h : i ≤ n)
    (acc : List (Fin n)) :
    (Fin.foldr.loop n (fun j rest => j :: rest) i h acc).length =
      i + acc.length := by
  induction i generalizing acc with
  | zero =>
      change acc.length = 0 + acc.length
      exact (Nat.zero_add acc.length).symm
  | succ i ih =>
      change (Fin.foldr.loop n (fun j rest => j :: rest) i
        (Nat.le_of_lt h) (⟨i, h⟩ :: acc)).length =
        Nat.succ i + acc.length
      exact Eq.trans (ih (Nat.le_of_lt h) (⟨i, h⟩ :: acc))
        (Eq.trans (Nat.add_succ i acc.length)
          (Nat.succ_add i acc.length).symm)

private theorem foldLoopComplete {n i : Nat} (h : i ≤ n)
    (acc : List (Fin n)) (x : Fin n) (hx : x.val < i) :
    x ∈ Fin.foldr.loop n (fun j rest => j :: rest) i h acc := by
  induction i generalizing acc with
  | zero => exact False.elim (Nat.not_lt_zero x.val hx)
  | succ i ih =>
      change x ∈ Fin.foldr.loop n (fun j rest => j :: rest) i
        (Nat.le_of_lt h) (⟨i, h⟩ :: acc)
      by_cases heq : x.val = i
      · apply foldLoopKeepsMem
        have hfin : x = (⟨i, h⟩ : Fin n) := Fin.ext heq
        exact hfin ▸ List.Mem.head acc
      · apply ih
        exact Nat.lt_of_le_of_ne (Nat.le_of_lt_succ hx) heq

private theorem foldLoopNodup {n i : Nat} (h : i ≤ n)
    (acc : List (Fin n)) (hnodup : acc.Nodup)
    (habove : ∀ x, x ∈ acc → i ≤ x.val) :
    (Fin.foldr.loop n (fun j rest => j :: rest) i h acc).Nodup := by
  induction i generalizing acc with
  | zero => exact hnodup
  | succ i ih =>
      change (Fin.foldr.loop n (fun j rest => j :: rest) i
        (Nat.le_of_lt h) (⟨i, h⟩ :: acc)).Nodup
      apply ih
      · apply List.Pairwise.cons
        · intro x hx heq
          have hbound : Nat.succ i ≤ x.val := habove x hx
          have hval : i = x.val := congrArg Fin.val heq
          exact Nat.not_succ_le_self i (hval ▸ hbound)
        · exact hnodup
      · intro x hx
        cases hx with
        | head => exact Nat.le_refl i
        | tail _ ht => exact Nat.le_trans (Nat.le_succ i) (habove x ht)

private theorem cleanFinRangeComplete (n : Nat) (x : Fin n) :
    x ∈ cleanFinRange n :=
  foldLoopComplete (Nat.le_refl n) [] x x.isLt

private theorem cleanFinRangeLength (n : Nat) :
    (cleanFinRange n).length = n := by
  exact Eq.trans (foldLoopLength (Nat.le_refl n) []) (Nat.add_zero n)

private theorem cleanFinRangeNodup (n : Nat) : (cleanFinRange n).Nodup := by
  apply foldLoopNodup (Nat.le_refl n) [] List.Pairwise.nil
  intro _ h
  nomatch h

def vertices (I : IndexedCoverIncidence) : List I.Vertex :=
  cleanFinRange I.datum.cover.patches.length

theorem vertices_nodup (I : IndexedCoverIncidence) : I.vertices.Nodup := by
  exact cleanFinRangeNodup I.datum.cover.patches.length

theorem vertices_complete (I : IndexedCoverIncidence) (i : I.Vertex) :
    i ∈ I.vertices := by
  exact cleanFinRangeComplete I.datum.cover.patches.length i

def overlaps (I : IndexedCoverIncidence) (i j : I.Vertex) : Bool :=
  I.observedCells.any (fun cell => I.patch i cell && I.patch j cell)

theorem overlaps_comm (I : IndexedCoverIncidence) (i j : I.Vertex) :
    I.overlaps i j = I.overlaps j i := by
  unfold overlaps
  congr 1
  funext cell
  exact Bool.and_comm _ _

theorem overlaps_true_iff (I : IndexedCoverIncidence) (i j : I.Vertex) :
    I.overlaps i j = true ↔ ∃ cell, cell ∈ I.observedCells ∧
      I.patch i cell = true ∧ I.patch j cell = true := by
  simp [overlaps, List.any_eq_true]

def canonicalEndpoints (I : IndexedCoverIncidence) (i j : I.Vertex) :
    I.Vertex × I.Vertex :=
  if i.val < j.val then (i, j) else (j, i)

theorem canonicalEndpoints_comm (I : IndexedCoverIncidence)
    (i j : I.Vertex) (hne : i ≠ j) :
    I.canonicalEndpoints i j = I.canonicalEndpoints j i := by
  unfold canonicalEndpoints
  by_cases hij : i.val < j.val
  · have hji : ¬j.val < i.val := by omega
    simp [hij, hji]
  · have hji : j.val < i.val := by
      have : i.val ≠ j.val := by
        intro h
        apply hne
        exact Fin.ext h
      omega
    simp [hij, hji]

def overlapIncidence (I : IndexedCoverIncidence) (i j : I.Vertex) : Bool :=
  decide (i.val < j.val) && I.overlaps i j

def finiteIndexedCoverGraph (I : IndexedCoverIncidence) :
    Discrete.Graph.FinGraph I.Vertex where
  graph := I.overlapIncidence
  verts := I.vertices

def exactPresentation (I : IndexedCoverIncidence) :
    I.finiteIndexedCoverGraph.ExactPresentation where
  verts_nodup := I.vertices_nodup
  verts_complete := I.vertices_complete

theorem finiteIndexedCoverGraph_verts_nodup (I : IndexedCoverIncidence) :
    I.finiteIndexedCoverGraph.verts.Nodup := I.vertices_nodup

theorem finiteIndexedCoverGraph_verts_complete (I : IndexedCoverIncidence) :
    ∀ i, i ∈ I.finiteIndexedCoverGraph.verts := I.vertices_complete

theorem overlapIncidence_true_iff (I : IndexedCoverIncidence) (i j : I.Vertex) :
    I.overlapIncidence i j = true ↔ i.val < j.val ∧
      ∃ cell, cell ∈ I.observedCells ∧ I.patch i cell = true ∧
        I.patch j cell = true := by
  simp [overlapIncidence, overlaps_true_iff]

theorem reversedOrientationIsSameEdge (I : IndexedCoverIncidence)
    (i j : I.Vertex) (hne : i ≠ j) :
    let endpoints := I.canonicalEndpoints i j
    I.overlapIncidence endpoints.1 endpoints.2 = I.overlaps i j := by
  unfold canonicalEndpoints
  by_cases hij : i.val < j.val
  · simp [hij, overlapIncidence]
  · have hji : j.val < i.val := by
      have : i.val ≠ j.val := by
        intro h
        exact hne (Fin.ext h)
      omega
    simp [hij, hji, overlapIncidence, I.overlaps_comm]

theorem duplicateOverlapWitnessCountsOnce (I : IndexedCoverIncidence)
    (cell : PredicationCell) :
    (finiteIndexedCoverGraph
      { I with observedCells := cell :: cell :: I.observedCells }).graph =
    (finiteIndexedCoverGraph
      { I with observedCells := cell :: I.observedCells }).graph := by
  funext i j
  simp only [finiteIndexedCoverGraph, overlapIncidence, overlaps, patch,
    List.any_cons]
  rw [← Bool.or_assoc, Bool.or_self]

abbrev componentPartition (I : IndexedCoverIncidence) :=
  I.finiteIndexedCoverGraph.derivedComponents I.exactPresentation

def componentRepresentatives (I : IndexedCoverIncidence) : List I.Vertex :=
  I.componentPartition.representatives

def cycleRank (I : IndexedCoverIncidence) : Nat :=
  I.finiteIndexedCoverGraph.ecard + I.componentRepresentatives.length -
    I.finiteIndexedCoverGraph.vcard

theorem cycleRank_subtraction_is_nontruncated (I : IndexedCoverIncidence) :
    I.finiteIndexedCoverGraph.vcard ≤ I.finiteIndexedCoverGraph.ecard +
      I.componentRepresentatives.length :=
  I.finiteIndexedCoverGraph.derivedComponents_spanning_bound I.exactPresentation

end IndexedCoverIncidence

/-! ## The cover nerve as its Euler counts -/

/-- The **cover nerve** of one logical cell of a federated cover, carried by the three
counts the shipped `cohomologyOfCells` reduces to: `entities` = the 0-cells `|V|`, `cells`
= the 1-cells `|E|`, `components` = the connected components `|C|` (`Ȟ⁰`, union-find). The
two fields are the **union-find invariant** the shipped component count guarantees: every
component meets ≥ 1 vertex (`components ≤ entities`), and each of the `cells` edges merges at
most one component so at least `entities − cells` survive (`entities ≤ cells + components`).
For a tree these are *derived*, not assumed — see `ofTree`. -/
structure CoverNerve where
  /-- `|V|` — the entity 0-cells of the nerve. -/
  entities : Nat
  /-- `|E|` — the source–stance 1-cells of the nerve. -/
  cells : Nat
  /-- `|C|` — the connected components (`Ȟ⁰`, union-find over the entities). -/
  components : Nat
  /-- Every component contains at least one entity. -/
  components_le_entities : components ≤ entities
  /-- The spanning-forest bound: `|V| ≤ |E| + |C|` (each cell merges ≤ 1 component). -/
  entities_le_cells_add_components : entities ≤ cells + components

namespace CoverNerve

/-- **`Ȟ⁰` — the component count.** The global-section dimension of the nerve: the number of
independent stances the cover already agrees on (the kernel side of the incidence Laplacian). -/
def H0rank (N : CoverNerve) : Nat := N.components

/-- **`Ȟ¹` — the cycle rank `|E| − |V| + |C|`.** Exactly the shipped `cohomologyOfCells`
first-cohomology rank (`magnitude (|E| − |V| + |C|)`); the union-find invariant makes the
truncated subtraction exact. The number of independent coordination obstructions. -/
def H1rank (N : CoverNerve) : Nat := (N.cells + N.components) - N.entities

/-- **Coordination-free** (CALM / monotone): the nerve carries no gluing obstruction. -/
def CoordinationFree (N : CoverNerve) : Prop := N.H1rank = 0

/-! ## The iff — direction (1) -/

/-- **The coordination–cohomology iff (discrete/finite).** `Ȟ¹ = 0` **iff** the nerve is a
**forest** `|V| = |E| + |C|` (Euler characteristic = component count). This is the shipped
form of "a family of local sections glues to a coordination-free global section iff its Čech
class `[δs] ∈ Ȟ¹` vanishes": the obstruction rank is zero exactly when the source–stance
nerve is acyclic. -/
theorem h1_vanishes_iff_forest (N : CoverNerve) :
    N.H1rank = 0 ↔ N.entities = N.cells + N.components := by
  have h1 := N.entities_le_cells_add_components
  have h2 := N.components_le_entities
  unfold H1rank
  constructor
  · intro h; omega
  · intro h; omega

/-- **`CoordinationFree` is exactly the forest/acyclic nerve.** Restatement of the iff at the
named predicate. -/
theorem coordinationFree_iff_forest (N : CoverNerve) :
    N.CoordinationFree ↔ N.entities = N.cells + N.components :=
  h1_vanishes_iff_forest N

/-! ## Rank = coordination cost (corollary) -/

/-- **Rank `Ȟ¹` = coordination cost.** The obstruction rank is the count of cells in excess
of a spanning forest, `|E| − (|V| − |C|)` — the independent cycles, each an irreducible
coordination obstruction (a cell needing a total order). Together with the vanishing iff this
is "rank `Ȟ¹` counts the irreducible coordination obstructions, the nonzero classes the cells
needing a total order." -/
theorem h1rank_is_coordination_cost (N : CoverNerve) :
    N.H1rank = N.cells - (N.entities - N.components)
    ∧ (N.H1rank = 0 ↔ N.entities = N.cells + N.components) := by
  refine ⟨?_, h1_vanishes_iff_forest N⟩
  have h1 := N.entities_le_cells_add_components
  have h2 := N.components_le_entities
  unfold H1rank
  omega

/-! ## The Laplacian dual: `Ȟ⁰ = ker`, `Ȟ¹ = coker` -/

/-- **The Laplacian kernel/cokernel identities.** With the incidence rank `ρ = |V| − |C|`,
`Ȟ⁰ = |V| − ρ` (the kernel of the incidence Laplacian `L = δ⁰ᵀδ⁰`) and `Ȟ¹ = |E| − ρ` (its
cokernel) — the shipped `cohomologyLaplacian` rank identities `zeroCohomologyKernelRank` /
`firstCohomologyCokernelRank`. So `Ȟ⁰ = |C|` is the harmonic / `ker L` side
(`LawvereLaplacian.IsHarmonic`, `LawvereHarmonicCohomology`) and `Ȟ¹` is its dual. -/
theorem laplacian_kernel_cokernel (N : CoverNerve) :
    N.H0rank = N.entities - (N.entities - N.components)
    ∧ N.H1rank = N.cells - (N.entities - N.components) := by
  have h1 := N.entities_le_cells_add_components
  have h2 := N.components_le_entities
  unfold H0rank H1rank
  refine ⟨?_, ?_⟩
  · omega
  · omega

end CoverNerve

/-- The cover nerve whose counts are all derived from observed patch incidence. -/
def CoverNerve.ofIndexedCoverIncidence (I : IndexedCoverIncidence) : CoverNerve where
  entities := I.finiteIndexedCoverGraph.vcard
  cells := I.finiteIndexedCoverGraph.ecard
  components := I.componentRepresentatives.length
  components_le_entities := by
    have hcount := I.finiteIndexedCoverGraph.derivedComponents_block_count
      I.exactPresentation
    change I.componentRepresentatives.length +
      (I.finiteIndexedCoverGraph.componentFoldPrefix
        I.finiteIndexedCoverGraph.edges).successfulMerges =
      I.finiteIndexedCoverGraph.vcard at hcount
    exact Nat.le_trans
      (Nat.le_add_right I.componentRepresentatives.length
        (I.finiteIndexedCoverGraph.componentFoldPrefix
          I.finiteIndexedCoverGraph.edges).successfulMerges)
      (Nat.le_of_eq hcount)
  entities_le_cells_add_components :=
    I.cycleRank_subtraction_is_nontruncated

@[simp] theorem coverNerve_entities_from_incidence (I : IndexedCoverIncidence) :
    (CoverNerve.ofIndexedCoverIncidence I).entities =
      I.datum.cover.patches.length := by
  exact IndexedCoverIncidence.cleanFinRangeLength
    I.datum.cover.patches.length

@[simp] theorem coverNerve_cells_from_incidence (I : IndexedCoverIncidence) :
    (CoverNerve.ofIndexedCoverIncidence I).cells =
      I.finiteIndexedCoverGraph.ecard := rfl

@[simp] theorem coverNerve_components_from_incidence (I : IndexedCoverIncidence) :
    (CoverNerve.ofIndexedCoverIncidence I).components =
      I.componentRepresentatives.length := rfl

theorem coverNerve_h1_from_incidence (I : IndexedCoverIncidence) :
    (CoverNerve.ofIndexedCoverIncidence I).H1rank = I.cycleRank := rfl

/-! ## The connected witness — a finite tree is coordination-free (fully graph-backed) -/

/-- The cover nerve of a finite **tree**: its vertices, edges, and the single component, with
the union-find invariant *derived* from the tree's spanning identity `|E| + 1 = |V|` (no
assumption). -/
def CoverNerve.ofTree {V : Type} [DecidableEq V] (T : Obsmetrologia.Discrete.Graph.FinTree V) : CoverNerve where
  entities := T.fin.vcard
  cells := T.fin.ecard
  components := 1
  components_le_entities := by have := T.edge_count; omega
  entities_le_cells_add_components := by have := T.edge_count; omega

/-- **Every tree-cover is coordination-free.** A finite tree's source–stance nerve has
`Ȟ¹ = 0`: the spanning identity `|E| + 1 = |V|` (`Discrete.FinTree.edge_count`) forces the
cycle rank to vanish. The fully graph-backed, assumption-free witness of the iff on the
connected, acyclic case. -/
theorem tree_coordination_free {V : Type} [DecidableEq V] (T : Obsmetrologia.Discrete.Graph.FinTree V) :
    (CoverNerve.ofTree T).H1rank = 0 := by
  have h := T.edge_count
  show (T.fin.ecard + 1) - T.fin.vcard = 0
  omega

/-! ## The sheaf-gluing side — the existence half, cited from the settling sheaf model -/

/-- **An agreeing family over a cover glues (existence).** The settling sheaf model already
proves the existence half of "glues ⟺ `[δs] = 0`": every 1-cocycle (agreeing family) over a
cover is a coboundary — it glues to a global `F_U`-section, uniquely (`Cohomology.h1_vanishes`).
This is the coordination-free direction; the combinatorial obstruction *rank* of the same
cover is `CoverNerve.H1rank` above, vanishing exactly on the forest case. -/
theorem agreeing_family_glues (D : Cech1) (h : Cocycle D) :
    (∃ g : Cochain, Coboundary D g) ∧ (∀ g g' : Cochain, Coboundary D g → Coboundary D g' → g = g') :=
  h1_vanishes D h

end Cohomology
end Obsmetrologia
