//! Learning — instinct/skill promotion via threshold cardinality.
//!
//! # Pattern recognition through accumulation
//!
//! A subject accumulates `observed` cells one per sighting.
//! When the count crosses [`INSTINCT_THRESHOLD`] (3), the
//! [`LearningPort`] lifts every accumulated witness into the
//! `is-instinct` fiber. When it crosses [`SKILL_THRESHOLD`] (10),
//! they lift into `is-skill`.
//!
//! `is-skill` specializes-as `is-instinct`, so observers of the
//! instinctual layer automatically see the promoted skills through
//! the cascade.
//!
//! # Failure diagnosis as pattern-subject
//!
//! A failure-observer port (future work) mints
//! `failure:<op>:<iso>` subjects for each op failure and classifies
//! them into `pattern:<key>` subjects. The cardinality port counts
//! `(pattern, observed, failure)` cells — recurring failures
//! become instincts, then skills, signaling the ship has learned to
//! expect them.
//!
//! # Retention policy
//!
//! The substrate keeps full history by default. [`RETENTION_POLICY`]
//! terms classify how long to keep a subject's history before
//! compaction: full / compact / detailed. Honored by compaction
//! ports (not implemented here).
//!
//! # Inversion discipline
//!
//! The old `mash-vocab-learning` declared three INVERTS_AS pairs
//! (HAS_RETENTION_POLICY/RETENTION_POLICY_OF, DIAGNOSIS_OF/HAS_DIAGNOSIS,
//! HAS_FAILURE_PATTERN/PATTERN_OF). All converse-positive, dropped.

use async_trait::async_trait;
use std::collections::{HashMap, HashSet};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::{Agent, Projection};
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-learning";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A recurring pattern observed enough to be named.
pub const INSTINCT: &str = "instinct";

/// A pattern observed enough to deserve careful retention.
/// Specializes-as [`INSTINCT`].
pub const SKILL: &str = "skill";

/// A retention policy classifying history-keeping policy.
pub const RETENTION_POLICY: &str = "retention-policy";

/// Full history kept.
pub const RETENTION_FULL: &str = "retention:full";

/// Only latest value of each cell kept.
pub const RETENTION_COMPACT: &str = "retention:compact";

/// Cells plus derivation chains kept.
pub const RETENTION_DETAILED: &str = "retention:detailed";

/// A structured failure record. Subject form `failure:<op>:<iso>`.
pub const FAILURE_DIAGNOSIS: &str = "failure-diagnosis";

/// A recurring failure shape extracted from diagnoses. Subject form
/// `pattern:<key>` where key is a short stable string (e.g.
/// `pattern:exit-7`).
pub const PATTERN: &str = "pattern";

// ─────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────

/// `(subject, observed, witness)` — bare observation. The
/// [`LearningPort`] counts cells at this predicate per subject.
pub const OBSERVED: &str = "observed";

/// `(subject, is-instinct, witness)` — promotion output.
pub const IS_INSTINCT: &str = "is-instinct";

/// `(subject, is-skill, witness)` — promotion output; specializes-as
/// [`IS_INSTINCT`].
pub const IS_SKILL: &str = "is-skill";

/// `(subject, has-retention-policy, retention-term)` — subject's
/// retention policy.
pub const HAS_RETENTION_POLICY: &str = "has-retention-policy";

/// `(failure, diagnosis-of, op)` — failure diagnosis points at the
/// op it diagnoses.
pub const DIAGNOSIS_OF: &str = "diagnosis-of";

/// `(failure, has-task-preview, string)` — short preview of the
/// task's command line.
pub const HAS_TASK_PREVIEW: &str = "has-task-preview";

/// `(failure, has-error-text, string-or-blob-ref)` — error message
/// or stderr capture.
pub const HAS_ERROR_TEXT: &str = "has-error-text";

/// `(failure, has-failure-pattern, pattern)` — pattern the diagnosis
/// was classified into.
pub const HAS_FAILURE_PATTERN: &str = "has-failure-pattern";

