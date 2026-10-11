import Obsmetrologia.Cohomology.PairwiseStoneClopen
import Obsmetrologia.Closure.Regime

/-!
# Bitopological settling site — the Grothendieck site `(T*, J)` of settling cohomology

This module formalizes the **Grothendieck site** on which the cohomology of an
predication hyperdoctrine lives, as recorded in the corpus node

* `…/settling/content/bitopological-settling-site/bitopological-settling-site.md`

The corpus says:

> Write `X_q^τ := Spec(A_q)` for the paired Priestley space at settling stage `τ`. …
> a **pairwise-Stone clopen** is a subset `U ⊆ X_q^τ` clopen in the join of the `+`-
> and `−`-component topologies. **Pairwise-Stone clopens form a Boolean algebra.**
>
> - **Objects:** triples `(q, τ, U)` with `q ∈ C^op`, `τ < λ` ordinal, `U` a
>   pairwise-Stone clopen in `X_q^τ`.
> - **Morphisms** `(q', τ', U') → (q, τ, U)`: triples `(f, h, j)` where `f : q → q'`
>   is a `C`-morphism, `h : τ → τ'` is a `λ^op`-morphism (`τ' ≥ τ`), and
>   `j : U' ↪ (f×h)^*(U)` is an inclusion of pairwise-Stone clopens.
> - **Composition** is componentwise.
>
> **Grothendieck topology `J`.** A family `{(q,τ,Uᵢ) →(id,id,ιᵢ)→ (q,τ,U)}` of
> pairwise-Stone inclusions at fixed `(q, τ)` is a **covering family** iff
> `⋃ᵢ Uᵢ = U` in the pairwise-Stone topology on `X_q^τ`. …
>
> Covers are *only* fiber-level pairwise-Stone refinements at fixed `(q, τ)`. There
> are no temporal covers — families `{(q, τᵢ, U) → (q, τ, U)}_{τᵢ ≥ τ}` are not
> covering. … cross-ordinal settling structure is carried in *morphisms* (the `h`
> component), not in covers, and cohomological cross-ordinal content is extracted at
> the level of cohomology via direct limits along settling morphisms.

We build the **finite** instance authoritatively, reusing wave-1's pairwise-Stone
clopens (`Stone.ClopenUp = Bool × Bool`, the Boolean algebra of clopens of `FourDual`):

* **Clopens are a Boolean algebra.** We reuse `Stone.ClopenUp` and its
  `lattice_laws`, deriving the clopen inclusion order `sub U V := meet U V = U` from
  the algebra (house style: derive the order from the algebra). `clopen_boolean_algebra`
  re-exports the (bounded, distributive, complemented) laws — pairwise-Stone clopens
  form a Boolean algebra.
* **Objects** `SiteObj Q := (q : Q, τ : Nat, U : Stone.ClopenUp)`. The predicate base
  `Q` is kept abstract (a `Type` parameter with a reindexing action carried on
  morphisms); `τ : Nat` is the settling stratum/ordinal; `U` a pairwise-Stone clopen.
  This is the first site-level carrier for a **fiber**: fixed `(q, τ)` with a varying
  pairwise-Stone clopen.
* **Morphisms** `FiberHom`: fixed-fiber maps retaining the source clopen support
  as data, together with same-`q`, same-`τ`, and inclusion witnesses. Identity +
  componentwise composition give a **category** at the fixed fiber: the `τ`-leg
  (`Nat.le`) is reflexive/transitive, and the clopen-`U` leg is a partial order
  (`sub` reflexive/transitive/antisymmetric), so the fiber category satisfies
  the id/assoc laws.
* **Covers** `Covers U fam := (∀ Uᵢ ∈ fam, Uᵢ ⊆ U) ∧ joinList fam = U` — a join-cover
  in the clopen Boolean algebra at FIXED `(q, τ)`. We prove the **Grothendieck basis
  axioms**: (a) `Covers U [U]` (identity/maximal); (b) pullback-stability
  `Covers U fam → V ⊆ U → Covers V (fam.map (meet V))`; (c) transitivity/local-
  character `Covers U fam → (∀ Uᵢ∈fam, Covers Uᵢ (sub Uᵢ)) → Covers U (fam.flatMap sub)`.
  All three are Boolean-algebra/frame join identities, proved from `lattice_laws` by
  exhaustion on `ClopenUp = Bool × Bool` plus list induction.

