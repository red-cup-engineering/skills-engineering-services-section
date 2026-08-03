//! Intent — thin specialization layer threading request origin into
//! other surfaces.
//!
//! # What this module adds
//!
//! The intent predicates let a request's origin and its reply
//! destination compose with the surfaces elsewhere in the library:
//!
//! - [`INTENDS`] — an issuer → the request it issued. Specialization
//!   trigger for downstream consumers that want to walk "what did
//!   agent-X issue?" queries.
//! - [`crate::perception::REPORTS_TO`] already exists at the
//!   perception layer; here we lift it via specialization-as to
//!   [`crate::conduit::WAS_SAID_IN`] so a perception's reply channel
//!   naturally composes with the surface-ready body pipeline.
//! - [`crate::ops::WROTE_STDOUT`] already exists on ops; here we lift
//!   it to [`crate::conduit::HAS_BODY`] so a subprocess's stdout
//!   automatically materializes as a surface-ready message body.
//!
//! # Why only three cells
//!
//! The old `mash-vocab-intent` also declared `INTENDED_BY` as the
//! inverse of `INTENDS`. Per inversion discipline that's converse-
//! positive, not algebraic-negation — dropped. Reverse queries scan
//! the fiber at object axis.
//!
//! Most of what the old intent vocab provided is already in
//! [`crate::perception`] and [`crate::conduit`]; this module is the
//! narrow seam that wires them into one another.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::conduit::{HAS_BODY, WAS_SAID_IN};
use crate::foundation::{IS_A_PREDICATE, SPECIALIZES_AS};
use crate::ops::WROTE_STDOUT;
use crate::perception::REPORTS_TO;

/// Owner identity.
pub const IDENTITY: &str = "mash-library-intent";

/// `(issuer, intends, request)` — issuer → the request subject they
/// minted. Complements
/// [`crate::conduit::ISSUED_BY_SESSION`] (request → session) with a
/// subject-shaped issuer-of claim useful for agent origin tracking
/// independent of the session fiber.
pub const INTENDS: &str = "intends";

/// Owner-agent declaring the intent vocabulary + the two
/// specialization lifts.
#[derive(Debug, Clone, Copy, Default)]
pub struct Intent;

#[async_trait]
impl Agent for Intent {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        vec![
            Claim::new(INTENDS, IS_A_PREDICATE, IDENTITY),
            // REPORTS_TO (at the perception layer) is a specialization
            // of WAS_SAID_IN (at the conduit layer): reporting to a
            // session is saying on its channel.
            Claim::new(REPORTS_TO, SPECIALIZES_AS, WAS_SAID_IN),
            // WROTE_STDOUT (at the ops layer) is a specialization of
            // HAS_BODY (at the conduit layer): an op's stdout is the
            // body of the message it surfaces.
            Claim::new(WROTE_STDOUT, SPECIALIZES_AS, HAS_BODY),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intends_declared_as_predicate() {
        let claims = Intent.claims();
        assert!(claims
            .iter()
            .any(|c| c.subject == INTENDS && c.predicate == IS_A_PREDICATE));
    }

    #[test]
    fn reports_to_specializes_as_was_said_in() {
        let claims = Intent.claims();
        assert!(claims.iter().any(|c| c.subject == REPORTS_TO
            && c.predicate == SPECIALIZES_AS
            && c.object == WAS_SAID_IN));
    }

    #[test]
    fn wrote_stdout_specializes_as_has_body() {
        let claims = Intent.claims();
        assert!(claims.iter().any(|c| c.subject == WROTE_STDOUT
            && c.predicate == SPECIALIZES_AS
            && c.object == HAS_BODY));
    }

    #[test]
    fn no_inverts_as_wiring() {
        let claims = Intent.claims();
        use crate::foundation::INVERTS_AS;
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "intent module should declare no INVERTS_AS pairs"
        );
    }
}
