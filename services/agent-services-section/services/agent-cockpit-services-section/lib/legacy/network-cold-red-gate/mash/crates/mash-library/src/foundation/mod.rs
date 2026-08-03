//! Foundation: the OQRA vocabulary — the four ontological primitives
//! (Object, Quality, Relation, Act) that constitute a thing, plus the
//! morphism triggers the engine recognizes.
//!
//! # What lives here
//!
//! - **Core category terms.** `THING`, `OBJECT`, `QUALITY`, `RELATION`,
//!   `ACT` as canonical reference-terms. Subjects that are-a-thing
//!   or specialize-as thing acquire OQRA semantics.
//! - **OQRA relator predicates.** `HAS_OBJECT_PART`, `HAS_QUALITY`,
//!   `IN_RELATION`, `CAN_ACT`. These are the generic relators;
//!   specific qualities / relations / acts specialize from them.
//!   Declared as single-direction predicates per the inversion
//!   discipline in [`crate::container`] — reverse queries use
//!   fiber-scan at the object axis, not a converse predicate.
//! - **Morphism triggers.** The eleven predicate names the engine's
//!   proof module recognizes as trigger-predicates: `specializes-as`,
//!   `inverts-as`, and the three pair-role sets for composition,
//!   fusion, and implication. The engine hardcodes the names; this
//!   module exposes them as public constants and declares them as
//!   predicates in-substrate.
//! - **Witnessing primitives.** `ASSERTED_BY`, `DERIVED_FROM`,
//!   `DERIVED_VIA`, `AT_TIME` for provenance — all single-direction.
//! - **The [`Foundation`] owner-agent.** Implements [`Agent`] to mount
//!   all of the above at hub boot with their `IS_A_TERM` /
//!   `IS_A_PREDICATE` declarations.
//!
//! # Wiener/Barad framing
//!
//! A thing is NOT a record, class, or struct. A subject becomes a
//! thing by being the subject of a settled `IS_A_THING` claim (or by
//! specializing from a thing-kind via `SPECIALIZES_AS`). Its
//! object-parts, qualities, relations, and acts are additional settled
//! claims; querying "what is this thing" reads the fiber-region of
//! the manifold at that subject.

#![warn(missing_docs)]

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

// ─────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────

/// Owner identity for the foundation agent; used as the anchor object
/// on membership claims like `(pred, is-a-predicate, mash-library-foundation)`.
pub const IDENTITY: &str = "mash-library-foundation";

// ─────────────────────────────────────────────────────────────────────
// Meta-predicates (term / predicate classification)
// ─────────────────────────────────────────────────────────────────────

/// `(t, is-a-term, owner)` — subject `t` is a declared term.
pub const IS_A_TERM: &str = "is-a-term";
/// `(p, is-a-predicate, owner)` — subject `p` is a declared predicate.
pub const IS_A_PREDICATE: &str = "is-a-predicate";

// ─────────────────────────────────────────────────────────────────────
// Morphism trigger predicates
//
// The engine's `proof::TRIGGERS` table hardcodes these names. Witnessing
// a claim with one of these predicates and value `True` installs a
// morphism instance in the cascade. These constants give the library and
// downstream code a canonical symbolic handle on the names.
// ─────────────────────────────────────────────────────────────────────

/// `(p, specializes-as, q)` — values at `(s, p, o)` lift pointwise to
/// `(s, q, o)`. Trigger for `MorphismKind::Specialization`.
pub const SPECIALIZES_AS: &str = "specializes-as";
/// `(p, inverts-as, q)` — `(s, p, o)` induces a negated `(o, q, s)`.
/// Trigger for `MorphismKind::Inversion`.
pub const INVERTS_AS: &str = "inverts-as";

/// Composition left premise. See the composition trigger triple.
pub const USES_AS_COMPOSITION_LEFT: &str = "uses-as-composition-left";
/// Composition right premise.
pub const USES_AS_COMPOSITION_RIGHT: &str = "uses-as-composition-right";
/// Composition output.
pub const COMPOSES_INTO: &str = "composes-into";

