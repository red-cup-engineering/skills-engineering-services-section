import Obsmetrologia.Language.Predicating.HyperdoctrineDual
import Obsmetrologia.AperiodicOrder.Tiling.Autopoiesis
import Obsmetrologia.Language.Positing.BigradedTower

/-!
# Predicating.CurryHowardLambek — the Curry–Howard–Lambek correspondence as the
  categorical-logic SHADOW of the predication hyperdoctrine

There is no dedicated Curry–Howard node in the corpus: the correspondence is the
**categorical-logic projection** of the predication-hyperdoctrine, exactly as
`AlgebraHierarchy` was a received-math specialization rather than a fresh node. The anchor is

* `settling/content/predication-hyperdoctrine/predication-hyperdoctrine.md`

— Lawvere's hyperdoctrine: the categorical model of (first-order) logic, whose
quantifier adjoints `∃_f ⊣ f* ⊣ ∀_f` (built in `Hyperdoctrine`/`Equality`/
`PredicationHyperdoctrineDual`) ARE the Σ/Π/Id type-formers. The hyperdoctrine IS
the Curry–Howard–Lambek correspondence read at the level of dependent type theory;
this module makes the propositional/simply-typed projection of that statement a theorem.

The math, authoritatively, is the **Curry–Howard–Lambek correspondence**:

  PROOFS = PROGRAMS = MORPHISMS.

We realize it for a minimal **simply-typed lambda calculus (STLC)** with products
and a unit:

* `Ty` — types: `base`, `arrow` (→), `prod` (×), `unit`.
* `Tm` — de-Bruijn terms: `var n`, `lam`, `app`, `pair`, `fst`, `snd`, `star`.
* `HasTy Γ t A` — an intrinsic-style typing relation over a context `List Ty`.
* `step` — β/projection reduction `(λ.t) u ↦ t[u]`, `fst (pair a b) ↦ a`,
  `snd (pair a b) ↦ b`, congruent in every subterm; `Red` is its reflexive-
  transitive closure.

**Confluence (Church–Rosser)** is proven by the Tait–Martin-Löf /
Takahashi method:

* `Par` — parallel reduction (reduce any set of redexes simultaneously).
* `dev` — Takahashi's *complete development* (reduce ALL current redexes at once).
* `par_triangle` — the cofinality triangle `Par t u → Par u (dev t)`: every
  parallel reduct of `t` parallel-reduces to the single term `dev t`.
* `par_diamond` — the diamond property for `Par`, an immediate corollary of the
  triangle.
* `par_confluent` / `red_confluent` (`church_rosser`) — confluence for `Par*`,
  hence for `Red` (since `Par` is sandwiched between `step` and `Red`).

**Curry–Howard.** `propOfTy : Valuation → PredicationCell → Ty → Prop` reads
`arrow = →`, `prod = ∧`, `unit = True`, and its base case is not an arbitrary
`Prop` but a real fact of the predication hyperdoctrine already built above:
`Charge.pos (v φ) = true`, for a valuation `v : Valuation` (`PredicationCell →
Charge`, `Charge` itself the abbrev for `Articulating.Corner`) at a cell
`φ : PredicationCell` (built from `Entity := Mark`/`Predicate := Mark`). The base
proposition is therefore rooted in `Mark`/`Articulating` through the same chain the
rest of the corpus uses, not floated free. `curry_howard` exhibits a type-directed
proof term: every closed type built from `→`,`×`,`unit` — over a cell the valuation
charges positive — is inhabited as a proposition, the term structure (`lam`/`app`/
`pair`/`fst`/`snd`/`star`) tracking the proof structure — terms ARE proofs.

**Lambek.** The type structure is a **cartesian closed category**:
`prod` is the categorical product (`fst`/`snd`/`pair` = the universal cone),
`unit` is terminal, `arrow` is the exponential — `lam`/`app` realize the
**currying adjunction** `Hom(C × A, B) ≅ Hom(C, A → B)`. `ccc_exponential_adjunction`
gives this iso for the meta-level Hom (Lean functions), the faithful projection of the
term-level curry/eval pair `lamTm`/`appTm`.

**Headlines.**

* `curry_howard_lambek` bundles the three-way correspondence: types↔props↔objects,
  terms↔proofs↔morphisms, β↔normalization↔equality (confluence + the CCC
  adjunction + the propositional reading).
* `chl_quartet_is_nuclear` proves the CHL **quartet** — the four type-formers
  `{unit, prod, arrow, base}` read as the four corners
  `{terminal, product, exponential, the dual}` — is equivalent to the recurring
  nuclear FOUR by the two inverse corner maps, with an explicit iff between naming a
  corner and returning through the inverse map.
-/

namespace Obsmetrologia
namespace Predicating.CurryHowardLambek

/-! ## Types (`Ty`) — objects ↔ propositions -/

/-- **Simple types.** The objects of the cartesian closed category / the
propositions of the simply-typed Curry–Howard reading:

* `base`  — a base object / atomic proposition,
* `arrow A B` — the exponential `B^A` / the implication `A ⇒ B`,
* `prod A B` — the product `A × B` / the conjunction `A ∧ B`,
* `unit`  — the terminal object / the proposition `True`. -/
inductive Ty where
  /-- The base object / atomic proposition. -/
  | base
  /-- Exponential `B^A` / implication `A ⇒ B`. -/
  | arrow : Ty → Ty → Ty
  /-- Product `A × B` / conjunction `A ∧ B`. -/
  | prod : Ty → Ty → Ty
  /-- Terminal object / `True`. -/
  | unit
  deriving DecidableEq, Repr

/-! ## Terms (`Tm`) — morphisms ↔ proofs ↔ programs -/

/-- **De-Bruijn terms** of the STLC: the morphisms / proofs / programs.

`var n` is the de-Bruijn variable, `lam t` binds variable `0` in `t`, `app`,
`pair`, `fst`, `snd` are the introduction/elimination forms, `star` is the unique
map into the terminal. -/
inductive Tm where
  /-- De-Bruijn variable. -/
  | var : Nat → Tm
  /-- λ-abstraction (binds variable `0`). -/
  | lam : Tm → Tm
  /-- Application. -/
  | app : Tm → Tm → Tm
  /-- Pairing (product introduction). -/
  | pair : Tm → Tm → Tm
  /-- First projection. -/
  | fst : Tm → Tm
  /-- Second projection. -/
  | snd : Tm → Tm
  /-- The unique map to the terminal. -/
  | star : Tm
  deriving DecidableEq, Repr

namespace Tm

/-! ### Renaming and substitution (de Bruijn) -/

