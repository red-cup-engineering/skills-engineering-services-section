//! Shared types between the hub, the proof engine, and wire clients.
//!
//! Two concerns:
//!
//! - [`MorphismKind`] — the five primitive morphisms the cascade
//!   recognizes. Fixed in Rust; not user-extensible.
//! - [`wire`] — the socket protocol between hub and agents.
//!
//! Declarative content (predicate declarations, baseline claims)
//! ships in on-disk bundles, not in Rust. See
//! `mash-bundle` for the loader and `docs/bundle-layout.md` for the
//! format.

#![warn(missing_docs)]

use serde::{Deserialize, Serialize};

pub mod time;
pub mod wire;

/// The five morphisms proved exhaustive by the adjoint-predication
/// paper. Fixed in Rust; not user-extensible. The proof engine
/// installs *instances* when it sees claims whose predicate matches
/// one of the eleven reserved trigger names (`specializes-as`,
/// `inverts-as`, the three-role pair predicates for composition /
/// fusion / implication).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MorphismKind {
    /// `target` is a sub-predicate of `source`; values lift pointwise.
    Specialization,
    /// `target` is the subject/object swap of `source` with negated value.
    Inversion,
    /// Pair-by-subject `∧_k` of two source fibers; structured pair-O.
    Composition,
    /// Pair-by-subject `⊙` (extending); structured pair-O.
    Fusion,
    /// Pair-by-subject `⇒` (restricting); asymmetric; structured pair-O.
    Implication,
}
