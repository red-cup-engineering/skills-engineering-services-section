//! Plan — named collection of tasks that together constitute a
//! higher-level unit of work.
//!
//! A plan is complete when every task it owns is complete. The
//! plan-completion rollup uses the generic
//! [`crate::approval::AggregatorPort`] pattern:
//!
//! - `(plan, has-plan-task, task)` — member task declaration
//! - `(plan, has-plan-task-completed, task)` — emitted by a bridge
//!   port that translates `(task, is-task-completed, _)` into the
//!   plan's fiber per plan the task belongs to
//! - `(plan, is-closed, plan)` — declared-set closure signal
//! - `(plan, is-plan-completed, plan)` — diagonal rollup emitted
//!   once every member has its completion witness
//!
//! # Why a bridge port for completion
//!
//! The aggregator compares two fibers at the same subject (the plan).
//! Tasks announce their completion at their own subject (the task),
//! so a bridge port lifts `(task, is-task-completed, task)` into
//! `(plan, has-plan-task-completed, task)` per plan the task belongs
//! to. Implementation is T-future; the vocabulary is declared here.
//!
//! # Inversion discipline
//!
//! The old-library declared `HAS_PLAN_TASK INVERTS_AS IS_PLAN_TASK_OF`.
//! That's converse-positive, not algebraic-negation. Dropped here.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-plan";

/// A plan. Subjects use the convention `plan:<id>`.
pub const PLAN: &str = "plan";

/// `(plan, has-plan-task, task)` — member task. Multi-valued.
pub const HAS_PLAN_TASK: &str = "has-plan-task";

/// `(plan, has-plan-task-completed, task)` — emitted by the plan
/// task-completion bridge port when a member task settles
/// [`crate::planning::task::IS_TASK_COMPLETED`].
pub const HAS_PLAN_TASK_COMPLETED: &str = "has-plan-task-completed";

/// `(plan, is-plan-completed, plan)` — diagonal state flag. Emitted
/// by the plan-completion aggregator once
/// `|has-plan-task-completed| ≥ |has-plan-task|` and the plan has
/// settled [`crate::lifecycle::IS_CLOSED`].
pub const IS_PLAN_COMPLETED: &str = "is-plan-completed";

/// Owner-agent declaring the plan vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Plan;

#[async_trait]
impl Agent for Plan {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();
        out.push(Claim::new(PLAN, IS_A_TERM, IDENTITY));
        for p in [HAS_PLAN_TASK, HAS_PLAN_TASK_COMPLETED, IS_PLAN_COMPLETED] {
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
    fn plan_term_declared() {
        assert!(Plan
            .claims()
            .iter()
            .any(|c| c.subject == PLAN && c.predicate == IS_A_TERM));
    }

    #[test]
    fn predicates_declared() {
        let claims = Plan.claims();
        for p in [HAS_PLAN_TASK, HAS_PLAN_TASK_COMPLETED, IS_PLAN_COMPLETED] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} missing"
            );
        }
    }

    #[test]
    fn no_spurious_inversions() {
        let claims = Plan.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "plan module should declare no INVERTS_AS wiring"
        );
    }
}
