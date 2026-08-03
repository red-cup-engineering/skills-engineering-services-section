//! LLM effector — subscribes to `is-ready-to-run-on-llm`, spawns
//! `claude -p --bare --output-format json <prompt>` (optionally
//! `--resume <sid>` for conversation continuity), parses the JSON
//! envelope, and witnesses completion metrics back.
//!
//! # Configuration
//!
//! - `MASH_SOCKET` — hub socket path. Default `.mash/sock`.
//! - `MASH_LLM_BIN` — `claude` binary path. Default `claude`
//!   (resolved via `$PATH`).
//! - `MASH_LLM_RESUME` — pre-set provider session id for
//!   `--resume`. Optional; typically the port captures and reuses
//!   its own session ids across ops automatically.
//!
//! # Semantics
//!
//! On `(op, is-ready-to-run-on-llm, _)` with a cached
//! `runs-command` (the prompt), the effector spawns claude, parses
//! the JSON `result` + `session_id` fields, and witnesses:
//!
//! - `(op, is-running, op)` on spawn
//! - On success:
//!   - `(op, produced-completion, <result-text>)`
//!   - `(op, has-llm-session, <session_id>)` if present
//!   - `(op, completed-at, <iso>)`
//!   - `(op, is-completed, op)`
//! - On failure:
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

use mash_library::llm::{HAS_LLM_SESSION, PRODUCED_COMPLETION};
use mash_library::ops::{
    COMPLETED_AT, EXITED_WITH_CODE, IS_COMPLETED, IS_FAILED, IS_RUNNING, RUNS_COMMAND,
    WROTE_STDERR,
};
use mash_library::workers::IS_READY_TO_RUN_ON_LLM;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let socket_path = std::env::var_os("MASH_SOCKET")
        .map_or_else(|| PathBuf::from(".mash/sock"), PathBuf::from);
    let claude_bin: PathBuf = std::env::var_os("MASH_LLM_BIN")
        .map_or_else(|| PathBuf::from("claude"), PathBuf::from);
    let initial_resume = std::env::var("MASH_LLM_RESUME").ok();

    let client = ClientConfig {
        socket_path,
        identity: "mash-effector-llm".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        subscriptions: vec![
            IS_READY_TO_RUN_ON_LLM.to_owned(),
            RUNS_COMMAND.to_owned(),
        ],
    };
    let mut connection = Connection::open(client)
        .await
        .context("open hub connection")?;
    let handle = connection.handle();
    info!(
        hub_session = connection.session(),
        claude_bin = %claude_bin.display(),
        "mash-effector-llm ready"
    );

    let commands: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
    let resume: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(initial_resume));

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
                } else if claim.predicate == IS_READY_TO_RUN_ON_LLM {
                    let op = claim.subject.clone();
                    let Some(prompt) = commands.lock().await.get(&op).cloned() else {
                        warn!(%op, "ready without cached runs-command (prompt)");
                        continue;
                    };
                    let handle = handle.clone();
                    let claude_bin = claude_bin.clone();
                    let resume = resume.clone();
                    tokio::spawn(async move {
                        let prior = resume.lock().await.clone();
                        let new_sid = call_claude(&handle, &op, &claude_bin, &prompt, prior.as_deref()).await;
                        if let Some(sid) = new_sid {
                            *resume.lock().await = Some(sid);
                        }
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

/// Call claude; witness the completion. Returns the provider session
/// id if the response included one.
async fn call_claude(
    handle: &Handle,
    op: &str,
    claude_bin: &std::path::Path,
    prompt: &str,
    prior_session: Option<&str>,
) -> Option<String> {
    let _ = handle.witness(op, IS_RUNNING, op);

    let mut cmd = Command::new(claude_bin);
    cmd.arg("-p")
        .arg(prompt)
        .arg("--bare")
        .arg("--output-format")
        .arg("json");
    if let Some(sid) = prior_session {
        cmd.arg("--resume").arg(sid);
    }
    let output = match cmd.output().await {
        Ok(o) => o,
        Err(e) => {
            warn!(%op, error = %e, "spawn failed");
            let _ = handle.witness(op, EXITED_WITH_CODE, "spawn-failed");
            let _ = handle.witness(op, WROTE_STDERR, &e.to_string());
            let _ = handle.witness(op, IS_FAILED, op);
            return None;
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let code = output
            .status
            .code()
            .map_or_else(|| "signal".to_owned(), |c| c.to_string());
        let _ = handle.witness(op, EXITED_WITH_CODE, &code);
        let _ = handle.witness(op, WROTE_STDERR, &stderr);
        let _ = handle.witness(op, IS_FAILED, op);
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let parsed: serde_json::Value = match serde_json::from_str(stdout.trim()) {
        Ok(v) => v,
        Err(e) => {
            warn!(%op, error = %e, "JSON parse failed");
            let _ = handle.witness(op, EXITED_WITH_CODE, "json-parse-failed");
            let _ = handle.witness(op, WROTE_STDERR, &format!("parse error: {e}\noutput: {stdout}"));
            let _ = handle.witness(op, IS_FAILED, op);
            return None;
        }
    };
    let result = parsed
        .get("result")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_owned();
    let session_id = parsed
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(str::to_owned);

    let now = iso_now();
    let _ = handle.witness(op, PRODUCED_COMPLETION, &result);
    if let Some(sid) = &session_id {
        let _ = handle.witness(op, HAS_LLM_SESSION, sid);
    }
    let _ = handle.witness(op, COMPLETED_AT, &now);
    let _ = handle.witness(op, IS_COMPLETED, op);
    session_id
}

fn iso_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
