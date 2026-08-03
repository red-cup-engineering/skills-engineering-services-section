//! Failure-observer — mints structured failure-diagnosis subjects
//! when ops fail, extracts stable pattern keys, feeds the learning
//! cardinality port.
//!
//! # The CL feedback loop
//!
//! When an op settles [`crate::ops::IS_FAILED`], this port mints a
//! `failure:<op>:<iso>` subject and witnesses:
//!
//! - `(failure, is-a, failure-diagnosis)` — type membership
//! - `(failure, diagnosis-of, op)` — link back to the op
//! - `(failure, has-failure-pattern, pattern:<key>)` — classification
//! - `(pattern, observed, failure)` — the cell
//!   [`crate::learning::LearningPort`] counts
//! - `(failure, has-task-preview, string)` — truncated command
//! - `(failure, has-error-text, string-or-blob-ref)` — error text
//!
//! Recurring failure shapes accumulate observations at the same
//! pattern subject; once the count crosses the learning thresholds,
//! the pattern is promoted to `is-instinct` (≥ 3) then `is-skill`
//! (≥ 10). The substrate has learned to expect that failure shape.
//!
//! # Pure composition
//!
//! [`compose_failure_observation`] is a pure function from context
//! to claim set. Test-friendly and usable from CLI replay without
//! hub infrastructure.

use std::collections::{HashMap, HashSet};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;

use crate::foundation::IS_A_TERM;
use crate::learning::{
    DIAGNOSIS_OF, FAILURE_DIAGNOSIS, HAS_ERROR_TEXT, HAS_FAILURE_PATTERN, HAS_TASK_PREVIEW,
    OBSERVED,
};
use crate::ops::{EXITED_WITH_CODE, IS_FAILED, WROTE_STDERR};
use crate::planning::task::{HAS_COMMAND, IS_ASSIGNED_TO_TASK};

/// Inline-string truncation limit for preview / error-text cells.
pub const PREVIEW_LIMIT: usize = 240;

// ─────────────────────────────────────────────────────────────────────
// Pure composition
// ─────────────────────────────────────────────────────────────────────

/// Inputs for one failure observation.
pub struct FailureContext<'a> {
    /// The op that failed.
    pub op: &'a str,
    /// The op's task, if known.
    pub task: Option<&'a str>,
    /// The task's command line, if known.
    pub command: Option<&'a str>,
    /// `exited-with-code` value (numeric string or diagnostic word).
    pub exit_code: Option<&'a str>,
    /// `wrote-stderr` value (inline or blob ref).
    pub error_text: Option<&'a str>,
    /// ISO-8601 timestamp (observation time).
    pub observed_at: &'a str,
}

/// Compose the claim set for one failure observation. Returns
/// `(failure_subject, claims)`.
#[must_use]
pub fn compose_failure_observation(ctx: &FailureContext<'_>) -> (String, Vec<Claim>) {
    let failure = format!("failure:{}:{}", ctx.op, ctx.observed_at);
    let pattern = extract_pattern_key(ctx.exit_code, ctx.error_text);

    let mut claims = vec![
        Claim::new(&failure, IS_A_TERM, FAILURE_DIAGNOSIS),
        Claim::new(&failure, DIAGNOSIS_OF, ctx.op),
        Claim::new(&failure, HAS_FAILURE_PATTERN, &pattern),
        Claim::new(&pattern, OBSERVED, &failure),
    ];
    if let Some(command) = ctx.command {
        claims.push(Claim::new(
            &failure,
            HAS_TASK_PREVIEW,
            truncate(command, PREVIEW_LIMIT),
        ));
    }
    if let Some(error_text) = ctx.error_text {
        claims.push(Claim::new(
            &failure,
            HAS_ERROR_TEXT,
            truncate(error_text, PREVIEW_LIMIT),
        ));
    }
    if let Some(task) = ctx.task {
        claims.push(Claim::new(&failure, "diagnoses-task", task));
    }
    (failure, claims)
}