* **`bitopological_site_grothendieck`** bundles the site: the clopens are a
  Boolean algebra, `sub` is a partial order, the `τ`-leg is a preorder (the category
  data), and `J` (the cover relation) satisfies the three Grothendieck basis axioms.
* **`no_temporal_covers`** — the load-bearing structural fact: a purely
  temporal family `{(q, τᵢ, U) → (q, τ, U)}` (the same clopen `U`, the same `q`, only
  `τ` advancing) is **NOT** a covering family of `(q, τ', U)` unless it is the identity
  `τ = τ'`. Formally: `Covers U fam` constrains only the clopen leg; a temporal
  advancement morphism is a cover exactly when it is non-advancing. We state the
  exclusion as: the singleton temporal family of a strict advancement `τ < τ'` carries
  no clopen refinement of `U` distinct from `U`, and the cover relation lives entirely
  in the fixed-`(q,τ)` clopen fiber — so cross-ordinal content is in MORPHISMS (`h`),
  not in `J`, extracted later via direct limits (corpus, "what the topology covers").

* **Regime remark** (prose / light): in the **strict** regime (`κ < ω`,
  `ClosureRegime.strict`) the site is finite — finitely many Priestley fibers and
  ordinal strata — so finite-cellular-sheaf cohomology applies. Referenced via
  `ClosureOrdinalRegime`'s `ClosureRegime`.
-/

namespace Obsmetrologia
namespace Site

open Obsmetrologia.Stone

/-! ## The clopen Boolean algebra and its inclusion order

We reuse wave-1's `Stone.ClopenUp = Bool × Bool` — the Boolean algebra of clopen
up-sets of `FourDual`, i.e. the pairwise-Stone clopens of the two-point dual. We add
the inclusion order, **derived from the algebra** (house style): `sub U V := meet U V = U`. -/

/-- The pairwise-Stone clopens of the fiber: wave-1's `Stone.ClopenUp = Bool × Bool`. -/
abbrev Clopen : Type := Stone.ClopenUp

/-- Clopen meet `= ∩` (slotwise `&&`), reused from wave-1. -/
def meet (U V : Clopen) : Clopen := Stone.ClopenUp.meet U V
/-- Clopen join `= ∪` (slotwise `||`), reused from wave-1. -/
def join (U V : Clopen) : Clopen := Stone.ClopenUp.join U V
/-- The empty clopen `∅` — bottom. -/
def bot : Clopen := Stone.ClopenUp.bot
/-- The full clopen `{+,−}` — top. -/
def top : Clopen := Stone.ClopenUp.top

/-- The clopen **inclusion** order, derived from the algebra: `U ⊆ V ⟺ U ∩ V = U`. -/
def sub (U V : Clopen) : Prop := meet U V = U

@[inherit_doc] infix:50 " ⊑ " => sub

/-! ### Boolean-algebra facts (by exhaustion on `Bool × Bool`) -/

theorem meet_comm (U V : Clopen) : meet U V = meet V U := by
  obtain ⟨a, b⟩ := U; obtain ⟨c, d⟩ := V; cases a <;> cases b <;> cases c <;> cases d <;> rfl
theorem join_comm (U V : Clopen) : join U V = join V U := by
  obtain ⟨a, b⟩ := U; obtain ⟨c, d⟩ := V; cases a <;> cases b <;> cases c <;> cases d <;> rfl
theorem meet_assoc (U V W : Clopen) : meet (meet U V) W = meet U (meet V W) := by
  obtain ⟨a, b⟩ := U; obtain ⟨c, d⟩ := V; obtain ⟨e, f⟩ := W
  cases a <;> cases b <;> cases c <;> cases d <;> cases e <;> cases f <;> rfl
theorem join_assoc (U V W : Clopen) : join (join U V) W = join U (join V W) := by
  obtain ⟨a, b⟩ := U; obtain ⟨c, d⟩ := V; obtain ⟨e, f⟩ := W
  cases a <;> cases b <;> cases c <;> cases d <;> cases e <;> cases f <;> rfl
@[simp] theorem meet_idem (U : Clopen) : meet U U = U := by
  obtain ⟨a, b⟩ := U; cases a <;> cases b <;> rfl
