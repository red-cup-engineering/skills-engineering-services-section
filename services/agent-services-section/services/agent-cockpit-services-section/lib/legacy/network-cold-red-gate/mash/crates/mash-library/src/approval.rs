//! Approval flows — vocabulary, per-pair implication, and a generic
//! aggregator projection.
//!
//! # What an approval is
//!
//! A subject (task, op, plan) declares `requires-approval <approval-id>`
//! for each approval it needs. An authority witnesses `has-approval
//! <approval-id>` to grant one. The implication
//!
//! `REQUIRES_APPROVAL ⇒ HAS_APPROVAL → APPROVAL_RESIDUAL`
//!
//! produces a residual cell whose value reveals whether each required
//! approval has a matching grant. (Chu linear implication residuation:
//! `a ⇒ b` is the largest `p` such that `a ⊙ p ≤_t b`.)
//!
//! # All-approved aggregation
//!
//! The per-pair implication says nothing about "are all approvals
//! satisfied?" — that's a cardinality question the bilattice algebra
//! can't answer by composition alone. [`AggregatorPort`] watches a
//! subject's declared and satisfied fibers, and once the declared set
//! is **closed** (signaled by [`crate::lifecycle::IS_CLOSED`] on the
//! subject's diagonal), emits a diagonal rollup cell
//! `(subject, has-all-approvals-satisfied, subject)` when
//! `|satisfied| ≥ |declared|`.
//!
//! # Closure and monotonicity
//!
//! The substrate is a ≤_k-monotone CRDT: once the rollup settles,
//! knowledge-join prevents retraction. Safe cardinality emission
//! therefore requires the declared fiber to be closed at emission
//! time — future extensions cannot invalidate the emitted value. The
//! algebra provides no closure primitive; [`crate::lifecycle::IS_CLOSED`]
//! plays that role by contract. When IS_CLOSED settles at a subject,
//! the aggregator freezes that subject's declared-set count.
//!
//! Late declarations (declared cells arriving after IS_CLOSED) are
//! witnessed as [`HAS_LATE_DECLARATION`] so mis-ordered scenes surface
//! in-band rather than silently mis-latching the rollup.
//!
//! # Divergence from old-library
//!
//! `mash-old-library/archive/mash-vocab-approval` used `IS_OPEN` as
//! the closure signal (semantically inverted — "open" meant "open for
//! evaluation after declarations are done"). That naming drove a
//! real bug: ports witnessing IS_OPEN before declarations caused the
//! aggregator to freeze at 0/0 and rollup immediately, with later
//! declarations stranded as late-witnesses.
//!
//! This module uses [`crate::lifecycle::IS_CLOSED`] — "the declared
//! set is closed for new members" — which reads correctly and
//! eliminates the ordering inversion.
//!
//! The old lib also declared `REQUIRES_APPROVAL INVERTS_AS
//! APPROVAL_REQUIRED_BY`. That was a converse-positive pair, not an
//! algebraic negation pair, so under pointwise negation semantics it
//! was wrong. Dropped here; reverse queries ("what requires this
//! approval?") use fiber-scan at object axis.

use async_trait::async_trait;
use std::collections::{HashMap, HashSet};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::{Agent, Projection};
use mash_engine::sdk::client::Claim;

use crate::foundation::{
    IMPLIES_INTO, IS_A_PREDICATE, IS_A_TERM, USES_AS_ANTECEDENT, USES_AS_CONSEQUENT,
};
use crate::lifecycle::IS_CLOSED;

/// Owner identity.
pub const IDENTITY: &str = "mash-library-approval";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A discrete approval that a subject may require.
pub const APPROVAL: &str = "approval";

/// A status an approval can carry. Object values:
/// [`APPROVAL_STATUS_PENDING`], [`APPROVAL_STATUS_APPROVED`],
/// [`APPROVAL_STATUS_DENIED`].
pub const APPROVAL_STATUS_KIND: &str = "approval-status-kind";

/// Approval requested, not yet decided.
pub const APPROVAL_STATUS_PENDING: &str = "approval-status:pending";

/// Approval granted.
pub const APPROVAL_STATUS_APPROVED: &str = "approval-status:approved";

/// Approval refused.
pub const APPROVAL_STATUS_DENIED: &str = "approval-status:denied";

