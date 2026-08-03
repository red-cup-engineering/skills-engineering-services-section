//! MUD verbs — shipping command roster, roles, capabilities, states.
//!
//! # What this is
//!
//! The concrete commands, capabilities, and roles a default MUD
//! instance ships with: look, go, quit, help, who, say, register,
//! login. Roles: anonymouse (default on connect), registered
//! (after authentication). The substrate-level framework for how
//! commands / capabilities / roles work lives in
//! [`crate::command`] and [`crate::capability`]; this module names
//! the particular set.
//!
//! Third parties extend or replace the roster by mounting a
//! different `MudVerbs`-shaped owner-agent (or additional ones —
//! the substrate unions claims across mounted agents).
//!
//! # Subject naming
//!
//! All declared subjects are prefixed with [`IDENTITY`] to prevent
//! collisions across federated instances. Predicates remain
//! unnamespaced — they're interoperable structure, meant to be
//! shared across vocabs.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::capability::{CAPABILITY, EXTENDS_ROLE, GRANTS_CAPABILITY, ROLE};
use crate::command::{
    ARG_SLOT, AT_POSITION, BINDS_AS, COMMAND, HAS_ALIAS, HAS_ARG_PATTERN, HAS_ARG_SLOT,
    HAS_COMMAND_DESCRIPTION, HAS_USAGE, HAS_VERB_NAME, PROVIDES_COMMAND, RESOLVER, RESOLVES_VIA,
};
use crate::capability::REQUIRES_CAPABILITY;
use crate::foundation::{IS_A_PREDICATE, IS_A_TERM};
use crate::mud::session::{IS_RESTRICTIVE_STATE, SESSION_STATE};

/// Owner identity. Also namespace prefix for declared subjects.
pub const IDENTITY: &str = "mash-library-mud-verbs";

// ─────────────────────────────────────────────────────────────────────
// Resolvers
// ─────────────────────────────────────────────────────────────────────

/// Resolver: capture whole post-verb body as one string. Used for
/// free-form args (say's body, look's target phrase).
pub const RESOLVER_STRING_REST: &str = "mash-library-mud-verbs:resolver:string-rest";

/// Resolver: capture one whitespace-delimited token as literal
/// string. Used for structured args where the handler will do its
/// own lookup (register's name, login's name+password).
pub const RESOLVER_LITERAL_STRING: &str = "mash-library-mud-verbs:resolver:literal-string";

// ─────────────────────────────────────────────────────────────────────
// Capabilities
// ─────────────────────────────────────────────────────────────────────

/// Observe the world — look, who, help.
pub const CAP_PERCEIVE: &str = "mash-library-mud-verbs:capability:perceive";
/// Traverse rooms.
pub const CAP_MOVE: &str = "mash-library-mud-verbs:capability:move";
/// Disconnect cleanly.
pub const CAP_DEPART: &str = "mash-library-mud-verbs:capability:depart";
/// Read help text.
pub const CAP_READ_HELP: &str = "mash-library-mud-verbs:capability:read-help";
/// See who else is connected.
pub const CAP_COMMUNE: &str = "mash-library-mud-verbs:capability:commune";
/// Speak on the global channel.
pub const CAP_VOICE: &str = "mash-library-mud-verbs:capability:voice";
/// Create a new account for this session.
pub const CAP_REGISTER_SELF: &str = "mash-library-mud-verbs:capability:register-self";
/// Authenticate an existing account onto this session.
pub const CAP_LOGIN_SELF: &str = "mash-library-mud-verbs:capability:login-self";

// ─────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────

/// Default role on connect. Grants observation, movement, register
/// and login. Does NOT grant voice.
pub const ROLE_ANONYMOUSE: &str = "mash-library-mud-verbs:role:anonymouse";

/// Role after authentication. Extends anonymouse; adds voice.
pub const ROLE_REGISTERED: &str = "mash-library-mud-verbs:role:registered";

// ─────────────────────────────────────────────────────────────────────
// Session states
// ─────────────────────────────────────────────────────────────────────

