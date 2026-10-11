import Obsmetrologia.QuantumContextuality.MeasurementScenario
import Obsmetrologia.Cohomology.CoordinationCohomology
import Obsmetrologia.Language.Positing.Record

/-! # Cohomological contextuality for parity (XOR-constraint) measurement scenarios

`QuantumContextuality.SupportContextuality` notes that the single-section Čech `H¹` of
`Cohomology.SettlingCohomologyH1` is vacuous for measurement scenarios (`Cohomology.h1_vanishes`
makes every single-valued sheaf flasque) and that the Abramsky–Mansfield–Barbosa cohomological
obstruction instead lives in the relative cohomology of a ℤ-linear sheaf of sections, left there
as a research-grade target. This module discharges the **parity** case of that target:
measurement scenarios whose contexts are all two-element and whose support is a fixed
required-XOR pattern per context (`ParityModel`) — the shape of the PR box, GHZ, and Mermin
all-versus-nothing arguments. For this case the obstruction is an ordinary Čech `H¹` of the
**context graph** (measurements as vertices, contexts as edges) valued in the two-element group
`(Bool, xor) ≅ ℤ/2ℤ`, computed by a coboundary map `δ⁰` exactly as `Causal.Cohomology.delta0`
computes the causal order complex's, generalized here from a poset's order complex to an
arbitrary graph. The obstruction is a signed sum around a 4-cycle of the graph — the discrete
analogue of `Causal.Cohomology.delta1_delta0`'s telescoping identity — and it is nonzero for the
PR box's context graph, giving an independent, cohomological re-proof of `prBox_no_global`.

## Scope

This is the ℤ/2-coefficient, parity-constrained case of the frontier. Sections (L)–(N) lift
the constraint shape from pair contexts to arbitrary arity (`XorSystem`): the all-versus-nothing
certificate refutes global sections over any hypergraph scenario, and the pair case embeds by
`ParityModel.toXor`. The converse — no certificate implies a global section, the ℤ/2 Fredholm
alternative by Gaussian elimination — is stated in the blueprint, not here. The general
Abramsky–Mansfield–Barbosa relative cohomology of the full ℤ-linear distribution presheaf, for
empirical models with non-parity or multi-valued supports, remains open. The ordinary
(non-relative) coboundary criterion over the *unrestricted* space of ℤ-linear combinations of
assignments is not an obstruction there: an unrestricted signed integer combination reproducing
the PR box's own per-context joint distributions exists (a rank-9-of-16 consistent linear system),
so that naive construal proves nothing about strong contextuality in general — it is the
motivation for scoping to the parity/ℤ₂ case here.

`record_merge_ground_state` and its instances carry `propext`, inherited from `mergeTally`'s and
`localRecord`'s generic-carrier `List` membership decisions (`Decidable` for list membership over
an arbitrary `DecidableEq` type is core-Lean-tainted at that generality). `pr_top_h1_exchange`
additionally carries `Quot.sound`, inherited from `List.countP_pos_iff`, for which no axiom-free
replacement exists in this core-only project.

## Main definitions

* `delta0` — the XOR gradient of a `Bool`-valued 0-cochain on a scenario's measurements.
* `Coboundary` — a 1-cochain `φ : M → M → Bool` arising as `delta0 f` on every context edge of the
  scenario, in either edge direction.
* `ParityModel` — a scenario together with a required per-edge XOR target, and its underlying
  `Model` (support = "the two outcomes differ iff the target holds").
