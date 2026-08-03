//! Spatial dimension: rooms, exits, directions.
//!
//! The MUD spatial graph expressed as OQRA-structured things.
//! - A **room** is a container with additional quality: it is a place
//!   avatars can be located in and can look around from.
//! - An **exit** is a thing that connects two rooms in a direction.
//! - A **direction** is a thing (subject-term) used as the
//!   directional-quality of an exit.
//!
//! # Wiener/Barad framing
//!
//! A spatial graph is not a data structure. It is a region of the
//! manifold where room-fibers and exit-fibers have specific
//! relational structure. Movement along an exit emerges from
//! compositions over settled claims (Task 12); this module's job is
//! just to make the graph *expressible*.
//!
//! # Inversion discipline applied
//!
//! Converse-positive predicates (`has-exit`/`exit-of`, `leads-to`/
//! `reached-via`, `goes-direction`/`direction-of`) are *not* wired
//! with `INVERTS_AS`. Each is a single predicate; reverse-direction
//! queries use fiber-scan at the object axis. See `container`
//! module docs for the naming discipline.
//!
//! For `OPPOSITE_OF` (direction pairs: north↔south, up↔down, etc.),
//! both directions of each pair are witnessed explicitly at boot,
//! rather than relying on a non-existent "symmetric-positive converse"
//! morphism.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::container::CONTAINER;
use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS};

/// Owner identity for the space owner-agent.
pub const IDENTITY: &str = "mash-library-space";

// ─────────────────────────────────────────────────────────────────────
// Category terms
// ─────────────────────────────────────────────────────────────────────

/// The room category-term. `ROOM specializes-as CONTAINER`.
pub const ROOM: &str = "room";

/// The exit category-term. An exit is a connection between rooms.
pub const EXIT: &str = "exit";

/// The direction category-term. Canonical directions are subject-terms
/// instances of this term.
pub const DIRECTION: &str = "direction";

// ─────────────────────────────────────────────────────────────────────
// Structural predicates
// ─────────────────────────────────────────────────────────────────────

/// `(room, has-exit, exit)` — the room exposes this exit. Reverse
/// queries ("which room does this exit belong to?") scan the fiber
/// at the object axis.
pub const HAS_EXIT: &str = "has-exit";

/// `(exit, leads-to, room)` — the exit's destination.
pub const LEADS_TO: &str = "leads-to";

/// `(exit, goes-direction, direction)` — the direction this exit
/// travels.
pub const GOES_DIRECTION: &str = "goes-direction";

/// `(long-name, shortens-to, alias)` — long direction name can be
/// written as the alias (e.g., `north` / `n`).
pub const SHORTENS_TO: &str = "shortens-to";

/// `(direction-a, opposite-of, direction-b)` — the two directions are
/// each other's opposite. This module emits the claim in both
/// directions at boot (north ↔ south, east ↔ west, etc.) so the
/// cascade doesn't need a symmetric-positive converse morphism.
pub const OPPOSITE_OF: &str = "opposite-of";

// ─────────────────────────────────────────────────────────────────────
// The ten canonical directions
// ─────────────────────────────────────────────────────────────────────

/// Long name → short alias. The aliases are also directions in their
/// own right; shortness is declarative.
pub const DIRECTIONS_AND_ALIASES: &[(&str, &str)] = &[
    ("north", "n"),
    ("south", "s"),
    ("east", "e"),
    ("west", "w"),
    ("northeast", "ne"),
    ("northwest", "nw"),
    ("southeast", "se"),
    ("southwest", "sw"),
    ("up", "u"),
    ("down", "d"),
];

/// The five canonical opposite pairs. `OPPOSITE_OF` claims are emitted
/// in both directions for each pair.
const OPPOSITE_PAIRS: &[(&str, &str)] = &[
    ("north", "south"),
    ("east", "west"),
    ("northeast", "southwest"),
    ("northwest", "southeast"),
    ("up", "down"),
];

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the spatial dimension: room/exit/direction
/// category terms, structural predicates, the canonical directions
/// and their aliases, and the opposite-pair declarations.
#[derive(Debug, Clone, Copy, Default)]
pub struct Space;

#[async_trait]
impl Agent for Space {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Category terms.
        for t in [ROOM, EXIT, DIRECTION] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }
        // Room specializes-as container.
        out.push(Claim::new(ROOM, SPECIALIZES_AS, CONTAINER));

        // Structural predicates.
        for p in [HAS_EXIT, LEADS_TO, GOES_DIRECTION, SHORTENS_TO, OPPOSITE_OF] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // Canonical directions and their alias forms as terms.
        for (long, short) in DIRECTIONS_AND_ALIASES {
            out.push(Claim::new(*long, IS_A_TERM, IDENTITY));
            out.push(Claim::new(*short, IS_A_TERM, IDENTITY));
            out.push(Claim::new(*long, SPECIALIZES_AS, DIRECTION));
            out.push(Claim::new(*short, SPECIALIZES_AS, DIRECTION));
            out.push(Claim::new(*long, SHORTENS_TO, *short));
        }

        // Opposite pairs — emit both directions of each pair so the
        // opposite relation is positive-at-True on both sides.
        for (a, b) in OPPOSITE_PAIRS {
            out.push(Claim::new(*a, OPPOSITE_OF, *b));
            out.push(Claim::new(*b, OPPOSITE_OF, *a));
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_specializes_as_container() {
        let claims = Space.claims();
        assert!(claims.iter().any(|c| c.subject == ROOM
            && c.predicate == SPECIALIZES_AS
            && c.object == CONTAINER));
    }

    #[test]
    fn ten_canonical_directions_declared() {
        let claims = Space.claims();
        assert_eq!(DIRECTIONS_AND_ALIASES.len(), 10);
        for (long, short) in DIRECTIONS_AND_ALIASES {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *long && c.predicate == SPECIALIZES_AS && c.object == DIRECTION),
                "direction {long} should specialize-as direction"
            );
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *long && c.predicate == SHORTENS_TO && c.object == *short),
                "direction {long} should shorten to {short}"
            );
        }
    }

    #[test]
    fn opposite_pairs_are_emitted_bidirectionally() {
        let claims = Space.claims();
        for (a, b) in OPPOSITE_PAIRS {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *a && c.predicate == OPPOSITE_OF && c.object == *b),
                "missing: ({a}, opposite-of, {b})"
            );
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *b && c.predicate == OPPOSITE_OF && c.object == *a),
                "missing reverse: ({b}, opposite-of, {a})"
            );
        }
    }

    #[test]
    fn structural_predicates_are_single_direction() {
        let claims = Space.claims();
        // Each structural predicate is declared IS_A_PREDICATE...
        for p in [HAS_EXIT, LEADS_TO, GOES_DIRECTION] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared as a predicate"
            );
        }
        // ...and none is paired with INVERTS_AS — reverse queries use
        // fiber-scan, not a converse predicate.
        use crate::foundation::INVERTS_AS;
        for p in [HAS_EXIT, LEADS_TO, GOES_DIRECTION] {
            assert!(
                !claims.iter().any(|c| c.subject == p && c.predicate == INVERTS_AS),
                "{p} should NOT have INVERTS_AS wiring"
            );
        }
    }
}
