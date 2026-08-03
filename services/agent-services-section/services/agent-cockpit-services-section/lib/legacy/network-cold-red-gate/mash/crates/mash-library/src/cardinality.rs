//! Cardinality projection — the first port-level implementation.
//!
//! Subscribes to `CONTAINS`, tracks per-container membership sets, and
//! emits `HAS_CARDINALITY` / `IS_EMPTY` claims as membership changes.
//! This closes the loop for the predicates declared in
//! [`crate::container`] but not wired to anything until now.
//!
//! # Stateful projection
//!
//! Unlike the owner-agents in other modules (which emit a static claim
//! set at boot), this is a [`Projection`] — a stateful observer that
//! runs for the hub's lifetime, maintaining per-subject membership
//! counts and emitting rollup claims when counts change.
//!
//! # Wiener/Barad framing
//!
//! A cardinality is not a field on a container struct. It is a derived
//! claim produced by a projection that observes the substrate and
//! emits evidence back. Counts change as membership claims settle;
//! past counts stay in the fiber (CRDT monotonicity), so the history
//! of a container's cardinality is queryable.
//!
//! # Value-to-count semantics
//!
//! `CONTAINS` carries Belnap four-valued evidence:
//!
//! - `True` — positive membership. Object is counted.
//! - `False` — positive non-membership. Object is not counted.
//! - `Both` — contradictory evidence. Object is not counted (conservative).
//! - `None` — no witness. Object is not counted.
//!
//! Under CRDT monotonicity, a cell can transition `None → True →
//! Both` but never back. The projection re-evaluates the per-subject
//! set on each incoming claim.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-port-projection-aggregator/` — a
//! more sophisticated version that handles declared/satisfied
//! counting with closure semantics via `IS_OPEN`. This first-pass
//! implementation does plain open-ended counting; closure-aware
//! cardinality can follow once the ship has specific `IS_OPEN`-gated
//! containers.

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;
use std::collections::{HashMap, HashSet};

use crate::container::{CONTAINS, HAS_CARDINALITY, IS_EMPTY};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-cardinality";

/// Cardinality projection state.
#[derive(Debug, Default)]
pub struct CardinalityPort {
    /// subject (container) → set of member objects where CONTAINS
    /// has settled True. Objects whose CONTAINS value is False, Both,
    /// or None are not in the set.
    members: HashMap<String, HashSet<String>>,
}

impl CardinalityPort {
    /// Build a fresh cardinality projection with no state.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Current member count for a subject. Public for testing; in
    /// production the count is queried by subscribing to
    /// `HAS_CARDINALITY`.
    #[must_use]
    pub fn count_for(&self, subject: &str) -> usize {
        self.members.get(subject).map_or(0, HashSet::len)
    }
}

