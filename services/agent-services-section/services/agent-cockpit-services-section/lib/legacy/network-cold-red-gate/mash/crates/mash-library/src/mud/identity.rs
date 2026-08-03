//! MUD identity — register and login handlers.
//!
//! # What these ports do
//!
//! **Register**: mints an account, binds a display name to the
//! session's character, and transitions the session to
//! authenticated. Returns a password string the user is told to
//! record.
//!
//! **Login**: matches a submitted name+password against the account
//! fiber, and on success transitions the session to authenticated.
//!
//! # Password hashing is pluggable
//!
//! `mash-library` stays dependency-light — no `sha2` or `argon2` in
//! the library. Both ports take a hash closure at construction:
//!
//! - [`RegisterPort::with_hasher`] and [`LoginPort::with_hasher`]
//!   accept `fn(&str) -> String` for digesting passwords.
//! - [`RegisterPort::with_generator`] accepts `fn() -> String` for
//!   generating new passwords.
//!
//! Default implementations use a simple non-cryptographic hash
//! suitable for substrate shape testing. Production deployments
//! MUST inject a cryptographic hasher (e.g. argon2, sha256 via
//! sha2) — the built-in default is not secure.

use std::collections::{HashMap, HashSet};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;

use crate::capability::HAS_ROLE;
use crate::command::INVOKES_COMMAND;
use crate::conduit::{HAS_BODY, ISSUED_BY_SESSION, IS_SURFACE_READY, WAS_SAID_IN};
use crate::foundation::IS_A_TERM;
use crate::mud::session::{
    AUTHENTICATED_AS, AUTH_ACCOUNT, CHARACTERIZED_BY, HAS_ACCOUNT_NAME, HAS_PASSWORD_HASH,
    HAS_SESSION_STATE, PUPPETS,
};
use crate::mud::verbs::{
    COMMAND_LOGIN, COMMAND_REGISTER, HAS_BINDING_NAME, HAS_BINDING_PASSWORD, ROLE_REGISTERED,
    STATE_AUTHENTICATED,
};

// ─────────────────────────────────────────────────────────────────────
// Default hasher / password generator (NOT cryptographic)
// ─────────────────────────────────────────────────────────────────────