* `outcomeCharge`, `localRecord`, `RealizingFamily`, `mergeRecord`, `topCount` — a Boolean local
  section held as a charge record (outcome charges on the context's measurements, `⊥ₖ` off it),
  a family realizing a model, its pointwise knowledge-join merge, and the merge's held-`⊤` count.
* `prWitnessFamily`, `prNerve` — the PR-box witness family and the Euler counts of the PR
  context graph.
* `xorOver`, `XorSystem` — the XOR of an assignment over a list of measurements, and an XOR
  constraint system over a hypergraph scenario (contexts of any arity, one target bit each),
  with its possibilistic `Model`.
* `ParityModel.toXor` — the pair-context parity models as XOR systems.
* `ghzXor`, `msXor` — the GHZ (Mermin) three-party system on `Option Bool × Bool` and the
  Mermin–Peres magic square on `Option Bool × Option Bool`.

## Main results

* `coboundary_cycle_sum` — a coboundary's edge values telescope to `false` around any 4-cycle of
  the context graph (the graph analogue of `delta1_delta0`).
* `not_coboundary_of_cycle_sum_true` — the contrapositive: a 4-cycle with a nonzero (`true`) edge
  sum witnesses `¬ Coboundary`.
* `hasGlobalSection_iff_coboundary` — for a `ParityModel` whose contexts are all pairs,
  `HasGlobalSection` of its `Model` is equivalent to `Coboundary` of its target.
* `parityModel_stronglyContextual_iff` — strong contextuality of a `ParityModel`'s `Model` is
  equivalent to `AllContextsInhabited` together with its target not being a coboundary.
* `prTarget_not_coboundary` — the PR box's target has nonzero cycle sum around its context
  4-cycle `0-2-1-3-0`, hence is not a coboundary.
* `prBox_no_global_cohomological` — `¬ HasGlobalSection prBox`, proved via the graph-cohomology
  route, agreeing with `MeasurementScenario.prBox_no_global`.
* `mergeRecord_inconsistency_iff`, `mergeRecord_topfree_iff_compatible` — the knowledge-join
  merge holds `⊤` at a measurement iff two contexts containing it disagree there; the merge is
  `⊤`-free everywhere iff the family is compatible.
* `topfree_realizing_family_iff_coboundary` — the held-`⊤`/`H¹` exchange: for a `ParityModel`
  with pair contexts, a realizing family with `⊤`-free merge exists iff the target is a
  `Coboundary`.
* `pr_top_h1_exchange` — the PR exchange rate: every realizing family's merge holds at least
  one `⊤`-cell, the witness family attains exactly one, and `CoverNerve.H1rank prNerve = 1`.
* `merged_support_norm` — the general exchange rate as its two constructions: the pay
  family of a reference and a pick realizes the model with `⊤`-count at most the
  pick-count over the frustrated contexts, and any realizing family's `⊤`-set covers the
  frustrated contexts of the merge readout, with every `⊤`-measurement in at least two
  contexts.
* `xorOver_eq_false_of_even_incidence` — even incidence kills the XOR: a list in which every
  measurement occurs an even number of times XORs any assignment to `false`.
* `not_hasGlobalSection_of_avn` — the all-versus-nothing certificate: a family of contexts
  with even incidence everywhere and target XOR `true` refutes every global section of an
  `XorSystem`.
* `parityModel_toXor_hasGlobalSection_iff`, `not_hasGlobalSection_of_pair_cycle` — the pair
  weld: a pair-context parity model and its XOR system have the same global sections, and the
  4-cycle criterion of `not_coboundary_of_cycle_sum_true` is the certificate on the flattened
  cycle.
* `prXor_no_global`, `ghzXor_strongly_contextual`, `msXor_strongly_contextual` — one
  certificate each for the PR box, GHZ, and the magic square; `ghz_not_pairs` places GHZ
  outside the all-pairs hypothesis.

## References

`content/.../sheaf`; Abramsky, Mansfield & Barbosa, *Relating Structural and Quantitative
Contextuality* (2012); Abramsky, Barbosa, Kishida, Lal & Mansfield, *Contextuality, Cohomology and
Paradox* (2015). Siblings: `QuantumContextuality.MeasurementScenario`, `QuantumContextuality.SupportContextuality`,
`CausalSets.Causal.Cohomology`.

## Tags

cohomological contextuality, Čech cohomology, parity, XOR, PR box, all-versus-nothing, graph
cohomology
-/

namespace Obsmetrologia
namespace QuantumContextuality

variable {M : Type}

/-! ## (A) The context graph and its `δ⁰` -/

/-- The **XOR gradient** of a `Bool`-valued 0-cochain: whether the two measurements' assigned
bits differ. -/
def delta0 (f : M → Bool) (i j : M) : Bool := f i != f j

/-- `delta0` is symmetric in its two arguments. -/
theorem delta0_symm (f : M → Bool) (i j : M) : delta0 f i j = delta0 f j i := by
  unfold delta0; cases f i <;> cases f j <;> decide

/-- A 1-cochain `φ` on a scenario's context graph is a **coboundary** when it is the `delta0` of a
single global `f`, read on every context edge in either direction (a context `[i,j]` is the
unordered pair of jointly-measurable measurements `i`, `j`). -/
def Coboundary (S : Scenario M) (φ : M → M → Bool) : Prop :=
  ∃ f : M → Bool, ∀ i j, ([i, j] ∈ S.contexts ∨ [j, i] ∈ S.contexts) → φ i j = delta0 f i j

/-! ## (B) The 4-cycle obstruction -/

/-- **`δ⁰` telescopes to `false` around a 4-cycle.** For any four bits, the XOR-gradient values
around a closed loop cancel — the graph analogue of `Causal.Cohomology.delta1_delta0`. -/
theorem delta0_cycle_false (a b c d : Bool) :
    xor (xor (a != b) (b != c)) (xor (c != d) (d != a)) = false := by
  cases a <;> cases b <;> cases c <;> cases d <;> decide

/-- **A coboundary's edges telescope to `false` around any 4-cycle** of the context graph — the
graph-cohomology form of `Causal.Cohomology.coboundary_cocycle` (im `δ⁰` closed under the cycle
sum). -/
theorem coboundary_cycle_sum {S : Scenario M} {φ : M → M → Bool} (h : Coboundary S φ)
    {i j k l : M}
    (hij : [i, j] ∈ S.contexts ∨ [j, i] ∈ S.contexts)
    (hjk : [j, k] ∈ S.contexts ∨ [k, j] ∈ S.contexts)
    (hkl : [k, l] ∈ S.contexts ∨ [l, k] ∈ S.contexts)
    (hli : [l, i] ∈ S.contexts ∨ [i, l] ∈ S.contexts) :
    xor (xor (φ i j) (φ j k)) (xor (φ k l) (φ l i)) = false := by
  obtain ⟨f, hf⟩ := h
  rw [hf i j hij, hf j k hjk, hf k l hkl, hf l i hli]
  exact delta0_cycle_false (f i) (f j) (f k) (f l)

/-- **The contrapositive obstruction criterion.** A 4-cycle whose `φ`-edge sum is `true` (nonzero)
witnesses that `φ` is not a coboundary — a nonvanishing Čech `H¹` class. -/
theorem not_coboundary_of_cycle_sum_true {S : Scenario M} {φ : M → M → Bool}
    {i j k l : M}
    (hij : [i, j] ∈ S.contexts ∨ [j, i] ∈ S.contexts)
    (hjk : [j, k] ∈ S.contexts ∨ [k, j] ∈ S.contexts)
    (hkl : [k, l] ∈ S.contexts ∨ [l, k] ∈ S.contexts)
    (hli : [l, i] ∈ S.contexts ∨ [i, l] ∈ S.contexts)
    (hsum : xor (xor (φ i j) (φ j k)) (xor (φ k l) (φ l i)) = true) :
    ¬ Coboundary S φ := by
  intro h
  have hz := coboundary_cycle_sum h hij hjk hkl hli
  rw [hz] at hsum
  exact absurd hsum (by decide)

/-- **`δ⁰` telescopes to `false` around a 3-cycle.** The triangle form of
`delta0_cycle_false`. -/
theorem delta0_triangle_false (a b c : Bool) :
    xor (xor (a != b) (b != c)) (c != a) = false := by
  cases a <;> cases b <;> cases c <;> decide

/-- **A coboundary's edges telescope to `false` around any 3-cycle** of the context graph. -/
theorem coboundary_triangle_sum {S : Scenario M} {φ : M → M → Bool} (h : Coboundary S φ)
    {i j k : M}
    (hij : [i, j] ∈ S.contexts ∨ [j, i] ∈ S.contexts)
    (hjk : [j, k] ∈ S.contexts ∨ [k, j] ∈ S.contexts)
    (hki : [k, i] ∈ S.contexts ∨ [i, k] ∈ S.contexts) :
    xor (xor (φ i j) (φ j k)) (φ k i) = false := by
  obtain ⟨f, hf⟩ := h
  rw [hf i j hij, hf j k hjk, hf k i hki]
  exact delta0_triangle_false (f i) (f j) (f k)

/-- **The 3-cycle obstruction criterion.** A triangle whose `φ`-edge sum is `true` witnesses
that `φ` is not a coboundary. -/
theorem not_coboundary_of_triangle_sum_true {S : Scenario M} {φ : M → M → Bool}
    {i j k : M}
    (hij : [i, j] ∈ S.contexts ∨ [j, i] ∈ S.contexts)
    (hjk : [j, k] ∈ S.contexts ∨ [k, j] ∈ S.contexts)
    (hki : [k, i] ∈ S.contexts ∨ [i, k] ∈ S.contexts)
    (hsum : xor (xor (φ i j) (φ j k)) (φ k i) = true) :
    ¬ Coboundary S φ := by
  intro h
  have hz := coboundary_triangle_sum h hij hjk hki
  rw [hz] at hsum
  exact absurd hsum (by decide)

/-! ## (C) Parity models and the `HasGlobalSection` bridge -/

/-- A **parity (XOR-constraint) model**: a scenario together with a required per-edge target bit,
symmetric in its two measurements (the target belongs to the unordered context pair, not an
order on it). The PR box, GHZ, and Mermin all-versus-nothing arguments are all of this shape. -/
structure ParityModel (M : Type) where
  /-- The measurement scenario. -/
  scenario : Scenario M
  /-- The required XOR value on each measurement pair. -/
  target : M → M → Bool
  /-- The target does not depend on the order of the pair. -/
  target_symm : ∀ i j, target i j = target j i

/-- The underlying possibilistic `Model`: on a two-measurement context `[i,j]`, the allowed
assignments are exactly those whose two outcomes differ iff the target holds there. -/
def ParityModel.toModel (P : ParityModel M) : Model M Bool where
  scenario := P.scenario
  support := fun C g => C.casesOn (motive := fun _ => Prop) False
    (fun i t => t.casesOn (motive := fun _ => Prop) False
      (fun j t' => t'.casesOn (motive := fun _ => Prop) ((g i != g j) = P.target i j)
        (fun _ _ => False)))

/-- **`HasGlobalSection` is `Coboundary`.** When every context of a `ParityModel`'s scenario is a
pair, a global section of its `Model` is exactly a `delta0`-witness for its target — the
possibilistic gluing question *is* the graph-cohomology coboundary question. -/
theorem hasGlobalSection_iff_coboundary (P : ParityModel M)
    (hpairs : ∀ C, C ∈ P.scenario.contexts → ∃ i j, C = [i, j]) :
    HasGlobalSection P.toModel ↔ Coboundary P.scenario P.target := by
  constructor
  · rintro ⟨g, hg⟩
    refine ⟨g, fun i j hij => ?_⟩
    rcases hij with hij | hij
    · have h : (g i != g j) = P.target i j := hg [i, j] hij
      show P.target i j = delta0 g i j
      unfold delta0
      exact h.symm
    · have h : (g j != g i) = P.target j i := hg [j, i] hij
      show P.target i j = delta0 g i j
      unfold delta0
      rw [P.target_symm i j]
      have hcomm : (g i != g j) = (g j != g i) := by cases g i <;> cases g j <;> rfl
      rw [hcomm]
      exact h.symm
  · rintro ⟨f, hf⟩
    refine ⟨f, fun C hC => ?_⟩
    obtain ⟨i, j, rfl⟩ := hpairs C hC
    have h := hf i j (Or.inl hC)
    show (f i != f j) = P.target i j
    unfold delta0 at h
    exact h.symm

/-- **Strong contextuality of a `ParityModel` is the graph-cohomology obstruction.** For a
`ParityModel` whose contexts are all pairs, its `Model` is strongly contextual iff every context
is inhabited and its target is not a coboundary — the possibilistic weld of
`MeasurementScenario.StronglyContextual` to graph `H¹`. -/
theorem parityModel_stronglyContextual_iff (P : ParityModel M)
    (hpairs : ∀ C, C ∈ P.scenario.contexts → ∃ i j, C = [i, j]) :
    StronglyContextual P.toModel ↔
      (AllContextsInhabited P.toModel ∧ ¬ Coboundary P.scenario P.target) := by
  unfold StronglyContextual
  rw [hasGlobalSection_iff_coboundary P hpairs]

/-! ## (D) The PR-box instance -/

/-- The PR box's required parity: the two measurements' outcomes must differ exactly when both
are primed — `MeasurementScenario.prAllowedB`'s target, read off directly. -/
def prTarget : PRM → PRM → Bool := fun i j => primed i && primed j

/-- `prTarget` is symmetric. -/
theorem prTarget_symm (i j : PRM) : prTarget i j = prTarget j i := by
  unfold prTarget; cases primed i <;> cases primed j <;> decide

/-- The PR box as a `ParityModel`. -/
def prParityModel : ParityModel PRM := ⟨prScenario, prTarget, prTarget_symm⟩

/-- **`prBox`'s support literally is `prParityModel.toModel`'s.** -/
theorem prBox_support_iff (C : List PRM) (g : PRM → Bool) :
    prBox.support C g ↔ prParityModel.toModel.support C g := by
  unfold prBox prParityModel ParityModel.toModel prTarget prAllowedB
  refine C.casesOn ?_ (fun i t => t.casesOn ?_ (fun j t' => t'.casesOn ?_ (fun _ _ => ?_)))
  · exact ⟨fun h => Bool.noConfusion h, False.elim⟩
  · exact ⟨fun h => Bool.noConfusion h, False.elim⟩
  · exact beq_iff_eq
  · exact ⟨fun h => Bool.noConfusion h, False.elim⟩

/-- **`prBox` has a global section iff `prParityModel.toModel` does.** -/
theorem prBox_hasGlobalSection_iff :
    HasGlobalSection prBox ↔ HasGlobalSection prParityModel.toModel :=
  exists_congr fun g => forall_congr' fun C => forall_congr' fun _ => prBox_support_iff C g

/-- Every context of `prScenario` is a pair. -/
theorem prScenario_pairs : ∀ C, C ∈ prScenario.contexts → ∃ i j, C = [i, j] := by
  intro C hC
  cases hC with
  | head => exact ⟨(false, false), (true, false), rfl⟩
  | tail _ h1 =>
    cases h1 with
    | head => exact ⟨(false, false), (true, true), rfl⟩
    | tail _ h2 =>
      cases h2 with
      | head => exact ⟨(false, true), (true, false), rfl⟩
      | tail _ h3 =>
        cases h3 with
        | head => exact ⟨(false, true), (true, true), rfl⟩
        | tail _ h4 => nomatch h4

/-- **The PR box's target is not a coboundary** — the graph-cohomology obstruction is nonzero.
Around the context-graph cycle `0-2-1-3-0`, the target's four values are `false, false, true,
false`, whose XOR-sum is `true`, so `not_coboundary_of_cycle_sum_true` applies. -/
theorem prTarget_not_coboundary : ¬ Coboundary prScenario prTarget :=
  not_coboundary_of_cycle_sum_true (S := prScenario) (φ := prTarget)
    (i := (false, false)) (j := (true, false)) (k := (false, true)) (l := (true, true))
    (Or.inl (List.Mem.head _))
    (Or.inr (List.Mem.tail _ (List.Mem.tail _ (List.Mem.head _))))
    (Or.inl (List.Mem.tail _ (List.Mem.tail _ (List.Mem.tail _ (List.Mem.head _)))))
    (Or.inr (List.Mem.tail _ (List.Mem.head _)))
    (by decide)

/-- **`prBox` has no global section — the cohomological route.** Agrees with
`MeasurementScenario.prBox_no_global`, proved there by Boolean exhaustion; here by the context
graph's nonvanishing `H¹`. -/
theorem prBox_no_global_cohomological : ¬ HasGlobalSection prBox := by
  rw [prBox_hasGlobalSection_iff, hasGlobalSection_iff_coboundary prParityModel prScenario_pairs]
  exact prTarget_not_coboundary

/-- **The PR box is strongly contextual — the cohomological route.** Reuses
`MeasurementScenario.prBox_inhabited` for the nonempty-support half; the no-global-section half is
`prBox_no_global_cohomological`, not `prBox_no_global`. -/
theorem prBox_strongly_contextual_cohomological : StronglyContextual prBox :=
  ⟨prBox_inhabited, prBox_no_global_cohomological⟩

/-! ## (E) Local sections as charge records, and the knowledge-join merge

Local sections of a scenario, held as charge records and merged by the knowledge join, mint
held `⊤` exactly at the measurements where the family disagrees. For a parity model with pair
contexts this makes the two carriers of an unresolvable disagreement interconvertible: a family
of `⊤`-free local records whose merge is again `⊤`-free exists iff the parity target is a
`Coboundary` (corpus: `content/.../sheaf`, `content/.../inconsistency-sheaf`). -/

/-- The charge of a Boolean outcome: `true ↦ t`, `false ↦ f`. -/
def outcomeCharge (b : Bool) : Charge := if b then Charge.tTop else Charge.tBot

@[simp] theorem outcomeCharge_pos (b : Bool) : (outcomeCharge b).pos = b := by
  cases b <;> rfl

@[simp] theorem outcomeCharge_neg (b : Bool) : (outcomeCharge b).neg = !b := by
  cases b <;> rfl

/-- A Boolean local section held as a charge record: outcome charges on the context's
measurements, `⊥ₖ` off it. -/
def localRecord [DecidableEq M] (C : List M) (g : M → Bool) : M → Charge :=
  fun m => if m ∈ C then outcomeCharge (g m) else Charge.kBot

/-- A family **realizes** a model when its section at each context lies in that
context's support. -/
def RealizingFamily (E : Model M Bool) (F : Family M Bool) : Prop :=
  ∀ C, C ∈ E.scenario.contexts → E.support C (F C)

/-- The **merge** of a family: the pointwise knowledge-join of its local records over
the scenario's contexts. -/
def mergeRecord [DecidableEq M] (S : Scenario M) (F : Family M Bool) : M → Charge :=
  fun m => Charge.joinList (S.contexts.map (fun C => localRecord C (F C) m))

/-- The number of held-`⊤` measurements of a charge record among `ms`. -/
def topCount (v : M → Charge) (ms : List M) : Nat :=
  ms.countP (fun m => Charge.isInconsistency (v m))

/-! ## (F) The merge holds ⊤ exactly at disagreements -/

/-- The merge's positive slot fires at `m` iff some context containing `m` assigns it
`true`. -/
theorem mergeRecord_pos_iff [DecidableEq M] (S : Scenario M) (F : Family M Bool)
    (m : M) :
    (mergeRecord S F m).pos = true ↔
      ∃ C, C ∈ S.contexts ∧ m ∈ C ∧ F C m = true := by
  unfold mergeRecord
  rw [Charge.joinList_pos, List.any_eq_true]
  constructor
  · rintro ⟨c, hc, hpos⟩
    obtain ⟨C, hC, rfl⟩ := List.mem_map.mp hc
    unfold localRecord at hpos
    by_cases hm : m ∈ C
    · simp only [hm, if_true, outcomeCharge_pos] at hpos
      exact ⟨C, hC, hm, hpos⟩
    · simp only [hm, if_false] at hpos
      exact absurd hpos (by decide)
  · rintro ⟨C, hC, hm, hval⟩
    refine ⟨localRecord C (F C) m, List.mem_map_of_mem hC, ?_⟩
    simp [localRecord, hm, hval]

/-- The merge's negative slot fires at `m` iff some context containing `m` assigns it
`false`. -/
theorem mergeRecord_neg_iff [DecidableEq M] (S : Scenario M) (F : Family M Bool)
    (m : M) :
    (mergeRecord S F m).neg = true ↔
      ∃ C, C ∈ S.contexts ∧ m ∈ C ∧ F C m = false := by
  unfold mergeRecord
  rw [Charge.joinList_neg, List.any_eq_true]
  constructor
  · rintro ⟨c, hc, hneg⟩
    obtain ⟨C, hC, rfl⟩ := List.mem_map.mp hc
    unfold localRecord at hneg
    by_cases hm : m ∈ C
    · simp only [hm, if_true, outcomeCharge_neg, Bool.not_eq_true'] at hneg
      exact ⟨C, hC, hm, hneg⟩
    · simp only [hm, if_false] at hneg
      exact absurd hneg (by decide)
  · rintro ⟨C, hC, hm, hval⟩
    refine ⟨localRecord C (F C) m, List.mem_map_of_mem hC, ?_⟩
    simp [localRecord, hm, hval]

/-- A charge is `⊤ₖ` iff both slots fire. -/
theorem eq_kTop_iff (c : Charge) : c = Charge.kTop ↔ (c.pos = true ∧ c.neg = true) := by
  cases c <;> decide

/-- **The merge holds `⊤` exactly at disagreements.** The merged record is inconsistent
at `m` iff two contexts of the scenario containing `m` assign it different outcomes. -/
theorem mergeRecord_inconsistency_iff [DecidableEq M] (S : Scenario M)
    (F : Family M Bool) (m : M) :
    Charge.isInconsistency (mergeRecord S F m) = true ↔
      ∃ C, C ∈ S.contexts ∧ ∃ C', C' ∈ S.contexts ∧
        m ∈ C ∧ m ∈ C' ∧ F C m ≠ F C' m := by
  unfold Charge.isInconsistency
  rw [decide_eq_true_iff, eq_kTop_iff, mergeRecord_pos_iff, mergeRecord_neg_iff]
  constructor
  · rintro ⟨⟨C, hC, hm, htrue⟩, ⟨C', hC', hm', hfalse⟩⟩
    exact ⟨C, hC, C', hC', hm, hm', by rw [htrue, hfalse]; decide⟩
  · rintro ⟨C, hC, C', hC', hm, hm', hne⟩
    cases hv : F C m with
    | true =>
      refine ⟨⟨C, hC, hm, hv⟩, ⟨C', hC', hm', ?_⟩⟩
      cases hv' : F C' m with
      | true => exact absurd (hv.trans hv'.symm) hne
      | false => rfl
    | false =>
      refine ⟨⟨C', hC', hm', ?_⟩, ⟨C, hC, hm, hv⟩⟩
      cases hv' : F C' m with
      | true => rfl
      | false => exact absurd (hv.trans hv'.symm) hne

/-- **The merge is `⊤`-free everywhere iff the family is compatible.** No measurement
of the merged record is inconsistent iff the family's sections agree on every shared
measurement (`CompatibleFamily`). -/
theorem mergeRecord_topfree_iff_compatible [DecidableEq M] (S : Scenario M)
    (F : Family M Bool) :
    (∀ m, Charge.isInconsistency (mergeRecord S F m) = false) ↔
      CompatibleFamily S F := by
  constructor
  · intro h C hC C' hC' m hm hm'
    cases hv : F C m <;> cases hv' : F C' m <;> first
      | rfl
      | · have hinc := (mergeRecord_inconsistency_iff S F m).mpr
            ⟨C, hC, C', hC', hm, hm', by rw [hv, hv']; decide⟩
          rw [h m] at hinc
          exact absurd hinc (by decide)
  · intro hcomp m
    cases hinc : Charge.isInconsistency (mergeRecord S F m) with
    | false => rfl
    | true =>
      obtain ⟨C, hC, C', hC', hm, hm', hne⟩ :=
        (mergeRecord_inconsistency_iff S F m).mp hinc
      exact absurd (hcomp C hC C' hC' m hm hm') hne

/-! ## (G) A compatible realizing family glues -/

/-- The Boolean readout of a charge record: the positive slot. -/
def readout (v : M → Charge) : M → Bool := fun m => (v m).pos

/-- On a compatible family, the merge's readout agrees with each local section on its
context. -/
theorem readout_merge_eq_of_compatible [DecidableEq M] (S : Scenario M)
    (F : Family M Bool) (hcomp : CompatibleFamily S F)
    {C : List M} (hC : C ∈ S.contexts) {m : M} (hm : m ∈ C) :
    readout (mergeRecord S F) m = F C m := by
  unfold readout
  cases hv : F C m with
  | true => exact (mergeRecord_pos_iff S F m).mpr ⟨C, hC, hm, hv⟩
  | false =>
    cases hpos : (mergeRecord S F m).pos with
    | false => rfl
    | true =>
      obtain ⟨C', hC', hm', hv'⟩ := (mergeRecord_pos_iff S F m).mp hpos
      rw [hcomp C hC C' hC' m hm hm', hv'] at hv
      exact absurd hv (by decide)

/-- A parity model's support reads only the context's measurements. -/
theorem parityModel_support_congr (P : ParityModel M) (C : List M) (g g' : M → Bool)
    (h : ∀ m, m ∈ C → g m = g' m) :
    P.toModel.support C g ↔ P.toModel.support C g' := by
  match C with
  | [] => exact Iff.rfl
  | [i] => exact Iff.rfl
  | [i, j] =>
    have hi := h i (by simp)
    have hj := h j (by simp)
    show ((g i != g j) = P.target i j) ↔ ((g' i != g' j) = P.target i j)
    rw [hi, hj]
  | _ :: _ :: _ :: _ => exact Iff.rfl

/-- A compatible realizing family of a parity model glues: the merge's readout is a
global section. -/
theorem compatible_realizing_hasGlobalSection [DecidableEq M] (P : ParityModel M)
    (F : Family M Bool) (hF : RealizingFamily P.toModel F)
    (hcomp : CompatibleFamily P.scenario F) : HasGlobalSection P.toModel := by
  refine ⟨readout (mergeRecord P.scenario F), fun C hC => ?_⟩
  exact (parityModel_support_congr P C _ (F C)
    (fun m hm => readout_merge_eq_of_compatible P.scenario F hcomp hC hm)).mpr
    (hF C hC)

/-! ## (H) The held-⊤/H¹ exchange -/

/-- **The held-⊤/H¹ exchange.** For a parity model with pair contexts, a realizing
family whose merge is `⊤`-free everywhere exists iff the target is a coboundary of the
context graph. -/
theorem topfree_realizing_family_iff_coboundary [DecidableEq M] (P : ParityModel M)
    (hpairs : ∀ C, C ∈ P.scenario.contexts → ∃ i j, C = [i, j]) :
    (∃ F : Family M Bool, RealizingFamily P.toModel F ∧
        ∀ m, Charge.isInconsistency (mergeRecord P.scenario F m) = false) ↔
      Coboundary P.scenario P.target := by
  constructor
  · rintro ⟨F, hF, htop⟩
    exact (hasGlobalSection_iff_coboundary P hpairs).mp
      (compatible_realizing_hasGlobalSection P F hF
        ((mergeRecord_topfree_iff_compatible P.scenario F).mp htop))
  · rintro ⟨f, hf⟩
    refine ⟨restrictFamily f, ?_, ?_⟩
    · intro C hC
      obtain ⟨i, j, rfl⟩ := hpairs C hC
      show (f i != f j) = P.target i j
      exact (hf i j (Or.inl hC)).symm
    · exact (mergeRecord_topfree_iff_compatible P.scenario (restrictFamily f)).mpr
        (globalSection_restricts_compatible P.scenario f)

/-! ## (I) The PR exchange rate -/

/-- The four PR measurements. -/
def prMeasurements : List PRM := [(false, false), (false, true), (true, false), (true, true)]

/-- Every measurement is listed. -/
theorem prMeasurements_complete : ∀ m : PRM, m ∈ prMeasurements := by
  rintro ⟨p, t⟩
  cases p <;> cases t
  · exact List.Mem.head _
  · exact List.Mem.tail _ (List.Mem.head _)
  · exact List.Mem.tail _ (List.Mem.tail _ (List.Mem.head _))
  · exact List.Mem.tail _ (List.Mem.tail _ (List.Mem.tail _ (List.Mem.head _)))

/-- A family realizing `prBox` realizes `prParityModel.toModel`. -/
theorem prBox_realizingFamily_toModel (F : Family PRM Bool)
    (h : RealizingFamily prBox F) : RealizingFamily prParityModel.toModel F :=
  fun C hC => (prBox_support_iff C (F C)).mp (h C hC)

/-- **Every family realizing the PR box mints held `⊤`.** The merged record of any
realizing family is inconsistent at one measurement or more. -/
theorem prBox_realizing_family_mints_top (F : Family PRM Bool)
    (hF : RealizingFamily prBox F) :
    1 ≤ topCount (mergeRecord prScenario F) prMeasurements := by
  refine Nat.pos_of_ne_zero (fun hzero => ?_)
  have htopfree : ∀ m, Charge.isInconsistency (mergeRecord prScenario F m) = false := by
    intro m
    cases hinc : Charge.isInconsistency (mergeRecord prScenario F m) with
    | false => rfl
    | true =>
      have hpos : 0 < topCount (mergeRecord prScenario F) prMeasurements :=
        List.countP_pos_iff.mpr ⟨m, prMeasurements_complete m, hinc⟩
      omega
  exact prTarget_not_coboundary
    ((topfree_realizing_family_iff_coboundary prParityModel prScenario_pairs).mp
      ⟨F, prBox_realizingFamily_toModel F hF, htopfree⟩)

/-- The PR witness family: the constant-`false` section on three contexts and the
section firing exactly at `b'` on the doubly-primed context. -/
def prWitnessFamily : Family PRM Bool :=
  fun C => if C = [(false, true), (true, true)] then (fun m => m.1 && m.2) else (fun _ => false)

/-- The witness family realizes the PR box. -/
theorem prWitnessFamily_realizing : RealizingFamily prBox prWitnessFamily := by
  intro C hC
  have hC' : C ∈ prContexts := hC
  cases hC' with
  | head => show prAllowedB _ (prWitnessFamily _) = true; decide
  | tail _ h1 =>
    cases h1 with
    | head => show prAllowedB _ (prWitnessFamily _) = true; decide
    | tail _ h2 =>
      cases h2 with
      | head => show prAllowedB _ (prWitnessFamily _) = true; decide
      | tail _ h3 =>
        cases h3 with
        | head => show prAllowedB _ (prWitnessFamily _) = true; decide
        | tail _ h4 => nomatch h4

/-- The witness family's merge holds exactly one `⊤`-cell. -/
theorem prWitnessFamily_topCount_eq_one :
    topCount (mergeRecord prScenario prWitnessFamily) prMeasurements = 1 := by decide

/-- The Euler counts of the PR context graph: four measurements, four contexts, one
component (the context 4-cycle `0-2-1-3-0` visits every measurement). -/
def prNerve : Cohomology.CoverNerve where
  entities := 4
  cells := 4
  components := 1
  components_le_entities := by decide
  entities_le_cells_add_components := by decide

/-- The cycle rank of the PR context graph is one. -/
theorem prNerve_h1rank_eq_one : prNerve.H1rank = 1 := rfl

/-- **The PR exchange rate.** Every realizing family's merge holds at least one
`⊤`-cell, the witness family attains exactly one, and the cycle rank `Ȟ¹` of the PR
context-graph Euler counts is one. -/
theorem pr_top_h1_exchange :
    (∀ F : Family PRM Bool, RealizingFamily prBox F →
        1 ≤ topCount (mergeRecord prScenario F) prMeasurements)
    ∧ (∃ F : Family PRM Bool, RealizingFamily prBox F ∧
        topCount (mergeRecord prScenario F) prMeasurements = 1)
    ∧ prNerve.H1rank = 1 :=
  ⟨prBox_realizing_family_mints_top,
    ⟨prWitnessFamily, prWitnessFamily_realizing, prWitnessFamily_topCount_eq_one⟩,
    prNerve_h1rank_eq_one⟩

/-! ## (J) The figure-eight: the merged record's ⊤-support is lossy

Two triangles sharing one measurement, one odd context per triangle: both triangle classes
are nonzero and the cycle rank is `2`, yet a realizing family can park both disagreements at
the shared measurement, where the idempotent knowledge join collapses them, and its merge
holds exactly **one** `⊤`-cell. The per-contact carriers price the same datum at the rank
(`AperiodicOrder.Tiling` percolation: each excess contact is its own held `⊤`,
`fundamental_cycle_one_bit`); the vertex-keyed merged record's `⊤`-support undercounts it.
This quantifies the loss of the idempotent join — the merged Belnap record does not carry
multiplicity (blueprint `thm:top-h1-exchange-rate`, audited in
`scripts/top-h1-exchange-audit.py`). -/

/-- The figure-eight contexts: triangles `0-1-2` and `0-3-4` sharing measurement `0`. -/
def fig8Contexts : List (List (Fin 5)) :=
  [[0, 1], [1, 2], [2, 0], [0, 3], [3, 4], [4, 0]]

/-- The figure-eight scenario. -/
def fig8Scenario : Scenario (Fin 5) := ⟨fig8Contexts⟩

/-- The figure-eight target: odd on the contexts `[0,1]` and `[0,3]`, even elsewhere — one
odd context per triangle, both incident to the shared measurement. -/
def fig8Target : Fin 5 → Fin 5 → Bool := fun i j =>
  (i == 0 && j == 1) || (i == 1 && j == 0) || (i == 0 && j == 3) || (i == 3 && j == 0)

/-- `fig8Target` is symmetric. -/
theorem fig8Target_symm (i j : Fin 5) : fig8Target i j = fig8Target j i := by
  revert i j; decide

/-- The figure-eight as a `ParityModel`. -/
def fig8ParityModel : ParityModel (Fin 5) := ⟨fig8Scenario, fig8Target, fig8Target_symm⟩

/-- Every figure-eight context is a pair. -/
theorem fig8Scenario_pairs : ∀ C, C ∈ fig8Scenario.contexts → ∃ i j, C = [i, j] := by
  intro C hC
  simp only [fig8Scenario, fig8Contexts, List.mem_cons, List.not_mem_nil, or_false] at hC
  rcases hC with rfl | rfl | rfl | rfl | rfl | rfl
  · exact ⟨0, 1, rfl⟩
  · exact ⟨1, 2, rfl⟩
  · exact ⟨2, 0, rfl⟩
  · exact ⟨0, 3, rfl⟩
  · exact ⟨3, 4, rfl⟩
  · exact ⟨4, 0, rfl⟩

/-- **The figure-eight target is not a coboundary**: around the triangle `0-1-2` its values
are `true, false, false`, whose XOR-sum is `true`, so `not_coboundary_of_triangle_sum_true`
applies. (The triangle `0-3-4` carries a second nonzero class the same way.) -/
theorem fig8Target_not_coboundary : ¬ Coboundary fig8Scenario fig8Target :=
  not_coboundary_of_triangle_sum_true (S := fig8Scenario) (φ := fig8Target)
    (i := 0) (j := 1) (k := 2)
    (Or.inl (List.Mem.head _))
    (Or.inl (List.Mem.tail _ (List.Mem.head _)))
    (Or.inl (List.Mem.tail _ (List.Mem.tail _ (List.Mem.head _))))
    (by decide)

/-- The five figure-eight measurements. -/
def fig8Measurements : List (Fin 5) := [0, 1, 2, 3, 4]

/-- Every measurement is listed. -/
theorem fig8Measurements_complete : ∀ m : Fin 5, m ∈ fig8Measurements := by decide

/-- **Every family realizing the figure-eight mints held `⊤`.** -/
theorem fig8_realizing_family_mints_top (F : Family (Fin 5) Bool)
    (hF : RealizingFamily fig8ParityModel.toModel F) :
    1 ≤ topCount (mergeRecord fig8Scenario F) fig8Measurements := by
  refine Nat.pos_of_ne_zero (fun hzero => ?_)
  have htopfree : ∀ m, Charge.isInconsistency (mergeRecord fig8Scenario F m) = false := by
    intro m
    cases hinc : Charge.isInconsistency (mergeRecord fig8Scenario F m) with
    | false => rfl
    | true =>
      have hpos : 0 < topCount (mergeRecord fig8Scenario F) fig8Measurements :=
        List.countP_pos_iff.mpr ⟨m, fig8Measurements_complete m, hinc⟩
      omega
  exact fig8Target_not_coboundary
    ((topfree_realizing_family_iff_coboundary fig8ParityModel fig8Scenario_pairs).mp
      ⟨F, hF, htopfree⟩)

/-- The figure-eight witness family: on the two odd contexts the section firing exactly at
the shared measurement `0`; the constant-`false` section elsewhere. Both disagreements land
at measurement `0`. -/
def fig8WitnessFamily : Family (Fin 5) Bool := fun C =>
  if C = [0, 1] then (fun m => m == 0)
  else if C = [0, 3] then (fun m => m == 0)
  else fun _ => false

/-- The witness family realizes the figure-eight model. -/
theorem fig8WitnessFamily_realizing : RealizingFamily fig8ParityModel.toModel fig8WitnessFamily := by
  intro C hC
  have hC' : C ∈ fig8Contexts := hC
  simp only [fig8Contexts, List.mem_cons, List.not_mem_nil, or_false] at hC'
  rcases hC' with rfl | rfl | rfl | rfl | rfl | rfl <;>
    (simp only [ParityModel.toModel, fig8ParityModel]; decide)

/-- The witness family's merge holds exactly one `⊤`-cell — both triangle classes are paid
at the shared measurement. -/
theorem fig8WitnessFamily_topCount_eq_one :
    topCount (mergeRecord fig8Scenario fig8WitnessFamily) fig8Measurements = 1 := by decide

/-- The Euler counts of the figure-eight context graph: five measurements, six contexts, one
component. -/
def fig8Nerve : Cohomology.CoverNerve where
  entities := 5
  cells := 6
  components := 1
  components_le_entities := by decide
  entities_le_cells_add_components := by decide

/-- The cycle rank of the figure-eight context graph is two. -/
theorem fig8Nerve_h1rank_eq_two : fig8Nerve.H1rank = 2 := rfl

/-- **The merged record's ⊤-support falls below the cycle rank.** Every family realizing the
figure-eight mints at least one held-`⊤` measurement, the witness family attains exactly one,
and the cycle rank of the figure-eight context graph is two. The vertex-keyed merge's
`⊤`-support does not carry the multiplicity of independent obstructions; the per-contact
pricing does. -/
theorem fig8_merge_top_below_rank :
    (∀ F : Family (Fin 5) Bool, RealizingFamily fig8ParityModel.toModel F →
        1 ≤ topCount (mergeRecord fig8Scenario F) fig8Measurements)
    ∧ (∃ F : Family (Fin 5) Bool, RealizingFamily fig8ParityModel.toModel F ∧
        topCount (mergeRecord fig8Scenario F) fig8Measurements = 1)
    ∧ fig8Nerve.H1rank = 2 :=
  ⟨fig8_realizing_family_mints_top,
    ⟨fig8WitnessFamily, fig8WitnessFamily_realizing, fig8WitnessFamily_topCount_eq_one⟩,
    fig8Nerve_h1rank_eq_two⟩

/-! ## (K) The merged-support norm: the general exchange rate

The two constructions behind `thm:top-h1-exchange-rate`. **Cover to family**: given a
reference section and a picked endpoint per context, the family that plays the reference
everywhere and flips the pick on each frustrated context realizes the model, and its merge
mints `⊤` only at picked endpoints of frustrated contexts — the `⊤`-count is bounded by the
pick-count. **Family to cover**: for any realizing family, relative to the merge's readout
the `⊤`-set covers every frustrated context, and every `⊤`-measurement lies in at least two
contexts — a degree-one measurement never mints. Read at the minimum, the two bounds are the
identity: the least merged `⊤`-support equals the least vertex-cover weight of a frustrated
edge set over the coset of the target, with degree-one measurements free. -/

/-- The context is **frustrated** relative to a reference section: its target disagrees
with the reference's gradient. Non-pair contexts count as unfrustrated. -/
def frustratedB (P : ParityModel M) (f : M → Bool) : List M → Bool :=
  fun C => C.casesOn (motive := fun _ => Bool) false
    (fun i t => t.casesOn (motive := fun _ => Bool) false
      (fun j t' => t'.casesOn (motive := fun _ => Bool) ((delta0 f i j) != P.target i j)
        (fun _ _ => false)))

/-- A member of a two-element list is one of its two entries. -/
theorem list_mem_pair_elim (i j x : M) (hmem : x ∈ ([i, j] : List M)) : x = i ∨ x = j :=
  match hmem with
  | .head _ => Or.inl rfl
  | .tail _ (.head _) => Or.inr rfl

/-- The family that **pays each frustrated context at its picked endpoint**: on a
frustrated context, the reference flipped at the pick; elsewhere, the reference. -/
def payFamily [DecidableEq M] (P : ParityModel M) (f : M → Bool) (pick : List M → M) :
    Family M Bool :=
  fun C => if frustratedB P f C = true
    then (fun m => if m = pick C then !(f m) else f m)
    else f

/-- **The pay family realizes the model.** On unfrustrated contexts the reference already
meets the target; on frustrated ones the single flipped endpoint corrects the parity. -/
theorem payFamily_realizing [DecidableEq M] (P : ParityModel M) (f : M → Bool)
    (pick : List M → M)
    (hpairs : ∀ C, C ∈ P.scenario.contexts → ∃ i j, i ≠ j ∧ C = [i, j])
    (hpick : ∀ C, C ∈ P.scenario.contexts → pick C ∈ C) :
    RealizingFamily P.toModel (payFamily P f pick) := by
  intro C hC
  obtain ⟨i, j, hne, rfl⟩ := hpairs C hC
  show ((payFamily P f pick [i, j]) i != (payFamily P f pick [i, j]) j) = P.target i j
  unfold payFamily
  rcases Bool.eq_false_or_eq_true (frustratedB P f [i, j]) with hfr | hfr
  · rw [if_pos hfr]
    have h2 : ((f i != f j) != P.target i j) = true := hfr
    have hmem := hpick [i, j] hC
    rcases list_mem_pair_elim i j (pick [i, j]) hmem with hp | hp
    · rw [if_pos hp.symm, if_neg (fun h => hne (h.trans hp).symm)]
      revert h2
      cases f i <;> cases f j <;> cases P.target i j <;> decide
    · rw [if_neg (fun h => hne ((hp ▸ h : i = j))), if_pos hp.symm]
      revert h2
      cases f i <;> cases f j <;> cases P.target i j <;> decide
  · rw [if_neg (by rw [hfr]; exact Bool.false_ne_true)]
    have h2 : ((f i != f j) != P.target i j) = false := hfr
    revert h2
    cases f i <;> cases f j <;> cases P.target i j <;> decide

/-- **The pay family's `⊤`-count is bounded by the pick-count**: the merge is inconsistent
only at measurements that are the picked endpoint of some frustrated context. -/
theorem payFamily_top_bound [DecidableEq M] (P : ParityModel M) (f : M → Bool)
    (pick : List M → M) (ms : List M) :
    topCount (mergeRecord P.scenario (payFamily P f pick)) ms
      ≤ ms.countP (fun m => P.scenario.contexts.any
          (fun C => frustratedB P f C && decide (pick C = m))) := by
  refine List.countP_mono_left (fun m _ hm => ?_)
  obtain ⟨C, hC, C', hC', hmC, hmC', hne⟩ :=
    (mergeRecord_inconsistency_iff P.scenario (payFamily P f pick) m).mp hm
  have hval : ∀ D, (frustratedB P f D && decide (pick D = m)) = false →
      payFamily P f pick D m = f m := by
    intro D hD
    unfold payFamily
    rcases Bool.eq_false_or_eq_true (frustratedB P f D) with hfr | hfr
    · rw [if_pos hfr]
      rw [hfr] at hD
      simp only [Bool.true_and] at hD
      rw [if_neg (fun h => by rw [decide_eq_true_iff.mpr h.symm] at hD; cases hD)]
    · rw [if_neg (by simp [hfr])]
  rw [List.any_eq_true]
  by_cases h1 : (frustratedB P f C && decide (pick C = m)) = true
  · exact ⟨C, hC, h1⟩
  · by_cases h2 : (frustratedB P f C' && decide (pick C' = m)) = true
    · exact ⟨C', hC', h2⟩
    · exact absurd ((hval C (Bool.not_eq_true _ ▸ h1)).trans
        (hval C' (Bool.not_eq_true _ ▸ h2)).symm) hne

/-- **A consistent measurement's records all equal the readout**: if the merge is not `⊤`
at `m`, every context containing `m` recorded the readout's value there. -/
theorem record_eq_readout_of_consistent [DecidableEq M] (S : Scenario M)
    (F : Family M Bool) {C : List M} {m : M} (hC : C ∈ S.contexts) (hm : m ∈ C)
    (hcon : Charge.isInconsistency (mergeRecord S F m) = false) :
    F C m = readout (mergeRecord S F) m := by
  cases hv : F C m with
  | true =>
    exact ((mergeRecord_pos_iff S F m).mpr ⟨C, hC, hm, hv⟩).symm
  | false =>
    cases hpos : (mergeRecord S F m).pos with
    | false =>
      show false = (mergeRecord S F m).pos
      exact hpos.symm
    | true =>
      exfalso
      have hneg : (mergeRecord S F m).neg = true :=
        (mergeRecord_neg_iff S F m).mpr ⟨C, hC, hm, hv⟩
      have hktop : Charge.isInconsistency (mergeRecord S F m) = true := by
        unfold Charge.isInconsistency
        rw [decide_eq_true_iff]
        exact (eq_kTop_iff (mergeRecord S F m)).mpr ⟨hpos, hneg⟩
      rw [hcon] at hktop
      cases hktop

/-- **The `⊤`-set covers the frustrated contexts.** Relative to the merge's readout,
every frustrated pair context of a realizing family has an inconsistent endpoint. -/
theorem top_set_covers_frustrated [DecidableEq M] (P : ParityModel M)
    (F : Family M Bool) (hF : RealizingFamily P.toModel F)
    {i j : M} (hij : [i, j] ∈ P.scenario.contexts)
    (hfr : frustratedB P (readout (mergeRecord P.scenario F)) [i, j] = true) :
    Charge.isInconsistency (mergeRecord P.scenario F i) = true
    ∨ Charge.isInconsistency (mergeRecord P.scenario F j) = true := by
  by_cases hi : Charge.isInconsistency (mergeRecord P.scenario F i) = true
  · exact Or.inl hi
  · by_cases hj : Charge.isInconsistency (mergeRecord P.scenario F j) = true
    · exact Or.inr hj
    · exfalso
      have hri := record_eq_readout_of_consistent P.scenario F hij
        (by simp) (Bool.not_eq_true _ ▸ hi)
      have hrj := record_eq_readout_of_consistent P.scenario F hij
        (by simp) (Bool.not_eq_true _ ▸ hj)
      have hsup : (F [i, j] i != F [i, j] j) = P.target i j := hF [i, j] hij
      rw [hri, hrj] at hsup
      have h2 : ((readout (mergeRecord P.scenario F) i
          != readout (mergeRecord P.scenario F) j) != P.target i j) = true := hfr
      rw [hsup] at h2
      cases hb : P.target i j <;> rw [hb] at h2 <;> cases h2

/-- Two distinct satisfying members give a count of at least two. -/
theorem two_le_countP_of_two_mem {α : Type} (p : α → Bool) :
    ∀ {l : List α} {x y : α}, x ∈ l → y ∈ l → x ≠ y →
      p x = true → p y = true → 2 ≤ l.countP p := by
  intro l
  induction l with
  | nil => intro x y hx _ _ _ _; cases hx
  | cons a t ih =>
    intro x y hx hy hxy hpx hpy
    rcases List.mem_cons.mp hx with rfl | hx'
    · have hy' : y ∈ t := by
        rcases List.mem_cons.mp hy with rfl | h
        · exact absurd rfl hxy
        · exact h
      rw [List.countP_cons_of_pos hpx]
      have hpos : 0 < t.countP p := List.countP_pos_iff.mpr ⟨y, hy', hpy⟩
      omega
    · rcases List.mem_cons.mp hy with rfl | hy'
      · rw [List.countP_cons_of_pos hpy]
        have hpos : 0 < t.countP p := List.countP_pos_iff.mpr ⟨x, hx', hpx⟩
        omega
      · have h2 := ih hx' hy' hxy hpx hpy
        have h3 : t.countP p ≤ (a :: t).countP p := by
          rw [List.countP_cons]
          omega
        omega

/-- **A `⊤`-measurement lies in at least two contexts** — a degree-one measurement never
mints, so it is free in the cover weight. -/
theorem top_measurement_two_contexts [DecidableEq M] (S : Scenario M)
    (F : Family M Bool) (m : M)
    (h : Charge.isInconsistency (mergeRecord S F m) = true) :
    2 ≤ S.contexts.countP (fun C => decide (m ∈ C)) := by
  obtain ⟨C, hC, C', hC', hmC, hmC', hne⟩ :=
    (mergeRecord_inconsistency_iff S F m).mp h
  have hCC' : C ≠ C' := fun heq => hne (heq ▸ rfl)
  exact two_le_countP_of_two_mem _ hC hC' hCC'
    (decide_eq_true_iff.mpr hmC) (decide_eq_true_iff.mpr hmC')

/-- **The merged-support norm.** The two constructions of the exchange rate, bundled:
(cover to family) the pay family of a reference and a pick realizes the model with
`⊤`-count at most the pick-count over the frustrated contexts; (family to cover) for any
realizing family, relative to the merge readout the `⊤`-set covers every frustrated pair
context, and every `⊤`-measurement lies in at least two contexts. At the minimum the two
bounds meet: the least merged `⊤`-support is the least vertex-cover weight of the
frustrated edge set over the coset of the target, degree-one measurements free. -/
theorem merged_support_norm [DecidableEq M] (P : ParityModel M)
    (hpairs : ∀ C, C ∈ P.scenario.contexts → ∃ i j, i ≠ j ∧ C = [i, j]) :
    (∀ (f : M → Bool) (pick : List M → M),
      (∀ C, C ∈ P.scenario.contexts → pick C ∈ C) →
      RealizingFamily P.toModel (payFamily P f pick)
      ∧ ∀ ms : List M,
          topCount (mergeRecord P.scenario (payFamily P f pick)) ms
            ≤ ms.countP (fun m => P.scenario.contexts.any
                (fun C => frustratedB P f C && decide (pick C = m))))
    ∧ (∀ F : Family M Bool, RealizingFamily P.toModel F →
        (∀ i j, [i, j] ∈ P.scenario.contexts →
          frustratedB P (readout (mergeRecord P.scenario F)) [i, j] = true →
          Charge.isInconsistency (mergeRecord P.scenario F i) = true
          ∨ Charge.isInconsistency (mergeRecord P.scenario F j) = true)
        ∧ ∀ m, Charge.isInconsistency (mergeRecord P.scenario F m) = true →
            2 ≤ P.scenario.contexts.countP (fun C => decide (m ∈ C))) :=
  ⟨fun f pick hpick =>
    ⟨payFamily_realizing P f pick hpairs hpick,
     fun ms => payFamily_top_bound P f pick ms⟩,
   fun F hF =>
    ⟨fun _ _ hij hfr => top_set_covers_frustrated P F hF hij hfr,
     fun m hm => top_measurement_two_contexts P.scenario F m hm⟩⟩

/-! ## (G) The counting merge — record coefficients and the ground-state energy

Hold the local outcomes as records rather than charges and merge by counting:
one tick per context-incidence. The total contradiction mass of the merged
record prices the obstruction with multiplicity, and the minimum over
realizing families is the **ground-state energy** of the target — the least
frustrated-context count over the coset — with no vertex-cover correction:
distinct frustrated contexts pay at distinct incidences even when they share
the paying measurement (corpus: `content/.../inconsistency-sheaf`). -/

/-- Counted matches of a Boolean predicate along a list. -/
def countIf {α : Type} (p : α → Bool) : List α → Nat
  | [] => 0
  | a :: l => (if p a then 1 else 0) + countIf p l

/-- The sum of a tally over a list. -/
def sumOver {α : Type} (h : α → Nat) : List α → Nat
  | [] => 0
  | a :: l => h a + sumOver h l

theorem countIf_ext {α : Type} (p q : α → Bool) :
    ∀ l : List α, (∀ a, a ∈ l → p a = q a) → countIf p l = countIf q l
  | [], _ => rfl
  | a :: l, h => by
    show (if p a then 1 else 0) + countIf p l = (if q a then 1 else 0) + countIf q l
    rw [h a (List.mem_cons_self),
      countIf_ext p q l (fun b hb => h b (List.mem_cons_of_mem a hb))]

theorem countIf_le_countIf {α : Type} (p q : α → Bool) :
    ∀ l : List α, (∀ a, a ∈ l → p a = true → q a = true) → countIf p l ≤ countIf q l
  | [], _ => Nat.le_refl 0
  | a :: l, h => by
    have ih := countIf_le_countIf p q l (fun b hb => h b (List.mem_cons_of_mem a hb))
    show (if p a then 1 else 0) + countIf p l ≤ (if q a then 1 else 0) + countIf q l
    cases hp : p a with
    | false =>
      rw [if_neg Bool.false_ne_true, Nat.zero_add]
      exact Nat.le_trans ih (Nat.le_add_left _ _)
    | true =>
      rw [if_pos rfl, h a (List.mem_cons_self) hp, if_pos rfl]
      exact Nat.add_le_add_left ih 1

theorem one_le_countIf {α : Type} (p : α → Bool) :
    ∀ (l : List α) (a : α), a ∈ l → p a = true → 1 ≤ countIf p l
  | b :: l, a, ha, hp => by
    show 1 ≤ (if p b then 1 else 0) + countIf p l
    cases ha with
    | head =>
      rw [hp, if_pos rfl]
      exact Nat.le_add_right 1 _
    | tail _ hmem =>
      exact Nat.le_trans (one_le_countIf p l a hmem hp) (Nat.le_add_left _ _)

theorem sumOver_ext {α : Type} (h1 h2 : α → Nat) :
    ∀ l : List α, (∀ a, a ∈ l → h1 a = h2 a) → sumOver h1 l = sumOver h2 l
  | [], _ => rfl
  | a :: l, h => by
    show h1 a + sumOver h1 l = h2 a + sumOver h2 l
    rw [h a (List.mem_cons_self),
      sumOver_ext h1 h2 l (fun b hb => h b (List.mem_cons_of_mem a hb))]

theorem sumOver_le_sumOver {α : Type} (h1 h2 : α → Nat) :
    ∀ l : List α, (∀ a, a ∈ l → h1 a ≤ h2 a) → sumOver h1 l ≤ sumOver h2 l
  | [], _ => Nat.le_refl 0
  | a :: l, h =>
    Nat.add_le_add (h a (List.mem_cons_self))
      (sumOver_le_sumOver h1 h2 l (fun b hb => h b (List.mem_cons_of_mem a hb)))

theorem sumOver_eq_zero {α : Type} (h : α → Nat) :
    ∀ l : List α, (∀ a, a ∈ l → h a = 0) → sumOver h l = 0
  | [], _ => rfl
  | a :: l, hz => by
    show h a + sumOver h l = 0
    rw [hz a (List.mem_cons_self),
      sumOver_eq_zero h l (fun b hb => hz b (List.mem_cons_of_mem a hb))]

theorem one_le_sumOver {α : Type} (h : α → Nat) :
    ∀ (l : List α) (a : α), a ∈ l → 1 ≤ h a → 1 ≤ sumOver h l
  | b :: l, a, ha, h1 => by
    show 1 ≤ h b + sumOver h l
    cases ha with
    | head => exact Nat.le_trans h1 (Nat.le_add_right _ _)
    | tail _ hmem => exact Nat.le_trans (one_le_sumOver h l a hmem h1) (Nat.le_add_left _ _)

theorem add_add_swap (a b c d : Nat) : (a + b) + (c + d) = (a + c) + (b + d) := by
  rw [Nat.add_assoc a b (c + d), ← Nat.add_assoc b c d, Nat.add_comm b c,
    Nat.add_assoc c b d, ← Nat.add_assoc a c (b + d)]

/-- Peeling one list element out of a sum of counts. -/
theorem sumOver_countIf_cons {α β : Type} (q : β → α → Bool) (a : α) (l : List α) :
    ∀ ms : List β, sumOver (fun b => countIf (q b) (a :: l)) ms
      = sumOver (fun b => if q b a then 1 else 0) ms
        + sumOver (fun b => countIf (q b) l) ms
  | [] => rfl
  | b :: ms => by
    show ((if q b a then 1 else 0) + countIf (q b) l)
        + sumOver (fun b => countIf (q b) (a :: l)) ms = _
    rw [sumOver_countIf_cons q a l ms]
    exact add_add_swap _ _ _ _

/-- **Each hit is witnessed somewhere: the count is at most the incidence
sum.** If every `p`-hit in `l` has a witness in `ms`, the `p`-count of `l`
is at most the sum over `ms` of the per-witness counts. -/
theorem countIf_le_sumOver_countIf {α β : Type} (q : β → α → Bool) (ms : List β)
    (p : α → Bool) :
    ∀ l : List α, (∀ a, a ∈ l → p a = true → ∃ b, b ∈ ms ∧ q b a = true) →
      countIf p l ≤ sumOver (fun b => countIf (q b) l) ms
  | [], _ => by
    refine Nat.le_trans (Nat.le_refl 0) (Nat.le_of_eq ?_)
    exact (sumOver_eq_zero _ ms (fun b _ => rfl)).symm
  | a :: l, h => by
    have ih := countIf_le_sumOver_countIf q ms p l
      (fun a' ha' => h a' (List.mem_cons_of_mem a ha'))
    refine Nat.le_trans ?_ (Nat.le_of_eq (sumOver_countIf_cons q a l ms).symm)
    show (if p a then 1 else 0) + countIf p l ≤ _
    cases hp : p a with
    | false =>
      rw [if_neg Bool.false_ne_true, Nat.zero_add]
      exact Nat.le_trans ih (Nat.le_add_left _ _)
    | true =>
      rw [if_pos rfl]
      obtain ⟨b, hb, hqb⟩ := h a (List.mem_cons_self) hp
      refine Nat.add_le_add ?_ ih
      exact one_le_sumOver _ ms b hb (by rw [hqb]; exact Nat.le_refl 1)

theorem sumOver_indicator_le_one {β : Type} [DecidableEq β] (x : β) :
    ∀ ms : List β, ms.Nodup → sumOver (fun m => if x = m then 1 else 0) ms ≤ 1
  | [], _ => Nat.zero_le 1
  | m :: ms, hnd => by
    show (if x = m then 1 else 0) + sumOver (fun m' => if x = m' then 1 else 0) ms ≤ 1
    cases hnd with
    | cons hm hnd' =>
      by_cases hx : x = m
      · rw [if_pos hx]
        have hz : sumOver (fun m' => if x = m' then 1 else 0) ms = 0 :=
          sumOver_eq_zero _ ms (fun m' hm' => by
            show (if x = m' then 1 else 0) = 0
            exact if_neg (fun hxe => hm m' hm' (hx.symm.trans hxe)))
        rw [hz]
        exact Nat.le_refl 1
      · rw [if_neg hx, Nat.zero_add]
        exact sumOver_indicator_le_one x ms hnd'

/-- **Each hit pays at most once across a duplicate-free witness list**: the
incidence sum of a picked predicate is at most the plain count. -/
theorem sumOver_countIf_pick_le {α β : Type} [DecidableEq β] (r : α → Bool)
    (pk : α → β) :
    ∀ (l : List α) (ms : List β), ms.Nodup →
      sumOver (fun m => countIf (fun a => r a && decide (pk a = m)) l) ms ≤ countIf r l
  | [], ms, _ => Nat.le_of_eq (sumOver_eq_zero _ ms (fun _ _ => rfl))
  | a :: l, ms, hnd => by
    refine Nat.le_trans (Nat.le_of_eq
      (sumOver_countIf_cons (fun m a' => r a' && decide (pk a' = m)) a l ms)) ?_
    show _ ≤ (if r a then 1 else 0) + countIf r l
    refine Nat.add_le_add ?_ (sumOver_countIf_pick_le r pk l ms hnd)
    rcases Bool.eq_false_or_eq_true (r a) with hr | hr
    · have heq : sumOver (fun m => if r a && decide (pk a = m) then 1 else 0) ms
          = sumOver (fun m => if pk a = m then 1 else 0) ms :=
        sumOver_ext _ _ ms (fun m _ => by
          show (if r a && decide (pk a = m) then 1 else 0) = (if pk a = m then 1 else 0)
          by_cases hpk : pk a = m
          · rw [hr, decide_eq_true hpk, if_pos hpk]
            rfl
          · rw [hr, decide_eq_false hpk, if_neg hpk]
            rfl)
      rw [heq]
      exact Nat.le_trans (sumOver_indicator_le_one (pk a) ms hnd)
        (by rw [hr]; exact Nat.le_refl 1)
    · have hz : sumOver (fun m => if r a && decide (pk a = m) then 1 else 0) ms = 0 :=
        sumOver_eq_zero _ ms (fun m _ => by
          show (if r a && decide (pk a = m) then 1 else 0) = 0
          rw [hr]
          rfl)
      rw [hz]
      exact Nat.zero_le _

/-- The counting merge of a family at a measurement: the record whose tallies
count the context-incidences telling true and telling false. -/
def mergeTally [DecidableEq M] (S : Scenario M) (F : Family M Bool) (m : M) : Record :=
  ⟨countIf (fun C => decide (m ∈ C) && F C m) S.contexts,
   countIf (fun C => decide (m ∈ C) && !(F C m)) S.contexts⟩

/-- Total contradiction mass of a record valuation over a measurement list. -/
def massSum (v : M → Record) (ms : List M) : Nat :=
  sumOver (fun m => Record.topMass (v m)) ms

/-- The majority readout of the counting merge: told-true at least as often
as told-false. -/
def majorityReadout [DecidableEq M] (S : Scenario M) (F : Family M Bool) (m : M) : Bool :=
  decide ((mergeTally S F m).neg ≤ (mergeTally S F m).pos)

/-- **Dissent from the majority is priced by the mass**: at each measurement,
the incidences disagreeing with the majority readout number at most the
merged record's contradiction mass. -/
theorem dissent_majority_le_topMass [DecidableEq M] (S : Scenario M)
    (F : Family M Bool) (m : M) :
    countIf (fun C => decide (m ∈ C) && (F C m != majorityReadout S F m)) S.contexts
      ≤ Record.topMass (mergeTally S F m) := by
  rcases Bool.eq_false_or_eq_true (majorityReadout S F m) with hg | hg
  · have he : countIf (fun C => decide (m ∈ C) && (F C m != majorityReadout S F m))
          S.contexts
        = countIf (fun C => decide (m ∈ C) && !(F C m)) S.contexts :=
      countIf_ext _ _ S.contexts (fun C _ => by
        rw [hg]
        cases F C m <;> rfl)
    rw [he]
    have hg' : decide ((mergeTally S F m).neg ≤ (mergeTally S F m).pos) = true := hg
    exact Record.neg_le_topMass _ (of_decide_eq_true hg')
  · have he : countIf (fun C => decide (m ∈ C) && (F C m != majorityReadout S F m))
          S.contexts
        = countIf (fun C => decide (m ∈ C) && F C m) S.contexts :=
      countIf_ext _ _ S.contexts (fun C _ => by
        rw [hg]
        cases F C m <;> rfl)
    rw [he]
    have hg' : decide ((mergeTally S F m).neg ≤ (mergeTally S F m).pos) = false := hg
    exact Record.pos_le_topMass _
      (Nat.le_of_succ_le (Nat.gt_of_not_le (of_decide_eq_false hg')))

/-- A frustrated pair context of a realizing family dissents from the
reference at one of its endpoints. -/
theorem frustrated_has_dissent [DecidableEq M] (P : ParityModel M)
    (F : Family M Bool) (hF : RealizingFamily P.toModel F) (g : M → Bool)
    {i j : M} (hij : [i, j] ∈ P.scenario.contexts)
    (hfr : frustratedB P g [i, j] = true) :
    (F [i, j] i != g i) = true ∨ (F [i, j] j != g j) = true := by
  have hs : (F [i, j] i != F [i, j] j) = P.target i j := hF [i, j] hij
  have hfr' : ((g i != g j) != P.target i j) = true := hfr
  revert hs hfr'
  cases F [i, j] i <;> cases F [i, j] j <;> cases g i <;> cases g j
    <;> cases P.target i j <;> decide

/-- **The ground state prices the merge from below.** For any realizing
family, the frustrated-context count of the majority readout is at most the
merged record's total contradiction mass: every frustrated context has a
dissenting endpoint incidence, distinct contexts are distinct incidences,
and dissent from the majority is priced by the mass. -/
theorem ground_state_le_massSum [DecidableEq M] (P : ParityModel M)
    (hpairs : ∀ C, C ∈ P.scenario.contexts → ∃ i j, i ≠ j ∧ C = [i, j])
    (ms : List M) (hms : ∀ m, m ∈ ms)
    (F : Family M Bool) (hF : RealizingFamily P.toModel F) :
    countIf (frustratedB P (majorityReadout P.scenario F)) P.scenario.contexts
      ≤ massSum (mergeTally P.scenario F) ms := by
  refine Nat.le_trans
    (countIf_le_sumOver_countIf
      (fun m C => decide (m ∈ C) && (F C m != majorityReadout P.scenario F m)) ms
      (frustratedB P (majorityReadout P.scenario F)) P.scenario.contexts ?_)
    (sumOver_le_sumOver _ _ ms (fun m _ => dissent_majority_le_topMass P.scenario F m))
  intro C hC hfr
  obtain ⟨i, j, _, rfl⟩ := hpairs C hC
  cases frustrated_has_dissent P F hF (majorityReadout P.scenario F) hC hfr with
  | inl h =>
    exact ⟨i, hms i, by
      rw [decide_eq_true (List.mem_cons_self), Bool.true_and]
      exact h⟩
  | inr h =>
    exact ⟨j, hms j, by
      rw [decide_eq_true (List.mem_cons_of_mem i (List.mem_cons_self)), Bool.true_and]
      exact h⟩

/-- The pay family's outcome agrees with the reference away from the picked
endpoint of a frustrated context. -/
theorem payFamily_eq_ref [DecidableEq M] (P : ParityModel M) (f : M → Bool)
    (pick : List M → M) (D : List M) (m : M)
    (hD : (frustratedB P f D && decide (pick D = m)) = false) :
    payFamily P f pick D m = f m := by
  unfold payFamily
  rcases Bool.eq_false_or_eq_true (frustratedB P f D) with hfr | hfr
  · rw [if_pos hfr]
    rw [hfr, Bool.true_and] at hD
    exact if_neg (fun h : m = pick D => of_decide_eq_false hD h.symm)
  · rw [if_neg (by rw [hfr]; exact Bool.false_ne_true)]

/-- **The pay family's mass at a measurement is at most its picked frustrated
incidences**: only the picked endpoints of frustrated contexts dissent from
the reference, and the mass is bounded by the dissenting side. -/
theorem payFamily_topMass_le [DecidableEq M] (P : ParityModel M) (f : M → Bool)
    (pick : List M → M) (m : M) :
    Record.topMass (mergeTally P.scenario (payFamily P f pick) m)
      ≤ countIf (fun C => frustratedB P f C && decide (pick C = m))
          P.scenario.contexts := by
  cases hf : f m with
  | true =>
    refine Nat.le_trans (Record.topMass_le_neg _)
      (countIf_le_countIf _ _ P.scenario.contexts (fun C _ hC => ?_))
    cases hb : (frustratedB P f C && decide (pick C = m)) with
    | true => rfl
    | false =>
      rw [payFamily_eq_ref P f pick C m hb, hf, Bool.not_true, Bool.and_false] at hC
      exact absurd hC Bool.false_ne_true
  | false =>
    refine Nat.le_trans (Record.topMass_le_pos _)
      (countIf_le_countIf _ _ P.scenario.contexts (fun C _ hC => ?_))
    cases hb : (frustratedB P f C && decide (pick C = m)) with
    | true => rfl
    | false =>
      rw [payFamily_eq_ref P f pick C m hb, hf, Bool.and_false] at hC
      exact absurd hC Bool.false_ne_true

/-- **The pay family attains the reference's energy from above**: over a
duplicate-free measurement list, its merged mass is at most the reference's
frustrated-context count — each frustrated context pays exactly one tick, at
its picked endpoint, with no sharing discount. -/
theorem massSum_le_energy [DecidableEq M] (P : ParityModel M) (f : M → Bool)
    (pick : List M → M) (ms : List M) (hnd : ms.Nodup) :
    massSum (mergeTally P.scenario (payFamily P f pick)) ms
      ≤ countIf (frustratedB P f) P.scenario.contexts :=
  Nat.le_trans
    (sumOver_le_sumOver _ _ ms (fun m _ => payFamily_topMass_le P f pick m))
    (sumOver_countIf_pick_le (frustratedB P f) pick P.scenario.contexts ms hnd)

/-- **The record-coefficient exchange rate is the ground-state energy.** Over
a complete duplicate-free measurement list, the minimum over realizing
families of the counting merge's total contradiction mass equals the minimum
over reference sections of the frustrated-context count: (below) every
realizing family's mass dominates the energy of its majority readout;
(above) every reference's energy is attained by its pay family. Unlike the
idempotent merge norm of `merged_support_norm`, there is no vertex-cover
correction: the counting merge carries multiplicity, so contexts sharing a
paying measurement still pay separately. -/
theorem record_merge_ground_state [DecidableEq M] (P : ParityModel M)
    (hpairs : ∀ C, C ∈ P.scenario.contexts → ∃ i j, i ≠ j ∧ C = [i, j])
    (ms : List M) (hms : ∀ m, m ∈ ms) (hnd : ms.Nodup) :
    (∀ F, RealizingFamily P.toModel F →
      ∃ f : M → Bool, countIf (frustratedB P f) P.scenario.contexts
        ≤ massSum (mergeTally P.scenario F) ms)
    ∧ (∀ f : M → Bool, ∃ F, RealizingFamily P.toModel F
        ∧ massSum (mergeTally P.scenario F) ms
            ≤ countIf (frustratedB P f) P.scenario.contexts) := by
  constructor
  · intro F hF
    exact ⟨majorityReadout P.scenario F, ground_state_le_massSum P hpairs ms hms F hF⟩
  · intro f
    cases hmsc : ms with
    | nil =>
      refine ⟨fun _ => f, fun C hC => ?_, ?_⟩
      · obtain ⟨i, _, _, _⟩ := hpairs C hC
        rw [hmsc] at hms
        exact absurd (hms i) List.not_mem_nil
      · exact Nat.zero_le _
    | cons m0 ms' =>
      refine ⟨payFamily P f (fun C => C.headD m0),
        payFamily_realizing P f _ hpairs (fun C hC => ?_),
        massSum_le_energy P f _ (m0 :: ms') (hmsc ▸ hnd)⟩
      obtain ⟨i, j, _, rfl⟩ := hpairs C hC
      exact List.mem_cons_self

/-! ### The instance comparisons: mass vs rank

The ground-state energy against the cycle rank, on the two decisive
instances. On the figure-eight the counting merge restores the exchange rate
the idempotent merge undercounts: minimum mass two, one per independent odd
cycle. On a theta graph whose two independent cycles share their one odd
edge, a single frustrated edge services both topological debts: minimum mass
one, strictly below the cycle rank two. Record mass and per-contact rank are
distinct invariants. -/

theorem two_le_countIf {α : Type} (p : α → Bool) :
    ∀ (l : List α) (a b : α), a ∈ l → b ∈ l → a ≠ b →
      p a = true → p b = true → 2 ≤ countIf p l
  | [], _, _, ha, _, _, _, _ => nomatch ha
  | c :: l, a, b, ha, hb, hne, hpa, hpb => by
    show 2 ≤ (if p c then 1 else 0) + countIf p l
    cases ha with
    | head =>
      cases hb with
      | head => exact absurd rfl hne
      | tail _ hbl =>
        rw [hpa, if_pos rfl]
        exact Nat.add_le_add_left (one_le_countIf p l b hbl hpb) 1
    | tail _ hal =>
      cases hb with
      | head =>
        rw [hpb, if_pos rfl]
        exact Nat.add_le_add_left (one_le_countIf p l a hal hpa) 1
      | tail _ hbl =>
        exact Nat.le_trans (two_le_countIf p l a b hal hbl hne hpa hpb)
          (Nat.le_add_left _ _)

/-- **A triangle with one odd target always has a frustrated edge**: the
gradient sums to `false` around any cycle, the targets sum to `true`. -/
theorem odd_triangle_frustrated (a b c : Bool) :
    (((a != b) != true) = true) ∨ (((b != c) != false) = true)
      ∨ (((c != a) != false) = true) := by
  cases a <;> cases b <;> cases c <;> decide

/-- Every figure-eight context is a pair of distinct measurements. -/
theorem fig8Scenario_pairs_ne :
    ∀ C, C ∈ fig8Scenario.contexts → ∃ i j, i ≠ j ∧ C = [i, j] := by
  intro C hC
  have hC' : C ∈ fig8Contexts := hC
  simp only [fig8Contexts, List.mem_cons, List.not_mem_nil, or_false] at hC'
  rcases hC' with rfl | rfl | rfl | rfl | rfl | rfl
  · exact ⟨0, 1, by decide, rfl⟩
  · exact ⟨1, 2, by decide, rfl⟩
  · exact ⟨2, 0, by decide, rfl⟩
  · exact ⟨0, 3, by decide, rfl⟩
  · exact ⟨3, 4, by decide, rfl⟩
  · exact ⟨4, 0, by decide, rfl⟩

/-- **Every reference frustrates the figure-eight twice**: each triangle
carries an odd target, and the triangles share no context. -/
theorem fig8_energy_lower (f : Fin 5 → Bool) :
    2 ≤ countIf (frustratedB fig8ParityModel f) fig8Scenario.contexts := by
  rcases odd_triangle_frustrated (f 0) (f 1) (f 2) with h1 | h1 | h1 <;>
    rcases odd_triangle_frustrated (f 0) (f 3) (f 4) with h2 | h2 | h2
  · exact two_le_countIf _ fig8Contexts [0, 1] [0, 3] (by decide) (by decide) (by decide) h1 h2
  · exact two_le_countIf _ fig8Contexts [0, 1] [3, 4] (by decide) (by decide) (by decide) h1 h2
  · exact two_le_countIf _ fig8Contexts [0, 1] [4, 0] (by decide) (by decide) (by decide) h1 h2
  · exact two_le_countIf _ fig8Contexts [1, 2] [0, 3] (by decide) (by decide) (by decide) h1 h2
  · exact two_le_countIf _ fig8Contexts [1, 2] [3, 4] (by decide) (by decide) (by decide) h1 h2
  · exact two_le_countIf _ fig8Contexts [1, 2] [4, 0] (by decide) (by decide) (by decide) h1 h2
  · exact two_le_countIf _ fig8Contexts [2, 0] [0, 3] (by decide) (by decide) (by decide) h1 h2
  · exact two_le_countIf _ fig8Contexts [2, 0] [3, 4] (by decide) (by decide) (by decide) h1 h2
  · exact two_le_countIf _ fig8Contexts [2, 0] [4, 0] (by decide) (by decide) (by decide) h1 h2

/-- **The counting merge restores the figure-eight exchange rate.** The
record-coefficient mass minimum is two — one per independent odd cycle —
where the idempotent merge of `fig8_merge_top_below_rank` pays only one:
multiplicity carries what the join collapses, and the minimum meets the
cycle rank again. -/
theorem fig8_record_mass_attains_rank :
    (∀ F : Family (Fin 5) Bool, RealizingFamily fig8ParityModel.toModel F →
        2 ≤ massSum (mergeTally fig8Scenario F) fig8Measurements)
    ∧ (∃ F : Family (Fin 5) Bool, RealizingFamily fig8ParityModel.toModel F ∧
        massSum (mergeTally fig8Scenario F) fig8Measurements = 2)
    ∧ fig8Nerve.H1rank = 2 := by
  have hlower : ∀ F : Family (Fin 5) Bool, RealizingFamily fig8ParityModel.toModel F →
      2 ≤ massSum (mergeTally fig8Scenario F) fig8Measurements := by
    intro F hF
    obtain ⟨f, hf⟩ := (record_merge_ground_state fig8ParityModel fig8Scenario_pairs_ne
      fig8Measurements fig8Measurements_complete (by decide)).1 F hF
    exact Nat.le_trans (fig8_energy_lower f) hf
  refine ⟨hlower, ?_, rfl⟩
  obtain ⟨F, hF, hle⟩ := (record_merge_ground_state fig8ParityModel fig8Scenario_pairs_ne
    fig8Measurements fig8Measurements_complete (by decide)).2 (fun _ => false)
  have henergy : countIf (frustratedB fig8ParityModel (fun _ => false))
      fig8Scenario.contexts = 2 := by decide
  exact ⟨F, hF, Nat.le_antisymm (henergy ▸ hle) (hlower F hF)⟩

/-- The theta contexts: the triangle `0-1-2` and the path `0-3-1` — two
independent cycles sharing the edge `[0,1]`. -/
def thetaContexts : List (List (Fin 4)) :=
  [[0, 1], [1, 2], [2, 0], [0, 3], [3, 1]]

/-- The theta scenario. -/
def thetaScenario : Scenario (Fin 4) := ⟨thetaContexts⟩

/-- The theta target: odd exactly on the shared edge `[0,1]` — so both
independent cycles are odd, through the one shared edge. -/
def thetaTarget : Fin 4 → Fin 4 → Bool := fun i j =>
  (i == 0 && j == 1) || (i == 1 && j == 0)

/-- `thetaTarget` is symmetric. -/
theorem thetaTarget_symm (i j : Fin 4) : thetaTarget i j = thetaTarget j i := by
  revert i j; decide

/-- The theta graph as a `ParityModel`. -/
def thetaParityModel : ParityModel (Fin 4) := ⟨thetaScenario, thetaTarget, thetaTarget_symm⟩

/-- Every theta context is a pair of distinct measurements. -/
theorem thetaScenario_pairs_ne :
    ∀ C, C ∈ thetaScenario.contexts → ∃ i j, i ≠ j ∧ C = [i, j] := by
  intro C hC
  have hC' : C ∈ thetaContexts := hC
  simp only [thetaContexts, List.mem_cons, List.not_mem_nil, or_false] at hC'
  rcases hC' with rfl | rfl | rfl | rfl | rfl
  · exact ⟨0, 1, by decide, rfl⟩
  · exact ⟨1, 2, by decide, rfl⟩
  · exact ⟨2, 0, by decide, rfl⟩
  · exact ⟨0, 3, by decide, rfl⟩
  · exact ⟨3, 1, by decide, rfl⟩

/-- The four theta measurements. -/
def thetaMeasurements : List (Fin 4) := [0, 1, 2, 3]

/-- Every measurement is listed. -/
theorem thetaMeasurements_complete : ∀ m : Fin 4, m ∈ thetaMeasurements := by decide

/-- **Every reference frustrates the theta graph**: the triangle `0-1-2`
carries an odd target. -/
theorem theta_energy_lower (f : Fin 4 → Bool) :
    1 ≤ countIf (frustratedB thetaParityModel f) thetaScenario.contexts := by
  rcases odd_triangle_frustrated (f 0) (f 1) (f 2) with h | h | h
  · exact one_le_countIf _ thetaContexts [0, 1] (by decide) h
  · exact one_le_countIf _ thetaContexts [1, 2] (by decide) h
  · exact one_le_countIf _ thetaContexts [2, 0] (by decide) h

/-- The Euler counts of the theta context graph: four measurements, five
contexts, one component. -/
def thetaNerve : Cohomology.CoverNerve where
  entities := 4
  cells := 5
  components := 1
  components_le_entities := by decide
  entities_le_cells_add_components := by decide

/-- **The record mass falls strictly below the cycle rank on the theta
graph.** Both independent cycles are odd, but they share their one odd
edge, so a single frustrated context services both topological debts: the
mass minimum is one, the cycle rank two. The ground-state energy and the
per-contact cycle-rank price are distinct invariants. -/
theorem theta_record_mass_below_rank :
    (∀ F : Family (Fin 4) Bool, RealizingFamily thetaParityModel.toModel F →
        1 ≤ massSum (mergeTally thetaScenario F) thetaMeasurements)
    ∧ (∃ F : Family (Fin 4) Bool, RealizingFamily thetaParityModel.toModel F ∧
        massSum (mergeTally thetaScenario F) thetaMeasurements = 1)
    ∧ thetaNerve.H1rank = 2 := by
  have hlower : ∀ F : Family (Fin 4) Bool, RealizingFamily thetaParityModel.toModel F →
      1 ≤ massSum (mergeTally thetaScenario F) thetaMeasurements := by
    intro F hF
    obtain ⟨f, hf⟩ := (record_merge_ground_state thetaParityModel thetaScenario_pairs_ne
      thetaMeasurements thetaMeasurements_complete (by decide)).1 F hF
    exact Nat.le_trans (theta_energy_lower f) hf
  refine ⟨hlower, ?_, rfl⟩
  obtain ⟨F, hF, hle⟩ := (record_merge_ground_state thetaParityModel thetaScenario_pairs_ne
    thetaMeasurements thetaMeasurements_complete (by decide)).2 (fun _ => false)
  have henergy : countIf (frustratedB thetaParityModel (fun _ => false))
      thetaScenario.contexts = 1 := by decide
  exact ⟨F, hF, Nat.le_antisymm (henergy ▸ hle) (hlower F hF)⟩

/-! ## (L) Hypergraph XOR systems: the all-versus-nothing certificate -/

/-- The XOR of `g`'s bits over a list of measurements, with multiplicity. -/
def xorOver (g : M → Bool) : List M → Bool
  | [] => false
  | m :: l => g m != xorOver g l

/-- `xorOver` splits across an append. -/
theorem xorOver_append (g : M → Bool) :
    ∀ u v : List M, xorOver g (u ++ v) = (xorOver g u != xorOver g v)
  | [], v => by
    show xorOver g v = (false != xorOver g v)
    cases xorOver g v <;> rfl
  | a :: u, v => by
    show (g a != xorOver g (u ++ v)) = ((g a != xorOver g u) != xorOver g v)
    rw [xorOver_append g u v]
    cases g a <;> cases xorOver g u <;> cases xorOver g v <;> rfl

/-- Extracting one occurrence: the XOR over `u ++ a :: v` is `g a` XORed onto the XOR over
`u ++ v`. -/
theorem xorOver_extract (g : M → Bool) (a : M) (u v : List M) :
    xorOver g (u ++ a :: v) = (g a != xorOver g (u ++ v)) := by
  rw [xorOver_append, xorOver_append]
  show (xorOver g u != (g a != xorOver g v)) = (g a != (xorOver g u != xorOver g v))
  cases g a <;> cases xorOver g u <;> cases xorOver g v <;> rfl

/-- `xorOver` respects pointwise agreement on the list's members. -/
theorem xorOver_congr {f g : M → Bool} :
    ∀ l : List M, (∀ x, x ∈ l → f x = g x) → xorOver f l = xorOver g l
  | [], _ => rfl
  | a :: l, h => by
    show (f a != xorOver f l) = (g a != xorOver g l)
    rw [h a List.mem_cons_self,
      xorOver_congr l (fun x hx => h x (List.mem_cons_of_mem a hx))]

/-- The XOR over a flattened family is the XOR of the per-list XORs. -/
theorem xorOver_flatten (g : M → Bool) :
    ∀ S : List (List M), xorOver g S.flatten = xorOver (fun C => xorOver g C) S
  | [] => rfl
  | C :: S => by
    show xorOver g (C ++ S.flatten)
      = (xorOver g C != xorOver (fun C => xorOver g C) S)
    rw [xorOver_append, xorOver_flatten g S]

/-- The length of an append is the sum of the lengths. -/
theorem xorLen_append : ∀ u v : List M, (u ++ v).length = u.length + v.length
  | [], v => (Nat.zero_add v.length).symm
  | a :: u, v => by
    show (u ++ v).length + 1 = u.length + 1 + v.length
    rw [xorLen_append u v, Nat.add_right_comm]

/-- A measurement with odd incidence parity in a list occurs in it: the list splits around one
occurrence. -/
theorem exists_split_of_odd_incidence [DecidableEq M] (m : M) :
    ∀ l : List M, xorOver (fun x => decide (x = m)) l = true → ∃ u v, l = u ++ m :: v
  | [], h => nomatch h
  | a :: l, h => by
    by_cases ha : a = m
    · exact ⟨[], l, by rw [ha]; rfl⟩
    · have hd : (decide (a = m)) = false := decide_eq_false ha
      have ht : xorOver (fun x => decide (x = m)) l = true := by
        have h' : ((decide (a = m)) != xorOver (fun x => decide (x = m)) l) = true := h
        rw [hd] at h'
        cases hx : xorOver (fun x => decide (x = m)) l
        · rw [hx] at h'; exact nomatch h'
        · rfl
      obtain ⟨u, v, hl⟩ := exists_split_of_odd_incidence m l ht
      exact ⟨a :: u, v, by rw [hl]; rfl⟩

/-- Even incidence everywhere makes every XOR vanish, fuel-indexed on the list length. -/
theorem xorOver_eq_false_of_even_incidence_fuel [DecidableEq M] (g : M → Bool) :
    ∀ n : Nat, ∀ l : List M, l.length ≤ n →
      (∀ m, xorOver (fun x => decide (x = m)) l = false) → xorOver g l = false
  | _, [], _, _ => rfl
  | 0, _ :: _, hl, _ => nomatch hl
  | n + 1, a :: l, hl, hev => by
    have hodd : xorOver (fun x => decide (x = a)) l = true := by
      cases hx : xorOver (fun x => decide (x = a)) l
      · exfalso
        have htop : xorOver (fun x => decide (x = a)) (a :: l) = true := by
          show ((decide (a = a)) != xorOver (fun x => decide (x = a)) l) = true
          rw [decide_eq_true rfl, hx]; rfl
        rw [hev a] at htop
        exact nomatch htop
      · rfl
    obtain ⟨u, v, rfl⟩ := exists_split_of_odd_incidence a l hodd
    have hg2 : xorOver g (a :: (u ++ a :: v)) = xorOver g (u ++ v) := by
      show (g a != xorOver g (u ++ a :: v)) = xorOver g (u ++ v)
      rw [xorOver_extract]
      cases g a <;> cases xorOver g (u ++ v) <;> rfl
    have hlen : (u ++ v).length ≤ n := by
      have h1 : (u ++ a :: v).length ≤ n := Nat.le_of_succ_le_succ hl
      rw [xorLen_append] at h1
      rw [xorLen_append]
      exact Nat.le_of_succ_le h1
    have hev' : ∀ m, xorOver (fun x => decide (x = m)) (u ++ v) = false := by
      intro m
      have hcast : xorOver (fun x => decide (x = m)) (a :: (u ++ a :: v))
          = xorOver (fun x => decide (x = m)) (u ++ v) := by
        show ((decide (a = m)) != xorOver (fun x => decide (x = m)) (u ++ a :: v))
          = xorOver (fun x => decide (x = m)) (u ++ v)
        rw [xorOver_extract]
        cases decide (a = m) <;> cases xorOver (fun x => decide (x = m)) (u ++ v) <;> rfl
      rw [← hcast]
      exact hev m
    rw [hg2]
    exact xorOver_eq_false_of_even_incidence_fuel g n (u ++ v) hlen hev'

/-- **Even incidence kills the XOR.** If every measurement's incidence parity in `l` is `false`
(each occurs an even number of times), the XOR of any assignment over `l` is `false`. -/
theorem xorOver_eq_false_of_even_incidence [DecidableEq M] (g : M → Bool) (l : List M)
    (hev : ∀ m, xorOver (fun x => decide (x = m)) l = false) : xorOver g l = false :=
  xorOver_eq_false_of_even_incidence_fuel g l.length l (Nat.le_refl _) hev

/-- An **XOR constraint system** over a hypergraph scenario: each context, of any arity, carries
a required XOR target for the outcomes over it. `ParityModel` is the all-pair-contexts case. -/
structure XorSystem (M : Type) where
  /-- The measurement scenario; contexts may have any arity. -/
  scenario : Scenario M
  /-- The required XOR of the outcomes over each context. -/
  target : List M → Bool

/-- The underlying possibilistic `Model`: on context `C` the allowed assignments are exactly
those whose XOR over `C` equals the target. -/
def XorSystem.toModel (X : XorSystem M) : Model M Bool where
  scenario := X.scenario
  support := fun C g => xorOver g C = X.target C

/-- **The all-versus-nothing certificate refutes every global section.** A family `S` of
contexts (repetition allowed) in which every measurement has even incidence while the targets
XOR to `true`: summing the constraints over `S` gives `0 = 1` over `ℤ/2`. -/
theorem not_hasGlobalSection_of_avn [DecidableEq M] (X : XorSystem M) (S : List (List M))
    (hsub : ∀ C, C ∈ S → C ∈ X.scenario.contexts)
    (heven : ∀ m, xorOver (fun x => decide (x = m)) S.flatten = false)
    (htarget : xorOver X.target S = true) :
    ¬ HasGlobalSection X.toModel := by
  rintro ⟨g, hg⟩
  have hflat : xorOver g S.flatten = xorOver X.target S := by
    rw [xorOver_flatten]
    exact xorOver_congr S (fun C hC => hg C (hsub C hC))
  rw [xorOver_eq_false_of_even_incidence g S.flatten heven, htarget] at hflat
  exact nomatch hflat

/-! ## (M) The pair-context weld: `ParityModel` as an `XorSystem` -/

/-- The XOR system of a parity model: a pair context keeps its pair target; the target is
`false` off pair-shaped lists. -/
def ParityModel.toXor (P : ParityModel M) : XorSystem M where
  scenario := P.scenario
  target := fun C =>
    C.casesOn (motive := fun _ => Bool) false fun i t =>
      t.casesOn (motive := fun _ => Bool) false fun j t' =>
        t'.casesOn (motive := fun _ => Bool) (P.target i j) fun _ _ => false

/-- On a pair context the parity support and the XOR-system support agree. -/
theorem parityModel_toXor_support_iff (P : ParityModel M) (i j : M) (g : M → Bool) :
    P.toXor.toModel.support [i, j] g ↔ P.toModel.support [i, j] g := by
  show (xorOver g [i, j] = P.target i j) ↔ ((g i != g j) = P.target i j)
  have h : xorOver g [i, j] = (g i != g j) := by
    show (g i != (g j != false)) = (g i != g j)
    cases g i <;> cases g j <;> rfl
  rw [h]

/-- For a pair-context scenario, the parity model and its XOR system have the same global
sections. -/
theorem parityModel_toXor_hasGlobalSection_iff (P : ParityModel M)
    (hpairs : ∀ C, C ∈ P.scenario.contexts → ∃ i j, C = [i, j]) :
    HasGlobalSection P.toXor.toModel ↔ HasGlobalSection P.toModel := by
  constructor
  · rintro ⟨g, hg⟩
    refine ⟨g, fun C hC => ?_⟩
    obtain ⟨i, j, rfl⟩ := hpairs C hC
    exact (parityModel_toXor_support_iff P i j g).mp (hg _ hC)
  · rintro ⟨g, hg⟩
    refine ⟨g, fun C hC => ?_⟩
    obtain ⟨i, j, rfl⟩ := hpairs C hC
    exact (parityModel_toXor_support_iff P i j g).mpr (hg _ hC)

/-- Four bits chained by `!=` equal the 4-cycle XOR sum. -/
theorem bne_chain_eq_xor (a b c d : Bool) :
    (a != (b != (c != (d != false)))) = xor (xor a b) (xor c d) := by
  cases a <;> cases b <;> cases c <;> cases d <;> rfl

/-- The flattened 4-cycle `[i,j],[j,k],[k,l],[l,i]` has even incidence: any bit function XORs
to `false` over it. -/
theorem cycle_even_incidence (f : M → Bool) (i j k l : M) :
    xorOver f [i, j, j, k, k, l, l, i] = false := by
  show (f i != (f j != (f j != (f k != (f k != (f l != (f l != (f i != false)))))))) = false
  cases f i <;> cases f j <;> cases f k <;> cases f l <;> rfl

/-- **The 4-cycle obstruction is an all-versus-nothing certificate.** A pair-context 4-cycle
with target sum `true` refutes the XOR system's global sections through
`not_hasGlobalSection_of_avn` — the criterion of `not_coboundary_of_cycle_sum_true` recovered
at the hypergraph level. -/
theorem not_hasGlobalSection_of_pair_cycle [DecidableEq M] (P : ParityModel M) {i j k l : M}
    (hij : [i, j] ∈ P.scenario.contexts) (hjk : [j, k] ∈ P.scenario.contexts)
    (hkl : [k, l] ∈ P.scenario.contexts) (hli : [l, i] ∈ P.scenario.contexts)
    (hsum : xor (xor (P.target i j) (P.target j k)) (xor (P.target k l) (P.target l i))
      = true) :
    ¬ HasGlobalSection P.toXor.toModel := by
  apply not_hasGlobalSection_of_avn P.toXor [[i, j], [j, k], [k, l], [l, i]]
  · intro C hC
    cases hC with
    | head => exact hij
    | tail _ h1 =>
      cases h1 with
      | head => exact hjk
      | tail _ h2 =>
        cases h2 with
        | head => exact hkl
        | tail _ h3 =>
          cases h3 with
          | head => exact hli
          | tail _ h4 => exact nomatch h4
  · intro m
    exact cycle_even_incidence (fun x => decide (x = m)) i j k l
  · show (P.target i j != (P.target j k != (P.target k l != (P.target l i != false)))) = true
    rw [bne_chain_eq_xor]
    exact hsum

/-- The PR box's XOR system. -/
def prXor : XorSystem PRM := prParityModel.toXor

/-- The PR box's all-versus-nothing certificate: all four contexts, every measurement of even
incidence, target sum `true`. -/
theorem prXor_no_global : ¬ HasGlobalSection prXor.toModel := by
  apply not_hasGlobalSection_of_avn prXor prContexts (fun _ h => h)
  · intro m
    obtain ⟨a, b⟩ := m
    cases a <;> cases b <;> decide
  · decide

/-- The certificate route recovers the PR box's contextuality for the parity model, through the
pair weld. -/
theorem pr_no_global_of_avn : ¬ HasGlobalSection prParityModel.toModel := fun h =>
  prXor_no_global
    ((parityModel_toXor_hasGlobalSection_iff prParityModel prScenario_pairs).mpr h)

/-! ## (N) GHZ and the magic square: three-element contexts, one certificate each -/

/-- A GHZ measurement: one of three parties (`Option Bool`), each measuring in the `X`
(`false`) or `Y` (`true`) basis. -/
abbrev GhzM : Type := Option Bool × Bool

/-- The four GHZ contexts: `XXX`, `XYY`, `YXY`, `YYX` across the three parties. -/
def ghzContexts : List (List GhzM) :=
  [[(none, false), (some false, false), (some true, false)],
   [(none, false), (some false, true), (some true, true)],
   [(none, true), (some false, false), (some true, true)],
   [(none, true), (some false, true), (some true, false)]]

/-- The GHZ targets: `true` exactly when a `Y` setting occurs in the context — `false` on
`XXX`, `true` on `XYY`, `YXY`, `YYX`. -/
def ghzTarget : List GhzM → Bool := fun C => C.any fun m => m.2

/-- The GHZ (Mermin all-versus-nothing) XOR system. -/
def ghzXor : XorSystem GhzM where
  scenario := ⟨ghzContexts⟩
  target := ghzTarget

/-- Every GHZ context admits a local assignment meeting its target. -/
theorem ghzXor_inhabited : AllContextsInhabited ghzXor.toModel := by
  intro C hC
  cases hC with
  | head => exact ⟨fun _ => false, rfl⟩
  | tail _ h1 =>
    cases h1 with
    | head => exact ⟨fun m => decide (m = (none, false)), rfl⟩
    | tail _ h2 =>
      cases h2 with
      | head => exact ⟨fun m => decide (m = (none, true)), rfl⟩
      | tail _ h3 =>
        cases h3 with
        | head => exact ⟨fun m => decide (m = (none, true)), rfl⟩
        | tail _ h4 => exact nomatch h4

/-- **GHZ has no global section.** The certificate is all four contexts: every measurement has
even incidence and the targets XOR to `true`. -/
theorem ghzXor_no_global : ¬ HasGlobalSection ghzXor.toModel := by
  apply not_hasGlobalSection_of_avn ghzXor ghzContexts (fun _ h => h)
  · intro m
    obtain ⟨p, s⟩ := m
    cases p with
    | none => cases s <;> decide
    | some b => cases b <;> cases s <;> decide
  · decide

/-- **GHZ is strongly contextual.** -/
theorem ghzXor_strongly_contextual : StronglyContextual ghzXor.toModel :=
  (stronglyContextual_iff _).mpr ⟨ghzXor_inhabited, ghzXor_no_global⟩

/-- The GHZ contexts are triples: the scenario lies outside `ParityModel`'s all-pairs
hypothesis. -/
theorem ghz_not_pairs : ¬ (∀ C, C ∈ ghzXor.scenario.contexts → ∃ i j, C = [i, j]) := by
  intro h
  obtain ⟨i, j, hij⟩ :=
    h [(none, false), (some false, false), (some true, false)] (List.Mem.head _)
  exact nomatch (List.cons.inj (List.cons.inj hij).2).2

/-! ## (N') GHZ's obstruction needs all four contexts -/

set_option maxRecDepth 4000

/-- The sub-family of GHZ's four contexts selected by a bitmask `n < 16`: bit `i` set keeps
`ghzContexts[i]`. -/
def ghzMask (n : Fin 16) : List (List GhzM) :=
  (List.finRange 4).filterMap (fun i => if n.1.testBit i.1 then some (ghzContexts[i.1]!) else none)

/-- The six GHZ measurements, as a decidable-complete list. -/
def ghzAllM : List GhzM :=
  [(none, false), (none, true), (some false, false), (some false, true),
   (some true, false), (some true, true)]

/-- `ghzAllM` lists every `GhzM`. -/
theorem ghzAllM_complete : ∀ m : GhzM, m ∈ ghzAllM := by
  rintro ⟨p, s⟩
  cases p with
  | none => cases s <;> decide
  | some b => cases b <;> cases s <;> decide

/-- **`(ghzMask n).flatten`'s count of a measurement decomposes over its four bits.** Direct
unfolding of `ghzMask`'s `filterMap` on the four-element `List.finRange 4`, then
`List.count_flatten`. -/
theorem ghzMask_flatten_count_eq (n : Fin 16) (m : GhzM) :
    (ghzMask n).flatten.count m
    = (if n.1.testBit 0 then (ghzContexts[0]!).count m else 0)
    + (if n.1.testBit 1 then (ghzContexts[1]!).count m else 0)
    + (if n.1.testBit 2 then (ghzContexts[2]!).count m else 0)
    + (if n.1.testBit 3 then (ghzContexts[3]!).count m else 0) := by
  have hfr : List.finRange 4 = [⟨0, by omega⟩, ⟨1, by omega⟩, ⟨2, by omega⟩, ⟨3, by omega⟩] := by
    decide
  unfold ghzMask
  rw [hfr]
  simp only [List.filterMap_cons, List.filterMap_nil]
  cases h0 : n.1.testBit 0 <;> cases h1 : n.1.testBit 1 <;>
    cases h2 : n.1.testBit 2 <;> cases h3 : n.1.testBit 3 <;>
    simp only [List.count_flatten] <;> simp <;> omega

/-- **`xorOver` of a point-mass indicator is the incidence count's parity.** The XOR of
`decide (· = m)` over a list is `true` exactly when `m` occurs an odd number of times — the
recursive definition of `xorOver` matched against `List.count`'s recursion, by induction on the
list. Specialized to `GhzM` so `List.count` resolves against the same `BEq` instance its other
uses in this section do (a generic `[DecidableEq M]` version pulls in a different, derived `BEq`
instance and needs an explicit bridge). -/
theorem xorOver_eq_count_mod_two (m : GhzM) (l : List GhzM) :
    xorOver (fun x => decide (x = m)) l = decide (l.count m % 2 = 1) := by
  induction l with
  | nil => rfl
  | cons a t ih =>
    show ((decide (a = m)) != xorOver (fun x => decide (x = m)) t)
      = decide ((a :: t).count m % 2 = 1)
    rw [ih, List.count_cons]
    by_cases h : a = m
    · simp only [h, beq_self_eq_true, if_true]
      show (true != decide (t.count m % 2 = 1)) = decide ((t.count m + 1) % 2 = 1)
      rcases Nat.mod_two_eq_zero_or_one (t.count m) with hz | ho
      · have heq1 : (t.count m + 1) % 2 = 1 := by omega
        have hz' : decide (t.count m % 2 = 1) = false := decide_eq_false (by omega)
        rw [heq1, hz']; decide
      · have heq0 : (t.count m + 1) % 2 = 0 := by omega
        have ho' : decide (t.count m % 2 = 1) = true := decide_eq_true ho
        rw [heq0, ho']; decide
    · have hdec : decide (a = m) = false := decide_eq_false h
      have hbeq : (a == m) = false := by
        rw [Bool.eq_false_iff]; intro hc; exact h (by simpa using hc)
      rw [hdec, hbeq]; simp

/-- **Four bits not all equal disagree at one of four fixed pairs.** If `b0,b1,b2,b3` are not all
equal, then `b0 ≠ b2`, `b1 ≠ b2`, `b0 ≠ b3`, or `b1 ≠ b3` — the pure Boolean fact underlying why
dropping any one of GHZ's four contexts leaves an odd-incidence witness among four fixed
candidates, independent of which contexts these bits actually name. -/
theorem ghz_bits_disagree_of_not_all_eq (b0 b1 b2 b3 : Bool) (h : ¬(b0 = b1 ∧ b1 = b2 ∧ b2 = b3)) :
    (b0 != b2) ∨ (b1 != b2) ∨ (b0 != b3) ∨ (b1 != b3) := by
  cases b0 <;> cases b1 <;> cases b2 <;> cases b3 <;> simp_all <;> decide

/-- The GHZ design's four odd-incidence witnesses, one per pair of contexts linked by
`ghz_bits_disagree_of_not_all_eq`: `w1` links contexts 0 and 2, `w2` links 1 and 2, `w3` links 0 and 3, `w4`
links 1 and 3 — each measurement occurring in exactly that pair among the four contexts. -/
def ghzW1 : GhzM := (some false, false)

/-- See `ghzW1`. -/
def ghzW2 : GhzM := (some true, true)

/-- See `ghzW1`. -/
def ghzW3 : GhzM := (some true, false)

/-- See `ghzW1`. -/
def ghzW4 : GhzM := (some false, true)

/-- `ghzW1`'s incidence in `ghzMask n` is odd exactly when bits 0 and 2 of `n` disagree: `ghzW1`
occurs once each in contexts 0 and 2, and not at all in contexts 1 or 3
(`ghzContexts_count_table`-style small closed facts, checked once here). -/
theorem ghzW1_parity_eq (n : Fin 16) :
    ((ghzMask n).flatten.count ghzW1 % 2 = 1) ↔ (n.1.testBit 0 != n.1.testBit 2) = true := by
  rw [ghzMask_flatten_count_eq]
  have c0 : (ghzContexts[0]!).count ghzW1 = 1 := by decide
  have c1 : (ghzContexts[1]!).count ghzW1 = 0 := by decide
  have c2 : (ghzContexts[2]!).count ghzW1 = 1 := by decide
  have c3 : (ghzContexts[3]!).count ghzW1 = 0 := by decide
  rw [c0, c1, c2, c3]
  cases n.1.testBit 0 <;> cases n.1.testBit 1 <;> cases n.1.testBit 2 <;> cases n.1.testBit 3 <;>
    simp <;> omega

/-- `ghzW2`'s incidence in `ghzMask n` is odd exactly when bits 1 and 2 disagree. -/
theorem ghzW2_parity_eq (n : Fin 16) :
    ((ghzMask n).flatten.count ghzW2 % 2 = 1) ↔ (n.1.testBit 1 != n.1.testBit 2) = true := by
  rw [ghzMask_flatten_count_eq]
  have c0 : (ghzContexts[0]!).count ghzW2 = 0 := by decide
  have c1 : (ghzContexts[1]!).count ghzW2 = 1 := by decide
  have c2 : (ghzContexts[2]!).count ghzW2 = 1 := by decide
  have c3 : (ghzContexts[3]!).count ghzW2 = 0 := by decide
  rw [c0, c1, c2, c3]
  cases n.1.testBit 0 <;> cases n.1.testBit 1 <;> cases n.1.testBit 2 <;> cases n.1.testBit 3 <;>
    simp <;> omega

/-- `ghzW3`'s incidence in `ghzMask n` is odd exactly when bits 0 and 3 disagree. -/
theorem ghzW3_parity_eq (n : Fin 16) :
    ((ghzMask n).flatten.count ghzW3 % 2 = 1) ↔ (n.1.testBit 0 != n.1.testBit 3) = true := by
  rw [ghzMask_flatten_count_eq]
  have c0 : (ghzContexts[0]!).count ghzW3 = 1 := by decide
  have c1 : (ghzContexts[1]!).count ghzW3 = 0 := by decide
  have c2 : (ghzContexts[2]!).count ghzW3 = 0 := by decide
  have c3 : (ghzContexts[3]!).count ghzW3 = 1 := by decide
  rw [c0, c1, c2, c3]
  cases n.1.testBit 0 <;> cases n.1.testBit 1 <;> cases n.1.testBit 2 <;> cases n.1.testBit 3 <;>
    simp <;> omega

/-- `ghzW4`'s incidence in `ghzMask n` is odd exactly when bits 1 and 3 disagree. -/
theorem ghzW4_parity_eq (n : Fin 16) :
    ((ghzMask n).flatten.count ghzW4 % 2 = 1) ↔ (n.1.testBit 1 != n.1.testBit 3) = true := by
  rw [ghzMask_flatten_count_eq]
  have c0 : (ghzContexts[0]!).count ghzW4 = 0 := by decide
  have c1 : (ghzContexts[1]!).count ghzW4 = 1 := by decide
  have c2 : (ghzContexts[2]!).count ghzW4 = 0 := by decide
  have c3 : (ghzContexts[3]!).count ghzW4 = 1 := by decide
  rw [c0, c1, c2, c3]
  cases n.1.testBit 0 <;> cases n.1.testBit 1 <;> cases n.1.testBit 2 <;> cases n.1.testBit 3 <;>
    simp <;> omega

/-- A mask under `16` whose bits 0–3 are all equal is `0` or `15` — the only two ways four
binary digits can agree, checked once over the sixteen values `Fin 16` admits (an arithmetic fact
about numerals, not a search over GHZ's combinatorics). -/
theorem ghz_bits_agree_forces_boundary :
    ∀ n : Fin 16,
      (n.1.testBit 0 = n.1.testBit 1 ∧ n.1.testBit 1 = n.1.testBit 2
        ∧ n.1.testBit 2 = n.1.testBit 3) → n = 0 ∨ n = 15 := by
  decide

/-- **Every proper, nonempty sub-mask of GHZ's four contexts has an odd-incidence witness.** If
`n ≠ 0` and `n ≠ 15`, `ghz_bits_agree_forces_boundary` rules out all four bits agreeing, so
`ghz_bits_disagree_of_not_all_eq` produces a disagreeing pair among `{0,2}`, `{1,2}`, `{0,3}`,
`{1,3}`, and the matching `ghzWk_parity_eq` reads off an odd-incidence measurement. -/
theorem ghz_proper_submask_odd_witness (n : Fin 16) (hn15 : n ≠ 15) (hn0 : n ≠ 0) :
    ∃ m, (ghzMask n).flatten.count m % 2 = 1 := by
  have hne : ¬(n.1.testBit 0 = n.1.testBit 1 ∧ n.1.testBit 1 = n.1.testBit 2
      ∧ n.1.testBit 2 = n.1.testBit 3) := by
    intro h
    rcases ghz_bits_agree_forces_boundary n h with h0 | h0
    · exact hn0 h0
    · exact hn15 h0
  rcases ghz_bits_disagree_of_not_all_eq _ _ _ _ hne with h | h | h | h
  · exact ⟨ghzW1, (ghzW1_parity_eq n).mpr h⟩
  · exact ⟨ghzW2, (ghzW2_parity_eq n).mpr h⟩
  · exact ⟨ghzW3, (ghzW3_parity_eq n).mpr h⟩
  · exact ⟨ghzW4, (ghzW4_parity_eq n).mpr h⟩

/-- **No proper sub-family of GHZ's four contexts is an all-versus-nothing certificate.** For
`n = 0` the mask is empty and its target-sum is `false` outright. For `n ≠ 0, 15`,
`ghz_proper_submask_odd_witness` produces a measurement of odd incidence in the mask, contradicting
`heven`'s hypothesis of even incidence everywhere via `xorOver_eq_count_mod_two`. The only proper
sub-mask left unexcluded by neither route is impossible: `n = 15` is excluded by hypothesis, so
every `n ≠ 15` is covered. The finite, structural form of the Borromean reading: GHZ's obstruction
is invisible to any proper sub-family, in particular to every two-context and every three-context
restriction — proved from the design's incidence counts, not by enumerating all declared requiredteen masks. -/
theorem ghz_proper_submask_not_avn :
    ∀ n : Fin 16, n ≠ 15 →
      (∀ m ∈ ghzAllM, xorOver (fun x => decide (x = m)) (ghzMask n).flatten = false) →
      xorOver ghzTarget (ghzMask n) = false := by
  intro n hn15 heven
  by_cases hn0 : n = 0
  · have hmask : ghzMask n = [] := by subst hn0; decide
    rw [hmask]; rfl
  · obtain ⟨m, hm⟩ := ghz_proper_submask_odd_witness n hn15 hn0
    exfalso
    have hmem : m ∈ ghzAllM := ghzAllM_complete m
    have heven' := heven m hmem
    rw [xorOver_eq_count_mod_two] at heven'
    rw [decide_eq_false_iff_not] at heven'
    exact heven' hm

/-- The unrestricted form of `ghz_proper_submask_not_avn`, quantifying over all of `GhzM` rather
than the enumerated `ghzAllM`. -/
theorem ghz_avn_needs_all_four :
    ∀ n : Fin 16, n ≠ 15 →
      (∀ m : GhzM, xorOver (fun x => decide (x = m)) (ghzMask n).flatten = false) →
      xorOver ghzTarget (ghzMask n) = false :=
  fun n hn heven => ghz_proper_submask_not_avn n hn (fun m _ => heven m)

/-- The measurement's index in `ghzAllM`, for reading off one bit of a `Fin 64` search space. -/
def ghzIdxOf (m : GhzM) : Nat := ghzAllM.findIdx (· == m)

/-- The assignment on `GhzM` reading its `i`-th bit off `bits`, indexed via `ghzIdxOf`. -/
def ghzTryAssign (bits : Fin 64) : GhzM → Bool := fun m => bits.1.testBit (ghzIdxOf m)

/-- **Every proper sub-family of GHZ's four contexts has a global section**, witnessed by a
`Fin 64`-indexed search over the six measurements' assignments. -/
theorem ghz_proper_submask_has_section_bits :
    ∀ n : Fin 16, n ≠ 15 →
      ∃ bits : Fin 64, ∀ C ∈ ghzMask n, xorOver (ghzTryAssign bits) C = ghzTarget C := by
  decide

/-- **The Borromean reading of GHZ, in finite form.** Every proper sub-family of GHZ's four
contexts — in particular the restriction to any two, or any three, of its contexts — has a
genuine satisfying assignment (`ghz_proper_submask_has_section`), while no proper sub-family
meets the all-versus-nothing hypotheses (`ghz_proper_submask_not_avn`): only the full family of
four certifies `ghzXor_no_global`. This is the finite combinatorial fact underlying the reading
that GHZ's strong contextuality is not visible to any pairwise or sub-triple invariant — the
cohomological identification with a Massey triple product on a graded complex (cup products
`α∪β`, `β∪γ`, `α∪γ` vanishing while the triple product does not) remains open: no cup product is
defined on `QuantumContextuality.Cochain` at any degree, so the target statement is not yet
stateable, only this finite witness of its combinatorial shape. -/
theorem ghz_proper_submask_has_section :
    ∀ n : Fin 16, n ≠ 15 →
      ∃ g : GhzM → Bool, ∀ C ∈ ghzMask n, xorOver g C = ghzTarget C := by
  intro n hn
  obtain ⟨bits, hbits⟩ := ghz_proper_submask_has_section_bits n hn
  exact ⟨ghzTryAssign bits, hbits⟩

/-- A magic-square measurement: a cell of the 3×3 grid, row and column each indexed by
`Option Bool`. -/
abbrev MsM : Type := Option Bool × Option Bool

/-- Row `r` of the magic square. -/
def msRow (r : Option Bool) : List MsM := [(r, none), (r, some false), (r, some true)]

/-- Column `c` of the magic square. -/
def msCol (c : Option Bool) : List MsM := [(none, c), (some false, c), (some true, c)]

/-- The six magic-square contexts: three rows, then three columns. -/
def msContexts : List (List MsM) :=
  [msRow none, msRow (some false), msRow (some true),
   msCol none, msCol (some false), msCol (some true)]

/-- The Mermin–Peres targets: every row and the first two columns require XOR `false`; the
third column requires XOR `true`. -/
def msTarget : List MsM → Bool := fun C => decide (C = msCol (some true))

/-- The Mermin–Peres magic-square XOR system. -/
def msXor : XorSystem MsM where
  scenario := ⟨msContexts⟩
  target := msTarget

/-- Every magic-square context admits a local assignment meeting its target. -/
theorem msXor_inhabited : AllContextsInhabited msXor.toModel := by
  intro C hC
  cases hC with
  | head => exact ⟨fun _ => false, rfl⟩
  | tail _ h1 =>
    cases h1 with
    | head => exact ⟨fun _ => false, rfl⟩
    | tail _ h2 =>
      cases h2 with
      | head => exact ⟨fun _ => false, rfl⟩
      | tail _ h3 =>
        cases h3 with
        | head => exact ⟨fun _ => false, rfl⟩
        | tail _ h4 =>
          cases h4 with
          | head => exact ⟨fun _ => false, rfl⟩
          | tail _ h5 =>
            cases h5 with
            | head => exact ⟨fun m => decide (m = (none, some true)), rfl⟩
            | tail _ h6 => exact nomatch h6

/-- **The magic square has no global section.** The certificate is all declared required contexts: every cell
lies in exactly one row and one column, and the targets XOR to `true`. -/
theorem msXor_no_global : ¬ HasGlobalSection msXor.toModel := by
  apply not_hasGlobalSection_of_avn msXor msContexts (fun _ h => h)
  · intro m
    obtain ⟨r, c⟩ := m
    cases r with
    | none =>
      cases c with
      | none => decide
      | some bc => cases bc <;> decide
    | some br =>
      cases br <;>
        (cases c with
          | none => decide
          | some bc => cases bc <;> decide)
  · decide

/-- **The magic square is strongly contextual.** -/
theorem msXor_strongly_contextual : StronglyContextual msXor.toModel :=
  (stronglyContextual_iff _).mpr ⟨msXor_inhabited, msXor_no_global⟩

/-! ## (O) A cochain complex for hypergraph XOR systems -/

/-- A **ℤ/2-coefficient cochain**: a `Bool`-valued function on lists of measurements, read on the
`n`-element list as a degree-`(n-1)` cochain. `XorSystem.target` is already of this shape: an XOR
system's per-context target grades by context arity exactly as a cochain grades by simplex
dimension. -/
abbrev Cochain (M : Type) : Type := List M → Bool

/-- The **general ℤ/2 coboundary**, in the same cone-contraction form as
`CausalSets.Causal.Cohomology.N.delta`, with `xor` (`!=`) standing in for integer subtraction:
removing the head vertex, recursing into the tail with the prepend-shift `a·φ`. -/
def deltaX {M : Type} : Cochain M → Cochain M
  | _, [] => false
  | φ, a :: τ => φ τ != deltaX (fun l => φ (a :: l)) τ

/-- **The cone-contraction recursion** `δφ(a∷τ) = φ(τ) != δ(a·φ)(τ)`, the defining equation. -/
theorem deltaX_cons {M : Type} (φ : Cochain M) (a : M) (τ : List M) :
    deltaX φ (a :: τ) = (φ τ != deltaX (fun l => φ (a :: l)) τ) := rfl

/-- **`δ` is additive over `xor`.** The ℤ/2 analogue of `delta_sub`. -/
theorem deltaX_xor {M : Type} (f g : Cochain M) (σ : List M) :
    deltaX (fun l => f l != g l) σ = (deltaX f σ != deltaX g σ) := by
  induction σ generalizing f g with
  | nil => rfl
  | cons a τ ih =>
    rw [deltaX_cons, deltaX_cons, deltaX_cons]
    rw [ih (fun l => f (a :: l)) (fun l => g (a :: l))]
    cases f τ <;> cases g τ <;>
      cases deltaX (fun l => f (a :: l)) τ <;> cases deltaX (fun l => g (a :: l)) τ <;> decide

/-- **`δ` is extensional up to depth.** Two cochains agreeing on every list no longer than `σ`
give the same `δ`-value at `σ`, proved without `funext` by induction rather than a function
equality. -/
theorem deltaX_congr {M : Type} {f g : Cochain M} (σ : List M)
    (h : ∀ l, l.length ≤ σ.length → f l = g l) : deltaX f σ = deltaX g σ := by
  induction σ generalizing f g with
  | nil => rfl
  | cons a τ ih =>
    rw [deltaX_cons, deltaX_cons]
    rw [h τ (Nat.le_succ_of_le (Nat.le_refl _))]
    have := ih (f := fun l => f (a :: l)) (g := fun l => g (a :: l))
      (fun l hl => h (a :: l) (Nat.succ_le_succ hl))
    rw [this]

/-- **`δ ∘ δ = 0` in every degree**, over `ℤ/2` coefficients, by the same chain-length induction as
`CausalSets.Causal.Cohomology.N.delta_delta`, with `deltaX_congr` in place of `funext` at the
prepend-shift step. -/
theorem deltaX_deltaX {M : Type} (φ : Cochain M) (σ : List M) :
    deltaX (deltaX φ) σ = false := by
  induction σ generalizing φ with
  | nil => rfl
  | cons a τ ih =>
    rw [deltaX_cons]
    have hpt : ∀ l, l.length ≤ τ.length →
        deltaX φ (a :: l) = (φ l != deltaX (fun m => φ (a :: m)) l) := by
      intro l _; exact deltaX_cons φ a l
    rw [deltaX_congr τ hpt, deltaX_xor, ih (fun l => φ (a :: l))]
    cases deltaX φ τ <;> decide

/-- A degree-0 cochain (`M → Bool`) embedded as a `Cochain`, `false` off the singleton lists. -/
def single {M : Type} (f : M → Bool) : Cochain M
  | [m] => f m
  | _ => false

/-- **The degree-one weld to `delta0`.** `deltaX` applied to a degree-0 cochain's embedding,
evaluated on a 2-element list, is `delta0` on that pair (up to `delta0_symm`, since `!=` is
symmetric). This is not a definitional identity — `Coboundary` above is indexed by ordered pairs
`M → M → Bool` while `Cochain M` is graded by context arity `List M → Bool` — it is the theorem
that the new arity-graded complex specializes to the existing pair-level construction in degree
one. -/
theorem deltaX_single {M : Type} (f : M → Bool) (i j : M) :
    deltaX (single f) [i, j] = (f i != f j) := by
  show (single f [j] != deltaX (fun l => single f (i :: l)) [j]) = (f i != f j)
  show (f j != deltaX (fun l => single f (i :: l)) [j]) = (f i != f j)
  have step2 : deltaX (fun l => single f (i :: l)) [j]
      = (single f (i :: []) != deltaX (fun l => single f (i :: (j :: l))) []) := rfl
  rw [step2]
  show (f j != (f i != false)) = (f i != f j)
  cases f i <;> cases f j <;> decide

/-- A cochain is a **cocycle** when `deltaX` annihilates it at every degree. -/
def Cocycle {M : Type} (φ : Cochain M) : Prop := ∀ σ, deltaX φ σ = false

/-- A cochain is a **coboundary** when it is `deltaX` of another cochain. -/
def IsCoboundary {M : Type} (φ : Cochain M) : Prop := ∃ ψ : Cochain M, φ = deltaX ψ

/-- **Every coboundary is a cocycle** (`im deltaX ⊆ ker deltaX`), so a graded `Hⁿ` over `ℤ/2`
coefficients is well-defined at every context arity, in particular at the triple-context degree
GHZ and the magic square occupy. -/
theorem coboundary_cocycle {M : Type} {φ : Cochain M} (h : IsCoboundary φ) : Cocycle φ := by
  obtain ⟨ψ, hψ⟩ := h
  intro σ
  rw [hψ]
  exact deltaX_deltaX ψ σ

/-! ## (O') The cup product -/

/-- The **Alexander–Whitney cup product** of two `Cochain M`, at a chosen front-degree `p`: the
front `p+1` entries of a list, read through `α`, and the back entries from position `p` on
(sharing the `p`-th entry with the front), read through `β`, `AND`ed together — the `ℤ/2`
multiplication. A `p`-cochain `α` (nonzero only on `(p+1)`-lists) cupped with a `q`-cochain `β`
(nonzero only on `(q+1)`-lists) is nonzero only on `(p+q+1)`-lists, matching the classical
front-face/back-face split. -/
def cupAt {M : Type} (p : Nat) (α β : Cochain M) : Cochain M :=
  fun σ => α (σ.take (p + 1)) && β (σ.drop p)

/-- **The graded Leibniz rule for `cupAt 1`, on an explicit 4-list.** For `α`, `β` read as
1-cochains (pair-valued: only their values on 2-element lists matter here), `deltaX (cupAt 1 α β)`
on `[i,j,k,l]` unfolds to the four-term alternating sum a direct cone-contraction computation
gives; `Bool.and`'s distributivity over `xor` regroups it into `α[i,j] ∧ (β[j,k] xor β[j,l])`
XORed with `(α[i,k] xor α[j,k]) ∧ β[k,l]` — a front-face contribution from `β`'s local variation
and a back-face contribution from `α`'s. Proved by unfolding `deltaX_cons` four times (no
`decide`-search over any combinatorial space; the final step closes a six-variable Boolean
identity). Axiom-free. -/
theorem deltaX_cupAt_one {M : Type} (α β : Cochain M) (i j k l : M) :
    deltaX (cupAt 1 α β) [i,j,k,l]
    = (((α [i,j] && β [j,k]) != (α [i,j] && β [j,l]))
        != ((α [i,k] && β [k,l]) != (α [j,k] && β [k,l]))) := by
  show ((α [j,k] && β [k,l]) != deltaX (fun ll => cupAt 1 α β (i::ll)) [j,k,l])
    = (((α [i,j] && β [j,k]) != (α [i,j] && β [j,l])) != ((α [i,k] && β [k,l]) != (α [j,k] && β [k,l])))
  have step1 : deltaX (fun ll => cupAt 1 α β (i::ll)) [j,k,l]
      = ((fun ll => cupAt 1 α β (i::ll)) [k,l] != deltaX (fun ll => cupAt 1 α β (i::j::ll)) [k,l]) :=
    deltaX_cons _ j [k,l]
  rw [step1]
  show ((α [j,k] && β [k,l]) != ((α [i,k] && β [k,l]) != deltaX (fun ll => cupAt 1 α β (i::j::ll)) [k,l]))
    = (((α [i,j] && β [j,k]) != (α [i,j] && β [j,l])) != ((α [i,k] && β [k,l]) != (α [j,k] && β [k,l])))
  have step2 : deltaX (fun ll => cupAt 1 α β (i::j::ll)) [k,l]
      = ((fun ll => cupAt 1 α β (i::j::ll)) [l] != deltaX (fun ll => cupAt 1 α β (i::j::k::ll)) [l]) :=
    deltaX_cons _ k [l]
  rw [step2]
  show ((α [j,k] && β [k,l])
      != ((α [i,k] && β [k,l]) != ((α [i,j] && β [j,l]) != deltaX (fun ll => cupAt 1 α β (i::j::k::ll)) [l])))
    = (((α [i,j] && β [j,k]) != (α [i,j] && β [j,l])) != ((α [i,k] && β [k,l]) != (α [j,k] && β [k,l])))
  have step3 : deltaX (fun ll => cupAt 1 α β (i::j::k::ll)) [l]
      = ((fun ll => cupAt 1 α β (i::j::k::ll)) [] != deltaX (fun ll => cupAt 1 α β (i::j::k::l::ll)) []) :=
    deltaX_cons _ l []
  rw [step3]
  show ((α [j,k] && β [k,l])
      != ((α [i,k] && β [k,l]) != ((α [i,j] && β [j,l]) != (cupAt 1 α β [i,j,k] != false))))
    = (((α [i,j] && β [j,k]) != (α [i,j] && β [j,l])) != ((α [i,k] && β [k,l]) != (α [j,k] && β [k,l])))
  have step4 : cupAt 1 α β [i,j,k] = (α [i,j] && β [j,k]) := rfl
  rw [step4]
  cases α [i,j] <;> cases α [i,k] <;> cases α [j,k] <;>
    cases β [j,k] <;> cases β [j,l] <;> cases β [k,l] <;> decide

/-- **The Leibniz rule, regrouped by face.** The right side of `deltaX_cupAt_one` is exactly
`α[i,j] ∧ (β[j,k] xor β[j,l])` XORed with `(α[i,k] xor α[j,k]) ∧ β[k,l]` — a term reading `α` at a
fixed edge against `β`'s variation across it, XORed with a term reading `α`'s variation against a
fixed `β` edge. This is the cochain-level Leibniz rule for `cupAt 1`, in the shape closest to
`δ(α∪β) = α∪δβ ⊕ δα∪β`; it is not literally stated via `deltaX α`/`deltaX β` applied to `[i,j,k]`
or `[j,k,l]`, since those read three-element faces the 4-list's front/back split does not isolate
this way. Axiom-free (a finite six-variable Boolean identity). -/
theorem deltaX_cupAt_one_leibniz {M : Type} (α β : Cochain M) (i j k l : M) :
    deltaX (cupAt 1 α β) [i,j,k,l]
    = ((α [i,j] && (β [j,k] != β [j,l])) != ((α [i,k] != α [j,k]) && β [k,l])) := by
  rw [deltaX_cupAt_one]
  cases α [i,j] <;> cases α [i,k] <;> cases α [j,k] <;>
    cases β [j,k] <;> cases β [j,l] <;> cases β [k,l] <;> decide

/-! ## (N) The bid–ask spread between the two merge prices

The idempotent Belnap merge (`mergeRecord`/`topCount`) and the counting record
merge (`mergeTally`/`massSum`) price the same obstruction. At each measurement
the Belnap merge holds `⊤` exactly when the record carries at least one unit of
contradiction mass (`incons_iff_one_le_topMass`): the idempotent merge is the
counting merge read through a `0/1` indicator, discarding multiplicity. Summed,
the Belnap cover price never exceeds the record mass at the same family
(`topCount_le_massSum`); the difference is the multiplicity the idempotent merge
erases (`LandauerEntropy`). The gap is realized: on the figure-eight the least
Belnap price is one while the least record mass is two, and on the theta graph
the least record mass is one while the cycle rank is two — the two spreads open
on different carriers. -/

/-- A list with positive predicate count has a witnessing member. -/
theorem countIf_pos_has_mem {α : Type} (p : α → Bool) :
    ∀ l : List α, 1 ≤ countIf p l → ∃ a, a ∈ l ∧ p a = true
  | a :: l, h => by
    cases hp : p a with
    | true => exact ⟨a, List.mem_cons_self, hp⟩
    | false =>
      have h' : 1 ≤ countIf p l := by simpa [countIf, hp] using h
      obtain ⟨b, hb, hpb⟩ := countIf_pos_has_mem p l h'
      exact ⟨b, List.mem_cons_of_mem a hb, hpb⟩

/-- A Boolean count is the sum of its indicator over the list. -/
theorem countP_eq_sumOver_indicator {α : Type} (p : α → Bool) :
    ∀ l : List α, l.countP p = sumOver (fun a => if p a then 1 else 0) l
  | [] => rfl
  | a :: l => by
    rw [List.countP_cons]
    show l.countP p + (if p a then 1 else 0)
        = (if p a then 1 else 0) + sumOver (fun a => if p a then 1 else 0) l
    rw [countP_eq_sumOver_indicator p l, Nat.add_comm]

/-- **The idempotent `⊤` fires exactly at unit record mass.** The Belnap merge
holds `⊤` at a measurement iff the counting merge's contradiction mass there is
at least one: both sides say some incident context told true and some told
false. The idempotent merge is the counting merge crushed to a `0/1` indicator. -/
theorem incons_iff_one_le_topMass [DecidableEq M] (S : Scenario M) (F : Family M Bool)
    (m : M) :
    Charge.isInconsistency (mergeRecord S F m) = true
      ↔ 1 ≤ Record.topMass (mergeTally S F m) := by
  rw [Charge.isInconsistency, decide_eq_true_iff, eq_kTop_iff,
    mergeRecord_pos_iff, mergeRecord_neg_iff]
  unfold Record.topMass mergeTally
  constructor
  · rintro ⟨⟨C, hC, hm, hv⟩, ⟨C', hC', hm', hv'⟩⟩
    refine Nat.le_min.mpr ⟨one_le_countIf _ _ C hC (by rw [decide_eq_true hm, hv]; rfl),
      one_le_countIf _ _ C' hC' (by rw [decide_eq_true hm', hv']; rfl)⟩
  · intro h
    obtain ⟨C, hC, hCb⟩ := countIf_pos_has_mem _ _ (Nat.le_trans h (Nat.min_le_left _ _))
    obtain ⟨C', hC', hCb'⟩ := countIf_pos_has_mem _ _ (Nat.le_trans h (Nat.min_le_right _ _))
    obtain ⟨hCm, hCv⟩ := Bool.and_eq_true .. |>.mp hCb
    obtain ⟨hCm', hCv'⟩ := Bool.and_eq_true .. |>.mp hCb'
    exact ⟨⟨C, hC, of_decide_eq_true hCm, hCv⟩,
      ⟨C', hC', of_decide_eq_true hCm', Bool.not_eq_true' _ ▸ hCv'⟩⟩

/-- **The Belnap cover price never exceeds the record mass.** For every family,
summing the idempotent `⊤`-count over a measurement list is at most the counting
merge's total contradiction mass: at each measurement the indicator is bounded by
the mass it indicates. The difference is the erased multiplicity. -/
theorem topCount_le_massSum [DecidableEq M] (S : Scenario M) (F : Family M Bool)
    (ms : List M) :
    topCount (mergeRecord S F) ms ≤ massSum (mergeTally S F) ms := by
  unfold topCount massSum
  rw [countP_eq_sumOver_indicator]
  refine sumOver_le_sumOver _ _ ms (fun m _ => ?_)
  cases hi : Charge.isInconsistency (mergeRecord S F m) with
  | false => exact Nat.zero_le _
  | true =>
    show 1 ≤ Record.topMass (mergeTally S F m)
    exact (incons_iff_one_le_topMass S F m).mp hi

/-- **The two-spread ledger.** The idempotent Belnap price, the counting record
mass, and the cycle rank are three distinct prices for the same obstruction,
ordered `topCount ≤ massSum` at every family, and the two inequalities are
strict on different carriers: the figure-eight opens the cover/mass spread (least
Belnap price one, least record mass two) and the theta graph opens the mass/rank
spread (least record mass one, cycle rank two). -/
theorem two_spread_ledger :
    (∀ (F : Family (Fin 5) Bool),
        topCount (mergeRecord fig8Scenario F) fig8Measurements
          ≤ massSum (mergeTally fig8Scenario F) fig8Measurements)
    ∧ ((∃ F : Family (Fin 5) Bool, RealizingFamily fig8ParityModel.toModel F ∧
          topCount (mergeRecord fig8Scenario F) fig8Measurements = 1)
        ∧ (∀ F : Family (Fin 5) Bool, RealizingFamily fig8ParityModel.toModel F →
          2 ≤ massSum (mergeTally fig8Scenario F) fig8Measurements))
    ∧ ((∃ F : Family (Fin 4) Bool, RealizingFamily thetaParityModel.toModel F ∧
          massSum (mergeTally thetaScenario F) thetaMeasurements = 1)
        ∧ thetaNerve.H1rank = 2) :=
  ⟨fun F => topCount_le_massSum fig8Scenario F fig8Measurements,
   ⟨⟨fig8WitnessFamily, fig8WitnessFamily_realizing, fig8WitnessFamily_topCount_eq_one⟩,
     fig8_record_mass_attains_rank.1⟩,
   ⟨theta_record_mass_below_rank.2.1, theta_record_mass_below_rank.2.2⟩⟩

/-! ## (O) Pricing the degree-`n` obstruction — the AvN certificate cost

The pair-context spread (`two_spread_ledger`) prices a degree-one obstruction. A
degree-`n` obstruction with no lower shadow — GHZ, an `n`-ary XOR not implied by
its pairs — is refuted by an **all-versus-nothing certificate**: a family of
contexts with even measurement incidence but odd target, summing the constraints
to `0 = 1` over `ℤ/2` (`not_hasGlobalSection_of_avn`). Its cost is the certificate
size, the number of contexts one must hold together to derive the contradiction:
at least one context (`avnCertificate_nonempty`), and GHZ is priced at four
(`ghz_priced`) — the minimal contextual family, none of whose proper subsets is
itself a certificate (the pair sub-shadows are consistent, `ghz_not_pairs`). This
makes the reconciliation cost total: every obstruction, pair or `n`-ary, carries a
number. -/

/-- An **all-versus-nothing certificate**: a family of contexts in the scenario with
even measurement incidence and odd target — a `ℤ/2` derivation of `0 = 1`. -/
def IsAvnCertificate [DecidableEq M] (X : XorSystem M) (S : List (List M)) : Prop :=
  (∀ C, C ∈ S → C ∈ X.scenario.contexts)
  ∧ (∀ m, xorOver (fun x => decide (x = m)) S.flatten = false)
  ∧ xorOver X.target S = true

/-- **A certificate refutes every global section.** The certificate is the degree-`n`
obstruction witness: its existence is `¬ HasGlobalSection`. -/
theorem not_hasGlobalSection_of_certificate [DecidableEq M] (X : XorSystem M)
    (S : List (List M)) (h : IsAvnCertificate X S) : ¬ HasGlobalSection X.toModel :=
  not_hasGlobalSection_of_avn X S h.1 h.2.1 h.2.2

/-- **The certificate cost is at least one.** A certificate is nonempty: the empty
family has `false` target XOR, so it cannot derive `0 = 1`. -/
theorem avnCertificate_nonempty [DecidableEq M] (X : XorSystem M) (S : List (List M))
    (h : IsAvnCertificate X S) : 1 ≤ S.length := by
  obtain ⟨_, _, htgt⟩ := h
  match S with
  | [] => exact absurd htgt (by simp only [xorOver]; decide)
  | _ :: _ => exact Nat.succ_le_succ (Nat.zero_le _)

/-- Every GHZ measurement has even incidence across the four contexts. -/
theorem ghz_even_all (m : GhzM) :
    xorOver (fun x => decide (x = m)) ghzContexts.flatten = false := by
  by_cases hm : m ∈ ghzAllM
  · exact (by decide : ∀ m ∈ ghzAllM,
      xorOver (fun x => decide (x = m)) ghzContexts.flatten = false) m hm
  · exact absurd (ghzAllM_complete m) hm

/-- **GHZ is priced at four.** The four GHZ contexts form an all-versus-nothing
certificate — even incidence (`ghz_even_all`), odd target — of size four, and no
proper pair sub-shadow is itself a certificate (`ghz_not_pairs`): the degree-three
obstruction costs four contexts held together, the minimal Mermin family. -/
theorem ghz_priced :
    IsAvnCertificate ghzXor ghzContexts ∧ ghzContexts.length = 4 := by
  refine ⟨⟨fun C hC => hC, ghz_even_all, by decide⟩, rfl⟩

/-- **The reconciliation cost is total.** Every obstruction carries a certificate
cost: a pair obstruction is priced by the spread (`two_spread_ledger`), and a
degree-`n` obstruction by its all-versus-nothing certificate size, at least one
(`avnCertificate_nonempty`) and realized at four for GHZ (`ghz_priced`). The
degree-`n` price is the number of contexts attended together to see the
contradiction. -/
theorem reconciliation_cost_total :
    (∀ [DecidableEq M] (X : XorSystem M) (S : List (List M)),
        IsAvnCertificate X S → 1 ≤ S.length ∧ ¬ HasGlobalSection X.toModel)
    ∧ (IsAvnCertificate ghzXor ghzContexts ∧ ghzContexts.length = 4) :=
  ⟨fun X S h => ⟨avnCertificate_nonempty X S h, not_hasGlobalSection_of_certificate X S h⟩,
   ghz_priced⟩

end QuantumContextuality
end Obsmetrologia