// ─────────────────────────────────────────────────────────────────────
// Thresholds
// ─────────────────────────────────────────────────────────────────────

/// Promotion threshold to instinct.
pub const INSTINCT_THRESHOLD: usize = 3;

/// Promotion threshold to skill.
pub const SKILL_THRESHOLD: usize = 10;

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the learning vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Learning;

#[async_trait]
impl Agent for Learning {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        for t in [
            INSTINCT,
            SKILL,
            RETENTION_POLICY,
            RETENTION_FULL,
            RETENTION_COMPACT,
            RETENTION_DETAILED,
            FAILURE_DIAGNOSIS,
            PATTERN,
        ] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }

        for p in [
            OBSERVED,
            IS_INSTINCT,
            IS_SKILL,
            HAS_RETENTION_POLICY,
            DIAGNOSIS_OF,
            HAS_TASK_PREVIEW,
            HAS_ERROR_TEXT,
            HAS_FAILURE_PATTERN,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // Skill is a developed instinct; both the term and the
        // promotion-output predicate specialize-as instinct so
        // observers see skills through the instinct fiber.
        out.push(Claim::new(SKILL, SPECIALIZES_AS, INSTINCT));
        out.push(Claim::new(IS_SKILL, SPECIALIZES_AS, IS_INSTINCT));

        out
    }
}

// ─────────────────────────────────────────────────────────────────────
// Promotion projection
// ─────────────────────────────────────────────────────────────────────

/// Cardinality port: watches [`OBSERVED`], promotes subjects past
/// thresholds to [`IS_INSTINCT`] / [`IS_SKILL`].
///
/// On first threshold-crossing the port lifts every accumulated
/// witness into the promoted fiber. Post-promotion, new observations
/// also lift, keeping the promoted fiber in correspondence with
/// `observed`.
#[derive(Debug, Default)]
pub struct LearningPort {
    /// Per-subject distinct-object set.
    observed: HashMap<String, HashSet<String>>,
    /// Subjects already promoted to instinct.
    promoted_instinct: HashSet<String>,
    /// Subjects already promoted to skill.
    promoted_skill: HashSet<String>,
}

impl LearningPort {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Current observation count for a subject (distinct witnesses).
    #[must_use]
    pub fn count_for(&self, subject: &str) -> usize {
        self.observed.get(subject).map_or(0, HashSet::len)
    }

    fn maybe_promote(
        &mut self,
        subject: &str,
        latest: &str,
        newly_inserted: bool,
    ) -> Vec<Claim> {
        let count = self.count_for(subject);
        let mut out = Vec::new();

        // Instinct promotion.
        if count >= INSTINCT_THRESHOLD && !self.promoted_instinct.contains(subject) {
            if let Some(set) = self.observed.get(subject) {
                for w in set {
                    out.push(Claim::new(subject, IS_INSTINCT, w));
                }
            }
            self.promoted_instinct.insert(subject.to_owned());
        } else if self.promoted_instinct.contains(subject) && newly_inserted {
            out.push(Claim::new(subject, IS_INSTINCT, latest));
        }

        // Skill promotion.
        if count >= SKILL_THRESHOLD && !self.promoted_skill.contains(subject) {
            if let Some(set) = self.observed.get(subject) {
                for w in set {
                    out.push(Claim::new(subject, IS_SKILL, w));
                }
            }
            self.promoted_skill.insert(subject.to_owned());
        } else if self.promoted_skill.contains(subject) && newly_inserted {
            out.push(Claim::new(subject, IS_SKILL, latest));
        }

        out
    }
}

