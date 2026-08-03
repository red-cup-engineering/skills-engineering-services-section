//! Client-side wire for MASH.
//!
//! Agents use this crate to talk to a hub over its Unix-domain
//! socket. The lifecycle is:
//!
//! 1. Build a [`ClientConfig`] naming the socket path, the agent's
//!    identity, and the predicates to subscribe to on handshake.
//! 2. Call [`Connection::open`] — this performs the `Hello`/`Welcome`
//!    handshake and spawns the read/write tasks behind the
//!    connection.
//! 3. Poll [`Connection::next_event`] for inbound [`InboundEvent`]s;
//!    witness outbound [`Claim`]s through a [`Handle`] (or a
//!    restricted [`Witness`] handed to spawned tasks).
//! 4. Drop the connection to close cleanly.
//!
//! # Wire semantics
//!
//! Witnessing a claim is **state mutation of the hub's shared
//! reality, not an RPC**. [`Handle::witness`] returns the moment the
//! message is queued on the outbound channel; the hub will cascade
//! it, settle it, and broadcast any resulting events to subscribers.
//! An agent that wants to see the consequences of its own witnessing
//! subscribes to the affected predicate like any other subscriber.
//!
//! # Relationship to other crates
//!
//! - `mash-sdk-agent` wraps this crate in the `Agent` trait, which
//!   is almost always the surface you want.
//! - [`crate::inference::wire`] defines the JSON-on-the-wire
//!   [`Message`] enum that this client speaks.
//! - `mash-hub` is the server side; the two crates share the wire
//!   types in full.

#![warn(missing_docs)]

use crate::inference::wire::{DerivationRecord, Message, WireClaim};
use std::path::PathBuf;
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;
use tokio::sync::mpsc;
use tracing::{debug, warn};

/// Errors returned by client-side operations.
#[derive(Debug, Error)]
pub enum ClientError {
    /// Underlying I/O failure.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// JSON encoding or decoding failure.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// The hub responded to the handshake with something other than
    /// [`Message::Welcome`].
    #[error("handshake: {0}")]
    Handshake(String),
    /// The outbound channel has been closed (hub disconnected).
    #[error("disconnected")]
    Disconnected,
}

/// Configuration for connecting as a participant to the hub.
#[derive(Debug, Clone)]
pub struct ClientConfig {
    /// Path of the hub's Unix-domain socket.
    pub socket_path: PathBuf,
    /// Agent identity (matches `Agent::identity`).
    pub identity: String,
    /// Agent semver.
    pub version: String,
    /// Predicate names to subscribe to on Hello.
    pub subscriptions: Vec<String>,
}

/// An open connection to the hub. Owns the read side of the socket
/// via a spawned task; the write side is drained by another task
/// driven by [`Handle`].
#[derive(Debug)]
pub struct Connection {
    outbound: mpsc::UnboundedSender<Message>,
    inbound: mpsc::UnboundedReceiver<InboundEvent>,
    session: String,
}

/// An event arriving from the hub.
#[derive(Debug, Clone)]
pub enum InboundEvent {
    /// A claim settled on a subscribed predicate.
    Settled {
        /// The settled claim.
        claim: WireClaim,
        /// Morphism steps that produced it.
        derivation: Vec<DerivationRecord>,
    },
    /// The hub reported an error.
    HubError {
        /// Machine-readable code.
        code: String,
        /// Human-readable detail.
        message: String,
    },
    /// The connection closed.
    Closed,
}

impl Connection {
    /// Connect to the hub and perform the `Hello`/`Welcome`
    /// handshake. On success the connection is ready for traffic and
    /// already subscribed to every predicate named in
    /// `config.subscriptions`.
    ///
    /// Spawns two background tasks — one reads the socket, one
    /// writes — so subsequent [`witness`](Handle::witness) calls are
    /// non-blocking.
    ///
    /// # Errors
    ///
    /// - [`ClientError::Io`] — the socket path does not exist, the
    ///   hub is not running, or the OS refused the connect.
    /// - [`ClientError::Json`] — the `Welcome` reply failed to
    ///   decode (usually means the hub sent a version the client
    ///   doesn't understand).
    /// - [`ClientError::Handshake`] — the hub accepted the TCP
    ///   connection but refused the `Hello` (e.g. it responded with
    ///   an [`Message::Error`] instead of a [`Message::Welcome`]).
    pub async fn open(config: ClientConfig) -> Result<Self, ClientError> {
        let stream = UnixStream::connect(&config.socket_path).await?;
        let (reader, mut writer) = stream.into_split();

        let hello = Message::Hello {
            agent: config.identity,
            version: config.version,
            subscriptions: config.subscriptions,
        };
        write_line(&mut writer, &hello).await?;

        let mut reader = BufReader::new(reader);
        let session = read_welcome(&mut reader).await?;

        let (out_tx, out_rx) = mpsc::unbounded_channel::<Message>();
        let (in_tx, in_rx) = mpsc::unbounded_channel::<InboundEvent>();
        tokio::spawn(write_loop(writer, out_rx));
        tokio::spawn(read_loop(reader, in_tx));

        Ok(Self {
            outbound: out_tx,
            inbound: in_rx,
            session,
        })
    }

