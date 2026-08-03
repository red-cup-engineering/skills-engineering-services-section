//! Retry — mints new attempt ops when existing ops fail.
//!
//! # Individuation, not mutation
//!
//! The cascade is monotone: a cell that settled [`IS_FAILED`] cannot
//! un-fail. So retry doesn't mutate the failed op's state — it mints
//! a fresh op with a new subject, carrying the task's payload
//! (command, target) and worker-kind binding. The substrate's
//! workers-vocab composition `IS_INTENT_SET ∧ USES_<KIND>_WORKER →
//! IS_READY_TO_RUN_ON_<KIND>` fires for the new op at its coordinate
//! and the effector picks up. No re-dispatch through matchmaking.
//!
//! # Attempt cap
//!
//! Tasks can declare [`crate::planning::run::HAS_MAX_ATTEMPTS`] to
//! cap attempts. Absent means [`DEFAULT_MAX_ATTEMPTS`] (3 total).
//! The port refuses to mint once the count meets the cap.
//!
//! # Pure composition
//!
//! [`compose_retry_op`] is the pure function that builds the claim
//! set for one new attempt. Test-friendly; the [`RetryPort`]
//! projection wraps it with subscription glue.

use std::collections::{HashMap, HashSet};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;

use crate::ops::{EXECUTES_ON, IS_FAILED, IS_INTENT_SET, IS_PENDING, RUNS_COMMAND};
use crate::planning::run::{ATTEMPT_NUMBER, HAS_ATTEMPT, HAS_MAX_ATTEMPTS};
use crate::planning::task::{HAS_COMMAND, HAS_OPERATION, HAS_TARGET, IS_ASSIGNED_TO_TASK};
use crate::workers::{
    CONTAINER_WORKER, HUMAN_WORKER, LLM_WORKER, SHELL_WORKER, USES_CONTAINER_WORKER,
    USES_HUMAN_WORKER, USES_LLM_WORKER, USES_SHELL_WORKER,
};

/// Default total attempts when [`HAS_MAX_ATTEMPTS`] is absent.
/// Includes the initial attempt — 3 means first + up to 2 retries.
pub const DEFAULT_MAX_ATTEMPTS: u32 = 3;

// ─────────────────────────────────────────────────────────────────────
// Pure composition
// ─────────────────────────────────────────────────────────────────────

/// Inputs for one retry decision.
pub struct RetryInputs<'a> {
    /// Task whose op just failed. Used as run-surrogate in v1.
    pub task: &'a str,
    /// The task's command payload.
    pub command: &'a str,
    /// The op's worker subject (used to derive the uses-<kind>
    /// predicate).
    pub worker: &'a str,
    /// New attempt's sequence number (1-based; original op is 1,
    /// first retry is 2, ...).
    pub attempt_number: u32,
    /// Minted-at timestamp fragment for the new op's subject.
    pub minted_at: &'a str,
}

/// Build the claim set for one new attempt op. Returns
/// `(new_op, claims)`.
#[must_use]
pub fn compose_retry_op(inputs: &RetryInputs<'_>) -> (String, Vec<Claim>) {
    let new_op = format!("op:{}:{}", inputs.task, inputs.minted_at);
    let uses_pred = uses_predicate_for(inputs.worker);

    let mut claims = vec![
        // Payload.
        Claim::new(&new_op, RUNS_COMMAND, inputs.command),
        Claim::new(&new_op, EXECUTES_ON, inputs.worker),
        // Composition gate inputs at (op, _, worker).
        Claim::new(&new_op, IS_INTENT_SET, inputs.worker),
        Claim::new(&new_op, uses_pred, inputs.worker),
        // Lifecycle — diagonal.
        Claim::new(&new_op, IS_PENDING, &new_op),
        // Cross-subject linkage.
        Claim::new(&new_op, IS_ASSIGNED_TO_TASK, inputs.task),
        Claim::new(inputs.task, HAS_OPERATION, &new_op),
        // Run/attempt pairing.
        Claim::new(inputs.task, HAS_ATTEMPT, &new_op),
        Claim::new(&new_op, ATTEMPT_NUMBER, inputs.attempt_number.to_string()),
    ];
    claims.sort_by(|a, b| {
        a.subject
            .cmp(&b.subject)
            .then(a.predicate.cmp(&b.predicate))
            .then(a.object.cmp(&b.object))
    });
    (new_op, claims)
}

fn uses_predicate_for(worker: &str) -> &'static str {
    let kind = worker.split(':').next().unwrap_or(worker);
    match kind {
        SHELL_WORKER => USES_SHELL_WORKER,
        LLM_WORKER => USES_LLM_WORKER,
        CONTAINER_WORKER => USES_CONTAINER_WORKER,
        HUMAN_WORKER => USES_HUMAN_WORKER,
        _ => USES_SHELL_WORKER,
    }
}

// ─────────────────────────────────────────────────────────────────────
// Projection port
// ─────────────────────────────────────────────────────────────────────

