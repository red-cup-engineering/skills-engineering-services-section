//! Choreography — asynchronous signaling predicates between agents.
//!
//! # The four core pairs
//!
//! - [`ANNOUNCES`] — agent → event it announced
//! - [`RESPONDS_TO`] — agent → announcement being responded to
//! - [`ACKNOWLEDGES`] — agent → claim it acknowledges seeing
//! - [`AWARE_OF`] — agent → claim it passively observes
//!
//! # Authority pairs
//!
//! - [`AIDS`] — aid → principal it aids
//! - [`HAS_AUTHORITY`] — agent → authority it holds
//! - [`AUTHORITY_BOUND`] — subject (decision / op) → authority
//!   bounding it
//!
//! # Inversion discipline
//!
//! The old `mash-vocab-choreography` declared seven INVERTS_AS
//! pairs: `ANNOUNCES/ANNOUNCED_BY`, `RESPONDS_TO/RESPONSE_TRIGGERED`,
//! `ACKNOWLEDGES/ACKNOWLEDGED_BY`, `AWARE_OF/KNOWN_TO`,
//! `AIDS/AIDED_BY`, `HAS_AUTHORITY/AUTHORITY_OF`,
//! `AUTHORITY_BOUND/BINDS_AUTHORITY_FOR`. All seven are
//! converse-positive, not algebraic-negation — under pointwise
//! negation they'd propagate incorrectly. Dropped.
//!
//! Reverse queries ("who announced event X?", "what authority
//! bounds decision Y?") use fiber scan at the object axis — the
//! substrate indexes all cells by predicate so the scan is cheap.
//!
//! # OFFICE term reuse
//!
//! The old vocab declared an OFFICE term here. My library's
//! [`crate::offices::OFFICE`] already declares it with richer
//! Hohfeldian structure (powers, duties, privileges, immunities).
//! This module doesn't redeclare OFFICE; consumers that need the
//! term import it from `offices`.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::IS_A_PREDICATE;

/// Owner identity.
pub const IDENTITY: &str = "mash-library-choreography";

// ─────────────────────────────────────────────────────────────────────
// Signaling predicates
// ─────────────────────────────────────────────────────────────────────

/// `(agent, announces, event)` — agent witnesses an event
/// announcement. Multi-valued; one cell per announcement.
pub const ANNOUNCES: &str = "announces";

/// `(agent, responds-to, announcement)` — agent's response links
/// back to the announcement that triggered it.
pub const RESPONDS_TO: &str = "responds-to";

/// `(agent, acknowledges, claim)` — explicit acknowledgment that
/// the claim has been observed. Stronger than awareness: commits
/// the agent to having processed the claim.
pub const ACKNOWLEDGES: &str = "acknowledges";

/// `(agent, aware-of, claim)` — passive observation, distinct from
/// acknowledgement. An agent can be aware of a claim without being
/// committed to act on it.
pub const AWARE_OF: &str = "aware-of";

// ─────────────────────────────────────────────────────────────────────
// Authority predicates
// ─────────────────────────────────────────────────────────────────────

/// `(aid, aids, principal)` — the aid subject assists the principal.
/// The Hohfeldian frame in [`crate::offices`] carries richer
/// power/duty relations; this predicate is the lightweight
/// acknowledgment of an assisting relationship.
pub const AIDS: &str = "aids";

/// `(agent, has-authority, authority-term)` — agent holds this
/// authority. Pairs with [`crate::offices`] for chartered offices;
/// also stands alone for ad-hoc authority claims.
pub const HAS_AUTHORITY: &str = "has-authority";

/// `(subject, authority-bound, authority-term)` — decision, op, or
/// directive is bounded by this authority. A consumer checking
/// whether a decision is within bounds reads here.
pub const AUTHORITY_BOUND: &str = "authority-bound";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the choreography vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Choreography;

#[async_trait]
impl Agent for Choreography {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();
        for p in [
            ANNOUNCES,
            RESPONDS_TO,
            ACKNOWLEDGES,
            AWARE_OF,
            AIDS,
            HAS_AUTHORITY,
            AUTHORITY_BOUND,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::foundation::INVERTS_AS;

    #[test]
    fn all_predicates_declared() {
        let claims = Choreography.claims();
        for p in [
            ANNOUNCES,
            RESPONDS_TO,
            ACKNOWLEDGES,
            AWARE_OF,
            AIDS,
            HAS_AUTHORITY,
            AUTHORITY_BOUND,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared"
            );
        }
    }

    #[test]
    fn no_spurious_inversions() {
        let claims = Choreography.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "choreography should declare no INVERTS_AS wiring (all old pairs were converse-positive)"
        );
    }
}
