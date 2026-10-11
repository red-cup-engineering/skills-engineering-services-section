import Obsmetrologia.AperiodicOrder.Defect
import Obsmetrologia.QuantumContextuality.KCBS

/-! # The five-site disclination's boundary link and the KCBS pentagon

The five-coordinated disclination (`AperiodicOrder.Defect.Disclination`) closes its
boundary at the sixth traversal: thirty unit steps, `iterateLoop 5 6`. This module
derives the two commuting periodicities of that closed boundary. The intrinsic
coordinate `linkOf i := i % 5` names the cone edge a step traverses, because
`iterateLoop 5 6` concatenates six copies of the five-step cone loop; the frame
coordinate `frameOf i := i % 6` is the developed period, because the developed
state repeats with period six (`stateAt_add_six`). The two coordinates jointly
determine the step and every pair is realized (`link_frame_injective`,
`link_frame_surjective`: `30 = 5 · 6`), the developed state and the frame
coordinate determine each other (`frame_carries_state`, `state_carries_frame`),
and consecutive-step adjacency descends along the link coordinate onto the
pentagon `D5.adj` — the KCBS exclusivity graph — and along the frame coordinate
onto the hexagon (`boundaryAdj_descends_pentagon`, `boundaryAdj_descends_hex`).
The KCBS contexts are the edges of the descended pentagon
(`kcbsContexts_eq_pentagon_edges`, `mem_kcbsContexts_iff`).

Two distinct boundary visits of one link vertex develop to distinct states
(`link_vertex_never_redevelops`): the intrinsic pentagon admits no single-valued
development, while the developed hexagon carries no memory of the link
coordinate. The disclination of `five_loop_does_a_six` is the coprimality of the
two periods.

## Main definitions

* `stateAt` — the developed state after `i` steps of the closed boundary.
* `linkOf`, `frameOf` — the mod-5 link coordinate and mod-6 frame coordinate.
* `crtStep` — the boundary step realizing a given link vertex and frame phase.
* `boundaryAdj`, `hexAdj` — consecutive adjacency on the thirty-step boundary
  cycle and on the six frame phases.

## Main results

* `stateAt_add_six`, `stateAt_add_six_mul` — the developed state has period six.
* `link_frame_injective`, `link_frame_surjective` — the two coordinates are
  jointly injective and jointly surjective on the thirty steps.
* `frame_carries_state`, `state_carries_frame` — the developed state and the
  frame coordinate determine each other.
* `link_vertex_never_redevelops` — distinct visits of one link vertex develop
  apart.
* `boundaryAdj_descends_pentagon`, `pentagon_lifts_to_boundary`,
  `boundaryAdj_descends_hex` — the boundary cycle covers the pentagon `D5.adj`
  and the hexagon.
* `kcbsContexts_eq_pentagon_edges`, `mem_kcbsContexts_iff` — the KCBS contexts
  are the pentagon's edges.
* `five_site_link_is_kcbs_pentagon` — the bundle.

## Implementation notes

Statements naming only `stateAt`, `linkOf`, `frameOf`, and `crtStep` audit with
no axioms. Statements naming `D5.adj`, `kcbsContexts`, `boundaryAdj`, or
`hexAdj` carry `propext` through the `Fin` literal-arithmetic and `Or`
instances those constants are built on, as `D5.act_preserves_adj` already does.

## References

Corpus: `imaging-kcbs-pentagon`; the crystal defect memos. Built on
`AperiodicOrder.Defect` and `QuantumContextuality.PentagonSymmetry`/`KCBS`.

## Tags

disclination, link, pentagon, five-cycle, KCBS, holonomy, covering
-/

namespace Obsmetrologia
namespace QuantumContextuality
namespace DisclinationLink

open Obsmetrologia.AperiodicOrder.Defect.Disclination

/-- The developed state after `i` steps of the five-site's closed boundary: the
boundary word is `iterateLoop 5 6 = List.replicate 30 1`, so the `i`-step prefix
is `List.replicate i 1`. -/
def stateAt (i : Nat) : State := develop (List.replicate i 1) start

/-- The link coordinate of a boundary step: which of the five cone edges it
traverses. `iterateLoop 5 6` concatenates six copies of `coneLoop 5`, so step `i`
traverses cone edge `i % 5`. -/
def linkOf (i : Fin 30) : Fin 5 := ⟨i.val % 5, Nat.mod_lt _ (by decide)⟩

/-- The frame coordinate of a boundary step: the developed period-six phase. -/
def frameOf (i : Fin 30) : Fin 6 := ⟨i.val % 6, Nat.mod_lt _ (by decide)⟩

/-- The boundary step with a given link vertex and frame phase: the Chinese
remainder witness `6a + 25b mod 30`, since `6 ≡ 1 (mod 5)` and `25 ≡ 1 (mod 6)`. -/
def crtStep (a : Fin 5) (b : Fin 6) : Fin 30 :=
  ⟨(6 * a.val + 25 * b.val) % 30, Nat.mod_lt _ (by decide)⟩

