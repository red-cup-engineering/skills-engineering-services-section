//! Dispatch — what picks which operations to feed the cascade CPU.
//!
//! An operation is an instruction; the proof engine is the CPU that
//! settles claims; but the CPU doesn't decide which ops to run next.
//! Dispatch does. Dispatch is substrate-native: the "queue" is the
//! set of `candidate` subjects where `is-admissible` has settled and
//! `is-undercut` has not. A selector port picks among admissible-
//! uncontested candidates and witnesses `is-selected`.
//!
//! # The candidate-subject pattern
//!
//! For each (operation, performer) pair under consideration, a
//! `candidate` subject is minted. All dispatch reasoning happens at
//! that candidate's fiber:
//!
//! - `(candidate, considers-op, op)` and `(candidate,
//!   considers-performer, performer)` link it to the two subjects
//!   it's adjudicating.
//! - Admission-chain predicates settle pointwise at the candidate
//!   (same `(s, o)` for each stage).
//! - Undercut predicates settle when any blocker is observed.
//! - Selection settles when the selector decides.
//!
//! # Two admission paths — simple and 8-stage
//!
//! The cascade accepts both:
//!
//! ## Simple (2-premise) path
//!
//! `IS_OP_READY ∧ IS_PERFORMER_AVAILABLE → IS_ADMISSIBLE`
//!
//! Rule-ports emit the two summary premises directly. Fast to
//! wire for scenes that don't need fine-grained reasoning.
//!
//! ## Full 8-stage chain
//!
//! For scenes that want the substrate to derive admissibility
//! from fine-grained sensors:
//!
//! 1. `DISPATCH_RUN_OPEN ∧ DISPATCH_RUN_UNASSIGNED → DISPATCH_RUN_AVAILABLE`
//! 2. `DISPATCH_TASK_OPEN ∧ DISPATCH_DEPENDENCIES_SATISFIED → DISPATCH_TASK_ROUTABLE`
//! 3. `DISPATCH_TASK_ROUTABLE ∧ DISPATCH_APPROVALS_SATISFIED → DISPATCH_TASK_CLEAR`
//! 4. `DISPATCH_RUN_AVAILABLE ∧ DISPATCH_TASK_CLEAR → DISPATCH_OPEN`
//! 5. `DISPATCH_OPEN ∧ DISPATCH_CAPABILITY_FIT → DISPATCH_OPEN_CAPABLE`
//! 6. `DISPATCH_OPEN_CAPABLE ∧ DISPATCH_WORKER_FIT → DISPATCH_WORKER_READY`
//! 7. `DISPATCH_WORKER_READY ∧ DISPATCH_PROVIDER_FIT → DISPATCH_PROVIDER_READY`
//! 8. `DISPATCH_PROVIDER_READY ∧ DISPATCH_POLICY_FIT → IS_ADMISSIBLE`
//!
//! The chain's output [`IS_ADMISSIBLE`] coincides with the simple
//! path's output — either derivation settles the same cell. All
//! premises and intermediate outputs are pointwise cells at the
//! candidate subject; the chain fires stage-by-stage as sensors
//! witness their parts.
//!
//! ## Undercuts
//!
//! Any of nine blockers witnessed at the candidate residuates
//! admissibility into [`IS_UNDERCUT`]:
//!
//! - DISPATCH_RUN_BLOCKED, DISPATCH_RUN_ALREADY_ASSIGNED,
//! - DISPATCH_TASK_CLOSED, DISPATCH_DEPENDENCY_BLOCK,
//!   DISPATCH_APPROVAL_BLOCK,
//! - DISPATCH_WORKER_MISMATCH, DISPATCH_PROVIDER_MISMATCH,
//!   DISPATCH_POLICY_MISMATCH,
//! - [`IS_FAILURE_RISK`] (predicted failure).
//!
//! Plus the simple-path undercuts: [`IS_CAPABILITY_MISMATCHED`],
//! [`IS_PERFORMER_UNAVAILABLE`], [`IS_POLICY_MISMATCHED`],
//! [`IS_DUTY_GATED`], [`IS_FAILURE_RISK`].
//!
//! Selection — picking one candidate from the admissible-uncontested
//! set — requires ordering/uniqueness that can't come from a single
//! composition; it belongs to a selector port that subscribes to
//! `IS_ADMISSIBLE ∧ ¬IS_UNDERCUT` and emits `IS_SELECTED` on the
//! chosen candidate.
//!
//! # Wiener/Barad framing
//!
//! No dispatch queue as a data structure. The queue is the set of
//! candidates whose fibers carry `is-admissible` True and `is-
//! undercut` not-True. Adding a candidate is minting a subject and
//! witnessing the linking claims; removing is witnessing phase
//! transitions that cascade to undercut or selection.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-vocab-dispatch/src/lib.rs` — 8-stage
//! admission chain with 9 undercut implications, preference fusion,
//! selector port. The present module ports all of that: full 8-stage
//! chain, 13 undercut implications (9 fine-grained + 4 simple-path
//! aliases + one capability-mismatch reused across paths), preference
//! fusion ([`FUSE_PREFERENCES`]), and the selector port at
//! [`crate::dispatch_selector`].

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{
    COMPOSES_INTO, FUSES_INTO, IMPLIES_INTO, IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS,
    USES_AS_ANTECEDENT, USES_AS_COMPOSITION_LEFT, USES_AS_COMPOSITION_RIGHT, USES_AS_CONSEQUENT,
    USES_AS_FUSION_LEFT, USES_AS_FUSION_RIGHT,
    THING,
};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-dispatch";