/// Fusion left premise.
pub const USES_AS_FUSION_LEFT: &str = "uses-as-fusion-left";
/// Fusion right premise.
pub const USES_AS_FUSION_RIGHT: &str = "uses-as-fusion-right";
/// Fusion output.
pub const FUSES_INTO: &str = "fuses-into";

/// Implication antecedent.
pub const USES_AS_ANTECEDENT: &str = "uses-as-antecedent";
/// Implication consequent.
pub const USES_AS_CONSEQUENT: &str = "uses-as-consequent";
/// Implication output.
pub const IMPLIES_INTO: &str = "implies-into";

// ─────────────────────────────────────────────────────────────────────
// OQRA category terms
// ─────────────────────────────────────────────────────────────────────

/// The top category: anything distinguishable is a thing.
pub const THING: &str = "thing";
/// A thing considered as constituted being / intrinsic abstract.
pub const OBJECT: &str = "object";
/// A thing considered as predicate-face / aspect of another thing.
pub const QUALITY: &str = "quality";
/// A thing considered as connection / constraint between things.
pub const RELATION: &str = "relation";
/// A thing considered as dynamics / settlement / generative event.
pub const ACT: &str = "act";

// ─────────────────────────────────────────────────────────────────────
// OQRA relator predicates (and their inversions)
// ─────────────────────────────────────────────────────────────────────

/// `(t, is-a-thing, owner)` — `t` is a thing. All OQRA semantics
/// specialize from thing.
pub const IS_A_THING: &str = "is-a-thing";

/// `(whole, has-object-part, part)` — `whole` is composed (partially)
/// of `part`. Reverse queries ("what are the wholes this part is part
/// of?") scan the fiber at the object axis.
pub const HAS_OBJECT_PART: &str = "has-object-part";

/// `(thing, has-quality, quality-term)` — `thing` bears the named
/// quality. Specific qualities (`has-name`, `has-mass`, etc.) are
/// specializations of this relator.
pub const HAS_QUALITY: &str = "has-quality";

/// `(a, in-relation, b)` — `a` stands in some relation with `b`. The
/// specific named relations (`parent-of`, `larger-than`, etc.) are
/// specializations.
pub const IN_RELATION: &str = "in-relation";

/// `(t, can-act, act-term)` — `t` has the capacity for the named act.
/// Specific capacities (`can-move`, `can-perceive`) are specializations.
pub const CAN_ACT: &str = "can-act";

// ─────────────────────────────────────────────────────────────────────
// Witnessing primitives (provenance)
// ─────────────────────────────────────────────────────────────────────

/// `(claim-ref, derived-via, morphism-kind)` — records which morphism
/// produced a settled claim.
pub const DERIVED_VIA: &str = "derived-via";
/// `(claim-ref, derived-from, premise-claim-ref)` — records premises
/// of a derivation.
pub const DERIVED_FROM: &str = "derived-from";
/// `(claim-ref, at-time, iso8601-timestamp)` — when the claim was
/// witnessed.
pub const AT_TIME: &str = "at-time";
/// `(claim-ref, asserted-by, agent-identity)` — who witnessed the
/// claim originally. Reverse queries ("which claims did this agent
/// assert?") scan the fiber at the object axis.
pub const ASSERTED_BY: &str = "asserted-by";

// ─────────────────────────────────────────────────────────────────────
// The owner-agent
// ─────────────────────────────────────────────────────────────────────

/// The foundation owner-agent. Mounts the OQRA category terms, the
/// morphism-trigger predicates, the relator predicates, and the
/// witnessing primitives as substrate claims at hub boot.
#[derive(Debug, Clone, Copy, Default)]
pub struct Foundation;

#[async_trait]
impl Agent for Foundation {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Self-referential bootstrap: the meta-predicates are
        // themselves terms and predicates.
        out.push(Claim::new(IS_A_TERM, IS_A_TERM, IDENTITY));
        out.push(Claim::new(IS_A_PREDICATE, IS_A_TERM, IDENTITY));
        out.push(Claim::new(IS_A_PREDICATE, IS_A_PREDICATE, IDENTITY));
        // IS_A_PREDICATE specializes-as IS_A_TERM — every predicate is
        // also a term.
        out.push(Claim::new(IS_A_PREDICATE, SPECIALIZES_AS, IS_A_TERM));

