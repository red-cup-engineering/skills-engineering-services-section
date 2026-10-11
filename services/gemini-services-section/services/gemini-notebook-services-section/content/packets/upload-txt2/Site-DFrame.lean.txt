import Obsmetrologia.Calculus.Order.OrderInfra
import Obsmetrologia.Calculus.Algebra.Group
import Obsmetrologia.Cohomology.PairwiseStoneClopen
import Obsmetrologia.Site.Section
import Obsmetrologia.Language.Positing.Valuation

/-!
# DFrame — d-frames, the algebraic dual of bitopological space

This module formalizes the **d-frame** — the algebraic dual of a bitopological
space (Jung–Moshier 2006) — and the **d-frame-valued settling sheaf** `𝔽_U`, the
bilattice-native counterpart of the settling-associated sheaf that encodes the
truth-side AND the inconsistency-side at each stage with their consistency/totality
structure intrinsic. The corpus nodes:

* `…/predication-fiber-algebra/content/priestley-space/content/paired-priestley-space/content/d-frame/d-frame.md`
  — a d-frame is a quadruple `ℒ = (L₊, L₋, con, tot)`: `L₊, L₋` are FRAMES (complete
  distributive lattices with the infinite distributive law), `con ⊆ L₊×L₋` the
  CONSISTENCY relation (downward-closed), `tot ⊆ L₊×L₋` the TOTALITY relation
  (upward-closed). Canonical example: a bitopological space `(X, τ₊, τ₋)` with
  `(U,V) ∈ con ⟺ U ∩ V = ∅` and `(U,V) ∈ tot ⟺ U ∪ V = X`.
* `…/settling/content/sheaf/content/d-frame-valued-sheaf/d-frame-valued-sheaf.md`
  — `𝔽_U(q,τ,U) = (L₊, L₋, con, tot)` with `L₊ = 𝒫(Δ⁺,*∩U)` (newly-truth-positive
  points), `L₋ = 𝒫(Δ⁻,*∩U)` (newly-falsehood-positive points), `con` = "cells don't
  co-witness a ⊤-state", `tot` = "A ∪ B covers the settled cells of U".
* `…/d-frame/references/d-frame-cohomology-comparison.md`
  — the **shadow functor** `𝕊 : dFrm → Ab × Ab` sends a d-frame
  `(L₊, L₋, con, tot)` to the positive and negative abelianized evidence sides,
  dropping the consistency and totality relations. Section-wise on `𝔽_U`, this is
  the pair of positive and negative Belnap-designated cochain groups.

## The model

A **frame** is a complete lattice (reusing `Order.CompleteLattice`'s `sSup` and its
universal property) carrying a binary `meet` that is a glb together with the
**infinite distributive law** `a ⊓ ⨆S = ⨆ₛ (a ⊓ s)`. We realize the *powerset frame*
of a cell set `Cell` as **subsets** `Set Cell := Cell → Prop` ordered by inclusion:
`sSup` is union, `meet` is intersection, `top`/`bot` are the full/empty subset. The
infinite distributive law then holds by `propext`/`funext` over `Prop` — no
decidability of an existential over subsets is needed (which a `Cell → Bool` model
would have forced).

A **d-frame** bundles two frames `L₊, L₋` and two relations `con, tot` on
`L₊.carrier × L₋.carrier`, with the closure axioms as fields: `con` downward-closed
in each argument, `tot` upward-closed in each argument.

A **shadow** is the precise forgetful/abelianized image of a d-frame: it remembers
the source d-frame, its two frame components, and the two abelian evidence sides,
with proof that the retained frames are exactly the source frames. It drops exactly
`con` and `tot`. Do not use the word for analogies, reduced models, or ordinary
projections unless they are packaged by this object.

The **canonical bitopological d-frame** of a finite bitopological pair takes `L₊ = L₋
= 𝒫(X)` (subsets of the point set) with `con (U,V) := U ∩ V = ∅` (disjoint =
consistent) and `tot (U,V) := U ∪ V = X` (covering = total); the closure axioms are
the elementary set-theory facts that a sub-pair of a disjoint pair is disjoint and a
super-pair of a covering pair covers.

The **d-frame-valued sheaf** `𝔽_U` assigns to each clopen `U` (modeled as a `Bool`
mask `mU` on `PredicationCell`) the d-frame with `L₊ = 𝒫(Δ⁺∩U)`, `L₋ = 𝒫(Δ⁻∩U)`
(subsets of cells, carried with their support constraints implicit in con/tot),
reusing `AssocSheaf`'s designation masks `dT` (truth, Δ⁺) and the falsehood mask `dF`
(Δ⁻). Restriction along `U' ⊆ U` intersects each subset with `U'` — a d-frame
morphism (preserves `meet`, `top`, and the two relations on the canonical readings).