// ─────────────────────────────────────────────────────────────────────
// Category term
// ─────────────────────────────────────────────────────────────────────

/// A `(operation, performer)` pair being adjudicated for dispatch.
pub const CANDIDATE: &str = "candidate";

// ─────────────────────────────────────────────────────────────────────
// Linking predicates
// ─────────────────────────────────────────────────────────────────────

/// `(candidate, considers-op, op)` — which operation this candidate
/// is considering.
pub const CONSIDERS_OP: &str = "considers-op";

/// `(candidate, considers-performer, performer)` — which performer
/// this candidate proposes to run the op.
pub const CONSIDERS_PERFORMER: &str = "considers-performer";

// ─────────────────────────────────────────────────────────────────────
// Admission predicates — land at the candidate subject pointwise.
// The marker object is the owner identity (same for all so
// compositions fire pointwise at shared `(s, o)`).
// ─────────────────────────────────────────────────────────────────────

/// `(candidate, is-op-ready, marker)` — op is intent-set and pending.
/// Witnessed by a rule-port that observes the op's phase + intent.
pub const IS_OP_READY: &str = "is-op-ready";

/// `(candidate, is-performer-available, marker)` — performer can take
/// work. Witnessed by a rule-port observing the performer's
/// availability.
pub const IS_PERFORMER_AVAILABLE: &str = "is-performer-available";

/// `(candidate, is-admissible, marker)` — composed via
/// `IS_OP_READY ∧ IS_PERFORMER_AVAILABLE`. Settles when both premises
/// are True at the same candidate.
pub const IS_ADMISSIBLE: &str = "is-admissible";

// ─────────────────────────────────────────────────────────────────────
// 8-stage chain: fine-grained premises and intermediate outputs
//
// Each fires pointwise at the candidate subject. Rule-ports emit the
// leaf premises; the cascade composes them stage-by-stage.
// ─────────────────────────────────────────────────────────────────────

/// Premise (leaf): the run is open for work. Asserted by matchmaking
/// when the candidate's associated run has no terminal settlement.
pub const DISPATCH_RUN_OPEN: &str = "dispatch-run-open";

/// Premise (leaf): no worker is yet bound to the run. Asserted when
/// the run has not settled `has-assigned-worker`.
pub const DISPATCH_RUN_UNASSIGNED: &str = "dispatch-run-unassigned";

