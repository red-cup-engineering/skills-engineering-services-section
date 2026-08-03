//! Telnet conduit — multi-session TCP listener bridged to the hub.
//!
//! Per connection:
//!
//! 1. Mint a `session:tcp:<peer>:<ns>` subject; witness a
//!    connection event + IS_NEWLY_CONNECTED so welcome ports run.
//! 2. Read lines; emit each as a message with has-body +
//!    is-surface-ready at the session channel — the parser port
//!    tokenizes into a request.
//! 3. Subscribe to outbound surface-ready events at our sessions;
//!    write cached has-body payload to the socket. Filter self-
//!    speech by checking `was-said-by` cache.
//! 4. On EOF or hub-emitted ENDED_AT: witness final ended-at,
//!    remove from sessions map, drop close-signal to release the
//!    reader task.
//!
//! # Configuration
//!
//! - `MASH_SOCKET` — hub socket path. Default `.mash/sock`.
//! - `MASH_TELNET_PORT` — bind port. Default
//!   [`mash_library::conduit_telnet::DEFAULT_PORT`] (4000).
//!
//! # Wiener/Barad framing
//!
//! Each connection IS a session. The connection event
//! individuates — the substrate records precisely-when each
//! session connected, not a mutable "is-connected" flag. EOF is a
//! settled ended-at, not a connection-closed side effect; downstream
//! ports run uniformly whether quit or net-death triggered the
//! close.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use mash_engine::algebra::Value;
use mash_engine::sdk::client::{ClientConfig, Connection, Handle, InboundEvent};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, Mutex};
use tracing::{debug, info, warn};
use tracing_subscriber::EnvFilter;

use mash_library::conduit::{HAS_BODY, ISSUED_BY_SESSION, IS_SURFACE_READY, WAS_SAID_IN};
use mash_library::conduit_telnet::{
    mint_session_subject, session_connect_claims, session_disconnect_claims, DEFAULT_PORT,
};
use mash_library::foundation::IS_A_TERM;
use mash_library::presence::{
    ENDED_AT, EFFECTOR, EFFECTOR_KIND_HUMAN_TELNET, HAS_BINDING, HAS_EFFECTOR_KIND, SESSION,
};

/// Per-live-session state owned by the conduit.
///
/// Removing the entry drops both senders simultaneously: the writer
/// channel closes (write-task drains + shuts down write half), and
/// the oneshot close channel drops (reader-task's select! wakes,
/// breaks, drops read half). That double-drop is what makes the TCP
/// stack fully close the connection.
struct SessionHandle {
    writer_tx: mpsc::UnboundedSender<String>,
    #[allow(dead_code)]
    close_tx: oneshot::Sender<()>,
}

type Sessions = Arc<Mutex<HashMap<String, SessionHandle>>>;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let socket_path = std::env::var_os("MASH_SOCKET")
        .map_or_else(|| PathBuf::from(".mash/sock"), PathBuf::from);
    let port: u16 = std::env::var("MASH_TELNET_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_PORT);

    let client = ClientConfig {
        socket_path,
        identity: "mash-conduit-telnet".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        subscriptions: vec![
            IS_SURFACE_READY.to_owned(),
            HAS_BODY.to_owned(),
            ISSUED_BY_SESSION.to_owned(),
            ENDED_AT.to_owned(),
        ],
    };
    let mut connection = Connection::open(client)
        .await
        .context("open hub connection")?;
    let handle = connection.handle();
    info!(
        hub_session = connection.session(),
        %port,
        "mash-conduit-telnet connected"
    );

    let sessions: Sessions = Arc::new(Mutex::new(HashMap::new()));
    // msg → body cache; surface-ready lookups hit here.
    let bodies: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
    // msg → speaker (via ISSUED_BY_SESSION for request-subjects); used
    // to filter player-input echo.
    let speakers: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));

    let bind_addr: SocketAddr = format!("0.0.0.0:{port}").parse().expect("valid addr");
    let listener = TcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("bind {bind_addr}"))?;
    info!(%bind_addr, "telnet listener ready");
    tokio::spawn(accept_loop(listener, handle.clone(), sessions.clone()));

    while let Some(event) = connection.next_event_or_shutdown().await {
        match event {
            InboundEvent::Settled { claim, .. } => {
                if claim.value != Value::True {
                    continue;
                }
                if claim.predicate == HAS_BODY {
                    bodies
                        .lock()
                        .await
                        .insert(claim.subject, claim.object);
                } else if claim.predicate == ISSUED_BY_SESSION {
                    speakers
                        .lock()
                        .await
                        .insert(claim.subject, claim.object);
                } else if claim.predicate == IS_SURFACE_READY {
                    let channel = &claim.object;
                    let Some(body) = bodies.lock().await.get(&claim.subject).cloned() else {
                        debug!(subject = %claim.subject, "surface-ready without cached body");
                        continue;
                    };
                    // Self-speech filter: if the subject was issued-by
                    // this session, it's player input coming through —
                    // don't echo.
                    let issued_by = speakers.lock().await.get(&claim.subject).cloned();
                    if issued_by.as_deref() == Some(channel.as_str()) {
                        continue;
                    }
                    let map = sessions.lock().await;
                    if let Some(session) = map.get(channel) {
                        if session.writer_tx.send(body).is_err() {
                            debug!(session = %channel, "writer dropped");
                        }
                    }
                } else if claim.predicate == ENDED_AT {
                    let session_id = &claim.subject;
                    if sessions.lock().await.remove(session_id).is_some() {
                        info!(%session_id, "server-initiated disconnect on ended-at");
                    }
                }
            }
            InboundEvent::HubError { code, message } => {
                warn!(%code, %message, "hub reported error");
            }
            InboundEvent::Closed => break,
        }
    }
    Ok(())
}

