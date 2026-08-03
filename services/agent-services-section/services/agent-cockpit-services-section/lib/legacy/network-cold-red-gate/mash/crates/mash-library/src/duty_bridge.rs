//! Duty-to-op bridge — makes offices operationally active.
//!
//! This projection closes the loop from the declarative [`crate::offices`]
//! layer to the operational [`crate::ops`] / [`crate::dispatch`] layers.
//! When a duty becomes ready (its conditions are satisfied, witnessed
//! by domain-specific readiness rule-ports), this projection mints
//! the concrete operation that enacts the duty's work and the
//! dispatch candidate that lets the cascade adjudicate it.
//!
//! # Flow
//!
//! 1. A duty declares what function-kind its work takes via
//!    `(duty, mints-op-with-function, function-kind)`.
//! 2. An office bears a duty via `(office, bears-duty, duty)`, and a
//!    person holds the office via `(person, holds-office, office)`.
//!    (Both cached by this projection from fiber subscriptions.)
//! 3. A readiness rule-port witnesses `(duty, is-duty-ready, duty)`
//!    True when the duty's preconditions settle.
//! 4. This projection, on seeing IS_DUTY_READY, mints:
//!    - An op subject: `op:from-duty-<duty-slug>-<counter>`.
//!    - `(op, has-function, <duty's function-kind>)`.
//!    - `(op, performed-by, <office-holder>)`.
//!    - `(op, is-pending, op)`.
//!    - A candidate: `cand:for-<op>`.
//!    - `(candidate, considers-op, op)`.
//!    - `(candidate, considers-performer, office-holder)`.
//!    - `(candidate, is-op-ready, marker)`.
//!    - `(duty, has-minted-op, op)` — records what the bridge did.
//! 5. Downstream: dispatch composition settles admissibility
//!    (pending availability of the performer), selector picks, the
//!    appropriate effector executes.
//!
//! # Once per duty-ready
//!
//! The bridge mints only once per duty (tracked in
//! [`DutyBridge::minted_for`]). If the duty is witnessed as ready
//! again (e.g., after completion for recurring duties), the bridge
//! needs to be re-instantiated or the minted-set cleared — future
//! work for recurring-duty semantics.
//!
//! # Wiener/Barad framing
//!
//! An office's duties aren't "triggered" by a method call. They
//! emerge as substrate work through the bridge's observation: the
//! duty's readiness is a settled claim; the bridge's minting is
//! also a settled claim set; the resulting op + candidate are
//! substrate-visible subjects. The office becomes operationally
//! active through the cascade's flow of claims, not through
//! imperative control.

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;
use std::collections::{HashMap, HashSet};

use crate::dispatch::{CONSIDERS_OP, CONSIDERS_PERFORMER, IS_OP_READY};
use crate::offices::{BEARS_DUTY, HAS_MINTED_OP, HOLDS_OFFICE, IS_DUTY_READY, MINTS_OP_WITH_FUNCTION};
use crate::ops::{HAS_FUNCTION, IS_PENDING, PERFORMED_BY};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-duty-bridge";

/// Marker used as object for admission-premise cells so the dispatch
/// compositions fire pointwise.
const DISPATCH_MARKER: &str = "mash-library-dispatch";

/// Duty-to-op bridge state.
#[derive(Debug, Default)]
pub struct DutyBridge {
    /// duty → function-kind it mints ops with.
    duty_fn: HashMap<String, String>,
    /// office → set of duties it bears.
    office_duties: HashMap<String, HashSet<String>>,
    /// duty → office that bears it (reverse index).
    duty_office: HashMap<String, String>,
    /// person → office(s) they hold. In the common case a person
    /// holds one office but multi-office is allowed.
    person_offices: HashMap<String, HashSet<String>>,
    /// office → person(s) holding it.
    office_holders: HashMap<String, HashSet<String>>,
    /// duties already minted from. Prevents re-minting on
    /// duplicate IS_DUTY_READY settlements.
    minted_for: HashSet<String>,
    /// Counter for unique op-id generation.
    next_op_id: u64,
}