/// Stage-1 output: run is open and unassigned.
pub const DISPATCH_RUN_AVAILABLE: &str = "dispatch-run-available";

/// Premise (leaf): the task is open (accepting dispatch).
pub const DISPATCH_TASK_OPEN: &str = "dispatch-task-open";

/// Premise (leaf): the task's all-dependencies-satisfied rollup has
/// settled. Emitted by a bridge port lifting the task's
/// [`crate::planning::task::HAS_ALL_DEPENDENCIES_SATISFIED`] to the
/// candidate.
pub const DISPATCH_DEPENDENCIES_SATISFIED: &str = "dispatch-dependencies-satisfied";

/// Stage-2 output: task is open and deps are satisfied.
pub const DISPATCH_TASK_ROUTABLE: &str = "dispatch-task-routable";

/// Premise (leaf): all required approvals granted. Bridged from the
/// task's [`crate::approval::HAS_ALL_APPROVALS_SATISFIED`].
pub const DISPATCH_APPROVALS_SATISFIED: &str = "dispatch-approvals-satisfied";

/// Stage-3 output: task is routable and approvals are in.
pub const DISPATCH_TASK_CLEAR: &str = "dispatch-task-clear";

/// Stage-4 output: run-available and task-clear — both sides of the
/// op-side admissibility picture are ready.
pub const DISPATCH_OPEN: &str = "dispatch-open";

/// Premise (leaf): the worker holds the capabilities the op
/// requires. Emitted by the [`crate::capability::CapabilityResolverPort`]
/// — there already as [`crate::capability::IS_CAPABILITY_FIT`] at
/// the candidate.
pub const DISPATCH_CAPABILITY_FIT: &str = "dispatch-capability-fit";

/// Stage-5 output: op-side open and capabilities fit.
pub const DISPATCH_OPEN_CAPABLE: &str = "dispatch-open-capable";

/// Premise (leaf): worker kind matches the op's
/// [`crate::workers::USES_SHELL_WORKER`] /
/// [`crate::workers::USES_LLM_WORKER`] / etc. binding.
pub const DISPATCH_WORKER_FIT: &str = "dispatch-worker-fit";

/// Stage-6 output: capability-clear and worker-fit.
pub const DISPATCH_WORKER_READY: &str = "dispatch-worker-ready";

/// Premise (leaf): provider (LLM tier, container runtime) is
/// available and matches the op's requirements.
pub const DISPATCH_PROVIDER_FIT: &str = "dispatch-provider-fit";

/// Stage-7 output: worker-ready and provider-fit.
pub const DISPATCH_PROVIDER_READY: &str = "dispatch-provider-ready";

/// Premise (leaf): policies attached to op / performer / office all
/// cleared.
pub const DISPATCH_POLICY_FIT: &str = "dispatch-policy-fit";

// Stage-8 output is [`IS_ADMISSIBLE`] (declared below with the
// simple path) — same cell either way.

// ─────────────────────────────────────────────────────────────────────
// 8-stage chain undercut blockers
// ─────────────────────────────────────────────────────────────────────

/// Undercut: an external block is in force on the run (cancellation,
/// deadline-exceeded, parent-cancelled).
pub const DISPATCH_RUN_BLOCKED: &str = "dispatch-run-blocked";

/// Undercut: another candidate already won this run.
pub const DISPATCH_RUN_ALREADY_ASSIGNED: &str = "dispatch-run-already-assigned";

/// Undercut: task has been closed (e.g. cancelled) post-admission.
pub const DISPATCH_TASK_CLOSED: &str = "dispatch-task-closed";

/// Undercut: a dependency block surfaced.
pub const DISPATCH_DEPENDENCY_BLOCK: &str = "dispatch-dependency-block";

/// Undercut: an approval was denied or withdrawn.
pub const DISPATCH_APPROVAL_BLOCK: &str = "dispatch-approval-block";