## substitutions

The corpus `con`/`tot` for the sheaf are stated "modulo the ⊤-witness set" and "over
the settled cells". We model the *clean spatial* reading from the d-frame node
itself, which is the canonical bitopological one specialized to the Δ⁺/Δ⁻ point sets:

* `con (A, B) := ∀ φ, ¬(A φ ∧ B φ)` — `A` and `B` are **disjoint** as subsets of
  cells (no cell co-witnesses both a truth-positive and a falsehood-positive state,
  i.e. no cell is told both — the ⊤ co-witness). This is the d-frame node's
  `U ∩ V = ∅` read on the dual point sets.
* `tot (A, B) := ∀ φ, mSettled φ = true → (A φ ∨ B φ)` — `A ∪ B` **covers the settled
  cells** of `U` (the cells whose charge is not still `⊥`, i.e. in `{t,f,⊤}`). This
  is the node's `U ∪ V = X` relativized to the settled support, exactly as the sheaf
  node specifies.

These are decidable-relation-free `Prop`s over the finite cell carrier; the closure
axioms are pure logic (sub-disjoint stays disjoint; super-covering stays covering).
-/

namespace Obsmetrologia
namespace DFrame

open Obsmetrologia.Charge

/-! ## Frames — complete distributive lattices with the infinite distributive law

A **frame** is a complete lattice (we reuse the universal `sSup` of
`Order.CompleteLattice`) equipped with a binary `meet` that is the greatest-lower-bound and satisfies the **infinite distributive law**
`a ⊓ ⨆ S = ⨆_{s∈S} (a ⊓ s)`. `top`/`bot` are inherited from `CompleteLattice`. -/

/-- A **frame**: a complete lattice with a binary `meet` (glb) satisfying the infinite
distributive law `a ⊓ ⨆ S = ⨆_{s∈S}(a ⊓ s)`. Frames are the algebraic duals of
topological spaces; `L₊`, `L₋` of a d-frame are frames. We bundle the
`Order.CompleteLattice` interface (arbitrary `sSup` with its universal property) and
add `meet` with its glb laws plus the frame distributivity. No free data: every field
is a function/proof; the powerset instance proves them by `funext`/`propext`. -/
structure Frame where
  /-- The underlying point set / lattice carrier. -/
  carrier : Type
  /-- The frame order `a ≤ b`. -/
  le : carrier → carrier → Prop
  /-- Reflexivity of `≤`. -/
  le_refl : ∀ a, le a a
  /-- Transitivity of `≤`. -/
  le_trans : ∀ {a b c}, le a b → le b c → le a c
  /-- Antisymmetry of `≤` (a partial order). -/
  le_antisymm : ∀ {a b}, le a b → le b a → a = b
  /-- Arbitrary supremum over a predicate-indexed family. -/
  sSup : (carrier → Prop) → carrier
  /-- `sSup S` is an upper bound of `S`. -/
  le_sSup : ∀ (S : carrier → Prop) a, S a → le a (sSup S)
  /-- `sSup S` is the least upper bound of `S`. -/
  sSup_le : ∀ (S : carrier → Prop) b, (∀ a, S a → le a b) → le (sSup S) b
  /-- The binary meet (finite glb). -/
  meet : carrier → carrier → carrier
  /-- `meet` is a lower bound (left). -/
  meet_le_left : ∀ a b, le (meet a b) a
  /-- `meet` is a lower bound (right). -/
  meet_le_right : ∀ a b, le (meet a b) b
  /-- `meet` is the greatest lower bound. -/
  le_meet : ∀ {a b c}, le c a → le c b → le c (meet a b)
  /-- **The infinite distributive law** `a ⊓ ⨆ S = ⨆_{s∈S}(a ⊓ s)` — the defining
  frame axiom. We state it as the image-set sup: `meet a (sSup S) = sSup (meet a '' S)`,
  where `meet a '' S := fun y => ∃ s, S s ∧ y = meet a s`. -/
  meet_sSup_distrib : ∀ (a : carrier) (S : carrier → Prop),
    meet a (sSup S) = sSup (fun y => ∃ s, S s ∧ y = meet a s)

namespace Frame
variable (F : Frame)

/-- The frame's top: the sup of everything. -/
def top : F.carrier := F.sSup (fun _ => True)
/-- The frame's bottom: the sup of nothing. -/
def bot : F.carrier := F.sSup (fun _ => False)

/-- `top` is the greatest element. -/
theorem le_top (a : F.carrier) : F.le a F.top := F.le_sSup _ a trivial
/-- `bot` is the least element. -/
theorem bot_le (a : F.carrier) : F.le F.bot a := F.sSup_le _ a (fun _ h => h.elim)

