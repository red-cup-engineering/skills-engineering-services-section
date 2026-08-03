//! In-process testkit — boots a Semiotics with owner-agents and
//! projections, pumps projection emissions back into the cascade to
//! fixpoint, exposes string-level assertion + readback API.
//!
//! # When to use
//!
//! The `mount()` helper in module integration tests settles static
//! owner-agent claims directly and exercises cascade compositions.
//! That's fine for testing declarative vocabulary. When a test needs
//! to exercise a **stateful projection** (whose emissions should feed
//! back into the cascade as more claims are witnessed), use this
//! testkit — it drives the projection loop in-process.
//!
//! # Pattern
//!
//! ```ignore
//! let mut hub = TestHub::builder()
//!     .with_owner_agent(Foundation)
//!     .with_owner_agent(Container)
//!     .with_projection(CardinalityPort::new())
//!     .build();
//!
//! hub.witness("room-a", CONTAINS, "rock-1", Value::True);
//! hub.witness("room-a", CONTAINS, "gem-7", Value::True);
//! assert_eq!(hub.value("room-a", HAS_CARDINALITY, "2"), Value::True);
//! ```
//!
//! # Semantics
//!
//! - `with_owner_agent(agent)` mounts the agent's static `claims()` at
//!   `Value::True` during `build()`. Owner claims land before any
//!   projections observe, so vocabulary-declaration does not trigger
//!   projection emissions. Mount projections that should observe
//!   owner claims via `mount_projection` after `build()`.
//! - `witness(s, p, o, value)` settles the claim; cascade runs; every
//!   newly-settled cell is offered to each mounted projection whose
//!   subscription list includes the predicate; projection emissions
//!   are then witnessed at `Value::True` and recursively dispatched.
//!   A bound caps the fan-out to catch emission loops.
//! - `value(s, p, o)` returns the current bilattice value or
//!   `Value::None` if the triple was never interned.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-testkit/src/lib.rs` — the reference
//! implementation with a richer API (`Trace`, `Fiber`, `expect_*`
//! assertion helpers). This module takes the core pattern; the
//! richer surface can grow back as needed.

#![warn(missing_docs)]

use mash_engine::algebra::Value;
use mash_engine::proof::{Claim as ProofClaim, Semiotics};
use mash_engine::sdk::agent::{Agent, Projection};
use mash_engine::sdk::client::Claim;
use std::collections::VecDeque;

/// Safety bound on projection fan-out iterations. Well-behaved
/// projections terminate in a handful of rounds; this high bound
/// catches emission loops without firing on legitimate cascades.
const MAX_FAN_OUT_ITERATIONS: usize = 4096;

struct MountedProjection {
    subscriptions: Vec<String>,
    projection: Box<dyn Projection>,
}

/// Fluent builder for [`TestHub`].
#[derive(Default)]
pub struct TestHubBuilder {
    owner_claims: Vec<Claim>,
    projections: Vec<MountedProjection>,
}

impl TestHubBuilder {
    /// Fresh builder with no mounts.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Mount an owner-agent's [`claims`](Agent::claims) for assertion
    /// at `build()`. Claims are queued; they become substrate content
    /// when the hub is built.
    #[must_use]
    pub fn with_owner_agent<A: Agent>(mut self, agent: A) -> Self {
        self.owner_claims.extend(agent.claims());
        self
    }

