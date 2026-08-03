//! Review vocabulary — task review flow.
//!
//! A task can declare itself under review with the diagonal marker
//! [`REQUIRES_REVIEW`]. When the task's work completes, a cascade
//! composition fires:
//!
//! ```text
//! is-completed ∧ requires-review → is-ready-for-review
//! ```
//!
//! Both premises and the output are diagonal state flags on the task
//! subject — they compose pointwise. The task moves into
//! pending-review state; a reviewer then witnesses [`HAS_REVIEW`]
//! carrying a review-id whose [`REVIEW_STATUS`] decides the outcome.
//!
//! # Predicate shapes
//!
//! - [`REQUIRES_REVIEW`], [`IS_READY_FOR_REVIEW`] — diagonal state
//!   flags `(subject, _, subject)`.
//! - [`HAS_REVIEW`] — relational `(task, has-review, review:<id>)`.
//!   A task can carry many reviews (multiple reviewers, re-reviews).
//! - [`REVIEW_STATUS`] — review subject → status term (pending /
//!   approved / denied).
//!
//! # v1 scope
//!
//! Ships the core composition. A future aggregator can lift
//! `(requires-specific-review ⊙ has-review)` into
//! `has-all-reviews-satisfied` when per-reviewer tracking is
//! needed.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-vocab-review/`. The old vocab
//! composed against `IS_TASK_COMPLETED` from `mash-vocab-task`; this
//! module composes against `ops::IS_COMPLETED` instead, since that's
//! the unified completion predicate in this library.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{
    COMPOSES_INTO, IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, THING,
    USES_AS_COMPOSITION_LEFT, USES_AS_COMPOSITION_RIGHT,
};
use crate::ops::IS_COMPLETED;

/// Owner identity.
pub const IDENTITY: &str = "mash-library-review";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A discrete review. Subject convention: `review:<id>`.
pub const REVIEW: &str = "review";

/// Category term for review-status values.
pub const REVIEW_STATUS_KIND: &str = "review-status-kind";

/// Status value: review requested but not yet decided.
pub const REVIEW_STATUS_PENDING: &str = "review-status:pending";
/// Status value: review accepted; task passes.
pub const REVIEW_STATUS_APPROVED: &str = "review-status:approved";
/// Status value: review rejected; task must redo work.
pub const REVIEW_STATUS_DENIED: &str = "review-status:denied";

// ─────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────

/// Diagonal marker `(task, requires-review, task)`.
pub const REQUIRES_REVIEW: &str = "requires-review";

/// Diagonal state flag `(task, is-ready-for-review, task)`. Derived
/// via composition `IS_COMPLETED ∧ REQUIRES_REVIEW`.
pub const IS_READY_FOR_REVIEW: &str = "is-ready-for-review";

/// Relational `(task, has-review, review:<id>)`.
pub const HAS_REVIEW: &str = "has-review";

/// `(review:<id>, review-status, review-status:<value>)`.
pub const REVIEW_STATUS: &str = "review-status";

// ─────────────────────────────────────────────────────────────────────
// Composition anchors
// ─────────────────────────────────────────────────────────────────────

const COMPOSE_READY_FOR_REVIEW: &str = "review:compose-ready-for-review";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the review vocabulary + ready-for-review
/// composition.
#[derive(Debug, Clone, Copy, Default)]
pub struct Review;

#[async_trait]
impl Agent for Review {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Category terms.
        out.push(Claim::new(REVIEW, IS_A_TERM, IDENTITY));
        out.push(Claim::new(REVIEW, SPECIALIZES_AS, THING));
        out.push(Claim::new(REVIEW_STATUS_KIND, IS_A_TERM, IDENTITY));
        out.push(Claim::new(REVIEW_STATUS_KIND, SPECIALIZES_AS, THING));

        for v in [
            REVIEW_STATUS_PENDING,
            REVIEW_STATUS_APPROVED,
            REVIEW_STATUS_DENIED,
        ] {
            out.push(Claim::new(v, IS_A_TERM, IDENTITY));
            out.push(Claim::new(v, SPECIALIZES_AS, REVIEW_STATUS_KIND));
        }

        // Predicates.
        for p in [REQUIRES_REVIEW, IS_READY_FOR_REVIEW, HAS_REVIEW, REVIEW_STATUS] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // Composition: IS_COMPLETED ∧ REQUIRES_REVIEW → IS_READY_FOR_REVIEW.
        out.push(Claim::new(
            COMPOSE_READY_FOR_REVIEW,
            USES_AS_COMPOSITION_LEFT,
            IS_COMPLETED,
        ));
        out.push(Claim::new(
            COMPOSE_READY_FOR_REVIEW,
            USES_AS_COMPOSITION_RIGHT,
            REQUIRES_REVIEW,
        ));
        out.push(Claim::new(
            COMPOSE_READY_FOR_REVIEW,
            COMPOSES_INTO,
            IS_READY_FOR_REVIEW,
        ));

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::foundation::Foundation;
    use crate::ops::Ops;
    use crate::testkit::TestHub;
    use mash_engine::algebra::Value;

    #[test]
    fn status_values_specialize_status_kind() {
        let claims = Review.claims();
        for v in [
            REVIEW_STATUS_PENDING,
            REVIEW_STATUS_APPROVED,
            REVIEW_STATUS_DENIED,
        ] {
            assert!(
                claims.iter().any(|c| c.subject == v
                    && c.predicate == SPECIALIZES_AS
                    && c.object == REVIEW_STATUS_KIND),
                "{v} should specialize-as review-status-kind"
            );
        }
    }

    #[test]
    fn composition_is_declared() {
        let claims = Review.claims();
        let triples: Vec<_> = claims
            .iter()
            .filter(|c| c.subject == COMPOSE_READY_FOR_REVIEW)
            .collect();
        assert_eq!(triples.len(), 3);
    }

    #[test]
    fn cascade_fires_ready_for_review_when_both_premises_set() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Ops)
            .with_owner_agent(Review)
            .build();

        // Witness both premises at the task-diagonal coordinate
        // `(task-1, _, task-1)`.
        hub.witness_true("task-1", IS_COMPLETED, "task-1");
        hub.witness_true("task-1", REQUIRES_REVIEW, "task-1");

        // Composition fires.
        assert_eq!(
            hub.value("task-1", IS_READY_FOR_REVIEW, "task-1"),
            Value::True,
        );
    }

    #[test]
    fn no_review_triggered_when_only_one_premise() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Ops)
            .with_owner_agent(Review)
            .build();

        // Only completion, no requires-review.
        hub.witness_true("task-2", IS_COMPLETED, "task-2");
        assert_eq!(
            hub.value("task-2", IS_READY_FOR_REVIEW, "task-2"),
            Value::None,
        );

        // Only requires-review, no completion.
        hub.witness_true("task-3", REQUIRES_REVIEW, "task-3");
        assert_eq!(
            hub.value("task-3", IS_READY_FOR_REVIEW, "task-3"),
            Value::None,
        );
    }
}
