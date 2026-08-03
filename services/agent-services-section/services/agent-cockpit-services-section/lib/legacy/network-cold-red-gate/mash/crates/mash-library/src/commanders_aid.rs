//! Commanders-aid — persistent-clerk agent for DM-addressable chat.
//!
//! # What it is
//!
//! An agent that subscribes to the talker substrate, reassembles
//! direct messages addressed to its own account, and replies via a
//! pluggable responder closure. Production injects a Claude
//! subprocess responder; tests inject a canned closure.
//!
//! # Protocol
//!
//! A DM arrives as three comms cells on one message subject:
//!
//! - `(msg, addressed-to, <agent-account>)`
//! - `(msg, was-said-by, <sender-account>)`
//! - `(msg, has-body, <prompt-text>)`
//!
//! When all three arrive for the same message, the port calls the
//! responder and witnesses a reply-DM back to the sender — a fresh
//! message subject with `has-body`, `was-said-by <agent-account>`,
//! `addressed-to <sender>`, `was-uttered-at <iso>`, and (if the
//! responder returned one) `has-llm-session <sid>` for audit.
//!
//! # Library scope
//!
//! The library declares the vocabulary (reusing [`crate::comms`] and
//! [`crate::llm`]) and provides:
//!
//! - [`Pending`] / [`Ready`] / [`State`] — pure DM-assembly state
//!   machine (testable without projection).
//! - [`compose_reply`] — pure function from reply inputs to claim
//!   set.
//! - [`CommandersAidPort`] — [`Projection`] that wraps the above
//!   with a pluggable responder closure.
//!
//! Spawning `claude -p` + parsing its JSON output is subprocess-
//! binary work — outside the library.

use std::collections::HashMap;

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;

use crate::comms::{ADDRESSED_TO, MESSAGE, WAS_SAID_BY, WAS_UTTERED_AT};
use crate::conduit::HAS_BODY;
use crate::foundation::IS_A_TERM;
use crate::llm::HAS_LLM_SESSION;

// ─────────────────────────────────────────────────────────────────────
// Pure DM-assembly state machine
// ─────────────────────────────────────────────────────────────────────

/// A DM-in-assembly. The three carrier cells arrive independently
/// over the subscription stream; we dispatch once all three settle
/// for the same message subject.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Pending {
    /// True once `(msg, addressed-to, <agent-account>)` arrived with
    /// the agent as target.
    pub addressed: bool,
    /// Sender from `(msg, was-said-by, <sender>)`.
    pub sender: Option<String>,
    /// Prompt body from `(msg, has-body, <body>)`.
    pub body: Option<String>,
    /// True once this message has dispatched; prevents re-firing on
    /// late-arriving duplicate cells.
    pub dispatched: bool,
}

/// A complete DM ready for the responder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ready {
    /// Incoming message subject — for dedupe / audit.
    pub incoming_msg: String,
    /// Sender account (reply's addressed-to).
    pub sender: String,
    /// Full prompt body.
    pub body: String,
}

/// Per-message assembly state.
#[derive(Default, Debug)]
pub struct State {
    pending: HashMap<String, Pending>,
}

impl State {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Ingest one settled claim. Returns [`Ready`] exactly when all
    /// three carrier cells have arrived for a single message subject,
    /// and the message hasn't been dispatched yet. Subsequent calls
    /// on the same message return `None`.
    pub fn absorb(
        &mut self,
        agent_account: &str,
        subject: &str,
        predicate: &str,
        object: &str,
    ) -> Option<Ready> {
        if predicate == ADDRESSED_TO {
            if object != agent_account {
                return None;
            }
            let slot = self.pending.entry(subject.to_owned()).or_default();
            slot.addressed = true;
            return Self::try_ready(slot, subject);
        }
        if predicate == WAS_SAID_BY {
            let slot = self.pending.entry(subject.to_owned()).or_default();
            slot.sender.get_or_insert_with(|| object.to_owned());
            return Self::try_ready(slot, subject);
        }
        if predicate == HAS_BODY {
            let slot = self.pending.entry(subject.to_owned()).or_default();
            slot.body.get_or_insert_with(|| object.to_owned());
            return Self::try_ready(slot, subject);
        }
        None
    }

    fn try_ready(slot: &mut Pending, subject: &str) -> Option<Ready> {
        if slot.dispatched || !slot.addressed {
            return None;
        }
        let sender = slot.sender.as_ref()?.clone();
        let body = slot.body.as_ref()?.clone();
        slot.dispatched = true;
        Some(Ready {
            incoming_msg: subject.to_owned(),
            sender,
            body,
        })
    }
}

// ─────────────────────────────────────────────────────────────────────
// Pure reply composition
// ─────────────────────────────────────────────────────────────────────

