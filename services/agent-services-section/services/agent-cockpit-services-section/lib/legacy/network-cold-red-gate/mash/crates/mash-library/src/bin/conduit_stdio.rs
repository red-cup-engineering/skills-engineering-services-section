//! Stdio conduit — connects stdin/stdout to the hub as one session.
//!
//! At boot the conduit mints a session subject and witnesses
//! `(session, is-newly-connected, session)` so welcome ports place
//! the avatar and set up identity state. Each stdin line becomes a
//! message subject with body + surface-ready-at-session; the parser
//! port tokenizes it into a request. Hub emissions at
//! `(msg, is-surface-ready, session)` for this session's own channel
//! are printed to stdout with the cached body.
//!
//! # Configuration
//!
//! - `MASH_SOCKET` — hub socket path. Default `.mash/sock`.
//! - `MASH_STDIO_SESSION_PREFIX` — prefix for the minted session
//!   subject. Default `session:stdio`. Full subject is
//!   `<prefix>:<pid>`.
//!
//! # Shutdown
//!
//! SIGINT or stdin EOF cleanly ends the session with
//! `(session, ended-at, <iso>)`, which the disposition port
//! observes.
//!
//! # Wiener/Barad framing
//!
//! The stdio conduit IS-a conduit port. It has-role `conduit`. Its
//! session is a thing with binding-kind `stdio`. The bytes are
//! transient; the settled claims at the session subject are the
//! substrate record of the interaction.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use anyhow::{Context, Result};
use mash_engine::algebra::Value;
use mash_engine::sdk::client::{ClientConfig, Connection, Handle, InboundEvent};
use tokio::io::{AsyncBufReadExt, BufReader};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use mash_library::conduit::{HAS_BODY, ISSUED_BY_SESSION, IS_SURFACE_READY, WAS_SAID_IN};
use mash_library::presence::{BINDING_KIND, ENDED_AT, IS_NEWLY_CONNECTED};

const DEFAULT_SESSION_PREFIX: &str = "session:stdio";
const BINDING_KIND_STDIO: &str = "stdio";

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let socket_path = std::env::var_os("MASH_SOCKET")
        .map_or_else(|| PathBuf::from(".mash/sock"), PathBuf::from);
    let session_prefix = std::env::var("MASH_STDIO_SESSION_PREFIX")
        .unwrap_or_else(|_| DEFAULT_SESSION_PREFIX.to_owned());
    let session = format!("{session_prefix}:{}", std::process::id());

    let client = ClientConfig {
        socket_path,
        identity: "mash-conduit-stdio".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        subscriptions: vec![
            IS_SURFACE_READY.to_owned(),
            HAS_BODY.to_owned(),
            ENDED_AT.to_owned(),
        ],
    };
    let mut connection = Connection::open(client)
        .await
        .context("open hub connection")?;
    let handle = connection.handle();

    info!(
        session = %session,
        hub_session = connection.session(),
        "mash-conduit-stdio ready"
    );

    // Mint the conduit's session: declare binding + fire welcome.
    let _ = handle.witness(&session, BINDING_KIND, BINDING_KIND_STDIO);
    let _ = handle.witness(&session, IS_NEWLY_CONNECTED, &session);

    // Pipe stdin to hub as messages.
    let stdin_handle = handle.clone();
    let stdin_session = session.clone();
    tokio::spawn(async move {
        stdin_reader(stdin_handle, stdin_session).await;
    });

    // Cache bodies; print when surface-ready settles at our session.
    let mut bodies: HashMap<String, String> = HashMap::new();
    let mut printed: HashSet<String> = HashSet::new();
    let inbound_session = session.clone();

    while let Some(event) = connection.next_event_or_shutdown().await {
        match event {
            InboundEvent::Settled { claim, .. } => {
                if claim.value != Value::True {
                    continue;
                }
                if claim.predicate == HAS_BODY {
                    bodies.insert(claim.subject, claim.object);
                } else if claim.predicate == IS_SURFACE_READY
                    && claim.object == inbound_session
                    && !printed.contains(&claim.subject)
                {
                    if let Some(body) = bodies.get(&claim.subject) {
                        println!("{body}");
                    }
                    printed.insert(claim.subject);
                } else if claim.predicate == ENDED_AT && claim.subject == inbound_session {
                    // Quit handler settled our own ended-at; break
                    // the outer loop.
                    break;
                }
            }
            InboundEvent::HubError { code, message } => {
                warn!(%code, %message, "hub error");
            }
            InboundEvent::Closed => break,
        }
    }

    // Graceful shutdown — witness ended-at if the quit path didn't
    // already do so.
    let now = iso_now();
    let _ = handle.witness(&session, ENDED_AT, &now);
    Ok(())
}

async fn stdin_reader(handle: Handle, session: String) {
    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    let mut counter: u64 = 1;
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                let body = line.trim_end();
                if body.is_empty() {
                    continue;
                }
                let msg = format!("msg:stdin:{}:{counter}", std::process::id());
                counter += 1;
                let _ = handle.witness(&msg, ISSUED_BY_SESSION, &session);
                let _ = handle.witness(&msg, HAS_BODY, body);
                let _ = handle.witness(&msg, WAS_SAID_IN, &session);
                let _ = handle.witness(&msg, IS_SURFACE_READY, &session);
            }
            Ok(None) => {
                // EOF: witness ended-at so the substrate knows the
                // session closed cleanly.
                let now = iso_now();
                let _ = handle.witness(&session, ENDED_AT, &now);
                break;
            }
            Err(e) => {
                warn!(error = %e, "stdin read error");
                break;
            }
        }
    }
}

fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Minimal formatter — avoid chrono dependency. Format: seconds
    // since epoch, ISO-ish. Real deployments may inject a full
    // ISO-8601 timestamp via a sidecar.
    format!("{secs}")
}
