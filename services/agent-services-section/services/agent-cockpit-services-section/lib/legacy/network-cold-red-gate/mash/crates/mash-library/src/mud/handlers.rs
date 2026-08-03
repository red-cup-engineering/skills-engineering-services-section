//! MUD command handlers — quit, look, say, help, who.
//!
//! Each handler is a [`Projection`] that subscribes to
//! [`crate::command::INVOKES_COMMAND`] (filtered by its specific
//! command subject) plus the context it needs (session resolution,
//! slot bindings), and emits the per-command effect when triggered.
//!
//! # Why INVOKES_COMMAND, not IS_AUTHORIZED_FOR
//!
//! Production deployments should gate handlers on
//! [`crate::command::IS_AUTHORIZED_FOR`] once all three rule-ports
//! (environment / capability / state) are wired. The gate derives
//! from a fusion chain declared in [`crate::command`]; the rule-
//! ports that emit the premises are scene-level concerns and not
//! yet shipped as library ports.
//!
//! For now, handlers trigger on INVOKES_COMMAND directly. A scene
//! that wants authorization gating can add its own rule-ports and
//! wrap these handlers with a pre-filter, or swap [`Projection`]
//! subscriptions to IS_AUTHORIZED_FOR when the fusion-chain outputs
//! are available.
//!
//! # Shape
//!
//! Each handler emits *claims*, not side effects. `quit` witnesses
//! `(session, ended-at, iso)`; `say` mints a message and sets it
//! surface-ready on the session's channel; `look` mints a perception;
//! `help`/`who` mint renderings directly into the session's render
//! fiber. Socket writes are a conduit-binary concern downstream.

use std::collections::HashMap;

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;

use crate::command::INVOKES_COMMAND;
use crate::conduit::{HAS_BODY, ISSUED_BY_SESSION, IS_SURFACE_READY, WAS_SAID_IN};
use crate::foundation::IS_A_TERM;
use crate::mud::verbs::{
    COMMAND_HELP, COMMAND_LOOK, COMMAND_QUIT, COMMAND_SAY, COMMAND_WHO, HAS_BINDING_BODY,
    HAS_BINDING_TARGET,
};
use crate::perception::{LOOKS_AT, PERCEPTION, PERCEIVER_IS, REPORTS_TO};
use crate::presence::{ENDED_AT, HAS_SESSION_RENDER};

// ─────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────

/// Handler state common to every command: request → session mapping,
/// trigger tracking, monotonic id generator, clock.
pub struct HandlerCommon {
    request_session: HashMap<String, String>,
    triggered: std::collections::HashSet<String>,
    next_id: u64,
    now_iso: fn() -> String,
}

impl Default for HandlerCommon {
    fn default() -> Self {
        Self {
            request_session: HashMap::new(),
            triggered: std::collections::HashSet::new(),
            next_id: 1,
            now_iso: default_now_iso,
        }
    }
}

fn default_now_iso() -> String {
    "1970-01-01T00:00:00Z".to_owned()
}

impl HandlerCommon {
    /// Fresh state with default clock.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Fresh state with injectable clock.
    #[must_use]
    pub fn with_clock(now_iso: fn() -> String) -> Self {
        Self {
            request_session: HashMap::new(),
            triggered: std::collections::HashSet::new(),
            next_id: 1,
            now_iso,
        }
    }

    fn mint_id(&mut self) -> u64 {
        let n = self.next_id;
        self.next_id += 1;
        n
    }

    fn cache_session(&mut self, subject: &str, object: &str) {
        self.request_session
            .insert(subject.to_owned(), object.to_owned());
    }

    fn session_for(&self, request: &str) -> Option<&str> {
        self.request_session.get(request).map(String::as_str)
    }

    fn mark_triggered(&mut self, request: &str) -> bool {
        self.triggered.insert(request.to_owned())
    }
}

/// Mint a message-subject + witness it as said on the session's
/// channel with the given body. Returns the claim set.
fn compose_say(agent_identity: &str, session: &str, body: &str, id: u64) -> Vec<Claim> {
    let msg = format!("msg:{agent_identity}:{id}");
    vec![
        Claim::new(&msg, WAS_SAID_IN, session),
        Claim::new(&msg, HAS_BODY, body),
        Claim::new(&msg, IS_SURFACE_READY, session),
    ]
}