    /// The session subject the hub minted for this connection (the
    /// `session` field of the `Welcome` reply, typically
    /// `"s{id}"`).
    ///
    /// Use this when the agent needs to reference its own session in
    /// a claim (e.g. `(session, ended-at, <ts>)`), or to correlate
    /// the per-connection fiber cells the hub materializes during
    /// handshake (`projects-through`, `has-version`).
    #[must_use]
    pub fn session(&self) -> &str {
        &self.session
    }

    /// Produce a cheap-clone send handle suitable for passing into
    /// spawned tasks. Multiple handles can coexist; all writes share
    /// the connection's single outbound channel.
    #[must_use]
    pub fn handle(&self) -> Handle {
        Handle {
            outbound: self.outbound.clone(),
        }
    }

    /// Await the next inbound event from the hub.
    ///
    /// Returns [`Some`] for every `Event` or `Error` the hub sends
    /// this session; returns [`None`] exactly once, when the
    /// background reader exits — on EOF, a decode failure, or a
    /// graceful shutdown from either side. After a `None` the
    /// connection is dead; rebuild it via [`Connection::open`] if
    /// you need to keep going.
    pub async fn next_event(&mut self) -> Option<InboundEvent> {
        self.inbound.recv().await
    }

    /// Like [`Self::next_event`], but also returns [`None`] if the
    /// process receives SIGTERM or SIGINT. Ports that want graceful
    /// shutdown on process signals use this in place of
    /// [`Self::next_event`]; the `while let Some(event) = ...` loop
    /// exits once the signal fires, which lets the port witness
    /// `is-stopped` and exit cleanly instead of being force-killed.
    pub async fn next_event_or_shutdown(&mut self) -> Option<InboundEvent> {
        tokio::select! {
            event = self.next_event() => event,
            () = shutdown_signal() => None,
        }
    }
}

impl Handle {
    /// Build a `Handle` from an outbound channel. Used by the hub's
    /// embedded driver; subprocess agents use [`Connection::handle`].
    #[must_use]
    pub fn from_outbound(outbound: mpsc::UnboundedSender<Message>) -> Self {
        Self { outbound }
    }
}

/// SPO triple an agent is asserting. The cascade-fold assigns the
/// bilattice value.
#[derive(Debug, Clone)]
pub struct Claim {
    /// Subject term.
    pub subject: String,
    /// Predicate name.
    pub predicate: String,
    /// Object term.
    pub object: String,
}

impl Claim {
    /// Build a claim from three string-like values. No validation is
    /// performed — the substrate interns the strings on arrival, so
    /// any non-empty string is a valid term.
    ///
    /// The constructor takes `impl Into<String>` so callers can pass
    /// `&'static str`, `&String`, or owned `String` without friction.
    pub fn new(
        subject: impl Into<String>,
        predicate: impl Into<String>,
        object: impl Into<String>,
    ) -> Self {
        Self {
            subject: subject.into(),
            predicate: predicate.into(),
            object: object.into(),
        }
    }
}

/// A capability-restricted [`Handle`] that can only witness claims.
///
/// Agents whose `translate()` spawns a task holding the witness —
/// the typical port pattern — receive this instead of a full
/// `Handle` so the spawned task cannot accidentally subscribe or
/// query the log. Cheap-clone; each spawned task can hold its own.
///
/// Constructed via `From<Handle>` and passed into the
/// `crate::sdk::agent::Agent::translate` hook's `witness` argument.
#[derive(Debug, Clone)]
pub struct Witness {
    inner: Handle,
}

impl Witness {
    /// Witness a claim into the hub's shared reality. Equivalent to
    /// [`Handle::witness`] but takes a prebuilt [`Claim`] instead of
    /// three string arguments — the shape spawned tasks usually
    /// already have.
    ///
    /// # Errors
    ///
    /// [`ClientError::Disconnected`] if the underlying connection
    /// has closed. Treat the witness as dead from that point.
    pub fn witness(&self, claim: Claim) -> Result<(), ClientError> {
        self.inner.witness(claim.subject, claim.predicate, claim.object)
    }