/// Reply-composition inputs.
pub struct ReplyInputs<'a> {
    /// Agent's own account subject (the reply's `was-said-by`).
    pub agent_account: &'a str,
    /// Recipient account (the reply's `addressed-to`).
    pub sender: &'a str,
    /// Reply body text.
    pub body: &'a str,
    /// ISO-8601 timestamp for `was-uttered-at`.
    pub uttered_at: &'a str,
    /// Optional provider session id (audit trail).
    pub llm_session: Option<&'a str>,
    /// Monotonic id fragment for minting the reply subject.
    pub id: u64,
}

/// Build the reply-message claim set.
#[must_use]
pub fn compose_reply(inputs: &ReplyInputs<'_>) -> (String, Vec<Claim>) {
    let msg = format!("msg:caid-reply:{}", inputs.id);
    let mut out = vec![
        Claim::new(&msg, IS_A_TERM, MESSAGE),
        Claim::new(&msg, HAS_BODY, inputs.body),
        Claim::new(&msg, WAS_SAID_BY, inputs.agent_account),
        Claim::new(&msg, ADDRESSED_TO, inputs.sender),
        Claim::new(&msg, WAS_UTTERED_AT, inputs.uttered_at),
    ];
    if let Some(sid) = inputs.llm_session {
        out.push(Claim::new(&msg, HAS_LLM_SESSION, sid));
    }
    (msg, out)
}

// ─────────────────────────────────────────────────────────────────────
// Projection
// ─────────────────────────────────────────────────────────────────────

/// Responder closure signature.
///
/// Arguments: sender account, prompt body, prior LLM session id.
///
/// Returns `Some((reply-text, new-session-id))` on success, or
/// `None` to skip the reply (e.g., subprocess failed; the responder
/// logged and gave up).
pub type Responder =
    Box<dyn FnMut(&str, &str, Option<&str>) -> Option<(String, Option<String>)> + Send + Sync>;

/// Commanders-aid projection.
pub struct CommandersAidPort {
    agent_account: String,
    state: State,
    /// Cached LLM session id — set from the first successful reply,
    /// reused for subsequent calls so the provider sees a continuous
    /// conversation.
    llm_session: Option<String>,
    responder: Responder,
    next_id: u64,
    now_iso: fn() -> String,
}

fn default_now_iso() -> String {
    "1970-01-01T00:00:00Z".to_owned()
}

impl CommandersAidPort {
    /// Build with an explicit responder. The default clock is used.
    #[must_use]
    pub fn new(agent_account: impl Into<String>, responder: Responder) -> Self {
        Self {
            agent_account: agent_account.into(),
            state: State::new(),
            llm_session: None,
            responder,
            next_id: 1,
            now_iso: default_now_iso,
        }
    }

    /// Inject a custom clock.
    #[must_use]
    pub fn with_clock(mut self, now_iso: fn() -> String) -> Self {
        self.now_iso = now_iso;
        self
    }
}