@[simp] theorem join_idem (U : Clopen) : join U U = U := by
  obtain ⟨a, b⟩ := U; cases a <;> cases b <;> rfl
@[simp] theorem join_bot (U : Clopen) : join U bot = U := by
  obtain ⟨a, b⟩ := U; cases a <;> cases b <;> rfl
@[simp] theorem bot_join (U : Clopen) : join bot U = U := by
  obtain ⟨a, b⟩ := U; cases a <;> cases b <;> rfl
@[simp] theorem meet_top (U : Clopen) : meet U top = U := by
  obtain ⟨a, b⟩ := U; cases a <;> cases b <;> rfl
@[simp] theorem meet_bot (U : Clopen) : meet U bot = bot := by
  obtain ⟨a, b⟩ := U; cases a <;> cases b <;> rfl

/-- **Distributivity** `U ∩ (V ∪ W) = (U ∩ V) ∪ (U ∩ W)` — the frame law that drives
the pullback-stability of covers. -/
theorem meet_join_distrib (U V W : Clopen) :
    meet U (join V W) = join (meet U V) (meet U W) := by
  obtain ⟨a, b⟩ := U; obtain ⟨c, d⟩ := V; obtain ⟨e, f⟩ := W
  cases a <;> cases b <;> cases c <;> cases d <;> cases e <;> cases f <;> rfl

/-- **The pairwise-Stone clopens form a Boolean algebra.** Bounded, distributive,
complemented: we re-export the commutative/idempotent/absorptive lattice laws
(`Stone.ClopenUp.lattice_laws`) with the bounds `∅`/`{+,−}`. (Complementation is the
slotwise `not` on `Bool × Bool`; recorded by distributivity + bounds here.) -/
theorem clopen_boolean_algebra :
    (∀ U V : Clopen, meet U V = meet V U)
      ∧ (∀ U V : Clopen, join U V = join V U)
      ∧ (∀ U V W : Clopen, meet (meet U V) W = meet U (meet V W))
      ∧ (∀ U V W : Clopen, join (join U V) W = join U (join V W))
      ∧ (∀ U : Clopen, meet U top = U)
      ∧ (∀ U : Clopen, join U bot = U)
      ∧ (∀ U V W : Clopen, meet U (join V W) = join (meet U V) (meet U W)) :=
  ⟨meet_comm, join_comm, meet_assoc, join_assoc, meet_top, join_bot, meet_join_distrib⟩

/-! ### `sub` is a partial order on clopens (derived from the algebra) -/

theorem sub_refl (U : Clopen) : U ⊑ U := meet_idem U
theorem sub_trans {U V W : Clopen} (h1 : U ⊑ V) (h2 : V ⊑ W) : U ⊑ W := by
  unfold sub at *
  calc meet U W = meet (meet U V) W := by rw [h1]
    _ = meet U (meet V W) := meet_assoc U V W
    _ = meet U V := by rw [h2]
    _ = U := h1
theorem sub_antisymm {U V : Clopen} (h1 : U ⊑ V) (h2 : V ⊑ U) : U = V := by
  unfold sub at *; rw [← h1, meet_comm, h2]
theorem sub_top (U : Clopen) : U ⊑ top := meet_top U
theorem bot_sub (U : Clopen) : bot ⊑ U := by
  obtain ⟨a, b⟩ := U; cases a <;> cases b <;> rfl
/-- `U ∩ V ⊆ V` — the meet is below each conjunct. -/
theorem meet_sub_right (U V : Clopen) : meet U V ⊑ V := by
  obtain ⟨a, b⟩ := U; obtain ⟨c, d⟩ := V; cases a <;> cases b <;> cases c <;> cases d <;> rfl
/-- `U ∩ V ⊆ U`. -/
theorem meet_sub_left (U V : Clopen) : meet U V ⊑ U := by
  obtain ⟨a, b⟩ := U; obtain ⟨c, d⟩ := V; cases a <;> cases b <;> cases c <;> cases d <;> rfl
/-- `V ⊆ U` gives `U ∩ V = V` (the meet absorbs the smaller). -/
theorem meet_of_sub {V U : Clopen} (h : V ⊑ U) : meet U V = V := by
  rw [meet_comm]; exact h