// ─────────────────────────────────────────────────────────────────────
// Quit
// ─────────────────────────────────────────────────────────────────────

/// Handler for [`COMMAND_QUIT`]. On trigger: says "Goodbye." and
/// witnesses `(session, ended-at, iso)`. The telnet/stdio conduit
/// subprocess observes `ended-at` to close sockets; this handler
/// knows nothing about I/O.
pub struct QuitPort {
    common: HandlerCommon,
}

impl Default for QuitPort {
    fn default() -> Self {
        Self::new()
    }
}

impl QuitPort {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self {
            common: HandlerCommon::new(),
        }
    }

    /// With a custom clock — deterministic tests.
    #[must_use]
    pub fn with_clock(now_iso: fn() -> String) -> Self {
        Self {
            common: HandlerCommon::with_clock(now_iso),
        }
    }
}

impl Projection for QuitPort {
    fn identity(&self) -> &str {
        "mash-library-quit-handler"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![ISSUED_BY_SESSION.to_owned(), INVOKES_COMMAND.to_owned()]
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
        if predicate == ISSUED_BY_SESSION {
            self.common.cache_session(subject, object);
            return Vec::new();
        }
        if predicate == INVOKES_COMMAND && object == COMMAND_QUIT {
            if !self.common.mark_triggered(subject) {
                return Vec::new();
            }
            let Some(session) = self.common.session_for(subject).map(ToOwned::to_owned) else {
                return Vec::new();
            };
            let id = self.common.mint_id();
            let now = (self.common.now_iso)();
            let mut out = compose_say("quit-agent", &session, "Goodbye.", id);
            out.push(Claim::new(&session, ENDED_AT, &now));
            return out;
        }
        Vec::new()
    }
}

// ─────────────────────────────────────────────────────────────────────
// Look
// ─────────────────────────────────────────────────────────────────────

/// Handler for [`COMMAND_LOOK`]. On trigger: mints a perception
/// subject carrying `looks-at` + `perceiver-is` + `reports-to`. A
/// perception-effector (see [`crate::perception_effector`])
/// subscribes and composes the rendering.
///
/// If the request has no target binding, the perception's
/// `looks-at` object is the session's current location (from
/// [`crate::container::CONTAINS`] fiber scan) — deferred to the
/// perception-effector to resolve. This handler just witnesses
/// intent.
///
/// # Late-binding handling
///
/// The parser emits `(request, invokes-command, look)` alongside
/// the resolve-request claims that drive the resolver port. Event
/// ordering means INVOKES_COMMAND typically fires before the
/// resolver's `has-binding-target` emission arrives. To avoid
/// minting a perception with no looks-at when a binding is in
/// flight, this handler tracks each minted perception and emits a
/// `(perception, looks-at, target)` claim if the binding arrives
/// late.
pub struct LookPort {
    common: HandlerCommon,
    target_for_request: HashMap<String, String>,
    perception_for_request: HashMap<String, String>,
}

impl Default for LookPort {
    fn default() -> Self {
        Self::new()
    }
}

impl LookPort {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self {
            common: HandlerCommon::new(),
            target_for_request: HashMap::new(),
            perception_for_request: HashMap::new(),
        }
    }
}