/// Default state on connection, before authentication.
pub const STATE_ANONYMOUSE: &str = "mash-library-mud-verbs:state:anonymouse";
/// After successful register or login.
pub const STATE_AUTHENTICATED: &str = "mash-library-mud-verbs:state:authenticated";
/// Entered on session end (quit or net-death). Marked
/// [`IS_RESTRICTIVE_STATE`] so the state-rule port denies every
/// command from a session in this state — a one-way trap.
pub const STATE_DEPARTED: &str = "mash-library-mud-verbs:state:departed";

// ─────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────

/// Look at current room or a named target.
pub const COMMAND_LOOK: &str = "mash-library-mud-verbs:command:look";
/// Move in a direction.
pub const COMMAND_GO: &str = "mash-library-mud-verbs:command:go";
/// Disconnect cleanly.
pub const COMMAND_QUIT: &str = "mash-library-mud-verbs:command:quit";
/// Show available commands or a specific command's help.
pub const COMMAND_HELP: &str = "mash-library-mud-verbs:command:help";
/// List connected sessions.
pub const COMMAND_WHO: &str = "mash-library-mud-verbs:command:who";
/// Speak to all sessions on the global channel.
pub const COMMAND_SAY: &str = "mash-library-mud-verbs:command:say";
/// Create an account and authenticate this session.
pub const COMMAND_REGISTER: &str = "mash-library-mud-verbs:command:register";
/// Authenticate an existing account onto this session.
pub const COMMAND_LOGIN: &str = "mash-library-mud-verbs:command:login";

// ─────────────────────────────────────────────────────────────────────
// Pattern subjects
// ─────────────────────────────────────────────────────────────────────

const PATTERN_LOOK: &str = "mash-library-mud-verbs:pattern:look";
const PATTERN_GO: &str = "mash-library-mud-verbs:pattern:go";
const PATTERN_HELP: &str = "mash-library-mud-verbs:pattern:help";
const PATTERN_SAY: &str = "mash-library-mud-verbs:pattern:say";
const PATTERN_REGISTER: &str = "mash-library-mud-verbs:pattern:register";
const PATTERN_LOGIN: &str = "mash-library-mud-verbs:pattern:login";

// ─────────────────────────────────────────────────────────────────────
// Binding predicates — one per `binds-as` value in the roster
// ─────────────────────────────────────────────────────────────────────

/// Look target, register/login name, etc. — subject or string.
pub const HAS_BINDING_TARGET: &str = "has-binding-target";
/// Direction token for `go`.
pub const HAS_BINDING_DIRECTION: &str = "has-binding-direction";
/// Topic for `help`.
pub const HAS_BINDING_TOPIC: &str = "has-binding-topic";
/// Free-form body for `say`.
pub const HAS_BINDING_BODY: &str = "has-binding-body";
/// Account name for `register` / `login`.
pub const HAS_BINDING_NAME: &str = "has-binding-name";
/// Password for `login`.
pub const HAS_BINDING_PASSWORD: &str = "has-binding-password";

/// All binding predicates, for vocab-mount iteration and port
/// subscription discovery.
pub const HAS_BINDING_PREDICATES: &[&str] = &[
    HAS_BINDING_TARGET,
    HAS_BINDING_DIRECTION,
    HAS_BINDING_TOPIC,
    HAS_BINDING_BODY,
    HAS_BINDING_NAME,
    HAS_BINDING_PASSWORD,
];

// ─────────────────────────────────────────────────────────────────────
// Command-declaration structures (data, not claims)
// ─────────────────────────────────────────────────────────────────────

struct CommandDecl {
    subject: &'static str,
    verb_name: &'static str,
    aliases: &'static [&'static str],
    description: &'static str,
    usage: &'static str,
    pattern: Option<&'static str>,
    required_cap: Option<&'static str>,
}

struct SlotDecl {
    subject: &'static str,
    position: &'static str,
    resolver: &'static str,
    binds_as: &'static str,
}

struct PatternDecl {
    subject: &'static str,
    slots: &'static [SlotDecl],
}

