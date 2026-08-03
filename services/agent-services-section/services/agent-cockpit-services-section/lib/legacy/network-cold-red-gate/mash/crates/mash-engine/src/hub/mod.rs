//! MASH hub: one process, one socket, one shared predication substrate.
//!
//! Hosts a [`crate::proof::Semiotics`] behind a Unix-domain
//! socket. Agents — embedded in-process or subprocess over the socket —
//! witness claims into it and receive settlement events back.

#![warn(missing_docs)]

mod conn;
mod embedded;
mod kernel;
mod persist;
mod witness;

pub use embedded::drive_embedded;
pub use kernel::{Cmd, Hub, SessionId};
pub use persist::Persistence;
pub use witness::witnesses_of;

use anyhow::{Context, Result};
use crate::sdk::agent::Agent;
use crate::proof::Semiotics;
use std::path::{Path, PathBuf};
use tokio::net::UnixListener;
use tokio::sync::mpsc;
use tracing::{info, warn};

/// Configuration for [`run`] / [`run_with_embedded`].
#[derive(Debug, Clone)]
pub struct Config {
    /// Unix-domain socket path.
    pub socket_path: PathBuf,
    /// The running instance's `.mash/` directory. The hub locks it,
    /// replays its event log before accepting connections, and
    /// appends externally-sourced assertions to it. Tests pass a
    /// tempdir.
    pub mash_root: PathBuf,
}

/// Boot the hub with no embedded agents.
///
/// # Errors
///
/// See [`run_with_embedded`].
pub async fn run(config: Config) -> Result<()> {
    run_with_embedded(config, Vec::new()).await
}

/// Run the hub until either the accept/hub task fails or the supplied
/// shutdown future fires. On shutdown: the listener stops accepting
/// new connections, then the hub continues processing pending
/// commands until the cmd channel has been idle for ~200ms, then
/// returns. This drain window gives port subprocesses time to land
/// their `is-stopped` lifecycle cells in the event log instead of
/// having their writes raced against an abrupt task abort.
///
/// # Errors
///
/// See [`run_with_embedded`].
pub async fn run_with_embedded_until<F>(
    config: Config,
    embedded: Vec<Box<dyn Agent>>,
    shutdown: F,
) -> Result<()>
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    run_inner(config, embedded, Some(Box::pin(shutdown))).await
}

/// Boot the hub, hosting `embedded` as in-process agents. Their
/// [`Agent::claims`] are mounted into the substrate synchronously
/// before the event log is replayed; each then gets a session id in
/// `0..embedded.len()` and runs its [`Agent::translate`] against the
/// kernel command bus. Socket sessions start numbering from
/// `embedded.len()`.
///
/// # Errors
///
/// Returns an error if the socket path is unavailable or the accept
/// loop cannot start.
pub async fn run_with_embedded(
    config: Config,
    embedded: Vec<Box<dyn Agent>>,
) -> Result<()> {
    run_inner(config, embedded, None).await
}

type ShutdownFuture = std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>;

async fn run_inner(
    config: Config,
    embedded: Vec<Box<dyn Agent>>,
    shutdown: Option<ShutdownFuture>,
) -> Result<()> {
    let mut semiotics = Semiotics::new();

    // Owner-agent claims first: declares the morphisms every later
    // assertion in the event log relies on.
    let mut owner_claim_count = 0usize;
    for agent in &embedded {
        for claim in agent.claims() {
            let s = semiotics.intern(&claim.subject);
            let p = semiotics.intern(&claim.predicate);
            let o = semiotics.intern(&claim.object);
            semiotics.assert(crate::proof::Claim {
                subject: s,
                predicate: p,
                object: o,
                value: crate::algebra::Value::True,
            });
            owner_claim_count += 1;
        }
    }
    if !embedded.is_empty() {
        info!(
            agents = embedded.len(),
            claims = owner_claim_count,
            "mounted owner-agent claims"
        );
    }

    let persistence = {
        let p = Persistence::open(&config.mash_root).context("open .mash/")?;
        let replayed = p
            .replay(|assertion| {
                let s = semiotics.intern(&assertion.s);
                let pr = semiotics.intern(&assertion.p);
                let o = semiotics.intern(&assertion.o);
                semiotics.assert(crate::proof::Claim {
                    subject: s,
                    predicate: pr,
                    object: o,
                    value: crate::algebra::Value::True,
                });
                Ok(())
            })
            .context("replay kernel channel")?;
        info!(
            events = replayed,
            path = %config.mash_root.display(),
            "replayed kernel channel"
        );
        Some(p)
    };

    remove_stale_socket(&config.socket_path)?;
    if let Some(parent) = config.socket_path.parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .with_context(|| format!("mkdir -p {}", parent.display()))?;
        }
    }
    let listener = UnixListener::bind(&config.socket_path)
        .with_context(|| format!("bind {}", config.socket_path.display()))?;
    info!(path = %config.socket_path.display(), "hub listening");

    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<Cmd>();
    let mut hub = Hub::new(semiotics);
    hub.set_persistence(persistence);

    let embedded_count = embedded.len() as u64;
    for (index, agent) in embedded.into_iter().enumerate() {
        let id = SessionId(index as u64);
        tokio::spawn(drive_embedded(agent, id, cmd_tx.clone()));
    }

    let mut accept_handle =
        tokio::spawn(accept_loop(listener, cmd_tx.clone(), embedded_count));
    let mut hub_handle = tokio::spawn(async move { hub.run(cmd_rx).await });
    drop(cmd_tx);

    if let Some(shutdown) = shutdown {
        tokio::select! {
            r = &mut accept_handle => {
                hub_handle.abort();
                r.context("accept task panicked")??;
            }
            r = &mut hub_handle => {
                accept_handle.abort();
                r.context("hub task panicked")?;
            }
            () = shutdown => {
                // Drop the listener by aborting the accept task —
                // closes the socket so no new connections come in.
                // Existing sessions stay live so their pending writes
                // can drain through the hub task.
                accept_handle.abort();
                info!("shutdown signaled; draining hub before exit");
                // Give children a chance to settle is-stopped writes.
                // The hub task exits naturally when every cmd_tx
                // (held by client connections) is dropped, but we
                // also bound the wait so a stuck client can't pin us.
                let _ = tokio::time::timeout(
                    std::time::Duration::from_millis(2000),
                    &mut hub_handle,
                )
                .await;
                hub_handle.abort();
            }
        }
        Ok(())
    } else {
        tokio::select! {
            r = accept_handle => r.context("accept task panicked")??,
            r = hub_handle => r.context("hub task panicked")?,
        }
        Ok(())
    }
}

async fn accept_loop(
    listener: UnixListener,
    cmd_tx: mpsc::UnboundedSender<Cmd>,
    start_id: u64,
) -> Result<()> {
    let mut next_id = start_id;
    loop {
        let (stream, _addr) = listener.accept().await.context("accept")?;
        let id = SessionId(next_id);
        next_id += 1;
        conn::spawn(stream, id, &cmd_tx);
    }
}

fn remove_stale_socket(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => {
            warn!(path = %path.display(), "removed stale socket");
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e).with_context(|| format!("remove stale {}", path.display())),
    }
}