// ─────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────

/// `(subject, requires-approval, approval-id)` — the subject needs
/// this approval before it can advance.
pub const REQUIRES_APPROVAL: &str = "requires-approval";

/// `(subject, has-approval, approval-id)` — an approval has been
/// granted for this subject.
pub const HAS_APPROVAL: &str = "has-approval";

/// `(approval-id, approval-status, status-term)` — current status of
/// the approval.
pub const APPROVAL_STATUS: &str = "approval-status";

/// `(subject, approval-residual, approval-id)` — implication output.
/// Residuates the approval gap: the cell's value reveals whether each
/// required approval has a matching grant.
pub const APPROVAL_RESIDUAL: &str = "approval-residual";

/// `(subject, has-all-approvals-satisfied, subject)` — diagonal
/// rollup cell emitted by [`AggregatorPort`] once the declared set
/// is closed and every required approval has been granted.
pub const HAS_ALL_APPROVALS_SATISFIED: &str = "has-all-approvals-satisfied";

/// `(subject, has-late-declaration, object)` — observability witness:
/// a declared-fiber extension arrived after the subject was closed.
/// The monotone CRDT refuses to retract the already-emitted rollup,
/// so the late cell is surfaced in-band rather than silently ignored.
///
/// Lives in this module because [`AggregatorPort`] is the first user;
/// promote to a shared observability module if other aggregators
/// need it.
pub const HAS_LATE_DECLARATION: &str = "has-late-declaration";

// ─────────────────────────────────────────────────────────────────────
// Implication anchor
// ─────────────────────────────────────────────────────────────────────

const APPROVAL_TRIGGER: &str = "approval:requires-implies-has";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the approval vocabulary and the per-pair
/// implication.
#[derive(Debug, Clone, Copy, Default)]
pub struct Approval;

#[async_trait]
impl Agent for Approval {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        for t in [
            APPROVAL,
            APPROVAL_STATUS_KIND,
            APPROVAL_STATUS_PENDING,
            APPROVAL_STATUS_APPROVED,
            APPROVAL_STATUS_DENIED,
        ] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }

        for p in [
            REQUIRES_APPROVAL,
            HAS_APPROVAL,
            APPROVAL_STATUS,
            APPROVAL_RESIDUAL,
            HAS_ALL_APPROVALS_SATISFIED,
            HAS_LATE_DECLARATION,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // Implication: requires ⇒ has → residual.
        out.push(Claim::new(
            APPROVAL_TRIGGER,
            USES_AS_ANTECEDENT,
            REQUIRES_APPROVAL,
        ));
        out.push(Claim::new(APPROVAL_TRIGGER, USES_AS_CONSEQUENT, HAS_APPROVAL));
        out.push(Claim::new(APPROVAL_TRIGGER, IMPLIES_INTO, APPROVAL_RESIDUAL));

        out
    }
}

// ─────────────────────────────────────────────────────────────────────
// Generic aggregator projection
// ─────────────────────────────────────────────────────────────────────

/// Per-subject cardinality aggregator spec.
#[derive(Clone, Debug)]
pub struct AggregatorSpec {
    /// Identity this aggregator announces.
    pub identity: &'static str,
    /// Predicate witnessing one declared member
    /// (e.g. [`REQUIRES_APPROVAL`]).
    pub declared: &'static str,
    /// Predicate witnessing one satisfied member
    /// (e.g. [`HAS_APPROVAL`]).
    pub satisfied: &'static str,
    /// Diagonal predicate to emit once all declared members are
    /// satisfied (e.g. [`HAS_ALL_APPROVALS_SATISFIED`]).
    pub emit: &'static str,
}

/// Per-subject cardinality-aggregating projection.
///
/// Watches three fibers: declared, satisfied, [`IS_CLOSED`]. Emits a
/// diagonal rollup once declared is closed and satisfied covers it.
pub struct AggregatorPort {
    spec: AggregatorSpec,
    declared: HashMap<String, HashSet<String>>,
    satisfied: HashMap<String, HashSet<String>>,
    closed: HashSet<String>,
    emitted: HashSet<String>,
}

