//! Run — logical work-item representing one attempt-chain for a task.
//!
//! A run sits between a task and its executing ops. The task
//! declares the intent, the run represents the logical work-item
//! with its own lifecycle, and each op the run spawns is one
//! execution attempt.
//!
//! # Why a separate layer
//!
//! Multi-attempt logic (retry, backoff, deadline-cancellation) lives
//! at the run layer so individual ops stay simple and immutable.
//! Each retry mints a fresh op; the run accumulates attempts; the
//! task observes only the run's terminal outcome. This is the
//! individuation-not-mutation tradition — a failed op stays failed
//! forever; a second attempt is a different op.
//!
//! # Subject conventions
//!
//! - `run:<uuid>` — run subject, minted by the task-port (or a
//!   future run-supervisor) when a task becomes ready.
//! - `op:<…>` — attempt subject; same identity as the op the
//!   substrate already settles lifecycle on.
//!
//! # Pairings (no INVERTS_AS)
//!
//! All pairings below are converse-positive, not algebraic-negation.
//! Both directions get independent single-direction declarations;
//! reverse queries use fiber scan at object axis.
//!
//! - `(task, has-run, run)` / `(run, run-of, task)`
//! - `(run, has-attempt, op)` / `(op, attempt-of, run)`
//! - `(run, parent-run, run)` / `(run, child-run, run)`

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-run";

/// A logical work-item that may execute through one or more attempts.
pub const RUN: &str = "run";

// ─────────────────────────────────────────────────────────────────────
// Pairing predicates (single-direction; drop converse-positive reverses)
// ─────────────────────────────────────────────────────────────────────

/// `(task, has-run, run)` — task spawned this run.
pub const HAS_RUN: &str = "has-run";

/// `(run, has-attempt, op)` — run spawned this op as an attempt.
pub const HAS_ATTEMPT: &str = "has-attempt";

/// `(run, parent-run, run)` — when a run was spawned by another run.
pub const PARENT_RUN: &str = "parent-run";

// ─────────────────────────────────────────────────────────────────────
// Run state flags (diagonal)
// ─────────────────────────────────────────────────────────────────────

/// Run created, no attempt yet.
pub const IS_RUN_PENDING: &str = "is-run-pending";

/// Run has at least one in-flight attempt.
pub const IS_RUN_ACTIVE: &str = "is-run-active";

/// Run has at least one attempt that completed successfully.
pub const IS_RUN_COMPLETED: &str = "is-run-completed";

/// Run exhausted all attempts without success.
pub const IS_RUN_FAILED: &str = "is-run-failed";

/// Run was cancelled (deadline, parent cancellation, explicit request).
pub const IS_RUN_CANCELLED: &str = "is-run-cancelled";

// ─────────────────────────────────────────────────────────────────────
// Constraint / budget predicates
// ─────────────────────────────────────────────────────────────────────

/// `(op, attempt-number, decimal-string)` — attempt index within
/// the run, starting at 1.
pub const ATTEMPT_NUMBER: &str = "attempt-number";

/// `(run, has-deadline, iso-8601)` — absolute deadline; watchdog
/// cancels any still-active attempt with
/// [`CANCELLED_BECAUSE`] = `"deadline-exceeded"`.
pub const HAS_DEADLINE: &str = "has-deadline";

/// `(run, has-max-attempts, decimal-string)` — cap on attempts
/// before the run is considered exhausted.
pub const HAS_MAX_ATTEMPTS: &str = "has-max-attempts";

/// `(run, cancelled-because, reason-string)` — free-form cancellation
/// reason. Conventional values: `"deadline-exceeded"`,
/// `"parent-cancelled"`, `"user-requested"`.
pub const CANCELLED_BECAUSE: &str = "cancelled-because";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the run vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Run;

#[async_trait]
impl Agent for Run {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();
        out.push(Claim::new(RUN, IS_A_TERM, IDENTITY));
        for p in [
            HAS_RUN,
            HAS_ATTEMPT,
            PARENT_RUN,
            IS_RUN_PENDING,
            IS_RUN_ACTIVE,
            IS_RUN_COMPLETED,
            IS_RUN_FAILED,
            IS_RUN_CANCELLED,
            ATTEMPT_NUMBER,
            HAS_DEADLINE,
            HAS_MAX_ATTEMPTS,
            CANCELLED_BECAUSE,
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
    fn run_term_declared() {
        assert!(Run
            .claims()
            .iter()
            .any(|c| c.subject == RUN && c.predicate == IS_A_TERM));
    }

    #[test]
    fn five_state_flags_declared() {
        let claims = Run.claims();
        for p in [
            IS_RUN_PENDING,
            IS_RUN_ACTIVE,
            IS_RUN_COMPLETED,
            IS_RUN_FAILED,
            IS_RUN_CANCELLED,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "state flag {p} not declared"
            );
        }
    }

    #[test]
    fn constraint_predicates_declared() {
        let claims = Run.claims();
        for p in [ATTEMPT_NUMBER, HAS_DEADLINE, HAS_MAX_ATTEMPTS, CANCELLED_BECAUSE] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "constraint predicate {p} not declared"
            );
        }
    }

    #[test]
    fn no_spurious_inversions() {
        let claims = Run.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "run module should declare no INVERTS_AS wiring"
        );
    }
}
