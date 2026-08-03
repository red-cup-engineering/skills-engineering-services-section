//! Shell effector — subscribes to `is-ready-to-run-on-shell`,
//! spawns the op's `runs-command` payload as a bash subprocess,
//! and witnesses the result back into the substrate.
//!
//! # Configuration
//!
//! - `MASH_SOCKET` — hub socket path. Default `.mash/sock`.
//! - `MASH_SHELL_BIN` — shell binary. Default `/bin/bash`.
//! - `MASH_SHELL_CWD` — working directory. Default: inherit process CWD.
//!
//! # Semantics
//!
//! On `(op, is-ready-to-run-on-shell, _)` with a cached
//! `runs-command`, the effector spawns `<shell> -c <command>`,
//! captures stdout + stderr + exit code, and witnesses:
//!
//! - `(op, is-running, op)` on spawn (diagonal state flag)
//! - On clean exit 0:
//!   - `(op, wrote-stdout, <stdout>)`
//!   - `(op, wrote-stderr, <stderr>)` if non-empty
//!   - `(op, exited-with-code, "0")`
//!   - `(op, completed-at, <iso>)`
//!   - `(op, is-completed, op)`
//! - On non-zero exit or spawn error:
//!   - `(op, exited-with-code, <code-or-reason>)`
//!   - `(op, wrote-stderr, <diagnostic>)`
//!   - `(op, is-failed, op)`

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
use mash_library::workers::IS_READY_TO_RUN_ON_SHELL;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let socket_path = std::env::var_os("MASH_SOCKET")
        .map_or_else(|| PathBuf::from(".mash/sock"), PathBuf::from);
    let shell_bin: PathBuf = std::env::var_os("MASH_SHELL_BIN")
        .map_or_else(|| PathBuf::from("/bin/bash"), PathBuf::from);
    let cwd = std::env::var_os("MASH_SHELL_CWD").map(PathBuf::from);

    let client = ClientConfig {
        socket_path,
        identity: "mash-effector-shell".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        subscriptions: vec![
            IS_READY_TO_RUN_ON_SHELL.to_owned(),
            RUNS_COMMAND.to_owned(),
        ],
    };
    let mut connection = Connection::open(client)
        .await
        .context("open hub connection")?;
    let handle = connection.handle();
    info!(
        hub_session = connection.session(),
        shell = %shell_bin.display(),
        "mash-effector-shell ready"
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
                } else if claim.predicate == IS_READY_TO_RUN_ON_SHELL {
                    let op = claim.subject.clone();
                    let Some(command) = commands.lock().await.get(&op).cloned() else {
                        warn!(%op, "ready without cached runs-command");
                        continue;
                    };
                    let handle = handle.clone();
                    let shell = shell_bin.clone();
                    let cwd = cwd.clone();
                    tokio::spawn(async move {
                        run_op(&handle, &op, &shell, cwd.as_deref(), &command).await;
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

async fn run_op(handle: &Handle, op: &str, shell: &std::path::Path, cwd: Option<&std::path::Path>, command: &str) {
    let _ = handle.witness(op, IS_RUNNING, op);

    let mut cmd = Command::new(shell);
    cmd.arg("-c").arg(command);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
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