impl Projection for LearningPort {
    fn identity(&self) -> &str {
        "mash-library-learning-port"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![OBSERVED.to_owned()]
    }

    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
        value: Value,
    ) -> Vec<Claim> {
        if value != Value::True || predicate != OBSERVED {
            return Vec::new();
        }
        let inserted = self
            .observed
            .entry(subject.to_owned())
            .or_default()
            .insert(object.to_owned());
        self.maybe_promote(subject, object, inserted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::foundation::INVERTS_AS;

    #[test]
    fn skill_specializes_as_instinct() {
        let claims = Learning.claims();
        assert!(claims.iter().any(|c| c.subject == SKILL
            && c.predicate == SPECIALIZES_AS
            && c.object == INSTINCT));
        assert!(claims.iter().any(|c| c.subject == IS_SKILL
            && c.predicate == SPECIALIZES_AS
            && c.object == IS_INSTINCT));
    }

    #[test]
    fn no_spurious_inversions() {
        let claims = Learning.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "learning should declare no INVERTS_AS wiring"
        );
    }

    #[test]
    fn thresholds_ordered() {
        assert!(INSTINCT_THRESHOLD < SKILL_THRESHOLD);
    }

    #[test]
    fn observation_below_threshold_does_not_promote() {
        let mut port = LearningPort::new();
        let _ = port.ingest("pattern:exit-7", OBSERVED, "failure-1", Value::True);
        let out = port.ingest("pattern:exit-7", OBSERVED, "failure-2", Value::True);
        assert!(
            out.is_empty(),
            "2 observations < INSTINCT_THRESHOLD; no promotion yet"
        );
    }

    #[test]
    fn instinct_promotion_lifts_all_accumulated_witnesses() {
        let mut port = LearningPort::new();
        let _ = port.ingest("pattern:exit-7", OBSERVED, "failure-1", Value::True);
        let _ = port.ingest("pattern:exit-7", OBSERVED, "failure-2", Value::True);
        let out = port.ingest("pattern:exit-7", OBSERVED, "failure-3", Value::True);
        let is_instinct_count = out.iter().filter(|c| c.predicate == IS_INSTINCT).count();
        assert_eq!(
            is_instinct_count, 3,
            "crossing threshold should lift all 3 accumulated witnesses"
        );
    }

    #[test]
    fn post_promotion_observations_also_lift() {
        let mut port = LearningPort::new();
        // Promote first.
        let _ = port.ingest("pattern:x", OBSERVED, "f1", Value::True);
        let _ = port.ingest("pattern:x", OBSERVED, "f2", Value::True);
        let _ = port.ingest("pattern:x", OBSERVED, "f3", Value::True);
        // New observation post-promotion should lift.
        let out = port.ingest("pattern:x", OBSERVED, "f4", Value::True);
        assert!(out
            .iter()
            .any(|c| c.predicate == IS_INSTINCT && c.object == "f4"));
    }

    #[test]
    fn duplicate_witness_does_not_double_count() {
        let mut port = LearningPort::new();
        let _ = port.ingest("pattern:x", OBSERVED, "f1", Value::True);
        let _ = port.ingest("pattern:x", OBSERVED, "f1", Value::True);
        let _ = port.ingest("pattern:x", OBSERVED, "f1", Value::True);
        assert_eq!(port.count_for("pattern:x"), 1);
        // Did not promote — only 1 distinct witness.
        let out = port.ingest("pattern:x", OBSERVED, "f1", Value::True);
        assert!(out.is_empty());
    }

    #[test]
    fn skill_promotion_at_higher_threshold() {
        let mut port = LearningPort::new();
        for i in 0..SKILL_THRESHOLD {
            let witness = format!("f{i}");
            let _ = port.ingest("pattern:x", OBSERVED, &witness, Value::True);
        }
        // After SKILL_THRESHOLD distinct witnesses, IS_SKILL is emitted.
        // We check that the port has at least observed promotion to skill
        // by the last emission.
        assert!(port.count_for("pattern:x") == SKILL_THRESHOLD);
        assert!(port.promoted_instinct.contains("pattern:x"));
        assert!(port.promoted_skill.contains("pattern:x"));
    }

    #[test]
    fn non_observed_predicate_ignored() {
        let mut port = LearningPort::new();
        let out = port.ingest("pattern:x", "some-other", "x", Value::True);
        assert!(out.is_empty());
    }

    #[test]
    fn non_true_value_ignored() {
        let mut port = LearningPort::new();
        let out = port.ingest("pattern:x", OBSERVED, "f1", Value::False);
        assert!(out.is_empty());
    }
}
