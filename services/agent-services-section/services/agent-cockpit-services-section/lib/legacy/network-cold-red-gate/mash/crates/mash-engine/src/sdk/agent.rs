//! Agent SDK for MASH.
//!
//! An **agent** is a translator: substrate events in, claims out.
//! Implement the [`Agent`] trait to add behavior; the trait's four
//! hooks ([`identity`](Agent::identity),
//! [`subscriptions`](Agent::subscriptions),
//! [`claims`](Agent::claims), [`translate`](Agent::translate)) cover
//! every agent the hub hosts — embedded owner-agents (vocabularies,
//! scenes) and subprocess ports alike.
//!
//! # Two deployment modes
//!
//! - **Embedded.** The hub constructs the agent in-process and drives
//!   it against the kernel command bus directly; `claims()` mounts
//!   before the event log replays, and `translate` runs on the hub's
//!   executor. This is how vocab and scene crates run. Wiring lives
//!   in `mash-hub::drive_embedded`.
//! - **Subprocess.** The agent connects to the hub over the Unix
//!   socket, handshakes, and loops. [`run_as_subprocess`] is the
//!   entry point; a typical port binary's `main` is four lines of
//!   config + `run_as_subprocess(agent, config).await`.
//!
//! # What agents must not do
//!
//! - **Hold state on `&self` beyond configuration.** If the agent
//!   "needs memory", it needs a fiber — subscribe and cache, don't
//!   mutate `self`. `&self` is `Send + Sync`; mutating it under the
//!   hub's concurrent dispatch is a hazard.
//! - **Block in `translate`.** Side-effecting ports (actuators,
//!   effectors, responders) spawn a task holding the [`Witness`]
//!   handle and return empty; the spawned task emits claims when
//!   its external work completes. Blocking in `translate` blocks
//!   the session's event stream.
//!
//! # See also
//!
//! - [`mash_sdk_client`] — the socket client: [`Witness`],
//!   [`Claim`], [`Connection`].
//! - `mash-hub` — how embedded agents are driven.
//! - The [agents-and-sessions chapter][manual] of the MASH manual —
//!   the concepts and rules this crate instantiates.
//!
//! [manual]: https://561.github.io/mash/explanation/architecture/agents-and-sessions.html

#![warn(missing_docs)]

use anyhow::{Context, Result};
use async_trait::async_trait;
use crate::algebra::Value;
use crate::inference::wire::{DerivationRecord, WireClaim};
use crate::sdk::client::{Claim, ClientConfig, Connection, Handle, InboundEvent, Witness};
use tracing::warn;

/// A settled claim with its derivation chain.
#[derive(Debug, Clone)]
pub struct Event {
    /// The settled claim.
    pub claim: WireClaim,
    /// Derivation chain; empty for directly-witnessed claims.
    pub derivation: Vec<DerivationRecord>,
}

/// A projection-port: a stateful translator from settled cells to
/// emitted claims.
///
/// Projections differ from [`Agent`] in that they hold mutable state
/// across events — per-subject counters, cached relations, emission
/// guards — and cannot be driven from a `&self` reference. The
/// signature `ingest(&mut self, …) -> Vec<Claim>` separates decision
/// (pure, testable) from effect (witnessing back to the hub), so the
/// same type drives both subprocess production and in-process
/// [`mash_testkit`](../../mash_testkit) tests.
///
/// Implementors typically own a small state struct and pattern-match
/// on `predicate` to decide how the claim updates state and whether
/// to emit anything in response. Returning an empty vector is normal;
/// most settled cells only update caches.
pub trait Projection {
    /// The port's identity, used as the subscriptions' announce name
    /// and as the `port:<identity>` subject for in-band lifecycle
    /// cells.
    fn identity(&self) -> &str;

    /// The predicates this projection subscribes to. Called once at
    /// mount time in tests and once on connect in production.
    fn subscriptions(&self) -> Vec<String>;

    /// Ingest a settled cell on a subscribed predicate. Returns the
    /// claims to witness in response — possibly empty. Claims are
    /// always witnessed at `Value::True`; projections that need to
    /// drive other bilattice values should use [`Agent`] instead.
    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
        value: Value,
    ) -> Vec<Claim>;
}