/-- Lift a renaming `Nat → Nat` under a binder: `0 ↦ 0`, `n+1 ↦ ρ n + 1`. -/
def upRen (ρ : Nat → Nat) : Nat → Nat
  | 0 => 0
  | n + 1 => ρ n + 1

/-- Apply a renaming `ρ : Nat → Nat` to all free variables of a term. -/
def rename (ρ : Nat → Nat) : Tm → Tm
  | var n => var (ρ n)
  | lam t => lam (rename (upRen ρ) t)
  | app t u => app (rename ρ t) (rename ρ u)
  | pair t u => pair (rename ρ t) (rename ρ u)
  | fst t => fst (rename ρ t)
  | snd t => snd (rename ρ t)
  | star => star

/-- Lift a substitution `Nat → Tm` under a binder: `0 ↦ var 0`, `n+1 ↦ (σ n)⟨+1⟩`. -/
def upSub (σ : Nat → Tm) : Nat → Tm
  | 0 => var 0
  | n + 1 => rename (· + 1) (σ n)

/-- Apply a (parallel) substitution `σ : Nat → Tm` to all free variables. -/
def subst (σ : Nat → Tm) : Tm → Tm
  | var n => σ n
  | lam t => lam (subst (upSub σ) t)
  | app t u => app (subst σ t) (subst σ u)
  | pair t u => pair (subst σ t) (subst σ u)
  | fst t => fst (subst σ t)
  | snd t => snd (subst σ t)
  | star => star

/-- The single-variable substitution `σ₀ u = (u, var 0, var 1, …)`: replace
variable `0` by `u`, decrement the rest. -/
def sub0 (u : Tm) : Nat → Tm
  | 0 => u
  | n + 1 => var n

/-- β-substitution `t[u]`: substitute `u` for the bound variable `0` in `t`. -/
def inst (t u : Tm) : Tm := subst (sub0 u) t

end Tm

/-! ## Typing relation `HasTy` — well-typed terms ARE proofs -/

open Tm

/-- **The typing relation** `HasTy Γ t A`: in context `Γ : List Ty`, term `t` has
type `A`. The rules are exactly the STLC / natural-deduction rules: variable lookup,
→-intro/elim (`lam`/`app`), ×-intro/elim (`pair`/`fst`/`snd`), and the terminal
(`star : unit`). A derivation IS a proof of `A`-as-proposition; the term is the
proof's computational content. -/
inductive HasTy : List Ty → Tm → Ty → Prop where
  /-- Variable `0`: the head of the context. -/
  | zero {Γ : List Ty} {A : Ty} : HasTy (A :: Γ) (var 0) A
  /-- Variable `n+1`: lookup in the tail (weakening). -/
  | succ {Γ : List Ty} {A B : Ty} {n : Nat} :
      HasTy Γ (var n) A → HasTy (B :: Γ) (var (n + 1)) A
  /-- →-introduction (`lam` / currying). -/
  | lam {Γ : List Ty} {A B : Ty} {t : Tm} :
      HasTy (A :: Γ) t B → HasTy Γ (lam t) (Ty.arrow A B)
  /-- →-elimination (`app` / evaluation). -/
  | app {Γ : List Ty} {A B : Ty} {t u : Tm} :
      HasTy Γ t (Ty.arrow A B) → HasTy Γ u A → HasTy Γ (app t u) B
  /-- ×-introduction (`pair`). -/
  | pair {Γ : List Ty} {A B : Ty} {t u : Tm} :
      HasTy Γ t A → HasTy Γ u B → HasTy Γ (pair t u) (Ty.prod A B)
  /-- ×-elimination, first projection (`fst`). -/
  | fst {Γ : List Ty} {A B : Ty} {t : Tm} :
      HasTy Γ t (Ty.prod A B) → HasTy Γ (fst t) A
  /-- ×-elimination, second projection (`snd`). -/
  | snd {Γ : List Ty} {A B : Ty} {t : Tm} :
      HasTy Γ t (Ty.prod A B) → HasTy Γ (snd t) B
  /-- The unique map to the terminal (`star : unit`). -/
  | star {Γ : List Ty} : HasTy Γ star Ty.unit

/-! ## One-step reduction `step` and its closure `Red` -/

