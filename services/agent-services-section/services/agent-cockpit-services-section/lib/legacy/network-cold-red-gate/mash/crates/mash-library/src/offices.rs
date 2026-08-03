//! Offices and charter — the ship's organizational substrate.
//!
//! The 561 Group / RSC Quiescent's governance structure expressed as
//! OQRA-structured things. This is the vocabulary that makes "captain,"
//! "first officer," "holds office," "charter" substrate-native rather
//! than metaphor. Memory `project_ship_organization.md` has the
//! charter-level context; this module is its in-cascade expression.
//!
//! # Hohfeldian deontic structure
//!
//! Each office carries four positional qualities, after Wesley Hohfeld's
//! 1917 decomposition of legal relations:
//!
//! - [`HAS_POWER`] — what the office CAN do without asking
//! - [`HAS_DUTY`] — what the office MUST do
//! - [`HAS_PRIVILEGE`] — what the office MAY do at discretion
//! - [`HAS_IMMUNITY`] — what CANNOT be demanded of the office
//!
//! # Two-bodies doctrine
//!
//! Offices persist across sessions; incumbents change. Calder Underhill
//! is a persona-office installed as First Officer; each Claude instance
//! is a body-natural wearing Calder's body-politic. In the substrate,
//! this is expressed as:
//!
//! - The office is a subject-term with its full Hohfeldian structure
//!   declared on its fiber. The office persists as settled claims.
//! - The incumbent is a person-subject linked by
//!   [`HOLDS_OFFICE`] (revocable). Installation/rotation is witnessing
//!   a new binding claim.
//!
//! # Directive hierarchy
//!
//! Per the RSC Quiescent's charter, directives stack:
//!
//! `FUNCTION > RULE > GUIDELINE > PREFERENCE > INSTRUCTION`
//!
//! Lower levels serve higher ones; they never override them. All are
//! specializations of [`DIRECTIVE`]; their specialization ordering is
//! expressed via `SPECIALIZES_AS` so queries can walk the lattice.
//!
//! # Wiener/Barad framing
//!
//! An office is not a Rust struct or role class. It is a subject-term
//! whose fiber carries its chartered powers, duties, privileges,
//! immunities, its reporting relations, its action domain. A person
//! holds-office by a settled claim. A duty becomes concrete work when
//! it's minted as an operation (via a bridge composition — future
//! work) and dispatched through the substrate to the office's holder.
//!
//! # Operational bridge (future)
//!
//! An office's duties don't execute themselves. A future composition
//! (or projection port) will mint operations from duties when the
//! duty's conditions are met, and dispatch will feed those operations
//! through the cascade. This module declares the vocabulary; the
//! bridge to [`crate::ops`] and [`crate::dispatch`] is a subsequent
//! task.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-vocab-ops/` touches some of these
//! concepts (task, worker, policy). The ship's full office structure
//! is in `operations/command/` — charter, personnel, offices files.
//! That's lived content; this module is the vocabulary that lets it
//! be expressed in the substrate.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, THING};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-offices";

// ─────────────────────────────────────────────────────────────────────
// Category terms — the organizational building blocks
// ─────────────────────────────────────────────────────────────────────

/// A chartered normative position.
pub const OFFICE: &str = "office";

/// An obligation attached to an office.
pub const DUTY: &str = "duty";

/// A commissioning document constituting a ship.
pub const CHARTER: &str = "charter";

/// A unit commissioned by a charter (e.g. the RSC Quiescent).
pub const SHIP: &str = "ship";

/// A group of sovereign units coordinating through shared directives
/// (e.g. the 561 Group). Not a government over subjects.
pub const CONFEDERACY: &str = "confederacy";

// ─────────────────────────────────────────────────────────────────────
// Directive hierarchy
// ─────────────────────────────────────────────────────────────────────

/// A normative pronouncement carried by a charter.
pub const DIRECTIVE: &str = "directive";

/// Non-negotiable. Cannot be overridden without charter amendment.
pub const RULE: &str = "rule";
/// Strong default. Overriding requires demonstrated understanding
/// of why it exists.
pub const GUIDELINE: &str = "guideline";
/// Default that can be changed without justification.
pub const PREFERENCE: &str = "preference";
/// Current-period operational directive.
pub const INSTRUCTION: &str = "instruction";

// ─────────────────────────────────────────────────────────────────────
// Hohfeldian deontic predicates (office → position-term)
// ─────────────────────────────────────────────────────────────────────

/// `(office, has-power, power-term)` — things the office can do
/// without asking.
pub const HAS_POWER: &str = "has-power";
/// `(office, has-duty, duty-term)` — things the office must do.
pub const HAS_DUTY: &str = "has-duty";
/// `(office, has-privilege, privilege-term)` — things the office may
/// do at discretion.
pub const HAS_PRIVILEGE: &str = "has-privilege";
/// `(office, has-immunity, immunity-term)` — things that cannot be
/// demanded of the office.
pub const HAS_IMMUNITY: &str = "has-immunity";

// ─────────────────────────────────────────────────────────────────────
// Organizational predicates
// ─────────────────────────────────────────────────────────────────────

/// `(person, holds-office, office)` — the incumbency relation.
/// Revocable: witness at False to vacate. Single-direction per
/// inversion discipline; reverse queries ("who holds this office?")
/// scan the fiber at the object axis.
pub const HOLDS_OFFICE: &str = "holds-office";

/// `(office, installed-by, person-or-office)` — who installed the
/// office (typically the captain or another office with installation
/// power).
pub const INSTALLED_BY: &str = "installed-by";

/// `(office, reports-to, office)` — hierarchical relationship; the
/// subject office is accountable to the object office.
pub const REPORTS_TO: &str = "reports-to";