        // Morphism-trigger predicates are predicates.
        for p in MORPHISM_TRIGGERS {
            out.push(Claim::new(*p, IS_A_PREDICATE, IDENTITY));
        }

        // OQRA category terms are terms. THING is the top; OBJECT,
        // QUALITY, RELATION, ACT specialize-as THING.
        for t in [THING, OBJECT, QUALITY, RELATION, ACT] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }
        out.push(Claim::new(OBJECT, SPECIALIZES_AS, THING));
        out.push(Claim::new(QUALITY, SPECIALIZES_AS, THING));
        out.push(Claim::new(RELATION, SPECIALIZES_AS, THING));
        out.push(Claim::new(ACT, SPECIALIZES_AS, THING));

        // OQRA relator predicates (single-direction; reverse queries
        // via fiber-scan per inversion discipline).
        for p in OQRA_RELATORS {
            out.push(Claim::new(*p, IS_A_PREDICATE, IDENTITY));
        }

        // IS_A_THING is a predicate in its own right.
        out.push(Claim::new(IS_A_THING, IS_A_PREDICATE, IDENTITY));

        // Witnessing primitives (single-direction).
        for p in WITNESSING_PREDS {
            out.push(Claim::new(*p, IS_A_PREDICATE, IDENTITY));
        }

        out
    }
}

/// The morphism-trigger predicate names the engine recognizes.
const MORPHISM_TRIGGERS: &[&str] = &[
    SPECIALIZES_AS,
    INVERTS_AS,
    USES_AS_COMPOSITION_LEFT,
    USES_AS_COMPOSITION_RIGHT,
    COMPOSES_INTO,
    USES_AS_FUSION_LEFT,
    USES_AS_FUSION_RIGHT,
    FUSES_INTO,
    USES_AS_ANTECEDENT,
    USES_AS_CONSEQUENT,
    IMPLIES_INTO,
];

/// The OQRA relator predicates (single-direction).
const OQRA_RELATORS: &[&str] = &[HAS_OBJECT_PART, HAS_QUALITY, IN_RELATION, CAN_ACT];

/// Witnessing / provenance predicates (single-direction).
const WITNESSING_PREDS: &[&str] = &[DERIVED_VIA, DERIVED_FROM, AT_TIME, ASSERTED_BY];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn foundation_emits_self_referential_bootstrap() {
        let claims = Foundation.claims();
        // The meta-predicates establish themselves.
        assert!(claims
            .iter()
            .any(|c| c.subject == IS_A_TERM && c.predicate == IS_A_TERM));
        assert!(claims
            .iter()
            .any(|c| c.subject == IS_A_PREDICATE && c.predicate == IS_A_PREDICATE));
    }

    #[test]
    fn oqra_category_terms_specialize_as_thing() {
        let claims = Foundation.claims();
        for t in [OBJECT, QUALITY, RELATION, ACT] {
            assert!(
                claims.iter().any(
                    |c| c.subject == t && c.predicate == SPECIALIZES_AS && c.object == THING
                ),
                "missing specialization: {t} specializes-as thing"
            );
        }
    }

    #[test]
    fn oqra_relators_are_single_direction_predicates() {
        let claims = Foundation.claims();
        // Each OQRA relator is declared as a predicate but NOT wired
        // with INVERTS_AS (converse-positive pairs aren't negation
        // pairs; reverse queries use fiber scan).
        for p in [HAS_OBJECT_PART, HAS_QUALITY, IN_RELATION, CAN_ACT] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared as a predicate"
            );
            assert!(
                !claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == INVERTS_AS),
                "{p} should NOT be wired with INVERTS_AS (not a negation pair)"
            );
        }
    }

    #[test]
    fn every_morphism_trigger_is_declared_a_predicate() {
        let claims = Foundation.claims();
        for trigger in MORPHISM_TRIGGERS {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *trigger && c.predicate == IS_A_PREDICATE),
                "missing predicate declaration for trigger: {trigger}"
            );
        }
    }
}