/// Non-cryptographic FNV-1a-style hash. Good enough for shape tests.
/// **Not suitable for production** — inject a real hasher via
/// [`RegisterPort::with_hasher`] / [`LoginPort::with_hasher`].
#[must_use]
pub fn default_hasher(s: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Default password generator (8 hex digits of a fixed seed). Produces
/// the same password every call; **tests only**. Production callers
/// should inject [`RegisterPort::with_generator`].
fn default_password_generator() -> String {
    "test-passw".to_owned()
}

// ─────────────────────────────────────────────────────────────────────
// Shared say-composition
// ─────────────────────────────────────────────────────────────────────

fn compose_say(agent: &str, session: &str, body: &str, id: u64) -> Vec<Claim> {
    let msg = format!("msg:{agent}:{id}");
    vec![
        Claim::new(&msg, WAS_SAID_IN, session),
        Claim::new(&msg, HAS_BODY, body),
        Claim::new(&msg, IS_SURFACE_READY, session),
    ]
}

// ─────────────────────────────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────────────────────────────

/// Handler for [`COMMAND_REGISTER`]. On trigger: checks the name
/// isn't taken, mints an account, binds it to the session's
/// character, transitions to [`STATE_AUTHENTICATED`], and replies
/// with the generated password.
pub struct RegisterPort {
    request_session: HashMap<String, String>,
    request_name: HashMap<String, String>,
    invoked: HashSet<String>,
    fired: HashSet<String>,
    puppeted: HashMap<String, String>,
    taken_names: HashSet<String>,
    next_id: u64,
    hasher: fn(&str) -> String,
    generator: fn() -> String,
    mint_account: fn(u64) -> String,
}

impl Default for RegisterPort {
    fn default() -> Self {
        Self::new()
    }
}

fn default_mint_account(id: u64) -> String {
    format!("account:{id}")
}

impl RegisterPort {
    /// Fresh state with default hasher + generator.
    #[must_use]
    pub fn new() -> Self {
        Self {
            request_session: HashMap::new(),
            request_name: HashMap::new(),
            invoked: HashSet::new(),
            fired: HashSet::new(),
            puppeted: HashMap::new(),
            taken_names: HashSet::new(),
            next_id: 1,
            hasher: default_hasher,
            generator: default_password_generator,
            mint_account: default_mint_account,
        }
    }

    /// Inject a custom password hasher.
    #[must_use]
    pub fn with_hasher(mut self, hasher: fn(&str) -> String) -> Self {
        self.hasher = hasher;
        self
    }

    /// Inject a custom password generator.
    #[must_use]
    pub fn with_generator(mut self, generator: fn() -> String) -> Self {
        self.generator = generator;
        self
    }

    /// Inject a custom account-minting function.
    #[must_use]
    pub fn with_account_mint(mut self, mint: fn(u64) -> String) -> Self {
        self.mint_account = mint;
        self
    }

    fn try_fire(&mut self, request: &str) -> Vec<Claim> {
        if self.fired.contains(request) {
            return Vec::new();
        }
        if !self.invoked.contains(request) {
            return Vec::new();
        }
        let Some(session) = self.request_session.get(request).cloned() else {
            return Vec::new();
        };
        let Some(name) = self.request_name.get(request).cloned() else {
            return Vec::new();
        };
        self.fired.insert(request.to_owned());
        let id = self.next_id;
        self.next_id += 1;

        let trimmed = name.trim().to_owned();
        if trimmed.is_empty() {
            return compose_say("register", &session, "A name is required.", id);
        }
        if self.taken_names.contains(&trimmed) {
            return compose_say(
                "register",
                &session,
                &format!("The name \"{trimmed}\" is already in use."),
                id,
            );
        }
        let Some(character) = self.puppeted.get(&session).cloned() else {
            return compose_say("register", &session, "You have no body to register.", id);
        };

        let password = (self.generator)();
        let hash = (self.hasher)(&password);
        let account = (self.mint_account)(id);

        let mut out = vec![
            Claim::new(&account, IS_A_TERM, AUTH_ACCOUNT),
            Claim::new(&account, HAS_ACCOUNT_NAME, &trimmed),
            Claim::new(&account, HAS_PASSWORD_HASH, &hash),
            Claim::new(&account, CHARACTERIZED_BY, &character),
            Claim::new(&character, "has-name", &trimmed),
            Claim::new(&session, AUTHENTICATED_AS, &account),
            Claim::new(&session, HAS_ROLE, ROLE_REGISTERED),
            Claim::new(&session, HAS_SESSION_STATE, STATE_AUTHENTICATED),
        ];
        out.extend(compose_say(
            "register",
            &session,
            &format!(
                "Welcome, {trimmed}. Your password is {password} — write it down; it will not be shown again."
            ),
            id,
        ));
        self.taken_names.insert(trimmed);
        out
    }
}

impl Projection for RegisterPort {
    fn identity(&self) -> &str {
        "mash-library-register-handler"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            ISSUED_BY_SESSION.to_owned(),
            INVOKES_COMMAND.to_owned(),
            HAS_BINDING_NAME.to_owned(),
            PUPPETS.to_owned(),
            HAS_ACCOUNT_NAME.to_owned(),
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
        if predicate == ISSUED_BY_SESSION {
            self.request_session
                .insert(subject.to_owned(), object.to_owned());
            self.try_fire(subject)
        } else if predicate == HAS_BINDING_NAME {
            self.request_name
                .insert(subject.to_owned(), object.to_owned());
            self.try_fire(subject)
        } else if predicate == INVOKES_COMMAND && object == COMMAND_REGISTER {
            self.invoked.insert(subject.to_owned());
            self.try_fire(subject)
        } else if predicate == PUPPETS {
            self.puppeted.insert(subject.to_owned(), object.to_owned());
            Vec::new()
        } else if predicate == HAS_ACCOUNT_NAME {
            self.taken_names.insert(object.to_owned());
            Vec::new()
        } else {
            Vec::new()
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────

/// Handler for [`COMMAND_LOGIN`]. On trigger: verifies submitted
/// name + password match an account fiber, and on success
/// transitions the session to authenticated.
pub struct LoginPort {
    request_session: HashMap<String, String>,
    request_name: HashMap<String, String>,
    request_password: HashMap<String, String>,
    invoked: HashSet<String>,
    fired: HashSet<String>,
    account_by_name: HashMap<String, String>,
    password_hash_for_account: HashMap<String, String>,
    next_id: u64,
    hasher: fn(&str) -> String,
}

impl Default for LoginPort {
    fn default() -> Self {
        Self::new()
    }
}

impl LoginPort {
    /// Fresh state with default hasher.
    #[must_use]
    pub fn new() -> Self {
        Self {
            request_session: HashMap::new(),
            request_name: HashMap::new(),
            request_password: HashMap::new(),
            invoked: HashSet::new(),
            fired: HashSet::new(),
            account_by_name: HashMap::new(),
            password_hash_for_account: HashMap::new(),
            next_id: 1,
            hasher: default_hasher,
        }
    }

    /// Inject a custom password hasher.
    #[must_use]
    pub fn with_hasher(mut self, hasher: fn(&str) -> String) -> Self {
        self.hasher = hasher;
        self
    }

    fn try_fire(&mut self, request: &str) -> Vec<Claim> {
        if self.fired.contains(request) {
            return Vec::new();
        }
        if !self.invoked.contains(request) {
            return Vec::new();
        }
        let Some(session) = self.request_session.get(request).cloned() else {
            return Vec::new();
        };
        let Some(name) = self.request_name.get(request).cloned() else {
            return Vec::new();
        };
        let Some(password) = self.request_password.get(request).cloned() else {
            return Vec::new();
        };
        self.fired.insert(request.to_owned());
        let id = self.next_id;
        self.next_id += 1;

        let trimmed = name.trim();
        let Some(account) = self.account_by_name.get(trimmed).cloned() else {
            return compose_say("login", &session, "Unknown account.", id);
        };
        let Some(stored) = self.password_hash_for_account.get(&account).cloned() else {
            return compose_say("login", &session, "Account has no password set.", id);
        };
        let submitted = (self.hasher)(&password);
        if submitted != stored {
            return compose_say("login", &session, "Incorrect password.", id);
        }

        let mut out = vec![
            Claim::new(&session, AUTHENTICATED_AS, &account),
            Claim::new(&session, HAS_ROLE, ROLE_REGISTERED),
            Claim::new(&session, HAS_SESSION_STATE, STATE_AUTHENTICATED),
        ];
        out.extend(compose_say(
            "login",
            &session,
            &format!("Welcome back, {trimmed}."),
            id,
        ));
        out
    }
}

impl Projection for LoginPort {
    fn identity(&self) -> &str {
        "mash-library-login-handler"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            ISSUED_BY_SESSION.to_owned(),
            INVOKES_COMMAND.to_owned(),
            HAS_BINDING_NAME.to_owned(),
            HAS_BINDING_PASSWORD.to_owned(),
            HAS_ACCOUNT_NAME.to_owned(),
            HAS_PASSWORD_HASH.to_owned(),
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
        if predicate == ISSUED_BY_SESSION {
            self.request_session
                .insert(subject.to_owned(), object.to_owned());
            self.try_fire(subject)
        } else if predicate == HAS_BINDING_NAME {
            self.request_name
                .insert(subject.to_owned(), object.to_owned());
            self.try_fire(subject)
        } else if predicate == HAS_BINDING_PASSWORD {
            self.request_password
                .insert(subject.to_owned(), object.to_owned());
            self.try_fire(subject)
        } else if predicate == INVOKES_COMMAND && object == COMMAND_LOGIN {
            self.invoked.insert(subject.to_owned());
            self.try_fire(subject)
        } else if predicate == HAS_ACCOUNT_NAME {
            // (account, has-account-name, name) — index for lookup.
            self.account_by_name
                .insert(object.to_owned(), subject.to_owned());
            Vec::new()
        } else if predicate == HAS_PASSWORD_HASH {
            self.password_hash_for_account
                .insert(subject.to_owned(), object.to_owned());
            Vec::new()
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_password() -> String {
        "pw-0001".to_owned()
    }

    fn register_fires(port: &mut RegisterPort, request: &str, session: &str, name: &str) -> Vec<Claim> {
        let mut out = Vec::new();
        out.extend(port.ingest(request, ISSUED_BY_SESSION, session, Value::True));
        out.extend(port.ingest(request, HAS_BINDING_NAME, name, Value::True));
        out.extend(port.ingest(request, INVOKES_COMMAND, COMMAND_REGISTER, Value::True));
        out
    }

    #[test]
    fn register_mints_account_with_hashed_password() {
        let mut port = RegisterPort::new().with_generator(fixed_password);
        let _ = port.ingest("session:1", PUPPETS, "char:1", Value::True);
        let out = register_fires(&mut port, "req-1", "session:1", "alice");
        let expected_hash = default_hasher("pw-0001");
        assert!(out.iter().any(|c| c.predicate == HAS_ACCOUNT_NAME && c.object == "alice"));
        assert!(out.iter().any(|c| c.predicate == HAS_PASSWORD_HASH && c.object == expected_hash));
        assert!(out.iter().any(|c| c.predicate == AUTHENTICATED_AS));
        assert!(out.iter().any(|c| c.predicate == HAS_ROLE && c.object == ROLE_REGISTERED));
        assert!(out.iter().any(|c| c.predicate == HAS_SESSION_STATE
            && c.object == STATE_AUTHENTICATED));
        // Character gets the name.
        assert!(out.iter().any(|c| c.subject == "char:1" && c.predicate == "has-name"));
        // Password in message.
        assert!(out.iter().any(|c| c.predicate == HAS_BODY && c.object.contains("pw-0001")));
    }

    #[test]
    fn register_rejects_taken_name() {
        let mut port = RegisterPort::new().with_generator(fixed_password);
        // Pre-seed a taken name.
        let _ = port.ingest("account:existing", HAS_ACCOUNT_NAME, "alice", Value::True);
        let _ = port.ingest("session:1", PUPPETS, "char:1", Value::True);
        let out = register_fires(&mut port, "req-1", "session:1", "alice");
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object.contains("already in use")));
        assert!(!out.iter().any(|c| c.predicate == HAS_PASSWORD_HASH));
    }

    #[test]
    fn register_without_character_emits_error() {
        let mut port = RegisterPort::new().with_generator(fixed_password);
        // No PUPPETS witness — session has no character.
        let out = register_fires(&mut port, "req-1", "session:1", "alice");
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object.contains("no body")));
    }

    #[test]
    fn register_rejects_empty_name() {
        let mut port = RegisterPort::new().with_generator(fixed_password);
        let _ = port.ingest("session:1", PUPPETS, "char:1", Value::True);
        let out = register_fires(&mut port, "req-1", "session:1", "   ");
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object.contains("name is required")));
    }

    #[test]
    fn register_fires_exactly_once_per_request() {
        let mut port = RegisterPort::new().with_generator(fixed_password);
        let _ = port.ingest("session:1", PUPPETS, "char:1", Value::True);
        let _ = register_fires(&mut port, "req-1", "session:1", "alice");
        let again = port.ingest("req-1", INVOKES_COMMAND, COMMAND_REGISTER, Value::True);
        assert!(again.is_empty());
    }

    #[test]
    fn login_accepts_correct_password() {
        let mut port = LoginPort::new();
        // Pre-seed an account.
        let hash = default_hasher("pw-0001");
        let _ = port.ingest("account:a", HAS_ACCOUNT_NAME, "alice", Value::True);
        let _ = port.ingest("account:a", HAS_PASSWORD_HASH, &hash, Value::True);
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let _ = port.ingest("req-1", HAS_BINDING_NAME, "alice", Value::True);
        let _ = port.ingest("req-1", HAS_BINDING_PASSWORD, "pw-0001", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_LOGIN, Value::True);
        assert!(out.iter().any(|c| c.predicate == AUTHENTICATED_AS && c.object == "account:a"));
        assert!(out.iter().any(|c| c.predicate == HAS_SESSION_STATE
            && c.object == STATE_AUTHENTICATED));
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object.contains("Welcome back")));
    }

    #[test]
    fn login_rejects_wrong_password() {
        let mut port = LoginPort::new();
        let _ = port.ingest("account:a", HAS_ACCOUNT_NAME, "alice", Value::True);
        let _ = port.ingest("account:a", HAS_PASSWORD_HASH, &default_hasher("right"), Value::True);
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let _ = port.ingest("req-1", HAS_BINDING_NAME, "alice", Value::True);
        let _ = port.ingest("req-1", HAS_BINDING_PASSWORD, "wrong", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_LOGIN, Value::True);
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object == "Incorrect password."));
        assert!(!out.iter().any(|c| c.predicate == AUTHENTICATED_AS));
    }

    #[test]
    fn login_unknown_account_rejected() {
        let mut port = LoginPort::new();
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let _ = port.ingest("req-1", HAS_BINDING_NAME, "ghost", Value::True);
        let _ = port.ingest("req-1", HAS_BINDING_PASSWORD, "any", Value::True);
        let out = port.ingest("req-1", INVOKES_COMMAND, COMMAND_LOGIN, Value::True);
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object == "Unknown account."));
    }
}