impl AggregatorPort {
    /// Build a fresh aggregator for `spec`.
    #[must_use]
    pub fn new(spec: AggregatorSpec) -> Self {
        Self {
            spec,
            declared: HashMap::new(),
            satisfied: HashMap::new(),
            closed: HashSet::new(),
            emitted: HashSet::new(),
        }
    }

    /// Build the standard approval aggregator: declared =
    /// [`REQUIRES_APPROVAL`], satisfied = [`HAS_APPROVAL`], emit =
    /// [`HAS_ALL_APPROVALS_SATISFIED`].
    #[must_use]
    pub fn for_approval() -> Self {
        Self::new(AggregatorSpec {
            identity: "mash-library-approval-aggregator",
            declared: REQUIRES_APPROVAL,
            satisfied: HAS_APPROVAL,
            emit: HAS_ALL_APPROVALS_SATISFIED,
        })
    }

    fn compute_emission(&mut self, subject: &str) -> Option<Claim> {
        if self.emitted.contains(subject) {
            return None;
        }
        if !self.closed.contains(subject) {
            return None;
        }
        let n_declared = self.declared.get(subject).map_or(0, HashSet::len);
        let n_satisfied = self.satisfied.get(subject).map_or(0, HashSet::len);
        if n_satisfied < n_declared {
            return None;
        }
        self.emitted.insert(subject.to_owned());
        Some(Claim::new(subject, self.spec.emit, subject))
    }
}

impl Projection for AggregatorPort {
    fn identity(&self) -> &str {
        self.spec.identity
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            self.spec.declared.to_owned(),
            self.spec.satisfied.to_owned(),
            IS_CLOSED.to_owned(),
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

        if predicate == self.spec.declared {
            if self.closed.contains(subject) {
                // Late declaration: emit observability witness, do not
                // mutate the frozen declared-set.
                return vec![Claim::new(subject, HAS_LATE_DECLARATION, object)];
            }
            self.declared
                .entry(subject.to_owned())
                .or_default()
                .insert(object.to_owned());
        } else if predicate == self.spec.satisfied {
            self.satisfied
                .entry(subject.to_owned())
                .or_default()
                .insert(object.to_owned());
        } else if predicate == IS_CLOSED && subject == object {
            // Closure signal only takes effect on diagonal cells —
            // the aggregator's contract is "the subject's declared set
            // is closed for new members", which is a self-state fact.
            self.closed.insert(subject.to_owned());
        } else {
            return Vec::new();
        }

        self.compute_emission(subject).into_iter().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_implication_wired() {
        let claims = Approval.claims();
        assert!(claims.iter().any(|c| c.subject == APPROVAL_TRIGGER
            && c.predicate == USES_AS_ANTECEDENT
            && c.object == REQUIRES_APPROVAL));
        assert!(claims.iter().any(|c| c.subject == APPROVAL_TRIGGER
            && c.predicate == USES_AS_CONSEQUENT
            && c.object == HAS_APPROVAL));
        assert!(claims.iter().any(|c| c.subject == APPROVAL_TRIGGER
            && c.predicate == IMPLIES_INTO
            && c.object == APPROVAL_RESIDUAL));
    }

    #[test]
    fn status_terms_declared() {
        let claims = Approval.claims();
        for s in [
            APPROVAL_STATUS_PENDING,
            APPROVAL_STATUS_APPROVED,
            APPROVAL_STATUS_DENIED,
        ] {
            assert!(claims.iter().any(|c| c.subject == s && c.predicate == IS_A_TERM));
        }
    }

    #[test]
    fn no_spurious_inversions() {
        // Per inversion discipline: REQUIRES_APPROVAL / HAS_APPROVAL
        // are a converse-positive pair and must not be wired as
        // INVERTS_AS (which would propagate as algebraic negation).
        let claims = Approval.claims();
        use crate::foundation::INVERTS_AS;
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "approval module should declare no INVERTS_AS wiring"
        );
    }

