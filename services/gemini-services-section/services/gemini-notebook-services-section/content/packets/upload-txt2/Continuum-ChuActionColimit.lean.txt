import Obsmetrologia.Calculus.Logic.LinearLogicChu
import Obsmetrologia.CausalSets.Continuum.Colimit

/-!
# The Chu geometry's information action is an attained colimit

A causal geometry valued in the FOUR is a **Chu space** `⟨pts, sts, r : pts → sts → Charge⟩`
([LinearLogicChu.lean](../../../Calculus/Logic/LinearLogicChu.lean)): the matrix `r` records, for each
point/state pair, one of `⊥ₖ / t / f / ⊤ₖ` — spacelike/told-nothing, told-one-bit, or held
contradiction. The would-be Riemannian manifold is this Chu space; its metric content is the
FOUR-valued incidence matrix.

This module supplies **construction (2)** that [CausalSets.Continuum.Colimit.lean](CausalSets.Continuum.Colimit.lean) names as
missing for `thm:bd-action-continuum-colimit`: a *non-arbitrary* action functional on the
refinement tower, instantiated. The functional is the **FOUR information content** (told-bits):
`kContent q = [q.pos] + [q.neg]` — `⊥ₖ ↦ 0`, `t,f ↦ 1`, `⊤ₖ ↦ 2`, the Tiles measured content in
bits. Because the knowledge order `≤ₖ` is the coordinatewise order on the two slots, `kContent` is
`≤ₖ`-**monotone** (`kContent_mono`): refinement only accretes information.

As a sprinkling reveals more of the Chu geometry, the total observed knowledge climbs `≤ₖ`
(`observedKnowledge_mono`), giving a concrete `RefinementTower` (`chuTower`). The abstract attained-join
lemma then applies to the *actual* information action: its `V → ∞` continuum value is **attained at a
finite stage** (`chu_info_action_continuum_attained`) — a directed-join colimit, not an `ε–δ` limit.

**Scope.** What is green: the **information** action (the `≤ₖ`-monotone FOUR content) on the
Chu refinement tower is an attained colimit. What stays **red** and is *not* claimed here: the Möbius
gravitational Benincasa–Dowker action is *not* a `≤ₖ`-monotone single-`Charge` functional (it is a
Möbius sum over a growing poset), so it is **not** instantiable by this route — that instantiation, and
the metric Ricci magnitude `−¼∫R√g`, remain the open frontier (`thm:bd-action-continuum-colimit`,
`thm:sym-trace-is-ricci-scalar`). This closes construction (2) for the information action only,
demonstrating the colimit mechanism on a real functional read off the Chu geometry.

## Main definitions

* `kContent` — the FOUR information content of a charge (told-bits): `⊥↦0, t/f↦1, ⊤↦2`.
* `ofMatrix` — a `Charge`-valued causal matrix as a Chu space over FOUR (the geometry as Chu space).
* `observedKnowledge` — the join of a Chu space's matrix over a list of revealed cells.
* `chuTower` — a refinement tower from a `⊆`-growing reveal sequence of cells.

## Main results

* `kContent_mono` — the information content is `≤ₖ`-monotone.
* `observedKnowledge_mono` — revealing more cells only accretes knowledge.
* `chu_info_action_continuum_attained` — the information action's continuum value is an attained colimit.
* `chu_constructive_continuum_colimit_attained_below_omega` — the same attained colimit bundled with
  the Bishop-real and real stochastic interval carriers.

## References

`content/.../chu-space-over-four`; the Chu space of `Obsmetrologia.ChuSpace` (LinearLogicChu), the refinement
tower of `Lorentzian.ContinuumColimit`, the FOUR knowledge order of `Obsmetrologia.Settling`.

## Tags

Chu space, FOUR, information content, refinement tower, directed-join colimit, continuum limit
-/

namespace Obsmetrologia
namespace CausalSets.Continuum.ChuActionColimit