impl DutyBridge {
    /// Fresh bridge.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Slugify a duty subject into an op-id-safe fragment.
    fn slug(s: &str) -> String {
        s.replace([':', '/', ' '], "-")
    }

    /// Look up the office that bears the duty, then the person
    /// holding that office. Returns `None` if either chain link is
    /// missing.
    fn find_performer(&self, duty: &str) -> Option<String> {
        let office = self.duty_office.get(duty)?;
        let holders = self.office_holders.get(office)?;
        holders.iter().next().cloned()
    }

    fn try_mint(&mut self, duty: &str) -> Vec<Claim> {
        if self.minted_for.contains(duty) {
            return Vec::new();
        }
        let Some(function) = self.duty_fn.get(duty).cloned() else {
            return Vec::new();
        };
        let Some(performer) = self.find_performer(duty) else {
            return Vec::new();
        };

        self.minted_for.insert(duty.to_owned());
        self.next_op_id += 1;
        let op = format!("op:from-duty-{}-{}", Self::slug(duty), self.next_op_id);
        let candidate = format!("cand:for-{op}");

        vec![
            // Op: function + performer + pending phase.
            Claim::new(&op, HAS_FUNCTION, function),
            Claim::new(&op, PERFORMED_BY, &performer),
            Claim::new(&op, IS_PENDING, &op),
            // Candidate: links op + performer, plus the op-ready
            // admission premise.
            Claim::new(&candidate, CONSIDERS_OP, &op),
            Claim::new(&candidate, CONSIDERS_PERFORMER, &performer),
            Claim::new(&candidate, IS_OP_READY, DISPATCH_MARKER),
            // Bookkeeping: duty now has a minted op.
            Claim::new(duty, HAS_MINTED_OP, &op),
        ]
    }
}

impl Projection for DutyBridge {
    fn identity(&self) -> &str {
        IDENTITY
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            MINTS_OP_WITH_FUNCTION.to_owned(),
            BEARS_DUTY.to_owned(),
            HOLDS_OFFICE.to_owned(),
            IS_DUTY_READY.to_owned(),
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

        match predicate {
            MINTS_OP_WITH_FUNCTION => {
                // (duty, mints-op-with-function, function-kind)
                self.duty_fn.insert(subject.to_owned(), object.to_owned());
            }
            BEARS_DUTY => {
                // (office, bears-duty, duty)
                self.office_duties
                    .entry(subject.to_owned())
                    .or_default()
                    .insert(object.to_owned());
                self.duty_office
                    .insert(object.to_owned(), subject.to_owned());
            }
            HOLDS_OFFICE => {
                // (person, holds-office, office)
                self.person_offices
                    .entry(subject.to_owned())
                    .or_default()
                    .insert(object.to_owned());
                self.office_holders
                    .entry(object.to_owned())
                    .or_default()
                    .insert(subject.to_owned());
            }
            IS_DUTY_READY => {
                // (duty, is-duty-ready, duty) — diagonal marker.
                return self.try_mint(subject);
            }
            _ => {}
        }
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::dispatch::Dispatch;
    use crate::foundation::Foundation;
    use crate::offices::Offices;
    use crate::ops::{Ops, SHELL_FUNCTION};
    use crate::testkit::TestHub;

    #[test]
    fn ready_duty_mints_op_and_candidate() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Ops)
            .with_owner_agent(Dispatch)
            .with_owner_agent(Offices)
            .with_projection(DutyBridge::new())
            .build();

        // Set up: office bears duty, person holds office, duty mints
        // a shell-function op.
        hub.witness_true("office:bookkeeper", BEARS_DUTY, "duty:weekly-ledger");
        hub.witness_true("emsenn", HOLDS_OFFICE, "office:bookkeeper");
        hub.witness_true(
            "duty:weekly-ledger",
            MINTS_OP_WITH_FUNCTION,
            SHELL_FUNCTION,
        );

