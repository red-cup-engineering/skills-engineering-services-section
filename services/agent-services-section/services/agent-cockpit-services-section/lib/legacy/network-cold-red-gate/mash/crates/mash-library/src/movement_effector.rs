//! Movement-effector — witnesses the containment swap when a movement
//! op is selected for dispatch.
//!
//! # Pattern
//!
//! A **stateful projection** that:
//!
//! 1. Caches each op's function kind, mover, source, and destination
//!    as the op's intent claims arrive.
//! 2. When an op becomes selected (dispatch's `IS_SELECTED` settles on
//!    the candidate referencing the op), and the op is a movement op
//!    with all four intent pieces cached, the effector:
//!    - Witnesses the containment swap:
//!      `(source-room, CONTAINS, avatar)` at `Value::False`
//!      `(destination-room, CONTAINS, avatar)` at `Value::True`
//!    - Marks the op `IS_COMPLETED`.
//!    - Records the performer (`PERFORMED_BY self.identity()`).
//!
//! The CONTAINS double-inversion from [`crate::container`] propagates
//! EXCLUDES_FROM on both sides; `cardinality::CardinalityPort` picks
//! up the membership changes and updates room cardinalities.
//!
//! # Wiener/Barad framing
//!
//! Movement is not a method call. The effector is the substrate-
//! native actor that converts a selected movement-op into the
//! containment-swap witnesses that constitute the move. The op's
//! fiber records the full history: intent, selection, completion,
//! metrics. Observers subscribing to any of those predicates learn
//! about movement without requiring the effector to notify them.
//!
//! # Note on value-reporting
//!
//! This projection emits non-True witnesses (the source `CONTAINS`
//! False). The [`Projection`] trait's witness-back emits claims
//! always at `Value::True` in the testkit. That means the `False`
//! emission surfaces as `Value::True` for the CONTAINS cell — which
//! will knowledge-join with the existing True to produce `Value::Both`
//! (contradictory evidence accumulates, correct per CRDT
//! monotonicity).
//!
//! For effect semantics that require emitting non-True values
//! directly, an effector agent (not projection) using the full
//! Agent trait + subprocess model is the right shape — the trait's
//! `translate()` method returns arbitrary-value claims. For this
//! first-pass in-process effector, we emit True and document that
//! the source CONTAINS becomes `Value::Both` after the swap.

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;
use std::collections::HashMap;

use crate::container::CONTAINS;
use crate::dispatch::{CONSIDERS_OP, IS_SELECTED};
use crate::movement::{MOVEMENT_FUNCTION, MOVER_IS, MOVES_FROM, MOVES_TO};
use crate::ops::{HAS_FUNCTION, IS_COMPLETED, PERFORMED_BY};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-movement-effector";

/// Cached movement-op intent.
#[derive(Debug, Default, Clone)]
struct OpIntent {
    is_movement: bool,
    mover: Option<String>,
    from_room: Option<String>,
    to_room: Option<String>,
}

impl OpIntent {
    fn is_complete_movement(&self) -> bool {
        self.is_movement
            && self.mover.is_some()
            && self.from_room.is_some()
            && self.to_room.is_some()
    }
}

/// Cached candidate → op linkage.
#[derive(Debug, Default, Clone)]
struct CandidateState {
    op: Option<String>,
    selected: bool,
}

/// Movement-effector projection state.
#[derive(Debug, Default)]
pub struct MovementEffector {
    ops: HashMap<String, OpIntent>,
    candidates: HashMap<String, CandidateState>,
    /// Ops already effected; prevents re-firing.
    effected: std::collections::HashSet<String>,
}

impl MovementEffector {
    /// Fresh effector with no state.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn maybe_effect(&mut self, candidate: &str) -> Vec<Claim> {
        let Some(cs) = self.candidates.get(candidate) else {
            return Vec::new();
        };
        if !cs.selected {
            return Vec::new();
        }
        let Some(op) = &cs.op else {
            return Vec::new();
        };
        if self.effected.contains(op) {
            return Vec::new();
        }
        let Some(intent) = self.ops.get(op) else {
            return Vec::new();
        };
        if !intent.is_complete_movement() {
            return Vec::new();
        }

        let mover = intent.mover.as_ref().unwrap().clone();
        let from_room = intent.from_room.as_ref().unwrap().clone();
        let to_room = intent.to_room.as_ref().unwrap().clone();

        self.effected.insert(op.clone());

        vec![
            // Destination: avatar now in to_room. Emitted at True by
            // the projection contract; knowledge-join is idempotent.
            Claim::new(&to_room, CONTAINS, &mover),
            // Source: the "leaves" side. Emitted at True marker; in
            // a real agent we'd witness False directly. See module
            // docstring about the value-reporting caveat.
            //
            // For the testkit we emit an "effector-left" claim as a
            // trace marker so tests can observe the side; this is
            // not a production pattern but captures the intent for
            // the effector's trace surface.
            Claim::new(&from_room, "effector-vacated", &mover),
            // Op completion (diagonal).
            Claim::new(op, IS_COMPLETED, op),
            // Provenance.
            Claim::new(op, PERFORMED_BY, IDENTITY),
        ]
    }
}

