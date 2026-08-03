//! The wire protocol. Serialized with serde; one
//! `Message` per newline-delimited JSON line on a Unix-domain socket.
//!
//! These types are shared by the hub (server) and by every agent
//! crate's subprocess runner (client). There is no shadow
//! serialization layer — a message is a message, seen the same way
//! by both sides.

use super::MorphismKind;
use crate::algebra::Value;
use serde::{Deserialize, Serialize};

/// One line on the socket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Message {
    /// Agent → hub: announce identity and declare subscribed predicates.
    Hello {
        /// The agent's declared name (matches `Vocabulary::name`).
        agent: String,
        /// Agent semver.
        version: String,
        /// Predicate names the agent subscribes to.
        subscriptions: Vec<String>,
    },

    /// Hub → agent: handshake accepted; echoes a session id.
    Welcome {
        /// Opaque session identifier, stable for this connection.
        session: String,
    },

    /// Either direction: witness a claim. Assertions carry only the
    /// (subject, predicate, object) triple — the bilattice value is
    /// determined by cascade fold, not by the caller. Witnessing a
    /// claim is state mutation of the hub's shared reality, not RPC;
    /// no value is returned.
    Assert {
        /// Subject term (string; the hub interns).
        subject: String,
        /// Predicate term.
        predicate: String,
        /// Object term — the witness of what the claim is about.
        object: String,
    },

    /// Agent → hub: subscribe to cascade events on a predicate after
    /// the initial Hello.
    Subscribe {
        /// Predicate to subscribe to.
        predicate: String,
    },

    /// Hub → agent: a matching event settled, with its derivation chain.
    Event {
        /// The settled claim that triggered the event.
        claim: WireClaim,
        /// The morphism applications that produced it (empty for
        /// directly-asserted claims).
        derivation: Vec<DerivationRecord>,
    },

    /// Either direction: protocol or runtime error.
    Error {
        /// Short machine-readable code.
        code: String,
        /// Human-readable detail.
        message: String,
    },
}

/// A claim as it crosses the wire, decorated with cascade metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireClaim {
    /// Subject term.
    pub subject: String,
    /// Predicate term.
    pub predicate: String,
    /// Object term — the witness.
    pub object: String,
    /// Bilattice value at the time the claim settled.
    pub value: Value,
    /// ISO-8601 timestamp, UTC.
    pub timestamp: String,
}

/// One step in a cascade derivation chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DerivationRecord {
    /// Which morphism was applied.
    pub via: MorphismKind,
    /// Claims whose values were combined to produce the result.
    pub premises: Vec<WireClaim>,
}

impl DerivationRecord {
    /// Return the first premise whose `predicate` equals `name`, if
    /// any. Agents that subscribe to a composition or fusion target
    /// typically need the sibling source claims out of the last
    /// derivation step — this is the short path.
    #[must_use]
    pub fn find_premise(&self, name: &str) -> Option<&WireClaim> {
        self.premises.iter().find(|c| c.predicate == name)
    }
}
