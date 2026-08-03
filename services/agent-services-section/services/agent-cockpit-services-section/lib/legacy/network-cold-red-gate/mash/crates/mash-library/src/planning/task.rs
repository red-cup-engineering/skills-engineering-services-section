//! Task — unit of declared work with full lifecycle, dependency and
//! approval gating, and the task↔op bridge.
//!
//! # Lifecycle
//!
//! A task progresses through these diagonal state cells:
//!
//! ```text
//!   (task, is-closed, task)                  ← declared-set closure
//!         ∧
//!   (task, has-all-dependencies-satisfied, task)
//!         │
//!         ▼ composition
//!   (task, is-task-routable, task)
//!         ∧
//!   (task, has-all-approvals-satisfied, task)
//!         │
//!         ▼ composition
//!   (task, is-task-clear, task)
//!         │
//!         ▼ specialization
//!   (task, is-task-ready, task)
//! ```
//!
//! Terminal: `is-task-completed` (emitted by the task-completion
//! aggregator once every `has-operation` has `has-operation-completed`)
//! or `is-task-failed`.
//!
//! # Why `IS_CLOSED` instead of the old lib's `IS_OPEN`
//!
//! The cardinality aggregators (dependency, approval, operation-
//! completion) need a closure signal to safely emit their rollups.
//! The old library called this signal `IS_OPEN` — semantically
//! inverted ("is-open" meaning "is-open for rollup after declarations
//! are done"). This library uses [`crate::lifecycle::IS_CLOSED`] —
//! "the declared set is closed for new members" — which reads
//! correctly and aligns with how [`crate::approval::AggregatorPort`]
//! latches.
//!
//! # Inversion discipline
//!
//! The old-library declared `DEPENDS_ON INVERTS_AS DEPENDENCY_OF` and
//! `HAS_OPERATION INVERTS_AS OPERATION_OF`. Both are converse-positive
//! pairs, not algebraic-negation pairs. Dropped here; reverse queries
//! use fiber scan at object axis.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::approval::HAS_ALL_APPROVALS_SATISFIED;
use crate::foundation::{
    COMPOSES_INTO, IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, USES_AS_COMPOSITION_LEFT,
    USES_AS_COMPOSITION_RIGHT,
};
use crate::lifecycle::IS_CLOSED;

/// Owner identity.
pub const IDENTITY: &str = "mash-library-task";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A unit of declared work that can decompose into operations.
pub const TASK: &str = "task";

// ─────────────────────────────────────────────────────────────────────
// Payload predicates
// ─────────────────────────────────────────────────────────────────────

/// `(task, has-command, string)` — shell command the operation
/// should run (when the task spawns a shell op).
pub const HAS_COMMAND: &str = "has-command";

/// `(task, has-target, subject)` — target the operation should
/// execute on.
pub const HAS_TARGET: &str = "has-target";

// ─────────────────────────────────────────────────────────────────────
// Lifecycle state flags (diagonal: object = subject)
// ─────────────────────────────────────────────────────────────────────

/// Composition output: `IS_CLOSED ∧ HAS_ALL_DEPENDENCIES_SATISFIED`.
pub const IS_TASK_ROUTABLE: &str = "is-task-routable";

/// Composition output: `IS_TASK_ROUTABLE ∧ HAS_ALL_APPROVALS_SATISFIED`.
pub const IS_TASK_CLEAR: &str = "is-task-clear";

/// Specialization of [`IS_TASK_CLEAR`]: a clear task is ready to
/// dispatch. Reserved for future worker-slot gating that runs between
/// "clear" and "ready"; for now they coincide via specialization lift.
pub const IS_TASK_READY: &str = "is-task-ready";

/// Terminal: every declared operation has its completion witnessed.
/// Emitted by the task-completion aggregator.
pub const IS_TASK_COMPLETED: &str = "is-task-completed";

/// Terminal: an operation reported failure.
pub const IS_TASK_FAILED: &str = "is-task-failed";

/// A composition gate yielded a block (missing approval, broken
/// dependency). Reserved for future implication chains.
pub const IS_TASK_BLOCKED: &str = "is-task-blocked";

// ─────────────────────────────────────────────────────────────────────
// Dependency predicates
// ─────────────────────────────────────────────────────────────────────

/// `(task, depends-on, other-task)` — task needs `other-task` done
/// before it can run.
pub const DEPENDS_ON: &str = "depends-on";

/// `(task, has-dependency-satisfied, other-task)` — witness of
/// satisfaction: `other-task`'s terminal completion has been
/// observed on the bridge port.
pub const HAS_DEPENDENCY_SATISFIED: &str = "has-dependency-satisfied";

/// `(task, has-all-dependencies-satisfied, task)` — diagonal rollup
/// emitted by the dependency aggregator once every declared
/// `depends-on` has a matching `has-dependency-satisfied`.
pub const HAS_ALL_DEPENDENCIES_SATISFIED: &str = "has-all-dependencies-satisfied";