/// Retry projection state.
///
/// Observes `(op, is-failed, _)`, looks up the op's task / command /
/// worker / attempt-count, and emits a new attempt op if under cap.
pub struct RetryPort {
    task_for_op: HashMap<String, String>,
    command_for_task: HashMap<String, String>,
    target_for_task: HashMap<String, String>,
    executes_on_for_op: HashMap<String, String>,
    max_attempts_for_task: HashMap<String, u32>,
    attempts_for_task: HashMap<String, u32>,
    retried: HashSet<String>,
    minted_at: fn(u32) -> String,
}

impl Default for RetryPort {
    fn default() -> Self {
        Self::with_clock(default_minted_at)
    }
}

fn default_minted_at(attempt: u32) -> String {
    format!("attempt-{attempt}")
}

impl RetryPort {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Fresh state with an injectable minted-at generator. Receives
    /// the new attempt number and returns the timestamp fragment.
    /// Use to make tests deterministic.
    #[must_use]
    pub fn with_clock(minted_at: fn(u32) -> String) -> Self {
        Self {
            task_for_op: HashMap::new(),
            command_for_task: HashMap::new(),
            target_for_task: HashMap::new(),
            executes_on_for_op: HashMap::new(),
            max_attempts_for_task: HashMap::new(),
            attempts_for_task: HashMap::new(),
            retried: HashSet::new(),
            minted_at,
        }
    }

    fn try_retry(&mut self, op: &str) -> Vec<Claim> {
        if self.retried.contains(op) {
            return Vec::new();
        }
        let Some(task) = self.task_for_op.get(op).cloned() else {
            return Vec::new();
        };
        let Some(command) = self.command_for_task.get(&task).cloned() else {
            return Vec::new();
        };
        // Worker resolution preference: the op's own executes-on, then
        // the task's has-target.
        let Some(worker) = self
            .executes_on_for_op
            .get(op)
            .cloned()
            .or_else(|| self.target_for_task.get(&task).cloned())
        else {
            return Vec::new();
        };

        let cap = self
            .max_attempts_for_task
            .get(&task)
            .copied()
            .unwrap_or(DEFAULT_MAX_ATTEMPTS);

        let current = self.attempts_for_task.entry(task.clone()).or_insert(1);
        let next = *current + 1;
        if next > cap {
            // Cap exhausted; no retry.
            self.retried.insert(op.to_owned());
            return Vec::new();
        }
        *current = next;
        self.retried.insert(op.to_owned());

        let minted = (self.minted_at)(next);
        let inputs = RetryInputs {
            task: &task,
            command: &command,
            worker: &worker,
            attempt_number: next,
            minted_at: &minted,
        };
        let (_, claims) = compose_retry_op(&inputs);
        claims
    }
}

impl Projection for RetryPort {
    fn identity(&self) -> &str {
        "mash-library-retry-port"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            IS_FAILED.to_owned(),
            IS_ASSIGNED_TO_TASK.to_owned(),
            HAS_COMMAND.to_owned(),
            HAS_TARGET.to_owned(),
            EXECUTES_ON.to_owned(),
            HAS_MAX_ATTEMPTS.to_owned(),
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
        if predicate == IS_FAILED {
            self.try_retry(subject)
        } else if predicate == IS_ASSIGNED_TO_TASK {
            self.task_for_op.insert(subject.to_owned(), object.to_owned());
            Vec::new()
        } else if predicate == HAS_COMMAND {
            self.command_for_task
                .insert(subject.to_owned(), object.to_owned());
            Vec::new()
        } else if predicate == HAS_TARGET {
            self.target_for_task
                .insert(subject.to_owned(), object.to_owned());
            Vec::new()
        } else if predicate == EXECUTES_ON {
            self.executes_on_for_op
                .insert(subject.to_owned(), object.to_owned());
            Vec::new()
        } else if predicate == HAS_MAX_ATTEMPTS {
            if let Ok(n) = object.parse::<u32>() {
                self.max_attempts_for_task.insert(subject.to_owned(), n);
            }
            Vec::new()
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find_object<'a>(claims: &'a [Claim], subject: &str, predicate: &str) -> Option<&'a str> {
        claims
            .iter()
            .find(|c| c.subject == subject && c.predicate == predicate)
            .map(|c| c.object.as_str())
    }

    #[test]
    fn compose_retry_op_for_shell_worker() {
        let inputs = RetryInputs {
            task: "task:t",
            command: "echo hi",
            worker: "shell-worker:1",
            attempt_number: 2,
            minted_at: "2026-04-21T03:30:00Z",
        };
        let (new_op, claims) = compose_retry_op(&inputs);
        assert_eq!(new_op, "op:task:t:2026-04-21T03:30:00Z");
        assert_eq!(find_object(&claims, &new_op, RUNS_COMMAND), Some("echo hi"));
        assert_eq!(
            find_object(&claims, &new_op, USES_SHELL_WORKER),
            Some("shell-worker:1"),
            "shell worker should bind uses-shell-worker"
        );
        assert_eq!(find_object(&claims, &new_op, ATTEMPT_NUMBER), Some("2"));
    }

