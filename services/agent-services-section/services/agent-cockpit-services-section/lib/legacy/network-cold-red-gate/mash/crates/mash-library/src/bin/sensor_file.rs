//! File sensor — watches configured paths and witnesses their
//! observed sha256 + byte length + timestamp back into the substrate.
//!
//! The sensor half of the filesystem retraction pair: the effector
//! writes `HAS_INTENDED_SHA256`; this sensor reads the actual disk
//! state and witnesses `HAS_OBSERVED_SHA256`. When they disagree the
//! counit port ([`mash_library::fs::FileCounitPort`]) surfaces
//! divergence.
//!
//! # Configuration
//!
//! - `MASH_SOCKET` — hub socket path. Default `.mash/sock`.
//! - `MASH_SENSOR_FILES` — comma-separated list of `<file-subject>=<path>`
//!   mappings the sensor watches. Example:
//!   `file:abc=/etc/hosts,file:def=/tmp/scratch`.
//! - `MASH_SENSOR_INTERVAL_SECS` — poll cadence. Default 30s.
//!
//! # Semantics
//!
//! On each tick the sensor reads each configured file, computes
//! sha256 + byte length, and witnesses the observation. It skips
//! emissions when the hash hasn't changed since the last poll —
//! substrate cells are monotone, so re-witnessing the same digest
//! is harmless but noisy.
//!
//! On I/O errors (file missing, permission denied), the sensor
//! logs and continues; no witnessed claims on the error path.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use mash_engine::sdk::client::{ClientConfig, Connection, Handle};
use sha2::{Digest, Sha256};
use tokio::fs;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use mash_library::fs::{HAS_BYTE_LENGTH, HAS_OBSERVED_SHA256, WAS_OBSERVED_AT};

const DEFAULT_INTERVAL_SECS: u64 = 30;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let socket_path = std::env::var_os("MASH_SOCKET")
        .map_or_else(|| PathBuf::from(".mash/sock"), PathBuf::from);
    let interval_secs: u64 = std::env::var("MASH_SENSOR_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_INTERVAL_SECS);
    let files = parse_files_env(&std::env::var("MASH_SENSOR_FILES").unwrap_or_default());
    if files.is_empty() {
        anyhow::bail!(
            "MASH_SENSOR_FILES is empty; set it to `file:subject=/abs/path,...` before running"
        );
    }

    let client = ClientConfig {
        socket_path,
        identity: "mash-sensor-file".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        subscriptions: Vec::new(),
    };
    let connection = Connection::open(client)
        .await
        .context("open hub connection")?;
    let handle = connection.handle();
    info!(
        hub_session = connection.session(),
        file_count = files.len(),
        interval_secs,
        "mash-sensor-file ready"
    );

    // Last-observed hash per subject — skip re-witnesses when
    // unchanged.
    let mut last_hash: HashMap<String, String> = HashMap::new();

    let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                for (subject, path) in &files {
                    match observe_file(path).await {
                        Ok((hash, len)) => {
                            if last_hash.get(subject) == Some(&hash) {
                                continue;
                            }
                            let now = iso_now();
                            let _ = handle.witness(subject, HAS_OBSERVED_SHA256, &hash);
                            let _ = handle.witness(subject, HAS_BYTE_LENGTH, &len.to_string());
                            let _ = handle.witness(subject, WAS_OBSERVED_AT, &now);
                            last_hash.insert(subject.clone(), hash);
                        }
                        Err(e) => {
                            warn!(subject = %subject, path = %path.display(), error = %e, "read failed");
                        }
                    }
                }
            }
            _ = handle.shutdown_signal() => {
                info!("shutdown signal; exiting");
                break;
            }
        }
    }
    Ok(())
}

fn parse_files_env(s: &str) -> Vec<(String, PathBuf)> {
    s.split(',')
        .filter(|s| !s.trim().is_empty())
        .filter_map(|entry| {
            let (subject, path) = entry.split_once('=')?;
            Some((subject.trim().to_owned(), PathBuf::from(path.trim())))
        })
        .collect()
}

async fn observe_file(path: &Path) -> Result<(String, u64)> {
    let bytes = fs::read(path).await.with_context(|| format!("read {}", path.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    use std::fmt::Write as _;
    for b in digest {
        let _ = write!(hex, "{b:02x}");
    }
    let len = bytes.len() as u64;
    Ok((hex, len))
}

fn iso_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

// Silence "unused" warnings on the Handle shutdown sugar when the
// sdk's feature set doesn't surface it.
#[allow(dead_code)]
fn _handle_hint(_h: &Handle) {}