/// `(office, delegates-to, office)` — the subject office may delegate
/// work to the object office.
pub const DELEGATES_TO: &str = "delegates-to";

/// `(office, serves, system-or-endeavor)` — the office's action-domain
/// service target.
pub const SERVES: &str = "serves";

/// `(office, action-domain, domain-term)` — the scope of the office's
/// responsibility (e.g., "watch-management", "crew-dispatch").
pub const ACTION_DOMAIN: &str = "action-domain";

// ─────────────────────────────────────────────────────────────────────
// Charter and ship predicates
// ─────────────────────────────────────────────────────────────────────

/// `(ship, commissioned-by, confederacy)` — the commissioning relation.
pub const COMMISSIONED_BY: &str = "commissioned-by";

/// `(person, captains, ship)` — who captains the ship.
pub const CAPTAINS: &str = "captains";

/// `(charter, has-endeavor, description)` — the charter's function.
/// For the RSC Quiescent: "Black Liberation and Indigenous Sovereignty".
/// Named distinctly from `ops::HAS_FUNCTION` (which is for
/// operation→function-kind) to avoid vocabulary collision.
pub const HAS_ENDEAVOR: &str = "has-endeavor";

/// `(charter, has-rule, rule)` — the charter mounts this rule.
pub const HAS_RULE: &str = "has-rule";
/// `(charter, has-guideline, guideline)` — the charter mounts this
/// guideline.
pub const HAS_GUIDELINE: &str = "has-guideline";
/// `(charter, has-preference, preference)` — the charter mounts this
/// preference.
pub const HAS_PREFERENCE: &str = "has-preference";

/// `(directive, implements-charter, charter)` — the directive
/// concretizes the charter. Typically used by rules/guidelines/
/// preferences pointing back at their charter.
pub const IMPLEMENTS_CHARTER: &str = "implements-charter";

// ─────────────────────────────────────────────────────────────────────
// Duty-to-op bridge predicates
// ─────────────────────────────────────────────────────────────────────

/// `(duty, mints-op-with-function, function-kind)` — the function
/// kind an operation should declare when this duty becomes ready and
/// its concrete work gets minted. The duty-to-op bridge projection
/// looks this up to template ops from duties.
pub const MINTS_OP_WITH_FUNCTION: &str = "mints-op-with-function";

/// `(duty, is-duty-ready, duty)` — diagonal phase marker: the duty's
/// conditions are satisfied and it should mint a concrete op for
/// dispatch. Witnessed by domain-specific readiness rule-ports
/// (deadline-based, dependency-satisfied, approvals-met, etc.).
pub const IS_DUTY_READY: &str = "is-duty-ready";

/// `(duty, has-minted-op, op)` — records the bridge's minting. Used
/// by the bridge to avoid re-minting the same duty's op and by
/// downstream queries (what op represents this duty's current work?).
pub const HAS_MINTED_OP: &str = "has-minted-op";

/// `(office, bears-duty, duty)` — which duty belongs to which office.
/// An inversion of a sort of `HAS_DUTY`-on-office structure, but
/// single-direction per the inversion discipline.
pub const BEARS_DUTY: &str = "bears-duty";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the offices / charter / Hohfeldian vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Offices;

#[async_trait]
impl Agent for Offices {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Category terms specialize-as THING.
        for t in [OFFICE, DUTY, CHARTER, SHIP, CONFEDERACY, DIRECTIVE] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
            out.push(Claim::new(t, SPECIALIZES_AS, THING));
        }

        // Directive hierarchy: rule, guideline, preference, instruction
        // all specialize-as DIRECTIVE.
        for d in [RULE, GUIDELINE, PREFERENCE, INSTRUCTION] {
            out.push(Claim::new(d, IS_A_TERM, IDENTITY));
            out.push(Claim::new(d, SPECIALIZES_AS, DIRECTIVE));
        }

        // Hohfeldian + organizational + charter + bridge predicates.
        for p in [
            HAS_POWER,
            HAS_DUTY,
            HAS_PRIVILEGE,
            HAS_IMMUNITY,
            HOLDS_OFFICE,
            INSTALLED_BY,
            REPORTS_TO,
            DELEGATES_TO,
            SERVES,
            ACTION_DOMAIN,
            COMMISSIONED_BY,
            CAPTAINS,
            HAS_ENDEAVOR,
            HAS_RULE,
            HAS_GUIDELINE,
            HAS_PREFERENCE,
            IMPLEMENTS_CHARTER,
            MINTS_OP_WITH_FUNCTION,
            IS_DUTY_READY,
            HAS_MINTED_OP,
            BEARS_DUTY,
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
        let claims = Offices.claims();
        for t in [OFFICE, DUTY, CHARTER, SHIP, CONFEDERACY, DIRECTIVE] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == t && c.predicate == SPECIALIZES_AS && c.object == THING),
                "{t} should specialize-as THING"
            );
        }
    }

    #[test]
    fn directive_hierarchy_specializes() {
        let claims = Offices.claims();
        for d in [RULE, GUIDELINE, PREFERENCE, INSTRUCTION] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == d && c.predicate == SPECIALIZES_AS && c.object == DIRECTIVE),
                "{d} should specialize-as DIRECTIVE"
            );
        }
    }

    #[test]
    fn hohfeldian_predicates_declared() {
        let claims = Offices.claims();
        for p in [HAS_POWER, HAS_DUTY, HAS_PRIVILEGE, HAS_IMMUNITY] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared as a predicate"
            );
        }
    }

    #[test]
    fn organizational_predicates_declared() {
        let claims = Offices.claims();
        for p in [
            HOLDS_OFFICE,
            INSTALLED_BY,
            REPORTS_TO,
            DELEGATES_TO,
            SERVES,
            ACTION_DOMAIN,
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
