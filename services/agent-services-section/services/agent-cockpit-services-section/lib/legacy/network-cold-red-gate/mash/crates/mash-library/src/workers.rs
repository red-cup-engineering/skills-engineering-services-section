//! Worker taxonomy — the lattice of `worker` and its specializations
//! (shell / llm / container / human / file), per-kind readiness
//! predicates, and per-kind gate compositions.
//!
//! # Wiener/Barad framing
//!
//! A worker is not an object that *has* methods that execute ops. A
//! worker is a session bound to an effector; its identity, scope, and
//! history accumulate as claims on its fiber. "Execution" is the
//! settlement of result claims on an op's fiber, witnessed by the
//! effector the worker is bound to.
//!
//! # Per-kind gate composition
//!
//! For each worker kind K, this module declares:
//!
//! `IS_INTENT_SET ∧ USES_<K>_WORKER → IS_READY_TO_RUN_ON_<K>`
//!
//! Both premises land at `(op, _, target)`: the op-minter witnesses
//! `is-intent-set` with the op's target as object, and the worker-
//! assigner witnesses `uses-<k>-worker` at the same target, so the
//! pointwise composition fires at `(op, is-ready-to-run-on-<k>,
//! target)`.
//!
//! Per-kind readiness specializes-as the general [`IS_READY_TO_RUN`]
//! so kind-agnostic observers (paratelemetry, log readers) subscribe
//! to the parent while per-kind effector ports subscribe to their
//! specific kind — eliminating Shannon-shaped branching on "is this
//! my op?" at the effector.
//!
//! # File-worker exception
//!
//! The file-worker kind does not get a gate composition. File ops
//! don't use the `runs-command`/`executes-on` intent pair that gates
//! `is-intent-set`; their minter witnesses readiness directly.
//! [`FILE_WORKER`] and [`IS_READY_TO_RUN_ON_FILE`] are still declared
//! and specialize through the lattice, just without an auto-gate.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-vocab-workers/src/lib.rs` is the
//! reference implementation; this module is an OQRA-aligned port with
//! the inversion-discipline corrections (no spurious INVERTS_AS pairs;
//! the worker→session lift is SPECIALIZES_AS, not an inversion).

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{
    COMPOSES_INTO, IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, USES_AS_COMPOSITION_LEFT,
    USES_AS_COMPOSITION_RIGHT,
};
use crate::ops::{IS_INTENT_SET, IS_READY_TO_RUN};
use crate::presence::SESSION;

/// Owner identity.
pub const IDENTITY: &str = "mash-library-workers";

// ─────────────────────────────────────────────────────────────────────
// Worker terms
// ─────────────────────────────────────────────────────────────────────

/// A participant capable of executing operations. Specializes-as
/// [`SESSION`] — every worker is a session bound to an effector.
pub const WORKER: &str = "worker";

/// Shell-execution worker — spawns subprocess, captures stdout/stderr.
pub const SHELL_WORKER: &str = "shell-worker";

/// LLM-API worker — submits prompts to a model provider, captures
/// completions.
pub const LLM_WORKER: &str = "llm-worker";

/// Container-runtime worker — spawns a container, runs a command in
/// it, captures output.
pub const CONTAINER_WORKER: &str = "container-worker";

/// Human-mediated worker — a human reads an op, performs the act,
/// witnesses the result. Used for approvals, manual operations, and
/// out-of-band acts the substrate cannot perform autonomously.
pub const HUMAN_WORKER: &str = "human-worker";

/// Filesystem worker — atomic write / rename / delete of files on
/// local filesystem, paired with an observing sensor to close the
/// projector's retraction.
pub const FILE_WORKER: &str = "file-worker";

/// An artifact binding process + worker + application + policy. An
/// op's execution profile resolves its concrete runtime.
pub const EXECUTION_PROFILE: &str = "execution-profile";