    /// Mount a projection that will receive every settled cell on its
    /// subscribed predicates. Projection emissions are witnessed back
    /// into the hub at `Value::True` and fan out to fixpoint.
    #[must_use]
    pub fn with_projection<P: Projection + 'static>(mut self, projection: P) -> Self {
        self.projections.push(MountedProjection {
            subscriptions: projection.subscriptions(),
            projection: Box::new(projection),
        });
        self
    }

    /// Build the hub. Owner-agent claims are asserted before any
    /// projection observes, so the initial vocabulary settlement is
    /// not intercepted by projections. Tests that want a projection
    /// to observe owner claims should mount via
    /// [`TestHub::mount_projection`] after construction and re-witness,
    /// or use [`Self::build_with_replay`].
    #[must_use]
    pub fn build(self) -> TestHub {
        let mut sub = Semiotics::new();
        for c in &self.owner_claims {
            let s = sub.intern(&c.subject);
            let p = sub.intern(&c.predicate);
            let o = sub.intern(&c.object);
            sub.assert(ProofClaim {
                subject: s,
                predicate: p,
                object: o,
                value: Value::True,
            });
        }
        TestHub {
            sub,
            projections: self.projections,
        }
    }

    /// Build the hub, then replay every owner-agent claim through the
    /// projection pump. Useful when projections need to observe scene
    /// declarations that are otherwise bypassed by the mount-time
    /// direct-assert path.
    ///
    /// Each owner-agent cell is dispatched to subscribed projections
    /// after the semiotics-level assertion; projection emissions fan
    /// out to fixpoint.
    ///
    /// # Panics
    ///
    /// Propagates the fan-out overflow panic if projections emit in
    /// a loop.
    #[must_use]
    pub fn build_with_replay(self) -> TestHub {
        let mut sub = Semiotics::new();
        for c in &self.owner_claims {
            let s = sub.intern(&c.subject);
            let p = sub.intern(&c.predicate);
            let o = sub.intern(&c.object);
            sub.assert(ProofClaim {
                subject: s,
                predicate: p,
                object: o,
                value: Value::True,
            });
        }
        let owner_claims = self.owner_claims;
        let mut hub = TestHub {
            sub,
            projections: self.projections,
        };
        for c in &owner_claims {
            hub.dispatch_cell(&c.subject, &c.predicate, &c.object);
        }
        hub
    }
}

/// A booted substrate with a string-level assertion API and
/// projection-event pump.
pub struct TestHub {
    sub: Semiotics,
    projections: Vec<MountedProjection>,
}

impl TestHub {
    /// Entry point for fluent construction.
    #[must_use]
    pub fn builder() -> TestHubBuilder {
        TestHubBuilder::new()
    }

    /// Borrow the underlying [`Semiotics`] for cases the DSL doesn't
    /// cover.
    #[must_use]
    pub fn semiotics(&self) -> &Semiotics {
        &self.sub
    }

    /// Mutable escape hatch.
    pub fn semiotics_mut(&mut self) -> &mut Semiotics {
        &mut self.sub
    }