    /// Witness a claim into the substrate AND echo to the tracing
    /// subscriber at the chosen level. See [`Handle::witness_and_log`]
    /// — this is a delegation.
    pub fn witness_and_log(
        &self,
        level: LifecycleLevel,
        subject: impl Into<String>,
        predicate: impl Into<String>,
        object: impl Into<String>,
    ) {
        self.inner.witness_and_log(level, subject, predicate, object);
    }
}

/// Level tag passed to [`Witness::witness_and_log`]. Maps to the
/// equivalent `tracing` level for the human-readable echo; does not
/// affect the substrate claim (which is value-less on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleLevel {
    /// Ordinary lifecycle / information events.
    Info,
    /// Non-fatal anomalies.
    Warn,
    /// Errors — caller should typically pair with a
    /// `reported-error` predicate from `mash-vocab-lifecycle`.
    Error,
}

impl From<Handle> for Witness {
    fn from(inner: Handle) -> Self {
        Self { inner }
    }
}

/// Cheap-clone send handle — both agent code and embedded runners use
/// this to witness claims and subscribe.
#[derive(Debug, Clone)]
pub struct Handle {
    outbound: mpsc::UnboundedSender<Message>,
}

impl Handle {
    /// Witness a claim into the hub's shared reality.
    ///
    /// The arguments are the three strings of an SPO triple; the
    /// bilattice value is **not** under caller control. The kernel
    /// knowledge-joins the incoming witnessing against whatever the
    /// cell currently holds, so this call contributes evidence
    /// rather than overwrites. Concurrent witnessings on the same
    /// cell rise monotonically under `≤_k`.
    ///
    /// Returns the instant the message is queued on the outbound
    /// channel; the actual cascade runs asynchronously on the hub.
    /// An agent that wants to see the consequences subscribes to
    /// the affected predicate like any other subscriber.
    ///
    /// # Errors
    ///
    /// [`ClientError::Disconnected`] if the write task has exited
    /// (the hub disconnected or the connection has been dropped).
    /// A failure here is terminal for this `Handle` — rebuild the
    /// underlying [`Connection`].
    pub fn witness(
        &self,
        subject: impl Into<String>,
        predicate: impl Into<String>,
        object: impl Into<String>,
    ) -> Result<(), ClientError> {
        self.outbound
            .send(Message::Assert {
                subject: subject.into(),
                predicate: predicate.into(),
                object: object.into(),
            })
            .map_err(|_| ClientError::Disconnected)
    }

    /// Alias for [`shutdown_signal`] accessible off a `Handle` so
    /// ports that already hold a handle don't need the free-function
    /// import. No-op helper — the signal future is global per-process.
    #[allow(clippy::unused_async, clippy::unused_self)]
    pub async fn shutdown_signal(&self) {
        shutdown_signal().await;
    }

    /// Witness `(port_subject, is-ready, port_subject)` — the
    /// canonical signal that a port has completed initialization and
    /// is serving. Per the predicate-shape typology
    /// (`docs/explanation/concepts/predicate-shapes.md`), state flags
    /// land on the diagonal so they can compose pointwise. Use
    /// [`Self::witness_port_ready_at`] alongside if the entry-time
    /// timestamp matters separately from the wire-arrival `at`.
    pub fn witness_port_ready(&self, port_subject: &str) {
        self.witness_and_log(LifecycleLevel::Info, port_subject, "is-ready", port_subject);
    }

    /// Witness `(port_subject, ready-at, <iso>)` — event-record
    /// companion to [`Self::witness_port_ready`]. Optional; the event
    /// log's wire-arrival timestamp covers most needs.
    pub fn witness_port_ready_at(&self, port_subject: &str) {
        self.witness_and_log(
            LifecycleLevel::Info,
            port_subject,
            "ready-at",
            crate::inference::time::now_iso8601(),
        );
    }

    /// Witness `(port_subject, is-stopped, port_subject)` — the
    /// canonical signal that a port's event loop has exited cleanly.
    pub fn witness_port_stopped(&self, port_subject: &str) {
        self.witness_and_log(LifecycleLevel::Info, port_subject, "is-stopped", port_subject);
    }

    /// Witness `(port_subject, stopped-at, <iso>)` — event-record
    /// companion to [`Self::witness_port_stopped`].
    pub fn witness_port_stopped_at(&self, port_subject: &str) {
        self.witness_and_log(
            LifecycleLevel::Info,
            port_subject,
            "stopped-at",
            crate::inference::time::now_iso8601(),
        );
    }

