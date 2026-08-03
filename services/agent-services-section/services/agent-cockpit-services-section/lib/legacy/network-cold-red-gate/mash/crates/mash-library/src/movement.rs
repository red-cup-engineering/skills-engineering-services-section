//! Movement — a first act expressed as an operation.
//!
//! A movement is an operation whose effect is to change an avatar's
//! location. The operational vocabulary (see [`crate::ops`]) gives
//! the phase lifecycle and the dispatch substrate; movement adds the
//! domain-specific predicates that tie the op to a direction, an
//! exit, and the source/destination rooms.
//!
//! # Wiener/Barad framing
//!
//! No `Avatar::move()` method. A movement is a subject whose fiber
//! accumulates intent (avatar + direction), dispatch state (phase,
//! performer), and effect (source/destination rooms + the balanced
//! containment updates). When the movement settles, the cascade has
//! witnessed the location swap as claims on the substrate — not as
//! a mutation of avatar state.
//!
//! # The containment swap
//!
//! Movement's effect is two container-membership updates, using the
//! double-declared inversion pair from [`crate::container`]:
//!
//! - `(source-room, contains, avatar)` → False (avatar leaves)
//! - `(destination-room, contains, avatar)` → True (avatar arrives)
//!
//! The cascade's CONTAINS/EXCLUDES_FROM wiring propagates the
//! negation-pair views automatically. Observers subscribing to a
//! specific room's `contains` fiber see the avatar's departure and
//! arrival as separate settlements at their respective rooms.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-vocab-mud-movement/src/lib.rs`
//! declares `movement specializes-as operation`, which this module
//! retains, plus a `commodity:person` term for the old-library's
//! accounting-based move. This module uses the simpler
//! CONTAINS/EXCLUDES_FROM approach; the accounting-balanced-
//! transaction form from the old `go-agent` port is future work if
//! the ship needs ledger-accurate move records.
//!
//! The old `bin/go.rs` port is the reference for how a movement-
//! effector connects intent to effect via the cascade, but that's
//! port-level implementation — not vocabulary. Task 12 here is
//! vocabulary only; the movement-effector port is a downstream task.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS};
use crate::ops::{FUNCTION, OPERATION};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-movement";

// ─────────────────────────────────────────────────────────────────────
// Category terms
// ─────────────────────────────────────────────────────────────────────

/// A movement is an operation specializing OPERATION. Every movement
/// op carries the ops-layer phase/result/metric claims plus the
/// movement-specific direction/exit/source/destination claims.
pub const MOVEMENT: &str = "movement";

/// The function kind for a movement op. Specializes-as FUNCTION.
pub const MOVEMENT_FUNCTION: &str = "movement-function";

// ─────────────────────────────────────────────────────────────────────
// Movement-specific predicates
//
// Intent predicates (witnessed at movement-op subject when the
// movement is being requested):
// ─────────────────────────────────────────────────────────────────────

/// `(movement, moves-in-direction, direction-term)` — which direction
/// the movement attempts (from the canonical set in `crate::space`:
/// north / south / east / west / ne / nw / se / sw / up / down).
pub const MOVES_IN_DIRECTION: &str = "moves-in-direction";

/// `(movement, moves-via-exit, exit)` — resolved exit this movement
/// traverses. Witnessed by a resolver after matching direction +
/// source room + has-exit.
pub const MOVES_VIA_EXIT: &str = "moves-via-exit";

/// `(movement, moves-from, source-room)` — source room of the move.
pub const MOVES_FROM: &str = "moves-from";

/// `(movement, moves-to, destination-room)` — destination room.
pub const MOVES_TO: &str = "moves-to";

/// `(movement, mover-is, avatar)` — which avatar is moving. (Not
/// using [`crate::ops::TARGETS`] because the avatar is the
/// subject-of-the-act, not the target; the exit is the target.)
pub const MOVER_IS: &str = "mover-is";

// ─────────────────────────────────────────────────────────────────────
// Avatar-side predicates
// ─────────────────────────────────────────────────────────────────────

/// `(avatar, emits-move-request, direction-term)` — avatar issues an
/// intent to move in the given direction. A resolver-port observes
/// this and mints a corresponding `movement` op.
pub const EMITS_MOVE_REQUEST: &str = "emits-move-request";

/// `(avatar, is-mobile, marker)` — quality: the avatar can move
/// under its own power. Most avatars have this; stationary things
/// (a chair, a sign) do not.
pub const IS_MOBILE: &str = "is-mobile";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the movement vocabulary atop the ops layer.
#[derive(Debug, Clone, Copy, Default)]
pub struct Movement;

#[async_trait]
impl Agent for Movement {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // MOVEMENT specializes-as OPERATION (movement is an op).
        out.push(Claim::new(MOVEMENT, IS_A_TERM, IDENTITY));
        out.push(Claim::new(MOVEMENT, SPECIALIZES_AS, OPERATION));

        // MOVEMENT_FUNCTION specializes-as FUNCTION.
        out.push(Claim::new(MOVEMENT_FUNCTION, IS_A_TERM, IDENTITY));
        out.push(Claim::new(MOVEMENT_FUNCTION, SPECIALIZES_AS, FUNCTION));

        // Predicates.
        for p in [
            MOVES_IN_DIRECTION,
            MOVES_VIA_EXIT,
            MOVES_FROM,
            MOVES_TO,
            MOVER_IS,
            EMITS_MOVE_REQUEST,
            IS_MOBILE,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn movement_is_an_operation() {
        let claims = Movement.claims();
        assert!(claims.iter().any(|c| c.subject == MOVEMENT
            && c.predicate == SPECIALIZES_AS
            && c.object == OPERATION));
    }

    #[test]
    fn movement_function_is_a_function() {
        let claims = Movement.claims();
        assert!(claims.iter().any(|c| c.subject == MOVEMENT_FUNCTION
            && c.predicate == SPECIALIZES_AS
            && c.object == FUNCTION));
    }

    #[test]
    fn movement_predicates_declared() {
        let claims = Movement.claims();
        for p in [
            MOVES_IN_DIRECTION,
            MOVES_VIA_EXIT,
            MOVES_FROM,
            MOVES_TO,
            MOVER_IS,
            EMITS_MOVE_REQUEST,
            IS_MOBILE,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared as a predicate"
            );
        }
    }
}