    /// Mount a projection after construction.
    pub fn mount_projection<P: Projection + 'static>(&mut self, projection: P) -> &mut Self {
        self.projections.push(MountedProjection {
            subscriptions: projection.subscriptions(),
            projection: Box::new(projection),
        });
        self
    }

    /// Witness a claim at the given value and pump projection
    /// emissions to fixpoint.
    ///
    /// # Panics
    ///
    /// Panics if projection emissions don't quiesce within
    /// [`MAX_FAN_OUT_ITERATIONS`] rounds (indicates an emission loop).
    pub fn witness(&mut self, s: &str, p: &str, o: &str, value: Value) {
        let direct = self.assert_raw(s, p, o, value);

        if self.projections.is_empty() {
            return;
        }

        // Collect settled cells from the direct assertion in wire
        // form for projection dispatch.
        let interner = self.sub.interner();
        let to_wire = |c: &ProofClaim| -> (String, String, String, Value) {
            (
                interner.name(c.subject).map(ToOwned::to_owned).unwrap_or_default(),
                interner.name(c.predicate).map(ToOwned::to_owned).unwrap_or_default(),
                interner.name(c.object).map(ToOwned::to_owned).unwrap_or_default(),
                c.value,
            )
        };
        let initial_events: Vec<_> = direct
            .settled
            .iter()
            .map(|r| to_wire(&r.claim))
            .collect();

        let mut queue: VecDeque<Claim> = VecDeque::new();
        dispatch_to_projections(&mut self.projections, &initial_events, &mut queue);

        let mut iterations = 0usize;
        while let Some(c) = queue.pop_front() {
            iterations += 1;
            assert!(
                iterations < MAX_FAN_OUT_ITERATIONS,
                "TestHub projection fan-out exceeded {MAX_FAN_OUT_ITERATIONS} iterations; likely emission loop",
            );
            let emit_direct = self.assert_raw(&c.subject, &c.predicate, &c.object, Value::True);
            let interner = self.sub.interner();
            let to_wire = |c: &ProofClaim| -> (String, String, String, Value) {
                (
                    interner.name(c.subject).map(ToOwned::to_owned).unwrap_or_default(),
                    interner.name(c.predicate).map(ToOwned::to_owned).unwrap_or_default(),
                    interner.name(c.object).map(ToOwned::to_owned).unwrap_or_default(),
                    c.value,
                )
            };
            let emit_events: Vec<_> = emit_direct
                .settled
                .iter()
                .map(|r| to_wire(&r.claim))
                .collect();
            dispatch_to_projections(&mut self.projections, &emit_events, &mut queue);
        }
    }

    /// Witness a claim at `Value::True`.
    pub fn witness_true(&mut self, s: &str, p: &str, o: &str) {
        self.witness(s, p, o, Value::True);
    }

    /// Force-dispatch an already-settled cell through the projection
    /// pump. Used by [`TestHubBuilder::build_with_replay`] to let
    /// projections observe owner-agent mount claims.
    ///
    /// Unlike [`Self::witness`], this does NOT re-assert the cell —
    /// it only dispatches the (s, p, o, True) tuple to subscribed
    /// projections and fans their emissions.
    ///
    /// # Panics
    ///
    /// Panics on projection fan-out overflow.
    pub fn dispatch_cell(&mut self, s: &str, p: &str, o: &str) {
        if self.projections.is_empty() {
            return;
        }
        let events = vec![(s.to_owned(), p.to_owned(), o.to_owned(), Value::True)];
        let mut queue: VecDeque<Claim> = VecDeque::new();
        dispatch_to_projections(&mut self.projections, &events, &mut queue);

        let mut iterations = 0usize;
        while let Some(c) = queue.pop_front() {
            iterations += 1;
            assert!(
                iterations < MAX_FAN_OUT_ITERATIONS,
                "TestHub projection fan-out exceeded {MAX_FAN_OUT_ITERATIONS} iterations; likely emission loop",
            );
            let emit_direct = self.assert_raw(&c.subject, &c.predicate, &c.object, Value::True);
            let interner = self.sub.interner();
            let to_wire = |c: &ProofClaim| -> (String, String, String, Value) {
                (
                    interner.name(c.subject).map(ToOwned::to_owned).unwrap_or_default(),
                    interner.name(c.predicate).map(ToOwned::to_owned).unwrap_or_default(),
                    interner.name(c.object).map(ToOwned::to_owned).unwrap_or_default(),
                    c.value,
                )
            };
            let emit_events: Vec<_> = emit_direct
                .settled
                .iter()
                .map(|r| to_wire(&r.claim))
                .collect();
            dispatch_to_projections(&mut self.projections, &emit_events, &mut queue);
        }
    }

    /// Witness a claim at `Value::False`.
    pub fn witness_false(&mut self, s: &str, p: &str, o: &str) {
        self.witness(s, p, o, Value::False);
    }

    /// Current value of a cell, or `Value::None` if any of the three
    /// terms have never been interned.
    #[must_use]
    pub fn value(&self, s: &str, p: &str, o: &str) -> Value {
        let i = self.sub.interner();
        match (i.get(s), i.get(p), i.get(o)) {
            (Some(s), Some(p), Some(o)) => self.sub.value(s, p, o),
            _ => Value::None,
        }
    }

    /// Assert a cell settled to `Value::True`. Panics with a helpful
    /// diagnostic if not.
    ///
    /// # Panics
    ///
    /// Panics when the cell's actual value is not `Value::True`.
    #[track_caller]
    pub fn expect_true(&self, s: &str, p: &str, o: &str) {
        let got = self.value(s, p, o);
        assert_eq!(
            got,
            Value::True,
            "expected ({s}, {p}, {o}) = True, got {got:?}"
        );
    }

    /// Assert a cell settled to `Value::False`.
    ///
    /// # Panics
    ///
    /// Panics when the cell's actual value is not `Value::False`.
    #[track_caller]
    pub fn expect_false(&self, s: &str, p: &str, o: &str) {
        let got = self.value(s, p, o);
        assert_eq!(
            got,
            Value::False,
            "expected ({s}, {p}, {o}) = False, got {got:?}"
        );
    }

    /// Assert a cell is `Value::None` (never witnessed, or all
    /// witnesses combined to None).
    ///
    /// # Panics
    ///
    /// Panics when the cell has any settled value other than None.
    #[track_caller]
    pub fn expect_none(&self, s: &str, p: &str, o: &str) {
        let got = self.value(s, p, o);
        assert_eq!(got, Value::None, "expected ({s}, {p}, {o}) = None, got {got:?}");
    }

    /// Assert that at least one object exists for which the predicate
    /// at the given subject has settled True — i.e. there's *some*
    /// outbound edge from the subject at the predicate. Useful when
    /// the specific object is minted dynamically and hard to predict.
    ///
    /// Returns the first matching object.
    ///
    /// # Panics
    ///
    /// Panics when no object yields `Value::True` at `(s, p, _)`.
    #[track_caller]
    #[must_use]
    pub fn expect_any_object_for(&self, s: &str, p: &str) -> String {
        let i = self.sub.interner();
        let Some(subject) = i.get(s) else {
            panic!("subject {s} never interned");
        };
        let Some(predicate) = i.get(p) else {
            panic!("predicate {p} never interned");
        };
        for id in 0..i.len() {
            let object_id = id as mash_engine::proof::TermId;
            if self.sub.value(subject, predicate, object_id) == Value::True {
                let name = i.name(object_id).unwrap_or("?").to_owned();
                return name;
            }
        }
        panic!("no object found where ({s}, {p}, _) = True");
    }

    /// Witness multiple claims at True in order. Convenience for
    /// scene-setup batches.
    pub fn witness_all_true(&mut self, triples: &[(&str, &str, &str)]) {
        for (s, p, o) in triples {
            self.witness_true(s, p, o);
        }
    }

    fn assert_raw(&mut self, s: &str, p: &str, o: &str, value: Value) -> mash_engine::proof::SemiosisTrace {
        let subject = self.sub.intern(s);
        let predicate = self.sub.intern(p);
        let object = self.sub.intern(o);
        self.sub.assert(ProofClaim {
            subject,
            predicate,
            object,
            value,
        })
    }
}