        // Duty becomes ready — should mint.
        hub.witness_true("duty:weekly-ledger", IS_DUTY_READY, "duty:weekly-ledger");

        // Check: duty now has-minted-op with a specific op-subject.
        // (The op-id format is op:from-duty-duty-weekly-ledger-1 —
        // slug + counter.)
        let minted_op = "op:from-duty-duty-weekly-ledger-1";
        assert_eq!(
            hub.value("duty:weekly-ledger", HAS_MINTED_OP, minted_op),
            Value::True,
        );

        // Op has the right function and performer.
        assert_eq!(
            hub.value(minted_op, HAS_FUNCTION, SHELL_FUNCTION),
            Value::True,
        );
        assert_eq!(
            hub.value(minted_op, PERFORMED_BY, "emsenn"),
            Value::True,
        );
        assert_eq!(hub.value(minted_op, IS_PENDING, minted_op), Value::True);

        // Candidate is minted and linked.
        let candidate = format!("cand:for-{minted_op}");
        assert_eq!(
            hub.value(&candidate, CONSIDERS_OP, minted_op),
            Value::True,
        );
        assert_eq!(
            hub.value(&candidate, CONSIDERS_PERFORMER, "emsenn"),
            Value::True,
        );
        assert_eq!(
            hub.value(&candidate, IS_OP_READY, DISPATCH_MARKER),
            Value::True,
        );
    }

    #[test]
    fn ready_duty_without_function_does_not_mint() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Ops)
            .with_owner_agent(Dispatch)
            .with_owner_agent(Offices)
            .with_projection(DutyBridge::new())
            .build();

        // Office/holder set up, but no MINTS_OP_WITH_FUNCTION.
        hub.witness_true("office:bookkeeper", BEARS_DUTY, "duty:orphan");
        hub.witness_true("emsenn", HOLDS_OFFICE, "office:bookkeeper");
        hub.witness_true("duty:orphan", IS_DUTY_READY, "duty:orphan");

        // No minting happened.
        assert_eq!(
            hub.value("duty:orphan", HAS_MINTED_OP, "anything"),
            Value::None,
        );
    }

    #[test]
    fn ready_duty_without_performer_does_not_mint() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Ops)
            .with_owner_agent(Dispatch)
            .with_owner_agent(Offices)
            .with_projection(DutyBridge::new())
            .build();

        hub.witness_true("office:unstaffed", BEARS_DUTY, "duty:staffed");
        hub.witness_true(
            "duty:staffed",
            MINTS_OP_WITH_FUNCTION,
            SHELL_FUNCTION,
        );
        // No one holds the office.
        hub.witness_true("duty:staffed", IS_DUTY_READY, "duty:staffed");

        // No minting — no performer.
        let minted_op = "op:from-duty-duty-staffed-1";
        assert_eq!(
            hub.value(minted_op, HAS_FUNCTION, SHELL_FUNCTION),
            Value::None,
        );
    }

    #[test]
    fn duplicate_ready_does_not_remint() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Ops)
            .with_owner_agent(Dispatch)
            .with_owner_agent(Offices)
            .with_projection(DutyBridge::new())
            .build();

        hub.witness_true("office:ok", BEARS_DUTY, "duty:x");
        hub.witness_true("emsenn", HOLDS_OFFICE, "office:ok");
        hub.witness_true("duty:x", MINTS_OP_WITH_FUNCTION, SHELL_FUNCTION);

        hub.witness_true("duty:x", IS_DUTY_READY, "duty:x");
        hub.witness_true("duty:x", IS_DUTY_READY, "duty:x"); // second ready

        // Only one op minted; counter is 1.
        let minted_op = "op:from-duty-duty-x-1";
        assert_eq!(
            hub.value("duty:x", HAS_MINTED_OP, minted_op),
            Value::True,
        );
        // No "-2" variant.
        assert_eq!(
            hub.value("duty:x", HAS_MINTED_OP, "op:from-duty-duty-x-2"),
            Value::None,
        );
    }
}
