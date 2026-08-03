//! MUD parser — tokenizes session input into request + resolve-request
//! subjects per the [`crate::command`] vocabulary.
//!
//! # Substrate-driven, not hardcoded
//!
//! No verb roster lives in this port's code. On boot the parser
//! subscribes to [`crate::command::HAS_VERB_NAME`],
//! [`crate::command::HAS_ALIAS`], [`crate::command::HAS_ARG_PATTERN`],
//! [`crate::command::HAS_ARG_SLOT`], [`crate::command::AT_POSITION`],
//! [`crate::command::RESOLVES_VIA`], [`crate::command::BINDS_AS`],
//! and [`crate::space::SHORTENS_TO`] — and builds its lookup caches
//! incrementally as vocab claims arrive. Whichever commands are
//! mounted become callable; no roster edit required.
//!
//! # Input flow
//!
//! The parser consumes conduit-level surface-ready events. For each
//! session-scoped input line:
//!
//! 1. Tokenize: first whitespace-delimited word is the verb candidate;
//!    rest is the post-verb body.
//! 2. Lowercase and follow any `shortens-to` expansion (so `n` →
//!    `north`, `l` → `look`).
//! 3. Bare-direction shortcut: if the token is a direction and no rest
//!    follows, rewrite as `go <direction>`.
//! 4. Resolve the verb to a command subject (via verb-name or alias
//!    lookup).
//! 5. Mint a request subject and witness:
//!    - `(request, issued-by-session, session)`
//!    - `(request, invokes-command, command)`
//! 6. For each slot the command's pattern declares, mint a
//!    resolve-request subject and witness its decorations (see
//!    [`crate::command`]'s resolve-request predicates).
//!
//! # Welcome gating
//!
//! Input from not-yet-welcomed sessions buffers until the session's
//! [`crate::mud::session::WAS_WELCOMED_AT`] settles, then flushes.
//! Prevents verbs firing before the world has placed the player.
//!
//! # Self-speech filtering (not implemented in Projection form)
//!
//! The old port subscribed to `was-said-by` to distinguish player
//! input from agent emissions on the same channel. Under the
//! [`Projection`] trait's static-subscription model, the parser
//! instead relies on the body-cache-plus-surface-ready flow: it
//! treats each surface-ready event on a session as player input if
//! the subject's body is cached. Agent-emitted messages addressed
//! to the session don't travel through `has-body`/`is-surface-ready`
//! at the session subject; they use distinct channels. If a
//! deployment needs explicit speaker filtering, a rule-port
//! upstream can suppress the surface-ready emission for non-player
//! messages.

use std::collections::{BTreeMap, HashMap, HashSet};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;

use crate::command::{
    AT_POSITION, BINDS_AS, BINDS_TO, HAS_ALIAS, HAS_ARG_PATTERN, HAS_ARG_SLOT, HAS_POST_VERB_BODY,
    HAS_VERB_NAME, INVOKES_COMMAND, RESOLVER_KIND, RESOLVES_FOR_REQUEST, RESOLVES_SLOT,
    RESOLVES_VIA,
};
use crate::conduit::{HAS_BODY, IS_SURFACE_READY, ISSUED_BY_SESSION};
use crate::foundation::IS_A_TERM;
use crate::mud::session::WAS_WELCOMED_AT;
use crate::space::SHORTENS_TO;

/// Slot metadata assembled from vocabulary claims.
#[derive(Clone, Debug)]
struct Slot {
    subject: String,
    position: u32,
    resolver: String,
    binds_as: String,
}

/// MUD-parser projection state.
pub struct MudParserPort {
    /// Lowercased token → command subject. Populated from both
    /// [`HAS_VERB_NAME`] and [`HAS_ALIAS`].
    token_to_command: HashMap<String, String>,
    /// Command subject → pattern subject.
    command_patterns: HashMap<String, String>,
    /// Pattern subject → set of slot subjects.
    pattern_slots: HashMap<String, HashSet<String>>,
    slot_position: HashMap<String, u32>,
    slot_resolver: HashMap<String, String>,
    slot_binds_as: HashMap<String, String>,
    /// Short token → canonical long form, from `(long, shortens-to,
    /// short)` claims.
    direction_expansion: HashMap<String, String>,
    /// Set of canonical long-form direction subjects.
    known_directions: HashSet<String>,
    /// Per-message body cache; read at surface-ready time.
    bodies: HashMap<String, String>,
    /// Sessions whose WAS_WELCOMED_AT has settled.
    welcomed: HashSet<String>,
    /// Session → input lines buffered awaiting welcome.
    pending: HashMap<String, Vec<String>>,
    /// Monotonic counter for fresh subject minting (substitutes for
    /// a hub-connected nanosecond clock; tests get deterministic
    /// subjects).
    next_id: u64,
    /// Per-session-per-verb duplicate guard. Lets tests re-use the
    /// same body string without producing duplicate request subjects
    /// that collide in the substrate's knowledge-join.
    seen: HashSet<String>,
}