const COMMANDS: &[CommandDecl] = &[
    CommandDecl {
        subject: COMMAND_LOOK,
        verb_name: "look",
        aliases: &["l"],
        description: "Describe your surroundings, or a named target.",
        usage: "look [target]",
        pattern: Some(PATTERN_LOOK),
        required_cap: Some(CAP_PERCEIVE),
    },
    CommandDecl {
        subject: COMMAND_GO,
        verb_name: "go",
        aliases: &["move"],
        description: "Move in a direction.",
        usage: "go <direction>",
        pattern: Some(PATTERN_GO),
        required_cap: Some(CAP_MOVE),
    },
    CommandDecl {
        subject: COMMAND_QUIT,
        verb_name: "quit",
        aliases: &["exit"],
        description: "Leave the world.",
        usage: "quit",
        pattern: None,
        required_cap: Some(CAP_DEPART),
    },
    CommandDecl {
        subject: COMMAND_HELP,
        verb_name: "help",
        aliases: &["?"],
        description: "List the commands you can use, or describe one.",
        usage: "help [command]",
        pattern: Some(PATTERN_HELP),
        required_cap: Some(CAP_READ_HELP),
    },
    CommandDecl {
        subject: COMMAND_WHO,
        verb_name: "who",
        aliases: &[],
        description: "List the sessions currently connected.",
        usage: "who",
        pattern: None,
        required_cap: Some(CAP_COMMUNE),
    },
    CommandDecl {
        subject: COMMAND_SAY,
        verb_name: "say",
        aliases: &["'"],
        description: "Speak to every connected session.",
        usage: "say <message>",
        pattern: Some(PATTERN_SAY),
        required_cap: Some(CAP_VOICE),
    },
    CommandDecl {
        subject: COMMAND_REGISTER,
        verb_name: "register",
        aliases: &[],
        description: "Create an account with the given name. A password is generated and shown once.",
        usage: "register <name>",
        pattern: Some(PATTERN_REGISTER),
        required_cap: Some(CAP_REGISTER_SELF),
    },
    CommandDecl {
        subject: COMMAND_LOGIN,
        verb_name: "login",
        aliases: &[],
        description: "Authenticate to an existing account.",
        usage: "login <name> <password>",
        pattern: Some(PATTERN_LOGIN),
        required_cap: Some(CAP_LOGIN_SELF),
    },
];

const PATTERNS: &[PatternDecl] = &[
    PatternDecl {
        subject: PATTERN_LOOK,
        slots: &[SlotDecl {
            subject: "mash-library-mud-verbs:slot:look-target",
            position: "0",
            resolver: RESOLVER_STRING_REST,
            binds_as: "target",
        }],
    },
    PatternDecl {
        subject: PATTERN_GO,
        slots: &[SlotDecl {
            subject: "mash-library-mud-verbs:slot:go-direction",
            position: "0",
            resolver: RESOLVER_LITERAL_STRING,
            binds_as: "direction",
        }],
    },
    PatternDecl {
        subject: PATTERN_HELP,
        slots: &[SlotDecl {
            subject: "mash-library-mud-verbs:slot:help-topic",
            position: "0",
            resolver: RESOLVER_LITERAL_STRING,
            binds_as: "topic",
        }],
    },
    PatternDecl {
        subject: PATTERN_SAY,
        slots: &[SlotDecl {
            subject: "mash-library-mud-verbs:slot:say-body",
            position: "0",
            resolver: RESOLVER_STRING_REST,
            binds_as: "body",
        }],
    },
    PatternDecl {
        subject: PATTERN_REGISTER,
        slots: &[SlotDecl {
            subject: "mash-library-mud-verbs:slot:register-name",
            position: "0",
            resolver: RESOLVER_LITERAL_STRING,
            binds_as: "name",
        }],
    },
    PatternDecl {
        subject: PATTERN_LOGIN,
        slots: &[
            SlotDecl {
                subject: "mash-library-mud-verbs:slot:login-name",
                position: "0",
                resolver: RESOLVER_LITERAL_STRING,
                binds_as: "name",
            },
            SlotDecl {
                subject: "mash-library-mud-verbs:slot:login-password",
                position: "1",
                resolver: RESOLVER_LITERAL_STRING,
                binds_as: "password",
            },
        ],
    },
];

