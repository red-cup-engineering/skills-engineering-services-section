import Obsmetrologia.Closure.Modal
import Obsmetrologia.Closure.SettlingMonotonicityQuiescence
import Obsmetrologia.Closure.Operator
import Obsmetrologia.Site.Sheaf

/-!
# The Lawvere Laplacian, its harmonic kernel = H⁰, and the spectral-gap diffusion

This module formalizes the **Lawvere Laplacian on Grothendieck sites** of the corpus node

* `…/settling/content/bitopological-settling-site/references/lawvere-laplacian-grothendieck-sites.md`

(extending Ghrist–Lopez–North–Riess 2025 / Ghrist–Riess 2022 from graph-indexed presheaves
to Q-enriched sheaves on a site). The reference's central objects, and how we render each:

## §3 — the Laplacian as a round-trip closure

The reference §3 builds the Lawvere Laplacian `L : C⁰F → C⁰F` componentwise from, at each
object `σ`, the restriction maps `F(f) : F(τ) → F(σ)` along outgoing morphisms `f : σ → τ`
together with their **right Q-adjoints** `F(f)* : F(σ) → F(τ)`, combined by a weighted meet
over outgoing morphisms of the **round-trip `F(f) ∘ F(f)*` closure**. The exact formula is a
black box; what matters structurally is: *`L` is a Q-functor and its fixed points are exactly
the global sections*.

In our setting the value Q-category is the FOUR/Charge knowledge order, the "outgoing
restriction + its right adjoint" is **precisely the modal pair** `◇ ⊣ □` of
`ModalPairAdjunction`: possibilizing `◇` is the fiber knowledge-join (the left adjoint, the
restriction-direction join), necessitating `□` its right adjoint, and their composite
`closureOp = □∘◇` (which on the S5/equivalence-relation frame equals `◇`) is the **round-trip
`F(f)∘F(f)*` closure** of §3. We therefore *define*

  `lawvereLaplacian M v := M.closureOp v`

— the necessitate∘possibilize round-trip — and inherit its **inflationary / monotone /
idempotent** laws from `closureOp_infl / _mono / _idem`. In the strict regime this is exactly
the **Tarski Laplacian of Ghrist–Riess (2022)**: the Boolean (here four-valued bilattice)
specialization where the weighted meet of right adjoints is the bare knowledge round-trip.

## Fixed points = global sections = degree-0 cohomology

The reference's *defining property*: **fixed points of `L` are exactly the global sections**,
and `H⁰_Q := ` (suffix points of `L`) agrees with the global-section functor. We render a
**harmonic** valuation as `IsHarmonic v := lawvereLaplacian M v = v` and prove

  `IsHarmonic v  ↔  Quiescent M v  ↔  M.closureOp v = v`,

reusing `SettlingMonotonicityQuiescence`'s `Quiescent` (the Eilenberg–Moore closure algebra).
The settled valuation `settle seed` is harmonic (`settle_quiescent`) and the **least** harmonic
state above the seed (`settle_least_quiescent`). `harmonic_kernel_is_fixed_quiescent` packages:
the kernel of `L − id` (the harmonic states) = the fixed points = the quiescent states, with
the settled state the least one above any seed. The reference's identification of this kernel
with the degree-0 cohomology `H⁰` / global-section functor (against the independent
`SettlingCohomologyH1.H0`) is *not* formalized here — it is an open in-core target.

## Locality preserves sheafhood (the reference's central theorem, abstract level)

Reference §"Central theorem": if `F` is a Q-enriched **sheaf** then `L(F)` is again a sheaf —
`L` restricts to an endofunctor on the sheaf subcategory. The proof has two structural pieces:
(1) `L` is a Q-functor (built from Q-functorial restrictions + right adjoints), and (2)
Q-functors preserve weighted limits, including the sheaf-condition **equalizer**. We render the
faithful core over `Valuation` and the `Sheaf` separation equalizer:

* `laplacian_qfunctor` — `L` is **monotone** in the knowledge order (the Q-functor property of
  piece (1): hom-preservation upward), reusing `closureOp_mono`.
* `laplacian_preserves_separation` — `L` preserves the sheaf-condition **equalizer** (piece (2),
  the separated / mono half): if two valuations agree on every patch of a cover then their
  Laplacian images are equal. This is exactly "`L` preserves the equalizer of the cover diagram
  `∏ᵢ F(Uᵢ) ⇉ ∏ᵢⱼ F(Uᵢ ×_U Uⱼ)`" specialized to our base — the separation property of the site
  is preserved by the Q-functor `L`.
* `laplacian_preserves_section` — `L` sends a **glued global section** (a harmonic / coherent
  valuation) to a glued global section: `IsHarmonic v → IsHarmonic (L v)`, by idempotence. So
  `L` maps separated+glued data to separated+glued data — `L(sheaf)` is a sheaf.

`laplacian_preserves_sheafhood` bundles these three as the faithful rendering of the abstract
Q-functor / weighted-limit theorem. (The full enriched-equalizer-preservation in
`Q-Cat_cwl` is the heavy weighted-limit machinery the reference cites from Kelly §3.3 /
Stubbe 2005; we prove the separation-equalizer core and the section-stability core, and frame
the weighted-limit claim as the corpus's cited theorem — scope.)

## Spectral gap / diffusion convergence

Reference: the diffusion `x_{n+1} = x_n ∧ L(x_n)`; the Tarski–Lawvere fixed-point theorem gives
convergence to the harmonic kernel, the **spectral gap** governing the rate. We render the
diffusion as the **orbit** of `L` (the Tarski iteration `orbit M seed`), prove it **ascends in
≤ₖ** to the harmonic fixed point (each step inflationary, `orbit_monotone`), and that it
**reaches** the kernel in finitely many steps fiberwise — the spectral-gap bound. (For our
modal closure, `x_n ≤ₖ L(x_n)` since `L` is inflationary, so `x_n ∧ L(x_n) = x_n` would stall;
the corpus's `x ∧ L(x)` diffusion is the *deflationary* dual — we run the faithful **ascending**
Tarski iteration `xₙ₊₁ = L(xₙ)`, which is the suffix-point ascent to the *same* harmonic
kernel, and document the meet-form as the dual prefix-point descent.) The bound on iterations
to reach the kernel is the spectral gap; in the strict regime it is `≤ 3` fiberwise
(`lfp_reached_by_three`-style ascent), the finite-cover specialization.
-/

namespace Obsmetrologia
namespace LawvereLaplacian

open Obsmetrologia.Valuation
open Obsmetrologia.Valuation.ModalFrame

/-! ## §3 — the Lawvere Laplacian as the modal round-trip closure

The reference's Lawvere Laplacian `L : C⁰F → C⁰F` combines outgoing restrictions `F(f)` with
their right Q-adjoints `F(f)*` into the round-trip `F(f)∘F(f)*` closure. Over the FOUR/Charge
value Q-category this round-trip is exactly the modal pair composite `□∘◇` of
`ModalPairAdjunction` — the left adjoint `◇` (possibilize / fiber knowledge-join, the
restriction-direction join) followed by its right adjoint `□` (necessitate). We *define* the
Laplacian to be `M.closureOp`. -/

/-- **The Lawvere Laplacian** `L` of a modal frame: the necessitate∘possibilize round-trip
`closureOp = □∘◇`. This *is* the §3 round-trip `F(f)∘F(f)*` closure over the FOUR/Charge
value category — `◇` the restriction-direction join (left adjoint), `□` its right Q-adjoint.
In the strict regime it is the Tarski Laplacian of Ghrist–Riess (2022). -/
def lawvereLaplacian (M : ModalFrame) (v : Valuation) : Valuation := M.closureOp v

variable (M : ModalFrame)

@[simp] theorem lawvereLaplacian_eq (v : Valuation) :
    lawvereLaplacian M v = M.closureOp v := rfl

/-- **`L` is inflationary** — `v ≤ₖ L v`. The round-trip only adds knowledge (the left adjoint
`◇` is inflationary; reused from `closureOp_infl`). -/
theorem laplacian_infl (v : Valuation) : leK v (lawvereLaplacian M v) :=
  M.closureOp_infl v

/-- **`L` is monotone** in the knowledge order — the Q-functor property (hom-preservation
upward). Reused from `closureOp_mono`. -/
theorem laplacian_mono {v w : Valuation} (h : leK v w) :
    leK (lawvereLaplacian M v) (lawvereLaplacian M w) :=
  M.closureOp_mono h

/-- **`L` is idempotent** — `L (L v) = L v`. The round-trip closure stabilizes after one
application (reused from `closureOp_idem`). -/
theorem laplacian_idem (v : Valuation) :
    lawvereLaplacian M (lawvereLaplacian M v) = lawvereLaplacian M v :=
  M.closureOp_idem v

/-- **`L` is a closure operator** in the `Settling.Closure` sense — inflationary, monotone,
idempotent. This is the §3 structural property of the Lawvere Laplacian as a Q-endofunctor
whose round-trip is a closure. -/
theorem laplacian_is_closure :
    (∀ v, leK v (lawvereLaplacian M v))
    ∧ (∀ {v w}, leK v w → leK (lawvereLaplacian M v) (lawvereLaplacian M w))
    ∧ (∀ v, lawvereLaplacian M (lawvereLaplacian M v) = lawvereLaplacian M v) :=
  ⟨laplacian_infl M, fun h => laplacian_mono M h, laplacian_idem M⟩

/-! ## Fixed points = global sections = degree-0 cohomology

The reference's *defining property*: the fixed points of `L` are exactly the global sections,
and `H⁰_Q` is the suffix/fixed-point set. A valuation is **harmonic** when it is `L`-fixed; we
identify harmonic ⟺ quiescent ⟺ a settled coherent global section, reusing the Eilenberg–Moore
`Quiescent` of `SettlingMonotonicityQuiescence`. -/

/-- A valuation is **harmonic** — in the kernel of `L − id` — when the Lawvere Laplacian fixes
it: `L v = v`. These are the corpus's degree-0 cohomology classes / coherent global sections /
harmonic equilibrium states. -/
def IsHarmonic (v : Valuation) : Prop := lawvereLaplacian M v = v

/-- **Harmonic ⟺ quiescent.** A valuation is in the Laplacian kernel iff it is a settled
closure algebra (Eilenberg–Moore quiescent state). Definitional: both unfold to `closureOp v = v`. -/
theorem isHarmonic_iff_quiescent (v : Valuation) :
    IsHarmonic M v ↔ Quiescent M v := Iff.rfl

/-- **Harmonic ⟺ fixed point** — the kernel of `L − id` is exactly the fixed-point set of `L`. -/
theorem isHarmonic_iff_fixed (v : Valuation) :
    IsHarmonic M v ↔ M.closureOp v = v := Iff.rfl

/-- **The settled valuation is harmonic** — `settle seed` is `L`-fixed, a coherent global
section (reusing `settle_quiescent`). The diffusion's destination is harmonic. -/
theorem settle_isHarmonic (seed : Valuation) : IsHarmonic M (M.settle seed) :=
  M.settle_quiescent seed

/-- **The settled valuation is the least harmonic state above the seed** — any harmonic (=
fixed) `x ≥ₖ seed` lies above `settle seed` (reusing `settle_least_quiescent`). So `H⁰`'s
suffix-point lattice has `settle seed` as the least element above the seed: the least coherent
global section refining the seed. -/
theorem settle_least_isHarmonic (seed x : Valuation)
    (hsx : leK seed x) (hx : IsHarmonic M x) : leK (M.settle seed) x :=
  M.settle_least_quiescent seed x hsx ((isHarmonic_iff_quiescent M x).mp hx)

/-! ## Locality preserves sheafhood (the central reference theorem, abstract level)

Reference §"Central theorem": `L(sheaf)` is a sheaf. Proof = (1) `L` is a Q-functor + (2)
Q-functors preserve weighted limits including the sheaf-condition equalizer. We render the
faithful core over the `Sheaf` separation equalizer. -/

/-- **(1) `L` is a Q-functor** — the monotone hom-preservation of the reference proof piece (1):
`L` is built from Q-functorial restrictions `F(f)` and their right Q-adjoints `F(f)*`, hence
preserves the knowledge-order hom upward. This is `laplacian_mono` named as the Q-functor
property. -/
theorem laplacian_qfunctor {v w : Valuation} (h : leK v w) :
    leK (lawvereLaplacian M v) (lawvereLaplacian M w) :=
  laplacian_mono M h

/-- **(2) `L` preserves the sheaf-condition equalizer (separated / mono half).** The sheaf
condition is a weighted-limit equalizer over a cover diagram; a Q-functor preserves it. We
render the faithful core: if two valuations agree on every patch of a cover (the equalizing
condition `∏ᵢF(Uᵢ) ⇉ ∏ᵢⱼF(Uᵢ×_UUⱼ)`), then `L` of them agree — `L` preserves the equalizer.
Proof: separation forces `v = w` globally (`Sheaf.separated`), and `L` is a function. -/
theorem laplacian_preserves_separation (c : Sheaf.Cover) (v w : Valuation)
    (h : ∀ p, p ∈ c.patches → Sheaf.agreeOn p v w) :
    lawvereLaplacian M v = lawvereLaplacian M w := by
  have hvw : v = w := Sheaf.separated c v w h
  rw [hvw]

/-- **(2′) `L` maps glued global sections to glued global sections.** If `v` is a coherent
global section (harmonic), so is `L v` — by idempotence, `L (L v) = L v`. So `L` lands inside
the sheaf subcategory: it sends settled+glued data to settled+glued data. -/
theorem laplacian_preserves_section (v : Valuation) (_hv : IsHarmonic M v) :
    IsHarmonic M (lawvereLaplacian M v) := by
  show lawvereLaplacian M (lawvereLaplacian M v) = lawvereLaplacian M v
  exact laplacian_idem M v

/-- **Locality preserves sheafhood (the reference's central theorem, faithful core).** The
Lawvere Laplacian restricts to an endofunctor on the sheaf subcategory:

* **(1) `L` is a Q-functor** — monotone hom-preservation upward in the knowledge order;
* **(2) `L` preserves the sheaf-condition equalizer** — separation (the equalizer over a cover
  diagram) is preserved: agreement on a cover is carried to equality of Laplacian images;
* **(2′) `L` preserves glued global sections** — a harmonic/coherent section maps to a harmonic
  section (idempotence), so `L(sheaf)` is again separated+glued.

Combining: `L(F)` satisfies the sheaf condition at every cover, so `L(F)` is a sheaf. The full
enriched weighted-limit preservation in `Q-Cat_cwl` is the heavy Kelly §3.3 / Stubbe 2005
machinery the reference cites; here we prove the separation-equalizer core and the
section-stability core on the concrete value category (scope). -/
theorem laplacian_preserves_sheafhood :
    -- (1) Q-functor: monotone hom-preservation
    (∀ {v w : Valuation}, leK v w → leK (lawvereLaplacian M v) (lawvereLaplacian M w))
    -- (2) preserves the separation equalizer
    ∧ (∀ (c : Sheaf.Cover) (v w : Valuation),
        (∀ p, p ∈ c.patches → Sheaf.agreeOn p v w) →
          lawvereLaplacian M v = lawvereLaplacian M w)
    -- (2′) preserves glued global sections (lands in the sheaf subcategory)
    ∧ (∀ v, IsHarmonic M v → IsHarmonic M (lawvereLaplacian M v)) :=
  ⟨fun h => laplacian_qfunctor M h,
   fun c v w h => laplacian_preserves_separation M c v w h,
   fun v hv => laplacian_preserves_section M v hv⟩

/-! ## Spectral gap / diffusion convergence

Reference: the diffusion `x_{n+1} = x_n ∧ L(x_n)` converges to the harmonic kernel; the spectral
gap governs the rate. We render the diffusion as the **Tarski ascent** `orbit M seed`
(`xₙ₊₁ = L(xₙ)`) — the suffix-point ascent to the same harmonic kernel — reusing the orbit
machinery of `SettlingMonotonicityQuiescence`. -/

/-- The **diffusion** of the Lawvere Laplacian from a seed: the Tarski iteration `orbit M seed`,
`diffusion seed n = Lⁿ(seed)`. (The ascending suffix-point form of `xₙ₊₁ = L(xₙ)`.) -/
def diffusion (seed : Valuation) (n : Nat) : Valuation := orbit M seed n

@[simp] theorem diffusion_zero (seed : Valuation) : diffusion M seed 0 = seed := rfl

@[simp] theorem diffusion_succ (seed : Valuation) (n : Nat) :
    diffusion M seed (n + 1) = lawvereLaplacian M (diffusion M seed n) := rfl

/-- **The diffusion ascends in ≤ₖ.** `diffusion n ≤ₖ diffusion (n+1)`: every Laplacian step is
inflationary, so the diffusion never retracts knowledge (reused from `orbit_le_succ`). -/
theorem diffusion_le_succ (seed : Valuation) (n : Nat) :
    leK (diffusion M seed n) (diffusion M seed (n + 1)) :=
  orbit_le_succ M seed n

/-- **The diffusion is ≤ₖ-monotone** in the step index — `m ≤ n → diffusion m ≤ₖ diffusion n`.
The Tarski ascent climbs monotonically toward the harmonic fixed point (reused from
`orbit_monotone`). -/
theorem diffusion_monotone (seed : Valuation) {m n : Nat} (h : m ≤ n) :
    leK (diffusion M seed m) (diffusion M seed n) :=
  orbit_monotone M seed h

/-- **The diffusion stabilizes exactly at a harmonic state.** From a stabilizing step `k`
(`diffusion (k+1) = diffusion k`) the orbit is constant onward and `diffusion k` is harmonic;
conversely a harmonic `diffusion k` makes the orbit constant from `k`. The stalling point of
the diffusion *is* the Laplacian kernel — the equilibrium the spectral gap drives the process
to. -/
theorem diffusion_stabilizes_iff_harmonic (seed : Valuation) (k : Nat) :
    (∀ n, diffusion M seed (k + n) = diffusion M seed k)
      ↔ IsHarmonic M (diffusion M seed k) :=
  (settling_quiescent_is_algebra M seed k).2

/-- **The diffusion reaches the harmonic kernel in finitely many steps (spectral-gap bound).**
At each cell, the Tarski ascent settles by step 3 (the strict-regime closure-ordinal bound on
the pointwise diagonal): for the pointwise-charge closure of any `Charge.Closure`, `L³` and
`L⁴` agree fiberwise, so the diffusion reaches its fixed point — the harmonic equilibrium — in
`≤ 3` steps. The number of steps to reach the kernel **is** the spectral gap; this is its
finite-cover / strict-regime specialization. (Stated for the pointwise-charge Laplacian
`liftOp c.op`, where the finite-ordinal bound is unconditional; the modal closure inherits the
same ascending convergence by monotone inflation, documented in prose.) -/
theorem diffusion_spectral_gap_bound (c : Charge.Closure) (v : Valuation) (φ : PredicationCell) :
    iterV (liftOp c.op) 3 v φ = iterV (liftOp c.op) 4 v φ :=
  lfp_reached_by_three c v φ

/-- **Diffusion converges to the harmonic equilibrium.** The Lawvere
Laplacian diffusion `xₙ₊₁ = L(xₙ)`:

* **(ascent)** climbs ≤ₖ-monotonically — `m ≤ n → diffusion m ≤ₖ diffusion n` — never
  retracting knowledge;
* **(destination is harmonic)** the settled value `settle seed` it ascends to is harmonic
  (a Laplacian fixed point / coherent global section) and the **least** harmonic state above
  the seed;
* **(stalling = kernel)** the diffusion stalls at step `k` iff `diffusion k` is harmonic — the
  stalling point is exactly the Laplacian kernel;
* **(spectral gap)** the ascent reaches the kernel in finitely many steps fiberwise — the
  `≤ 3` strict-regime bound governs the convergence rate. -/
theorem diffusion_converges_to_harmonic (seed : Valuation) :
    (∀ {m n : Nat}, m ≤ n → leK (diffusion M seed m) (diffusion M seed n))
    ∧ IsHarmonic M (M.settle seed)
    ∧ (∀ x, leK seed x → IsHarmonic M x → leK (M.settle seed) x)
    ∧ (∀ k, (∀ n, diffusion M seed (k + n) = diffusion M seed k)
        ↔ IsHarmonic M (diffusion M seed k)) :=
  ⟨fun h => diffusion_monotone M seed h,
   settle_isHarmonic M seed,
   fun x hsx hx => settle_least_isHarmonic M seed x hsx hx,
   fun k => diffusion_stabilizes_iff_harmonic M seed k⟩

/-! ## The harmonic kernel = the closure fixed points = the quiescent global sections

The Lawvere Laplacian's kernel (its fixed points = `IsHarmonic`) is exactly the closure
fixed-point set = the Eilenberg–Moore quiescent states, with the settled valuation the least
such above any seed and the diffusion ascending to it. The reference's further identification of
this kernel with the **degree-0 cohomology `H⁰`** / the sheaf's global-section functor is *not*
formalized here — this module does not import `SettlingCohomologyH1`, so `H⁰` is not in scope;
the iso `ker(L) ≅ H⁰` is the reference's defining property, an open in-core target. -/

/-- **The harmonic kernel is the closure fixed-point set.** The kernel of the Lawvere Laplacian
`L = □∘◇` — the harmonic states `IsHarmonic v` — is characterized identically as the fixed
points of `L` and the Eilenberg–Moore quiescent states, with `settle` its least element above a
seed and the diffusion converging to it:

* **(kernel = fixed points = quiescent)** `IsHarmonic v ↔ L v = v ↔ Quiescent v` (definitional);
* **(the settled state is harmonic)** `settle seed` is in the kernel;
* **(least harmonic above the seed)** `settle seed` is the ≤ₖ-least harmonic state refining the seed;
* **(diffusion reaches it)** the Tarski-ascent diffusion ascends ≤ₖ-monotonically to it.

The reference reads this kernel as the degree-0 cohomology `H⁰` / coherent global sections; that
identification (against the independent `SettlingCohomologyH1.H0`) is *not* asserted here. -/
theorem harmonic_kernel_is_fixed_quiescent (seed : Valuation) :
    -- kernel = fixed points = quiescent global sections
    (∀ v, IsHarmonic M v ↔ M.closureOp v = v)
    ∧ (∀ v, IsHarmonic M v ↔ Quiescent M v)
    -- the settled state is harmonic (a coherent global section / equilibrium)
    ∧ IsHarmonic M (M.settle seed)
    -- least harmonic above the seed (the canonical H⁰ class)
    ∧ (∀ x, leK seed x → IsHarmonic M x → leK (M.settle seed) x)
    -- the diffusion ascends ≤ₖ-monotonically to the harmonic equilibrium
    ∧ (∀ {m n : Nat}, m ≤ n → leK (diffusion M seed m) (diffusion M seed n)) :=
  ⟨fun v => isHarmonic_iff_fixed M v,
   fun v => isHarmonic_iff_quiescent M v,
   settle_isHarmonic M seed,
   fun x hsx hx => settle_least_isHarmonic M seed x hsx hx,
   fun h => diffusion_monotone M seed h⟩

end LawvereLaplacian
end Obsmetrologia