    #[test]
    fn llm_worker_binds_uses_llm_worker() {
        let inputs = RetryInputs {
            task: "task:t",
            command: "answer",
            worker: "llm-worker:opus",
            attempt_number: 2,
            minted_at: "ts",
        };
        let (new_op, claims) = compose_retry_op(&inputs);
        assert_eq!(
            find_object(&claims, &new_op, USES_LLM_WORKER),
            Some("llm-worker:opus")
        );
    }

    #[test]
    fn composed_op_links_back_to_task() {
        let inputs = RetryInputs {
            task: "task:t",
            command: "c",
            worker: "shell-worker:1",
            attempt_number: 2,
            minted_at: "ts",
        };
        let (new_op, claims) = compose_retry_op(&inputs);
        assert_eq!(
            find_object(&claims, &new_op, IS_ASSIGNED_TO_TASK),
            Some("task:t")
        );
        assert_eq!(
            find_object(&claims, "task:t", HAS_OPERATION),
            Some(new_op.as_str())
        );
    }

    fn test_minted_at(attempt: u32) -> String {
        format!("ts-{attempt}")
    }

    #[test]
    fn port_mints_retry_on_first_failure() {
        let mut port = RetryPort::with_clock(test_minted_at);
        let _ = port.ingest("op:1", IS_ASSIGNED_TO_TASK, "task:t", Value::True);
        let _ = port.ingest("task:t", HAS_COMMAND, "echo", Value::True);
        let _ = port.ingest("op:1", EXECUTES_ON, "shell-worker:1", Value::True);
        let out = port.ingest("op:1", IS_FAILED, "op:1", Value::True);
        assert!(
            out.iter().any(|c| c.predicate == ATTEMPT_NUMBER && c.object == "2"),
            "first retry should be attempt 2"
        );
    }

    #[test]
    fn port_respects_max_attempts_cap() {
        let mut port = RetryPort::with_clock(test_minted_at);
        let _ = port.ingest("op:1", IS_ASSIGNED_TO_TASK, "task:t", Value::True);
        let _ = port.ingest("task:t", HAS_COMMAND, "echo", Value::True);
        let _ = port.ingest("op:1", EXECUTES_ON, "shell-worker:1", Value::True);
        let _ = port.ingest("task:t", HAS_MAX_ATTEMPTS, "1", Value::True);
        let out = port.ingest("op:1", IS_FAILED, "op:1", Value::True);
        assert!(
            out.is_empty(),
            "cap of 1 attempts means no retry after initial failure"
        );
    }

    #[test]
    fn default_cap_allows_three_total() {
        let mut port = RetryPort::with_clock(test_minted_at);
        let _ = port.ingest("op:1", IS_ASSIGNED_TO_TASK, "task:t", Value::True);
        let _ = port.ingest("task:t", HAS_COMMAND, "echo", Value::True);
        let _ = port.ingest("op:1", EXECUTES_ON, "shell-worker:1", Value::True);
        // First failure → attempt 2.
        let first = port.ingest("op:1", IS_FAILED, "op:1", Value::True);
        assert!(first.iter().any(|c| c.object == "2"));
        // Second failure of a different op (same task) → attempt 3.
        let _ = port.ingest("op:2", IS_ASSIGNED_TO_TASK, "task:t", Value::True);
        let _ = port.ingest("op:2", EXECUTES_ON, "shell-worker:1", Value::True);
        let second = port.ingest("op:2", IS_FAILED, "op:2", Value::True);
        assert!(second.iter().any(|c| c.object == "3"));
        // Third failure would push to attempt 4 > cap 3 → no retry.
        let _ = port.ingest("op:3", IS_ASSIGNED_TO_TASK, "task:t", Value::True);
        let _ = port.ingest("op:3", EXECUTES_ON, "shell-worker:1", Value::True);
        let third = port.ingest("op:3", IS_FAILED, "op:3", Value::True);
        assert!(third.is_empty(), "third failure exhausts the default cap");
    }

    #[test]
    fn port_idempotent_per_failed_op() {
        let mut port = RetryPort::with_clock(test_minted_at);
        let _ = port.ingest("op:1", IS_ASSIGNED_TO_TASK, "task:t", Value::True);
        let _ = port.ingest("task:t", HAS_COMMAND, "echo", Value::True);
        let _ = port.ingest("op:1", EXECUTES_ON, "shell-worker:1", Value::True);
        let first = port.ingest("op:1", IS_FAILED, "op:1", Value::True);
        assert!(!first.is_empty());
        let again = port.ingest("op:1", IS_FAILED, "op:1", Value::True);
        assert!(again.is_empty(), "same failed op must not re-retry");
    }

    #[test]
    fn missing_context_does_not_mint() {
        let mut port = RetryPort::with_clock(test_minted_at);
        // No IS_ASSIGNED_TO_TASK, no HAS_COMMAND — can't compose.
        let out = port.ingest("op:orphan", IS_FAILED, "op:orphan", Value::True);
        assert!(out.is_empty());
    }
}
