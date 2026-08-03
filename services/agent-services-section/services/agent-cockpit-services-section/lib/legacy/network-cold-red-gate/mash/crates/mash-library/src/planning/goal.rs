//! Goal — desired outcome with required capabilities.
//!
//! A goal declares the capabilities needed to achieve it via
//! [`crate::capability::REQUIRES_CAPABILITY`] cells. A plan-
//! decomposer port watches goals, matches their required capabilities
//! against `has-effective-capability` cells at account / office
//! subjects, and proposes candidate sub-task subjects at the goal.
//!
//! # Shape
//!
//! ```text
//! (goal:<id>, is-a, goal)
//! (goal:<id>, requires-capability, <cap>)          [multi-valued]
//! (goal:<id>, has-candidate-subtask, task:proposed:<goal>:<cap>:<account>)
//!
//! (candidate, is-a, task)
//! (candidate, proposed-for-goal, goal:<id>)
//! (candidate, requires-capability, <cap>)
//! (candidate, proposed-for-account, <account>)
//! ```
//!
//! # Acceptance
//!
//! Proposing is not assigning. A candidate is a suggestion; the
//! scene / human / dispatch cascade decides whether to move it
//! forward by witnessing the usual task lifecycle claims. The
//! decomposer is silent on acceptance.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-goal";

/// A desired outcome. Subjects use `goal:<id>`.
pub const GOAL: &str = "goal";

/// `(goal, has-candidate-subtask, task)` — decomposer-proposed
/// candidate. Multi-valued.
pub const HAS_CANDIDATE_SUBTASK: &str = "has-candidate-subtask";

/// `(candidate-task, proposed-for-goal, goal)` — the goal the
/// candidate was proposed against.
pub const PROPOSED_FOR_GOAL: &str = "proposed-for-goal";

/// `(candidate-task, proposed-for-account, account)` — the account
/// whose effective-capability the decomposer matched against. The
/// decomposer picks one candidate per (goal, cap, account) triple,
/// so this predicate is single-valued per candidate.
pub const PROPOSED_FOR_ACCOUNT: &str = "proposed-for-account";

/// Owner-agent declaring the goal vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Goal;

#[async_trait]
impl Agent for Goal {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();
        out.push(Claim::new(GOAL, IS_A_TERM, IDENTITY));
        for p in [HAS_CANDIDATE_SUBTASK, PROPOSED_FOR_GOAL, PROPOSED_FOR_ACCOUNT] {
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
    fn goal_term_declared() {
        assert!(Goal
            .claims()
            .iter()
            .any(|c| c.subject == GOAL && c.predicate == IS_A_TERM));
    }

    #[test]
    fn candidate_predicates_declared() {
        let claims = Goal.claims();
        for p in [HAS_CANDIDATE_SUBTASK, PROPOSED_FOR_GOAL, PROPOSED_FOR_ACCOUNT] {
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
        let claims = Goal.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "goal module should declare no INVERTS_AS wiring"
        );
    }
}
