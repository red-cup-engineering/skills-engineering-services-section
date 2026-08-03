//! Capability matching — vocabulary + resolver projection.
//!
//! # Ontology
//!
//! Three levels:
//!
//! - [`CAPABILITY`] — a capability type (e.g., `capability:voice`,
//!   `capability:move`, `capability:approve-hiring`).
//! - [`CAP_INSTANCE`] — a specific ocap grant. Subject convention
//!   `cap-instance:<uuid>`. Represents "this authority, issued by
//!   account A, held by account B, scoped to context C."
//! - [`ROLE`] — a bundle of capabilities; roles can extend other
//!   roles transitively.
//!
//! # Relations
//!
//! - `(cap-instance, is-cap-of, capability)` — what capability type
//!   the instance grants.
//! - `(cap-instance, held-by, account)` — who holds it. Multi-valued:
//!   delegation adds cells. Revocation witnesses `held-by` at False;
//!   the cell raises to `Value::Both`, and a fail-closed policy port
//!   reads Both as "not held."
//! - `(cap-instance, granted-by, account)` — provenance.
//! - `(role, grants-capability, capability)` — what caps a role grants.
//! - `(role-a, extends-role, role-b)` — inheritance.
//! - `(account, has-role, role)` — direct assignment.
//! - `(cap-instance, scoped-to, subject)` — optional scope; absent
//!   means unscoped.
//! - `(account, has-effective-capability, capability)` — computed
//!   union, emitted by [`CapabilityResolverPort`].
//!
//! # Dispatch integration
//!
//! `(op, requires-capability, capability)` and `(performer,
//! has-effective-capability, capability)` are compared by the
//! resolver port for each dispatch candidate; if the performer's
//! effective cap set covers the op's required set, the port emits
//! `(candidate, is-capability-fit, marker)` (new predicate here);
//! otherwise `(candidate, is-capability-mismatched, marker)` for
//! the existing dispatch undercut.
//!
//! # Inversion discipline
//!
//! The old-library wired each converse (HELD_BY/HOLDS, etc.) with
//! `INVERTS_AS`; those are converse-positive pairs, not negation
//! pairs. This module uses single-direction predicates; reverse
//! queries use fiber-scan at the object axis.
//!
//! # Federation convention
//!
//! Account and cap-instance subjects are UUIDs. Two MASH instances
//! that both have a user named "morgan" would otherwise see their
//! accounts conflated into a single subject via `knowledge_join`.
//! Human-facing names go on other predicates (e.g.,
//! `has-account-name`); subject identity stays globally unique.

use async_trait::async_trait;
use mash_engine::algebra::Value;
use mash_engine::sdk::agent::{Agent, Projection};
use mash_engine::sdk::client::Claim;
use std::collections::{HashMap, HashSet};

use crate::dispatch::{
    CONSIDERS_OP, CONSIDERS_PERFORMER, IS_CAPABILITY_MISMATCHED,
};
use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, THING};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-capability";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A capability type.
pub const CAPABILITY: &str = "capability";
/// A specific capability grant (ocap).
pub const CAP_INSTANCE: &str = "cap-instance";
/// A bundle of capabilities; can inherit from other roles.
pub const ROLE: &str = "role";

// ─────────────────────────────────────────────────────────────────────
// Cap-instance predicates
// ─────────────────────────────────────────────────────────────────────

/// `(cap-instance, is-cap-of, capability)` — what type the instance
/// grants.
pub const IS_CAP_OF: &str = "is-cap-of";

/// `(cap-instance, held-by, account)` — who holds it. Multi-valued.
pub const HELD_BY: &str = "held-by";

/// `(cap-instance, granted-by, account)` — provenance.
pub const GRANTED_BY: &str = "granted-by";

/// `(cap-instance, scoped-to, subject)` — optional scope context.
pub const SCOPED_TO: &str = "scoped-to";

// ─────────────────────────────────────────────────────────────────────
// Role predicates
// ─────────────────────────────────────────────────────────────────────

