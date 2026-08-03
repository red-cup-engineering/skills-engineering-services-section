//! Presence: avatar, session, and effector — the three things that
//! together make a person present in the world.
//!
//! # The unification
//!
//! Per the captain's memory on session+effector unification: a session
//! is identity + scope + history; an effector is the witness-producer
//! on the other side of a session. Both are things. They are linked
//! via a hot-swappable binding. Worker, player, llm, human — all are
//! sessions-with-bindings, differing only in what binding-kind they
//! carry and what effector sits on the far side.
//!
//! An avatar is the in-world body a session inhabits — the subject
//! through which the session's verbs settle claims about the
//! spatial/narrative world. An avatar is to a session what a character
//! is to a player: the thing in the scene that represents the session's
//! presence.
//!
//! # Wiener/Barad framing
//!
//! A session is not a struct carrying state. It is a stable region of
//! the manifold where the cascade settles identity, scope, and history
//! claims under a single subject-term. An effector is not a function —
//! it is a thing with a role-quality and a binding-relation. An avatar
//! is not a character object — it is a subject inhabited by a session
//! and located in a room, with all of those being settled claims.
//!
//! Hot-swappability is free: the binding is a revocable claim. Witness
//! the binding claim at [`mash_engine::algebra::Value::False`] to
//! revoke; witness a new binding claim to install the replacement.
//!
//! # Predicates declared here
//!
//! All converse-positive relations are declared as single-direction
//! predicates per the inversion-discipline established in the
//! [`crate::container`] module. Reverse queries use fiber-scan at the
//! object axis.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, THING};

/// Owner identity for the presence owner-agent.
pub const IDENTITY: &str = "mash-library-presence";

// ─────────────────────────────────────────────────────────────────────
// Category terms
// ─────────────────────────────────────────────────────────────────────

/// A **session** is identity + scope + history: a stable subject whose
/// fiber accumulates the claims of an interactant's participation.
pub const SESSION: &str = "session";

/// An **effector** is the witness-producer on the far side of a
/// session's binding — the thing that turns session intent into
/// substrate claims (and vice-versa, where applicable).
pub const EFFECTOR: &str = "effector";

/// An **avatar** is the in-world body inhabited by a session — the
/// subject that locates-in rooms and performs acts in the scene.
pub const AVATAR: &str = "avatar";

// ─────────────────────────────────────────────────────────────────────
// Binding predicates
// ─────────────────────────────────────────────────────────────────────

/// `(session, has-binding, effector)` — the session is bound to this
/// effector. Witness at [`mash_engine::algebra::Value::False`] to
/// revoke; bindings are hot-swappable.
pub const HAS_BINDING: &str = "has-binding";

/// `(session, binding-kind, kind)` — what medium the binding speaks
/// (`telnet`, `irc`, `llm`, `stdio`, `human`, etc.). The kind is
/// itself a subject-term; a later specialization can declare each
/// kind as SPECIALIZES_AS some broader category.
pub const BINDING_KIND: &str = "binding-kind";

/// `(session, inhabits, avatar)` — the avatar this session currently
/// moves through the world as.
pub const INHABITS: &str = "inhabits";

// ─────────────────────────────────────────────────────────────────────
// Session state qualities
// ─────────────────────────────────────────────────────────────────────

/// `(session, has-session-render, text)` — the current narrative state
/// the session's effector should present.
pub const HAS_SESSION_RENDER: &str = "has-session-render";

/// `(session, has-available-command, command-term)` — a command that
/// the session can currently emit; the action-space the effector
/// should expose.
pub const HAS_AVAILABLE_COMMAND: &str = "has-available-command";

/// `(session, is-newly-connected, true)` — a one-shot quality set at
/// session start so welcome projections can fire.
pub const IS_NEWLY_CONNECTED: &str = "is-newly-connected";

/// `(session, ended-at, iso-timestamp)` — witnessed when the session's
/// far side closes (socket EOF, LLM stop, etc.).
pub const ENDED_AT: &str = "ended-at";

// ─────────────────────────────────────────────────────────────────────
// Effector qualities
// ─────────────────────────────────────────────────────────────────────

/// `(effector, has-role, role-term)` — the effector's operational role:
/// `conduit`, `actuator`, `responder`, `sensor`, `projection`.
pub const HAS_ROLE: &str = "has-role";

// ─────────────────────────────────────────────────────────────────────
// Session lifecycle events
//
// Events are individuated — their own subjects with their own
// timestamps — rather than flags on the session subject. This keeps
// the vocabulary CRDT-monotone: cells never need to retract. "Is
// this session currently paused?" is a consumer-side question,
// answered by subscribing to the event predicates and comparing
// `occurred-at` timestamps.
// ─────────────────────────────────────────────────────────────────────