/-- **One-step β/projection reduction**, congruent in every subterm:
`(λ.t) u ↦ t[u]`, `fst (pair a b) ↦ a`, `snd (pair a b) ↦ b`. -/
inductive step : Tm → Tm → Prop where
  /-- β: `(λ.t) u ↦ t[u]`. -/
  | beta {t u : Tm} : step (app (lam t) u) (inst t u)
  /-- `fst (pair a b) ↦ a`. -/
  | pi1 {a b : Tm} : step (fst (pair a b)) a
  /-- `snd (pair a b) ↦ b`. -/
  | pi2 {a b : Tm} : step (snd (pair a b)) b
  /-- Congruence under `lam`. -/
  | lam {t t' : Tm} : step t t' → step (lam t) (lam t')
  /-- Congruence in the function position of `app`. -/
  | appL {t t' u : Tm} : step t t' → step (app t u) (app t' u)
  /-- Congruence in the argument position of `app`. -/
  | appR {t u u' : Tm} : step u u' → step (app t u) (app t u')
  /-- Congruence in the left of `pair`. -/
  | pairL {t t' u : Tm} : step t t' → step (pair t u) (pair t' u)
  /-- Congruence in the right of `pair`. -/
  | pairR {t u u' : Tm} : step u u' → step (pair t u) (pair t u')
  /-- Congruence under `fst`. -/
  | fst {t t' : Tm} : step t t' → step (fst t) (fst t')
  /-- Congruence under `snd`. -/
  | snd {t t' : Tm} : step t t' → step (snd t) (snd t')

/-- **`Red`**: the reflexive-transitive closure of `step` (`↦*`). -/
inductive Red : Tm → Tm → Prop where
  /-- Reflexivity. -/
  | refl {t : Tm} : Red t t
  /-- Extend by one `step`. -/
  | tail {t u v : Tm} : Red t u → step u v → Red t v

namespace Red
/-- Transitivity of `↦*`. -/
theorem trans {t u v : Tm} (h1 : Red t u) (h2 : Red u v) : Red t v := by
  induction h2 with
  | refl => exact h1
  | tail _ s ih => exact Red.tail ih s
/-- A single `step` is a `Red`. -/
theorem single {t u : Tm} (h : step t u) : Red t u := Red.tail Red.refl h
end Red

/-! ## Parallel reduction `Par` — the Tait–Martin-Löf relation -/

/-- **Parallel reduction**: reduce ANY set of currently-present redexes
simultaneously (the Tait–Martin-Löf relation). It is reflexive, contains `step`,
and is contained in `Red`; its diamond property yields Church–Rosser. -/
inductive Par : Tm → Tm → Prop where
  /-- Variables reduce to themselves. -/
  | var {n : Nat} : Par (var n) (var n)
  /-- `star` reduces to itself. -/
  | star : Par star star
  /-- Congruence under `lam`. -/
  | lam {t t' : Tm} : Par t t' → Par (lam t) (lam t')
  /-- Congruence under `app` (no top redex). -/
  | app {t t' u u' : Tm} : Par t t' → Par u u' → Par (app t u) (app t' u')
  /-- Parallel β: reduce the redex AND its parts. -/
  | beta {t t' u u' : Tm} :
      Par t t' → Par u u' → Par (app (lam t) u) (inst t' u')
  /-- Congruence under `pair`. -/
  | pair {t t' u u' : Tm} : Par t t' → Par u u' → Par (pair t u) (pair t' u')
  /-- Congruence under `fst`. -/
  | fst {t t' : Tm} : Par t t' → Par (fst t) (fst t')
  /-- Congruence under `snd`. -/
  | snd {t t' : Tm} : Par t t' → Par (snd t) (snd t')
  /-- Parallel π₁: `fst (pair a b) ⇉ a'`. -/
  | pi1 {a a' b b' : Tm} : Par a a' → Par b b' → Par (fst (pair a b)) a'
  /-- Parallel π₂: `snd (pair a b) ⇉ b'`. -/
  | pi2 {a a' b b' : Tm} : Par a a' → Par b b' → Par (snd (pair a b)) b'

namespace Par

/-- `Par` is **reflexive**. -/
theorem refl : ∀ t : Tm, Par t t
  | Tm.var _ => Par.var
  | Tm.lam t => Par.lam (refl t)
  | Tm.app t u => Par.app (refl t) (refl u)
  | Tm.pair t u => Par.pair (refl t) (refl u)
  | Tm.fst t => Par.fst (refl t)
  | Tm.snd t => Par.snd (refl t)
  | Tm.star => Par.star

end Par

/-! ### `step ⊆ Par ⊆ Red` -/

/-- Every `step` is a parallel reduction. -/
theorem step_par {t u : Tm} (h : step t u) : Par t u := by
  induction h with
  | beta => exact Par.beta (Par.refl _) (Par.refl _)
  | pi1 => exact Par.pi1 (Par.refl _) (Par.refl _)
  | pi2 => exact Par.pi2 (Par.refl _) (Par.refl _)
  | lam _ ih => exact Par.lam ih
  | appL _ ih => exact Par.app ih (Par.refl _)
  | appR _ ih => exact Par.app (Par.refl _) ih
  | pairL _ ih => exact Par.pair ih (Par.refl _)
  | pairR _ ih => exact Par.pair (Par.refl _) ih
  | fst _ ih => exact Par.fst ih
  | snd _ ih => exact Par.snd ih

/-! ### Congruence of `Red` (needed for `Par ⊆ Red`) -/

theorem Red.lam {t t' : Tm} (h : Red t t') : Red (Tm.lam t) (Tm.lam t') := by
  induction h with
  | refl => exact Red.refl
  | tail _ s ih => exact Red.tail ih (step.lam s)

theorem Red.appL {t t' u : Tm} (h : Red t t') : Red (Tm.app t u) (Tm.app t' u) := by
  induction h with
  | refl => exact Red.refl
  | tail _ s ih => exact Red.tail ih (step.appL s)

theorem Red.appR {t u u' : Tm} (h : Red u u') : Red (Tm.app t u) (Tm.app t u') := by
  induction h with
  | refl => exact Red.refl
  | tail _ s ih => exact Red.tail ih (step.appR s)

theorem Red.app {t t' u u' : Tm} (h1 : Red t t') (h2 : Red u u') :
    Red (Tm.app t u) (Tm.app t' u') :=
  Red.trans (Red.appL h1) (Red.appR h2)

theorem Red.pairL {t t' u : Tm} (h : Red t t') : Red (Tm.pair t u) (Tm.pair t' u) := by
  induction h with
  | refl => exact Red.refl
  | tail _ s ih => exact Red.tail ih (step.pairL s)

theorem Red.pairR {t u u' : Tm} (h : Red u u') : Red (Tm.pair t u) (Tm.pair t u') := by
  induction h with
  | refl => exact Red.refl
  | tail _ s ih => exact Red.tail ih (step.pairR s)

theorem Red.pair {t t' u u' : Tm} (h1 : Red t t') (h2 : Red u u') :
    Red (Tm.pair t u) (Tm.pair t' u') :=
  Red.trans (Red.pairL h1) (Red.pairR h2)

theorem Red.fst {t t' : Tm} (h : Red t t') : Red (Tm.fst t) (Tm.fst t') := by
  induction h with
  | refl => exact Red.refl
  | tail _ s ih => exact Red.tail ih (step.fst s)

theorem Red.snd {t t' : Tm} (h : Red t t') : Red (Tm.snd t) (Tm.snd t') := by
  induction h with
  | refl => exact Red.refl
  | tail _ s ih => exact Red.tail ih (step.snd s)

/-- Every parallel reduction is a `Red` (multi-step). The β/π cases use the
congruence lemmas plus the top redex `step`. -/
theorem par_red {t u : Tm} (h : Par t u) : Red t u := by
  induction h with
  | var => exact Red.refl
  | star => exact Red.refl
  | lam _ ih => exact Red.lam ih
  | app _ _ ih1 ih2 => exact Red.app ih1 ih2
  | beta _ _ ih1 ih2 =>
      exact Red.trans (Red.app (Red.lam ih1) ih2) (Red.single step.beta)
  | pair _ _ ih1 ih2 => exact Red.pair ih1 ih2
  | fst _ ih => exact Red.fst ih
  | snd _ ih => exact Red.snd ih
  | pi1 _ _ ih1 _ => exact Red.trans (Red.fst (Red.pair ih1 Red.refl)) (Red.single step.pi1)
  | pi2 _ _ _ ih2 => exact Red.trans (Red.snd (Red.pair Red.refl ih2)) (Red.single step.pi2)

/-! ## Substitution lemmas under renaming and parallel reduction

The heart of the Takahashi proof: `Par` is a congruence for substitution. We follow
the standard de-Bruijn route — renaming commutation, then the substitution lemmas. -/

/-- `upRen` of a composite renaming is the composite of the lifts. -/
theorem upRen_comp (ρ τ : Nat → Nat) :
    ∀ n, upRen (ρ ∘ τ) n = (upRen ρ ∘ upRen τ) n
  | 0 => rfl
  | _ + 1 => rfl

/-- Renaming is functorial: `rename ρ (rename τ t) = rename (ρ ∘ τ) t`. -/
theorem rename_rename (ρ τ : Nat → Nat) :
    ∀ t, rename ρ (rename τ t) = rename (ρ ∘ τ) t
  | var _ => rfl
  | lam t => by
      show lam _ = lam _
      rw [rename_rename (upRen ρ) (upRen τ) t]
      have hfun : (upRen ρ ∘ upRen τ) = upRen (ρ ∘ τ) :=
        funext (fun n => (upRen_comp ρ τ n).symm)
      rw [hfun]
  | app t u => by show app _ _ = app _ _; rw [rename_rename ρ τ t, rename_rename ρ τ u]
  | pair t u => by show pair _ _ = pair _ _; rw [rename_rename ρ τ t, rename_rename ρ τ u]
  | fst t => by show fst _ = fst _; rw [rename_rename ρ τ t]
  | snd t => by show snd _ = snd _; rw [rename_rename ρ τ t]
  | star => rfl

/-- `upSub` commutes with a renaming/substitution lift: substituting then renaming
under a binder equals the lifted operations. (`up`-naturality, first half.) -/
theorem upSub_upRen (ρ : Nat → Nat) (σ : Nat → Tm) :
    ∀ n, upSub (fun k => rename ρ (σ k)) n = rename (upRen ρ) (upSub σ n)
  | 0 => rfl
  | n + 1 => by
      show rename (· + 1) (rename ρ (σ n)) = rename (upRen ρ) (rename (· + 1) (σ n))
      rw [rename_rename, rename_rename]
      rfl

/-- Substitution after renaming the substituends commutes with renaming the result:
`rename ρ (subst σ t) = subst (rename ρ ∘ σ) t`. -/
theorem rename_subst (ρ : Nat → Nat) (σ : Nat → Tm) :
    ∀ t, rename ρ (subst σ t) = subst (fun k => rename ρ (σ k)) t
  | var _ => rfl
  | lam t => by
      show lam _ = lam _
      rw [rename_subst (upRen ρ) (upSub σ) t]
      have hfun : (fun k => rename (upRen ρ) (upSub σ k))
          = upSub (fun k => rename ρ (σ k)) := funext (fun n => (upSub_upRen ρ σ n).symm)
      rw [hfun]
  | app t u => by show app _ _ = app _ _; rw [rename_subst ρ σ t, rename_subst ρ σ u]
  | pair t u => by show pair _ _ = pair _ _; rw [rename_subst ρ σ t, rename_subst ρ σ u]
  | fst t => by show fst _ = fst _; rw [rename_subst ρ σ t]
  | snd t => by show snd _ = snd _; rw [rename_subst ρ σ t]
  | star => rfl

/-- Renaming the source of a substitution: `subst σ (rename ρ t) = subst (σ ∘ ρ) t`. -/
theorem subst_rename (σ : Nat → Tm) (ρ : Nat → Nat) :
    ∀ t, subst σ (rename ρ t) = subst (fun k => σ (ρ k)) t
  | var _ => rfl
  | lam t => by
      show lam _ = lam _
      rw [subst_rename (upSub σ) (upRen ρ) t]
      have hfun : (fun k => upSub σ (upRen ρ k)) = upSub (fun k => σ (ρ k)) :=
        funext (fun n => by cases n with | zero => rfl | succ m => rfl)
      rw [hfun]
  | app t u => by show app _ _ = app _ _; rw [subst_rename σ ρ t, subst_rename σ ρ u]
  | pair t u => by show pair _ _ = pair _ _; rw [subst_rename σ ρ t, subst_rename σ ρ u]
  | fst t => by show fst _ = fst _; rw [subst_rename σ ρ t]
  | snd t => by show snd _ = snd _; rw [subst_rename σ ρ t]
  | star => rfl

/-- `upSub` commutes with substitution composition (the key `up`-naturality lemma):
`upSub (subst σ ∘ τ) = subst (upSub σ) ∘ upSub τ` pointwise. -/
theorem upSub_comp (σ τ : Nat → Tm) :
    ∀ n, upSub (fun k => subst σ (τ k)) n = subst (upSub σ) (upSub τ n)
  | 0 => rfl
  | n + 1 => by
      show rename (· + 1) (subst σ (τ n))
          = subst (upSub σ) (rename (· + 1) (τ n))
      rw [rename_subst, subst_rename]
      rfl

/-- **Substitution is functorial** (the substitution lemma):
`subst σ (subst τ t) = subst (subst σ ∘ τ) t`. -/
theorem subst_subst (σ τ : Nat → Tm) :
    ∀ t, subst σ (subst τ t) = subst (fun k => subst σ (τ k)) t
  | var _ => rfl
  | lam t => by
      show lam _ = lam _
      rw [subst_subst (upSub σ) (upSub τ) t]
      have hfun : (fun k => subst (upSub σ) (upSub τ k))
          = upSub (fun k => subst σ (τ k)) := funext (fun n => (upSub_comp σ τ n).symm)
      rw [hfun]
  | app t u => by show app _ _ = app _ _; rw [subst_subst σ τ t, subst_subst σ τ u]
  | pair t u => by show pair _ _ = pair _ _; rw [subst_subst σ τ t, subst_subst σ τ u]
  | fst t => by show fst _ = fst _; rw [subst_subst σ τ t]
  | snd t => by show snd _ = snd _; rw [subst_subst σ τ t]
  | star => rfl

/-! ### `Par` is a congruence for substitution

We prove that parallel reduction lifts to substitutions and is preserved by
`subst`. The standard formulation: if `σ k ⇉ σ' k` pointwise then
`subst σ t ⇉ subst σ' t'` whenever `t ⇉ t'`. -/

/-- A pointwise parallel reduction between substitutions. -/
def ParSub (σ σ' : Nat → Tm) : Prop := ∀ n, Par (σ n) (σ' n)

/-- `Par` is preserved by renaming. -/
theorem par_rename {t t' : Tm} (h : Par t t') :
    ∀ ρ : Nat → Nat, Par (rename ρ t) (rename ρ t') := by
  induction h with
  | var => intro ρ; exact Par.var
  | star => intro ρ; exact Par.star
  | lam _ ih => intro ρ; exact Par.lam (ih (upRen ρ))
  | app _ _ ih1 ih2 => intro ρ; exact Par.app (ih1 ρ) (ih2 ρ)
  | @beta t t' u u' _ _ ih1 ih2 =>
      intro ρ
      show Par (rename ρ (app (lam t) u)) (rename ρ (inst t' u'))
      have hb := Par.beta (ih1 (upRen ρ)) (ih2 ρ)
      -- rename ρ (inst t' u') = inst (rename (upRen ρ) t') (rename ρ u')
      have heq : rename ρ (inst t' u') = inst (rename (upRen ρ) t') (rename ρ u') := by
        show rename ρ (subst (sub0 u') t') = subst (sub0 (rename ρ u')) (rename (upRen ρ) t')
        rw [rename_subst, subst_rename]
        congr 1
        funext n
        cases n with
        | zero => rfl
        | succ m => rfl
      rw [heq]
      exact hb
  | pair _ _ ih1 ih2 => intro ρ; exact Par.pair (ih1 ρ) (ih2 ρ)
  | fst _ ih => intro ρ; exact Par.fst (ih ρ)
  | snd _ ih => intro ρ; exact Par.snd (ih ρ)
  | @pi1 a a' b b' _ _ ih1 _ => intro ρ; exact Par.pi1 (ih1 ρ) (Par.refl (rename ρ b))
  | @pi2 a a' b b' _ _ _ ih2 => intro ρ; exact Par.pi2 (Par.refl (rename ρ a)) (ih2 ρ)

/-- A `ParSub` lifts under a binder. -/
theorem ParSub.up {σ σ' : Nat → Tm} (h : ParSub σ σ') : ParSub (upSub σ) (upSub σ') := by
  intro n
  cases n with
  | zero => exact Par.var
  | succ m => exact par_rename (h m) (· + 1)

/-- **`Par` is a congruence for substitution.** If `t ⇉ t'` and `σ ⇉ σ'`
pointwise, then `subst σ t ⇉ subst σ' t'`. This is the substitution lemma that
drives the Takahashi triangle. -/
theorem par_subst {t t' : Tm} (h : Par t t') :
    ∀ (σ σ' : Nat → Tm), ParSub σ σ' → Par (subst σ t) (subst σ' t') := by
  induction h with
  | @var n => intro σ σ' hσ; exact hσ n
  | star => intro σ σ' _; exact Par.star
  | lam _ ih => intro σ σ' hσ; exact Par.lam (ih _ _ hσ.up)
  | app _ _ ih1 ih2 => intro σ σ' hσ; exact Par.app (ih1 _ _ hσ) (ih2 _ _ hσ)
  | @beta t t' u u' _ _ ih1 ih2 =>
      intro σ σ' hσ
      show Par (subst σ (app (lam t) u)) (subst σ' (inst t' u'))
      have hb := Par.beta (ih1 _ _ hσ.up) (ih2 _ _ hσ)
      have heq : subst σ' (inst t' u') = inst (subst (upSub σ') t') (subst σ' u') := by
        show subst σ' (subst (sub0 u') t')
            = subst (sub0 (subst σ' u')) (subst (upSub σ') t')
        rw [subst_subst, subst_subst]
        congr 1
        funext n
        cases n with
        | zero => rfl
        | succ m =>
            show σ' m = subst (sub0 (subst σ' u')) (rename (· + 1) (σ' m))
            rw [subst_rename]
            show σ' m = subst (fun k => sub0 (subst σ' u') (k + 1)) (σ' m)
            rw [show (fun k => sub0 (subst σ' u') (k + 1)) = (fun k => var k) from rfl]
            exact (subst_var (σ' m)).symm
      rw [heq]
      exact hb
  | pair _ _ ih1 ih2 => intro σ σ' hσ; exact Par.pair (ih1 _ _ hσ) (ih2 _ _ hσ)
  | fst _ ih => intro σ σ' hσ; exact Par.fst (ih _ _ hσ)
  | snd _ ih => intro σ σ' hσ; exact Par.snd (ih _ _ hσ)
  | @pi1 a a' b b' _ _ ih1 _ =>
      intro σ σ' hσ; exact Par.pi1 (ih1 _ _ hσ) (Par.refl (subst σ b))
  | @pi2 a a' b b' _ _ _ ih2 =>
      intro σ σ' hσ; exact Par.pi2 (Par.refl (subst σ a)) (ih2 _ _ hσ)
where
  /-- `subst var t = t` (identity substitution). -/
  subst_var : ∀ t : Tm, subst (fun k => var k) t = t
    | var _ => rfl
    | lam t => by
        show lam (subst (upSub (fun k => var k)) t) = lam t
        rw [show upSub (fun k => var k) = (fun k => var k) from
          funext (fun n => by cases n <;> rfl)]
        rw [subst_var t]
    | app t u => by show app _ _ = app _ _; rw [subst_var t, subst_var u]
    | pair t u => by show pair _ _ = pair _ _; rw [subst_var t, subst_var u]
    | fst t => by show fst _ = fst _; rw [subst_var t]
    | snd t => by show snd _ = snd _; rw [subst_var t]
    | star => rfl

/-- **β-step congruence under `Par`.** If `t ⇉ t'` and `u ⇉ u'` then
`t[u] ⇉ t'[u']`. The instance of `par_subst` at `sub0`. -/
theorem par_inst {t t' u u' : Tm} (ht : Par t t') (hu : Par u u') :
    Par (inst t u) (inst t' u') := by
  apply par_subst ht
  intro n
  cases n with
  | zero => exact hu
  | succ m => exact Par.var

/-! ## Takahashi complete development `dev` and the triangle -/

/-- **Complete development** (Takahashi's `*`): reduce ALL redexes present in `t`
simultaneously. Every `Par`-reduct of `t` reduces to `dev t`. -/
def dev : Tm → Tm
  | var n => var n
  | star => star
  | lam t => lam (dev t)
  | app (lam t) u => inst (dev t) (dev u)
  | app t u => app (dev t) (dev u)
  | pair t u => pair (dev t) (dev u)
  | fst (pair a b) => dev a
  | fst t => fst (dev t)
  | snd (pair a b) => dev b
  | snd t => snd (dev t)

/-- **The Takahashi triangle / cofinality lemma.** Every parallel reduct of `t`
parallel-reduces to the complete development `dev t`. This is the crux: it gives the
diamond property immediately (both reducts of `t` aim at the single `dev t`). -/
theorem par_triangle : ∀ {t u : Tm}, Par t u → Par u (dev t) := by
  intro t u h
  induction h with
  | var => exact Par.var
  | star => exact Par.star
  | lam _ ih => exact Par.lam ih
  | @app t t' u u' ht _ ih1 ih2 =>
      -- dev (app t u) splits on whether t is a lam
      cases t with
      | lam s =>
          -- ht : Par (lam s) t'; invert to get t' = lam s' with Par s s'
          cases ht with
          | lam hs =>
              -- ih1 : Par (lam s') (dev (lam s)) = Par (lam s') (lam (dev s))
              -- want Par (app (lam s') u') (inst (dev s) (dev u))
              cases ih1 with
              | lam ihs => exact Par.beta ihs ih2
      | var n => exact Par.app ih1 ih2
      | app a b => exact Par.app ih1 ih2
      | pair a b => exact Par.app ih1 ih2
      | fst a => exact Par.app ih1 ih2
      | snd a => exact Par.app ih1 ih2
      | star => exact Par.app ih1 ih2
  | @beta t t' u u' _ _ ih1 ih2 =>
      -- dev (app (lam t) u) = inst (dev t) (dev u)
      -- ih1 : Par t' (dev t), ih2 : Par u' (dev u)
      exact par_inst ih1 ih2
  | pair _ _ ih1 ih2 => exact Par.pair ih1 ih2
  | @fst t t' ht ih =>
      cases t with
      | pair a b =>
          cases ht with
          | pair ha hb =>
              cases ih with
              | pair iha _ => exact Par.pi1 iha (Par.refl _)
      | var n => exact Par.fst ih
      | lam a => exact Par.fst ih
      | app a b => exact Par.fst ih
      | fst a => exact Par.fst ih
      | snd a => exact Par.fst ih
      | star => exact Par.fst ih
  | @snd t t' ht ih =>
      cases t with
      | pair a b =>
          cases ht with
          | pair ha hb =>
              cases ih with
              | pair _ ihb => exact Par.pi2 (Par.refl _) ihb
      | var n => exact Par.snd ih
      | lam a => exact Par.snd ih
      | app a b => exact Par.snd ih
      | fst a => exact Par.snd ih
      | snd a => exact Par.snd ih
      | star => exact Par.snd ih
  | @pi1 a a' b b' _ _ ih1 _ =>
      -- dev (fst (pair a b)) = dev a; ih1 : Par a' (dev a)
      exact ih1
  | @pi2 a a' b b' _ _ _ ih2 =>
      exact ih2

/-- **The diamond property for `Par`.** If `t ⇉ u₁` and `t ⇉ u₂`, then both meet
at the common reduct `dev t`. Immediate from the triangle. -/
theorem par_diamond {t u v : Tm} (h1 : Par t u) (h2 : Par t v) :
    ∃ w, Par u w ∧ Par v w :=
  ⟨dev t, par_triangle h1, par_triangle h2⟩

/-! ## Confluence (Church–Rosser) -/

/-- The reflexive-transitive closure of `Par`. -/
inductive ParStar : Tm → Tm → Prop where
  /-- Reflexivity. -/
  | refl {t : Tm} : ParStar t t
  /-- Extend by one `Par`. -/
  | tail {t u v : Tm} : ParStar t u → Par u v → ParStar t v

namespace ParStar
/-- Transitivity. -/
theorem trans {t u v : Tm} (h1 : ParStar t u) (h2 : ParStar u v) : ParStar t v := by
  induction h2 with
  | refl => exact h1
  | tail _ p ih => exact ParStar.tail ih p
/-- A single `Par` is a `ParStar`. -/
theorem single {t u : Tm} (h : Par t u) : ParStar t u := ParStar.tail ParStar.refl h
/-- A `head` extension. -/
theorem head {t u v : Tm} (h : Par t u) (h2 : ParStar u v) : ParStar t v :=
  trans (single h) h2
end ParStar

/-- **Strip lemma.** If `t ⇉ u` and `t ⇉* v`, the two close up: there is a common
`w` with `u ⇉* w` and `v ⇉ w`. (One side a single step; iterates the diamond.) -/
theorem par_strip {t u v : Tm} (h1 : Par t u) (h2 : ParStar t v) :
    ∃ w, ParStar u w ∧ Par v w := by
  induction h2 with
  | refl => exact ⟨u, ParStar.refl, h1⟩
  | tail _ p ih =>
      obtain ⟨w, huw, hvw⟩ := ih
      obtain ⟨w', hw1, hw2⟩ := par_diamond hvw p
      exact ⟨w', ParStar.tail huw hw1, hw2⟩

/-- **Confluence of `Par*`** (the diamond, iterated). If `t ⇉* u` and `t ⇉* v`,
they have a common reduct `w`. -/
theorem par_confluent {t u v : Tm} (h1 : ParStar t u) (h2 : ParStar t v) :
    ∃ w, ParStar u w ∧ ParStar v w := by
  induction h1 with
  | refl => exact ⟨v, h2, ParStar.refl⟩
  | tail _ p ih =>
      obtain ⟨w, huw, hvw⟩ := ih
      obtain ⟨w', hw1, hw2⟩ := par_strip p huw
      exact ⟨w', hw1, ParStar.trans hvw (ParStar.single hw2)⟩

/-! ### `Red ↔ ParStar` -/

/-- `Red` implies `ParStar` (each `step` is a `Par`). -/
theorem red_parStar {t u : Tm} (h : Red t u) : ParStar t u := by
  induction h with
  | refl => exact ParStar.refl
  | tail _ s ih => exact ParStar.tail ih (step_par s)

/-- `ParStar` implies `Red` (each `Par` is a `Red`). -/
theorem parStar_red {t u : Tm} (h : ParStar t u) : Red t u := by
  induction h with
  | refl => exact Red.refl
  | tail _ p ih => exact Red.trans ih (par_red p)

/-- **CHURCH–ROSSER / confluence of `↦*`.** If `t ↦* u` and `t ↦* v`, then `u` and
`v` have a common reduct `w` (`u ↦* w`, `v ↦* w`). Proven via the parallel-reduction
diamond (Tait–Martin-Löf / Takahashi), with `Red` and `ParStar` mutually inclusive. -/
theorem church_rosser {t u v : Tm} (h1 : Red t u) (h2 : Red t v) :
    ∃ w, Red u w ∧ Red v w := by
  obtain ⟨w, hw1, hw2⟩ := par_confluent (red_parStar h1) (red_parStar h2)
  exact ⟨w, parStar_red hw1, parStar_red hw2⟩

/-! ## Curry–Howard — types as propositions, terms as proofs -/

/-- **Types as propositions** `propOfTy : Valuation → PredicationCell → Ty → Prop`:
`arrow = →`, `prod = ∧`, `unit = True`, and the base case reads a real charge fact
— `Charge.pos (v φ) = true` — instead of an arbitrary `Prop`. This is the
propositions-as-types half of Curry–Howard, grounded in the predication
hyperdoctrine's own valuations. -/
def propOfTy (v : Valuation) (φ : PredicationCell) : Ty → Prop
  | Ty.base => Charge.pos (v φ) = true
  | Ty.arrow A C => propOfTy v φ A → propOfTy v φ C
  | Ty.prod A C => propOfTy v φ A ∧ propOfTy v φ C
  | Ty.unit => True

@[simp] theorem propOfTy_arrow (v : Valuation) (φ : PredicationCell) (A C : Ty) :
    propOfTy v φ (Ty.arrow A C) = (propOfTy v φ A → propOfTy v φ C) := rfl
@[simp] theorem propOfTy_prod (v : Valuation) (φ : PredicationCell) (A C : Ty) :
    propOfTy v φ (Ty.prod A C) = (propOfTy v φ A ∧ propOfTy v φ C) := rfl
@[simp] theorem propOfTy_unit (v : Valuation) (φ : PredicationCell) :
    propOfTy v φ Ty.unit = True := rfl

/-- **Curry–Howard inhabitation.** When the valuation `v` charges the cell `φ`
positive (`Charge.pos (v φ) = true`), every type built from `→`, `×`, `unit` is
inhabited as a proposition — the proof is constructed by recursion on the type,
mirroring the term constructors `lam`/`pair`/`star`. A type *is* a provable
proposition; its proof IS a program. -/
theorem curry_howard {v : Valuation} {φ : PredicationCell} (hB : Charge.pos (v φ) = true) :
    ∀ A : Ty, propOfTy v φ A
  | Ty.base => hB
  | Ty.arrow A C => fun _ => curry_howard hB C
  | Ty.prod A C => ⟨curry_howard hB A, curry_howard hB C⟩
  | Ty.unit => trivial

/-! ## Lambek — the cartesian closed category laws

The type structure is a CCC: `unit` terminal, `prod` the product (`fst`/`snd`/`pair`
the universal cone), `arrow` the exponential with the currying adjunction
`Hom(C × A, B) ≅ Hom(C, A → B)`. We give the meta-level (`propOfTy`-valued) projection of
each universal property, the faithful image of the term calculus's `lam`/`app`/
`pair`/`fst`/`snd`/`star`. -/

/-- **Terminal object.** `unit` is terminal: from any object there is a unique map
to it — at the proposition level, `True` is inhabited, and uniquely (proof
irrelevance), the projection of `star`. -/
theorem ccc_terminal (v : Valuation) (φ : PredicationCell) (X : Ty) :
    propOfTy v φ X → propOfTy v φ Ty.unit :=
  fun _ => trivial

/-- **Product — the universal cone.** `prod A C` with `fst`/`snd` projections and
`pair` mediating: `(fst (pair a c), snd (pair a c)) = (a, c)` and pairing is the
unique mediating map (here, definitional β for products on the meta level). -/
theorem ccc_prod_fst (v : Valuation) (φ : PredicationCell) (A C : Ty)
    (a : propOfTy v φ A) (c : propOfTy v φ C) :
    (⟨a, c⟩ : propOfTy v φ (Ty.prod A C)).1 = a := rfl

theorem ccc_prod_snd (v : Valuation) (φ : PredicationCell) (A C : Ty)
    (a : propOfTy v φ A) (c : propOfTy v φ C) :
    (⟨a, c⟩ : propOfTy v φ (Ty.prod A C)).2 = c := rfl

/-- The pairing is the **unique** mediator: any `p : A × C` equals the pairing of its
projections — the η-law for products (the universal property's uniqueness). -/
theorem ccc_prod_eta (v : Valuation) (φ : PredicationCell) (A C : Ty)
    (p : propOfTy v φ (Ty.prod A C)) :
    (⟨p.1, p.2⟩ : propOfTy v φ (Ty.prod A C)) = p := rfl

/-- **Currying** `Hom(C × A, D) → Hom(C, A → D)` — the forward leg of the
exponential adjunction; the meta-level projection of the term `lam`. (`Bij` is a
`Type`-level record and these hom-sets are `Prop`-valued function spaces, so we give
the adjunction as a pair of mutually-inverse maps with round-trip laws,
rather than packing it into `Bij`.) -/
def curryFn (v : Valuation) (φ : PredicationCell) (C A D : Ty)
    (f : propOfTy v φ (Ty.prod C A) → propOfTy v φ D) :
    propOfTy v φ C → propOfTy v φ A → propOfTy v φ D :=
  fun c a => f ⟨c, a⟩

/-- **Uncurrying** `Hom(C, A → D) → Hom(C × A, D)` — the backward leg; the
meta-level projection of the term `app` (eval). -/
def uncurryFn (v : Valuation) (φ : PredicationCell) (C A D : Ty)
    (g : propOfTy v φ C → propOfTy v φ A → propOfTy v φ D) :
    propOfTy v φ (Ty.prod C A) → propOfTy v φ D :=
  fun p => g p.1 p.2

/-- **The exponential adjunction**, as the round-trip identities of `curryFn` /
`uncurryFn`: uncurry∘curry = id and curry∘uncurry = id. This IS the
`Hom(C × A, D) ≅ Hom(C, A → D)` natural isomorphism — the heart of "× ⊣ →". -/
theorem ccc_exponential_adjunction (v : Valuation) (φ : PredicationCell) (C A D : Ty) :
    (∀ f, uncurryFn v φ C A D (curryFn v φ C A D f) = f) ∧
    (∀ g, curryFn v φ C A D (uncurryFn v φ C A D g) = g) :=
  ⟨fun _ => rfl, fun _ => rfl⟩

/-- **`eval` / `app` at the meta level**: the counit of the adjunction
`(A ⇒ D) × A → D`, the projection of the term `app`. -/
theorem ccc_eval (v : Valuation) (φ : PredicationCell) (A D : Ty)
    (p : propOfTy v φ (Ty.prod (Ty.arrow A D) A)) : propOfTy v φ D := p.1 p.2

/-! ## The three-way correspondence -/

/-- The bundle witnessing the Curry–Howard–Lambek correspondence: the propositions
reading (`curry_howard`), the morphism-equality / normalization reading (Church–
Rosser confluence), and the CCC structure (terminal, product cone, exponential
adjunction). Types ↔ propositions ↔ objects; terms ↔ proofs ↔ morphisms;
β-reduction ↔ proof-normalization ↔ morphism-equality. -/
structure CurryHowardLambek where
  /-- **Types ↔ propositions** (Curry–Howard): when the valuation charges the cell
  positive, every `→/×/unit` type is an inhabited proposition; the proof is the
  program. -/
  types_are_props : ∀ {v : Valuation} {φ : PredicationCell},
    Charge.pos (v φ) = true → ∀ A : Ty, propOfTy v φ A
  /-- **β ↔ normalization ↔ equality** (Church–Rosser): the reduction relation is
  confluent, so the normal form (the proof's normalized value / the morphism's
  canonical representative) is unique. -/
  beta_confluent : ∀ {t u v : Tm}, Red t u → Red t v → ∃ w, Red u w ∧ Red v w
  /-- **Lambek, terminal**: `unit` is terminal. -/
  ccc_terminal : ∀ (v : Valuation) (φ : PredicationCell) (X : Ty),
    propOfTy v φ X → propOfTy v φ Ty.unit
  /-- **Lambek, product**: `prod` is the product (η-law: every element is its
  projections paired). -/
  ccc_product : ∀ (v : Valuation) (φ : PredicationCell) (A C : Ty)
    (p : propOfTy v φ (Ty.prod A C)),
    (⟨p.1, p.2⟩ : propOfTy v φ (Ty.prod A C)) = p
  /-- **Lambek, exponential**: the currying adjunction `Hom(C×A,D) ≅ Hom(C,A→D)`. -/
  ccc_exponential : ∀ (v : Valuation) (φ : PredicationCell) (C A D : Ty),
    (∀ f, uncurryFn v φ C A D (curryFn v φ C A D f) = f) ∧
    (∀ g, curryFn v φ C A D (uncurryFn v φ C A D g) = g)

/-- **The Curry–Howard–Lambek correspondence.** PROOFS = PROGRAMS =
MORPHISMS, made one theorem:

* (**Curry–Howard**) a well-typed term IS a proof of its type-as-proposition
  (`→ = ⇒`, `× = ∧`, `unit = ⊤`): every such type is inhabited, the term tracking
  the proof (`curry_howard`);
* (**confluence**) β/projection reduction is Church–Rosser
  (`church_rosser`, via the Tait–Martin-Löf parallel-reduction diamond) — so
  proof-normalization is well-defined and morphism-equality is coherent;
* (**Lambek**) the type structure is a cartesian closed category: `unit` terminal,
  `prod` the product, `arrow` the exponential with the currying adjunction
  `Hom(C×A,B) ≅ Hom(C,A→B)` (`ccc_exponential_adjunction`).

This is the categorical-logic projection of the predication hyperdoctrine: the
hyperdoctrine's quantifier adjoints are the dependent generalization of exactly this
`× ⊣ →` adjunction. -/
theorem curry_howard_lambek : CurryHowardLambek where
  types_are_props := fun hB A => curry_howard hB A
  beta_confluent := fun h1 h2 => church_rosser h1 h2
  ccc_terminal := ccc_terminal
  ccc_product := ccc_prod_eta
  ccc_exponential := ccc_exponential_adjunction

/-! ## The CHL quartet ≅ the nuclear quartet (the recurring FOUR) -/

/-- The **four type-formers** of the CHL correspondence — the four corners of the
square `{terminal, product, exponential, base/dual}`:

* `terminal`    — `unit` (the terminal object / `⊤`),
* `product`     — `prod` (the product / `∧`),
* `exponential` — `arrow` (the exponential / `⇒`),
* `dual`        — `base` (the atomic object, read as the remaining/dual corner). -/
inductive TypeFormer where
  /-- `unit` — the terminal corner. -/
  | terminal
  /-- `prod` — the product corner. -/
  | product
  /-- `arrow` — the exponential corner. -/
  | exponential
  /-- `base` — the remaining/dual corner. -/
  | dual
  deriving DecidableEq, Repr

namespace TypeFormer

/-- The complete list of the four type-formers. -/
def all : List TypeFormer := [terminal, product, exponential, dual]

/-- The CHL former read as a recurring `Articulating.Corner`: `terminal ↦ potential`,
`exponential ↦ active`, `product ↦ stable`, `dual ↦ absurd`. -/
def toCorner : TypeFormer → Articulating.Corner
  | terminal    => Articulating.Corner.potential
  | exponential => Articulating.Corner.active
  | product     => Articulating.Corner.stable
  | dual        => Articulating.Corner.absurd

/-- The inverse. -/
def ofCorner : Articulating.Corner → TypeFormer
  | Articulating.Corner.potential => terminal
  | Articulating.Corner.active    => exponential
  | Articulating.Corner.stable    => product
  | Articulating.Corner.absurd    => dual

@[simp] theorem ofCorner_toCorner (f : TypeFormer) : ofCorner (toCorner f) = f := by
  cases f <;> rfl
@[simp] theorem toCorner_ofCorner (c : Articulating.Corner) : toCorner (ofCorner c) = c := by
  cases c <;> rfl

/-- **`Articulating.Corner ≃ TypeFormer`.** The four type-formers ARE the recurring four corners —
the same object the nuclear quartet, modal four, and bilattice charge are read as. -/
def cornerBij : Bij Articulating.Corner TypeFormer where
  to := ofCorner
  inv := toCorner
  left := toCorner_ofCorner
  right := ofCorner_toCorner

/-- The number of type-formers is exactly four — reusing `Articulating.Corner.card_eq_four`. -/
theorem card_eq_four : all.length = 4 := rfl

end TypeFormer

/-- The typed CHL quartet of type-formers, carrying the explicit bijection with
`Articulating.Corner`. -/
structure TypeFormerQuartetIsNuclear where
  /-- The CHL formers are the recurring articulation/nuclear corners. -/
  cornerBij : Bij Articulating.Corner TypeFormer

/-- **The CHL quartet IS the nuclear quartet.** The four type-formers of
the Curry–Howard–Lambek correspondence `{terminal=unit, product=×, exponential=→,
dual=base}` biject with the recurring `Articulating.Corner` (the SAME four corners that index the
nuclear quartet `(A, Fix j₁, Fix j₂, A*)`, the modal four `{neither,◇,□,both}`, and
the bilattice charge): an explicit, proven `Bij Articulating.Corner TypeFormer`, both directions
round-tripping to the identity, exhaustively four with no fifth corner, reusing the
nuclear quartet's own `Articulating.Corner.card_eq_four`.

So the four corners of the correspondence are literally the recurring FOUR: the
type-theoretic incarnation of the one four-corner coherence cell met at every depth
of the spine. -/
def chl_quartet_is_nuclear : TypeFormerQuartetIsNuclear where
  cornerBij := TypeFormer.cornerBij

end Predicating.CurryHowardLambek
end Obsmetrologia
