//! TCP telnet conduit — byte translation logic.
//!
//! This module holds the **pure** logic a TCP conduit subprocess
//! needs: line tokenization, session-subject minting, claim-set
//! construction for session lifecycle events and verb emissions.
//! It has no I/O — all I/O (socket accept, per-connection task
//! spawning, hub handshake) belongs to a subprocess binary that
//! composes this module with tokio.
//!
//! # Why split this way
//!
//! The async I/O layer is hub-deployment work: it needs a running
//! hub on a known socket, port configuration, per-connection state
//! management, signal handling. None of that is useful to test
//! without a real deployment. The byte-level logic — parsing a
//! telnet line into verb + argument, generating the right claim set
//! on session connect — is testable in isolation and is where bugs
//! actually live.
//!
//! # Subprocess binary structure (reference)
//!
//! When the TCP subprocess is written, it follows this shape
//! (mirrors `mash-old-library/archive/mash-port-conduit-mud-telnet/`):
//!
//! ```ignore
//! #[tokio::main]
//! async fn main() -> Result<()> {
//!     let client = ClientConfig { socket_path, identity: "telnet-agent", ... };
//!     let mut connection = Connection::open(client).await?;
//!     let sessions: Arc<Mutex<HashMap<String, SessionHandle>>> = Arc::new(Mutex::new(HashMap::new()));
//!
//!     // Spawn TCP listener.
//!     let listener = TcpListener::bind(format!("0.0.0.0:{port}")).await?;
//!     let accept_task = spawn_accepting_connections(listener, sessions.clone(), connection.handle());
//!
//!     // Main loop: read hub events, route outgoing renders.
//!     while let Some(event) = connection.next_event().await {
//!         route_hub_event(event, &sessions).await;
//!     }
//! }
//! ```
//!
//! # Claim protocol
//!
//! - **On connect**: `mint_session_subject(peer, nanos)` produces a
//!   unique session subject. The conduit witnesses three claims:
//!   `(session, binding-kind, telnet)`,
//!   `(session, is-newly-connected, session)`,
//!   `(session, connected-at, <iso-timestamp>)`.
//!
//! - **On line**: [`tokenize`] splits into verb + optional arg.
//!   A request subject is minted; the conduit witnesses:
//!   `(request, issued-by-session, session)`,
//!   `(request, verb-is, <verb>)`,
//!   `(request, requested-arg, <arg>)` — last one only if arg present.
//!
//! - **On hub event** `(channel, is-surface-ready, marker)`: cached
//!   `(channel, has-body, <text>)` is written to the matching
//!   session's socket.
//!
//! - **On EOF**: `(session, ended-at, <iso-timestamp>)`.

use mash_engine::sdk::client::Claim;

use crate::conduit::{HAS_BODY, ISSUED_BY_SESSION, IS_SURFACE_READY, REQUESTED_ARG, HAS_VERB};
use crate::presence::{BINDING_KIND, ENDED_AT, IS_NEWLY_CONNECTED};

/// The telnet binding-kind value witnessed at
/// `(session, binding-kind, "telnet")`.
pub const BINDING_KIND_TELNET: &str = "telnet";

/// Default port the telnet subprocess should bind when no override is
/// provided via environment (e.g., `MASH_TELNET_PORT`).
pub const DEFAULT_PORT: u16 = 4000;

/// Parse a line of telnet input into verb + optional argument.
///
/// Rules:
/// - Leading and trailing ASCII whitespace stripped.
/// - First whitespace-delimited word is the verb (lowercased for
///   stability; verb vocabulary is uniformly lowercase across the
///   library).
/// - Remainder (after the verb's trailing whitespace) is the argument,
///   with its own trim.
/// - Empty input yields `None`.
///
/// # Examples
///
/// ```ignore
/// assert_eq!(tokenize("look"), Some(("look".into(), None)));
/// assert_eq!(tokenize("go north"), Some(("go".into(), Some("north".into()))));
/// assert_eq!(tokenize("  say  hello world  "), Some(("say".into(), Some("hello world".into()))));
/// assert_eq!(tokenize(""), None);
/// assert_eq!(tokenize("   "), None);
/// ```
#[must_use]
pub fn tokenize(line: &str) -> Option<(String, Option<String>)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let verb = parts.next()?.to_lowercase();
    let arg = parts.next().map(str::trim).filter(|s| !s.is_empty()).map(ToOwned::to_owned);
    Some((verb, arg))
}

/// Mint a deterministic-but-unique session subject from peer address
/// and nanosecond timestamp.
///
/// Format: `session:tcp:<peer>:<nanos>`. The peer plus nanos makes
/// collisions with reconnects from the same address vanishingly
/// unlikely without requiring coordination.
#[must_use]
pub fn mint_session_subject(peer: &str, nanos: u128) -> String {
    format!("session:tcp:{peer}:{nanos}")
}

