//! Orchestration shakedown scene — declares enough instance data to
//! exercise the 8-stage dispatch admission cascade, capability
//! mismatch undercuts, and the worker-kind/provider/tier gates.
//!
//! # The cast
//!
//! | Worker | Kind | Capabilities | Provider | Tier |
//! |---|---|---|---|---|
//! | `llm-worker:haiku` | llm | writes-prose | anthropic | haiku |
//! | `llm-worker:opus` | llm | writes-prose, reasons-deep | anthropic | opus |
//! | `shell-worker:1` | shell | runs-shell | — | — |
//!
//! All three start `is-worker-available`.
//!
//! # Tasks
//!
//! - `task:t-prep` — shell task, no dependency, no approval.
//!   Baseline for the simple admission path.
//! - `task:t-write` — LLM prose task, `depends-on task:t-prep` +
//!   `requires-approval approval:a-write-go`. Exercises the
//!   dependency + approval gates in the 8-stage chain.
//! - `task:t-no-cap` — requires `reasons-deep` capability. The haiku
//!   worker lacks it; its candidate should trip capability-mismatch.
//!   The opus candidate should admit.
//!
//! # Approval
//!
//! `approval:a-write-go` starts pending. Granting it clears
//! `task:t-write`'s `dispatch-approval-block`.
//!
//! # Divergence from old-library
//!
//! Old lib used `HAS_CAPABILITY` at worker subjects. This library
//! uses [`crate::capability::HELD_BY`] on the capability subject
//! pointing at its holder (cap-centric). The resolver walks HELD_BY
//! (or the role-grant chain) to compute effective capabilities.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::approval::{APPROVAL, APPROVAL_STATUS, APPROVAL_STATUS_PENDING, REQUIRES_APPROVAL};
use crate::capability::{CAPABILITY, HELD_BY, REQUIRES_CAPABILITY};
use crate::foundation::IS_A_TERM;
use crate::lifecycle::IS_CLOSED;
use crate::planning::task::{DEPENDS_ON, HAS_COMMAND, HAS_TARGET, TASK};
use crate::workers::{
    HAS_MODEL_TIER, HAS_PROVIDER, IS_WORKER_AVAILABLE, LLM_WORKER, MODEL_TIER_HAIKU, MODEL_TIER_OPUS,
    SHELL_WORKER,
};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-scene-orchestration-shakedown";

// ─────────────────────────────────────────────────────────────────────
// Workers
// ─────────────────────────────────────────────────────────────────────

/// Haiku-tier LLM worker — writes-prose only.
pub const WORKER_LLM_HAIKU: &str = "llm-worker:haiku";

/// Opus-tier LLM worker — writes-prose + reasons-deep.
pub const WORKER_LLM_OPUS: &str = "llm-worker:opus";

/// Shell worker — runs-shell.
pub const WORKER_SHELL_1: &str = "shell-worker:1";

// ─────────────────────────────────────────────────────────────────────
// Capabilities
// ─────────────────────────────────────────────────────────────────────

/// Writes prose / completion text.
pub const CAP_WRITES_PROSE: &str = "capability:writes-prose";

/// Deep multi-step reasoning.
pub const CAP_REASONS_DEEP: &str = "capability:reasons-deep";

/// Executes shell commands.
pub const CAP_RUNS_SHELL: &str = "capability:runs-shell";

// ─────────────────────────────────────────────────────────────────────
// Providers
// ─────────────────────────────────────────────────────────────────────

/// Anthropic LLM provider.
pub const PROVIDER_ANTHROPIC: &str = "provider:anthropic";

const PROVIDER: &str = "provider";

// ─────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────

/// Baseline shell task. Independent, no approval.
pub const TASK_PREP: &str = "task:t-prep";

/// LLM prose task. Depends on [`TASK_PREP`] + requires
/// [`APPROVAL_WRITE_GO`].
pub const TASK_WRITE: &str = "task:t-write";

/// LLM deep-reasoning task. Trips capability-mismatch on the haiku
/// candidate.
pub const TASK_NO_CAP: &str = "task:t-no-cap";

// ─────────────────────────────────────────────────────────────────────
// Approval
// ─────────────────────────────────────────────────────────────────────

/// Gating approval for [`TASK_WRITE`]. Starts pending.
pub const APPROVAL_WRITE_GO: &str = "approval:a-write-go";

/// Scene birth timestamp — the `opened-at` timestamp is recorded on
/// every task at scene boot.
const SCENE_BIRTH: &str = "2026-04-21T00:00:00Z";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Orchestration shakedown scene.
#[derive(Debug, Clone, Copy, Default)]
pub struct OrchestrationShakedownScene;

