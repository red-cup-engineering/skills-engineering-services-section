//! # MASH Engine
//!
//! The substrate of MASH: the four-valued Belnap 2⊗2 bilattice algebra,
//! the inference cascade with its five morphisms, the proof engine that
//! settles claims under CRDT monotonicity, and the hub that owns the
//! socket and coordinates ports.
//!
//! The engine is **ontology-neutral**. It provides the mathematical and
//! coordinative primitives — claims, fibers, morphisms, derivation —
//! without committing to what subjects, predicates, or objects *mean*.
//! Ontology lives in `mash-library`.
//!
//! ## Modules
//!
//! - [`algebra`] — the Belnap 2⊗2 bilattice (formerly `mash-math-bilattice`)
//! - [`inference`] — Claim, MorphismKind, wire types (formerly `mash-math-inference`)
//! - [`proof`] — the Semiotics proof runtime (formerly `mash-math-proof-engine`)
//! - [`hub`] — kernel, persistence, transport (formerly `mash-hub`)
//! - [`sdk`] — Agent trait and client-side wire (formerly `mash-sdk-agent`, `mash-sdk-client`)
//! - [`util`] — blob, hash, log, store, text (formerly `mash-util-*`)

#![warn(missing_docs)]

pub mod algebra;
pub mod inference;
pub mod proof;
pub mod hub;
pub mod sdk;
pub mod util;
