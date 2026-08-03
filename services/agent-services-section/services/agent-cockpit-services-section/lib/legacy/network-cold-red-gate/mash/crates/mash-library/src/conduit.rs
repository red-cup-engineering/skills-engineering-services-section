//! Conduit — protocol-facing ports: the vocabulary side.
//!
//! A **conduit** is a port that moves information across an external
//! protocol boundary (TCP, IRC, stdio, Unix socket, etc.). Its vocabulary
//! is mostly already in [`crate::presence`]: `SESSION`, `HAS_BINDING`,
//! `BINDING_KIND`, `HAS_SESSION_RENDER`, `HAS_AVAILABLE_COMMAND`,
//! `IS_NEWLY_CONNECTED`, `ENDED_AT`. This module adds the small set of
//! command-routing predicates a conduit needs to translate incoming
//! bytes into session-scoped verb claims.
//!
//! # Binary implementation deferred
//!
//! The actual TCP-listener subprocess binary (opening a socket,
//! performing the hub handshake, per-session task spawning, line
//! tokenization, outbound render writing) is port-implementation
//! work — not library vocabulary. Reference: `mash-old-library/
//! archive/mash-port-conduit-mud-telnet/`. That's ~500 lines of
//! async tokio code and lives naturally as `mash-library/src/bin/
//! conduit-telnet.rs` when written. This module supplies the
//! vocabulary the binary would consume.
//!
//! # Wiener/Barad framing
//!
//! A conduit is a thing with `HAS_ROLE conduit` (from
//! [`crate::presence`]). Its sessions are also things with their own
//! subjects and fibers. Incoming bytes translate into claims at the
//! session subject; outgoing renderings come from the session's
//! `HAS_SESSION_RENDER` fiber. The conduit-binary holds its per-
//! connection socket-handles in in-process state (byte-level state
//! is port-local concern, per the audit-mash-first memory), but the
//! logical session lifecycle and IO is substrate-visible.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, THING};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-conduit";

// ─────────────────────────────────────────────────────────────────────
// Category terms
// ─────────────────────────────────────────────────────────────────────

/// A request made by a session (verb + argument). Each line of input
/// from a telnet/irc/stdio session becomes a request-subject with
/// these properties.
pub const REQUEST: &str = "request";

// ─────────────────────────────────────────────────────────────────────
// Request predicates
// ─────────────────────────────────────────────────────────────────────

/// `(request, issued-by-session, session)` — links the request to
/// its session. Reverse queries ("what requests did this session
/// issue?") scan the fiber at the object axis.
pub const ISSUED_BY_SESSION: &str = "issued-by-session";

/// `(request, has-verb, verb-term)` — the verb the session issued
/// (`look`, `go`, `say`, `quit`, etc.). Verb-terms are declared by
/// domain modules (movement verb-terms by movement, etc.).
pub const HAS_VERB: &str = "has-verb";

/// `(request, requested-arg, argument-string)` — the verb's argument,
/// if any. May be absent for niladic verbs like `look`.
pub const REQUESTED_ARG: &str = "requested-arg";

/// `(request, has-body, text)` — outbound body that the conduit
/// should write to the session's socket. Used by render ports; the
/// telnet conduit subscribes to is-surface-ready claims at sessions
/// it serves and writes the body bytes.
pub const HAS_BODY: &str = "has-body";

/// `(claim-at-session, was-said-in, channel)` — narrative output
/// tied to a specific channel (room, guild, tell, etc.). Fused with
/// `HAS_BODY` by the surface-ready composition in conduit-level
/// rendering.
pub const WAS_SAID_IN: &str = "was-said-in";

/// `(session-or-channel, is-surface-ready, marker)` — derived: a
/// body is ready to write to the subject's surface. Typically
/// composed from `HAS_BODY ∧ WAS_SAID_IN` at the matching object.
pub const IS_SURFACE_READY: &str = "is-surface-ready";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the conduit / request-routing vocabulary.
/// The actual TCP/IRC/stdio conduit binaries consume this vocabulary
/// (and the `crate::presence` vocabulary) at runtime.
#[derive(Debug, Clone, Copy, Default)]
pub struct Conduit;

#[async_trait]
impl Agent for Conduit {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // REQUEST specializes-as THING.
        out.push(Claim::new(REQUEST, IS_A_TERM, IDENTITY));
        out.push(Claim::new(REQUEST, SPECIALIZES_AS, THING));

        for p in [
            ISSUED_BY_SESSION,
            HAS_VERB,
            REQUESTED_ARG,
            HAS_BODY,
            WAS_SAID_IN,
            IS_SURFACE_READY,
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
    fn request_specializes_as_thing() {
        let claims = Conduit.claims();
        assert!(claims.iter().any(|c| c.subject == REQUEST
            && c.predicate == SPECIALIZES_AS
            && c.object == THING));
    }

    #[test]
    fn request_predicates_declared() {
        let claims = Conduit.claims();
        for p in [
            ISSUED_BY_SESSION,
            HAS_VERB,
            REQUESTED_ARG,
            HAS_BODY,
            WAS_SAID_IN,
            IS_SURFACE_READY,
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