#[async_trait]
impl Agent for OrchestrationShakedownScene {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Capabilities as first-class subjects.
        for c in [CAP_WRITES_PROSE, CAP_REASONS_DEEP, CAP_RUNS_SHELL] {
            out.push(Claim::new(c, IS_A_TERM, CAPABILITY));
        }
        // Provider.
        out.push(Claim::new(PROVIDER_ANTHROPIC, IS_A_TERM, PROVIDER));

        // ─── Workers ────────────────────────────────────────────

        // Haiku — writes-prose only.
        out.push(Claim::new(WORKER_LLM_HAIKU, IS_A_TERM, LLM_WORKER));
        out.push(Claim::new(
            WORKER_LLM_HAIKU,
            IS_WORKER_AVAILABLE,
            WORKER_LLM_HAIKU,
        ));
        out.push(Claim::new(CAP_WRITES_PROSE, HELD_BY, WORKER_LLM_HAIKU));
        out.push(Claim::new(WORKER_LLM_HAIKU, HAS_PROVIDER, PROVIDER_ANTHROPIC));
        out.push(Claim::new(WORKER_LLM_HAIKU, HAS_MODEL_TIER, MODEL_TIER_HAIKU));

        // Opus — writes-prose + reasons-deep.
        out.push(Claim::new(WORKER_LLM_OPUS, IS_A_TERM, LLM_WORKER));
        out.push(Claim::new(
            WORKER_LLM_OPUS,
            IS_WORKER_AVAILABLE,
            WORKER_LLM_OPUS,
        ));
        out.push(Claim::new(CAP_WRITES_PROSE, HELD_BY, WORKER_LLM_OPUS));
        out.push(Claim::new(CAP_REASONS_DEEP, HELD_BY, WORKER_LLM_OPUS));
        out.push(Claim::new(WORKER_LLM_OPUS, HAS_PROVIDER, PROVIDER_ANTHROPIC));
        out.push(Claim::new(WORKER_LLM_OPUS, HAS_MODEL_TIER, MODEL_TIER_OPUS));

        // Shell.
        out.push(Claim::new(WORKER_SHELL_1, IS_A_TERM, SHELL_WORKER));
        out.push(Claim::new(WORKER_SHELL_1, IS_WORKER_AVAILABLE, WORKER_SHELL_1));
        out.push(Claim::new(CAP_RUNS_SHELL, HELD_BY, WORKER_SHELL_1));

        // ─── Tasks ──────────────────────────────────────────────

        // t-prep — baseline. Closed (declarations frozen).
        out.push(Claim::new(TASK_PREP, IS_A_TERM, TASK));
        out.push(Claim::new(TASK_PREP, HAS_COMMAND, "echo prep done"));
        out.push(Claim::new(TASK_PREP, HAS_TARGET, WORKER_SHELL_1));
        out.push(Claim::new(TASK_PREP, REQUIRES_CAPABILITY, CAP_RUNS_SHELL));
        out.push(Claim::new(TASK_PREP, IS_CLOSED, TASK_PREP));
        out.push(Claim::new(TASK_PREP, "opened-at", SCENE_BIRTH));

        // t-write — depends + approval + closed.
        out.push(Claim::new(TASK_WRITE, IS_A_TERM, TASK));
        out.push(Claim::new(
            TASK_WRITE,
            HAS_COMMAND,
            "write me a haiku about settlement",
        ));
        out.push(Claim::new(TASK_WRITE, HAS_TARGET, WORKER_LLM_OPUS));
        out.push(Claim::new(TASK_WRITE, REQUIRES_CAPABILITY, CAP_WRITES_PROSE));
        out.push(Claim::new(TASK_WRITE, DEPENDS_ON, TASK_PREP));
        out.push(Claim::new(TASK_WRITE, REQUIRES_APPROVAL, APPROVAL_WRITE_GO));
        out.push(Claim::new(TASK_WRITE, IS_CLOSED, TASK_WRITE));
        out.push(Claim::new(TASK_WRITE, "opened-at", SCENE_BIRTH));

        // t-no-cap — trips capability-mismatch for haiku candidate.
        out.push(Claim::new(TASK_NO_CAP, IS_A_TERM, TASK));
        out.push(Claim::new(
            TASK_NO_CAP,
            HAS_COMMAND,
            "produce a long deep analysis",
        ));
        out.push(Claim::new(TASK_NO_CAP, HAS_TARGET, WORKER_LLM_OPUS));
        out.push(Claim::new(TASK_NO_CAP, REQUIRES_CAPABILITY, CAP_REASONS_DEEP));
        out.push(Claim::new(TASK_NO_CAP, IS_CLOSED, TASK_NO_CAP));
        out.push(Claim::new(TASK_NO_CAP, "opened-at", SCENE_BIRTH));

