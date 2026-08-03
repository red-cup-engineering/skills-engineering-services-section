//! Resolver — turns `resolve-request` subjects into bindings on the
//! parent request.
//!
//! # What a resolver does
//!
//! When a parser sees a command invocation, it mints one
//! [`crate::command::RESOLVE_REQUEST`] subject per argument slot and
//! decorates it with:
//!
//! - [`crate::command::RESOLVES_FOR_REQUEST`] — parent request
//! - [`crate::command::HAS_POST_VERB_BODY`] — raw text after verb
//! - [`crate::command::AT_POSITION`] — slot index
//! - [`crate::command::RESOLVER_KIND`] — which resolver handles it
//! - [`crate::command::BINDS_TO`] — name the resolved value binds as
//!
//! Resolver ports subscribe to the above predicates, filter by
//! [`crate::command::RESOLVER_KIND`] matching the kind they handle,
//! and witness `(request, has-binding-<name>, value)` on the parent
//! request.
//!
//! # Shape of a resolver
//!
//! [`ResolverPort`] is a generic implementation parameterized by a
//! resolver-kind string and an extraction closure taking `(body,
//! position)` and returning `Option<String>`. Concrete resolvers wrap
//! this with their extraction logic.
//!
//! Two extractor closures cover the shipping roster
//! ([`crate::mud::verbs::RESOLVER_STRING_REST`] and
//! [`crate::mud::verbs::RESOLVER_LITERAL_STRING`]):
//!
//! - `extract_string_rest` — capture the entire body as one string
//! - `extract_literal_string_at_position` — split on whitespace and
//!   take the Nth token

use std::collections::{HashMap, HashSet};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;

use crate::command::{
    AT_POSITION, BINDS_TO, HAS_POST_VERB_BODY, RESOLVER_KIND, RESOLVES_FOR_REQUEST, RESOLVES_SLOT,
};

/// Pending accumulation state for one resolve-request subject.
#[derive(Default, Debug)]
struct Pending {
    request: Option<String>,
    body: Option<String>,
    position: Option<u32>,
    kind: Option<String>,
    binds_to: Option<String>,
}

impl Pending {
    fn complete(&self) -> Option<(&str, &str, u32, &str, &str)> {
        Some((
            self.request.as_deref()?,
            self.body.as_deref()?,
            self.position?,
            self.kind.as_deref()?,
            self.binds_to.as_deref()?,
        ))
    }
}

/// Type alias for the extractor closure a [`ResolverPort`] invokes.
///
/// Arguments: post-verb body text, slot position.
///
/// Returns the resolved string value, or `None` to leave the binding
/// absent (downstream sees missing binding).
pub type Extractor = Box<dyn Fn(&str, u32) -> Option<String> + Send + Sync>;

/// Generic resolver projection.
///
/// Parameterized by a resolver-kind string (the subject this port
/// handles; compared against [`RESOLVER_KIND`]) and an extractor
/// closure.
pub struct ResolverPort {
    identity: String,
    resolver_kind: String,
    extract: Extractor,
    pending: HashMap<String, Pending>,
    resolved: HashSet<String>,
}

impl ResolverPort {
    /// Construct a resolver for `resolver_kind` using `extract`.
    ///
    /// `identity` becomes the port's hub-announce name.
    #[must_use]
    pub fn new(
        identity: impl Into<String>,
        resolver_kind: impl Into<String>,
        extract: Extractor,
    ) -> Self {
        Self {
            identity: identity.into(),
            resolver_kind: resolver_kind.into(),
            extract,
            pending: HashMap::new(),
            resolved: HashSet::new(),
        }
    }

    /// Convenience constructor for a string-rest resolver: returns
    /// the entire body as the bound value.
    #[must_use]
    pub fn string_rest(identity: impl Into<String>, resolver_kind: impl Into<String>) -> Self {
        Self::new(
            identity,
            resolver_kind,
            Box::new(|body: &str, _pos: u32| {
                let trimmed = body.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_owned())
                }
            }),
        )
    }

    /// Convenience constructor for a literal-string resolver: splits
    /// on whitespace and returns the token at `position`.
    #[must_use]
    pub fn literal_string(
        identity: impl Into<String>,
        resolver_kind: impl Into<String>,
    ) -> Self {
        Self::new(
            identity,
            resolver_kind,
            Box::new(|body: &str, position: u32| {
                body.split_whitespace()
                    .nth(position as usize)
                    .map(ToOwned::to_owned)
            }),
        )
    }

    fn try_resolve(&mut self, subject: &str) -> Option<Claim> {
        let entry = self.pending.get(subject)?;
        // Only proceed if kind matches ours.
        if entry.kind.as_deref() != Some(self.resolver_kind.as_str()) {
            return None;
        }
        let (request, body, position, _, binds_to) = entry.complete()?;
        let value = (self.extract)(body, position)?;
        let predicate = format!("has-binding-{binds_to}");
        let claim = Claim::new(request, &predicate, &value);
        Some(claim)
    }
}

