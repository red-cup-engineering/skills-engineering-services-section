//! Command layer — commands, argument patterns, runtime requests,
//! authorization fusion.
//!
//! # What a command is
//!
//! A command is a first-class subject declaring an invocation verb,
//! aliases, a description, an argument pattern, and (optionally) a
//! required capability. Commands are installed by any subject that
//! wants to make one available: session states, roles, rooms, items.
//! The parser walks the session's environment chain, gathering
//! [`PROVIDES_COMMAND`] claims to determine what's in scope.
//!
//! # Request lifecycle
//!
//! When the parser sees a line of input, it mints:
//!
//! - One **request** subject, decorated with
//!   `(request, issued-by-session, session)`,
//!   `(request, invokes-command, command)`.
//! - One **resolve-request** subject per slot in the command's
//!   argument pattern, decorated with
//!   `(resolve-request, resolves-for-request, request)`,
//!   `(resolve-request, resolves-slot, slot)`,
//!   `(resolve-request, resolver-kind, resolver)`,
//!   `(resolve-request, binds-to, <name>)`,
//!   `(resolve-request, has-post-verb-body, <text>)`.
//!
//! Resolver ports subscribe to [`RESOLVER_KIND`] filtered by the
//! kind they serve, read the accompanying claims, and witness back
//! `(request, has-binding-<name>, <value>)` on the original request
//! subject.
//!
//! # Authorization fusion
//!
//! Every rule-port emits a diagonal approval cell on the request:
//! `(request, is-approved-by-<rule>, request)`. A chain of pointwise
//! fusions reduces them to `(request, is-authorized-for, request)`.
//!
//! The cells live on the diagonal so pointwise fusion (which fires at
//! the same `(s, o)` coordinate) composes them correctly. Each step
//! in the chain has one anchor subject that wires the composition:
//!
//! - `fuse-env-and-cap`:
//!   `IS_APPROVED_BY_ENVIRONMENT ⊙ IS_APPROVED_BY_CAPABILITY → IS_APPROVED_BY_ENV_AND_CAP`
//! - `fuse-with-state`:
//!   `IS_APPROVED_BY_ENV_AND_CAP ⊙ IS_APPROVED_BY_STATE → IS_AUTHORIZED_FOR`
//!
//! Fusion semantics: `⊙(T, T) = T`, `⊙(T, F) = F`,
//! `⊙(None, anything) = None` — silence from any rule port defaults
//! the authorization to None = fail-closed.
//!
//! # Divergence from old-library
//!
//! The old-lib wiring declared `ISSUED_BY_SESSION INVERTS_AS
//! ISSUED_BY_SESSION_OF` and the same for `INVOKES_COMMAND`. Those
//! are converse-positive pairs, not algebraic-negation pairs — under
//! pointwise negation semantics they would propagate incorrectly.
//! Both dropped here; reverse queries use fiber scan at object axis.
//!
//! The old-lib also used "structured pair-O" on
//! `(request, has-raw-slot-input, (slot, text))` to carry slot-indexed
//! raw input. Structured pair-O is ruled out (cascade fusion is
//! pointwise, not pair-by-subject; memory note
//! `project_cascade_fusion_output`). The raw input moves onto the
//! per-slot resolve-request subject as [`HAS_POST_VERB_BODY`].

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{
    FUSES_INTO, IS_A_PREDICATE, IS_A_TERM, USES_AS_FUSION_LEFT, USES_AS_FUSION_RIGHT,
};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-command";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A command — a verb a session can invoke.
pub const COMMAND: &str = "command";

/// An argument pattern — the ordered slot signature of a command.
pub const ARG_PATTERN: &str = "arg-pattern";

/// An argument slot — one positioned input to a command.
pub const ARG_SLOT: &str = "arg-slot";

/// A resolver type — names a kind of token-to-subject resolver.
pub const RESOLVER: &str = "resolver";

/// A request — the runtime subject the parser emits per verb
/// invocation.
pub const REQUEST: &str = "request";

/// A resolve-request — one-per-slot transient subject that connects
/// the parser's raw input to a resolver port.
pub const RESOLVE_REQUEST: &str = "resolve-request";

// ─────────────────────────────────────────────────────────────────────
// Command metadata predicates
// ─────────────────────────────────────────────────────────────────────

/// `(command, has-verb-name, string)` — primary invocation token.
pub const HAS_VERB_NAME: &str = "has-verb-name";

/// `(command, has-alias, string)` — alternative invocation token.
/// Multi-valued.
pub const HAS_ALIAS: &str = "has-alias";

/// `(command, has-command-description, string)` — short human
/// description, surfaced by help.
///
/// Named specifically (not reusing [`crate::container::HAS_DESCRIPTION`])
/// because a command's description and a thing's description are
/// different substrate facts — a thing has physical description text;
/// a command has usage description text.
pub const HAS_COMMAND_DESCRIPTION: &str = "has-command-description";

