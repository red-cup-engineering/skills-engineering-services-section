//! Perception — looking, describing, observing. The second act.
//!
//! A perception is an operation whose effect is to produce a
//! rendering of a target and deliver it to a session. The rendering
//! itself is assembled from the target's qualities (name,
//! description, contents) by an effector-port that subscribes to
//! those fibers; this module declares the vocabulary the cascade uses.
//!
//! # Wiener/Barad framing
//!
//! No `Room::render()` method, no observer pattern bolted on top of
//! a class hierarchy. A perception is a subject whose fiber carries
//! intent (what's being looked at) + routing (which session receives
//! it) + effect (the rendered text). Different observers see
//! different renderings because the perception is per-observer — a
//! separate operation for each — and its rendering composition fires
//! in that observer's session's context.
//!
//! # Intent pair
//!
//! Perception's intent is two linked claims:
//!
//! - `(perception-op, looks-at, target)` — what the perceiver is
//!   looking at
//! - `(perception-op, reports-to, session)` — whose session's render
//!   fiber should receive the result
//!
//! These sit at different objects from the perception subject's
//! perspective (the target is not the session), so they cannot be
//! fused by the cascade's pointwise binary composition. Pairing is
//! done by a perception-effector port that subscribes to both and
//! matches by subject. The port then renders and witnesses
//! `(session, has-session-render, <text>)`.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-port-projection-mud-space/src/bin/look.rs`
//! implements the same pattern: subscribe to LOOK_TARGET + REPORTS_TO,
//! pair locally, cache target's qualities, render text, witness back.
//! This module declares the OQRA-aligned vocabulary that port would
//! consume if it were ported forward.
//!
//! The old vocab in `archive/mash-vocab-mud-space/` used `LOOK_TARGET`
//! as the intent predicate; this module uses [`LOOKS_AT`] for
//! semantic clarity (the perception looks-at something, not targets-
//! it as a side-effect).

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS};
use crate::ops::{FUNCTION, OPERATION};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-perception";

// ─────────────────────────────────────────────────────────────────────
// Category terms
// ─────────────────────────────────────────────────────────────────────

/// Perception is an operation specializing OPERATION.
pub const PERCEPTION: &str = "perception";

/// The function-kind for perception ops. Specializes-as FUNCTION.
pub const LOOK_FUNCTION: &str = "look-function";

// ─────────────────────────────────────────────────────────────────────
// Intent predicates
// ─────────────────────────────────────────────────────────────────────

/// `(perception, looks-at, target)` — what the perception is
/// rendering.
pub const LOOKS_AT: &str = "looks-at";

/// `(perception, reports-to, session)` — which session's render
/// fiber should receive the result. Distinct subject-axis use
/// from `crate::presence::HAS_SESSION_RENDER` because the perception
/// is the subject here, not the session.
pub const REPORTS_TO: &str = "reports-to";

/// `(perception, perceiver-is, avatar-or-session)` — who's doing
/// the looking. The old library put this on the avatar side; here
/// it's a perception-level claim so the rendering-port has direct
/// access to both the perceiver and the target via the perception
/// subject's fiber.
pub const PERCEIVER_IS: &str = "perceiver-is";

// ─────────────────────────────────────────────────────────────────────
// Rendering predicates
// ─────────────────────────────────────────────────────────────────────

/// `(perception, has-rendering, text-or-blob-ref)` — the assembled
/// rendered output. Inline string for short renders; blob reference
/// for large ones.
pub const HAS_RENDERING: &str = "has-rendering";

/// `(perception, rendered-at, iso-timestamp)` — when the rendering
/// was produced.
pub const RENDERED_AT: &str = "rendered-at";

/// `(perception, is-rendered, marker)` — phase marker: the
/// rendering has settled and been delivered to the session.
pub const IS_RENDERED: &str = "is-rendered";

// ─────────────────────────────────────────────────────────────────────
// Target-side state
// ─────────────────────────────────────────────────────────────────────

/// `(target, observed-by-perception, perception)` — a target can
/// query the set of perceptions currently looking at it. This is a
/// single-direction relation; not wired as INVERTS_AS of LOOKS_AT
/// (which would be a converse-positive pair needing the double-
/// declaration pattern; for simplicity the port witnesses both sides
/// if it needs both queries).
pub const OBSERVED_BY_PERCEPTION: &str = "observed-by-perception";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the perception vocabulary atop the ops
/// layer.
#[derive(Debug, Clone, Copy, Default)]
pub struct Perception;

#[async_trait]
impl Agent for Perception {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // PERCEPTION specializes-as OPERATION.
        out.push(Claim::new(PERCEPTION, IS_A_TERM, IDENTITY));
        out.push(Claim::new(PERCEPTION, SPECIALIZES_AS, OPERATION));

        // LOOK_FUNCTION specializes-as FUNCTION.
        out.push(Claim::new(LOOK_FUNCTION, IS_A_TERM, IDENTITY));
        out.push(Claim::new(LOOK_FUNCTION, SPECIALIZES_AS, FUNCTION));

        for p in [
            LOOKS_AT,
            REPORTS_TO,
            PERCEIVER_IS,
            HAS_RENDERING,
            RENDERED_AT,
            IS_RENDERED,
            OBSERVED_BY_PERCEPTION,
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
    fn perception_is_an_operation() {
        let claims = Perception.claims();
        assert!(claims.iter().any(|c| c.subject == PERCEPTION
            && c.predicate == SPECIALIZES_AS
            && c.object == OPERATION));
    }

    #[test]
    fn look_function_is_a_function() {
        let claims = Perception.claims();
        assert!(claims.iter().any(|c| c.subject == LOOK_FUNCTION
            && c.predicate == SPECIALIZES_AS
            && c.object == FUNCTION));
    }

    #[test]
    fn perception_predicates_declared() {
        let claims = Perception.claims();
        for p in [
            LOOKS_AT,
            REPORTS_TO,
            PERCEIVER_IS,
            HAS_RENDERING,
            RENDERED_AT,
            IS_RENDERED,
            OBSERVED_BY_PERCEPTION,
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