// ─────────────────────────────────────────────────────────────────────
// Task ↔ Operation bridge
// ─────────────────────────────────────────────────────────────────────

/// `(task, has-operation, op)` — operation spawned by this task.
pub const HAS_OPERATION: &str = "has-operation";

/// `(op, is-assigned-to-task, task)` — reverse binding witnessed at
/// op mint time; gives the op's fiber direct access to its task.
pub const IS_ASSIGNED_TO_TASK: &str = "is-assigned-to-task";

/// `(task, has-operation-completed, op)` — witness-of-completion,
/// emitted by a task-port that translates `(op, is-completed, _)`
/// back onto the task's fiber.
pub const HAS_OPERATION_COMPLETED: &str = "has-operation-completed";

// ─────────────────────────────────────────────────────────────────────
// Assignment predicate
// ─────────────────────────────────────────────────────────────────────

/// `(task, has-assigned-worker, worker)` — worker selected by the
/// dispatch-selector port.
pub const HAS_ASSIGNED_WORKER: &str = "has-assigned-worker";

// ─────────────────────────────────────────────────────────────────────
// Composition anchor subjects
// ─────────────────────────────────────────────────────────────────────

const ROUTABLE_TRIGGER: &str = "task:routable-trigger";
const CLEAR_TRIGGER: &str = "task:clear-trigger";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the task vocabulary and the two-step
/// routable/clear composition chain.
#[derive(Debug, Clone, Copy, Default)]
pub struct Task;

#[async_trait]
impl Agent for Task {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        out.push(Claim::new(TASK, IS_A_TERM, IDENTITY));

        for p in [
            HAS_COMMAND,
            HAS_TARGET,
            IS_TASK_ROUTABLE,
            IS_TASK_CLEAR,
            IS_TASK_READY,
            IS_TASK_COMPLETED,
            IS_TASK_FAILED,
            IS_TASK_BLOCKED,
            DEPENDS_ON,
            HAS_DEPENDENCY_SATISFIED,
            HAS_ALL_DEPENDENCIES_SATISFIED,
            HAS_OPERATION,
            IS_ASSIGNED_TO_TASK,
            HAS_OPERATION_COMPLETED,
            HAS_ASSIGNED_WORKER,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // IS_CLOSED ∧ HAS_ALL_DEPENDENCIES_SATISFIED → IS_TASK_ROUTABLE.
        out.push(Claim::new(ROUTABLE_TRIGGER, USES_AS_COMPOSITION_LEFT, IS_CLOSED));
        out.push(Claim::new(
            ROUTABLE_TRIGGER,
            USES_AS_COMPOSITION_RIGHT,
            HAS_ALL_DEPENDENCIES_SATISFIED,
        ));
        out.push(Claim::new(ROUTABLE_TRIGGER, COMPOSES_INTO, IS_TASK_ROUTABLE));

        // IS_TASK_ROUTABLE ∧ HAS_ALL_APPROVALS_SATISFIED → IS_TASK_CLEAR.
        out.push(Claim::new(
            CLEAR_TRIGGER,
            USES_AS_COMPOSITION_LEFT,
            IS_TASK_ROUTABLE,
        ));
        out.push(Claim::new(
            CLEAR_TRIGGER,
            USES_AS_COMPOSITION_RIGHT,
            HAS_ALL_APPROVALS_SATISFIED,
        ));
        out.push(Claim::new(CLEAR_TRIGGER, COMPOSES_INTO, IS_TASK_CLEAR));

        // Clear specializes-as ready (v1 collapse).
        out.push(Claim::new(IS_TASK_CLEAR, SPECIALIZES_AS, IS_TASK_READY));

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::foundation::INVERTS_AS;

    #[test]
    fn task_term_declared() {
        assert!(Task
            .claims()
            .iter()
            .any(|c| c.subject == TASK && c.predicate == IS_A_TERM));
    }

    #[test]
    fn readiness_compositions_present() {
        let claims = Task.claims();
        let composes = |s: &str, o: &str| {
            claims
                .iter()
                .any(|c| c.subject == s && c.predicate == COMPOSES_INTO && c.object == o)
        };
        assert!(composes(ROUTABLE_TRIGGER, IS_TASK_ROUTABLE));
        assert!(composes(CLEAR_TRIGGER, IS_TASK_CLEAR));
    }

    #[test]
    fn routable_uses_is_closed_not_is_open() {
        let claims = Task.claims();
        assert!(claims.iter().any(|c| c.subject == ROUTABLE_TRIGGER
            && c.predicate == USES_AS_COMPOSITION_LEFT
            && c.object == IS_CLOSED));
    }

    #[test]
    fn clear_specializes_as_ready() {
        let claims = Task.claims();
        assert!(claims.iter().any(|c| c.subject == IS_TASK_CLEAR
            && c.predicate == SPECIALIZES_AS
            && c.object == IS_TASK_READY));
    }

    #[test]
    fn no_spurious_inversions() {
        let claims = Task.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "task module should declare no INVERTS_AS wiring"
        );
    }
}