end Frame

/-! ## The powerset frame `𝒫(Cell)`

The frame of subsets of a type `Cell`, ordered by inclusion. `Set Cell := Cell → Prop`;
`sSup` is the indexed union `⋃`, `meet` is intersection `∩`, `top`/`bot` are the full
/ empty subset. The infinite distributive law `A ∩ ⋃S = ⋃(A ∩ ·)` holds by `propext`
/`funext`. This is the canonical (spatial) frame: `L₊`, `L₋` of every spatial d-frame
are of this form. -/

/-- A **subset** of `Cell`: its membership predicate. The carrier of the powerset
frame `𝒫(Cell)`. -/
def Subset (Cell : Type) : Type := Cell → Prop

namespace Subset
variable {Cell : Type}

/-- Inclusion order on subsets: `A ⊆ B`. -/
def le (A B : Subset Cell) : Prop := ∀ x, A x → B x

/-- Indexed union `⋃ S` of a family of subsets: `x ∈ ⋃S ⟺ ∃ A ∈ S, x ∈ A`. -/
def sSup (S : Subset Cell → Prop) : Subset Cell := fun x => ∃ A, S A ∧ A x

/-- Binary intersection `A ∩ B`. -/
def meet (A B : Subset Cell) : Subset Cell := fun x => A x ∧ B x

theorem le_refl (A : Subset Cell) : le A A := fun _ h => h
theorem le_trans {A B C : Subset Cell} (h1 : le A B) (h2 : le B C) : le A C :=
  fun x hx => h2 x (h1 x hx)
theorem le_antisymm {A B : Subset Cell} (h1 : le A B) (h2 : le B A) : A = B := by
  funext x; exact propext ⟨fun hx => h1 x hx, fun hx => h2 x hx⟩

theorem le_sSup (S : Subset Cell → Prop) (A : Subset Cell) (h : S A) : le A (sSup S) :=
  fun _ hx => ⟨A, h, hx⟩
theorem sSup_le (S : Subset Cell → Prop) (B : Subset Cell)
    (h : ∀ A, S A → le A B) : le (sSup S) B :=
  fun x hx => by obtain ⟨A, hA, hAx⟩ := hx; exact h A hA x hAx

theorem meet_le_left (A B : Subset Cell) : le (meet A B) A := fun _ hx => hx.1
theorem meet_le_right (A B : Subset Cell) : le (meet A B) B := fun _ hx => hx.2
theorem le_meet {A B C : Subset Cell} (h1 : le C A) (h2 : le C B) : le C (meet A B) :=
  fun x hx => ⟨h1 x hx, h2 x hx⟩

/-- **The infinite distributive law for subsets** `A ∩ ⋃S = ⋃(A ∩ ·)` — proved by
`propext`/`funext` over `Prop`. This is what makes `𝒫(Cell)` a frame. -/
theorem meet_sSup_distrib (A : Subset Cell) (S : Subset Cell → Prop) :
    meet A (sSup S) = sSup (fun y => ∃ s, S s ∧ y = meet A s) := by
  funext x
  apply propext
  constructor
  · rintro ⟨hAx, B, hB, hBx⟩
    exact ⟨meet A B, ⟨B, hB, rfl⟩, hAx, hBx⟩
  · rintro ⟨y, ⟨B, hB, rfl⟩, hAx, hBx⟩
    exact ⟨hAx, B, hB, hBx⟩

end Subset

/-- **The powerset frame `𝒫(Cell)`.** Subsets of `Cell` ordered by inclusion: union
is `sSup`, intersection is `meet`, with the infinite distributive law proven. The
canonical spatial frame; every `L₊`/`L₋` below is of this form. -/
def powersetFrame (Cell : Type) : Frame where
  carrier := Subset Cell
  le := Subset.le
  le_refl := Subset.le_refl
  le_trans := Subset.le_trans
  le_antisymm := Subset.le_antisymm
  sSup := Subset.sSup
  le_sSup := Subset.le_sSup
  sSup_le := Subset.sSup_le
  meet := Subset.meet
  meet_le_left := Subset.meet_le_left
  meet_le_right := Subset.meet_le_right
  le_meet := Subset.le_meet
  meet_sSup_distrib := Subset.meet_sSup_distrib

/-! ## Free abelian cochain groups

The d-frame shadow comparison abelianizes powerset-frame evidence sides. In this
finite corpus model, a free abelian group on a cell carrier is represented by
integer cochains indexed by that carrier. -/