/// An LLM model tier term. Object values [`MODEL_TIER_HAIKU`],
/// [`MODEL_TIER_SONNET`], [`MODEL_TIER_OPUS`].
pub const MODEL_TIER: &str = "model-tier";

/// Haiku tier — smallest, fastest, cheapest.
pub const MODEL_TIER_HAIKU: &str = "model-tier:haiku";

/// Sonnet tier — balanced capability/cost.
pub const MODEL_TIER_SONNET: &str = "model-tier:sonnet";

/// Opus tier — largest, most capable.
pub const MODEL_TIER_OPUS: &str = "model-tier:opus";

// ─────────────────────────────────────────────────────────────────────
// Worker-side predicates
// ─────────────────────────────────────────────────────────────────────

/// `(worker, is-worker-available, worker)` — diagonal: the worker is
/// accepting new ops right now. Dispatch's performer-available gate
/// reads this.
pub const IS_WORKER_AVAILABLE: &str = "is-worker-available";

/// `(worker, has-policy, policy-term)` — a policy the worker is
/// bound by. Paired with [`SUPPORTS_POLICY`] on the worker side for
/// policy negotiation.
pub const HAS_POLICY: &str = "has-policy";

/// `(worker, supports-policy, policy-term)` — a policy this worker
/// can satisfy. Dispatch's policy-match checks op.has-policy against
/// worker.supports-policy.
pub const SUPPORTS_POLICY: &str = "supports-policy";

/// `(worker, has-provider, provider-id)` — for workers that depend
/// on an external provider (LLM providers, container runtimes).
pub const HAS_PROVIDER: &str = "has-provider";

/// `(worker, max-concurrency, integer-string)` — max ops the worker
/// can run in parallel.
pub const MAX_CONCURRENCY: &str = "max-concurrency";

/// `(worker, has-model-tier, tier-term)` — LLM worker's model tier.
pub const HAS_MODEL_TIER: &str = "has-model-tier";

/// `(worker, currently-assigned, op)` — op the worker is currently
/// executing. Used for run-slot accounting and concurrency gating.
pub const CURRENTLY_ASSIGNED: &str = "currently-assigned";

// ─────────────────────────────────────────────────────────────────────
// Op-side worker bindings
// ─────────────────────────────────────────────────────────────────────

/// `(op, has-execution-profile, profile-id)` — execution profile the
/// op should run under. The resolver projection reads this and mints
/// the corresponding `uses-<kind>-worker` binding.
pub const HAS_EXECUTION_PROFILE: &str = "has-execution-profile";

/// `(op, uses-shell-worker, target)` — a shell-worker has been
/// assigned to this op. Object axis carries the op's target.
pub const USES_SHELL_WORKER: &str = "uses-shell-worker";

/// `(op, uses-llm-worker, target)` — llm-worker binding.
pub const USES_LLM_WORKER: &str = "uses-llm-worker";

/// `(op, uses-container-worker, target)` — container-worker binding.
pub const USES_CONTAINER_WORKER: &str = "uses-container-worker";

/// `(op, uses-human-worker, target)` — human-worker binding.
pub const USES_HUMAN_WORKER: &str = "uses-human-worker";

/// `(op, uses-file-worker, target)` — file-worker binding. Does
/// not participate in a gate composition; file-op minters witness
/// readiness directly.
pub const USES_FILE_WORKER: &str = "uses-file-worker";

// ─────────────────────────────────────────────────────────────────────
// Per-kind readiness (each specializes-as IS_READY_TO_RUN)
// ─────────────────────────────────────────────────────────────────────

/// `(op, is-ready-to-run-on-shell, target)` — shell-effector should
/// begin execution.
pub const IS_READY_TO_RUN_ON_SHELL: &str = "is-ready-to-run-on-shell";

/// `(op, is-ready-to-run-on-llm, target)` — llm-effector should
/// begin execution.
pub const IS_READY_TO_RUN_ON_LLM: &str = "is-ready-to-run-on-llm";