impl Projection for CommandersAidPort {
    fn identity(&self) -> &str {
        "mash-library-commanders-aid"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            ADDRESSED_TO.to_owned(),
            WAS_SAID_BY.to_owned(),
            HAS_BODY.to_owned(),
        ]
    }

    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
        value: Value,
    ) -> Vec<Claim> {
        if value != Value::True {
            return Vec::new();
        }
        let Some(ready) = self.state.absorb(&self.agent_account, subject, predicate, object)
        else {
            return Vec::new();
        };

        // Call the responder with current session-id (if any).
        let prior = self.llm_session.as_deref();
        let Some((reply_text, new_session)) = (self.responder)(&ready.sender, &ready.body, prior)
        else {
            return Vec::new();
        };
        if let Some(sid) = &new_session {
            self.llm_session = Some(sid.clone());
        }

        let id = self.next_id;
        self.next_id += 1;
        let now = (self.now_iso)();
        let inputs = ReplyInputs {
            agent_account: &self.agent_account,
            sender: &ready.sender,
            body: &reply_text,
            uttered_at: &now,
            llm_session: new_session.as_deref(),
            id,
        };
        let (_, claims) = compose_reply(&inputs);
        claims
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_assembles_dm_when_all_three_arrive() {
        let mut st = State::new();
        assert!(st.absorb("caid", "msg-1", ADDRESSED_TO, "caid").is_none());
        assert!(st.absorb("caid", "msg-1", WAS_SAID_BY, "alice").is_none());
        let ready = st
            .absorb("caid", "msg-1", HAS_BODY, "hello")
            .expect("ready once all three arrive");
        assert_eq!(ready.sender, "alice");
        assert_eq!(ready.body, "hello");
    }

    #[test]
    fn state_ignores_dm_addressed_to_someone_else() {
        let mut st = State::new();
        assert!(st
            .absorb("caid", "msg-1", ADDRESSED_TO, "other-agent")
            .is_none());
        assert!(st.absorb("caid", "msg-1", WAS_SAID_BY, "alice").is_none());
        assert!(st.absorb("caid", "msg-1", HAS_BODY, "hi").is_none());
    }

    #[test]
    fn state_is_idempotent_per_message() {
        let mut st = State::new();
        let _ = st.absorb("caid", "msg-1", ADDRESSED_TO, "caid");
        let _ = st.absorb("caid", "msg-1", WAS_SAID_BY, "alice");
        let first = st.absorb("caid", "msg-1", HAS_BODY, "q");
        assert!(first.is_some());
        let again = st.absorb("caid", "msg-1", HAS_BODY, "different");
        assert!(again.is_none(), "re-firing on dispatched message");
    }

    #[test]
    fn compose_reply_emits_complete_message() {
        let inputs = ReplyInputs {
            agent_account: "caid",
            sender: "alice",
            body: "Hi there!",
            uttered_at: "2026-04-21T00:00:00Z",
            llm_session: Some("sid-001"),
            id: 1,
        };
        let (msg, claims) = compose_reply(&inputs);
        assert_eq!(msg, "msg:caid-reply:1");
        assert!(claims.iter().any(|c| c.predicate == HAS_BODY && c.object == "Hi there!"));
        assert!(claims.iter().any(|c| c.predicate == WAS_SAID_BY && c.object == "caid"));
        assert!(claims.iter().any(|c| c.predicate == ADDRESSED_TO && c.object == "alice"));
        assert!(claims.iter().any(|c| c.predicate == HAS_LLM_SESSION && c.object == "sid-001"));
    }

    #[test]
    fn compose_reply_skips_llm_session_when_none() {
        let inputs = ReplyInputs {
            agent_account: "caid",
            sender: "alice",
            body: "Hi",
            uttered_at: "ts",
            llm_session: None,
            id: 1,
        };
        let (_, claims) = compose_reply(&inputs);
        assert!(!claims.iter().any(|c| c.predicate == HAS_LLM_SESSION));
    }

    fn fixed_now() -> String {
        "2026-04-21T00:00:00Z".to_owned()
    }

    #[test]
    fn port_dispatches_and_replies_with_responder_output() {
        let responder: Responder =
            Box::new(|_sender, _body, _prior| Some(("echo reply".to_owned(), Some("sid-1".to_owned()))));
        let mut port = CommandersAidPort::new("caid", responder).with_clock(fixed_now);
        let _ = port.ingest("msg-1", ADDRESSED_TO, "caid", Value::True);
        let _ = port.ingest("msg-1", WAS_SAID_BY, "alice", Value::True);
        let out = port.ingest("msg-1", HAS_BODY, "hello", Value::True);
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object == "echo reply"));
        assert!(out
            .iter()
            .any(|c| c.predicate == ADDRESSED_TO && c.object == "alice"));
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_LLM_SESSION && c.object == "sid-1"));
    }

    #[test]
    fn port_reuses_llm_session_across_calls() {
        use std::sync::{Arc, Mutex};
        let seen_prior: Arc<Mutex<Vec<Option<String>>>> = Arc::new(Mutex::new(Vec::new()));
        let seen_prior_clone = seen_prior.clone();
        let responder: Responder = Box::new(move |_s, _b, prior| {
            seen_prior_clone
                .lock()
                .unwrap()
                .push(prior.map(ToOwned::to_owned));
            Some(("ok".to_owned(), Some("sid-persistent".to_owned())))
        });
        let mut port = CommandersAidPort::new("caid", responder).with_clock(fixed_now);
        // First DM.
        let _ = port.ingest("msg-1", ADDRESSED_TO, "caid", Value::True);
        let _ = port.ingest("msg-1", WAS_SAID_BY, "alice", Value::True);
        let _ = port.ingest("msg-1", HAS_BODY, "hi", Value::True);
        // Second DM.
        let _ = port.ingest("msg-2", ADDRESSED_TO, "caid", Value::True);
        let _ = port.ingest("msg-2", WAS_SAID_BY, "alice", Value::True);
        let _ = port.ingest("msg-2", HAS_BODY, "hi again", Value::True);

        let calls = seen_prior.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0], None); // first call: no prior session
        assert_eq!(calls[1], Some("sid-persistent".to_owned())); // second call: reuses
    }

    #[test]
    fn port_skips_reply_when_responder_returns_none() {
        let responder: Responder = Box::new(|_s, _b, _p| None);
        let mut port = CommandersAidPort::new("caid", responder).with_clock(fixed_now);
        let _ = port.ingest("msg-1", ADDRESSED_TO, "caid", Value::True);
        let _ = port.ingest("msg-1", WAS_SAID_BY, "alice", Value::True);
        let out = port.ingest("msg-1", HAS_BODY, "hi", Value::True);
        assert!(out.is_empty());
    }
}
