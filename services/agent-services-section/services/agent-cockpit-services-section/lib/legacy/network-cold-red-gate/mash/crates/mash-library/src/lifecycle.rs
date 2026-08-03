//! Lifecycle + settlement vocabulary.
//!
//! Two related concerns in one module:
//!
//! # Lifecycle (port/agent self-reporting)
//!
//! Any port, hub, CLI, or agent that wants its runtime state visible
//! in the substrate witnesses these predicates on its own subject
//! (conventionally `port:<identity>` or `agent:<identity>`):
//!
//! - [`IS_STARTING`] — booting, not yet serving.
//! - [`IS_READY`] — initialization complete, serving.
//! - [`IS_STOPPED`] — clean shutdown.
//! - [`REPORTED_ERROR`] — fatal or significant error. Object is the
//!   message or a `blob:sha256:<hex>` reference for oversize text.
//! - [`REPORTED_WARNING`] — non-fatal anomaly.
//!
//! Past-tense for diagnostic predicates: `reported-error` describes
//! an event that happened, not an ongoing state. The subject isn't
//! "in an error state"; it reported an error and moved on. This
//! keeps the predicates composable with the other event-record
//! predicates (`observed`, `is-failed`, etc.).
//!
//! # Settlement (op shadow-kinds)
//!
//! Ops transition through settlement classifications as they execute
//! and reconcile:
//!
//! - [`SHADOW_KIND_IN_FLIGHT`] — mid-execution.
//! - [`SHADOW_KIND_UNPARTNERED`] — completed but no accounting
//!   counterpart on the books yet.
//! - [`SHADOW_KIND_UNSETTLED`] — partnered but not reconciled.
//! - [`SHADOW_KIND_CLOSED`] — reconciled, books closed.
//!
//! Paired markers:
//!
//! - [`IN_SHADOW`] (op → shadow-kind) + [`IN_SHADOW_BECAUSE`] (reason)
//! - [`IS_SETTLED`], [`IS_PARTNERED`], [`IS_CLOSED`] — single-direction
//!   diagonal flags (per inversion discipline; reverse queries use
//!   fiber scan at the object axis).
//! - [`BOOKS_CLOSED_AT`] (op → ISO-8601 timestamp).
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-vocab-lifecycle/` +
//! `archive/mash-vocab-settlement/`. The old crates wired each
//! settlement flag with `INVERTS_AS` to a *-OP converse — dropped
//! here per this library's inversion discipline (those are
//! converse-positive relations, not algebraic-negation pairs).

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, THING};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-lifecycle";

// ─────────────────────────────────────────────────────────────────────
// Lifecycle predicates
// ─────────────────────────────────────────────────────────────────────

/// `(subject, is-starting, iso8601)` — booting.
pub const IS_STARTING: &str = "is-starting";

/// `(subject, is-ready, iso8601)` — initialization complete.
pub const IS_READY: &str = "is-ready";

/// `(subject, is-stopped, iso8601)` — clean shutdown.
pub const IS_STOPPED: &str = "is-stopped";

/// `(subject, reported-error, message-or-blob-ref)` — fatal error
/// event record.
pub const REPORTED_ERROR: &str = "reported-error";

/// `(subject, reported-warning, message-or-blob-ref)` — non-fatal
/// anomaly record.
pub const REPORTED_WARNING: &str = "reported-warning";

// ─────────────────────────────────────────────────────────────────────
// Settlement shadow-kinds
// ─────────────────────────────────────────────────────────────────────

/// Category term: a settlement classification an op can carry.
pub const SHADOW_KIND: &str = "shadow-kind";

/// Shadow-kind value: op is mid-execution.
pub const SHADOW_KIND_IN_FLIGHT: &str = "shadow-kind:in-flight";
/// Shadow-kind value: op completed but no partnering balance on books.
pub const SHADOW_KIND_UNPARTNERED: &str = "shadow-kind:unpartnered";
/// Shadow-kind value: partnered but not reconciled.
pub const SHADOW_KIND_UNSETTLED: &str = "shadow-kind:unsettled";
/// Shadow-kind value: closed and reconciled.
pub const SHADOW_KIND_CLOSED: &str = "shadow-kind:closed";

// ─────────────────────────────────────────────────────────────────────
// Settlement predicates
// ─────────────────────────────────────────────────────────────────────

/// `(op, in-shadow, shadow-kind)` — which classification the op holds.
pub const IN_SHADOW: &str = "in-shadow";

/// `(op, in-shadow-because, reason-string)` — why the op is in that
/// shadow (e.g., "awaiting-reconciliation", "counterparty-delay").
pub const IN_SHADOW_BECAUSE: &str = "in-shadow-because";

/// Diagonal flag `(op, is-settled, op)` — settlement reconciled.
pub const IS_SETTLED: &str = "is-settled";

/// Diagonal flag `(op, is-partnered, op)` — partnered with its
/// accounting counterpart.
pub const IS_PARTNERED: &str = "is-partnered";

/// Diagonal flag `(op, is-closed, op)` — books closed for this op.
pub const IS_CLOSED: &str = "is-closed";

/// `(op, books-closed-at, iso8601)` — when books closed.
pub const BOOKS_CLOSED_AT: &str = "books-closed-at";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent for the lifecycle + settlement vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Lifecycle;

#[async_trait]
impl Agent for Lifecycle {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Shadow-kind category term and its values.
        out.push(Claim::new(SHADOW_KIND, IS_A_TERM, IDENTITY));
        out.push(Claim::new(SHADOW_KIND, SPECIALIZES_AS, THING));
        for k in [
            SHADOW_KIND_IN_FLIGHT,
            SHADOW_KIND_UNPARTNERED,
            SHADOW_KIND_UNSETTLED,
            SHADOW_KIND_CLOSED,
        ] {
            out.push(Claim::new(k, IS_A_TERM, IDENTITY));
            out.push(Claim::new(k, SPECIALIZES_AS, SHADOW_KIND));
        }

        // All predicates.
        for p in [
            IS_STARTING,
            IS_READY,
            IS_STOPPED,
            REPORTED_ERROR,
            REPORTED_WARNING,
            IN_SHADOW,
            IN_SHADOW_BECAUSE,
            IS_SETTLED,
            IS_PARTNERED,
            IS_CLOSED,
            BOOKS_CLOSED_AT,
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
    fn lifecycle_predicates_declared() {
        let claims = Lifecycle.claims();
        for p in [
            IS_STARTING,
            IS_READY,
            IS_STOPPED,
            REPORTED_ERROR,
            REPORTED_WARNING,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared"
            );
        }
    }

    #[test]
    fn shadow_kinds_specialize() {
        let claims = Lifecycle.claims();
        for k in [
            SHADOW_KIND_IN_FLIGHT,
            SHADOW_KIND_UNPARTNERED,
            SHADOW_KIND_UNSETTLED,
            SHADOW_KIND_CLOSED,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == k
                        && c.predicate == SPECIALIZES_AS
                        && c.object == SHADOW_KIND),
                "{k} should specialize-as shadow-kind"
            );
        }
    }

    #[test]
    fn settlement_predicates_declared() {
        let claims = Lifecycle.claims();
        for p in [IN_SHADOW, IS_SETTLED, IS_PARTNERED, IS_CLOSED, BOOKS_CLOSED_AT] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared"
            );
        }
    }

    #[test]
    fn no_spurious_inversions_declared() {
        let claims = Lifecycle.claims();
        use crate::foundation::INVERTS_AS;
        // Settlement flags (IS_SETTLED, IS_PARTNERED, IS_CLOSED) are
        // single-direction per inversion discipline. The old library
        // wired them to *-OP converses; this module does not.
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "no INVERTS_AS wiring should be declared in this module"
        );
    }
}