/// Parent category for every session lifecycle-event kind. Concrete
/// kinds specialize-as this so consumers can subscribe once.
pub const SESSION_EVENT: &str = "session-event";

/// Session-start event term. Specializes [`SESSION_EVENT`].
pub const START_EVENT: &str = "start-event";

/// Session-pause event term. Specializes [`SESSION_EVENT`].
pub const PAUSE_EVENT: &str = "pause-event";

/// Session-resume event term. Specializes [`SESSION_EVENT`].
pub const RESUME_EVENT: &str = "resume-event";

/// Session-end event term. Specializes [`SESSION_EVENT`].
pub const END_EVENT: &str = "end-event";

/// `(event, concerns-session, session)` — event's subject session.
pub const CONCERNS_SESSION: &str = "concerns-session";

/// `(event, occurred-at, iso-timestamp)` — event timestamp.
pub const OCCURRED_AT: &str = "occurred-at";

/// `(session, was-started-at, start-event)` — session's start event.
pub const WAS_STARTED_AT: &str = "was-started-at";

/// `(session, was-paused-at, pause-event)` — one per pause.
/// Multi-valued.
pub const WAS_PAUSED_AT: &str = "was-paused-at";

/// `(session, was-resumed-at, resume-event)` — one per resume.
/// Multi-valued.
pub const WAS_RESUMED_AT: &str = "was-resumed-at";

/// `(session, was-ended-at, end-event)` — session's end event.
pub const WAS_ENDED_AT: &str = "was-ended-at";

// ─────────────────────────────────────────────────────────────────────
// Scope declaration
// ─────────────────────────────────────────────────────────────────────

/// `(session, has-loaded-scope, subject)` — a skill, capability,
/// agent, preset tool the session-starter declared in scope. Multi-
/// valued; accumulates monotonically across session lifetime.
pub const HAS_LOADED_SCOPE: &str = "has-loaded-scope";

// ─────────────────────────────────────────────────────────────────────
// Effector kinds
//
// Concrete effector kinds that the session's bound effector advertises
// via [`HAS_EFFECTOR_KIND`]. Consumers subscribe to the parent
// category term to see any kind through the specialization cascade.
// ─────────────────────────────────────────────────────────────────────

/// Category for concrete effector implementations.
pub const EFFECTOR_KIND: &str = "effector-kind";

/// LLM runtime producing claims from prompt completions (Anthropic
/// Claude family).
pub const EFFECTOR_KIND_LLM_CLAUDE: &str = "effector-kind:llm-claude";

/// Connected human's input stream (telnet, stdio).
pub const EFFECTOR_KIND_HUMAN_TELNET: &str = "effector-kind:human-telnet";

/// Subprocess shell producing claims from exit code + stdout/stderr.
pub const EFFECTOR_KIND_SUBPROCESS_BASH: &str = "effector-kind:subprocess-bash";

/// Containerized workload.
pub const EFFECTOR_KIND_CONTAINER_EXEC: &str = "effector-kind:container-exec";

/// Filesystem write effector.
pub const EFFECTOR_KIND_FILE_WRITE: &str = "effector-kind:file-write";

/// `(effector, has-effector-kind, effector-kind-term)` — what kind of
/// effector this is.
pub const HAS_EFFECTOR_KIND: &str = "has-effector-kind";

/// `(effector, is-effector-stopped, effector)` — diagonal state flag
/// marking a binding that is no longer live. Monotone; presence of
/// this cell reads as "not currently producing witnesses".
pub const IS_EFFECTOR_STOPPED: &str = "is-effector-stopped";

// ─────────────────────────────────────────────────────────────────────
// Individuated session render
//
// [`HAS_SESSION_RENDER`] takes either a text body (simple renders,
// single-source) or a render-subject (composed renders, multi-source).
// When using a render-subject, the subject carries its own
// [`HAS_RENDER_TEXT`] and [`OCCURRED_AT`] so the consumer picks the
// latest by timestamp.
// ─────────────────────────────────────────────────────────────────────

/// A point-in-time render of a session's state. Subjects use
/// `session-render:<session>:<ns>`; each render is individuated so
/// the fiber accumulates monotonically and consumers pick the latest
/// by [`OCCURRED_AT`].
pub const SESSION_RENDER: &str = "session-render";

/// `(render, has-render-text, string)` — payload text of an
/// individuated render.
pub const HAS_RENDER_TEXT: &str = "has-render-text";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the session/effector/avatar category terms
/// and their binding + state predicates.
#[derive(Debug, Clone, Copy, Default)]
pub struct Presence;