/// Undercut: worker-kind mismatch with the op's `uses-<kind>-worker`.
pub const DISPATCH_WORKER_MISMATCH: &str = "dispatch-worker-mismatch";

/// Undercut: provider mismatch.
pub const DISPATCH_PROVIDER_MISMATCH: &str = "dispatch-provider-mismatch";

/// Undercut: policy mismatch (fine-grained counterpart of
/// [`IS_POLICY_MISMATCHED`]).
pub const DISPATCH_POLICY_MISMATCH: &str = "dispatch-policy-mismatch";

// ─────────────────────────────────────────────────────────────────────
// Undercut blocker predicates
//
// Each blocker, when witnessed True at a candidate, residuates
// `IS_ADMISSIBLE` into `IS_UNDERCUT` via a corresponding implication
// declared below. The admission chain only settles `IS_ADMISSIBLE`
// when all positive fits are present; blockers catch cases where
// admissibility was derived but a specific concern later surfaces.
// ─────────────────────────────────────────────────────────────────────

/// Blocker: the op requires a capability the performer doesn't have.
pub const IS_CAPABILITY_MISMATCHED: &str = "is-capability-mismatched";

/// Blocker: the performer is off-duty / unavailable (e.g. at capacity,
/// explicitly paused, in end-of-session state).
pub const IS_PERFORMER_UNAVAILABLE: &str = "is-performer-unavailable";

/// Blocker: a policy attached to the op, performer, or office
/// rejects this pairing.
pub const IS_POLICY_MISMATCHED: &str = "is-policy-mismatched";

/// Blocker: a duty-gate is not satisfied. Used when an op emerges
/// from a duty whose own conditions aren't met yet (e.g., dependency
/// unresolved, awaited approval missing).
pub const IS_DUTY_GATED: &str = "is-duty-gated";

/// Blocker: the performer's recent work has flagged them as risky
/// for this op (e.g., repeated failures of the same function kind).
pub const IS_FAILURE_RISK: &str = "is-failure-risk";

/// `(candidate, is-undercut, marker)` — residuation target for all
/// admission-undercut implications. Settled when any
/// `IS_ADMISSIBLE ∧ <blocker>` pair holds at the candidate.
pub const IS_UNDERCUT: &str = "is-undercut";

// ─────────────────────────────────────────────────────────────────────
// Preference signals (soft — indicate which admissible candidates
// are preferred over others)
// ─────────────────────────────────────────────────────────────────────

/// `(candidate, has-capability-preference, marker)` — soft preference:
/// this candidate's performer has a capability alignment preferred
/// over others.
pub const HAS_CAPABILITY_PREFERENCE: &str = "has-capability-preference";

/// `(candidate, has-provider-preference, marker)` — soft preference
/// at the provider axis (e.g., preferred LLM tier, preferred
/// container image).
pub const HAS_PROVIDER_PREFERENCE: &str = "has-provider-preference";

/// `(candidate, is-preferred, marker)` — fusion result: candidates
/// with both capability and provider preferences are doubly preferred.
/// Fusion (non-idempotent linear-logic tensor) distinguishes them
/// from candidates with only one signal. See composition anchor
/// [`FUSE_PREFERENCES`].
pub const IS_PREFERRED: &str = "is-preferred";

/// `(candidate, is-selected, marker)` — emitted by the selector port
/// on the winning candidate. Consumers (effector ports) subscribe to
/// this to begin execution. Not derived by cascade composition;
/// selection requires ordering and uniqueness that belongs to a
/// dedicated port. See [`crate::dispatch_selector`].
pub const IS_SELECTED: &str = "is-selected";

// ─────────────────────────────────────────────────────────────────────
// Composition / implication anchor names
// (Each composition declaration needs a unique anchor subject; the
// cascade's trigger table assembles `left/right/target` triples
// keyed by the anchor.)
// ─────────────────────────────────────────────────────────────────────

