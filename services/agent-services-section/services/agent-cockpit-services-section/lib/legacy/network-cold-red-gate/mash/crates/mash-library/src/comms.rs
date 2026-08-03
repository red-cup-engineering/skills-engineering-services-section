//! Communications — utterances, channels, addressing, reply chains.
//!
//! # Relation to [`crate::conduit`]
//!
//! The conduit module declares the small subset that concrete
//! protocol binaries need: [`crate::conduit::HAS_BODY`],
//! [`crate::conduit::WAS_SAID_IN`], [`crate::conduit::IS_SURFACE_READY`].
//! This module is the richer social/channel layer on top — speakers,
//! messages, addressing, reply chains, participation, surfacing.
//! Conduit's bodies and channels flow into comms' utterances.
//!
//! # Surface-ready composition
//!
//! A body becomes surface-ready when it has been said by someone, in
//! a channel, with a body text. Consumer ports (telnet, stdio,
//! mud-parser) subscribe to [`crate::conduit::IS_SURFACE_READY`] and
//! write bytes to their medium.
//!
//! # Inversion discipline
//!
//! The old `mash-vocab-comms` declared six INVERTS_AS pairs
//! (WAS_SAID_BY/UTTERED, WAS_SAID_IN/CARRIES, ADDRESSED_TO/RECEIVES,
//! REPLIES_TO/REPLIED_BY, PARTICIPATES_IN/PARTICIPANT,
//! SURFACES/SURFACED_BY). All six are converse-positive, not
//! algebraic-negation — under pointwise negation they'd propagate
//! incorrectly. Dropped; reverse queries use fiber scan at object axis.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-comms";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A discrete utterance — the unit that carries a body.
pub const MESSAGE: &str = "message";

/// A message surface — anything a message can be addressed to.
pub const CHANNEL: &str = "channel";

/// A 1:1 private-query channel (tell / DM). Specializes
/// [`CHANNEL`].
pub const PRIVATE_QUERY: &str = "private-query";

/// A broadcast channel (`say`, global chat). Specializes
/// [`CHANNEL`].
pub const BROADCAST_CHANNEL: &str = "broadcast-channel";

/// An entity capable of uttering — accounts, characters, bots.
pub const SPEAKER: &str = "speaker";

// ─────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────

/// `(message, was-said-by, speaker)` — speaker who uttered the
/// message.
pub const WAS_SAID_BY: &str = "was-said-by";

/// `(message, addressed-to, recipient)` — explicit recipient. For
/// public-channel messages, typically absent or equal to the
/// channel.
pub const ADDRESSED_TO: &str = "addressed-to";

/// `(reply, replies-to, original-message)` — reply-chain link.
pub const REPLIES_TO: &str = "replies-to";

/// `(message, was-uttered-at, iso)` — timestamp of utterance.
pub const WAS_UTTERED_AT: &str = "was-uttered-at";

/// `(speaker, participates-in, channel)` — speaker is subscribed to
/// / present on this channel.
pub const PARTICIPATES_IN: &str = "participates-in";

/// `(channel, surfaces, port)` — channel is rendered via this port
/// (telnet, irc, stdio).
pub const SURFACES: &str = "surfaces";

/// `(session, projects-through, driver)` — a session's utterances
/// flow out through this driver.
pub const PROJECTS_THROUGH: &str = "projects-through";

/// `(subject, has-version, version-string)` — generic version
/// marker. Lives here because protocol-version negotiation between
/// speakers and channels is the common reason to witness it.
pub const HAS_VERSION: &str = "has-version";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the communications vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Communications;

#[async_trait]
impl Agent for Communications {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        for t in [MESSAGE, CHANNEL, PRIVATE_QUERY, BROADCAST_CHANNEL, SPEAKER] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }

        for p in [
            WAS_SAID_BY,
            ADDRESSED_TO,
            REPLIES_TO,
            WAS_UTTERED_AT,
            PARTICIPATES_IN,
            SURFACES,
            PROJECTS_THROUGH,
            HAS_VERSION,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // Channel kinds specialize CHANNEL.
        out.push(Claim::new(PRIVATE_QUERY, SPECIALIZES_AS, CHANNEL));
        out.push(Claim::new(BROADCAST_CHANNEL, SPECIALIZES_AS, CHANNEL));

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::foundation::INVERTS_AS;

    #[test]
    fn channel_kinds_specialize() {
        let claims = Communications.claims();
        assert!(claims.iter().any(|c| c.subject == PRIVATE_QUERY
            && c.predicate == SPECIALIZES_AS
            && c.object == CHANNEL));
        assert!(claims.iter().any(|c| c.subject == BROADCAST_CHANNEL
            && c.predicate == SPECIALIZES_AS
            && c.object == CHANNEL));
    }

    #[test]
    fn core_predicates_declared() {
        let claims = Communications.claims();
        for p in [
            WAS_SAID_BY,
            ADDRESSED_TO,
            REPLIES_TO,
            PARTICIPATES_IN,
            SURFACES,
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
        let claims = Communications.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "comms module should declare no INVERTS_AS wiring"
        );
    }
}