/// `(op, is-ready-to-run-on-container, target)` — container-effector
/// should begin execution.
pub const IS_READY_TO_RUN_ON_CONTAINER: &str = "is-ready-to-run-on-container";

/// `(op, is-ready-to-run-on-human, target)` — human-effector should
/// surface this op for attention.
pub const IS_READY_TO_RUN_ON_HUMAN: &str = "is-ready-to-run-on-human";

/// `(op, is-ready-to-run-on-file, target)` — file-effector should
/// begin execution.
pub const IS_READY_TO_RUN_ON_FILE: &str = "is-ready-to-run-on-file";

// ─────────────────────────────────────────────────────────────────────
// Gate anchor subjects — distinct per kind so composition witnesses
// don't collide
// ─────────────────────────────────────────────────────────────────────

const SHELL_GATE: &str = "workers:shell-gate";
const LLM_GATE: &str = "workers:llm-gate";
const CONTAINER_GATE: &str = "workers:container-gate";
const HUMAN_GATE: &str = "workers:human-gate";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the worker taxonomy.
#[derive(Debug, Clone, Copy, Default)]
pub struct Workers;

#[async_trait]
impl Agent for Workers {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        let terms: &[&str] = &[
            WORKER,
            SHELL_WORKER,
            LLM_WORKER,
            CONTAINER_WORKER,
            HUMAN_WORKER,
            FILE_WORKER,
            EXECUTION_PROFILE,
            MODEL_TIER,
            MODEL_TIER_HAIKU,
            MODEL_TIER_SONNET,
            MODEL_TIER_OPUS,
        ];
        for t in terms {
            out.push(Claim::new(*t, IS_A_TERM, IDENTITY));
        }

        let predicates: &[&str] = &[
            IS_WORKER_AVAILABLE,
            HAS_POLICY,
            SUPPORTS_POLICY,
            HAS_PROVIDER,
            MAX_CONCURRENCY,
            HAS_MODEL_TIER,
            CURRENTLY_ASSIGNED,
            HAS_EXECUTION_PROFILE,
            USES_SHELL_WORKER,
            USES_LLM_WORKER,
            USES_CONTAINER_WORKER,
            USES_HUMAN_WORKER,
            USES_FILE_WORKER,
            IS_READY_TO_RUN_ON_SHELL,
            IS_READY_TO_RUN_ON_LLM,
            IS_READY_TO_RUN_ON_CONTAINER,
            IS_READY_TO_RUN_ON_HUMAN,
            IS_READY_TO_RUN_ON_FILE,
        ];
        for p in predicates {
            out.push(Claim::new(*p, IS_A_PREDICATE, IDENTITY));
        }

        // Every worker kind lifts to WORKER.
        for kind in [
            SHELL_WORKER,
            LLM_WORKER,
            CONTAINER_WORKER,
            HUMAN_WORKER,
            FILE_WORKER,
        ] {
            out.push(Claim::new(kind, SPECIALIZES_AS, WORKER));
        }

        // WORKER lifts to SESSION: every worker is a session bound to
        // an effector.
        out.push(Claim::new(WORKER, SPECIALIZES_AS, SESSION));

        // Every per-kind readiness lifts to IS_READY_TO_RUN.
        for ready in [
            IS_READY_TO_RUN_ON_SHELL,
            IS_READY_TO_RUN_ON_LLM,
            IS_READY_TO_RUN_ON_CONTAINER,
            IS_READY_TO_RUN_ON_HUMAN,
            IS_READY_TO_RUN_ON_FILE,
        ] {
            out.push(Claim::new(ready, SPECIALIZES_AS, IS_READY_TO_RUN));
        }