const ANONYMOUSE_COMMANDS: &[&str] = &[
    COMMAND_LOOK,
    COMMAND_GO,
    COMMAND_QUIT,
    COMMAND_HELP,
    COMMAND_WHO,
    COMMAND_REGISTER,
    COMMAND_LOGIN,
];

const REGISTERED_ONLY_COMMANDS: &[&str] = &[COMMAND_SAY];

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the MUD verb vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct MudVerbs;

#[async_trait]
impl Agent for MudVerbs {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    #[allow(clippy::too_many_lines)]
    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Resolvers.
        for r in [RESOLVER_STRING_REST, RESOLVER_LITERAL_STRING] {
            out.push(Claim::new(r, IS_A_TERM, RESOLVER));
        }

        // Capabilities.
        for cap in [
            CAP_PERCEIVE,
            CAP_MOVE,
            CAP_DEPART,
            CAP_READ_HELP,
            CAP_COMMUNE,
            CAP_VOICE,
            CAP_REGISTER_SELF,
            CAP_LOGIN_SELF,
        ] {
            out.push(Claim::new(cap, IS_A_TERM, CAPABILITY));
        }

        // Roles.
        out.push(Claim::new(ROLE_ANONYMOUSE, IS_A_TERM, ROLE));
        out.push(Claim::new(ROLE_REGISTERED, IS_A_TERM, ROLE));
        out.push(Claim::new(ROLE_REGISTERED, EXTENDS_ROLE, ROLE_ANONYMOUSE));

        // anonymouse grants (everything except voice).
        for cap in [
            CAP_PERCEIVE,
            CAP_MOVE,
            CAP_DEPART,
            CAP_READ_HELP,
            CAP_COMMUNE,
            CAP_REGISTER_SELF,
            CAP_LOGIN_SELF,
        ] {
            out.push(Claim::new(ROLE_ANONYMOUSE, GRANTS_CAPABILITY, cap));
        }
        // registered adds voice.
        out.push(Claim::new(ROLE_REGISTERED, GRANTS_CAPABILITY, CAP_VOICE));

        // Binding predicates.
        for p in HAS_BINDING_PREDICATES {
            out.push(Claim::new(*p, IS_A_PREDICATE, IDENTITY));
        }

        // Session states.
        for s in [STATE_ANONYMOUSE, STATE_AUTHENTICATED, STATE_DEPARTED] {
            out.push(Claim::new(s, IS_A_TERM, SESSION_STATE));
        }
        // Departed is the one-way trap — diagonal IS_RESTRICTIVE_STATE
        // marker tells the state-rule port to deny every command for
        // any session in this state.
        out.push(Claim::new(STATE_DEPARTED, IS_RESTRICTIVE_STATE, STATE_DEPARTED));

        // Commands.
        for c in COMMANDS {
            out.push(Claim::new(c.subject, IS_A_TERM, COMMAND));
            out.push(Claim::new(c.subject, HAS_VERB_NAME, c.verb_name));
            for alias in c.aliases {
                out.push(Claim::new(c.subject, HAS_ALIAS, *alias));
            }
            out.push(Claim::new(c.subject, HAS_COMMAND_DESCRIPTION, c.description));
            out.push(Claim::new(c.subject, HAS_USAGE, c.usage));
            if let Some(pattern) = c.pattern {
                out.push(Claim::new(c.subject, HAS_ARG_PATTERN, pattern));
            }
            if let Some(cap) = c.required_cap {
                out.push(Claim::new(c.subject, REQUIRES_CAPABILITY, cap));
            }
        }

        // Arg-patterns and slots.
        for p in PATTERNS {
            for slot in p.slots {
                out.push(Claim::new(p.subject, HAS_ARG_SLOT, slot.subject));
                out.push(Claim::new(slot.subject, IS_A_TERM, ARG_SLOT));
                out.push(Claim::new(slot.subject, AT_POSITION, slot.position));
                out.push(Claim::new(slot.subject, RESOLVES_VIA, slot.resolver));
                out.push(Claim::new(slot.subject, BINDS_AS, slot.binds_as));
            }
        }