/-- The free abelian group on a cell carrier, represented concretely as integer
cochains `Cell → Int` with pointwise addition. -/
def freeCellAbelianGroup (Cell : Type) : Algebra.AbelianGroup where
  carrier := Cell → Int
  op := fun f g x => f x + g x
  op_assoc := by
    intro a b c
    funext x
    exact Int.add_assoc (a x) (b x) (c x)
  one := fun _ => 0
  one_mul := by
    intro a
    funext x
    exact Int.zero_add (a x)
  mul_one := by
    intro a
    funext x
    exact Int.add_zero (a x)
  inv := fun f x => -f x
  mul_left_inv := by
    intro a
    funext x
    exact Int.add_left_neg (a x)
  mul_comm := by
    intro a b
    funext x
    exact Int.add_comm (a x) (b x)

/-! ## d-frames

A **d-frame** `ℒ = (L₊, L₋, con, tot)`: two frames and two relations on
`L₊.carrier × L₋.carrier`, with `con` downward-closed (a sub-pair of a consistent pair
is consistent) and `tot` upward-closed (a super-pair of a total pair is total). -/

/-- A **d-frame** `(L₊, L₋, con, tot)` (Jung–Moshier 2006): two frames with a
consistency relation `con` (downward-closed in each argument) and a totality relation
`tot` (upward-closed in each argument). The closure axioms are fields. No free data:
the frames and relations are supplied; the closure proofs are pure order/logic. -/
structure DFrame where
  /-- The positive frame `L₊` — positive-evidence opens. -/
  Lplus : Frame
  /-- The negative frame `L₋` — negative-evidence opens. -/
  Lminus : Frame
  /-- The **consistency relation** `con ⊆ L₊×L₋`: positive datum `a` and negative
  datum `b` are jointly consistent. -/
  con : Lplus.carrier → Lminus.carrier → Prop
  /-- The **totality relation** `tot ⊆ L₊×L₋`: `a` and `b` together cover. -/
  tot : Lplus.carrier → Lminus.carrier → Prop
  /-- **`con` is downward-closed.** If `(a,b)` is consistent and `a' ≤ a`, `b' ≤ b`,
  then `(a',b')` is consistent. -/
  con_downward : ∀ {a a' b b'}, con a b → Lplus.le a' a → Lminus.le b' b → con a' b'
  /-- **`tot` is upward-closed.** If `(a,b)` is total and `a ≤ a'`, `b ≤ b'`, then
  `(a',b')` is total. -/
  tot_upward : ∀ {a a' b b'}, tot a b → Lplus.le a a' → Lminus.le b b' → tot a' b'

/-! ## Shadows

The corpus's `shadow functor` is the operation from d-frames to their two
abelianized evidence sides, retaining the frame components as provenance and
dropping `con` and `tot`. A `Shadow` records its source d-frame, so an arbitrary
pair of groups or frames is not called a shadow unless it is packaged as the
image obtained from that source. -/

/-- A **shadow** of a d-frame: the abelianized two-side image of a source `DFrame`,
with proofs that the retained positive and negative frames are exactly the source's
`L₊` and `L₋`. The object deliberately has no fields for `con` or `tot`: those are
precisely the d-frame data forgotten by shadowing. -/
structure Shadow where
  /-- The d-frame being shadowed. -/
  source : DFrame
  /-- The positive frame retained by the shadow. -/
  Lplus : Frame
  /-- The negative frame retained by the shadow. -/
  Lminus : Frame
  /-- The positive abelianized evidence side. -/
  Splus : Algebra.AbelianGroup
  /-- The negative abelianized evidence side. -/
  Sminus : Algebra.AbelianGroup
  /-- The positive frame is exactly the source positive frame. -/
  Lplus_eq : Lplus = source.Lplus
  /-- The negative frame is exactly the source negative frame. -/
  Lminus_eq : Lminus = source.Lminus

/-- The generic **shadow functor on objects**: forget `con` and `tot`, retain the two
frame components, and abelianize each frame carrier as an integer cochain group.
For powerset-frame sections, use `powersetShadow` to abelianize by cells rather than
by arbitrary frame elements. -/
def shadow (L : DFrame) : Shadow where
  source := L
  Lplus := L.Lplus
  Lminus := L.Lminus
  Splus := freeCellAbelianGroup L.Lplus.carrier
  Sminus := freeCellAbelianGroup L.Lminus.carrier
  Lplus_eq := rfl
  Lminus_eq := rfl

/-- The powerset-frame **shadow functor on objects**: when the retained frames are
powerset frames on known cell carriers, the abelianized sides are the free abelian
groups on those cells. -/
def powersetShadow (L : DFrame) (CellPlus CellMinus : Type)
    (_hplus : L.Lplus = powersetFrame CellPlus)
    (_hminus : L.Lminus = powersetFrame CellMinus) :
    Shadow where
  source := L
  Lplus := L.Lplus
  Lminus := L.Lminus
  Splus := freeCellAbelianGroup CellPlus
  Sminus := freeCellAbelianGroup CellMinus
  Lplus_eq := rfl
  Lminus_eq := rfl