    /// Witness `(port_subject, reported-error, "hub-error code=<c>: <m>")`
    /// — the canonical shape for surfacing a hub-delivered error into
    /// the substrate as a diagnostic cell observable by the failure-
    /// observer and any downstream alerting.
    pub fn report_hub_error(&self, port_subject: &str, code: &str, message: &str) {
        self.witness_and_log(
            LifecycleLevel::Error,
            port_subject,
            "reported-error",
            format!("hub-error code={code}: {message}"),
        );
    }

    /// Witness a claim into the substrate AND echo to the tracing
    /// subscriber at the chosen level. The substrate is the source of
    /// truth; the tracing echo is a human-convenience syndicate so a
    /// live terminal still shows the event as it settles.
    ///
    /// Prefer the specialized helpers [`Self::witness_port_ready`] /
    /// [`Self::witness_port_stopped`] / [`Self::report_hub_error`] for
    /// their canonical lifecycle cases.
    ///
    /// If the witness fails (hub disconnect), the call additionally
    /// emits a tracing warn line tagged with the dropped claim so the
    /// failure is visible even when the substrate channel is gone.
    pub fn witness_and_log(
        &self,
        level: LifecycleLevel,
        subject: impl Into<String>,
        predicate: impl Into<String>,
        object: impl Into<String>,
    ) {
        let subject = subject.into();
        let predicate = predicate.into();
        let object = object.into();
        // Echo to tracing. Fields are structured so log-scrapers can
        // parse subject / predicate / object — matching the substrate
        // claim shape exactly.
        match level {
            LifecycleLevel::Info => tracing::info!(
                subject = %subject,
                predicate = %predicate,
                object = %object,
                "witness",
            ),
            LifecycleLevel::Warn => tracing::warn!(
                subject = %subject,
                predicate = %predicate,
                object = %object,
                "witness",
            ),
            LifecycleLevel::Error => tracing::error!(
                subject = %subject,
                predicate = %predicate,
                object = %object,
                "witness",
            ),
        }
        // Witness to substrate. Drop diagnostics are logged but never
        // propagated — the caller is usually in a code path (lifecycle
        // event, error handler) where a witness failure shouldn't
        // change control flow.
        if let Err(e) = self.witness(subject.clone(), predicate.clone(), object.clone()) {
            tracing::warn!(
                %subject,
                %predicate,
                error = %e,
                "witness dropped (substrate unreachable)",
            );
        }
    }

    /// Subscribe to cascade settlements on `predicate`.
    ///
    /// After this call the hub will send an [`InboundEvent::Settled`]
    /// for every cell that settles in `predicate`'s fiber, including
    /// a replay of the fiber's current state delivered as events
    /// with empty derivation chains. Subscribing to the same
    /// predicate twice is idempotent from the agent's point of view;
    /// the hub doesn't double-deliver.
    ///
    /// Normally agents subscribe once at handshake via
    /// [`ClientConfig::subscriptions`]. Use this method for
    /// dynamically discovered predicates.
    ///
    /// # Errors
    ///
    /// [`ClientError::Disconnected`] if the write task has exited.
    pub fn subscribe(&self, predicate: impl Into<String>) -> Result<(), ClientError> {
        self.outbound
            .send(Message::Subscribe {
                predicate: predicate.into(),
            })
            .map_err(|_| ClientError::Disconnected)
    }

}

async fn read_welcome(reader: &mut BufReader<OwnedReadHalf>) -> Result<String, ClientError> {
    let mut line = String::new();
    let n = reader.read_line(&mut line).await?;
    if n == 0 {
        return Err(ClientError::Handshake("eof before welcome".into()));
    }
    let msg: Message = serde_json::from_str(line.trim_end())?;
    match msg {
        Message::Welcome { session } => Ok(session),
        Message::Error { code, message } => {
            Err(ClientError::Handshake(format!("{code}: {message}")))
        }
        other => Err(ClientError::Handshake(format!("unexpected {other:?}"))),
    }
}

async fn write_line(writer: &mut OwnedWriteHalf, msg: &Message) -> Result<(), ClientError> {
    let mut line = serde_json::to_vec(msg)?;
    line.push(b'\n');
    writer.write_all(&line).await?;
    Ok(())
}

