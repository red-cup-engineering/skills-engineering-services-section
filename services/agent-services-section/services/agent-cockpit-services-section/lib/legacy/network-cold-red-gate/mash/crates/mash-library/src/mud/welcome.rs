//! MUD welcome — extends [`crate::welcome::WelcomePort`] with
//! MUD-specific session initialization.
//!
//! # What the core welcome already does
//!
//! [`crate::welcome::WelcomePort`] handles the generic part: on
//! [`crate::presence::IS_NEWLY_CONNECTED`], mint an avatar subject,
//! witness `(session, inhabits, avatar)`, and place the avatar in
//! the scene's spawn room. Deployment-agnostic.
//!
//! # What this MUD welcome adds
//!
//! The MUD stack needs additional per-session state before the
//! parser will dispatch input:
//!
//! 1. **Puppeting** — `(session, puppets, avatar)`. The session
//!    drives the avatar as its character.
//! 2. **Initial role** — `(session, has-role, role:anonymouse)` so
//!    the capability-resolver grants look/go/quit/help/who/register/
//!    login caps (but not voice — that's `role:registered`).
//! 3. **Initial state** — `(session, has-session-state,
//!    state:anonymouse)` so the state-rule port accepts commands
//!    per that state's `provides-command` set.
//! 4. **Welcome event** — a `welcome-event:<session>:<id>` subject
//!    carrying `occurred-at`, plus
//!    `(session, was-welcomed-at, event)`. The [`super::parser`]
//!    port observes this and flushes any buffered input.
//! 5. **Banner message** — a "Welcome..." say emission on the
//!    session channel.
//!
//! # Ordering
//!
//! This port runs alongside the core welcome port; both observe the
//! same `IS_NEWLY_CONNECTED` signal and emit independently. The
//! core handles world-placement claims; this port handles session-
//! identity claims. The cascade's monotone semantics means either
//! ordering is fine.

use std::collections::HashSet;

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;

use crate::capability::HAS_ROLE;
use crate::conduit::{HAS_BODY, IS_SURFACE_READY, WAS_SAID_IN};
use crate::foundation::IS_A_TERM;
use crate::mud::session::{HAS_SESSION_STATE, OCCURRED_AT, PUPPETS, WAS_WELCOMED_AT, WELCOME_EVENT};
use crate::mud::verbs::{ROLE_ANONYMOUSE, STATE_ANONYMOUSE};
use crate::presence::IS_NEWLY_CONNECTED;

/// Default welcome banner.
pub const DEFAULT_BANNER: &str =
    "Welcome. You arrive anonymouse. Type `help` for commands or `register <name>` to claim one.";

/// MUD welcome projection state.
pub struct MudWelcomePort {
    welcomed: HashSet<String>,
    next_id: u64,
    now_iso: fn() -> String,
    banner: String,
}

impl Default for MudWelcomePort {
    fn default() -> Self {
        Self::new()
    }
}

fn default_now_iso() -> String {
    "1970-01-01T00:00:00Z".to_owned()
}

impl MudWelcomePort {
    /// Fresh state with default clock and banner.
    #[must_use]
    pub fn new() -> Self {
        Self {
            welcomed: HashSet::new(),
            next_id: 1,
            now_iso: default_now_iso,
            banner: DEFAULT_BANNER.to_owned(),
        }
    }

    /// Custom clock — deterministic tests.
    #[must_use]
    pub fn with_clock(mut self, now_iso: fn() -> String) -> Self {
        self.now_iso = now_iso;
        self
    }

    /// Custom banner text.
    #[must_use]
    pub fn with_banner(mut self, banner: impl Into<String>) -> Self {
        self.banner = banner.into();
        self
    }
}