const ADMIT_OP_READY_AND_PERFORMER_AVAILABLE: &str = "dispatch:admit-op-ready-and-performer-available";
const UNDERCUT_CAPABILITY_MISMATCH: &str = "dispatch:undercut-capability-mismatch";
const UNDERCUT_PERFORMER_UNAVAILABLE: &str = "dispatch:undercut-performer-unavailable";
const UNDERCUT_POLICY_MISMATCH: &str = "dispatch:undercut-policy-mismatch";
const UNDERCUT_DUTY_GATED: &str = "dispatch:undercut-duty-gated";
const UNDERCUT_FAILURE_RISK: &str = "dispatch:undercut-failure-risk";
const FUSE_PREFERENCES: &str = "dispatch:fuse-preferences";

// 8-stage chain anchors (one composition per stage).
const ADMIT_RUN_AVAILABLE: &str = "dispatch:admit-run-available";
const ADMIT_TASK_ROUTABLE: &str = "dispatch:admit-task-routable";
const ADMIT_TASK_CLEAR: &str = "dispatch:admit-task-clear";
const ADMIT_OPEN: &str = "dispatch:admit-open";
const ADMIT_OPEN_CAPABLE: &str = "dispatch:admit-open-capable";
const ADMIT_WORKER_READY: &str = "dispatch:admit-worker-ready";
const ADMIT_PROVIDER_READY: &str = "dispatch:admit-provider-ready";
const ADMIT_ADMISSIBLE_FULL: &str = "dispatch:admit-admissible-full";

// 8-stage undercut anchors (nine blockers).
const UNDERCUT_RUN_BLOCKED: &str = "dispatch:undercut-run-blocked";
const UNDERCUT_RUN_ALREADY_ASSIGNED: &str = "dispatch:undercut-run-already-assigned";
const UNDERCUT_TASK_CLOSED: &str = "dispatch:undercut-task-closed";
const UNDERCUT_DEPENDENCY_BLOCK: &str = "dispatch:undercut-dependency-block";
const UNDERCUT_APPROVAL_BLOCK: &str = "dispatch:undercut-approval-block";
const UNDERCUT_WORKER_MISMATCH: &str = "dispatch:undercut-worker-mismatch";
const UNDERCUT_PROVIDER_MISMATCH: &str = "dispatch:undercut-provider-mismatch";
const UNDERCUT_POLICY_MISMATCH_FULL: &str = "dispatch:undercut-policy-mismatch-full";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the candidate category, the admission and
/// undercut predicates, and the composition / implication rules that
/// wire them into the cascade.
#[derive(Debug, Clone, Copy, Default)]
pub struct Dispatch;

#[async_trait]
impl Agent for Dispatch {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Category term.
        out.push(Claim::new(CANDIDATE, IS_A_TERM, IDENTITY));
        out.push(Claim::new(CANDIDATE, SPECIALIZES_AS, THING));

