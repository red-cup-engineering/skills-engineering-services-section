//! Correlation — n-ary rules that fire when all premise predicates
//! settle true on the same subject.
//!
//! # What a correlation rule is
//!
//! A correlation rule is a subject carrying a list of premise
//! predicates and one output predicate. Each premise slot is declared
//! as `(rule, correlates-via-<slot>, premise-pred)`; the output is
//! `(rule, correlates-into, output-pred)`. When every premise has
//! settled true on some subject X, the port emits
//! `(X, output-pred, rule-id)` — the rule that fired is the cell's
//! witness, so the derivation chain stays legible from the fiber
//! alone.
//!
//! # Why a port rather than pure cascade morphisms
//!
//! The bilattice cascade provides a binary composition (pointwise
//! k-meet) and a binary implication (Chu residuation). Correlations
//! of arity > 2 are emulable by chaining compositions, but the
//! intermediate predicates pollute the substrate with rule-specific
//! terms. A projection port consumes the rule declaration and tracks
//! per-(rule, subject) satisfaction sets internally, emitting only
//! the rule's output predicate — no intermediate pollution.
//!
//! # Static subscription constraint
//!
//! The old-library port dynamically subscribed to premise predicates
//! as it discovered rule declarations. The current [`Projection`]
//! trait takes subscriptions at mount time and does not re-subscribe.
//!
//! [`CorrelationPort`] therefore requires premise predicates to be
//! passed at construction — the caller who wires the rules knows
//! them. Dynamic re-subscription is a subprocess-binary concern
//! (the hub supports `Subscribe` post-connect); the in-process
//! projection form uses static subscriptions.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-vocab-correlation` used slot names
//! `a`/`b`/`c` limiting rules to 3-arity. This module drops that
//! cap: slots are positional integers and rules can declare any
//! number of premises. `CORRELATES_VIA_A`/`B`/`C` are kept as
//! well-known shortcuts for the common 3-arity case but slot names
//! are free-form.

use async_trait::async_trait;
use std::collections::{BTreeSet, HashMap, HashSet};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::{Agent, Projection};
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-correlation";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A correlation rule subject.
pub const CORRELATION_RULE: &str = "correlation-rule";

// ─────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────

/// `(rule, correlates-via, premise-pred)` — generic premise slot.
/// Use when the rule doesn't care which slot a premise occupies
/// (equivalently: all slots are conjunctive and unordered).
pub const CORRELATES_VIA: &str = "correlates-via";

/// `(rule, correlates-via-a, premise-pred)` — first of three named
/// slots. Kept for compatibility with the common old-library 3-arity
/// shape; semantically identical to [`CORRELATES_VIA`].
pub const CORRELATES_VIA_A: &str = "correlates-via-a";

/// `(rule, correlates-via-b, premise-pred)` — second named slot.
pub const CORRELATES_VIA_B: &str = "correlates-via-b";

/// `(rule, correlates-via-c, premise-pred)` — third named slot.
pub const CORRELATES_VIA_C: &str = "correlates-via-c";

/// `(rule, correlates-into, output-pred)` — predicate to emit when
/// all premises settle on a shared subject.
pub const CORRELATES_INTO: &str = "correlates-into";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the correlation vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Correlation;

#[async_trait]
impl Agent for Correlation {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();
        out.push(Claim::new(CORRELATION_RULE, IS_A_TERM, IDENTITY));
        for p in [
            CORRELATES_VIA,
            CORRELATES_VIA_A,
            CORRELATES_VIA_B,
            CORRELATES_VIA_C,
            CORRELATES_INTO,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }
        out
    }
}

// ─────────────────────────────────────────────────────────────────────
// Rule spec — caller-supplied definition of a single rule
// ─────────────────────────────────────────────────────────────────────

/// Static declaration of a correlation rule.
#[derive(Clone, Debug)]
pub struct RuleSpec {
    /// Subject identifier that the rule will be witnessed under.
    pub rule_id: String,
    /// Premise predicates (in any slot order).
    pub premises: Vec<String>,
    /// Output predicate to emit at the shared subject.
    pub output: String,
}