/-- Consecutive adjacency on the closed thirty-step boundary cycle. -/
def boundaryAdj (i j : Fin 30) : Prop := j = i + 1 ∨ i = j + 1

/-- Consecutive adjacency on the six frame phases: the hexagon. -/
def hexAdj (a b : Fin 6) : Prop := b = a + 1 ∨ a = b + 1

/-! ## The boundary word and its closure -/

/-- The closed boundary word: six cone-loop traversals are thirty unit steps. -/
theorem iterateLoop_five_six : iterateLoop 5 6 = List.replicate 30 1 := rfl

/-- Step `i + 1` extends step `i` by one boundary move. -/
theorem boundary_step : ∀ i : Nat, stateAt (i + 1) = move (stateAt i) 1 := by
  have hrep : ∀ n : Nat, List.replicate (n + 1) (1 : Nat)
      = List.replicate n 1 ++ [1] := by
    intro n
    induction n with
    | zero => rfl
    | succ m ih =>
      show 1 :: List.replicate (m + 1) 1 = 1 :: (List.replicate m 1 ++ [1])
      rw [ih]
  intro i
  show develop (List.replicate (i + 1) 1) start = move (stateAt i) 1
  rw [hrep i, develop_append]
  rfl

/-- The boundary closes at step thirty. -/
theorem boundary_closes : stateAt 30 = start := five_loop_does_a_six.1

/-! ## The developed state has period six -/

/-- Six more steps develop to the same state: the hexagonal closure of
`hex_loop_closes`, at every prefix depth. -/
theorem stateAt_add_six : ∀ r : Nat, stateAt (r + 6) = stateAt r
  | 0 => rfl
  | r + 1 => by
    show stateAt (r + 6 + 1) = stateAt (r + 1)
    rw [boundary_step (r + 6), stateAt_add_six r, ← boundary_step r]

/-- Whole hexagonal periods develop away. -/
theorem stateAt_add_six_mul : ∀ (k r : Nat), stateAt (r + 6 * k) = stateAt r
  | 0, _ => rfl
  | k + 1, r => by
    rw [Nat.mul_succ, ← Nat.add_assoc, stateAt_add_six, stateAt_add_six_mul k r]

/-! ## The two coordinates split the boundary -/

/-- **The two coordinates are jointly injective**: a boundary step is determined
by its link coordinate and its frame coordinate — `30 = 5 · 6` and the periods
are coprime. -/
theorem link_frame_injective :
    ∀ i j : Fin 30, linkOf i = linkOf j → frameOf i = frameOf j → i = j := by
  decide

/-- `crtStep` realizes its coordinates. -/
theorem crtStep_link_frame :
    ∀ (a : Fin 5) (b : Fin 6), linkOf (crtStep a b) = a ∧ frameOf (crtStep a b) = b := by
  decide

/-- **The two coordinates are jointly surjective**: every pair of a link vertex
and a frame phase is realized by a boundary step. -/
theorem link_frame_surjective :
    ∀ (a : Fin 5) (b : Fin 6), ∃ i : Fin 30, linkOf i = a ∧ frameOf i = b :=
  fun a b => ⟨crtStep a b, crtStep_link_frame a b⟩

/-- The six phase states are pairwise distinct. -/
theorem stateAt_phase_injective :
    ∀ r s : Fin 6, stateAt r.val = stateAt s.val → r = s := by
  decide

/-- The frame coordinate carries the developed state: equal phases develop
equal. -/
theorem frame_carries_state :
    ∀ i j : Fin 30, frameOf i = frameOf j → stateAt i.val = stateAt j.val := by
  decide

/-- The developed state carries the frame coordinate: equal developments have
equal phases. -/
theorem state_carries_frame :
    ∀ i j : Fin 30, stateAt i.val = stateAt j.val → frameOf i = frameOf j := by
  decide

/-- **A link vertex never redevelops.** Two distinct boundary visits of one link
vertex develop to distinct states: the intrinsic pentagon admits no single-valued
development. This is the disclination of `five_loop_does_a_six` in link terms. -/
theorem link_vertex_never_redevelops (i j : Fin 30) (hl : linkOf i = linkOf j)
    (hne : i ≠ j) : stateAt i.val ≠ stateAt j.val :=
  fun hs => hne (link_frame_injective i j hl (state_carries_frame i j hs))

/-! ## The boundary cycle covers the pentagon and the hexagon -/

/-- The link coordinate steps with the boundary: `30 ≡ 0 (mod 5)`. -/
theorem linkOf_succ : ∀ i : Fin 30, linkOf (i + 1) = linkOf i + 1 := by
  decide

/-- The frame coordinate steps with the boundary: `30 ≡ 0 (mod 6)`. -/
theorem frameOf_succ : ∀ i : Fin 30, frameOf (i + 1) = frameOf i + 1 := by
  decide

/-- **Boundary adjacency descends to the pentagon**: consecutive boundary steps
have `D5.adj`-adjacent link coordinates — the KCBS exclusivity graph. -/
theorem boundaryAdj_descends_pentagon (i j : Fin 30) (h : boundaryAdj i j) :
    D5.adj (linkOf i) (linkOf j) := by
  cases h with
  | inl hj =>
    subst hj
    exact Or.inl (linkOf_succ i)
  | inr hi =>
    subst hi
    exact Or.inr (linkOf_succ j)