/// Mint a fresh request subject for a session's line of input.
#[must_use]
pub fn mint_request_subject(session: &str, nanos: u128) -> String {
    format!("request:for-{session}:{nanos}")
}

/// Build the claim set for a newly-connected telnet session.
///
/// - `session`: the minted session subject.
/// - `connected_at`: ISO-8601 timestamp string.
#[must_use]
pub fn session_connect_claims(session: &str, connected_at: &str) -> Vec<Claim> {
    vec![
        Claim::new(session, BINDING_KIND, BINDING_KIND_TELNET),
        Claim::new(session, IS_NEWLY_CONNECTED, session),
        Claim::new(session, "connected-at", connected_at),
    ]
}

/// Build the claim set for a line of input, given the tokenized
/// (verb, optional arg) pair.
#[must_use]
pub fn line_claims(
    session: &str,
    request: &str,
    verb: &str,
    arg: Option<&str>,
) -> Vec<Claim> {
    let mut out = vec![
        Claim::new(request, ISSUED_BY_SESSION, session),
        Claim::new(request, HAS_VERB, verb),
    ];
    if let Some(a) = arg {
        out.push(Claim::new(request, REQUESTED_ARG, a));
    }
    out
}

/// Build the disconnect claim set.
#[must_use]
pub fn session_disconnect_claims(session: &str, ended_at: &str) -> Vec<Claim> {
    vec![Claim::new(session, ENDED_AT, ended_at)]
}

/// Predicates the telnet conduit subprocess should subscribe to on
/// handshake.
#[must_use]
pub fn subscriptions() -> Vec<String> {
    vec![
        IS_SURFACE_READY.to_owned(),
        HAS_BODY.to_owned(),
        ENDED_AT.to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_bare_verb() {
        assert_eq!(tokenize("look"), Some(("look".to_owned(), None)));
    }

    #[test]
    fn tokenize_verb_and_arg() {
        assert_eq!(
            tokenize("go north"),
            Some(("go".to_owned(), Some("north".to_owned())))
        );
    }

    #[test]
    fn tokenize_multi_word_arg() {
        assert_eq!(
            tokenize("say hello world"),
            Some(("say".to_owned(), Some("hello world".to_owned())))
        );
    }

    #[test]
    fn tokenize_trims_outer_and_inner_whitespace() {
        assert_eq!(
            tokenize("  say   hello world  "),
            Some(("say".to_owned(), Some("hello world".to_owned())))
        );
    }

    #[test]
    fn tokenize_empty_is_none() {
        assert_eq!(tokenize(""), None);
        assert_eq!(tokenize("   "), None);
        assert_eq!(tokenize("\t\n"), None);
    }

    #[test]
    fn tokenize_lowercases_verb() {
        assert_eq!(
            tokenize("LOOK"),
            Some(("look".to_owned(), None))
        );
        assert_eq!(
            tokenize("Go East"),
            Some(("go".to_owned(), Some("East".to_owned())))
        );
    }

    #[test]
    fn session_subject_format() {
        let s = mint_session_subject("127.0.0.1:50000", 1_700_000_000_000_000_000);
        assert_eq!(s, "session:tcp:127.0.0.1:50000:1700000000000000000");
    }

    #[test]
    fn connect_claims_have_binding_and_marker() {
        let session = mint_session_subject("host:port", 42);
        let claims = session_connect_claims(&session, "2026-04-21T00:00:00Z");
        assert_eq!(claims.len(), 3);
        assert!(claims.iter().any(|c| c.predicate == BINDING_KIND
            && c.object == BINDING_KIND_TELNET
            && c.subject == session));
        assert!(claims
            .iter()
            .any(|c| c.predicate == IS_NEWLY_CONNECTED && c.subject == session));
    }

    #[test]
    fn line_claims_without_arg() {
        let claims = line_claims("sess-1", "req-1", "look", None);
        assert_eq!(claims.len(), 2);
        assert!(claims.iter().any(|c| c.predicate == HAS_VERB && c.object == "look"));
        assert!(!claims.iter().any(|c| c.predicate == REQUESTED_ARG));
    }

    #[test]
    fn line_claims_with_arg() {
        let claims = line_claims("sess-1", "req-1", "go", Some("north"));
        assert_eq!(claims.len(), 3);
        assert!(claims.iter().any(|c| c.predicate == HAS_VERB && c.object == "go"));
        assert!(claims
            .iter()
            .any(|c| c.predicate == REQUESTED_ARG && c.object == "north"));
    }

    #[test]
    fn disconnect_claims_witness_ended_at() {
        let claims = session_disconnect_claims("sess-2", "2026-04-21T12:00:00Z");
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].predicate, ENDED_AT);
    }

    #[test]
    fn subscriptions_include_surface_and_ended() {
        let subs = subscriptions();
        assert!(subs.contains(&IS_SURFACE_READY.to_owned()));
        assert!(subs.contains(&HAS_BODY.to_owned()));
        assert!(subs.contains(&ENDED_AT.to_owned()));
    }
}