        // provides-command wiring. role:registered inherits from
        // role:anonymouse via extends-role; capability-resolver walks
        // the chain, so we only declare new additions at each role.
        for cmd in ANONYMOUSE_COMMANDS {
            out.push(Claim::new(ROLE_ANONYMOUSE, PROVIDES_COMMAND, *cmd));
        }
        for cmd in REGISTERED_ONLY_COMMANDS {
            out.push(Claim::new(ROLE_REGISTERED, PROVIDES_COMMAND, *cmd));
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_command_has_a_verb_name() {
        let claims = MudVerbs.claims();
        for c in COMMANDS {
            assert!(
                claims
                    .iter()
                    .any(|cl| cl.subject == c.subject && cl.predicate == HAS_VERB_NAME),
                "missing verb-name for {}",
                c.subject
            );
        }
    }

    #[test]
    fn every_command_with_pattern_has_slots() {
        let claims = MudVerbs.claims();
        for c in COMMANDS {
            if let Some(pattern) = c.pattern {
                assert!(
                    claims
                        .iter()
                        .any(|cl| cl.subject == pattern && cl.predicate == HAS_ARG_SLOT),
                    "pattern {pattern} (for {}) has no slots",
                    c.subject
                );
            }
        }
    }

    #[test]
    fn registered_extends_anonymouse() {
        let claims = MudVerbs.claims();
        assert!(claims.iter().any(|c| c.subject == ROLE_REGISTERED
            && c.predicate == EXTENDS_ROLE
            && c.object == ROLE_ANONYMOUSE));
    }

    #[test]
    fn anonymouse_does_not_grant_voice() {
        let claims = MudVerbs.claims();
        assert!(
            !claims.iter().any(|c| c.subject == ROLE_ANONYMOUSE
                && c.predicate == GRANTS_CAPABILITY
                && c.object == CAP_VOICE),
            "anonymouse must not grant voice — say is gated on authentication"
        );
    }

    #[test]
    fn say_is_only_provided_by_registered() {
        let claims = MudVerbs.claims();
        let anon_provides_say = claims.iter().any(|c| {
            c.subject == ROLE_ANONYMOUSE
                && c.predicate == PROVIDES_COMMAND
                && c.object == COMMAND_SAY
        });
        let registered_provides_say = claims.iter().any(|c| {
            c.subject == ROLE_REGISTERED
                && c.predicate == PROVIDES_COMMAND
                && c.object == COMMAND_SAY
        });
        assert!(!anon_provides_say);
        assert!(registered_provides_say);
    }

    #[test]
    fn departed_is_restrictive() {
        let claims = MudVerbs.claims();
        assert!(claims.iter().any(|c| c.subject == STATE_DEPARTED
            && c.predicate == IS_RESTRICTIVE_STATE
            && c.object == STATE_DEPARTED));
    }

    #[test]
    fn every_declared_subject_is_namespaced() {
        let subjects: &[&str] = &[
            RESOLVER_STRING_REST,
            RESOLVER_LITERAL_STRING,
            CAP_PERCEIVE,
            CAP_MOVE,
            CAP_DEPART,
            CAP_READ_HELP,
            CAP_COMMUNE,
            CAP_VOICE,
            CAP_REGISTER_SELF,
            CAP_LOGIN_SELF,
            ROLE_ANONYMOUSE,
            ROLE_REGISTERED,
            STATE_ANONYMOUSE,
            STATE_AUTHENTICATED,
            STATE_DEPARTED,
            COMMAND_LOOK,
            COMMAND_GO,
            COMMAND_QUIT,
            COMMAND_HELP,
            COMMAND_WHO,
            COMMAND_SAY,
            COMMAND_REGISTER,
            COMMAND_LOGIN,
        ];
        for s in subjects {
            assert!(
                s.starts_with(IDENTITY),
                "subject {s} is not namespaced under {IDENTITY}"
            );
        }
    }
}
