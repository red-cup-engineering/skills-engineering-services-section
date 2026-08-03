//! Container effector — subscribes to `is-ready-to-run-on-container`,
//! spawns the op's `runs-command` payload inside a container runtime
//! (docker / podman), and witnesses the result.
//!
//! Shape mirrors [`mash-effector-shell`]; only the spawn target
//! changes: `<runtime> run --rm <image> sh -c <command>`.
//!
//! # Configuration
//!
//! - `MASH_SOCKET` — hub socket path. Default `.mash/sock`.
//! - `MASH_CONTAINER_RUNTIME` — `docker` or `podman`. Default `docker`.
//! - `MASH_CONTAINER_IMAGE` — image to run. Default `alpine:latest`.
//! - `MASH_CONTAINER_SHELL` — shell inside the container.
//!   Default `/bin/sh`.
//!
//! More sophisticated deployments can swap out the container-execution
//! strategy by replacing this binary; the substrate contract is just
//! that a container-worker witnesses completion the same way shell
//! does.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use mash_engine::algebra::Value;
use mash_engine::sdk::client::{ClientConfig, Connection, Handle, InboundEvent};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use mash_library::ops::{
    COMPLETED_AT, EXITED_WITH_CODE, IS_COMPLETED, IS_FAILED, IS_RUNNING, RUNS_COMMAND,
    WROTE_STDERR, WROTE_STDOUT,
};
use mash_library::workers::IS_READY_TO_RUN_ON_CONTAINER;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let socket_path = std::env::var_os("MASH_SOCKET")
        .map_or_else(|| PathBuf::from(".mash/sock"), PathBuf::from);
    let runtime =
        std::env::var("MASH_CONTAINER_RUNTIME").unwrap_or_else(|_| "docker".to_owned());
    let image = std::env::var("MASH_CONTAINER_IMAGE").unwrap_or_else(|_| "alpine:latest".to_owned());
    let shell = std::env::var("MASH_CONTAINER_SHELL").unwrap_or_else(|_| "/bin/sh".to_owned());

    let client = ClientConfig {
        socket_path,
        identity: "mash-effector-container".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        subscriptions: vec![
            IS_READY_TO_RUN_ON_CONTAINER.to_owned(),
            RUNS_COMMAND.to_owned(),
        ],
    };
    let mut connection = Connection::open(client)
        .await
        .context("open hub connection")?;
    let handle = connection.handle();
    info!(
        hub_session = connection.session(),
        %runtime,
        %image,
        "mash-effector-container ready"
    );

    let commands: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));

    while let Some(event) = connection.next_event_or_shutdown().await {
        match event {
            InboundEvent::Settled { claim, .. } => {
                if claim.value != Value::True {
                    continue;
                }
                if claim.predicate == RUNS_COMMAND {
                    commands
                        .lock()
                        .await
                        .insert(claim.subject, claim.object);
                } else if claim.predicate == IS_READY_TO_RUN_ON_CONTAINER {
                    let op = claim.subject.clone();
                    let Some(command) = commands.lock().await.get(&op).cloned() else {
                        warn!(%op, "ready without cached runs-command");
                        continue;
                    };
                    let handle = handle.clone();
                    let runtime = runtime.clone();
                    let image = image.clone();
                    let shell = shell.clone();
                    tokio::spawn(async move {
                        run_op(&handle, &op, &runtime, &image, &shell, &command).await;
                    });
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

async fn run_op(
    handle: &Handle,
    op: &str,
    runtime: &str,
    image: &str,
    shell: &str,
    command: &str,
) {
    let _ = handle.witness(op, IS_RUNNING, op);

    let mut cmd = Command::new(runtime);
    cmd.arg("run")
        .arg("--rm")
        .arg(image)
        .arg(shell)
        .arg("-c")
        .arg(command);
    let output = match cmd.output().await {
        Ok(o) => o,
        Err(e) => {
            warn!(%op, error = %e, "spawn failed");
            let _ = handle.witness(op, EXITED_WITH_CODE, "spawn-failed");
            let _ = handle.witness(op, WROTE_STDERR, &e.to_string());
            let _ = handle.witness(op, IS_FAILED, op);
            return;
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output
        .status
        .code()
        .map_or_else(|| "signal".to_owned(), |c| c.to_string());
    let now = iso_now();

    if !stdout.is_empty() {
        let _ = handle.witness(op, WROTE_STDOUT, &stdout);
    }
    if !stderr.is_empty() {
        let _ = handle.witness(op, WROTE_STDERR, &stderr);
    }
    let _ = handle.witness(op, EXITED_WITH_CODE, &code);
    let _ = handle.witness(op, COMPLETED_AT, &now);

    if output.status.success() {
        let _ = handle.witness(op, IS_COMPLETED, op);
    } else {
        let _ = handle.witness(op, IS_FAILED, op);
    }
}

fn iso_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