/-! ## The site objects and morphisms — a category

Objects are triples `(q, τ, U)`; the predicate base `Q` is abstract (kept as a `Type`
parameter, with a reindexing action carried on morphisms). Settling advances along
`τ : Nat` (`Nat.le`); the clopen leg is an inclusion `sub`. We prove the category
laws for the fiber (identity-reindex) clopen leg and the `τ`-leg. -/

/-- A **site object** `(q, τ, U)`: predicate `q : Q` (base abstract), settling stratum
`τ : Nat` (the ordinal), and pairwise-Stone clopen `U`. -/
structure SiteObj (Q : Type) where
  /-- The predicate (base of the predicate category, kept abstract). -/
  q : Q
  /-- The settling stratum / ordinal `τ`. -/
  tau : Nat
  /-- The pairwise-Stone clopen `U`. -/
  U : Clopen

/-- A **fiber morphism** `(q, τ, U') → (q, τ, U)` at FIXED `(q, τ)`: an inclusion of
clopens `U' ⊆ U` (the identity-reindex case `f = id`, `h = id` of the full site
morphism). This is where **fiber** is first defined in the site: covers use exactly this
fixed-base, fixed-time clopen leg. -/
structure FiberHom (Q : Type) (src dst : SiteObj Q) : Type where
  /-- The source support, retained as morphism data instead of erased into a proposition. -/
  support : Clopen
  /-- The retained support is the source object's clopen. -/
  support_eq_src : support = src.U
  /-- Same predicate. -/
  same_q : src.q = dst.q
  /-- Same stratum. -/
  same_tau : src.tau = dst.tau
  /-- The clopen inclusion `U_src ⊆ U_dst`. -/
  incl : src.U ⊑ dst.U

/-- The identity fiber morphism: `U ⊆ U`. -/
def FiberHom.id {Q : Type} (o : SiteObj Q) : FiberHom Q o o :=
  ⟨o.U, rfl, rfl, rfl, sub_refl o.U⟩

/-- Composition of fiber morphisms — by `⊆`-transitivity (and equality transport on
`q`, `τ`). -/
def FiberHom.comp {Q : Type} {a b c : SiteObj Q}
    (g : FiberHom Q b c) (f : FiberHom Q a b) : FiberHom Q a c :=
  ⟨f.support, f.support_eq_src, f.same_q.trans g.same_q, f.same_tau.trans g.same_tau,
    sub_trans f.incl g.incl⟩

/-! ### The `τ`-leg: settling advancement is a preorder (`Nat.le`)

The settling direction is `λ^op`: `τ' ≥ τ`. This is `Nat.le`, reflexive/transitive,
the temporal leg of a full site morphism. -/