/// Derive a stable pattern subject from exit code / error text.
///
/// Heuristics:
/// - Numeric or diagnostic exit code → `pattern:exit-<code>`
/// - No code, has error text → `pattern:error-<first-alnum-token>`
/// - Neither → `pattern:unknown`
#[must_use]
pub fn extract_pattern_key(exit_code: Option<&str>, error_text: Option<&str>) -> String {
    if let Some(code) = exit_code {
        return format!("pattern:exit-{code}");
    }
    if let Some(text) = error_text {
        let token = text
            .split_whitespace()
            .next()
            .unwrap_or("unknown")
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_lowercase();
        if !token.is_empty() {
            return format!("pattern:error-{token}");
        }
    }
    "pattern:unknown".to_owned()
}

fn truncate(s: &str, limit: usize) -> String {
    if s.len() <= limit {
        s.to_owned()
    } else {
        let mut out = s[..limit].to_owned();
        out.push_str("…[truncated]");
        out
    }
}

// ─────────────────────────────────────────────────────────────────────
// Projection port
// ─────────────────────────────────────────────────────────────────────

/// Failure-observer projection state.
pub struct FailureObserverPort {
    task_for_op: HashMap<String, String>,
    command_for_task: HashMap<String, String>,
    exit_code_for_op: HashMap<String, String>,
    stderr_for_op: HashMap<String, String>,
    observed: HashSet<String>,
    now_iso: fn() -> String,
}

impl Default for FailureObserverPort {
    fn default() -> Self {
        Self::with_clock(default_now_iso)
    }
}

fn default_now_iso() -> String {
    "1970-01-01T00:00:00Z".to_owned()
}

impl FailureObserverPort {
    /// Fresh state with default clock.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Fresh state with an injectable clock — for deterministic tests.
    #[must_use]
    pub fn with_clock(now_iso: fn() -> String) -> Self {
        Self {
            task_for_op: HashMap::new(),
            command_for_task: HashMap::new(),
            exit_code_for_op: HashMap::new(),
            stderr_for_op: HashMap::new(),
            observed: HashSet::new(),
            now_iso,
        }
    }

    fn try_observe(&mut self, op: &str) -> Vec<Claim> {
        if self.observed.contains(op) {
            return Vec::new();
        }
        let task = self.task_for_op.get(op).cloned();
        let command = task
            .as_deref()
            .and_then(|t| self.command_for_task.get(t).cloned());
        let exit_code = self.exit_code_for_op.get(op).cloned();
        let error_text = self.stderr_for_op.get(op).cloned();
        let observed_at = (self.now_iso)();

        let ctx = FailureContext {
            op,
            task: task.as_deref(),
            command: command.as_deref(),
            exit_code: exit_code.as_deref(),
            error_text: error_text.as_deref(),
            observed_at: &observed_at,
        };
        let (_, claims) = compose_failure_observation(&ctx);
        self.observed.insert(op.to_owned());
        claims
    }
}