fn dispatch_to_projections(
    projections: &mut [MountedProjection],
    events: &[(String, String, String, Value)],
    queue: &mut VecDeque<Claim>,
) {
    for (s, p, o, v) in events {
        for mp in projections.iter_mut() {
            if !mp.subscriptions.iter().any(|sub| sub == p) {
                continue;
            }
            for emitted in mp.projection.ingest(s, p, o, *v) {
                queue.push_back(emitted);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::cardinality::CardinalityPort;
    use crate::container::{CONTAINS, Container, HAS_CARDINALITY};
    use crate::foundation::Foundation;

    #[test]
    fn owner_agent_mount_settles_declarations() {
        let hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .build();

        assert_eq!(
            hub.value("is-a-predicate", "is-a-predicate", "mash-library-foundation"),
            Value::True,
        );
    }

    #[test]
    fn projection_emissions_fan_back_into_cascade() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Container)
            .with_projection(CardinalityPort::new())
            .build();

        hub.witness_true("room-a", CONTAINS, "rock-1");
        assert_eq!(
            hub.value("room-a", HAS_CARDINALITY, "1"),
            Value::True,
            "projection should have emitted HAS_CARDINALITY=1 which settled via fan-out"
        );

        hub.witness_true("room-a", CONTAINS, "gem-7");
        assert_eq!(
            hub.value("room-a", HAS_CARDINALITY, "2"),
            Value::True,
            "second member should increment cardinality to 2"
        );

        // CRDT monotonicity: the "1" cell is also still True (never
        // retracted).
        assert_eq!(
            hub.value("room-a", HAS_CARDINALITY, "1"),
            Value::True,
        );
    }

    #[test]
    fn hub_without_projections_just_cascades() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Container)
            .build();

        // No projections. CONTAINS double-inversion should still fire.
        hub.witness_true("room-a", CONTAINS, "rock-1");
        assert_eq!(
            hub.value("room-a", CONTAINS, "rock-1"),
            Value::True,
        );
        assert_eq!(
            hub.value("rock-1", "excludes-from", "room-a"),
            Value::False,
        );
    }
}