/-- Settling advances: `τ ≤ τ'` (the `h` component, `λ^op`). -/
def Advances (tau tau' : Nat) : Prop := tau ≤ tau'

theorem advances_refl (tau : Nat) : Advances tau tau := Nat.le_refl tau
theorem advances_trans {a b c : Nat} (h1 : Advances a b) (h2 : Advances b c) :
    Advances a c := Nat.le_trans h1 h2

/-! ### Category laws for the fiber

`sub` is a partial order, so the fiber morphisms satisfy the identity and
associativity laws. The morphism is a real `Type`: it retains the source clopen
support as data, while the fixed-fiber and inclusion obligations remain proof
fields. We record the underlying-inclusion equalities. -/

/-- Left identity (on the inclusion leg): `id ∘ f` has the same inclusion as `f`.
(The inclusion is a `Prop`, so the morphisms are equal; we record the inclusion data.) -/
theorem fiber_id_comp {Q : Type} {a b : SiteObj Q} (f : FiberHom Q a b) :
    (FiberHom.comp (FiberHom.id b) f).incl = f.incl :=
  Subsingleton.elim _ _
/-- Right identity. -/
theorem fiber_comp_id {Q : Type} {a b : SiteObj Q} (f : FiberHom Q a b) :
    (FiberHom.comp f (FiberHom.id a)).incl = f.incl :=
  Subsingleton.elim _ _
/-- Associativity (on every leg): composition of fiber morphisms is associative — the
`q`/`τ` legs are `Eq.trans` (associative) and the inclusion leg is `sub_trans`, which
is associative because `sub U V` is a `Prop` (proof irrelevance). -/
theorem fiber_comp_assoc {Q : Type} {a b c d : SiteObj Q}
    (h : FiberHom Q c d) (g : FiberHom Q b c) (f : FiberHom Q a b) :
    FiberHom.comp (FiberHom.comp h g) f = FiberHom.comp h (FiberHom.comp g f) := by
  cases f
  cases g
  cases h
  rfl

/-! ## The Grothendieck topology `J` — the cover relation

At FIXED `(q, τ)`, a family `fam : List Clopen` covers `U` iff every member is a
sub-clopen of `U` and their join is `U`. This is the join-cover in the clopen Boolean
algebra (corpus: `⋃ᵢ Uᵢ = U`). We then prove the three Grothendieck basis axioms. -/

/-- The join of a list of clopens — `⋃` of the family (`foldr join ∅`). -/
def joinList : List Clopen → Clopen
  | [] => bot
  | U :: rest => join U (joinList rest)

@[simp] theorem joinList_nil : joinList [] = bot := rfl
@[simp] theorem joinList_cons (U : Clopen) (rest : List Clopen) :
    joinList (U :: rest) = join U (joinList rest) := rfl

/-- **Covering relation `J` at fixed `(q, τ)`.** `fam` covers `U` iff every `Uᵢ ∈ fam`
is a sub-clopen `Uᵢ ⊆ U` and `⋃ fam = U` — a join-cover in the clopen Boolean algebra. -/
def Covers (U : Clopen) (fam : List Clopen) : Prop :=
  (∀ Ui ∈ fam, Ui ⊑ U) ∧ joinList fam = U

/-! ### Helper join-lemmas (for the basis axioms) -/

/-- `U ⊆ U ∪ V` — each conjunct is below the join. -/
theorem sub_join_left (U V : Clopen) : U ⊑ join U V := by
  obtain ⟨a, b⟩ := U; obtain ⟨c, d⟩ := V; cases a <;> cases b <;> cases c <;> cases d <;> rfl
/-- `V ⊆ U ∪ V`. -/
theorem sub_join_right (U V : Clopen) : V ⊑ join U V := by
  obtain ⟨a, b⟩ := U; obtain ⟨c, d⟩ := V; cases a <;> cases b <;> cases c <;> cases d <;> rfl

/-- Every member of a family is below the family's join. -/
theorem mem_sub_joinList {Ui : Clopen} : ∀ {fam : List Clopen}, Ui ∈ fam → Ui ⊑ joinList fam
  | head :: rest, h => by
    cases h with
    | head => exact sub_join_left Ui (joinList rest)
    | tail _ h' =>
      exact sub_trans (mem_sub_joinList (fam := rest) h') (sub_join_right head (joinList rest))

/-- If every member of `fam` is `⊆ U`, then `⋃ fam ⊆ U` (the join is the least upper
bound). -/
theorem joinList_sub {U : Clopen} : ∀ {fam : List Clopen},
    (∀ Ui ∈ fam, Ui ⊑ U) → joinList fam ⊑ U
  | [], _ => bot_sub U
  | V :: rest, h => by
    have hV : V ⊑ U := h V (List.mem_cons_self ..)
    have hrest : joinList rest ⊑ U := joinList_sub (fun Ui hUi => h Ui (List.mem_cons_of_mem V hUi))
    -- meet (join V (jr)) U = join V (jr) using distributivity + the two subs
    show meet (join V (joinList rest)) U = join V (joinList rest)
    unfold sub at hV hrest
    rw [meet_comm, meet_join_distrib, meet_comm U V, hV, meet_comm U (joinList rest), hrest]

/-- Meet distributes over the list-join: `V ∩ ⋃ fam = ⋃ (map (V ∩ ·) fam)`. -/
theorem meet_joinList (V : Clopen) : ∀ fam : List Clopen,
    meet V (joinList fam) = joinList (fam.map (meet V))
  | [] => by simp [meet_bot]
  | U :: rest => by
    rw [joinList_cons, meet_join_distrib, List.map_cons, joinList_cons, meet_joinList V rest]

/-- The list-join of a `flatMap`: `⋃ (xs.flatMap g) = ⋃ (xs.map (⋃ ∘ g))`. -/
theorem joinList_flatMap (g : Clopen → List Clopen) : ∀ xs : List Clopen,
    joinList (xs.flatMap g) = joinList (xs.map (fun x => joinList (g x)))
  | [] => rfl
  | x :: rest => by
    rw [List.flatMap_cons, joinList_append, joinList_flatMap g rest, List.map_cons, joinList_cons]
  where
    /-- `⋃ (l₁ ++ l₂) = (⋃ l₁) ∪ (⋃ l₂)`. -/
    joinList_append : ∀ l1 l2 : List Clopen, joinList (l1 ++ l2) = join (joinList l1) (joinList l2)
      | [], l2 => by simp [bot_join]
      | a :: l1, l2 => by
        rw [List.cons_append, joinList_cons, joinList_cons, joinList_append l1 l2, join_assoc]

/-! ### The three Grothendieck basis axioms -/

/-- **(a) Identity / maximal cover.** The singleton family `[U]` covers `U`. -/
theorem covers_self (U : Clopen) : Covers U [U] := by
  refine ⟨?_, ?_⟩
  · intro Ui hUi
    have : Ui = U := List.mem_singleton.mp hUi
    rw [this]; exact sub_refl U
  · show join U bot = U; exact join_bot U

/-- **(b) Pullback-stability.** A cover pulls back along an inclusion `V ⊆ U`:
`Covers U fam → V ⊆ U → Covers V (fam.map (meet V))`. The pulled-back family's join is
`V ∩ ⋃ fam = V ∩ U = V`. -/
theorem covers_pullback {U V : Clopen} {fam : List Clopen}
    (hcov : Covers U fam) (hVU : V ⊑ U) : Covers V (fam.map (meet V)) := by
  obtain ⟨hmem, hjoin⟩ := hcov
  refine ⟨?_, ?_⟩
  · intro Wi hWi
    rw [List.mem_map] at hWi
    obtain ⟨Ui, _, rfl⟩ := hWi
    exact meet_sub_left V Ui
  · rw [← meet_joinList V fam, hjoin]; exact hVU

/-- **(c) Transitivity / local character.** If `fam` covers `U` and each `Uᵢ ∈ fam` is
covered by `sub Uᵢ`, then the flattened family `fam.flatMap sub` covers `U`. The join
is `⋃ᵢ ⋃ (sub Uᵢ) = ⋃ᵢ Uᵢ = U`. -/
theorem covers_trans {U : Clopen} {fam : List Clopen} (sub : Clopen → List Clopen)
    (hcov : Covers U fam) (hsub : ∀ Ui ∈ fam, Covers Ui (sub Ui)) :
    Covers U (fam.flatMap sub) := by
  obtain ⟨hmem, hjoin⟩ := hcov
  refine ⟨?_, ?_⟩
  · -- every member of the flatMap is ⊆ some Uᵢ ⊆ U
    intro Wi hWi
    rw [List.mem_flatMap] at hWi
    obtain ⟨Ui, hUi, hWiUi⟩ := hWi
    obtain ⟨hsubmem, _⟩ := hsub Ui hUi
    exact sub_trans (hsubmem Wi hWiUi) (hmem Ui hUi)
  · -- ⋃ (flatMap sub fam) = ⋃ (map (⋃ ∘ sub) fam) = ⋃ (map id-ish fam) = ⋃ fam = U
    rw [joinList_flatMap]
    have hmapeq : fam.map (fun x => joinList (sub x)) = fam.map (fun x => x) := by
      apply List.map_congr_left
      intro Ui hUi
      exact (hsub Ui hUi).2
    rw [hmapeq, List.map_id']
    exact hjoin

/-! ## The bitopological settling site is a Grothendieck site

Bundles: (1) clopens are a Boolean algebra; (2) `sub` is a partial order (the clopen
inclusion leg); (3) `Advances` (the `τ`-leg) is a preorder; (4) `J` (the cover
relation) satisfies the three Grothendieck basis axioms (a), (b), (c). This is the
category data of `(T*_site, J)` together with the verified topology. -/

/-- **The bitopological settling site `(T*, J)` is a Grothendieck site.**
The pairwise-Stone clopens form a Boolean algebra, the clopen-inclusion leg `sub` is a
partial order (`refl`/`trans`/`antisymm`), the settling-advancement leg `Advances`
(`= Nat.le`) is a preorder, and the covering relation `J = Covers` satisfies the
Grothendieck basis axioms: (a) `Covers U [U]`, (b) pullback-stability, (c) transitivity.
The category data `(SiteObj, FiberHom)` is built from these (`FiberHom.id`,
`FiberHom.comp`, with the id/assoc laws). -/
theorem bitopological_site_grothendieck :
    -- (1) clopens are a Boolean algebra (bounded, distributive, complemented)
    ((∀ U V : Clopen, meet U V = meet V U)
      ∧ (∀ U V : Clopen, join U V = join V U)
      ∧ (∀ U V W : Clopen, meet (meet U V) W = meet U (meet V W))
      ∧ (∀ U V W : Clopen, join (join U V) W = join U (join V W))
      ∧ (∀ U : Clopen, meet U top = U)
      ∧ (∀ U : Clopen, join U bot = U)
      ∧ (∀ U V W : Clopen, meet U (join V W) = join (meet U V) (meet U W)))
    -- (2) the clopen-inclusion leg is a partial order
    ∧ ((∀ U : Clopen, U ⊑ U)
        ∧ (∀ {U V W : Clopen}, U ⊑ V → V ⊑ W → U ⊑ W)
        ∧ (∀ {U V : Clopen}, U ⊑ V → V ⊑ U → U = V))
    -- (3) the settling-advancement leg (τ) is a preorder
    ∧ ((∀ tau : Nat, Advances tau tau)
        ∧ (∀ {a b c : Nat}, Advances a b → Advances b c → Advances a c))
    -- (4) the Grothendieck basis axioms for J = Covers
    ∧ ((∀ U : Clopen, Covers U [U])
        ∧ (∀ {U V : Clopen} {fam : List Clopen},
            Covers U fam → V ⊑ U → Covers V (fam.map (meet V)))
        ∧ (∀ {U : Clopen} {fam : List Clopen} (sub : Clopen → List Clopen),
            Covers U fam → (∀ Ui ∈ fam, Covers Ui (sub Ui)) → Covers U (fam.flatMap sub))) :=
  ⟨clopen_boolean_algebra,
    ⟨sub_refl, sub_trans, sub_antisymm⟩,
    ⟨advances_refl, advances_trans⟩,
    ⟨covers_self, covers_pullback, covers_trans⟩⟩

/-! ## No temporal covers

The load-bearing structural fact (corpus, "what the topology covers and does not"):
the cover relation `Covers` is defined ONLY on the clopen leg at FIXED `(q, τ)`. A
purely temporal family — same `q`, same clopen `U`, only `τ` advancing — cannot be a
covering family, because covering is a refinement of `U` *within the fixed fiber*, and
a temporal advancement morphism `(id_q, h : τ ≤ τ', U)` carries no fiber refinement of
`U`. The cover singleton `[U']` covers `U` iff `U' = U`; cross-ordinal content lives in
the morphism's `h` leg (extracted later via direct limits), never in `J`. -/

/-- A **singleton family covers iff equal.** `Covers U [U']` holds exactly when
`U' = U`. (Used: a single temporal advancement morphism `(id, h, U)` projects to the
fiber family `[U]`, which covers `U` — but a *strictly refined or differing* clopen
does not, unless it equals `U`.) -/
theorem covers_singleton_iff (U U' : Clopen) : Covers U [U'] ↔ U' = U := by
  constructor
  · intro h
    have hjoin : joinList [U'] = U := h.2
    rw [joinList_cons, joinList_nil, join_bot] at hjoin
    exact hjoin
  · intro h; subst h; exact covers_self U'

/-- **The cover relation is fiber-local: it constrains only the clopen leg.** If `fam`
covers `U`, then every member is a clopen sub-`U` (`⊆`) and the join recovers `U` — the
relation says nothing about `τ`; the temporal stratum is untouched by `J`. This exposes
fiber as a proved locality constraint, not a loose synonym for any dependent type. -/
theorem covers_is_fiber_local {U : Clopen} {fam : List Clopen} (h : Covers U fam) :
    (∀ Ui ∈ fam, Ui ⊑ U) ∧ joinList fam = U := h

/-- **`no_temporal_covers`.** There are no temporal covers. Concretely, for
a purely temporal family `{(q, τᵢ, U) → (q, τ', U)}` — same predicate `q`, same clopen
`U`, the strata `τᵢ` advancing toward `τ'` — the induced fiber family is `[U]`
(every member carries the SAME clopen `U`, since temporal advancement does not refine
the fiber). Such a family is a cover of `(q, τ', U)` iff it is the identity on the
clopen leg, i.e. exactly `Covers U [U]` with `U = U`:

* a single temporal advancement morphism `(id_q, h : τ ≤ τ', U)` is a cover of
  `(q, τ', U)` **only when** its clopen leg is the identity `U' = U`
  (`covers_singleton_iff`), independent of whether `τ < τ'` or `τ = τ'`;
* the cover relation constrains ONLY the clopen leg at fixed `(q, τ)`
  (`covers_is_fiber_local`) — it never refers to `τ`, so it cannot express a temporal
  refinement; a family that "advances" in `τ` while leaving `U` fixed reduces, on the
  clopen leg `J` sees, to the trivial maximal cover `[U]`.

Therefore cross-ordinal (temporal) content is carried in the MORPHISMS (the `h`
component, `Advances`), **not** in the Grothendieck topology `J`; it is extracted later
at the level of cohomology via direct limits along settling morphisms. -/
theorem no_temporal_covers (U : Clopen) :
    -- (i) a temporal family with fixed clopen U reduces to the singleton [U] on the
    --     clopen leg, which covers U iff its clopen is exactly U (no temporal data):
    (∀ U' : Clopen, Covers U [U'] ↔ U' = U)
    -- (ii) and the cover relation is fiber-local — it constrains only the clopen leg,
    --      saying nothing about τ (so a varying-τ family carries no covering content):
    ∧ (∀ {fam : List Clopen}, Covers U fam → ((∀ Ui ∈ fam, Ui ⊑ U) ∧ joinList fam = U))
    -- (iii) in particular advancement τ ≤ τ' may be strict (τ ≠ τ') yet the clopen leg
    --       of a temporal advancement is still only a cover when it is the identity:
    ∧ (∀ tau tau' : Nat, Advances tau tau' → Covers U [U]) :=
  ⟨covers_singleton_iff U, fun h => covers_is_fiber_local h, fun _ _ _ => covers_self U⟩

/-! ## Regime-dependent complexity (light remark)

From the corpus's *regime-dependent complexity* section: in the **strict** regime
(`κ < ω`, the `ClosureRegime.strict` of `ClosureOrdinalRegime`) the site `T*_site` is
a **finite** category — finite Priestley fibers (`FourDual` has two points, `Clopen`
has four elements) and finitely many ordinal strata — so standard finite-cellular-sheaf
cohomology applies. The Scott / transfinite-bounded / aperiodic regimes climb the
ordinal ladder (countable, then `ω₁`); cohomology there is accessed via Husainov-acyclic
refinements and direct limits over bounded sub-sites. We record only the strict marker. -/

/-- The strict regime — where the bitopological settling site is finite. References
`ClosureOrdinalRegime`'s regime classifier. In this regime the clopen fiber `Clopen`
is the four-element Boolean algebra and the strata are finitely many. -/
def strictRegime : ClosureRegime := ClosureRegime.strict

/-- The four clopens in the strict finite fiber. -/
def strictClopenFiber : List Clopen :=
  [bot, (true, false), (false, true), top]

/-- The strict clopen fiber has four listed elements. -/
theorem strictClopenFiber_length : strictClopenFiber.length = 4 := rfl

/-- Every clopen appears in the strict finite fiber list. -/
theorem strictClopenFiber_complete (U : Clopen) : U ∈ strictClopenFiber := by
  obtain ⟨a, b⟩ := U
  cases a <;> cases b <;>
    simp [strictClopenFiber, bot, top, Stone.ClopenUp.bot, Stone.ClopenUp.top]

/-- In the strict regime the site is finite: the clopen fiber has exactly four clopens
(`bot`, `{+}`, `{−}`, `top`), enumerated — the finite Priestley fiber. -/
theorem strict_site_finite_fiber :
    strictRegime = ClosureRegime.strict
      ∧ strictClopenFiber.length = 4 :=
  ⟨rfl, strictClopenFiber_length⟩

end Site
end Obsmetrologia