/// `(command, has-usage, string)` — usage hint (e.g. `"say <message>"`).
pub const HAS_USAGE: &str = "has-usage";

/// `(command, has-arg-pattern, arg-pattern)` — the command's slot
/// signature.
pub const HAS_ARG_PATTERN: &str = "has-arg-pattern";

/// `(subject, provides-command, command)` — the subject makes this
/// command available to sessions rooted in its environment chain.
/// Asserted by session-states, roles, rooms, items.
pub const PROVIDES_COMMAND: &str = "provides-command";

/// `(session, has-available-command, command)` — the session's
/// currently-in-scope command set. Emitted by a tool-schema port
/// from [`PROVIDES_COMMAND`] walked through the session's environment.
pub const HAS_AVAILABLE_COMMAND: &str = "has-available-command";

// ─────────────────────────────────────────────────────────────────────
// Argument grammar predicates
// ─────────────────────────────────────────────────────────────────────

/// `(arg-pattern, has-arg-slot, slot)` — multi-valued.
pub const HAS_ARG_SLOT: &str = "has-arg-slot";

/// `(slot, at-position, decimal-string)` — 0-based position in the
/// input token stream.
pub const AT_POSITION: &str = "at-position";

/// `(slot, resolves-via, resolver)` — resolver type for this slot.
pub const RESOLVES_VIA: &str = "resolves-via";

/// `(slot, binds-as, name-string)` — the name under which the
/// resolved value is bound on the request (e.g. `"body"` produces
/// `has-binding-body`).
pub const BINDS_AS: &str = "binds-as";

// ─────────────────────────────────────────────────────────────────────
// Runtime request predicates
// ─────────────────────────────────────────────────────────────────────

/// `(request, invokes-command, command)` — command the parser
/// resolved from input.
pub const INVOKES_COMMAND: &str = "invokes-command";

// ─────────────────────────────────────────────────────────────────────
// Resolve-request predicates
// ─────────────────────────────────────────────────────────────────────

/// `(resolve-request, resolves-for-request, request)` — request this
/// resolve-request binds into.
pub const RESOLVES_FOR_REQUEST: &str = "resolves-for-request";

/// `(resolve-request, resolves-slot, slot)` — slot being filled.
pub const RESOLVES_SLOT: &str = "resolves-slot";

/// `(resolve-request, has-post-verb-body, text)` — everything the
/// user typed after the verb token; resolvers slice by position.
pub const HAS_POST_VERB_BODY: &str = "has-post-verb-body";

/// `(resolve-request, resolver-kind, resolver)` — resolver kind that
/// should handle this; duplicated from the slot so resolver ports can
/// subscribe to this predicate alone and filter by object.
pub const RESOLVER_KIND: &str = "resolver-kind";

/// `(resolve-request, binds-to, name-string)` — duplicated from the
/// slot so a resolver doesn't need to walk the slot fiber to know
/// which `has-binding-<name>` predicate to emit.
pub const BINDS_TO: &str = "binds-to";

// ─────────────────────────────────────────────────────────────────────
// Authorization diagonal cells (one per rule port)
//
// Convention: rule ports emit
//   (request, is-approved-by-<rule>, request)
// The object-axis is the request subject so pointwise fusion at the
// diagonal can compose them.
// ─────────────────────────────────────────────────────────────────────

/// Rule-port output: environment-chain approval. True iff the invoked
/// command is reachable via the session's environment chain's
/// [`PROVIDES_COMMAND`] fiber.
pub const IS_APPROVED_BY_ENVIRONMENT: &str = "is-approved-by-environment";

/// Rule-port output: capability approval. True iff the session holds
/// the cap the command requires (or the command has no requirement).
pub const IS_APPROVED_BY_CAPABILITY: &str = "is-approved-by-capability";

/// Rule-port output: session-state approval. True iff the session's
/// current FSM state provides the invoked command.
pub const IS_APPROVED_BY_STATE: &str = "is-approved-by-state";

/// Intermediate fusion output:
/// `IS_APPROVED_BY_ENVIRONMENT ⊙ IS_APPROVED_BY_CAPABILITY`.
pub const IS_APPROVED_BY_ENV_AND_CAP: &str = "is-approved-by-env-and-cap";

/// Final authorization cell. True iff every rule's approval fused to
/// True. Handler ports subscribe here, filtering by command.
pub const IS_AUTHORIZED_FOR: &str = "is-authorized-for";

// ─────────────────────────────────────────────────────────────────────
// Binding predicate
// ─────────────────────────────────────────────────────────────────────

/// `(request, has-binding-<name>, value)` — resolved slot binding.
/// The actual predicate used at runtime substitutes `<name>` with the
/// slot's [`BINDS_AS`] value. This constant is the generic prefix,
/// not a literal predicate — subscribers should subscribe to the
/// specific `has-binding-<expected-name>` predicate they consume.
pub const HAS_BINDING_PREFIX: &str = "has-binding";