impl Projection for LookPort {
    fn identity(&self) -> &str {
        "mash-library-look-handler"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            ISSUED_BY_SESSION.to_owned(),
            INVOKES_COMMAND.to_owned(),
            HAS_BINDING_TARGET.to_owned(),
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
        if predicate == ISSUED_BY_SESSION {
            self.common.cache_session(subject, object);
            return Vec::new();
        }
        if predicate == HAS_BINDING_TARGET {
            self.target_for_request
                .insert(subject.to_owned(), object.to_owned());
            // Late-binding: if the perception was already minted for
            // this request, emit LOOKS_AT now.
            if let Some(perception) = self.perception_for_request.get(subject).cloned() {
                return vec![Claim::new(&perception, LOOKS_AT, object)];
            }
            return Vec::new();
        }
        if predicate == INVOKES_COMMAND && object == COMMAND_LOOK {
            if !self.common.mark_triggered(subject) {
                return Vec::new();
            }
            let Some(session) = self.common.session_for(subject).map(ToOwned::to_owned) else {
                return Vec::new();
            };
            let id = self.common.mint_id();
            let perception = format!("perception:{session}:{id}");
            self.perception_for_request
                .insert(subject.to_owned(), perception.clone());
            let mut out = vec![
                Claim::new(&perception, IS_A_TERM, PERCEPTION),
                Claim::new(&perception, PERCEIVER_IS, &session),
                Claim::new(&perception, REPORTS_TO, &session),
            ];
            // If a target binding already arrived, record it.
            if let Some(target) = self.target_for_request.get(subject) {
                out.push(Claim::new(&perception, LOOKS_AT, target));
            }
            return out;
        }
        Vec::new()
    }
}

// ─────────────────────────────────────────────────────────────────────
// Say
// ─────────────────────────────────────────────────────────────────────

/// Handler for [`COMMAND_SAY`]. On trigger: mints a message with the
/// bound body and sets it surface-ready on the broadcast channel.
///
/// The broadcast channel here is a configured subject (default
/// `"channel:global"`). Scenes that want room-scoped speech swap
/// this channel or wrap the port.
pub struct SayPort {
    common: HandlerCommon,
    body_for_request: HashMap<String, String>,
    channel: String,
}

impl Default for SayPort {
    fn default() -> Self {
        Self::new()
    }
}

impl SayPort {
    /// Fresh state with default channel `"channel:global"`.
    #[must_use]
    pub fn new() -> Self {
        Self::with_channel("channel:global")
    }

    /// Fresh state with a specific broadcast channel.
    #[must_use]
    pub fn with_channel(channel: impl Into<String>) -> Self {
        Self {
            common: HandlerCommon::new(),
            body_for_request: HashMap::new(),
            channel: channel.into(),
        }
    }
}

impl Projection for SayPort {
    fn identity(&self) -> &str {
        "mash-library-say-handler"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            ISSUED_BY_SESSION.to_owned(),
            INVOKES_COMMAND.to_owned(),
            HAS_BINDING_BODY.to_owned(),
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
        if predicate == ISSUED_BY_SESSION {
            self.common.cache_session(subject, object);
            return Vec::new();
        }
        if predicate == HAS_BINDING_BODY {
            self.body_for_request
                .insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == INVOKES_COMMAND && object == COMMAND_SAY {
            if !self.common.mark_triggered(subject) {
                return Vec::new();
            }
            let Some(_session) = self.common.session_for(subject).map(ToOwned::to_owned) else {
                return Vec::new();
            };
            let Some(body) = self.body_for_request.get(subject).cloned() else {
                return Vec::new();
            };
            let id = self.common.mint_id();
            return compose_say("say-agent", &self.channel, &body, id);
        }
        Vec::new()
    }
}

// ─────────────────────────────────────────────────────────────────────
// Help
// ─────────────────────────────────────────────────────────────────────

/// Handler for [`COMMAND_HELP`]. On trigger: emits a
/// `has-session-render` with a help string.
///
/// The help text is a configured string (default simple listing).
/// Real deployments inject a composer that walks
/// [`crate::command::HAS_AVAILABLE_COMMAND`] and
/// [`crate::command::HAS_USAGE`] for the invoking session.
pub struct HelpPort {
    common: HandlerCommon,
    help_text: String,
}

impl Default for HelpPort {
    fn default() -> Self {
        Self::new()
    }
}

impl HelpPort {
    /// Fresh state with default help text.
    #[must_use]
    pub fn new() -> Self {
        Self::with_text("Available commands: look, go, quit, help, who, say.")
    }