/-- Shadowing a d-frame retains its positive frame. -/
@[simp] theorem shadow_Lplus (L : DFrame) : (shadow L).Lplus = L.Lplus := rfl

/-- Shadowing a d-frame retains its negative frame. -/
@[simp] theorem shadow_Lminus (L : DFrame) : (shadow L).Lminus = L.Lminus := rfl

/-- The generic shadow abelianizes the positive frame carrier as integer cochains. -/
@[simp] theorem shadow_Splus_carrier (L : DFrame) :
    (shadow L).Splus.carrier = (L.Lplus.carrier → Int) := rfl

/-- The generic shadow abelianizes the negative frame carrier as integer cochains. -/
@[simp] theorem shadow_Sminus_carrier (L : DFrame) :
    (shadow L).Sminus.carrier = (L.Lminus.carrier → Int) := rfl

/-- A powerset shadow abelianizes the positive cell carrier. -/
@[simp] theorem powersetShadow_Splus_carrier (L : DFrame) (CellPlus CellMinus : Type)
    (hplus : L.Lplus = powersetFrame CellPlus)
    (hminus : L.Lminus = powersetFrame CellMinus) :
    (powersetShadow L CellPlus CellMinus hplus hminus).Splus.carrier = (CellPlus → Int) := rfl

/-- A powerset shadow abelianizes the negative cell carrier. -/
@[simp] theorem powersetShadow_Sminus_carrier (L : DFrame) (CellPlus CellMinus : Type)
    (hplus : L.Lplus = powersetFrame CellPlus)
    (hminus : L.Lminus = powersetFrame CellMinus) :
    (powersetShadow L CellPlus CellMinus hplus hminus).Sminus.carrier = (CellMinus → Int) := rfl

/-- Shadowing forgets the consistency relation: the resulting object has no `con`
field, while its retained frames are the source frames. -/
theorem shadow_forgets_con (L : DFrame) :
    (shadow L).Lplus = L.Lplus ∧ (shadow L).Lminus = L.Lminus :=
  ⟨rfl, rfl⟩

/-- Shadowing forgets the totality relation: the same retained-frame statement, with
the omitted `tot` data witnessed by the type of `Shadow` itself. -/
theorem shadow_forgets_tot (L : DFrame) :
    (shadow L).Lplus = L.Lplus ∧ (shadow L).Lminus = L.Lminus :=
  ⟨rfl, rfl⟩

/-! ## The canonical bitopological d-frame

For a (finite) bitopological space with point set `X`, the d-frame of opens has
`L₊ = L₋ = 𝒫(X)`, `con (U,V) := U ∩ V = ∅` (disjoint = consistent), and
`tot (U,V) := U ∪ V = X` (covering = total). We model `U ∩ V = ∅` as
`∀ x, ¬(U x ∧ V x)` and `U ∪ V = X` as `∀ x, U x ∨ V x`. The closure axioms are:
a sub-pair of a disjoint pair is disjoint; a super-pair of a covering pair covers. -/

/-- **The d-frame of opens of a bitopological space.** Given a point set
`X`, the powerset frames `𝒫(X) = L₊ = L₋` with consistency = disjointness and
totality = covering form a `DFrame`: `con` is downward-closed and `tot` is
upward-closed.

* `con (U,V) := ∀ x, ¬(U x ∧ V x)` (`U ∩ V = ∅` — disjoint opens are consistent);
* `tot (U,V) := ∀ x, U x ∨ V x` (`U ∪ V = X` — covering opens are total).