impl RuleSpec {
    /// Convenience: build a 3-arity rule.
    #[must_use]
    pub fn three(rule_id: &str, a: &str, b: &str, c: &str, output: &str) -> Self {
        Self {
            rule_id: rule_id.to_owned(),
            premises: vec![a.to_owned(), b.to_owned(), c.to_owned()],
            output: output.to_owned(),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// Projection
// ─────────────────────────────────────────────────────────────────────

/// Correlation projection: watches a set of known rules' premise
/// predicates and emits the output predicate when every premise
/// settles on a shared subject.
///
/// Construct with a concrete rule list. All premise predicates across
/// all rules are aggregated into the subscription set at mount time.
pub struct CorrelationPort {
    rules: Vec<RuleSpec>,
    /// premise predicate → rules that include it.
    premise_to_rules: HashMap<String, HashSet<usize>>,
    /// (rule-index, subject) → set of premise predicates satisfied.
    satisfaction: HashMap<(usize, String), HashSet<String>>,
    /// (rule-index, subject) pairs already emitted.
    emitted: HashSet<(usize, String)>,
}

impl CorrelationPort {
    /// Build from a rule list.
    #[must_use]
    pub fn new(rules: Vec<RuleSpec>) -> Self {
        let mut premise_to_rules: HashMap<String, HashSet<usize>> = HashMap::new();
        for (i, rule) in rules.iter().enumerate() {
            for premise in &rule.premises {
                premise_to_rules
                    .entry(premise.clone())
                    .or_default()
                    .insert(i);
            }
        }
        Self {
            rules,
            premise_to_rules,
            satisfaction: HashMap::new(),
            emitted: HashSet::new(),
        }
    }

    fn maybe_emit(&mut self, rule_idx: usize, subject: &str) -> Option<Claim> {
        let key = (rule_idx, subject.to_owned());
        if self.emitted.contains(&key) {
            return None;
        }
        let rule = &self.rules[rule_idx];
        let satisfied = self.satisfaction.get(&key)?;
        let needed: BTreeSet<&str> = rule.premises.iter().map(String::as_str).collect();
        if !needed
            .iter()
            .all(|p| satisfied.contains(&(*p).to_owned()))
        {
            return None;
        }
        self.emitted.insert(key);
        Some(Claim::new(subject, &rule.output, &rule.rule_id))
    }
}

impl Projection for CorrelationPort {
    fn identity(&self) -> &str {
        "mash-library-correlation-port"
    }

    fn subscriptions(&self) -> Vec<String> {
        let mut subs: BTreeSet<String> = BTreeSet::new();
        for rule in &self.rules {
            for p in &rule.premises {
                subs.insert(p.clone());
            }
        }
        subs.into_iter().collect()
    }

    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        _object: &str,
        value: Value,
    ) -> Vec<Claim> {
        if value != Value::True {
            return Vec::new();
        }
        let Some(rule_ids) = self.premise_to_rules.get(predicate).cloned() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for idx in rule_ids {
            let key = (idx, subject.to_owned());
            self.satisfaction
                .entry(key)
                .or_default()
                .insert(predicate.to_owned());
            if let Some(claim) = self.maybe_emit(idx, subject) {
                out.push(claim);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocabulary_declared() {
        let claims = Correlation.claims();
        for p in [
            CORRELATES_VIA,
            CORRELATES_VIA_A,
            CORRELATES_VIA_B,
            CORRELATES_VIA_C,
            CORRELATES_INTO,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared as a predicate"
            );
        }
    }

    #[test]
    fn three_arity_rule_fires_when_all_premises_settle() {
        let rule = RuleSpec::three(
            "rule:value-and-scope-and-expected",
            "has-value",
            "has-scope",
            "has-expected",
            "produced-finding",
        );
        let mut port = CorrelationPort::new(vec![rule]);

        let a = port.ingest("subject:42", "has-value", "v", Value::True);
        assert!(a.is_empty());
        let b = port.ingest("subject:42", "has-scope", "s", Value::True);
        assert!(b.is_empty());
        let c = port.ingest("subject:42", "has-expected", "e", Value::True);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].subject, "subject:42");
        assert_eq!(c[0].predicate, "produced-finding");
        assert_eq!(c[0].object, "rule:value-and-scope-and-expected");
    }

    #[test]
    fn rule_does_not_fire_across_different_subjects() {
        let rule = RuleSpec::three("rule-x", "p1", "p2", "p3", "out");
        let mut port = CorrelationPort::new(vec![rule]);
        let _ = port.ingest("subject-a", "p1", "_", Value::True);
        let _ = port.ingest("subject-b", "p2", "_", Value::True);
        let _ = port.ingest("subject-a", "p3", "_", Value::True);
        // subject-a has p1, p3 only — should not fire.
        // subject-b has p2 only — should not fire.
        // No emission yet.
        let final_out = port.ingest("subject-a", "p2", "_", Value::True);
        // Now subject-a is complete.
        assert_eq!(final_out.len(), 1);
        assert_eq!(final_out[0].subject, "subject-a");
    }

    #[test]
    fn multiple_rules_share_premise_predicates() {
        let rule_one = RuleSpec {
            rule_id: "rule-1".into(),
            premises: vec!["shared".into(), "one-only".into()],
            output: "out-1".into(),
        };
        let rule_two = RuleSpec {
            rule_id: "rule-2".into(),
            premises: vec!["shared".into(), "two-only".into()],
            output: "out-2".into(),
        };
        let mut port = CorrelationPort::new(vec![rule_one, rule_two]);

        // Subscriptions deduplicate.
        let subs = port.subscriptions();
        assert_eq!(subs.len(), 3, "subscriptions should dedupe shared premise");

        let _ = port.ingest("s", "shared", "_", Value::True);
        let r1 = port.ingest("s", "one-only", "_", Value::True);
        assert_eq!(r1.len(), 1);
        assert_eq!(r1[0].predicate, "out-1");

        let r2 = port.ingest("s", "two-only", "_", Value::True);
        assert_eq!(r2.len(), 1);
        assert_eq!(r2[0].predicate, "out-2");
    }

    #[test]
    fn emission_is_once_per_rule_subject_pair() {
        let rule = RuleSpec::three("rule-x", "p1", "p2", "p3", "out");
        let mut port = CorrelationPort::new(vec![rule]);
        let _ = port.ingest("s", "p1", "_", Value::True);
        let _ = port.ingest("s", "p2", "_", Value::True);
        let first = port.ingest("s", "p3", "_", Value::True);
        assert_eq!(first.len(), 1);
        let again = port.ingest("s", "p1", "_", Value::True);
        assert!(again.is_empty(), "must not re-emit on redundant premise");
    }

    #[test]
    fn non_true_values_ignored() {
        let rule = RuleSpec::three("rule-x", "p1", "p2", "p3", "out");
        let mut port = CorrelationPort::new(vec![rule]);
        let out = port.ingest("s", "p1", "_", Value::False);
        assert!(out.is_empty());
    }

    #[test]
    fn unknown_predicate_is_noop() {
        let rule = RuleSpec::three("rule-x", "p1", "p2", "p3", "out");
        let mut port = CorrelationPort::new(vec![rule]);
        let out = port.ingest("s", "unrelated", "_", Value::True);
        assert!(out.is_empty());
    }
}