    /// Fresh state with injected help text.
    #[must_use]
    pub fn with_text(text: impl Into<String>) -> Self {
        Self {
            common: HandlerCommon::new(),
            help_text: text.into(),
        }
    }
}

impl Projection for HelpPort {
    fn identity(&self) -> &str {
        "mash-library-help-handler"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![ISSUED_BY_SESSION.to_owned(), INVOKES_COMMAND.to_owned()]
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
        if predicate == ISSUED_BY_SESSION {
            self.common.cache_session(subject, object);
            return Vec::new();
        }
        if predicate == INVOKES_COMMAND && object == COMMAND_HELP {
            if !self.common.mark_triggered(subject) {
                return Vec::new();
            }
            let Some(session) = self.common.session_for(subject).map(ToOwned::to_owned) else {
                return Vec::new();
            };
            return vec![Claim::new(&session, HAS_SESSION_RENDER, &self.help_text)];
        }
        Vec::new()
    }
}

// ─────────────────────────────────────────────────────────────────────
// Who
// ─────────────────────────────────────────────────────────────────────

/// Handler for [`COMMAND_WHO`]. On trigger: emits a
/// `has-session-render` with the list of currently-present sessions.
///
/// Tracks presence by watching [`crate::presence::IS_NEWLY_CONNECTED`]
/// (adds) and [`crate::presence::ENDED_AT`] (removes). Reports
/// session subject identifiers verbatim — a deployment that wants
/// account names can wrap this port.
pub struct WhoPort {
    common: HandlerCommon,
    present: std::collections::BTreeSet<String>,
}

impl Default for WhoPort {
    fn default() -> Self {
        Self::new()
    }
}

impl WhoPort {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self {
            common: HandlerCommon::new(),
            present: std::collections::BTreeSet::new(),
        }
    }
}

impl Projection for WhoPort {
    fn identity(&self) -> &str {
        "mash-library-who-handler"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            ISSUED_BY_SESSION.to_owned(),
            INVOKES_COMMAND.to_owned(),
            crate::presence::IS_NEWLY_CONNECTED.to_owned(),
            crate::presence::ENDED_AT.to_owned(),
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
        if predicate == ISSUED_BY_SESSION {
            self.common.cache_session(subject, object);
            return Vec::new();
        }
        if predicate == crate::presence::IS_NEWLY_CONNECTED {
            self.present.insert(subject.to_owned());
            return Vec::new();
        }
        if predicate == crate::presence::ENDED_AT {
            self.present.remove(subject);
            return Vec::new();
        }
        if predicate == INVOKES_COMMAND && object == COMMAND_WHO {
            if !self.common.mark_triggered(subject) {
                return Vec::new();
            }
            let Some(session) = self.common.session_for(subject).map(ToOwned::to_owned) else {
                return Vec::new();
            };
            let rendered = if self.present.is_empty() {
                "No one is connected.".to_owned()
            } else {
                let list: Vec<String> = self.present.iter().cloned().collect();
                format!("Connected ({}): {}", list.len(), list.join(", "))
            };
            return vec![Claim::new(&session, HAS_SESSION_RENDER, &rendered)];
        }
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_now() -> String {
        "2026-04-21T00:00:00Z".to_owned()
    }

    #[test]
    fn quit_emits_goodbye_and_ended_at() {
        let mut port = QuitPort::with_clock(fixed_now);
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_QUIT, Value::True);
        assert!(out.iter().any(|c| c.predicate == HAS_BODY && c.object == "Goodbye."));
        assert!(out.iter().any(|c| c.subject == "session:1"
            && c.predicate == ENDED_AT
            && c.object == "2026-04-21T00:00:00Z"));
    }

    #[test]
    fn quit_is_idempotent_per_request() {
        let mut port = QuitPort::with_clock(fixed_now);
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let first = port.ingest("req-1", INVOKES_COMMAND, COMMAND_QUIT, Value::True);
        assert!(!first.is_empty());
        let again = port.ingest("req-1", INVOKES_COMMAND, COMMAND_QUIT, Value::True);
        assert!(again.is_empty());
    }