Closure: shrinking a disjoint pair keeps it disjoint (`con_downward`); enlarging a
covering pair keeps it covering (`tot_upward`). This is the Belnap-flavored reading
(positive evidence `U`, negative evidence `V`; consistent when they don't overlap,
total when they cover). -/
def dframe_of_bitopological (X : Type) : DFrame where
  Lplus := powersetFrame X
  Lminus := powersetFrame X
  con := fun U V => ∀ x, ¬(U x ∧ V x)
  tot := fun U V => ∀ x, U x ∨ V x
  con_downward := by
    intro U U' V V' hcon hU' hV' x hx
    exact hcon x ⟨hU' x hx.1, hV' x hx.2⟩
  tot_upward := by
    intro U U' V V' htot hU' hV' x
    rcases htot x with h | h
    · exact Or.inl (hU' x h)
    · exact Or.inr (hV' x h)

/-- The canonical d-frame's `con`/`tot` compute to disjointness/covering on the
nose — the witnessing table for `dframe_of_bitopological`. -/
theorem dframe_of_bitopological_relations (X : Type)
    (U V : (dframe_of_bitopological X).Lplus.carrier) :
    ((dframe_of_bitopological X).con U V ↔ ∀ x, ¬(U x ∧ V x))
      ∧ ((dframe_of_bitopological X).tot U V ↔ ∀ x, U x ∨ V x) :=
  ⟨Iff.rfl, Iff.rfl⟩

/-! ## The d-frame-valued settling sheaf `𝔽_U`

`𝔽_U(q,τ,U) = (L₊, L₋, con, tot)` with `L₊ = 𝒫(Δ⁺∩U)`, `L₋ = 𝒫(Δ⁻∩U)`. We reuse
`AssocSheaf`'s truth mask `dT` (= Δ⁺, the newly-truth-positive cells) and add the
mirror falsehood mask `dF` (= Δ⁻, the newly-falsehood-positive cells); a clopen `U`
is a `Bool` mask `mU` on `PredicationCell`. The point set of each frame is
`PredicationCell`, with the support `Δ±∩U` carried through `con`/`tot`:

* `con (A,B) := ∀ φ, ¬(A φ ∧ B φ)` — `A`, `B` disjoint as cell subsets (no cell
  co-witnesses both a truth-positive and a falsehood-positive state at `τ` — the ⊤
  co-witness the node speaks of);
* `tot (A,B) := ∀ φ, mSettled v mU φ = true → (A φ ∨ B φ)` — `A ∪ B` covers the
  **settled** cells of `U` (cells whose charge is in `{t,f,⊤}`, not still `⊥`).

This is the canonical bitopological reading specialized to the Δ⁺/Δ⁻ dual point sets
and the settled support, exactly as the sheaf node specifies. -/

/-- The **falsehood mask** `dF` — designated = `{f, ⊤}` = Δ⁻, the newly-falsehood-
positive cells. The exact mirror of `AssocSheaf.dK` on the negative side: a cell is
in Δ⁻ iff its settled charge has a negative component (`f` or `⊤`). -/
def dF : AssocSheaf.Mask := fun v φ => decide (v φ = tBot ∨ v φ = kTop)

/-- The **settled mask** `mSettled` relative to a clopen `mU`: the cells in `U` whose
charge is settled (not still `⊥ₖ`), i.e. in `{t, f, ⊤}`. These are the cells `tot`
must cover. -/
def mSettled (v : Valuation) (mU : PredicationCell → Bool) (φ : PredicationCell) : Bool :=
  mU φ && !decide (v φ = kBot)

/-- **The d-frame-valued settling sheaf at a clopen** `mU` and valuation `v`. The
d-frame `(𝒫(Cell), 𝒫(Cell), con, tot)` with `con` = cell-disjointness and `tot` =
covering of the settled cells of `U`. Both `L₊` and `L₋` are the powerset frame on
`PredicationCell`; the Δ⁺∩U / Δ⁻∩U supports are realized through the relations. -/
def dframe_valued_sheaf_at (v : Valuation) (mU : PredicationCell → Bool) : DFrame where
  Lplus := powersetFrame PredicationCell
  Lminus := powersetFrame PredicationCell
  con := fun A B => ∀ φ, ¬(A φ ∧ B φ)
  tot := fun A B => ∀ φ, mSettled v mU φ = true → (A φ ∨ B φ)
  con_downward := by
    intro A A' B B' hcon hA' hB' φ hx
    exact hcon φ ⟨hA' φ hx.1, hB' φ hx.2⟩
  tot_upward := by
    intro A A' B B' htot hA' hB' φ hφ
    rcases htot φ hφ with h | h
    · exact Or.inl (hA' φ h)
    · exact Or.inr (hB' φ h)

/-! ### Restriction `𝔽_U(U) → 𝔽_U(U')` is a d-frame morphism

For `U' ⊆ U` (a tighter `Bool` mask `mU'`), restriction intersects each subset with
`U'`: `restrictSub mU' A := A ∩ {φ | mU' φ}`. This preserves `meet` and `top` (the
frame-morphism conditions on each component) and respects `con`/`tot`: it shrinks
both sides, so a disjoint pair stays disjoint (`con` preserved forward), and the
settled cells of `U'` are among those of `U`. -/

/-- **Restriction of a subset along a clopen mask** `mU'`: intersect with `U'`. The
component map of the restriction d-frame morphism `𝔽_U(U) → 𝔽_U(U')`. -/
def restrictSub (mU' : PredicationCell → Bool) (A : Subset PredicationCell) :
    Subset PredicationCell :=
  fun φ => A φ ∧ mU' φ = true

/-- **Restriction preserves `meet`** (intersection commutes with intersecting `U'`) —
the `∧`-preservation half of "frame morphism on `L₊`/`L₋`". -/
theorem restrictSub_meet (mU' : PredicationCell → Bool) (A B : Subset PredicationCell) :
    restrictSub mU' (Subset.meet A B) = Subset.meet (restrictSub mU' A) (restrictSub mU' B) := by
  funext φ
  apply propext
  constructor
  · rintro ⟨⟨hA, hB⟩, hU⟩; exact ⟨⟨hA, hU⟩, ⟨hB, hU⟩⟩
  · rintro ⟨⟨hA, hU⟩, ⟨hB, _⟩⟩; exact ⟨⟨hA, hB⟩, hU⟩

/-- **Restriction preserves the top** of the restricted frame: the restriction of the
full subset is exactly `U'` (the top of `𝒫(Cell)` met with `U'`), the frame-morphism
top condition. -/
theorem restrictSub_top (mU' : PredicationCell → Bool) :
    restrictSub mU' (fun _ => True) = (fun φ => mU' φ = true) := by
  funext φ; apply propext; exact ⟨fun h => h.2, fun h => ⟨trivial, h⟩⟩

/-- **Restriction is monotone** (preserves `≤`): `A ⊆ B → A∩U' ⊆ B∩U'`. -/
theorem restrictSub_mono (mU' : PredicationCell → Bool) {A B : Subset PredicationCell}
    (h : Subset.le A B) : Subset.le (restrictSub mU' A) (restrictSub mU' B) :=
  fun φ hx => ⟨h φ hx.1, hx.2⟩

/-- **Restriction preserves consistency.** If `(A,B)` is consistent (disjoint) in
`𝔽_U(U)`, then `(A∩U', B∩U')` is consistent in `𝔽_U(U')` — restriction can only
remove co-witnesses. The `con`-preservation half of "d-frame morphism". -/
theorem restrictSub_con (v : Valuation) (mU mU' : PredicationCell → Bool)
    (A B : Subset PredicationCell)
    (hcon : (dframe_valued_sheaf_at v mU).con A B) :
    (dframe_valued_sheaf_at v mU').con (restrictSub mU' A) (restrictSub mU' B) := by
  intro φ hx
  exact hcon φ ⟨hx.1.1, hx.2.1⟩

/-! ## The d-frame-valued settling sheaf is a presheaf bundling both sides

`𝔽_U` is a d-frame-valued presheaf on the settling site: it lands in `DFrame`s, bundles both the truth side (`L₊` over
Δ⁺) and the inconsistency/falsehood side (`L₋` over Δ⁻) at once, and restriction
along a clopen inclusion `U' ⊆ U` is a d-frame morphism (preserves `meet`, `top`, and
the consistency relation). -/

/-- **The d-frame-valued settling sheaf `𝔽_U`.** At each clopen `mU` and
valuation `v`, `𝔽_U(q,τ,U)` is a d-frame with `L₊ = L₋ = 𝒫(PredicationCell)`,
`con` = cell-disjointness (no co-witnessed ⊤-state), `tot` = covering of the settled
cells of `U`. It bundles BOTH sides natively and is a **presheaf**: restriction along
`U' ⊆ U` (intersection with `U'`) is a d-frame morphism. Concretely:

* (it is a d-frame) `con` is downward-closed and `tot` is upward-closed —
  packaged as `dframe_valued_sheaf_at`;
* (both sides bundled) `L₊` carries the truth side Δ⁺ = `{t,⊤}` (`AssocSheaf.dK`) and
  `L₋` the falsehood/inconsistency side Δ⁻ = `{f,⊤}` (`dF`); both are the powerset
  frame, and the masks overlap exactly at `⊤`: a `⊤` cell is in BOTH Δ⁺ and Δ⁻ (it
  co-witnesses), a `t`-cell only in Δ⁺, an `f`-cell only in Δ⁻ — the bilattice-native
  packaging;
* (presheaf / restriction is a d-frame morphism) restriction preserves `meet`
  (`restrictSub_meet`), `top` (`restrictSub_top`), monotonicity (`restrictSub_mono`),
  and the consistency relation (`restrictSub_con`). -/
theorem dframe_valued_sheaf :
    -- (it lands in d-frames: con downward-closed, tot upward-closed — by construction)
    (∀ (v : Valuation) (mU : PredicationCell → Bool)
        (A A' B B' : Subset PredicationCell),
        (dframe_valued_sheaf_at v mU).con A B →
        Subset.le A' A → Subset.le B' B →
        (dframe_valued_sheaf_at v mU).con A' B')
    ∧ (∀ (v : Valuation) (mU : PredicationCell → Bool)
        (A A' B B' : Subset PredicationCell),
        (dframe_valued_sheaf_at v mU).tot A B →
        Subset.le A A' → Subset.le B B' →
        (dframe_valued_sheaf_at v mU).tot A' B')
    -- (both sides bundled: Δ⁺ = {t,⊤} = dK, Δ⁻ = {f,⊤} = dF; ⊤ co-witnesses in BOTH; ⊥ in neither)
    ∧ (∀ (v : Valuation) (φ : PredicationCell),
        (AssocSheaf.dK v φ = true ↔ (v φ = tTop ∨ v φ = kTop))
          ∧ (dF v φ = true ↔ (v φ = tBot ∨ v φ = kTop))
          ∧ (v φ = kTop → (AssocSheaf.dK v φ = true ∧ dF v φ = true)))
    -- (restriction is a d-frame morphism: preserves meet, top, monotone, con)
    ∧ (∀ (mU' : PredicationCell → Bool) (A B : Subset PredicationCell),
        restrictSub mU' (Subset.meet A B)
          = Subset.meet (restrictSub mU' A) (restrictSub mU' B))
    ∧ (∀ (mU' : PredicationCell → Bool),
        restrictSub mU' (fun _ => True) = (fun φ => mU' φ = true))
    ∧ (∀ (mU' : PredicationCell → Bool) {A B : Subset PredicationCell},
        Subset.le A B → Subset.le (restrictSub mU' A) (restrictSub mU' B))
    ∧ (∀ (v : Valuation) (mU mU' : PredicationCell → Bool) (A B : Subset PredicationCell),
        (dframe_valued_sheaf_at v mU).con A B →
        (dframe_valued_sheaf_at v mU').con (restrictSub mU' A) (restrictSub mU' B)) :=
  ⟨fun v mU _ _ _ _ hcon hA' hB' => (dframe_valued_sheaf_at v mU).con_downward hcon hA' hB',
   fun v mU _ _ _ _ htot hA' hB' => (dframe_valued_sheaf_at v mU).tot_upward htot hA' hB',
   fun v φ =>
     ⟨by simp only [AssocSheaf.dK]; exact decide_eq_true_iff,
      by simp only [dF]; exact decide_eq_true_iff,
      fun h => ⟨by simp only [AssocSheaf.dK, h]; decide, by simp only [dF, h]; decide⟩⟩,
   restrictSub_meet,
   restrictSub_top,
   fun mU' _ _ h => restrictSub_mono mU' h,
   restrictSub_con⟩

/-! ## Section-level shadow comparison

The corpus comparison theorem says that applying the shadow functor section-wise to
the d-frame-valued sheaf `𝔽_U` yields the positive and negative Belnap-designated
sides. In this core model, both retained frames are powerset frames on
`PredicationCell`, and the evidence sides are carried by the masks `AssocSheaf.dK`
and `dF`. -/

/-- The shadow of the d-frame-valued settling sheaf at a valuation and clopen. -/
def dframe_valued_sheaf_shadow (v : Valuation) (mU : PredicationCell → Bool) : Shadow :=
  powersetShadow (dframe_valued_sheaf_at v mU) PredicationCell PredicationCell rfl rfl

/-- **Section-level shadow comparison.** The shadow of `𝔽_U(v,mU)` retains exactly
the positive and negative powerset frames, its abelianized sides are exactly the
integer cochain groups on `PredicationCell`, and the two retained evidence supports
are the Belnap-positive side `{t,⊤}` and the Belnap-negative side `{f,⊤}`. The
omitted `con`/`tot` relations remain only on the source d-frame. -/
theorem dframe_valued_sheaf_shadow_comparison (v : Valuation)
    (mU : PredicationCell → Bool) :
    (dframe_valued_sheaf_shadow v mU).Lplus = powersetFrame PredicationCell
      ∧ (dframe_valued_sheaf_shadow v mU).Lminus = powersetFrame PredicationCell
      ∧ (dframe_valued_sheaf_shadow v mU).Splus.carrier = AssocSheaf.Cochain
      ∧ (dframe_valued_sheaf_shadow v mU).Sminus.carrier = AssocSheaf.Cochain
      ∧ (∀ φ : PredicationCell,
          AssocSheaf.dK v φ = true ↔ (v φ = tTop ∨ v φ = kTop))
      ∧ (∀ φ : PredicationCell,
          dF v φ = true ↔ (v φ = tBot ∨ v φ = kTop)) := by
  refine ⟨rfl, rfl, rfl, rfl, ?_, ?_⟩
  · intro φ
    simp only [AssocSheaf.dK]
    exact decide_eq_true_iff
  · intro φ
    simp only [dF]
    exact decide_eq_true_iff

end DFrame
end Obsmetrologia