    #[test]
    fn aggregator_emits_rollup_after_closure_when_satisfied() {
        let mut port = AggregatorPort::for_approval();

        let declared: Vec<Claim> = vec![
            Claim::new("task-1", REQUIRES_APPROVAL, "approval-a"),
            Claim::new("task-1", REQUIRES_APPROVAL, "approval-b"),
        ];
        for c in &declared {
            let out = port.ingest(&c.subject, &c.predicate, &c.object, Value::True);
            assert!(out.is_empty(), "pre-closure declared should not emit");
        }

        let _ = port.ingest("task-1", HAS_APPROVAL, "approval-a", Value::True);
        let _ = port.ingest("task-1", HAS_APPROVAL, "approval-b", Value::True);

        let emissions = port.ingest("task-1", IS_CLOSED, "task-1", Value::True);
        assert_eq!(emissions.len(), 1);
        assert_eq!(emissions[0].subject, "task-1");
        assert_eq!(emissions[0].predicate, HAS_ALL_APPROVALS_SATISFIED);
        assert_eq!(emissions[0].object, "task-1");
    }

    #[test]
    fn aggregator_does_not_emit_before_closure() {
        let mut port = AggregatorPort::for_approval();
        let _ = port.ingest("task-1", REQUIRES_APPROVAL, "approval-a", Value::True);
        let out = port.ingest("task-1", HAS_APPROVAL, "approval-a", Value::True);
        assert!(out.is_empty(), "must not emit before IS_CLOSED arrives");
    }

    #[test]
    fn aggregator_does_not_emit_when_incomplete() {
        let mut port = AggregatorPort::for_approval();
        let _ = port.ingest("task-1", REQUIRES_APPROVAL, "approval-a", Value::True);
        let _ = port.ingest("task-1", REQUIRES_APPROVAL, "approval-b", Value::True);
        let _ = port.ingest("task-1", HAS_APPROVAL, "approval-a", Value::True);
        let out = port.ingest("task-1", IS_CLOSED, "task-1", Value::True);
        assert!(
            out.is_empty(),
            "incomplete approvals must not emit rollup at closure"
        );
    }

    #[test]
    fn late_declaration_surfaces_as_witness_not_silent_drop() {
        let mut port = AggregatorPort::for_approval();
        let _ = port.ingest("task-1", REQUIRES_APPROVAL, "approval-a", Value::True);
        let _ = port.ingest("task-1", HAS_APPROVAL, "approval-a", Value::True);
        let emissions = port.ingest("task-1", IS_CLOSED, "task-1", Value::True);
        assert_eq!(emissions.len(), 1);
        assert_eq!(emissions[0].predicate, HAS_ALL_APPROVALS_SATISFIED);

        let late = port.ingest("task-1", REQUIRES_APPROVAL, "approval-late", Value::True);
        assert_eq!(late.len(), 1);
        assert_eq!(late[0].subject, "task-1");
        assert_eq!(late[0].predicate, HAS_LATE_DECLARATION);
        assert_eq!(late[0].object, "approval-late");
    }

    #[test]
    fn off_diagonal_is_closed_is_ignored() {
        let mut port = AggregatorPort::for_approval();
        let _ = port.ingest("task-1", REQUIRES_APPROVAL, "approval-a", Value::True);
        let _ = port.ingest("task-1", HAS_APPROVAL, "approval-a", Value::True);
        // Off-diagonal IS_CLOSED (e.g. witnessing some bookkeeping
        // closure on a different object) must not trigger rollup.
        let out = port.ingest("task-1", IS_CLOSED, "some-other", Value::True);
        assert!(out.is_empty());
    }

    #[test]
    fn emission_is_once_per_subject() {
        let mut port = AggregatorPort::for_approval();
        let _ = port.ingest("task-1", REQUIRES_APPROVAL, "approval-a", Value::True);
        let _ = port.ingest("task-1", HAS_APPROVAL, "approval-a", Value::True);
        let first = port.ingest("task-1", IS_CLOSED, "task-1", Value::True);
        assert_eq!(first.len(), 1);
        let again = port.ingest("task-1", HAS_APPROVAL, "approval-a", Value::True);
        assert!(again.is_empty(), "rollup must fire at most once per subject");
    }

    #[test]
    fn non_true_values_ignored() {
        let mut port = AggregatorPort::for_approval();
        let out = port.ingest("task-1", REQUIRES_APPROVAL, "a", Value::False);
        assert!(out.is_empty());
        let out = port.ingest("task-1", REQUIRES_APPROVAL, "a", Value::None);
        assert!(out.is_empty());
    }
}