        // ─── Approval ───────────────────────────────────────────
        out.push(Claim::new(APPROVAL_WRITE_GO, IS_A_TERM, APPROVAL));
        out.push(Claim::new(
            APPROVAL_WRITE_GO,
            APPROVAL_STATUS,
            APPROVAL_STATUS_PENDING,
        ));

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has_claim(claims: &[Claim], s: &str, p: &str, o: &str) -> bool {
        claims
            .iter()
            .any(|c| c.subject == s && c.predicate == p && c.object == o)
    }

    #[test]
    fn three_workers_declared_available() {
        let claims = OrchestrationShakedownScene.claims();
        for w in [WORKER_LLM_HAIKU, WORKER_LLM_OPUS, WORKER_SHELL_1] {
            assert!(
                has_claim(&claims, w, IS_WORKER_AVAILABLE, w),
                "{w} should be is-worker-available on the diagonal"
            );
        }
    }

    #[test]
    fn worker_kinds_declared() {
        let claims = OrchestrationShakedownScene.claims();
        assert!(has_claim(&claims, WORKER_LLM_HAIKU, IS_A_TERM, LLM_WORKER));
        assert!(has_claim(&claims, WORKER_LLM_OPUS, IS_A_TERM, LLM_WORKER));
        assert!(has_claim(&claims, WORKER_SHELL_1, IS_A_TERM, SHELL_WORKER));
    }

    #[test]
    fn haiku_has_only_writes_prose() {
        let claims = OrchestrationShakedownScene.claims();
        assert!(has_claim(&claims, CAP_WRITES_PROSE, HELD_BY, WORKER_LLM_HAIKU));
        assert!(!has_claim(&claims, CAP_REASONS_DEEP, HELD_BY, WORKER_LLM_HAIKU));
    }

    #[test]
    fn opus_has_both_caps() {
        let claims = OrchestrationShakedownScene.claims();
        assert!(has_claim(&claims, CAP_WRITES_PROSE, HELD_BY, WORKER_LLM_OPUS));
        assert!(has_claim(&claims, CAP_REASONS_DEEP, HELD_BY, WORKER_LLM_OPUS));
    }

    #[test]
    fn providers_and_tiers_bound_to_llm_workers() {
        let claims = OrchestrationShakedownScene.claims();
        assert!(has_claim(&claims, WORKER_LLM_HAIKU, HAS_PROVIDER, PROVIDER_ANTHROPIC));
        assert!(has_claim(&claims, WORKER_LLM_HAIKU, HAS_MODEL_TIER, MODEL_TIER_HAIKU));
        assert!(has_claim(&claims, WORKER_LLM_OPUS, HAS_PROVIDER, PROVIDER_ANTHROPIC));
        assert!(has_claim(&claims, WORKER_LLM_OPUS, HAS_MODEL_TIER, MODEL_TIER_OPUS));
    }

    #[test]
    fn three_tasks_closed_at_scene_birth() {
        let claims = OrchestrationShakedownScene.claims();
        for t in [TASK_PREP, TASK_WRITE, TASK_NO_CAP] {
            assert!(
                has_claim(&claims, t, IS_CLOSED, t),
                "{t} should be closed on the diagonal"
            );
        }
    }

    #[test]
    fn t_write_depends_on_t_prep_and_requires_approval() {
        let claims = OrchestrationShakedownScene.claims();
        assert!(has_claim(&claims, TASK_WRITE, DEPENDS_ON, TASK_PREP));
        assert!(has_claim(
            &claims,
            TASK_WRITE,
            REQUIRES_APPROVAL,
            APPROVAL_WRITE_GO
        ));
    }

    #[test]
    fn approval_starts_pending() {
        let claims = OrchestrationShakedownScene.claims();
        assert!(has_claim(
            &claims,
            APPROVAL_WRITE_GO,
            APPROVAL_STATUS,
            APPROVAL_STATUS_PENDING
        ));
    }

    #[test]
    fn t_no_cap_requires_reasons_deep() {
        let claims = OrchestrationShakedownScene.claims();
        assert!(has_claim(
            &claims,
            TASK_NO_CAP,
            REQUIRES_CAPABILITY,
            CAP_REASONS_DEEP
        ));
    }
}