        // Per-kind gate compositions: IS_INTENT_SET ∧ USES_<K>_WORKER
        // → IS_READY_TO_RUN_ON_<K>. File-worker has no gate.
        let gates: &[(&str, &str, &str)] = &[
            (SHELL_GATE, USES_SHELL_WORKER, IS_READY_TO_RUN_ON_SHELL),
            (LLM_GATE, USES_LLM_WORKER, IS_READY_TO_RUN_ON_LLM),
            (
                CONTAINER_GATE,
                USES_CONTAINER_WORKER,
                IS_READY_TO_RUN_ON_CONTAINER,
            ),
            (HUMAN_GATE, USES_HUMAN_WORKER, IS_READY_TO_RUN_ON_HUMAN),
        ];
        for (anchor, uses_pred, ready_pred) in gates {
            out.push(Claim::new(*anchor, USES_AS_COMPOSITION_LEFT, IS_INTENT_SET));
            out.push(Claim::new(*anchor, USES_AS_COMPOSITION_RIGHT, *uses_pred));
            out.push(Claim::new(*anchor, COMPOSES_INTO, *ready_pred));
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_specializes_as_session() {
        let claims = Workers.claims();
        assert!(claims.iter().any(|c| c.subject == WORKER
            && c.predicate == SPECIALIZES_AS
            && c.object == SESSION));
    }

    #[test]
    fn each_kind_specializes_as_worker() {
        let claims = Workers.claims();
        for kind in [
            SHELL_WORKER,
            LLM_WORKER,
            CONTAINER_WORKER,
            HUMAN_WORKER,
            FILE_WORKER,
        ] {
            assert!(
                claims.iter().any(|c| c.subject == kind
                    && c.predicate == SPECIALIZES_AS
                    && c.object == WORKER),
                "{kind} should specialize-as {WORKER}"
            );
        }
    }

    #[test]
    fn each_readiness_specializes_as_general_ready() {
        let claims = Workers.claims();
        for ready in [
            IS_READY_TO_RUN_ON_SHELL,
            IS_READY_TO_RUN_ON_LLM,
            IS_READY_TO_RUN_ON_CONTAINER,
            IS_READY_TO_RUN_ON_HUMAN,
            IS_READY_TO_RUN_ON_FILE,
        ] {
            assert!(
                claims.iter().any(|c| c.subject == ready
                    && c.predicate == SPECIALIZES_AS
                    && c.object == IS_READY_TO_RUN),
                "{ready} should specialize-as {IS_READY_TO_RUN}"
            );
        }
    }

    #[test]
    fn gate_compositions_declared_for_each_gated_kind() {
        let claims = Workers.claims();
        let gated: &[(&str, &str, &str)] = &[
            (SHELL_GATE, USES_SHELL_WORKER, IS_READY_TO_RUN_ON_SHELL),
            (LLM_GATE, USES_LLM_WORKER, IS_READY_TO_RUN_ON_LLM),
            (
                CONTAINER_GATE,
                USES_CONTAINER_WORKER,
                IS_READY_TO_RUN_ON_CONTAINER,
            ),
            (HUMAN_GATE, USES_HUMAN_WORKER, IS_READY_TO_RUN_ON_HUMAN),
        ];
        for (anchor, uses, ready) in gated {
            assert!(
                claims.iter().any(|c| c.subject == *anchor
                    && c.predicate == USES_AS_COMPOSITION_LEFT
                    && c.object == IS_INTENT_SET),
                "{anchor} should use IS_INTENT_SET as left"
            );
            assert!(
                claims.iter().any(|c| c.subject == *anchor
                    && c.predicate == USES_AS_COMPOSITION_RIGHT
                    && c.object == *uses),
                "{anchor} should use {uses} as right"
            );
            assert!(
                claims.iter().any(|c| c.subject == *anchor
                    && c.predicate == COMPOSES_INTO
                    && c.object == *ready),
                "{anchor} should compose into {ready}"
            );
        }
    }

    #[test]
    fn file_worker_has_no_gate_composition() {
        let claims = Workers.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == USES_AS_COMPOSITION_RIGHT
                && c.object == USES_FILE_WORKER),
            "file-worker should not participate in a gate composition"
        );
    }
}