impl Default for MudParserPort {
    fn default() -> Self {
        Self::new()
    }
}

impl MudParserPort {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self {
            token_to_command: HashMap::new(),
            command_patterns: HashMap::new(),
            pattern_slots: HashMap::new(),
            slot_position: HashMap::new(),
            slot_resolver: HashMap::new(),
            slot_binds_as: HashMap::new(),
            direction_expansion: HashMap::new(),
            known_directions: HashSet::new(),
            bodies: HashMap::new(),
            welcomed: HashSet::new(),
            pending: HashMap::new(),
            next_id: 1,
            seen: HashSet::new(),
        }
    }

    /// Lookup a command subject by a verb or alias token. Used for
    /// testing the accumulator shape.
    #[must_use]
    pub fn command_for(&self, token: &str) -> Option<&str> {
        self.token_to_command
            .get(&token.to_ascii_lowercase())
            .map(String::as_str)
    }

    fn resolve_token(&self, token: &str) -> String {
        let lower = token.to_ascii_lowercase();
        self.direction_expansion
            .get(&lower)
            .cloned()
            .unwrap_or(lower)
    }

    fn ordered_slots(&self, pattern: &str) -> Vec<Slot> {
        let Some(subjects) = self.pattern_slots.get(pattern) else {
            return Vec::new();
        };
        // BTreeMap over subjects keeps emission stable for tests.
        let sorted: BTreeMap<&String, &String> = subjects.iter().map(|s| (s, s)).collect();
        let mut slots: Vec<Slot> = sorted
            .into_iter()
            .filter_map(|(s, _)| {
                Some(Slot {
                    subject: s.clone(),
                    position: *self.slot_position.get(s)?,
                    resolver: self.slot_resolver.get(s)?.clone(),
                    binds_as: self.slot_binds_as.get(s)?.clone(),
                })
            })
            .collect();
        slots.sort_by_key(|s| s.position);
        slots
    }

    fn mint_id(&mut self) -> u64 {
        let n = self.next_id;
        self.next_id += 1;
        n
    }

    fn parse_line(&mut self, session: &str, line: &str) -> Vec<Claim> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }
        let (head, rest) = trimmed
            .split_once(char::is_whitespace)
            .map_or((trimmed, ""), |(a, b)| (a, b.trim()));
        let head_resolved = self.resolve_token(head);

        let (verb, post_verb) = if rest.is_empty() && self.known_directions.contains(&head_resolved)
        {
            // Bare-direction shortcut: rewrite as `go <direction>`.
            ("go".to_owned(), head_resolved)
        } else {
            (head_resolved, rest.to_owned())
        };

        let Some(command) = self.token_to_command.get(&verb).cloned() else {
            return Vec::new();
        };

        // Deduplicate: (session, body-hash) fingerprint.
        let fingerprint = format!("{session}|{trimmed}");
        if self.seen.contains(&fingerprint) {
            return Vec::new();
        }
        self.seen.insert(fingerprint);

        let id = self.mint_id();
        let request = format!("request:{session}:{id}");

        let mut out = vec![
            Claim::new(&request, ISSUED_BY_SESSION, session),
            Claim::new(&request, INVOKES_COMMAND, &command),
        ];

        if let Some(pattern) = self.command_patterns.get(&command).cloned() {
            for slot in self.ordered_slots(&pattern) {
                let resolve = format!("resolve:{request}:{}", slot.binds_as);
                out.push(Claim::new(&resolve, IS_A_TERM, "resolve-request"));
                out.push(Claim::new(&resolve, RESOLVES_FOR_REQUEST, &request));
                out.push(Claim::new(&resolve, RESOLVES_SLOT, &slot.subject));
                out.push(Claim::new(&resolve, HAS_POST_VERB_BODY, &post_verb));
                out.push(Claim::new(
                    &resolve,
                    AT_POSITION,
                    &slot.position.to_string(),
                ));
                out.push(Claim::new(&resolve, RESOLVER_KIND, &slot.resolver));
                out.push(Claim::new(&resolve, BINDS_TO, &slot.binds_as));
            }
        }
        out
    }
}