impl Projection for FailureObserverPort {
    fn identity(&self) -> &str {
        "mash-library-failure-observer"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            IS_FAILED.to_owned(),
            IS_ASSIGNED_TO_TASK.to_owned(),
            HAS_COMMAND.to_owned(),
            EXITED_WITH_CODE.to_owned(),
            WROTE_STDERR.to_owned(),
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
            self.try_observe(subject)
        } else if predicate == IS_ASSIGNED_TO_TASK {
            self.task_for_op.insert(subject.to_owned(), object.to_owned());
            Vec::new()
        } else if predicate == HAS_COMMAND {
            self.command_for_task
                .insert(subject.to_owned(), object.to_owned());
            Vec::new()
        } else if predicate == EXITED_WITH_CODE {
            self.exit_code_for_op
                .insert(subject.to_owned(), object.to_owned());
            Vec::new()
        } else if predicate == WROTE_STDERR {
            self.stderr_for_op
                .insert(subject.to_owned(), object.to_owned());
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
    fn pattern_from_numeric_exit_code() {
        assert_eq!(extract_pattern_key(Some("7"), None), "pattern:exit-7");
    }

    #[test]
    fn pattern_from_diagnostic_exit_word() {
        assert_eq!(
            extract_pattern_key(Some("spawn-failed"), None),
            "pattern:exit-spawn-failed"
        );
    }

    #[test]
    fn pattern_from_error_text_first_token() {
        assert_eq!(
            extract_pattern_key(None, Some("Permission denied: /etc/passwd")),
            "pattern:error-permission"
        );
    }

    #[test]
    fn pattern_unknown_when_no_signal() {
        assert_eq!(extract_pattern_key(None, None), "pattern:unknown");
    }

    #[test]
    fn observation_carries_pattern_and_observed_cell() {
        let ctx = FailureContext {
            op: "op:t:42",
            task: Some("task:t"),
            command: Some("rm -rf /"),
            exit_code: Some("1"),
            error_text: Some("Permission denied"),
            observed_at: "2026-04-21T04:00:00Z",
        };
        let (failure, claims) = compose_failure_observation(&ctx);
        assert_eq!(
            find_object(&claims, &failure, HAS_FAILURE_PATTERN),
            Some("pattern:exit-1")
        );
        assert_eq!(
            find_object(&claims, "pattern:exit-1", OBSERVED),
            Some(failure.as_str())
        );
    }

    #[test]
    fn three_failures_with_same_exit_code_share_pattern() {
        let base = |op: &'static str, ts: &'static str| FailureContext {
            op,
            task: None,
            command: None,
            exit_code: Some("7"),
            error_text: None,
            observed_at: ts,
        };
        let (f1, c1) = compose_failure_observation(&base("op:a", "t1"));
        let (f2, c2) = compose_failure_observation(&base("op:b", "t2"));
        let (f3, c3) = compose_failure_observation(&base("op:c", "t3"));
        let pattern = "pattern:exit-7";
        assert_eq!(find_object(&c1, pattern, OBSERVED), Some(f1.as_str()));
        assert_eq!(find_object(&c2, pattern, OBSERVED), Some(f2.as_str()));
        assert_eq!(find_object(&c3, pattern, OBSERVED), Some(f3.as_str()));
        assert_ne!(f1, f2);
        assert_ne!(f2, f3);
    }

    #[test]
    fn truncation_applies_to_long_previews() {
        let long = "x".repeat(500);
        let ctx = FailureContext {
            op: "op:big",
            task: None,
            command: Some(&long),
            exit_code: Some("1"),
            error_text: None,
            observed_at: "ts",
        };
        let (failure, claims) = compose_failure_observation(&ctx);
        let preview = find_object(&claims, &failure, HAS_TASK_PREVIEW).unwrap();
        assert!(preview.len() < 500);
        assert!(preview.ends_with("…[truncated]"));
    }

    fn fixed_ts() -> String {
        "2026-04-21T00:00:00Z".to_owned()
    }

    #[test]
    fn port_observes_failure_once_context_is_complete() {
        let mut port = FailureObserverPort::with_clock(fixed_ts);
        let _ = port.ingest("op:x", IS_ASSIGNED_TO_TASK, "task:x", Value::True);
        let _ = port.ingest("task:x", HAS_COMMAND, "echo hi", Value::True);
        let _ = port.ingest("op:x", EXITED_WITH_CODE, "7", Value::True);
        let out = port.ingest("op:x", IS_FAILED, "op:x", Value::True);
        assert!(!out.is_empty());
        assert!(out.iter().any(|c| c.predicate == HAS_FAILURE_PATTERN
            && c.object == "pattern:exit-7"));
    }

    #[test]
    fn port_is_idempotent_per_op() {
        let mut port = FailureObserverPort::with_clock(fixed_ts);
        let _ = port.ingest("op:y", EXITED_WITH_CODE, "1", Value::True);
        let first = port.ingest("op:y", IS_FAILED, "op:y", Value::True);
        assert!(!first.is_empty());
        let again = port.ingest("op:y", IS_FAILED, "op:y", Value::True);
        assert!(again.is_empty(), "re-failure must not re-observe");
    }

    #[test]
    fn port_ignores_non_true_settlements() {
        let mut port = FailureObserverPort::with_clock(fixed_ts);
        let out = port.ingest("op:z", IS_FAILED, "op:z", Value::False);
        assert!(out.is_empty());
    }
}