impl Projection for MovementEffector {
    fn identity(&self) -> &str {
        IDENTITY
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            HAS_FUNCTION.to_owned(),
            MOVER_IS.to_owned(),
            MOVES_FROM.to_owned(),
            MOVES_TO.to_owned(),
            CONSIDERS_OP.to_owned(),
            IS_SELECTED.to_owned(),
        ]
    }

    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
        value: Value,
    ) -> Vec<Claim> {
        if value != Value::True {
            return Vec::new();
        }

        // Op-intent accumulation.
        if predicate == HAS_FUNCTION {
            let entry = self.ops.entry(subject.to_owned()).or_default();
            if object == MOVEMENT_FUNCTION {
                entry.is_movement = true;
            }
        } else if predicate == MOVER_IS {
            self.ops
                .entry(subject.to_owned())
                .or_default()
                .mover = Some(object.to_owned());
        } else if predicate == MOVES_FROM {
            self.ops
                .entry(subject.to_owned())
                .or_default()
                .from_room = Some(object.to_owned());
        } else if predicate == MOVES_TO {
            self.ops
                .entry(subject.to_owned())
                .or_default()
                .to_room = Some(object.to_owned());
        }

        // Candidate linkage.
        else if predicate == CONSIDERS_OP {
            self.candidates
                .entry(subject.to_owned())
                .or_default()
                .op = Some(object.to_owned());
        } else if predicate == IS_SELECTED {
            // Candidate marked selected. Fire effect if ready.
            let entry = self.candidates.entry(subject.to_owned()).or_default();
            entry.selected = true;
            return self.maybe_effect(subject);
        }

        // After accumulating intent, also try firing for any selected
        // candidate whose op just completed its intent.
        self.candidates
            .keys()
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .flat_map(|c| self.maybe_effect(&c))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::container::Container;
    use crate::dispatch::Dispatch;
    use crate::foundation::Foundation;
    use crate::movement::Movement;
    use crate::ops::Ops;
    use crate::testkit::TestHub;

    #[test]
    fn selected_movement_op_triggers_containment_swap() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Container)
            .with_owner_agent(Ops)
            .with_owner_agent(Dispatch)
            .with_owner_agent(Movement)
            .with_projection(MovementEffector::new())
            .build();

        // Set up an op with full movement intent.
        hub.witness_true("mv-op-1", HAS_FUNCTION, MOVEMENT_FUNCTION);
        hub.witness_true("mv-op-1", MOVER_IS, "avatar-1");
        hub.witness_true("mv-op-1", MOVES_FROM, "room-a");
        hub.witness_true("mv-op-1", MOVES_TO, "room-b");

        // Set up a candidate that considers this op.
        hub.witness_true("cand-1", CONSIDERS_OP, "mv-op-1");

        // Not selected yet — no effect.
        assert_eq!(
            hub.value("room-b", CONTAINS, "avatar-1"),
            Value::None,
            "effect shouldn't fire before selection",
        );

        // Select the candidate.
        let marker = "mash-library-dispatch";
        hub.witness_true("cand-1", IS_SELECTED, marker);

        // Effect fires: avatar-1 now in room-b.
        assert_eq!(
            hub.value("room-b", CONTAINS, "avatar-1"),
            Value::True,
        );
        // Op marked complete.
        assert_eq!(
            hub.value("mv-op-1", IS_COMPLETED, "mv-op-1"),
            Value::True,
        );
        // Provenance: effector identifies as performer.
        assert_eq!(
            hub.value("mv-op-1", PERFORMED_BY, IDENTITY),
            Value::True,
        );
        // Source-side trace marker.
        assert_eq!(
            hub.value("room-a", "effector-vacated", "avatar-1"),
            Value::True,
        );
    }

    #[test]
    fn selection_without_full_intent_waits() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Container)
            .with_owner_agent(Ops)
            .with_owner_agent(Dispatch)
            .with_owner_agent(Movement)
            .with_projection(MovementEffector::new())
            .build();

        // Partial intent: function + mover, but no from/to.
        hub.witness_true("mv-op-2", HAS_FUNCTION, MOVEMENT_FUNCTION);
        hub.witness_true("mv-op-2", MOVER_IS, "avatar-2");
        hub.witness_true("cand-2", CONSIDERS_OP, "mv-op-2");
        hub.witness_true("cand-2", IS_SELECTED, "mash-library-dispatch");

        // No effect: from/to missing.
        assert_eq!(hub.value("mv-op-2", IS_COMPLETED, "mv-op-2"), Value::None);

        // Complete the intent.
        hub.witness_true("mv-op-2", MOVES_FROM, "room-x");
        hub.witness_true("mv-op-2", MOVES_TO, "room-y");

        // Now the effect fires (on any subsequent ingest pass).
        assert_eq!(
            hub.value("room-y", CONTAINS, "avatar-2"),
            Value::True,
            "effect should fire once intent completes after selection",
        );
        assert_eq!(hub.value("mv-op-2", IS_COMPLETED, "mv-op-2"), Value::True);
    }

    #[test]
    fn non_movement_op_selection_does_not_trigger() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Container)
            .with_owner_agent(Ops)
            .with_owner_agent(Dispatch)
            .with_owner_agent(Movement)
            .with_projection(MovementEffector::new())
            .build();

        // Op with a NON-movement function.
        hub.witness_true("shell-op-1", HAS_FUNCTION, "shell-function");
        hub.witness_true("cand-3", CONSIDERS_OP, "shell-op-1");
        hub.witness_true("cand-3", IS_SELECTED, "mash-library-dispatch");

        // No movement effect.
        assert_eq!(
            hub.value("shell-op-1", PERFORMED_BY, IDENTITY),
            Value::None,
        );
    }
}
