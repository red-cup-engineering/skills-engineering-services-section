//! Operations, functions, results — the instruction/opcode/writeback
//! layer that the proof engine (as CPU) consumes.
//!
//! # Mental model
//!
//! The proof engine's cascade is the CPU: it settles claims under
//! bounded-depth dynamics. Dispatch (see `crate::dispatch`) is what
//! picks which operations to feed the CPU next. An **operation** is
//! the instruction; a **function** is the kind of instruction
//! (shell, llm, file, ...); a **result** is the writeback.
//!
//! Offices and other systems sit on top of this layer — an office's
//! duty becomes concrete as an operation minted by the office's
//! holder; dispatch runs the operation; the result flows back to the
//! duty's completion.
//!
//! # Categories
//!
//! - [`OPERATION`] specializes-as `THING`
//! - [`FUNCTION`] specializes-as `THING`; specific functions
//!   (`shell-function`, `llm-function`, `file-function`) specialize
//!   from [`FUNCTION`]
//! - [`RESULT`] specializes-as `THING`
//!
//! # Phases (diagonal cells)
//!
//! Lifecycle phase predicates place their cells on the diagonal —
//! `(op, is-pending, op)` — so each op's phase lives in its own
//! fiber at the same `(s, o)` pair and transitions are cheap to
//! query. This matches the predicate-shape convention in the old
//! library: state flags use `object = subject`.
//!
//! # Wiener/Barad framing
//!
//! An operation is not a struct. It is a subject whose fiber
//! accumulates phase, intent, performance, result, and metric
//! claims. A function is not a Rust method — it is a term declared
//! by an op via `HAS_FUNCTION`. A result is not a return value —
//! it is a subject whose fiber holds outcome claims, linked back via
//! `HAS_RESULT`.
//!
//! # Prior art
//!
//! Ported from `mash-old-library/archive/mash-vocab-ops/` +
//! `archive/mash-vocab-workers/`. Applied changes:
//!
//! - OQRA specialization: OPERATION / FUNCTION / RESULT specialize-as
//!   THING so the cascade's inheritance chain reaches them.
//! - Single-direction predicates per the inversion discipline; no
//!   `INVERTS_AS` wiring for converse-positive pairs.
//! - `PERFORMED_BY` (old name `IS_PERFORMED_BY`) single-direction;
//!   `PERFORMER_OF` (old inverse) dropped — reverse-queries use
//!   fiber scan at the object axis.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, THING};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-ops";

// ─────────────────────────────────────────────────────────────────────
// Category terms
// ─────────────────────────────────────────────────────────────────────

/// A unit of work the CPU (cascade) consumes.
pub const OPERATION: &str = "operation";

/// A kind of operation. Specific functions specialize from here.
pub const FUNCTION: &str = "function";

/// The outcome of an operation.
pub const RESULT: &str = "result";

/// Canonical function kinds. Each specializes-as [`FUNCTION`] and
/// matches an effector that can execute ops declaring it.
pub const SHELL_FUNCTION: &str = "shell-function";
/// LLM-inference function (calls `claude` or similar).
pub const LLM_FUNCTION: &str = "llm-function";
/// File-write function (atomic write / rename / delete).
pub const FILE_FUNCTION: &str = "file-function";
/// Container-runtime function.
pub const CONTAINER_FUNCTION: &str = "container-function";
/// Human-mediated function (awaits a human's witness).
pub const HUMAN_FUNCTION: &str = "human-function";

// ─────────────────────────────────────────────────────────────────────
// Intent predicates (what the op is asking the CPU to do)
// ─────────────────────────────────────────────────────────────────────

/// `(op, has-function, function-kind)` — which function kind this op
/// invokes.
pub const HAS_FUNCTION: &str = "has-function";

/// `(op, has-argument, value)` — the op's argument payload
/// (command string, prompt, file path, etc.).
pub const HAS_ARGUMENT: &str = "has-argument";

/// `(op, targets, subject)` — the op's target, when ops operate on
/// an in-world subject. Rides through phase and readiness
/// compositions pointwise so the per-kind readiness cascade lands at
/// `(op, is-ready-to-run-on-<kind>, target)` without a separate
/// target-propagation morphism.
pub const TARGETS: &str = "targets";

/// `(op, runs-command, command-string)` — shell-specific intent;
/// declared here for cascade recognition, but consumers are
/// shell-effector ports.
pub const RUNS_COMMAND: &str = "runs-command";

/// `(op, executes-on, target)` — target the command executes on. In
/// the old-library this was the specific intent-pair predicate paired
/// with `runs-command` that gated `is-intent-set`.
pub const EXECUTES_ON: &str = "executes-on";

/// `(op, is-intent-set, op)` — diagonal marker: the op's intent is
/// complete, downstream readiness compositions can now fire.
pub const IS_INTENT_SET: &str = "is-intent-set";

// ─────────────────────────────────────────────────────────────────────
// Phase predicates (diagonal cells)
// ─────────────────────────────────────────────────────────────────────

/// Phase: minted but not yet ready.
pub const IS_PENDING: &str = "is-pending";

/// Phase: generic "ready". Specific per-kind ready predicates
/// (`is-ready-to-run-on-shell`, etc.) specialize-as this one so
/// observers uninterested in kind can watch the parent.
pub const IS_READY_TO_RUN: &str = "is-ready-to-run";

/// Phase: worker has begun external work.
pub const IS_RUNNING: &str = "is-running";