impl Projection for ResolverPort {
    fn identity(&self) -> &str {
        &self.identity
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            RESOLVES_FOR_REQUEST.to_owned(),
            HAS_POST_VERB_BODY.to_owned(),
            AT_POSITION.to_owned(),
            RESOLVER_KIND.to_owned(),
            BINDS_TO.to_owned(),
            RESOLVES_SLOT.to_owned(),
        ]
    }

    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
        value: Value,
    ) -> Vec<Claim> {
        if value != Value::True || self.resolved.contains(subject) {
            return Vec::new();
        }

        let entry = self.pending.entry(subject.to_owned()).or_default();
        if predicate == RESOLVES_FOR_REQUEST {
            entry.request = Some(object.to_owned());
        } else if predicate == HAS_POST_VERB_BODY {
            entry.body = Some(object.to_owned());
        } else if predicate == AT_POSITION {
            entry.position = object.parse::<u32>().ok();
        } else if predicate == RESOLVER_KIND {
            entry.kind = Some(object.to_owned());
        } else if predicate == BINDS_TO {
            entry.binds_to = Some(object.to_owned());
        } else {
            // RESOLVES_SLOT — the subject's existence signal; no
            // accumulation needed.
            return Vec::new();
        }

        if let Some(claim) = self.try_resolve(subject) {
            self.resolved.insert(subject.to_owned());
            self.pending.remove(subject);
            vec![claim]
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KIND: &str = "test:kind";

    fn decorate(
        port: &mut ResolverPort,
        subject: &str,
        request: &str,
        kind: &str,
        binds_to: &str,
        position: &str,
        body: &str,
    ) -> Vec<Claim> {
        let mut out = Vec::new();
        out.extend(port.ingest(subject, RESOLVES_FOR_REQUEST, request, Value::True));
        out.extend(port.ingest(subject, RESOLVER_KIND, kind, Value::True));
        out.extend(port.ingest(subject, BINDS_TO, binds_to, Value::True));
        out.extend(port.ingest(subject, AT_POSITION, position, Value::True));
        out.extend(port.ingest(subject, HAS_POST_VERB_BODY, body, Value::True));
        out
    }

    #[test]
    fn string_rest_captures_whole_body() {
        let mut port = ResolverPort::string_rest("test", KIND);
        let out = decorate(&mut port, "rr-1", "req-1", KIND, "body", "0", "hello world");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].subject, "req-1");
        assert_eq!(out[0].predicate, "has-binding-body");
        assert_eq!(out[0].object, "hello world");
    }

    #[test]
    fn literal_string_picks_nth_token() {
        let mut port = ResolverPort::literal_string("test", KIND);
        let out = decorate(&mut port, "rr-1", "req-1", KIND, "name", "1", "alice password");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].object, "password");
    }

    #[test]
    fn wrong_kind_is_silent() {
        let mut port = ResolverPort::string_rest("test", KIND);
        let out = decorate(
            &mut port,
            "rr-1",
            "req-1",
            "other:kind",
            "body",
            "0",
            "hello",
        );
        assert!(out.is_empty());
    }

    #[test]
    fn partial_accumulation_waits_for_all_fields() {
        let mut port = ResolverPort::string_rest("test", KIND);
        let out = port.ingest("rr-1", RESOLVES_FOR_REQUEST, "req-1", Value::True);
        assert!(out.is_empty());
        let out = port.ingest("rr-1", RESOLVER_KIND, KIND, Value::True);
        assert!(out.is_empty());
        let out = port.ingest("rr-1", BINDS_TO, "body", Value::True);
        assert!(out.is_empty());
        let out = port.ingest("rr-1", AT_POSITION, "0", Value::True);
        assert!(out.is_empty());
        // Body arrives last — resolution fires.
        let out = port.ingest("rr-1", HAS_POST_VERB_BODY, "final", Value::True);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].object, "final");
    }

    #[test]
    fn empty_body_leaves_binding_absent_for_string_rest() {
        let mut port = ResolverPort::string_rest("test", KIND);
        let out = decorate(&mut port, "rr-1", "req-1", KIND, "body", "0", "   ");
        assert!(
            out.is_empty(),
            "empty-after-trim body should leave binding absent"
        );
    }

    #[test]
    fn position_out_of_range_leaves_binding_absent() {
        let mut port = ResolverPort::literal_string("test", KIND);
        let out = decorate(&mut port, "rr-1", "req-1", KIND, "name", "5", "only two");
        assert!(out.is_empty());
    }

    #[test]
    fn non_true_values_ignored() {
        let mut port = ResolverPort::string_rest("test", KIND);
        let out = port.ingest("rr-1", RESOLVES_FOR_REQUEST, "req-1", Value::False);
        assert!(out.is_empty());
    }

    #[test]
    fn resolution_is_once_per_request() {
        let mut port = ResolverPort::string_rest("test", KIND);
        let first = decorate(&mut port, "rr-1", "req-1", KIND, "body", "0", "hi");
        assert_eq!(first.len(), 1);
        // Re-witness any field: should stay silent.
        let second = port.ingest("rr-1", HAS_POST_VERB_BODY, "different", Value::True);
        assert!(second.is_empty());
    }
}