async fn write_loop(mut writer: OwnedWriteHalf, mut rx: mpsc::UnboundedReceiver<Message>) {
    while let Some(msg) = rx.recv().await {
        if let Err(e) = write_line(&mut writer, &msg).await {
            debug!(error = %e, "write_loop exiting");
            break;
        }
    }
}

async fn read_loop(reader: BufReader<OwnedReadHalf>, tx: mpsc::UnboundedSender<InboundEvent>) {
    let mut lines = reader.lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) if line.is_empty() => {}
            Ok(Some(line)) => match serde_json::from_str::<Message>(&line) {
                Ok(Message::Event { claim, derivation }) => {
                    if tx
                        .send(InboundEvent::Settled { claim, derivation })
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(Message::Error { code, message }) => {
                    if tx.send(InboundEvent::HubError { code, message }).is_err() {
                        break;
                    }
                }
                Ok(_) => {}
                Err(e) => warn!(error = %e, "dropping malformed inbound line"),
            },
            Ok(None) => break,
            Err(e) => {
                warn!(error = %e, "read_loop exiting");
                break;
            }
        }
    }
    let _ = tx.send(InboundEvent::Closed);
}

/// Future that completes when the process receives a shutdown signal
/// (SIGTERM or SIGINT on Unix). Installing listeners via `tokio::signal`
/// overrides the default terminate-on-SIGTERM behavior, so the signal
/// becomes a graceful-shutdown trigger rather than a forced exit.
///
/// Ports wrap their event loop in `tokio::select!` between
/// [`Connection::next_event`] and this future — when either resolves
/// the loop breaks, the `is-stopped` lifecycle cell settles, and the
/// port exits cleanly.
///
/// Panics only if the signal listener cannot be installed — in practice
/// that only happens on non-Unix platforms, where this helper is not
/// built.
pub async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut sigterm = signal(SignalKind::terminate()).expect("install SIGTERM listener");
    let mut sigint = signal(SignalKind::interrupt()).expect("install SIGINT listener");
    tokio::select! {
        _ = sigterm.recv() => {
            tracing::info!("received SIGTERM; shutting down");
        }
        _ = sigint.recv() => {
            tracing::info!("received SIGINT; shutting down");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a witness paired with a receiver; the receiver collects
    /// every outbound message so tests can assert the exact
    /// (subject, predicate, object) a call produced.
    fn witness_pair() -> (Witness, mpsc::UnboundedReceiver<Message>) {
        let (tx, rx) = mpsc::unbounded_channel::<Message>();
        (Witness::from(Handle::from_outbound(tx)), rx)
    }

    fn drain_assert(rx: &mut mpsc::UnboundedReceiver<Message>) -> (String, String, String) {
        match rx.try_recv().expect("no assert queued") {
            Message::Assert {
                subject,
                predicate,
                object,
            } => (subject, predicate, object),
            other => panic!("expected Assert, got {other:?}"),
        }
    }

    #[test]
    fn witness_and_log_info_sends_assert() {
        let (witness, mut rx) = witness_pair();
        witness.witness_and_log(
            LifecycleLevel::Info,
            "port:matchmaking",
            "is-ready",
            "2026-04-21T00:00:00Z",
        );
        assert_eq!(
            drain_assert(&mut rx),
            (
                "port:matchmaking".to_owned(),
                "is-ready".to_owned(),
                "2026-04-21T00:00:00Z".to_owned(),
            )
        );
    }

    #[test]
    fn witness_and_log_warn_sends_assert() {
        let (witness, mut rx) = witness_pair();
        witness.witness_and_log(
            LifecycleLevel::Warn,
            "port:x",
            "reported-warning",
            "slow settle",
        );
        assert_eq!(
            drain_assert(&mut rx),
            (
                "port:x".to_owned(),
                "reported-warning".to_owned(),
                "slow settle".to_owned(),
            )
        );
    }

    #[test]
    fn witness_and_log_error_sends_assert() {
        let (witness, mut rx) = witness_pair();
        witness.witness_and_log(
            LifecycleLevel::Error,
            "port:x",
            "reported-error",
            "spawn-failed",
        );
        assert_eq!(
            drain_assert(&mut rx),
            (
                "port:x".to_owned(),
                "reported-error".to_owned(),
                "spawn-failed".to_owned(),
            )
        );
    }

    #[test]
    fn witness_and_log_does_not_panic_on_dropped_receiver() {
        // Simulate a disconnected hub: drop the receiver before the
        // witness call. The helper should log a tracing warn and
        // return cleanly without panicking.
        let (witness, rx) = witness_pair();
        drop(rx);
        witness.witness_and_log(LifecycleLevel::Info, "s", "p", "o");
    }
}