/// Run a projection subprocess to completion: open the hub
/// connection, announce subscriptions, and drive
/// [`Projection::ingest`] on every settled cell, witnessing the
/// emitted claims back.
///
/// In-band lifecycle cells (`port:<identity>` at `is-ready` /
/// `is-stopped` / `reported-error`) are handled automatically.
///
/// # Errors
///
/// Propagates any [`Connection::open`] failure.
pub async fn run_projection<P: Projection>(mut projection: P) -> Result<()> {
    use std::path::PathBuf;
    let socket_path = std::env::var_os("MASH_SOCKET")
        .map_or_else(|| PathBuf::from(".mash/sock"), PathBuf::from);
    let identity = projection.identity().to_owned();
    let config = ClientConfig {
        socket_path,
        identity: identity.clone(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        subscriptions: projection.subscriptions(),
    };
    let mut connection = Connection::open(config)
        .await
        .context("open hub connection")?;
    let handle: Handle = connection.handle();
    let port_subject = format!("port:{identity}");
    handle.witness_port_ready(&port_subject);

    while let Some(event) = connection.next_event_or_shutdown().await {
        match event {
            InboundEvent::Settled { claim, .. } => {
                let emitted = projection.ingest(
                    &claim.subject,
                    &claim.predicate,
                    &claim.object,
                    claim.value,
                );
                for c in emitted {
                    if let Err(e) = handle.witness(c.subject, c.predicate, c.object) {
                        warn!(error = %e, identity = %identity, "projection emission dropped");
                    }
                }
            }
            InboundEvent::HubError { code, message } => {
                handle.report_hub_error(&port_subject, &code, &message);
            }
            InboundEvent::Closed => break,
        }
    }

    handle.witness_port_stopped(&port_subject);
    Ok(())
}

/// An agent: a translator from substrate events to claims. `&self`
/// carries immutable configuration only; any "memory" the agent
/// appears to need should be a substrate fiber it's subscribed to,
/// not state on self.
#[async_trait]
pub trait Agent: Send + Sync + 'static {
    /// The binary's identifying name (e.g. `"shell-agent"`).
    fn identity(&self) -> &'static str {
        "agent"
    }

    /// Predicates to subscribe to on connect.
    fn subscriptions(&self) -> &'static [&'static str] {
        &[]
    }

    /// Foundational claims mounted into the substrate when the agent
    /// is hosted. Used by owner-agents to declare their vocabulary;
    /// behavior-only agents inherit the empty default.
    fn claims(&self) -> Vec<Claim> {
        Vec::new()
    }

    /// Claims to witness once after handshake, before the event loop
    /// begins. Intended for static self-registration (effector kind,
    /// provider metadata) that every instance of this port carries.
    /// Empty by default; only meaningful for subprocess agents — the
    /// embedded driver uses `claims()` instead. All witnesses are
    /// idempotent under `knowledge_join`, so restarting the port
    /// re-emits the same cells without growing the event log.
    fn startup_claims(&self) -> Vec<Claim> {
        Vec::new()
    }

    /// Translate an event into claims. Pure translators return their
    /// claim set synchronously and ignore `witness`. Port agents
    /// (bridges to shells, sockets, timers) spawn tasks holding
    /// `witness` and return empty; the spawned task emits claims
    /// when its external work completes.
    async fn translate(&self, _event: Event, _witness: Witness) -> Vec<Claim> {
        Vec::new()
    }
}

/// Open a connection to the hub and route inbound events to
/// [`Agent::translate`] until the connection closes.
///
/// Witnesses lifecycle cells on the port's own subject
/// (`port:<identity>`) as substrate claims — `is-ready` after
/// handshake, `is-stopped` when the event loop exits, `reported-error`
/// whenever the hub delivers an error message. Every agent that uses
/// this entry point gets in-band observability automatically.
///
/// # Errors
///
/// Returns any [`Connection::open`] failure.
pub async fn run_as_subprocess<A>(agent: A, config: ClientConfig) -> Result<()>
where
    A: Agent,
{
    let mut connection = Connection::open(config).await?;
    let handle = connection.handle();
    let witness: Witness = handle.clone().into();

    // Subprocess agents don't mount claims(): the Assert wire path
    // persists to the event log, and remounting on every boot would
    // grow it unboundedly.

    // In-band lifecycle: `port:<identity>` is the subject convention
    // for port-lifecycle cells.
    let port_subject = format!("port:{}", agent.identity());
    handle.witness_port_ready(&port_subject);

    // Static self-registration: the agent's startup_claims() run
    // once after the readiness cell. knowledge_join makes these
    // idempotent across restarts.
    for claim in agent.startup_claims() {
        if let Err(e) = witness.witness(claim) {
            warn!(error = %e, agent = %agent.identity(), "startup claim dropped");
        }
    }

    while let Some(event) = connection.next_event_or_shutdown().await {
        match event {
            InboundEvent::Settled { claim, derivation } => {
                let event = Event { claim, derivation };
                let claims = agent.translate(event, witness.clone()).await;
                for claim in claims {
                    if let Err(e) = witness.witness(claim) {
                        warn!(error = %e, agent = %agent.identity(), "witness dropped");
                    }
                }
            }
            InboundEvent::HubError { code, message } => {
                handle.report_hub_error(&port_subject, &code, &message);
            }
            InboundEvent::Closed => break,
        }
    }

    handle.witness_port_stopped(&port_subject);
    Ok(())
}