impl Projection for MudParserPort {
    fn identity(&self) -> &str {
        "mash-library-mud-parser"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            // Input stream.
            IS_SURFACE_READY.to_owned(),
            HAS_BODY.to_owned(),
            WAS_WELCOMED_AT.to_owned(),
            // Direction vocab.
            SHORTENS_TO.to_owned(),
            // Command vocab.
            HAS_VERB_NAME.to_owned(),
            HAS_ALIAS.to_owned(),
            HAS_ARG_PATTERN.to_owned(),
            HAS_ARG_SLOT.to_owned(),
            AT_POSITION.to_owned(),
            RESOLVES_VIA.to_owned(),
            BINDS_AS.to_owned(),
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
        if predicate == HAS_VERB_NAME || predicate == HAS_ALIAS {
            self.token_to_command
                .insert(object.to_ascii_lowercase(), subject.to_owned());
            return Vec::new();
        }
        if predicate == HAS_ARG_PATTERN {
            self.command_patterns
                .insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == HAS_ARG_SLOT {
            self.pattern_slots
                .entry(subject.to_owned())
                .or_default()
                .insert(object.to_owned());
            return Vec::new();
        }
        if predicate == AT_POSITION {
            if let Ok(p) = object.parse::<u32>() {
                self.slot_position.insert(subject.to_owned(), p);
            }
            return Vec::new();
        }
        if predicate == RESOLVES_VIA {
            self.slot_resolver
                .insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == BINDS_AS {
            self.slot_binds_as
                .insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == SHORTENS_TO {
            // `(long, shortens-to, short)` — long subject expands
            // from short object.
            self.direction_expansion
                .insert(object.to_owned(), subject.to_owned());
            self.known_directions.insert(subject.to_owned());
            return Vec::new();
        }
        if predicate == HAS_BODY {
            self.bodies.insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == WAS_WELCOMED_AT {
            self.welcomed.insert(subject.to_owned());
            // Flush any pending input for this session.
            let pending = self.pending.remove(subject).unwrap_or_default();
            let mut out = Vec::new();
            for line in pending {
                out.extend(self.parse_line(subject, &line));
            }
            return out;
        }
        if predicate == IS_SURFACE_READY {
            // Object is the channel (a session, by convention). Body
            // lives at (subject, has-body, _) — we look it up here.
            let channel = object;
            let Some(body) = self.bodies.get(subject).cloned() else {
                return Vec::new();
            };
            if !self.welcomed.contains(channel) {
                self.pending
                    .entry(channel.to_owned())
                    .or_default()
                    .push(body);
                return Vec::new();
            }
            return self.parse_line(channel, &body);
        }
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mud::verbs::{COMMAND_LOOK, COMMAND_QUIT, HAS_BINDING_TARGET};

    fn mount_vocab(port: &mut MudParserPort) {
        // Minimal command vocab: "look" verb + "l" alias, pattern with
        // one string-rest slot that binds "target".
        let _ = port.ingest(COMMAND_LOOK, HAS_VERB_NAME, "look", Value::True);
        let _ = port.ingest(COMMAND_LOOK, HAS_ALIAS, "l", Value::True);
        let _ = port.ingest(COMMAND_LOOK, HAS_ARG_PATTERN, "pattern:look", Value::True);
        let _ = port.ingest("pattern:look", HAS_ARG_SLOT, "slot:look:target", Value::True);
        let _ = port.ingest("slot:look:target", AT_POSITION, "0", Value::True);
        let _ = port.ingest(
            "slot:look:target",
            RESOLVES_VIA,
            "resolver:string-rest",
            Value::True,
        );
        let _ = port.ingest("slot:look:target", BINDS_AS, "target", Value::True);
        // Quit: no pattern.
        let _ = port.ingest(COMMAND_QUIT, HAS_VERB_NAME, "quit", Value::True);
    }

    fn mount_directions(port: &mut MudParserPort) {
        let _ = port.ingest("direction:north", SHORTENS_TO, "n", Value::True);
        let _ = port.ingest("direction:east", SHORTENS_TO, "e", Value::True);
        // Register `go` as a command.
        let _ = port.ingest("command:go", HAS_VERB_NAME, "go", Value::True);
    }

    fn welcome(port: &mut MudParserPort, session: &str) {
        let _ = port.ingest(session, WAS_WELCOMED_AT, "event:x", Value::True);
    }

    fn deliver(port: &mut MudParserPort, msg: &str, channel: &str, body: &str) -> Vec<Claim> {
        let _ = port.ingest(msg, HAS_BODY, body, Value::True);
        port.ingest(msg, IS_SURFACE_READY, channel, Value::True)
    }

    #[test]
    fn verb_name_resolves_command() {
        let mut port = MudParserPort::new();
        mount_vocab(&mut port);
        assert_eq!(port.command_for("look"), Some(COMMAND_LOOK));
        assert_eq!(port.command_for("LOOK"), Some(COMMAND_LOOK));
    }

    #[test]
    fn alias_resolves_to_same_command() {
        let mut port = MudParserPort::new();
        mount_vocab(&mut port);
        assert_eq!(port.command_for("l"), Some(COMMAND_LOOK));
    }

    #[test]
    fn parser_emits_request_and_resolve_request() {
        let mut port = MudParserPort::new();
        mount_vocab(&mut port);
        welcome(&mut port, "session:1");
        let out = deliver(&mut port, "msg:1", "session:1", "look rock");
        assert!(out
            .iter()
            .any(|c| c.predicate == INVOKES_COMMAND && c.object == COMMAND_LOOK));
        assert!(out.iter().any(|c| c.predicate == ISSUED_BY_SESSION));
        assert!(out.iter().any(|c| c.predicate == HAS_POST_VERB_BODY && c.object == "rock"));
        assert!(out.iter().any(|c| c.predicate == BINDS_TO && c.object == "target"));
        assert!(out
            .iter()
            .any(|c| c.predicate == RESOLVER_KIND && c.object == "resolver:string-rest"));
    }

    #[test]
    fn niladic_verb_has_no_resolve_request() {
        let mut port = MudParserPort::new();
        mount_vocab(&mut port);
        welcome(&mut port, "session:1");
        let out = deliver(&mut port, "msg:1", "session:1", "quit");
        assert!(out
            .iter()
            .any(|c| c.predicate == INVOKES_COMMAND && c.object == COMMAND_QUIT));
        assert!(
            !out.iter().any(|c| c.predicate == RESOLVES_FOR_REQUEST),
            "quit has no pattern; no resolve-request should be minted"
        );
    }

    #[test]
    fn input_buffers_until_welcome_then_flushes() {
        let mut port = MudParserPort::new();
        mount_vocab(&mut port);
        // Input before welcome.
        let early = deliver(&mut port, "msg:1", "session:1", "look");
        assert!(early.is_empty(), "pre-welcome input must buffer");
        // Welcome triggers flush.
        let on_welcome = port.ingest("session:1", WAS_WELCOMED_AT, "event:x", Value::True);
        assert!(
            on_welcome
                .iter()
                .any(|c| c.predicate == INVOKES_COMMAND && c.object == COMMAND_LOOK),
            "welcome must flush buffered input"
        );
    }

    #[test]
    fn bare_direction_rewrites_as_go() {
        let mut port = MudParserPort::new();
        mount_vocab(&mut port);
        mount_directions(&mut port);
        welcome(&mut port, "session:1");
        let out = deliver(&mut port, "msg:1", "session:1", "n");
        assert!(
            out.iter()
                .any(|c| c.predicate == INVOKES_COMMAND && c.object == "command:go"),
            "bare `n` should invoke `go`"
        );
    }

    #[test]
    fn unknown_verb_emits_nothing() {
        let mut port = MudParserPort::new();
        mount_vocab(&mut port);
        welcome(&mut port, "session:1");
        let out = deliver(&mut port, "msg:1", "session:1", "flerb arg");
        assert!(out.is_empty());
    }

    #[test]
    fn duplicate_input_is_idempotent() {
        let mut port = MudParserPort::new();
        mount_vocab(&mut port);
        welcome(&mut port, "session:1");
        let first = deliver(&mut port, "msg:1", "session:1", "look");
        assert!(!first.is_empty());
        let again = deliver(&mut port, "msg:2", "session:1", "look");
        assert!(
            again.is_empty(),
            "same session + same body should not re-mint a request"
        );
    }

    #[test]
    fn multi_session_independence() {
        let mut port = MudParserPort::new();
        mount_vocab(&mut port);
        welcome(&mut port, "session:1");
        welcome(&mut port, "session:2");
        let a = deliver(&mut port, "msg:1", "session:1", "look");
        let b = deliver(&mut port, "msg:2", "session:2", "look");
        assert!(!a.is_empty());
        assert!(
            !b.is_empty(),
            "different session: same body should still parse"
        );
    }

    // Binding-target import proves cross-module use compiles.
    #[test]
    fn has_binding_target_available() {
        assert_eq!(HAS_BINDING_TARGET, "has-binding-target");
    }
}