// ─────────────────────────────────────────────────────────────────────
// Fusion anchor subjects
// ─────────────────────────────────────────────────────────────────────

const FUSE_ENV_AND_CAP: &str = "command:fuse-env-and-cap";
const FUSE_WITH_STATE: &str = "command:fuse-with-state";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the command vocabulary and the authorization
/// fusion chain.
#[derive(Debug, Clone, Copy, Default)]
pub struct Command;

#[async_trait]
impl Agent for Command {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        for t in [
            COMMAND,
            ARG_PATTERN,
            ARG_SLOT,
            RESOLVER,
            REQUEST,
            RESOLVE_REQUEST,
        ] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }

        for p in [
            HAS_VERB_NAME,
            HAS_ALIAS,
            HAS_COMMAND_DESCRIPTION,
            HAS_USAGE,
            HAS_ARG_PATTERN,
            PROVIDES_COMMAND,
            HAS_AVAILABLE_COMMAND,
            HAS_ARG_SLOT,
            AT_POSITION,
            RESOLVES_VIA,
            BINDS_AS,
            INVOKES_COMMAND,
            RESOLVES_FOR_REQUEST,
            RESOLVES_SLOT,
            HAS_POST_VERB_BODY,
            RESOLVER_KIND,
            BINDS_TO,
            IS_APPROVED_BY_ENVIRONMENT,
            IS_APPROVED_BY_CAPABILITY,
            IS_APPROVED_BY_STATE,
            IS_APPROVED_BY_ENV_AND_CAP,
            IS_AUTHORIZED_FOR,
            HAS_BINDING_PREFIX,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // Fusion chain step 1: env ⊙ cap → env-and-cap.
        out.push(Claim::new(
            FUSE_ENV_AND_CAP,
            USES_AS_FUSION_LEFT,
            IS_APPROVED_BY_ENVIRONMENT,
        ));
        out.push(Claim::new(
            FUSE_ENV_AND_CAP,
            USES_AS_FUSION_RIGHT,
            IS_APPROVED_BY_CAPABILITY,
        ));
        out.push(Claim::new(
            FUSE_ENV_AND_CAP,
            FUSES_INTO,
            IS_APPROVED_BY_ENV_AND_CAP,
        ));

        // Fusion chain step 2: env-and-cap ⊙ state → authorized.
        out.push(Claim::new(
            FUSE_WITH_STATE,
            USES_AS_FUSION_LEFT,
            IS_APPROVED_BY_ENV_AND_CAP,
        ));
        out.push(Claim::new(
            FUSE_WITH_STATE,
            USES_AS_FUSION_RIGHT,
            IS_APPROVED_BY_STATE,
        ));
        out.push(Claim::new(FUSE_WITH_STATE, FUSES_INTO, IS_AUTHORIZED_FOR));

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::foundation::INVERTS_AS;

    #[test]
    fn authorization_fusion_chain_wired() {
        let claims = Command.claims();
        let has = |s: &str, p: &str, o: &str| {
            claims
                .iter()
                .any(|c| c.subject == s && c.predicate == p && c.object == o)
        };
        assert!(has(
            FUSE_ENV_AND_CAP,
            USES_AS_FUSION_LEFT,
            IS_APPROVED_BY_ENVIRONMENT
        ));
        assert!(has(
            FUSE_ENV_AND_CAP,
            USES_AS_FUSION_RIGHT,
            IS_APPROVED_BY_CAPABILITY
        ));
        assert!(has(
            FUSE_ENV_AND_CAP,
            FUSES_INTO,
            IS_APPROVED_BY_ENV_AND_CAP
        ));
        assert!(has(
            FUSE_WITH_STATE,
            USES_AS_FUSION_LEFT,
            IS_APPROVED_BY_ENV_AND_CAP
        ));
        assert!(has(
            FUSE_WITH_STATE,
            USES_AS_FUSION_RIGHT,
            IS_APPROVED_BY_STATE
        ));
        assert!(has(FUSE_WITH_STATE, FUSES_INTO, IS_AUTHORIZED_FOR));
    }

    #[test]
    fn no_spurious_inversions() {
        // Inversion discipline: ISSUED_BY_SESSION / INVOKES_COMMAND
        // are converse-positive, not algebraic-negation pairs. Must
        // not declare INVERTS_AS.
        let claims = Command.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "command module should declare no INVERTS_AS wiring"
        );
    }

    #[test]
    fn core_predicates_declared() {
        let claims = Command.claims();
        for p in [
            HAS_VERB_NAME,
            HAS_ARG_PATTERN,
            PROVIDES_COMMAND,
            INVOKES_COMMAND,
            HAS_BINDING_PREFIX,
            IS_AUTHORIZED_FOR,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "missing declaration for {p}"
            );
        }
    }
}