        // Predicates.
        for p in [
            CONSIDERS_OP,
            CONSIDERS_PERFORMER,
            IS_OP_READY,
            IS_PERFORMER_AVAILABLE,
            IS_ADMISSIBLE,
            IS_CAPABILITY_MISMATCHED,
            IS_PERFORMER_UNAVAILABLE,
            IS_POLICY_MISMATCHED,
            IS_DUTY_GATED,
            IS_FAILURE_RISK,
            IS_UNDERCUT,
            HAS_CAPABILITY_PREFERENCE,
            HAS_PROVIDER_PREFERENCE,
            IS_PREFERRED,
            IS_SELECTED,
            // 8-stage chain premises and intermediates.
            DISPATCH_RUN_OPEN,
            DISPATCH_RUN_UNASSIGNED,
            DISPATCH_RUN_AVAILABLE,
            DISPATCH_TASK_OPEN,
            DISPATCH_DEPENDENCIES_SATISFIED,
            DISPATCH_TASK_ROUTABLE,
            DISPATCH_APPROVALS_SATISFIED,
            DISPATCH_TASK_CLEAR,
            DISPATCH_OPEN,
            DISPATCH_CAPABILITY_FIT,
            DISPATCH_OPEN_CAPABLE,
            DISPATCH_WORKER_FIT,
            DISPATCH_WORKER_READY,
            DISPATCH_PROVIDER_FIT,
            DISPATCH_PROVIDER_READY,
            DISPATCH_POLICY_FIT,
            // 8-stage chain undercuts.
            DISPATCH_RUN_BLOCKED,
            DISPATCH_RUN_ALREADY_ASSIGNED,
            DISPATCH_TASK_CLOSED,
            DISPATCH_DEPENDENCY_BLOCK,
            DISPATCH_APPROVAL_BLOCK,
            DISPATCH_WORKER_MISMATCH,
            DISPATCH_PROVIDER_MISMATCH,
            DISPATCH_POLICY_MISMATCH,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // Admission composition:
        // IS_OP_READY ∧ IS_PERFORMER_AVAILABLE → IS_ADMISSIBLE
        out.push(Claim::new(
            ADMIT_OP_READY_AND_PERFORMER_AVAILABLE,
            USES_AS_COMPOSITION_LEFT,
            IS_OP_READY,
        ));
        out.push(Claim::new(
            ADMIT_OP_READY_AND_PERFORMER_AVAILABLE,
            USES_AS_COMPOSITION_RIGHT,
            IS_PERFORMER_AVAILABLE,
        ));
        out.push(Claim::new(
            ADMIT_OP_READY_AND_PERFORMER_AVAILABLE,
            COMPOSES_INTO,
            IS_ADMISSIBLE,
        ));

        // Undercut implications: one per blocker.
        // Each says `IS_ADMISSIBLE ∧ <blocker> → IS_UNDERCUT`, so
        // witnessing a blocker at an already-admissible candidate
        // residuates it into undercut.
        let undercuts = [
            (UNDERCUT_CAPABILITY_MISMATCH, IS_CAPABILITY_MISMATCHED),
            (UNDERCUT_PERFORMER_UNAVAILABLE, IS_PERFORMER_UNAVAILABLE),
            (UNDERCUT_POLICY_MISMATCH, IS_POLICY_MISMATCHED),
            (UNDERCUT_DUTY_GATED, IS_DUTY_GATED),
            (UNDERCUT_FAILURE_RISK, IS_FAILURE_RISK),
        ];
        for (anchor, blocker) in undercuts {
            out.push(Claim::new(anchor, USES_AS_ANTECEDENT, IS_ADMISSIBLE));
            out.push(Claim::new(anchor, USES_AS_CONSEQUENT, blocker));
            out.push(Claim::new(anchor, IMPLIES_INTO, IS_UNDERCUT));
        }

        // Preference fusion:
        // HAS_CAPABILITY_PREFERENCE ⊙ HAS_PROVIDER_PREFERENCE → IS_PREFERRED
        // Fusion (Chu tensor; non-idempotent) surfaces candidates
        // with both preference signals above those with only one.
        out.push(Claim::new(
            FUSE_PREFERENCES,
            USES_AS_FUSION_LEFT,
            HAS_CAPABILITY_PREFERENCE,
        ));
        out.push(Claim::new(
            FUSE_PREFERENCES,
            USES_AS_FUSION_RIGHT,
            HAS_PROVIDER_PREFERENCE,
        ));
        out.push(Claim::new(FUSE_PREFERENCES, FUSES_INTO, IS_PREFERRED));

        // ─────────────────────────────────────────────────────────
        // 8-stage admission chain.
        //
        // Each stage composes two inputs into one output cell at the
        // same candidate subject. The final output is IS_ADMISSIBLE,
        // same cell the simple path produces — both derivations
        // settle the same fiber.
        // ─────────────────────────────────────────────────────────
        let stages: &[(&str, &str, &str, &str)] = &[
            (ADMIT_RUN_AVAILABLE, DISPATCH_RUN_OPEN, DISPATCH_RUN_UNASSIGNED, DISPATCH_RUN_AVAILABLE),
            (ADMIT_TASK_ROUTABLE, DISPATCH_TASK_OPEN, DISPATCH_DEPENDENCIES_SATISFIED, DISPATCH_TASK_ROUTABLE),
            (ADMIT_TASK_CLEAR, DISPATCH_TASK_ROUTABLE, DISPATCH_APPROVALS_SATISFIED, DISPATCH_TASK_CLEAR),
            (ADMIT_OPEN, DISPATCH_RUN_AVAILABLE, DISPATCH_TASK_CLEAR, DISPATCH_OPEN),
            (ADMIT_OPEN_CAPABLE, DISPATCH_OPEN, DISPATCH_CAPABILITY_FIT, DISPATCH_OPEN_CAPABLE),
            (ADMIT_WORKER_READY, DISPATCH_OPEN_CAPABLE, DISPATCH_WORKER_FIT, DISPATCH_WORKER_READY),
            (ADMIT_PROVIDER_READY, DISPATCH_WORKER_READY, DISPATCH_PROVIDER_FIT, DISPATCH_PROVIDER_READY),
            (ADMIT_ADMISSIBLE_FULL, DISPATCH_PROVIDER_READY, DISPATCH_POLICY_FIT, IS_ADMISSIBLE),
        ];
        for (anchor, left, right, target) in stages {
            out.push(Claim::new(*anchor, USES_AS_COMPOSITION_LEFT, *left));
            out.push(Claim::new(*anchor, USES_AS_COMPOSITION_RIGHT, *right));
            out.push(Claim::new(*anchor, COMPOSES_INTO, *target));
        }

        // 8-stage chain undercuts: one implication per blocker.
        let full_undercuts: &[(&str, &str)] = &[
            (UNDERCUT_RUN_BLOCKED, DISPATCH_RUN_BLOCKED),
            (UNDERCUT_RUN_ALREADY_ASSIGNED, DISPATCH_RUN_ALREADY_ASSIGNED),
            (UNDERCUT_TASK_CLOSED, DISPATCH_TASK_CLOSED),
            (UNDERCUT_DEPENDENCY_BLOCK, DISPATCH_DEPENDENCY_BLOCK),
            (UNDERCUT_APPROVAL_BLOCK, DISPATCH_APPROVAL_BLOCK),
            (UNDERCUT_WORKER_MISMATCH, DISPATCH_WORKER_MISMATCH),
            (UNDERCUT_PROVIDER_MISMATCH, DISPATCH_PROVIDER_MISMATCH),
            (UNDERCUT_POLICY_MISMATCH_FULL, DISPATCH_POLICY_MISMATCH),
        ];
        for (anchor, blocker) in full_undercuts {
            out.push(Claim::new(*anchor, USES_AS_ANTECEDENT, IS_ADMISSIBLE));
            out.push(Claim::new(*anchor, USES_AS_CONSEQUENT, *blocker));
            out.push(Claim::new(*anchor, IMPLIES_INTO, IS_UNDERCUT));
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_specializes_as_thing() {
        let claims = Dispatch.claims();
        assert!(claims.iter().any(|c| c.subject == CANDIDATE
            && c.predicate == SPECIALIZES_AS
            && c.object == THING));
    }

    #[test]
    fn admission_composition_has_three_triples() {
        let claims = Dispatch.claims();
        let anchor_triples: Vec<_> = claims
            .iter()
            .filter(|c| c.subject == ADMIT_OP_READY_AND_PERFORMER_AVAILABLE)
            .collect();
        assert_eq!(
            anchor_triples.len(),
            3,
            "composition declaration needs exactly 3 trigger claims (left, right, target)"
        );
        assert!(anchor_triples
            .iter()
            .any(|c| c.predicate == USES_AS_COMPOSITION_LEFT && c.object == IS_OP_READY));
        assert!(anchor_triples
            .iter()
            .any(|c| c.predicate == USES_AS_COMPOSITION_RIGHT && c.object == IS_PERFORMER_AVAILABLE));
        assert!(anchor_triples
            .iter()
            .any(|c| c.predicate == COMPOSES_INTO && c.object == IS_ADMISSIBLE));
    }

    #[test]
    fn undercut_implication_has_three_triples() {
        let claims = Dispatch.claims();
        let anchor_triples: Vec<_> = claims
            .iter()
            .filter(|c| c.subject == UNDERCUT_CAPABILITY_MISMATCH)
            .collect();
        assert_eq!(anchor_triples.len(), 3);
        assert!(anchor_triples
            .iter()
            .any(|c| c.predicate == USES_AS_ANTECEDENT && c.object == IS_ADMISSIBLE));
        assert!(anchor_triples
            .iter()
            .any(|c| c.predicate == USES_AS_CONSEQUENT && c.object == IS_CAPABILITY_MISMATCHED));
        assert!(anchor_triples
            .iter()
            .any(|c| c.predicate == IMPLIES_INTO && c.object == IS_UNDERCUT));
    }

    #[test]
    fn eight_stage_chain_composes_into_each_expected_intermediate() {
        let claims = Dispatch.claims();
        // Each of the 8 stages must have a composition whose output
        // is the named intermediate (or IS_ADMISSIBLE at the end).
        let stage_outputs = [
            DISPATCH_RUN_AVAILABLE,
            DISPATCH_TASK_ROUTABLE,
            DISPATCH_TASK_CLEAR,
            DISPATCH_OPEN,
            DISPATCH_OPEN_CAPABLE,
            DISPATCH_WORKER_READY,
            DISPATCH_PROVIDER_READY,
            IS_ADMISSIBLE,
        ];
        for output in stage_outputs {
            let count = claims
                .iter()
                .filter(|c| c.predicate == COMPOSES_INTO && c.object == output)
                .count();
            assert!(
                count >= 1,
                "no composition lands in {output}"
            );
        }
    }

    #[test]
    fn is_admissible_has_two_derivation_paths() {
        // Simple path produces it from the IS_OP_READY/IS_PERFORMER_AVAILABLE
        // composition; 8-stage path from DISPATCH_PROVIDER_READY ∧
        // DISPATCH_POLICY_FIT. Both land at IS_ADMISSIBLE.
        let claims = Dispatch.claims();
        let count = claims
            .iter()
            .filter(|c| c.predicate == COMPOSES_INTO && c.object == IS_ADMISSIBLE)
            .count();
        assert_eq!(
            count, 2,
            "IS_ADMISSIBLE should have both simple and 8-stage derivations"
        );
    }

    #[test]
    fn nine_undercuts_plus_five_simple_equal_total_implications() {
        let claims = Dispatch.claims();
        let total = claims
            .iter()
            .filter(|c| c.predicate == IMPLIES_INTO && c.object == IS_UNDERCUT)
            .count();
        // Simple: 5 (capability-mismatched, performer-unavailable,
        // policy-mismatched, duty-gated, failure-risk).
        // 8-stage: 8 (run-blocked, run-already-assigned, task-closed,
        // dependency-block, approval-block, worker-mismatch,
        // provider-mismatch, policy-mismatch).
        // Total 13.
        assert_eq!(total, 13, "expected 13 undercut implications total");
    }

    #[test]
    fn every_8stage_premise_declared_as_predicate() {
        let claims = Dispatch.claims();
        for p in [
            DISPATCH_RUN_OPEN,
            DISPATCH_RUN_UNASSIGNED,
            DISPATCH_TASK_OPEN,
            DISPATCH_DEPENDENCIES_SATISFIED,
            DISPATCH_APPROVALS_SATISFIED,
            DISPATCH_CAPABILITY_FIT,
            DISPATCH_WORKER_FIT,
            DISPATCH_PROVIDER_FIT,
            DISPATCH_POLICY_FIT,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared as a predicate"
            );
        }
    }
}