async fn accept_loop(listener: TcpListener, handle: Handle, sessions: Sessions) {
    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let handle = handle.clone();
                let sessions = sessions.clone();
                tokio::spawn(async move {
                    if let Err(e) = serve(stream, peer, handle, sessions).await {
                        warn!(%peer, error = %e, "connection serve errored");
                    }
                });
            }
            Err(e) => {
                warn!(error = %e, "accept errored; continuing");
            }
        }
    }
}

async fn serve(
    stream: TcpStream,
    peer: SocketAddr,
    handle: Handle,
    sessions: Sessions,
) -> Result<()> {
    let nanos = now_nanos();
    let session_id = mint_session_subject(&peer.to_string(), nanos);
    let (reader_half, mut writer_half) = stream.into_split();
    let (writer_tx, mut writer_rx) = mpsc::unbounded_channel::<String>();
    let (close_tx, mut close_rx) = oneshot::channel::<()>();

    sessions.lock().await.insert(
        session_id.clone(),
        SessionHandle { writer_tx, close_tx },
    );

    // Witness the session + connect claims (binding kind, newly-
    // connected marker, connected-at).
    let _ = handle.witness(&session_id, IS_A_TERM, SESSION);
    let _ = handle.witness(&session_id, "peer-address", &peer.to_string());
    let connect_ts = iso_now();
    for c in session_connect_claims(&session_id, &connect_ts) {
        let _ = handle.witness(&c.subject, &c.predicate, &c.object);
    }

    // Bind an effector subject for this connection.
    let effector_id = format!("effector:telnet:{peer}:{nanos}");
    let _ = handle.witness(&effector_id, IS_A_TERM, EFFECTOR);
    let _ = handle.witness(&effector_id, HAS_EFFECTOR_KIND, EFFECTOR_KIND_HUMAN_TELNET);
    let _ = handle.witness(&session_id, HAS_BINDING, &effector_id);

    let write_task = tokio::spawn(async move {
        while let Some(line) = writer_rx.recv().await {
            if writer_half.write_all(line.as_bytes()).await.is_err() {
                break;
            }
            if !line.ends_with('\n') && writer_half.write_all(b"\n").await.is_err() {
                break;
            }
        }
        let _ = writer_half.shutdown().await;
    });

    let mut lines = BufReader::new(reader_half).lines();
    let mut counter: u64 = 1;
    loop {
        tokio::select! {
            _ = &mut close_rx => break,
            next = lines.next_line() => match next {
                Ok(Some(line)) => {
                    let body = line.trim();
                    if body.is_empty() {
                        continue;
                    }
                    let msg = format!("msg:tcp:{session_id}:{counter}");
                    counter += 1;
                    let _ = handle.witness(&msg, ISSUED_BY_SESSION, &session_id);
                    let _ = handle.witness(&msg, WAS_SAID_IN, &session_id);
                    let _ = handle.witness(&msg, HAS_BODY, body);
                    let _ = handle.witness(&msg, IS_SURFACE_READY, &session_id);
                }
                Ok(None) | Err(_) => break,
            }
        }
    }

    // EOF or server-close. Idempotently remove from the map, emit
    // final ended-at, flush the write task.
    sessions.lock().await.remove(&session_id);
    let ended = iso_now();
    for c in session_disconnect_claims(&session_id, &ended) {
        let _ = handle.witness(&c.subject, &c.predicate, &c.object);
    }
    let _ = write_task.await;
    info!(%peer, %session_id, "session closed");
    Ok(())
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn iso_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