/// `(role, grants-capability, capability)` — what caps a role grants.
pub const GRANTS_CAPABILITY: &str = "grants-capability";

/// `(role, extends-role, other-role)` — role inheritance.
pub const EXTENDS_ROLE: &str = "extends-role";

/// `(account, has-role, role)` — direct assignment.
pub const HAS_ROLE: &str = "has-role";

// ─────────────────────────────────────────────────────────────────────
// Resolution output predicates
// ─────────────────────────────────────────────────────────────────────

/// `(account, has-effective-capability, capability)` — computed union
/// from direct cap-instances + role walk. Emitted by the resolver
/// port.
pub const HAS_EFFECTIVE_CAPABILITY: &str = "has-effective-capability";

// ─────────────────────────────────────────────────────────────────────
// Dispatch integration predicates
// ─────────────────────────────────────────────────────────────────────

/// `(op, requires-capability, capability)` — an op's required
/// capability (one per requirement).
pub const REQUIRES_CAPABILITY: &str = "requires-capability";

/// `(candidate, is-capability-fit, marker)` — positive fit witness
/// emitted by the resolver when performer covers all required caps.
/// Feeds the dispatch admission chain.
pub const IS_CAPABILITY_FIT: &str = "is-capability-fit";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent for the capability vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Capability;

#[async_trait]
impl Agent for Capability {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        for t in [CAPABILITY, CAP_INSTANCE, ROLE] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
            out.push(Claim::new(t, SPECIALIZES_AS, THING));
        }

        for p in [
            IS_CAP_OF,
            HELD_BY,
            GRANTED_BY,
            SCOPED_TO,
            GRANTS_CAPABILITY,
            EXTENDS_ROLE,
            HAS_ROLE,
            HAS_EFFECTIVE_CAPABILITY,
            REQUIRES_CAPABILITY,
            IS_CAPABILITY_FIT,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        out
    }
}

// ─────────────────────────────────────────────────────────────────────
// Capability-resolver projection
// ─────────────────────────────────────────────────────────────────────

/// Dispatch marker used for is-capability-fit / is-capability-mismatched.
const DISPATCH_MARKER: &str = "mash-library-dispatch";

/// Capability-resolver projection state.
///
/// Observes structural predicates and maintains per-account
/// effective-capability sets. On dispatch candidates, compares op's
/// required caps against performer's effective caps and emits fit
/// or mismatch.
#[derive(Debug, Default)]
pub struct CapabilityResolverPort {
    // Direct cap-instance holdings: account → set of capability-types.
    direct_caps: HashMap<String, HashSet<String>>,
    // Cap-instance → (capability, [accounts holding it])
    instance_cap: HashMap<String, String>,
    instance_holders: HashMap<String, HashSet<String>>,

    // Role structure.
    role_grants: HashMap<String, HashSet<String>>,
    role_extends: HashMap<String, HashSet<String>>,
    account_roles: HashMap<String, HashSet<String>>,

    // Op requirements.
    op_requires: HashMap<String, HashSet<String>>,

    // Candidate → (op, performer).
    candidate_op: HashMap<String, String>,
    candidate_performer: HashMap<String, String>,

    // Candidates already decided (fit or mismatched).
    decided: HashSet<String>,
}

impl CapabilityResolverPort {
    /// Fresh resolver.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Compute the effective capability set for an account. Walks
    /// `has-role → extends-role*` + `grants-capability` + direct
    /// cap-instance holdings.
    fn effective_for(&self, account: &str) -> HashSet<String> {
        let mut caps = HashSet::new();

        // Direct cap-instances.
        if let Some(direct) = self.direct_caps.get(account) {
            caps.extend(direct.iter().cloned());
        }

        // Role walk.
        if let Some(roles) = self.account_roles.get(account) {
            let mut pending: Vec<String> = roles.iter().cloned().collect();
            let mut visited: HashSet<String> = HashSet::new();
            while let Some(role) = pending.pop() {
                if !visited.insert(role.clone()) {
                    continue;
                }
                if let Some(granted) = self.role_grants.get(&role) {
                    caps.extend(granted.iter().cloned());
                }
                if let Some(extends) = self.role_extends.get(&role) {
                    pending.extend(extends.iter().cloned());
                }
            }
        }

        caps
    }