impl Projection for CardinalityPort {
    fn identity(&self) -> &str {
        IDENTITY
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![CONTAINS.to_owned()]
    }

    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
        value: Value,
    ) -> Vec<Claim> {
        // Only process CONTAINS; defensive in case subscription
        // filter ever widens.
        if predicate != CONTAINS {
            return Vec::new();
        }

        let entry = self
            .members
            .entry(subject.to_owned())
            .or_default();

        let changed = match value {
            Value::True => entry.insert(object.to_owned()),
            Value::False | Value::Both | Value::None => entry.remove(object),
        };

        if !changed {
            return Vec::new();
        }

        let count = entry.len();
        let mut out = Vec::new();

        // Emit the current cardinality. Object is the decimal string
        // of the count; each count-value is a distinct fiber cell.
        out.push(Claim::new(subject, HAS_CARDINALITY, count.to_string()));

        // Emit IS_EMPTY diagonal cell transitions. Under CRDT
        // monotonicity past values stay; knowledge-join will render
        // subjects whose emptiness fluctuated as Value::Both.
        //
        // For transient-correct "currently-empty" a monotone-gated
        // pattern (like IS_OPEN from the old aggregator) is needed;
        // this first pass emits the witness and lets the substrate
        // record history.
        if count == 0 {
            // Note: the subscription client will issue this at
            // Value::True by default. The semantics we want is "is-
            // empty True right now" — so on transition from >0 to 0,
            // emit True. Conservative: only emit on the transition.
            out.push(Claim::new(subject, IS_EMPTY, subject));
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_member_produces_cardinality_1() {
        let mut port = CardinalityPort::new();
        let claims = port.ingest("room-a", CONTAINS, "rock-1", Value::True);
        assert_eq!(port.count_for("room-a"), 1);
        assert!(claims
            .iter()
            .any(|c| c.subject == "room-a" && c.predicate == HAS_CARDINALITY && c.object == "1"));
    }

    #[test]
    fn duplicate_member_does_not_re_emit() {
        let mut port = CardinalityPort::new();
        port.ingest("room-a", CONTAINS, "rock-1", Value::True);
        let second = port.ingest("room-a", CONTAINS, "rock-1", Value::True);
        assert!(
            second.is_empty(),
            "re-witnessing an existing member should emit nothing"
        );
        assert_eq!(port.count_for("room-a"), 1);
    }

    #[test]
    fn adding_distinct_members_increments() {
        let mut port = CardinalityPort::new();
        port.ingest("room-a", CONTAINS, "rock-1", Value::True);
        let claims = port.ingest("room-a", CONTAINS, "gem-7", Value::True);
        assert_eq!(port.count_for("room-a"), 2);
        assert!(claims
            .iter()
            .any(|c| c.subject == "room-a" && c.predicate == HAS_CARDINALITY && c.object == "2"));
    }

    #[test]
    fn removing_member_decrements_and_emits_empty_on_zero() {
        let mut port = CardinalityPort::new();
        port.ingest("room-a", CONTAINS, "rock-1", Value::True);
        let claims = port.ingest("room-a", CONTAINS, "rock-1", Value::False);
        assert_eq!(port.count_for("room-a"), 0);
        assert!(claims
            .iter()
            .any(|c| c.subject == "room-a" && c.predicate == HAS_CARDINALITY && c.object == "0"));
        assert!(claims
            .iter()
            .any(|c| c.subject == "room-a"
                && c.predicate == IS_EMPTY
                && c.object == "room-a"));
    }

    #[test]
    fn both_value_counts_as_non_member() {
        // CRDT monotonicity: a cell can transition True → Both when
        // contradictory evidence arrives. The projection treats
        // Both as non-membership (conservative; "uncertain").
        let mut port = CardinalityPort::new();
        port.ingest("room-a", CONTAINS, "rock-1", Value::True);
        assert_eq!(port.count_for("room-a"), 1);
        let claims = port.ingest("room-a", CONTAINS, "rock-1", Value::Both);
        assert_eq!(port.count_for("room-a"), 0);
        assert!(claims
            .iter()
            .any(|c| c.subject == "room-a" && c.predicate == HAS_CARDINALITY && c.object == "0"));
    }

    #[test]
    fn different_subjects_have_independent_counts() {
        let mut port = CardinalityPort::new();
        port.ingest("room-a", CONTAINS, "rock-1", Value::True);
        port.ingest("room-b", CONTAINS, "gem-7", Value::True);
        port.ingest("room-b", CONTAINS, "book-3", Value::True);
        assert_eq!(port.count_for("room-a"), 1);
        assert_eq!(port.count_for("room-b"), 2);
    }

    #[test]
    fn only_subscribes_to_contains() {
        let port = CardinalityPort::new();
        let subs = port.subscriptions();
        assert_eq!(subs, vec![CONTAINS.to_owned()]);
    }

    #[test]
    fn non_contains_predicate_ignored_defensively() {
        let mut port = CardinalityPort::new();
        // Defensive: even if the subscription filter somehow passes
        // a different predicate, the projection ignores it.
        let claims = port.ingest("room-a", "some-other-predicate", "x", Value::True);
        assert!(claims.is_empty());
        assert_eq!(port.count_for("room-a"), 0);
    }
}