/-- **Every pentagon edge lifts to the boundary**: each `D5.adj` edge is the
image of a consecutive boundary pair. -/
theorem pentagon_lifts_to_boundary (a b : Fin 5) (h : D5.adj a b) :
    ∃ i j : Fin 30, boundaryAdj i j ∧ linkOf i = a ∧ linkOf j = b := by
  cases h with
  | inl hb =>
    refine ⟨crtStep a 0, crtStep a 0 + 1, Or.inl rfl, (crtStep_link_frame a 0).1, ?_⟩
    rw [linkOf_succ, (crtStep_link_frame a 0).1, hb]
  | inr ha =>
    refine ⟨crtStep b 0 + 1, crtStep b 0, Or.inr rfl, ?_, (crtStep_link_frame b 0).1⟩
    rw [linkOf_succ, (crtStep_link_frame b 0).1, ha]

/-- **Boundary adjacency descends to the hexagon**: consecutive boundary steps
have adjacent frame phases. -/
theorem boundaryAdj_descends_hex (i j : Fin 30) (h : boundaryAdj i j) :
    hexAdj (frameOf i) (frameOf j) := by
  cases h with
  | inl hj =>
    subst hj
    exact Or.inl (frameOf_succ i)
  | inr hi =>
    subst hi
    exact Or.inr (frameOf_succ j)

/-! ## The KCBS contexts are the pentagon's edges -/

/-- The KCBS context list is the pentagon's edge list: context `i` is the vertex
pair `[i, i + 1]`. -/
theorem kcbsContexts_eq_pentagon_edges :
    kcbsContexts = ([0, 1, 2, 3, 4] : List (Fin 5)).map (fun i => [i, i + 1]) := by
  decide

/-- Membership form: a context is a KCBS context iff it is a pentagon edge. -/
theorem mem_kcbsContexts_iff (C : List (Fin 5)) :
    C ∈ kcbsContexts ↔ ∃ i : Fin 5, C = [i, i + 1] := by
  constructor
  · intro h
    cases h with
    | head => exact ⟨0, by decide⟩
    | tail _ h => cases h with
      | head => exact ⟨1, by decide⟩
      | tail _ h => cases h with
        | head => exact ⟨2, by decide⟩
        | tail _ h => cases h with
          | head => exact ⟨3, by decide⟩
          | tail _ h => cases h with
            | head => exact ⟨4, by decide⟩
            | tail _ h => nomatch h
  · intro h
    cases h with
    | intro i hC =>
      cases hC
      match i with
      | ⟨0, _⟩ => exact .head _
      | ⟨1, _⟩ => exact .tail _ (.head _)
      | ⟨2, _⟩ => exact .tail _ (.tail _ (.head _))
      | ⟨3, _⟩ => exact .tail _ (.tail _ (.tail _ (.head _)))
      | ⟨4, _⟩ => exact .tail _ (.tail _ (.tail _ (.tail _ (.head _))))

/-- Each pentagon edge pair is `D5.adj`-adjacent. -/
theorem pentagon_edge_adj : ∀ i : Fin 5, D5.adj i (i + 1) := fun _ => Or.inl rfl

/-! ## The bundle -/

/-- Bundles the weld: the five-site's boundary closes at the sixth traversal; the
link and frame coordinates jointly determine the step and every pair is realized;
the developed state and the frame coordinate determine each other; boundary
adjacency descends onto the pentagon `D5.adj` and every pentagon edge lifts; and
the KCBS contexts are the pentagon's edges. -/
theorem five_site_link_is_kcbs_pentagon :
    (develop (iterateLoop 5 6) start = start)
    ∧ (∀ i j : Fin 30, linkOf i = linkOf j → frameOf i = frameOf j → i = j)
    ∧ (∀ (a : Fin 5) (b : Fin 6), ∃ i : Fin 30, linkOf i = a ∧ frameOf i = b)
    ∧ (∀ i j : Fin 30, frameOf i = frameOf j → stateAt i.val = stateAt j.val)
    ∧ (∀ i j : Fin 30, stateAt i.val = stateAt j.val → frameOf i = frameOf j)
    ∧ (∀ i j : Fin 30, boundaryAdj i j → D5.adj (linkOf i) (linkOf j))
    ∧ (∀ a b : Fin 5, D5.adj a b →
        ∃ i j : Fin 30, boundaryAdj i j ∧ linkOf i = a ∧ linkOf j = b)
    ∧ (kcbsContexts = ([0, 1, 2, 3, 4] : List (Fin 5)).map (fun i => [i, i + 1])) :=
  ⟨five_loop_does_a_six.1, link_frame_injective, link_frame_surjective,
    frame_carries_state, state_carries_frame, boundaryAdj_descends_pentagon,
    pentagon_lifts_to_boundary, kcbsContexts_eq_pentagon_edges⟩

end DisclinationLink
end QuantumContextuality
end Obsmetrologia
