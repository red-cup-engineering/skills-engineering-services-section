//! Talker — MASH's in-substrate multi-user chat primitive.
//!
//! The talker is the foundation IRC ports, the `mash dm` CLI, and any
//! other chat surface project onto. Also the base for persistent-
//! clerk agents (CommandersAid) that read and write chat as a
//! first-class substrate.
//!
//! # Layering
//!
//! The talker is a small extension over existing pieces:
//!
//! - [`crate::comms`] already declares channels, messages, tells,
//!   participation, surfacing.
//! - [`crate::mud::session`] declares [`crate::mud::session::AUTH_ACCOUNT`]
//!   and [`crate::mud::session::HAS_ACCOUNT_NAME`] — identity carrier.
//!
//! This module adds three genuinely new concepts:
//!
//! - **Groups** — membership-bound subjects users voluntarily join.
//!   Distinct from channels (which are message surfaces); a group
//!   can own one or more channels.
//! - **Group-owned channels** — links from a group to channels it
//!   scopes (group chats). Permission enforcement lives at rule
//!   ports, not this vocab.
//! - **Friends** — mutual acknowledgment between two accounts; the
//!   basis for friend-lists and presence visibility.
//!
//! # Deferred
//!
//! Mail (store-and-forward), finger (profile bios), away/idle
//! (presence state) — add when real consumers need them.
//!
//! # Inversion discipline
//!
//! The old `mash-vocab-talker` declared four INVERTS_AS pairs
//! (HAS_GROUP_MEMBER/IS_GROUP_MEMBER_OF, HAS_GROUP_OWNER/OWNS_GROUP,
//! OWNS_GROUP_CHANNEL/IS_GROUP_CHAT_FOR, IS_FRIEND_OF/HAS_FRIEND).
//! All four are converse-positive, not algebraic-negation. Dropped;
//! reverse queries use fiber scan at object axis.
//!
//! Friendship is still mutual-by-convention: both parties assert
//! `(A, is-friend-of, B)` and `(B, is-friend-of, A)`. The symmetric
//! assertion at both subjects replaces what the inversion wiring was
//! doing incorrectly.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-talker";

// ─────────────────────────────────────────────────────────────────────
// Groups
// ─────────────────────────────────────────────────────────────────────

/// A group — membership-bound subject users voluntarily join.
/// Subject convention `group:<id>`.
pub const GROUP: &str = "group";

/// `(group, has-group-name, string)` — human-facing display name.
pub const HAS_GROUP_NAME: &str = "has-group-name";

/// `(group, has-group-description, string)` — short description.
pub const HAS_GROUP_DESCRIPTION: &str = "has-group-description";

/// `(group, has-group-member, account)` — one member. Multi-valued.
pub const HAS_GROUP_MEMBER: &str = "has-group-member";

/// `(group, has-group-owner, account)` — administering account(s).
pub const HAS_GROUP_OWNER: &str = "has-group-owner";

/// `(group, owns-group-channel, channel)` — channel owned by this
/// group. The channel is a group chat; non-members should not
/// participate (enforcement at permission port).
pub const OWNS_GROUP_CHANNEL: &str = "owns-group-channel";

// ─────────────────────────────────────────────────────────────────────
// Friends
// ─────────────────────────────────────────────────────────────────────

/// `(account-a, is-friend-of, account-b)` — A has acknowledged B.
/// Symmetric friendship requires both `(A, is-friend-of, B)` and
/// `(B, is-friend-of, A)` to be witnessed. Downstream consumers
/// treat friendship as symmetric only when both cells are present.
pub const IS_FRIEND_OF: &str = "is-friend-of";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the talker vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Talker;

#[async_trait]
impl Agent for Talker {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        out.push(Claim::new(GROUP, IS_A_TERM, IDENTITY));

        for p in [
            HAS_GROUP_NAME,
            HAS_GROUP_DESCRIPTION,
            HAS_GROUP_MEMBER,
            HAS_GROUP_OWNER,
            OWNS_GROUP_CHANNEL,
            IS_FRIEND_OF,
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
    fn group_term_declared() {
        assert!(Talker
            .claims()
            .iter()
            .any(|c| c.subject == GROUP && c.predicate == IS_A_TERM));
    }

    #[test]
    fn all_predicates_declared() {
        let claims = Talker.claims();
        for p in [
            HAS_GROUP_NAME,
            HAS_GROUP_DESCRIPTION,
            HAS_GROUP_MEMBER,
            HAS_GROUP_OWNER,
            OWNS_GROUP_CHANNEL,
            IS_FRIEND_OF,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} not declared"
            );
        }
    }

    #[test]
    fn no_spurious_inversions() {
        let claims = Talker.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "talker module should declare no INVERTS_AS wiring"
        );
    }
}
