//! MUD session extensions — character, account, FSM states.
//!
//! # Why separate from `crate::presence`
//!
//! [`crate::presence`] declares the generic SESSION term. This module
//! layers MUD-specific structure on top: characters that sessions
//! puppet, accounts that persist across reconnects, session-lifecycle
//! events, and the FSM that gates which commands are invokable.
//!
//! # Divergence from old-library
//!
//! `mash-old-library/archive/mash-vocab-mud-session` declared three
//! INVERTS_AS pairs (AUTHENTICATED_AS / HAS_ACCOUNT_NAME /
//! CHARACTERIZED_BY). All three are converse-positive, not
//! algebraic-negation pairs — under pointwise negation semantics
//! they'd propagate incorrectly. Dropped here; reverse queries use
//! fiber scan at object axis.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS};
use crate::presence::SESSION;

/// Owner identity. Also namespace prefix for declared subjects.
pub const IDENTITY: &str = "mash-library-mud-session";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A character a session puppets in the world.
pub const CHARACTER: &str = "character";

/// A persistent identity that survives reconnect. Different from
/// [`crate::accounting::ACCOUNT`] (ledger term) — this is an
/// authentication account.
pub const AUTH_ACCOUNT: &str = "auth-account";

/// A session-lifecycle event term.
pub const SESSION_EVENT: &str = "session-event";

/// Connection-moment event. Specializes [`SESSION_EVENT`].
pub const CONNECTION_EVENT: &str = "connection-event";

/// Welcome-settled event. Specializes [`SESSION_EVENT`].
pub const WELCOME_EVENT: &str = "welcome-event";

/// A session FSM state term. Concrete states live in
/// [`super::verbs`].
pub const SESSION_STATE: &str = "session-state";

// ─────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────

/// `(session, puppets, character)` — session puppets this character.
pub const PUPPETS: &str = "puppets";

/// `(event, occurred-at, iso-timestamp)` — event timestamp.
pub const OCCURRED_AT: &str = "occurred-at";

/// `(event, concerns-session, session)` — event's subject session.
pub const CONCERNS_SESSION: &str = "concerns-session";

/// `(session, was-connected-at, connection-event)` — event that
/// opened this session.
pub const WAS_CONNECTED_AT: &str = "was-connected-at";

/// `(session, was-welcomed-at, welcome-event)` — welcome-flow
/// completion event.
pub const WAS_WELCOMED_AT: &str = "was-welcomed-at";

/// `(session, has-session-state, session-state)` — current FSM
/// state of the session.
pub const HAS_SESSION_STATE: &str = "has-session-state";

/// `(state, is-restrictive-state, state)` — diagonal state marker.
/// When True at a state subject, the state-rule port denies every
/// command invoked by a session in that state regardless of role —
/// a one-way trap that prevents buffered input firing actions after
/// the session is gone.
pub const IS_RESTRICTIVE_STATE: &str = "is-restrictive-state";

/// `(scene, has-default-spawn, room)` — scene's default spawn room.
pub const HAS_DEFAULT_SPAWN: &str = "has-default-spawn";

/// `(session, authenticated-as, account)` — present iff the session
/// has logged in.
pub const AUTHENTICATED_AS: &str = "authenticated-as";

/// `(account, has-account-name, string)` — user-facing name (login
/// identifier).
pub const HAS_ACCOUNT_NAME: &str = "has-account-name";

/// `(account, has-password-hash, hex-sha256)` — hashed password.
/// Stored hashed, never in clear. v1 has no salt; layer on with a
/// `has-password-salt` claim when needed.
pub const HAS_PASSWORD_HASH: &str = "has-password-hash";

/// `(account, characterized-by, character)` — persistent character
/// the account embodies.
pub const CHARACTERIZED_BY: &str = "characterized-by";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the MUD session vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct MudSession;

#[async_trait]
impl Agent for MudSession {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        for t in [
            CHARACTER,
            AUTH_ACCOUNT,
            SESSION_EVENT,
            CONNECTION_EVENT,
            WELCOME_EVENT,
            SESSION_STATE,
        ] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }

        // A CHARACTER is a kind of thing that a session puppets. Not
        // specialized as SESSION — the character is separate from the
        // session that puppets it (session → character is one-to-one
        // at any moment but the character persists across reconnects
        // while sessions don't).
        //
        // Event specializations.
        out.push(Claim::new(CONNECTION_EVENT, SPECIALIZES_AS, SESSION_EVENT));
        out.push(Claim::new(WELCOME_EVENT, SPECIALIZES_AS, SESSION_EVENT));

        // Reference SESSION so the substrate sees it as a live term
        // in this namespace.
        out.push(Claim::new(SESSION, IS_A_TERM, crate::presence::IDENTITY));

        for p in [
            PUPPETS,
            OCCURRED_AT,
            CONCERNS_SESSION,
            WAS_CONNECTED_AT,
            WAS_WELCOMED_AT,
            HAS_SESSION_STATE,
            IS_RESTRICTIVE_STATE,
            HAS_DEFAULT_SPAWN,
            AUTHENTICATED_AS,
            HAS_ACCOUNT_NAME,
            HAS_PASSWORD_HASH,
            CHARACTERIZED_BY,
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
    fn no_spurious_inversions() {
        let claims = MudSession.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "mud-session should declare no INVERTS_AS wiring"
        );
    }

    #[test]
    fn connection_event_specializes_session_event() {
        let claims = MudSession.claims();
        assert!(claims.iter().any(|c| c.subject == CONNECTION_EVENT
            && c.predicate == SPECIALIZES_AS
            && c.object == SESSION_EVENT));
    }

    #[test]
    fn core_predicates_declared() {
        let claims = MudSession.claims();
        for p in [
            PUPPETS,
            HAS_SESSION_STATE,
            HAS_DEFAULT_SPAWN,
            AUTHENTICATED_AS,
            HAS_ACCOUNT_NAME,
            HAS_PASSWORD_HASH,
            CHARACTERIZED_BY,
            IS_RESTRICTIVE_STATE,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "missing declaration for {p}"
            );
        }
    }
}