impl Projection for MudWelcomePort {
    fn identity(&self) -> &str {
        "mash-library-mud-welcome"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![IS_NEWLY_CONNECTED.to_owned()]
    }

    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        _object: &str,
        value: Value,
    ) -> Vec<Claim> {
        if value != Value::True || predicate != IS_NEWLY_CONNECTED {
            return Vec::new();
        }
        if !self.welcomed.insert(subject.to_owned()) {
            return Vec::new();
        }

        let session = subject;
        let id = self.next_id;
        self.next_id += 1;
        let now = (self.now_iso)();

        // Avatar subject follows the convention used by
        // [`crate::welcome::WelcomePort`] — both ports end up
        // referring to the same avatar subject.
        let avatar = format!("avatar:for-{session}");
        let event = format!("welcome-event:{session}:{id}");
        let msg = format!("msg:welcome:{id}");

        vec![
            // Puppet the avatar as the session's character.
            Claim::new(session, PUPPETS, &avatar),
            // Initial role + state.
            Claim::new(session, HAS_ROLE, ROLE_ANONYMOUSE),
            Claim::new(session, HAS_SESSION_STATE, STATE_ANONYMOUSE),
            // Welcome event — parser observes WAS_WELCOMED_AT to
            // flush buffered input.
            Claim::new(&event, IS_A_TERM, WELCOME_EVENT),
            Claim::new(&event, OCCURRED_AT, &now),
            Claim::new(session, WAS_WELCOMED_AT, &event),
            // Banner message.
            Claim::new(&msg, WAS_SAID_IN, session),
            Claim::new(&msg, HAS_BODY, &self.banner),
            Claim::new(&msg, IS_SURFACE_READY, session),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_now() -> String {
        "2026-04-21T00:00:00Z".to_owned()
    }

    #[test]
    fn welcome_emits_puppets_role_state_event_banner() {
        let mut port = MudWelcomePort::new().with_clock(fixed_now);
        let out = port.ingest("session:1", IS_NEWLY_CONNECTED, "session:1", Value::True);
        assert!(out
            .iter()
            .any(|c| c.predicate == PUPPETS && c.object == "avatar:for-session:1"));
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_ROLE && c.object == ROLE_ANONYMOUSE));
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_SESSION_STATE && c.object == STATE_ANONYMOUSE));
        assert!(out
            .iter()
            .any(|c| c.predicate == WAS_WELCOMED_AT && c.subject == "session:1"));
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object.starts_with("Welcome")));
        assert!(out.iter().any(|c| c.predicate == IS_SURFACE_READY));
    }

    #[test]
    fn welcome_event_carries_occurred_at() {
        let mut port = MudWelcomePort::new().with_clock(fixed_now);
        let out = port.ingest("session:1", IS_NEWLY_CONNECTED, "session:1", Value::True);
        let event_subject = out
            .iter()
            .find(|c| c.predicate == WAS_WELCOMED_AT)
            .expect("was-welcomed-at must be witnessed")
            .object
            .clone();
        assert!(out.iter().any(|c| c.subject == event_subject
            && c.predicate == OCCURRED_AT
            && c.object == "2026-04-21T00:00:00Z"));
    }

    #[test]
    fn welcome_is_idempotent_per_session() {
        let mut port = MudWelcomePort::new().with_clock(fixed_now);
        let first = port.ingest("session:1", IS_NEWLY_CONNECTED, "session:1", Value::True);
        assert!(!first.is_empty());
        let again = port.ingest("session:1", IS_NEWLY_CONNECTED, "session:1", Value::True);
        assert!(again.is_empty());
    }

    #[test]
    fn custom_banner_overrides_default() {
        let mut port = MudWelcomePort::new()
            .with_clock(fixed_now)
            .with_banner("Custom welcome.");
        let out = port.ingest("session:1", IS_NEWLY_CONNECTED, "session:1", Value::True);
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object == "Custom welcome."));
    }

    #[test]
    fn non_true_values_ignored() {
        let mut port = MudWelcomePort::new();
        let out = port.ingest("session:1", IS_NEWLY_CONNECTED, "session:1", Value::False);
        assert!(out.is_empty());
    }

    #[test]
    fn multi_session_independence() {
        let mut port = MudWelcomePort::new().with_clock(fixed_now);
        let a = port.ingest("session:a", IS_NEWLY_CONNECTED, "session:a", Value::True);
        let b = port.ingest("session:b", IS_NEWLY_CONNECTED, "session:b", Value::True);
        assert!(!a.is_empty());
        assert!(!b.is_empty());
        // Each session gets its own event subject.
        let event_a = a
            .iter()
            .find(|c| c.predicate == WAS_WELCOMED_AT)
            .unwrap()
            .object
            .clone();
        let event_b = b
            .iter()
            .find(|c| c.predicate == WAS_WELCOMED_AT)
            .unwrap()
            .object
            .clone();
        assert_ne!(event_a, event_b);
    }
}