    /// Try to resolve capability fit for a candidate. Returns emission
    /// claims (fit or mismatch) if both sides are known, else empty.
    fn resolve(&mut self, candidate: &str) -> Vec<Claim> {
        if self.decided.contains(candidate) {
            return Vec::new();
        }
        let Some(op) = self.candidate_op.get(candidate).cloned() else {
            return Vec::new();
        };
        let Some(performer) = self.candidate_performer.get(candidate).cloned() else {
            return Vec::new();
        };
        let Some(required) = self.op_requires.get(&op) else {
            // No required caps → trivially fit.
            self.decided.insert(candidate.to_owned());
            return vec![Claim::new(candidate, IS_CAPABILITY_FIT, DISPATCH_MARKER)];
        };

        let effective = self.effective_for(&performer);
        let missing: Vec<_> = required.difference(&effective).cloned().collect();

        self.decided.insert(candidate.to_owned());
        if missing.is_empty() {
            vec![Claim::new(candidate, IS_CAPABILITY_FIT, DISPATCH_MARKER)]
        } else {
            vec![Claim::new(candidate, IS_CAPABILITY_MISMATCHED, DISPATCH_MARKER)]
        }
    }
}

impl Projection for CapabilityResolverPort {
    fn identity(&self) -> &str {
        "mash-library-capability-resolver"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            IS_CAP_OF.to_owned(),
            HELD_BY.to_owned(),
            GRANTS_CAPABILITY.to_owned(),
            EXTENDS_ROLE.to_owned(),
            HAS_ROLE.to_owned(),
            REQUIRES_CAPABILITY.to_owned(),
            CONSIDERS_OP.to_owned(),
            CONSIDERS_PERFORMER.to_owned(),
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
            IS_CAP_OF => {
                // subject = cap-instance, object = capability
                self.instance_cap
                    .insert(subject.to_owned(), object.to_owned());
                // If we already know holders, add this cap to their
                // direct sets.
                if let Some(holders) = self.instance_holders.get(subject) {
                    for h in holders.clone() {
                        self.direct_caps
                            .entry(h)
                            .or_default()
                            .insert(object.to_owned());
                    }
                }
            }
            HELD_BY => {
                // subject = cap-instance, object = account
                self.instance_holders
                    .entry(subject.to_owned())
                    .or_default()
                    .insert(object.to_owned());
                if let Some(cap) = self.instance_cap.get(subject).cloned() {
                    self.direct_caps
                        .entry(object.to_owned())
                        .or_default()
                        .insert(cap);
                }
            }
            GRANTS_CAPABILITY => {
                // subject = role, object = capability
                self.role_grants
                    .entry(subject.to_owned())
                    .or_default()
                    .insert(object.to_owned());
            }
            EXTENDS_ROLE => {
                self.role_extends
                    .entry(subject.to_owned())
                    .or_default()
                    .insert(object.to_owned());
            }
            HAS_ROLE => {
                self.account_roles
                    .entry(subject.to_owned())
                    .or_default()
                    .insert(object.to_owned());
            }
            REQUIRES_CAPABILITY => {
                // subject = op, object = capability
                self.op_requires
                    .entry(subject.to_owned())
                    .or_default()
                    .insert(object.to_owned());
            }
            CONSIDERS_OP => {
                self.candidate_op
                    .insert(subject.to_owned(), object.to_owned());
                return self.resolve(subject);
            }
            CONSIDERS_PERFORMER => {
                self.candidate_performer
                    .insert(subject.to_owned(), object.to_owned());
                return self.resolve(subject);
            }
            _ => return Vec::new(),
        }