/// Phase: op succeeded; result claims should now be on its fiber.
pub const IS_COMPLETED: &str = "is-completed";

/// Phase: op failed; exit code / reason should be on its fiber.
pub const IS_FAILED: &str = "is-failed";

// ─────────────────────────────────────────────────────────────────────
// Performance predicate
// ─────────────────────────────────────────────────────────────────────

/// `(op, performed-by, agent-identity)` — who ran the op. Reverse
/// queries ("what ops did this agent run?") use fiber scan at object
/// axis.
pub const PERFORMED_BY: &str = "performed-by";

// ─────────────────────────────────────────────────────────────────────
// Result predicates
// ─────────────────────────────────────────────────────────────────────

/// `(op, has-result, result-subject)` — links an op to its result
/// subject. The result's own fiber holds the outcome claims.
pub const HAS_RESULT: &str = "has-result";

/// `(result | op, exited-with-code, code-string)` — numeric exit code
/// as decimal string. Can land on the op's fiber directly for ops
/// that don't bother minting a separate result subject.
pub const EXITED_WITH_CODE: &str = "exited-with-code";

/// `(result | op, exited-because, reason)` — reason string, e.g.
/// `"signal"`, `"exec-failed"`, `"parse-error"`.
pub const EXITED_BECAUSE: &str = "exited-because";

/// `(result | op, wrote-stdout, payload)` — stdout, inline string or
/// `blob:sha256:<hex>` reference for oversize output.
pub const WROTE_STDOUT: &str = "wrote-stdout";

/// `(result | op, wrote-stderr, payload)` — stderr, same semantics.
pub const WROTE_STDERR: &str = "wrote-stderr";

/// `(op, completed-at, iso-timestamp)` — ISO-8601 completion time.
pub const COMPLETED_AT: &str = "completed-at";

// ─────────────────────────────────────────────────────────────────────
// Metric predicates (uniform across effectors)
// ─────────────────────────────────────────────────────────────────────

/// `(op, has-cost-usd, decimal-string)` — provider-billed cost.
pub const HAS_COST_USD: &str = "has-cost-usd";

/// `(op, has-duration-ms, integer-string)` — wall-clock duration.
pub const HAS_DURATION_MS: &str = "has-duration-ms";

/// `(op, has-token-count, integer-string)` — total tokens (input +
/// output when distinguishable).
pub const HAS_TOKEN_COUNT: &str = "has-token-count";

/// `(op, has-input-tokens, integer-string)` — input tokens when broken
/// out separately.
pub const HAS_INPUT_TOKENS: &str = "has-input-tokens";

/// `(op, has-output-tokens, integer-string)` — output tokens when
/// broken out separately.
pub const HAS_OUTPUT_TOKENS: &str = "has-output-tokens";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the operations / functions / results
/// vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Ops;

#[async_trait]
impl Agent for Ops {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Category terms specialize-as THING.
        for t in [OPERATION, FUNCTION, RESULT] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
            out.push(Claim::new(t, SPECIALIZES_AS, THING));
        }

        // Function kinds specialize-as FUNCTION.
        for f in [
            SHELL_FUNCTION,
            LLM_FUNCTION,
            FILE_FUNCTION,
            CONTAINER_FUNCTION,
            HUMAN_FUNCTION,
        ] {
            out.push(Claim::new(f, IS_A_TERM, IDENTITY));
            out.push(Claim::new(f, SPECIALIZES_AS, FUNCTION));
        }

        // All predicates.
        for p in [
            HAS_FUNCTION,
            HAS_ARGUMENT,
            TARGETS,
            RUNS_COMMAND,
            EXECUTES_ON,
            IS_INTENT_SET,
            IS_PENDING,
            IS_READY_TO_RUN,
            IS_RUNNING,
            IS_COMPLETED,
            IS_FAILED,
            PERFORMED_BY,
            HAS_RESULT,
            EXITED_WITH_CODE,
            EXITED_BECAUSE,
            WROTE_STDOUT,
            WROTE_STDERR,
            COMPLETED_AT,
            HAS_COST_USD,
            HAS_DURATION_MS,
            HAS_TOKEN_COUNT,
            HAS_INPUT_TOKENS,
            HAS_OUTPUT_TOKENS,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_terms_specialize_as_thing() {
        let claims = Ops.claims();
        for t in [OPERATION, FUNCTION, RESULT] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == t && c.predicate == SPECIALIZES_AS && c.object == THING),
                "{t} should specialize-as THING"
            );
        }
    }

    #[test]
    fn function_kinds_specialize_as_function() {
        let claims = Ops.claims();
        for f in [
            SHELL_FUNCTION,
            LLM_FUNCTION,
            FILE_FUNCTION,
            CONTAINER_FUNCTION,
            HUMAN_FUNCTION,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == f && c.predicate == SPECIALIZES_AS && c.object == FUNCTION),
                "{f} should specialize-as FUNCTION"
            );
        }
    }

    #[test]
    fn phase_predicates_declared() {
        let claims = Ops.claims();
        for p in [
            IS_PENDING,
            IS_READY_TO_RUN,
            IS_RUNNING,
            IS_COMPLETED,
            IS_FAILED,
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
    fn metric_predicates_declared() {
        let claims = Ops.claims();
        for p in [
            HAS_COST_USD,
            HAS_DURATION_MS,
            HAS_TOKEN_COUNT,
            HAS_INPUT_TOKENS,
            HAS_OUTPUT_TOKENS,
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
