//! Container specialization plus naming and description qualities.
//!
//! A **container** is a thing whose structural role is to hold other
//! things. In OQRA terms, containerhood is a specialization of THING
//! carrying:
//!
//! - a `CONTAINS` / `EXCLUDES_FROM` algebraic inversion pair (the
//!   membership relation)
//! - `HAS_CARDINALITY` and `IS_EMPTY` qualities (derived, via the
//!   aggregator port once it lands)
//! - `HAS_NAME` and `HAS_DESCRIPTION` qualities, usable on any thing
//!   (declared here because names and descriptions are the most
//!   universal qualities and have no reason to live in a more
//!   specialized module)
//!
//! # Inversion naming discipline
//!
//! The cascade's `INVERTS_AS` morphism applies **pointwise negation** to
//! the bilattice value, not English-converse semantics (paper §3.2;
//! Fitting 1991). Inversion-pair predicates must therefore be named as
//! **negation pairs**, not converse-positive relations.
//!
//! Wrong (converse-positive pair — both intuitively True together, but
//! algebraically inversion forces False on the derived side):
//!
//! ```text
//! (CONTAINS, inverts-as, LOCATED_IN)
//! ```
//!
//! Right (negation pair — True on one side, False on the other,
//! matching both the algebra and the semantic intuition):
//!
//! ```text
//! (CONTAINS, inverts-as, EXCLUDES_FROM)
//! (EXCLUDES_FROM, inverts-as, CONTAINS)
//! ```
//!
//! Read: "room contains object" True ↔ "object is-excluded-from room"
//! False. The double declaration wires both directions so the cascade
//! produces both claims from either starting point, reaching fixed
//! point in ≤ 2 steps per Proposition 8 of the paper.
//!
//! # Wiener/Barad framing
//!
//! A container is not an object-with-method. "Room A contains rock B"
//! is a settled claim; the cascade derives the inversion automatically;
//! any subject that specializes-as [`CONTAINER`] inherits container
//! semantics by virtue of the specialization morphism — no Rust
//! subtype required.
//!
//! For the simple converse-query ("what room is rock-1 in?"), scan the
//! `CONTAINS` fiber at the object-axis rather than introducing a
//! converse predicate; that's a port concern, not a substrate one.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{
    INVERTS_AS, IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, THING,
};

/// Owner identity for the container owner-agent.
pub const IDENTITY: &str = "mash-library-container";

// ─────────────────────────────────────────────────────────────────────
// Container category term
// ─────────────────────────────────────────────────────────────────────

/// The container category-term. `CONTAINER specializes-as THING`.
pub const CONTAINER: &str = "container";

// ─────────────────────────────────────────────────────────────────────
// Membership predicates (negation pair, double declaration)
// ─────────────────────────────────────────────────────────────────────

/// `(container, contains, thing)` True — positive membership: the
/// container holds the thing. The inversion pair is [`EXCLUDES_FROM`];
/// see module docs on inversion naming discipline.
pub const CONTAINS: &str = "contains";

/// `(thing, excludes-from, container)` — the thing is excluded from the
/// container. Algebraic inversion pair of [`CONTAINS`]: when
/// `(container, contains, thing)` settles True, the cascade settles
/// `(thing, excludes-from, container)` at False, reading correctly as
/// "thing is not excluded" — i.e., positive membership.
pub const EXCLUDES_FROM: &str = "excludes-from";

// ─────────────────────────────────────────────────────────────────────
// Cardinality qualities (derived by aggregator port; declared here)
// ─────────────────────────────────────────────────────────────────────

/// `(container, has-cardinality, n)` — the container holds `n` things.
/// Produced by a cardinality-aggregator port observing the `CONTAINS`
/// fiber for a given container subject.
pub const HAS_CARDINALITY: &str = "has-cardinality";

/// `(container, is-empty, true)` — the container holds no things.
/// Derived by the cardinality port when `has-cardinality` settles at "0".
pub const IS_EMPTY: &str = "is-empty";

// ─────────────────────────────────────────────────────────────────────
// Naming and description qualities
//
// Single-direction predicates. The inversion pairs (NAMES, DESCRIBES)
// are converse-positive rather than negation pairs, so we don't wire
// them as INVERTS_AS. The reverse-query ("what thing has name X?")
// scans the `HAS_NAME` fiber at the object-axis.
// ─────────────────────────────────────────────────────────────────────

/// `(thing, has-name, "name")` — the thing's display name.
pub const HAS_NAME: &str = "has-name";

/// `(thing, has-description, "text")` — the thing's descriptive text.
pub const HAS_DESCRIPTION: &str = "has-description";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the container category, its membership
/// predicates, cardinality qualities, and naming/description qualities.
#[derive(Debug, Clone, Copy, Default)]
pub struct Container;

#[async_trait]
impl Agent for Container {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Category term.
        out.push(Claim::new(CONTAINER, IS_A_TERM, IDENTITY));
        out.push(Claim::new(CONTAINER, SPECIALIZES_AS, THING));

        // Predicates.
        for p in [
            CONTAINS,
            EXCLUDES_FROM,
            HAS_CARDINALITY,
            IS_EMPTY,
            HAS_NAME,
            HAS_DESCRIPTION,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // Double-direction inversion for the negation pair.
        // This ensures witnessing on either side settles the other at
        // its negated value, and since negate is involutive the
        // cascade reaches fixed point in ≤ 2 steps (Prop. 8).
        out.push(Claim::new(CONTAINS, INVERTS_AS, EXCLUDES_FROM));
        out.push(Claim::new(EXCLUDES_FROM, INVERTS_AS, CONTAINS));

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn container_specializes_as_thing() {
        let claims = Container.claims();
        assert!(claims.iter().any(|c| c.subject == CONTAINER
            && c.predicate == SPECIALIZES_AS
            && c.object == THING));
    }

    #[test]
    fn membership_has_double_inversion() {
        let claims = Container.claims();
        assert!(claims.iter().any(|c| c.subject == CONTAINS
            && c.predicate == INVERTS_AS
            && c.object == EXCLUDES_FROM));
        assert!(claims.iter().any(|c| c.subject == EXCLUDES_FROM
            && c.predicate == INVERTS_AS
            && c.object == CONTAINS));
    }

    #[test]
    fn naming_and_description_are_single_predicates() {
        let claims = Container.claims();
        // HAS_NAME and HAS_DESCRIPTION are declared as predicates...
        assert!(claims
            .iter()
            .any(|c| c.subject == HAS_NAME && c.predicate == IS_A_PREDICATE));
        assert!(claims
            .iter()
            .any(|c| c.subject == HAS_DESCRIPTION && c.predicate == IS_A_PREDICATE));
        // ...but not paired with INVERTS_AS (since their natural converse
        // is not a negation pair).
        assert!(!claims
            .iter()
            .any(|c| c.subject == HAS_NAME && c.predicate == INVERTS_AS));
        assert!(!claims
            .iter()
            .any(|c| c.subject == HAS_DESCRIPTION && c.predicate == INVERTS_AS));
    }
}