        // Structural change may newly resolve some pending candidates.
        let candidates: Vec<String> = self
            .candidate_op
            .keys()
            .cloned()
            .filter(|c| !self.decided.contains(c))
            .collect();
        candidates
            .into_iter()
            .flat_map(|c| self.resolve(&c))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_cap_holding_resolves_fit() {
        let mut port = CapabilityResolverPort::new();

        port.ingest("cap:001", IS_CAP_OF, "capability:voice", Value::True);
        port.ingest("cap:001", HELD_BY, "account:alice", Value::True);
        port.ingest("op:speak", REQUIRES_CAPABILITY, "capability:voice", Value::True);

        // Candidate linking.
        port.ingest("cand-1", CONSIDERS_OP, "op:speak", Value::True);
        let emitted = port.ingest(
            "cand-1",
            CONSIDERS_PERFORMER,
            "account:alice",
            Value::True,
        );

        assert!(emitted
            .iter()
            .any(|c| c.subject == "cand-1" && c.predicate == IS_CAPABILITY_FIT));
    }

    #[test]
    fn missing_cap_resolves_mismatch() {
        let mut port = CapabilityResolverPort::new();

        port.ingest("op:approve-hire", REQUIRES_CAPABILITY, "capability:hire", Value::True);
        port.ingest("cand-2", CONSIDERS_OP, "op:approve-hire", Value::True);
        let emitted = port.ingest(
            "cand-2",
            CONSIDERS_PERFORMER,
            "account:junior",
            Value::True,
        );

        assert!(emitted
            .iter()
            .any(|c| c.subject == "cand-2" && c.predicate == IS_CAPABILITY_MISMATCHED));
    }

    #[test]
    fn role_inheritance_resolves_correctly() {
        let mut port = CapabilityResolverPort::new();

        // role:captain grants capability:command.
        port.ingest("role:captain", GRANTS_CAPABILITY, "capability:command", Value::True);
        // role:admiral extends role:captain.
        port.ingest("role:admiral", EXTENDS_ROLE, "role:captain", Value::True);
        port.ingest("role:admiral", GRANTS_CAPABILITY, "capability:fleet", Value::True);
        // account:emsenn has role:admiral.
        port.ingest("account:emsenn", HAS_ROLE, "role:admiral", Value::True);
        // op:command-fleet requires both.
        port.ingest("op:command-fleet", REQUIRES_CAPABILITY, "capability:command", Value::True);
        port.ingest("op:command-fleet", REQUIRES_CAPABILITY, "capability:fleet", Value::True);

        port.ingest("cand-3", CONSIDERS_OP, "op:command-fleet", Value::True);
        let emitted = port.ingest(
            "cand-3",
            CONSIDERS_PERFORMER,
            "account:emsenn",
            Value::True,
        );

        assert!(emitted
            .iter()
            .any(|c| c.subject == "cand-3" && c.predicate == IS_CAPABILITY_FIT),
            "admiral with inherited captain caps should fit command-fleet"
        );
    }

    #[test]
    fn op_with_no_requirements_trivially_fits() {
        let mut port = CapabilityResolverPort::new();

        port.ingest("cand-4", CONSIDERS_OP, "op:free", Value::True);
        let emitted = port.ingest(
            "cand-4",
            CONSIDERS_PERFORMER,
            "account:anyone",
            Value::True,
        );

        assert!(emitted.iter().any(|c| c.predicate == IS_CAPABILITY_FIT));
    }

    #[test]
    fn decision_is_once_per_candidate() {
        let mut port = CapabilityResolverPort::new();
        port.ingest("cand-5", CONSIDERS_OP, "op:x", Value::True);
        let first = port.ingest("cand-5", CONSIDERS_PERFORMER, "acct:x", Value::True);
        assert!(!first.is_empty());

        // Second witness of the same candidate linking — no new
        // decision (decided set blocks re-emission).
        let second = port.ingest("cand-5", CONSIDERS_OP, "op:x", Value::True);
        assert!(second.is_empty(), "already-decided candidate re-emission");
    }
}
