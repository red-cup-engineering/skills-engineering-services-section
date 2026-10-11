import Obsmetrologia.QuantumContextuality.MeasurementScenario

/-! # The contextuality hierarchy — logical contextuality

The Abramsky–Brandenburger possibilistic hierarchy refines the strong contextuality of
`QuantumContextuality.MeasurementScenario`. A model is:

* **strongly contextual** when *no* global section lies in every support (`StronglyContextual`);
* **logically contextual** when *some* local section in some context's support extends to no
  global section (`LogicallyContextual`) — strictly weaker;
* **(possibilistically) noncontextual** when *every* local section extends
  (`PossibilisticallyNoncontextual = ¬ LogicallyContextual`).

The inclusions are `strong ⟹ logical ⟹ ¬noncontextual`. (Note `MeasurementScenario.Noncontextual`
= "has *some* global section" is weaker than full possibilistic noncontextuality, which is the
extension-of-*every*-section condition defined here — a model can have a global section yet
still be logically contextual, the Hardy phenomenon.)

This module is finite and possibilistic. The **probabilistic** obstruction — CHSH/Bell/
Kochen–Specker numerical inequalities and the contextual fraction — builds on Obsmetrologia's
internal reals (`Probability.RealStochasticInterval`) via a finite linear-programming
argument; it is the natural next layer, developed separately.

## Main definitions

* `Extends` — a local section extends to a global section agreeing with it on its context.
* `LogicallyContextual`, `PossibilisticallyNoncontextual` — the logical contextuality rung and
  its negation.

## Main results

* `noncontextual_imp_not_logicallyContextual` — every-section-extends rules out logical
  contextuality (the constructive direction; the classical converse is withheld).
* `stronglyContextual_imp_logicallyContextual` — strong contextuality (with a witnessed
  support element) implies logical contextuality.
* `prBox_logicallyContextual` — the PR box is logically contextual (it inhabits the rung).

## References

`content/.../sheaf`; Abramsky & Brandenburger 2011. Sibling: `QuantumContextuality.MeasurementScenario`,
`QuantumContextuality.SupportContextuality`.

## Tags

contextuality, logical contextuality, extension, global section, PR box, hierarchy
-/

namespace Obsmetrologia
namespace QuantumContextuality

variable {M O : Type}

/-! ## (A) Extension of a local section -/

/-- A local section `g` over context `C` **extends** to a global section when some assignment
`h` lies in the support of *every* context and agrees with `g` on `C`. (The local datum
embeds into a globally consistent one — the gluing of `g`.) -/
def Extends (E : Model M O) (C : List M) (g : M → O) : Prop :=
  ∃ h : M → O, (∀ C', C' ∈ E.scenario.contexts → E.support C' h) ∧ (∀ m, m ∈ C → h m = g m)

/-! ## (B) The logical contextuality rung -/

/-- A model is **logically contextual** when some local section in some context's support
extends to no global section. Strictly weaker than strong contextuality. -/
def LogicallyContextual (E : Model M O) : Prop :=
  ∃ C, C ∈ E.scenario.contexts ∧ ∃ g, E.support C g ∧ ¬ Extends E C g

/-- A model is **possibilistically noncontextual** when *every* local section in every support
extends to a global section. This is the possibilistic noncontextuality (stronger than
`MeasurementScenario.Noncontextual`, which asks only for *one* global section). -/
def PossibilisticallyNoncontextual (E : Model M O) : Prop :=
  ∀ C, C ∈ E.scenario.contexts → ∀ g, E.support C g → Extends E C g

/-- **Possibilistic noncontextuality implies no logical contextuality.** If every local
section extends, no local section fails to extend. (The converse is the classical
double-negation `¬¬Extends → Extends`, which Obsmetrologia's constructive logic withholds — it is
not claimed.) -/
theorem noncontextual_imp_not_logicallyContextual (E : Model M O)
    (h : PossibilisticallyNoncontextual E) : ¬ LogicallyContextual E := by
  intro hlc
  obtain ⟨C, hC, g, hg, hne⟩ := hlc
  exact hne (h C hC g hg)

/-! ## (C) Strong contextuality implies logical contextuality -/

/-- **Strong contextuality implies logical contextuality.** Given any witnessed support
element `g₀` of a context `C₀` and no global section (the strong contextuality data), `g₀`
extends to no global section — its extension would itself be a global section. -/
theorem stronglyContextual_imp_logicallyContextual (E : Model M O)
    {C₀ : List M} (hC₀ : C₀ ∈ E.scenario.contexts) {g₀ : M → O} (hg₀ : E.support C₀ g₀)
    (hns : ¬ HasGlobalSection E) : LogicallyContextual E := by
  refine ⟨C₀, hC₀, g₀, hg₀, ?_⟩
  rintro ⟨h, hglob, _⟩
  exact hns ⟨h, hglob⟩

/-! ## (D) The PR box inhabits logical contextuality -/

/-- **The PR box is logically contextual.** Its support over context `{a, b}` is nonempty
(`prBox_inhabited`), yet no global section exists (`prBox_no_global`), so that local section
extends to none — the PR box sits on the logical rung (in fact the strong one above it). -/
theorem prBox_logicallyContextual : LogicallyContextual prBox := by
  obtain ⟨g₀, hg₀⟩ := prBox_inhabited [(false, false), (true, false)] (by decide)
  exact stronglyContextual_imp_logicallyContextual prBox (by decide) hg₀ prBox_no_global

end QuantumContextuality
end Obsmetrologia