#[async_trait]
impl Agent for Presence {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Category terms specialize-as THING.
        for t in [SESSION, EFFECTOR, AVATAR] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
            out.push(Claim::new(t, SPECIALIZES_AS, THING));
        }

        // Event / render / effector-kind category terms.
        for t in [
            SESSION_EVENT,
            START_EVENT,
            PAUSE_EVENT,
            RESUME_EVENT,
            END_EVENT,
            EFFECTOR_KIND,
            EFFECTOR_KIND_LLM_CLAUDE,
            EFFECTOR_KIND_HUMAN_TELNET,
            EFFECTOR_KIND_SUBPROCESS_BASH,
            EFFECTOR_KIND_CONTAINER_EXEC,
            EFFECTOR_KIND_FILE_WRITE,
            SESSION_RENDER,
        ] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }

        // Lifecycle event-kinds specialize-as SESSION_EVENT.
        for kind in [START_EVENT, PAUSE_EVENT, RESUME_EVENT, END_EVENT] {
            out.push(Claim::new(kind, SPECIALIZES_AS, SESSION_EVENT));
        }

        // Concrete effector kinds specialize-as EFFECTOR_KIND.
        for kind in [
            EFFECTOR_KIND_LLM_CLAUDE,
            EFFECTOR_KIND_HUMAN_TELNET,
            EFFECTOR_KIND_SUBPROCESS_BASH,
            EFFECTOR_KIND_CONTAINER_EXEC,
            EFFECTOR_KIND_FILE_WRITE,
        ] {
            out.push(Claim::new(kind, SPECIALIZES_AS, EFFECTOR_KIND));
        }

        // Predicates.
        for p in [
            HAS_BINDING,
            BINDING_KIND,
            INHABITS,
            HAS_SESSION_RENDER,
            HAS_AVAILABLE_COMMAND,
            IS_NEWLY_CONNECTED,
            ENDED_AT,
            HAS_ROLE,
            CONCERNS_SESSION,
            OCCURRED_AT,
            WAS_STARTED_AT,
            WAS_PAUSED_AT,
            WAS_RESUMED_AT,
            WAS_ENDED_AT,
            HAS_LOADED_SCOPE,
            HAS_EFFECTOR_KIND,
            IS_EFFECTOR_STOPPED,
            HAS_RENDER_TEXT,
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
    fn category_terms_specialize_as_thing() {
        let claims = Presence.claims();
        for t in [SESSION, EFFECTOR, AVATAR] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == t && c.predicate == SPECIALIZES_AS && c.object == THING),
                "{t} should specialize-as THING"
            );
        }
    }

    #[test]
    fn binding_predicates_declared() {
        let claims = Presence.claims();
        for p in [HAS_BINDING, BINDING_KIND, INHABITS] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared as a predicate"
            );
        }
    }

    #[test]
    fn session_state_predicates_declared() {
        let claims = Presence.claims();
        for p in [
            HAS_SESSION_RENDER,
            HAS_AVAILABLE_COMMAND,
            IS_NEWLY_CONNECTED,
            ENDED_AT,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared as a predicate"
            );
        }
    }

    #[test]
    fn lifecycle_event_kinds_specialize_to_session_event() {
        let claims = Presence.claims();
        for kind in [START_EVENT, PAUSE_EVENT, RESUME_EVENT, END_EVENT] {
            assert!(
                claims.iter().any(|c| c.subject == kind
                    && c.predicate == SPECIALIZES_AS
                    && c.object == SESSION_EVENT),
                "{kind} should specialize {SESSION_EVENT}"
            );
        }
    }

    #[test]
    fn effector_kinds_specialize_to_effector_kind_category() {
        let claims = Presence.claims();
        for kind in [
            EFFECTOR_KIND_LLM_CLAUDE,
            EFFECTOR_KIND_HUMAN_TELNET,
            EFFECTOR_KIND_SUBPROCESS_BASH,
            EFFECTOR_KIND_CONTAINER_EXEC,
            EFFECTOR_KIND_FILE_WRITE,
        ] {
            assert!(
                claims.iter().any(|c| c.subject == kind
                    && c.predicate == SPECIALIZES_AS
                    && c.object == EFFECTOR_KIND),
                "{kind} should specialize {EFFECTOR_KIND}"
            );
        }
    }

    #[test]
    fn session_render_term_and_text_predicate_declared() {
        let claims = Presence.claims();
        assert!(claims.iter().any(|c| c.subject == SESSION_RENDER
            && c.predicate == IS_A_TERM));
        assert!(claims.iter().any(|c| c.subject == HAS_RENDER_TEXT
            && c.predicate == IS_A_PREDICATE));
    }

    #[test]
    fn scope_and_event_linkage_predicates_declared() {
        let claims = Presence.claims();
        for p in [
            HAS_LOADED_SCOPE,
            CONCERNS_SESSION,
            OCCURRED_AT,
            WAS_STARTED_AT,
            WAS_PAUSED_AT,
            WAS_RESUMED_AT,
            WAS_ENDED_AT,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared"
            );
        }
    }
}