open Obsmetrologia.Charge
open Obsmetrologia.Closure.Scott
open Obsmetrologia.CausalSets.Continuum.Colimit

/-! ## (A) The FOUR information content — the monotone action functional -/

/-- The **FOUR information content** of a charge: the number of bits it tells, `[q.pos] + [q.neg]`.
`⊥ₖ ↦ 0` (told nothing), `t ↦ 1` / `f ↦ 1` (told one bit), `⊤ₖ ↦ 2` (told both — held contradiction).
The Tiles measured content read as an integer action. -/
def kContent (q : Charge) : Int := (if q.pos then 1 else 0) + (if q.neg then 1 else 0)

/-- **The information content is `≤ₖ`-monotone.** Since `≤ₖ` is the coordinatewise order on the two
slots `(pos, neg)`, climbing the knowledge order can only *add* told-bits — `KLE a b → kContent a ≤
kContent b`. This is what makes `kContent` an admissible action functional for the attained-join
colimit. -/
theorem kContent_mono : ∀ a b, KLE a b → kContent a ≤ kContent b := by
  intro a b h; cases a <;> cases b <;> first | rfl | (revert h; decide)

/-! ## (B) The geometry as a Chu space over FOUR -/

/-- **A causal charge matrix as a Chu space over FOUR.** Any `Charge`-valued matrix `r : E → E →
Charge` (a point's FOUR-valued influence at each event — `⊥` spacelike, `t/f` causal, `⊤` conflict) is
a Chu space: the "Riemannian manifold" is the Chu space, its metric content the FOUR incidence. -/
def ofMatrix (E : Type) (r : E → E → Charge) : ChuSpace where
  pts := E
  sts := E
  r := r

/-! ## (C) Observed knowledge and the Chu refinement tower -/

/-- The **observed knowledge** of a Chu space over a list of revealed point/state cells: the
knowledge-join `⋁ₖ` of the FOUR entries seen. The total settled information of the revealed geometry. -/
def observedKnowledge (C : ChuSpace) (cells : List (C.pts × C.sts)) : Charge :=
  Obsmetrologia.Closure.Scott.sup (cells.map (fun p => C.r p.1 p.2))

/-- **Revealing more cells only accretes knowledge.** If `cells₁ ⊆ cells₂`, the observed knowledge
climbs `≤ₖ` — each entry of the smaller join is an entry of the larger, dominated by its sup. The
order-theoretic content of "a finer sprinkling witnesses more of the geometry". -/
theorem observedKnowledge_mono (C : ChuSpace) (cells₁ cells₂ : List (C.pts × C.sts))
    (h : cells₁ ⊆ cells₂) :
    KLE (observedKnowledge C cells₁) (observedKnowledge C cells₂) := by
  apply sup_le
  intro a ha
  rw [List.mem_map] at ha
  obtain ⟨p, hp, rfl⟩ := ha
  exact le_sup (List.mem_map.mpr ⟨p, h hp, rfl⟩)

/-- **The Chu refinement tower.** A `⊆`-growing reveal sequence `reveal : ℕ → cells` (the sprinkling
disclosing more of the Chu geometry over refinement levels) gives a concrete `RefinementTower`: stage
`n` is the knowledge observed at level `n`, and refinement is `≤ₖ`-monotone by
`observedKnowledge_mono`. -/
def chuTower (C : ChuSpace) (reveal : Nat → List (C.pts × C.sts))
    (hrev : ∀ n, reveal n ⊆ reveal (n + 1)) : RefinementTower where
  stage n := observedKnowledge C (reveal n)
  refines n := observedKnowledge_mono C _ _ (hrev n)

/-! ## (D) The information action's continuum limit is an attained colimit -/

/-- **The Chu geometry's information action is an attained colimit.** For a Chu space disclosed by a
`⊆`-growing sprinkling, the `V → ∞` continuum value of the FOUR information action `kContent` over the
refinement tower equals its value at a finite stage and is attained there — a directed-join colimit,
not an `ε–δ` limit. This realizes construction (2) of the continuum-colimit program for the *actual*
(information) action functional, read off the Chu matrix.

The Möbius gravitational Benincasa–Dowker action is not a `≤ₖ`-monotone single-`Charge` functional, so
its continuum instantiation — and the metric Ricci magnitude — remain the open frontier; this is the
information action only. -/
theorem chu_info_action_continuum_attained (C : ChuSpace)
    (reveal : Nat → List (C.pts × C.sts)) (hrev : ∀ n, reveal n ⊆ reveal (n + 1)) (N : Nat) :
    kContent ((chuTower C reveal hrev).upto N).sup = kContent ((chuTower C reveal hrev).stage N)
    ∧ ∃ s ∈ ((chuTower C reveal hrev).upto N).elems,
        kContent s = kContent (((chuTower C reveal hrev).upto N).sup)
        ∧ ∀ y ∈ ((chuTower C reveal hrev).upto N).elems, kContent y ≤ kContent s :=
  tower_continuum_attained (chuTower C reveal hrev) N kContent kContent_mono

/-- **The Chu information-action constructive-continuum certificate.** A `⊆`-growing Chu reveal has its
FOUR information action attained at the finite ordinal stage `ofNat N ≤ ω`; the same certificate records
that the continuum carrier is the internally derived Bishop-real `κ=ω` completion and that `[0,1]` over
those reals is the stochastic value category. -/
theorem chu_constructive_continuum_colimit_attained_below_omega (C : ChuSpace)
    (reveal : Nat → List (C.pts × C.sts)) (hrev : ∀ n, reveal n ⊆ reveal (n + 1)) (N : Nat) :
    Ord.Le (Ord.ofNat N) Ord.omega
    ∧ Obsmetrologia.CausalSets.Continuum.Colimit.BishopRealScottCompletion
    ∧ Obsmetrologia.CausalSets.Continuum.Colimit.RealStochasticIntervalValueCategory
    ∧ kContent ((chuTower C reveal hrev).upto N).sup
        = kContent ((chuTower C reveal hrev).stage N)
    ∧ ∃ s ∈ ((chuTower C reveal hrev).upto N).elems,
        kContent s = kContent (((chuTower C reveal hrev).upto N).sup)
        ∧ ∀ y ∈ ((chuTower C reveal hrev).upto N).elems, kContent y ≤ kContent s :=
  Obsmetrologia.CausalSets.Continuum.Colimit.constructive_continuum_colimit_attained_below_omega
    (chuTower C reveal hrev) N kContent kContent_mono

/-- **Chu information-action colimit — the bundled headline.** Read off a Chu space over FOUR (the
geometry):

* the FOUR information action `kContent` is `≤ₖ`-monotone (`kContent_mono`);
* a `⊆`-growing sprinkling accretes observed knowledge (`observedKnowledge_mono`), a concrete
  refinement tower;
* the action's continuum value over the tower is **attained at a finite stage**
  (`chu_info_action_continuum_attained`) — a colimit, not an `ε–δ` limit.

Construction (2) for the information action; the Möbius gravitational action and metric Ricci stay the
open frontier. -/
theorem chu_action_colimit (C : ChuSpace)
    (reveal : Nat → List (C.pts × C.sts)) (hrev : ∀ n, reveal n ⊆ reveal (n + 1)) (N : Nat) :
    (∀ a b, KLE a b → kContent a ≤ kContent b)
    ∧ (∀ cells₁ cells₂ : List (C.pts × C.sts), cells₁ ⊆ cells₂ →
        KLE (observedKnowledge C cells₁) (observedKnowledge C cells₂))
    ∧ kContent ((chuTower C reveal hrev).upto N).sup = kContent ((chuTower C reveal hrev).stage N) :=
  ⟨kContent_mono, observedKnowledge_mono C, (chu_info_action_continuum_attained C reveal hrev N).1⟩

end CausalSets.Continuum.ChuActionColimit
end Obsmetrologia