    #[test]
    fn quit_ignores_other_commands() {
        let mut port = QuitPort::with_clock(fixed_now);
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_LOOK, Value::True);
        assert!(out.is_empty());
    }

    #[test]
    fn look_mints_perception_with_intent_pair() {
        let mut port = LookPort::new();
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_LOOK, Value::True);
        assert!(out.iter().any(|c| c.predicate == IS_A_TERM && c.object == PERCEPTION));
        assert!(out.iter().any(|c| c.predicate == PERCEIVER_IS && c.object == "session:1"));
        assert!(out.iter().any(|c| c.predicate == REPORTS_TO && c.object == "session:1"));
    }

    #[test]
    fn look_with_target_binding_records_looks_at() {
        let mut port = LookPort::new();
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let _ = port.ingest("req-1", HAS_BINDING_TARGET, "rock-7", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_LOOK, Value::True);
        assert!(out.iter().any(|c| c.predicate == LOOKS_AT && c.object == "rock-7"));
    }

    #[test]
    fn look_without_target_skips_looks_at() {
        let mut port = LookPort::new();
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_LOOK, Value::True);
        assert!(!out.iter().any(|c| c.predicate == LOOKS_AT));
    }

    #[test]
    fn say_emits_on_global_channel() {
        let mut port = SayPort::new();
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let _ = port.ingest("req-1", HAS_BINDING_BODY, "hello world", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_SAY, Value::True);
        assert!(out.iter().any(|c| c.predicate == WAS_SAID_IN && c.object == "channel:global"));
        assert!(out.iter().any(|c| c.predicate == HAS_BODY && c.object == "hello world"));
        assert!(out.iter().any(|c| c.predicate == IS_SURFACE_READY && c.object == "channel:global"));
    }

    #[test]
    fn say_with_custom_channel() {
        let mut port = SayPort::with_channel("channel:room-a");
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let _ = port.ingest("req-1", HAS_BINDING_BODY, "hi", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_SAY, Value::True);
        assert!(out.iter().any(|c| c.predicate == WAS_SAID_IN && c.object == "channel:room-a"));
    }

    #[test]
    fn say_without_body_emits_nothing() {
        let mut port = SayPort::new();
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        // No HAS_BINDING_BODY.
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_SAY, Value::True);
        assert!(out.is_empty());
    }

    #[test]
    fn help_renders_text_to_session() {
        let mut port = HelpPort::with_text("help me");
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_HELP, Value::True);
        assert!(out.iter().any(|c| c.subject == "session:1"
            && c.predicate == HAS_SESSION_RENDER
            && c.object == "help me"));
    }

    #[test]
    fn who_reports_empty_when_no_connections() {
        let mut port = WhoPort::new();
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_WHO, Value::True);
        assert!(
            out.iter().any(|c| c.predicate == HAS_SESSION_RENDER
                && c.object == "No one is connected.")
        );
    }

    #[test]
    fn who_counts_connected_sessions() {
        let mut port = WhoPort::new();
        let _ = port.ingest(
            "session:a",
            crate::presence::IS_NEWLY_CONNECTED,
            "session:a",
            Value::True,
        );
        let _ = port.ingest(
            "session:b",
            crate::presence::IS_NEWLY_CONNECTED,
            "session:b",
            Value::True,
        );
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:a", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_WHO, Value::True);
        let rendered = &out
            .iter()
            .find(|c| c.predicate == HAS_SESSION_RENDER)
            .expect("who should render")
            .object;
        assert!(rendered.starts_with("Connected (2):"));
        assert!(rendered.contains("session:a"));
        assert!(rendered.contains("session:b"));
    }

    #[test]
    fn who_removes_ended_sessions() {
        let mut port = WhoPort::new();
        let _ = port.ingest(
            "session:a",
            crate::presence::IS_NEWLY_CONNECTED,
            "session:a",
            Value::True,
        );
        let _ = port.ingest(
            "session:b",
            crate::presence::IS_NEWLY_CONNECTED,
            "session:b",
            Value::True,
        );
        let _ = port.ingest("session:b", ENDED_AT, "2026-04-21T01:00:00Z", Value::True);
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:a", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_WHO, Value::True);
        let rendered = &out
            .iter()
            .find(|c| c.predicate == HAS_SESSION_RENDER)
            .expect("who should render")
            .object;
        assert!(rendered.starts_with("Connected (1):"));
        assert!(!rendered.contains("session:b"));
    }
}
