//! `mash` — the MASH command-line tool.
//!
//! Short-lived operations against a running hub: witness a claim,
//! subscribe and print a predicate's settlements, send a DM to an
//! agent account, ping the hub to confirm it's responsive.
//!
//! Long-lived operations (hub boot, port supervision) live in
//! dedicated subprocess binaries ([`mash-conduit-stdio`],
//! [`mash-conduit-telnet`]) or the hub binary itself — not here.
//! The CLI is the operator-facing probe/poke surface.
//!
//! # Usage
//!
//! ```text
//! mash ping
//! mash witness <subject> <predicate> <object>
//! mash watch <predicate> [--limit N]
//! mash dm <recipient-account> <body>
//! ```
//!
//! # Configuration
//!
//! - `MASH_SOCKET` — hub socket path. Default `.mash/sock`.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use mash_engine::algebra::Value;
use mash_engine::sdk::client::{ClientConfig, Connection, InboundEvent};
use tracing_subscriber::EnvFilter;

use mash_library::comms::{ADDRESSED_TO, MESSAGE, WAS_SAID_BY, WAS_UTTERED_AT};
use mash_library::conduit::HAS_BODY;
use mash_library::foundation::IS_A_TERM;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn")),
        )
        .init();

    let mut args = std::env::args().skip(1);
    let Some(subcommand) = args.next() else {
        print_usage();
        std::process::exit(2);
    };

    match subcommand.as_str() {
        "ping" => ping().await,
        "witness" => witness(args.collect()).await,
        "watch" => watch(args.collect()).await,
        "fiber" => fiber(args.collect()).await,
        "dm" => dm(args.collect()).await,
        "help" | "--help" | "-h" => {
            print_usage();
            Ok(())
        }
        other => {
            eprintln!("unknown subcommand: {other}");
            print_usage();
            std::process::exit(2);
        }
    }
}

fn print_usage() {
    eprintln!(
        "mash — MASH command-line tool\n\n\
         USAGE:\n\
         \x20 mash ping\n\
         \x20 mash witness <subject> <predicate> <object>\n\
         \x20 mash watch <predicate> [--limit N]\n\
         \x20 mash fiber <predicate> [--value t|f|both|none] [--json] [--idle-ms N]\n\
         \x20 mash dm <recipient-account> <body>\n\n\
         ENV:\n\
         \x20 MASH_SOCKET   hub socket path (default: .mash/sock)"
    );
}

fn socket_path() -> PathBuf {
    std::env::var_os("MASH_SOCKET").map_or_else(|| PathBuf::from(".mash/sock"), PathBuf::from)
}

async fn open(subs: Vec<String>, identity: &str) -> Result<Connection> {
    let client = ClientConfig {
        socket_path: socket_path(),
        identity: identity.to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        subscriptions: subs,
    };
    Connection::open(client)
        .await
        .context("open hub connection")
}

// ─────────────────────────────────────────────────────────────────────
// ping — confirm hub is up
// ─────────────────────────────────────────────────────────────────────

async fn ping() -> Result<()> {
    let connection = open(Vec::new(), "mash-cli-ping").await?;
    println!("hub reachable (session: {})", connection.session());
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────
// witness — fire one claim at the hub
// ─────────────────────────────────────────────────────────────────────

async fn witness(args: Vec<String>) -> Result<()> {
    let mut iter = args.into_iter();
    let subject = iter
        .next()
        .ok_or_else(|| anyhow!("usage: mash witness <subject> <predicate> <object>"))?;
    let predicate = iter
        .next()
        .ok_or_else(|| anyhow!("witness: missing <predicate>"))?;
    let object = iter
        .next()
        .ok_or_else(|| anyhow!("witness: missing <object>"))?;
    if iter.next().is_some() {
        bail!("witness: too many arguments");
    }
    let connection = open(Vec::new(), "mash-cli-witness").await?;
    let handle = connection.handle();
    handle
        .witness(&subject, &predicate, &object)
        .map_err(|e| anyhow!("witness dropped: {e:?}"))?;
    // Small flush delay — the outbound mpsc is unbounded, so the
    // send returns instantly. We need the writer task to drain
    // before we drop the connection or the assert is lost.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    println!("witnessed ({subject}, {predicate}, {object}) at True");
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────
// watch — subscribe to a predicate and print settlements
// ─────────────────────────────────────────────────────────────────────

async fn watch(args: Vec<String>) -> Result<()> {
    let mut iter = args.into_iter();
    let predicate = iter
        .next()
        .ok_or_else(|| anyhow!("usage: mash watch <predicate> [--limit N]"))?;
    let mut limit: Option<u64> = None;
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--limit" => {
                let v = iter
                    .next()
                    .ok_or_else(|| anyhow!("--limit requires a value"))?;
                limit = Some(
                    v.parse()
                        .map_err(|_| anyhow!("--limit value must be a number"))?,
                );
            }
            other => bail!("unknown flag: {other}"),
        }
    }

    let mut connection = open(vec![predicate.clone()], "mash-cli-watch").await?;
    eprintln!("watching {predicate} (Ctrl-C to stop)");
    let mut n: u64 = 0;
    while let Some(event) = connection.next_event_or_shutdown().await {
        match event {
            InboundEvent::Settled { claim, .. } => {
                let v = match claim.value {
                    Value::True => "T",
                    Value::False => "F",
                    Value::Both => "B",
                    Value::None => "N",
                };
                println!(
                    "[{v}] ({}, {}, {})",
                    claim.subject, claim.predicate, claim.object
                );
                n += 1;
                if let Some(k) = limit {
                    if n >= k {
                        break;
                    }
                }
            }
            InboundEvent::HubError { code, message } => {
                eprintln!("hub-error [{code}]: {message}");
            }
            InboundEvent::Closed => break,
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────
// fiber — snapshot every cell of a predicate and exit
// ─────────────────────────────────────────────────────────────────────

async fn fiber(args: Vec<String>) -> Result<()> {
    let mut iter = args.into_iter();
    let predicate = iter.next().ok_or_else(|| {
        anyhow!("usage: mash fiber <predicate> [--value t|f|both|none] [--json] [--idle-ms N]")
    })?;

    let mut value_filter: Option<Value> = None;
    let mut json = false;
    let mut idle_ms: u64 = 300;
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--value" => {
                let v = iter
                    .next()
                    .ok_or_else(|| anyhow!("--value requires t|f|both|none"))?;
                value_filter = Some(parse_value_filter(&v)?);
            }
            "--json" => json = true,
            "--idle-ms" => {
                let v = iter
                    .next()
                    .ok_or_else(|| anyhow!("--idle-ms requires a number"))?;
                idle_ms = v
                    .parse()
                    .map_err(|_| anyhow!("--idle-ms value must be a number"))?;
            }
            other => bail!("unknown flag: {other}"),
        }
    }

    let mut connection = open(vec![predicate.clone()], "mash-cli-fiber").await?;

    // Drain the subscription's fiber replay. The hub has no "replay
    // done" signal on the wire, so fall back to an idle-timeout: exit
    // after `idle_ms` of silence on the inbound channel. Live cascade
    // activity during the window is included in the snapshot — this
    // reports the fiber at the moment of query, not transactionally.
    let idle = std::time::Duration::from_millis(idle_ms);
    let mut cells: Vec<(String, String, String, Value)> = Vec::new();
    loop {
        match tokio::time::timeout(idle, connection.next_event_or_shutdown()).await {
            Ok(Some(InboundEvent::Settled { claim, .. })) => {
                if let Some(want) = value_filter {
                    if claim.value != want {
                        continue;
                    }
                }
                cells.push((claim.subject, claim.predicate, claim.object, claim.value));
            }
            Ok(Some(InboundEvent::HubError { code, message })) => {
                eprintln!("hub-error [{code}]: {message}");
            }
            Ok(Some(InboundEvent::Closed)) | Ok(None) => break,
            Err(_) => break,
        }
    }

    cells.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.2.cmp(&b.2)));

    if json {
        for (s, p, o, v) in &cells {
            let obj = serde_json::json!({
                "subject": s,
                "predicate": p,
                "object": o,
                "value": v.as_str(),
            });
            println!("{obj}");
        }
    } else {
        for (s, p, o, v) in &cells {
            let marker = match v {
                Value::True => "T",
                Value::False => "F",
                Value::Both => "B",
                Value::None => "N",
            };
            println!("[{marker}] ({s}, {p}, {o})");
        }
        eprintln!("({} cells in fiber of {predicate})", cells.len());
    }
    Ok(())
}

fn parse_value_filter(s: &str) -> Result<Value> {
    match s {
        "t" | "true" | "True" | "T" => Ok(Value::True),
        "f" | "false" | "False" | "F" => Ok(Value::False),
        "both" | "Both" | "B" => Ok(Value::Both),
        "none" | "None" | "N" => Ok(Value::None),
        other => bail!("--value must be one of t|f|both|none, got {other:?}"),
    }
}

// ─────────────────────────────────────────────────────────────────────
// dm — send a direct message to an agent account
// ─────────────────────────────────────────────────────────────────────

async fn dm(args: Vec<String>) -> Result<()> {
    let mut iter = args.into_iter();
    let recipient = iter
        .next()
        .ok_or_else(|| anyhow!("usage: mash dm <recipient-account> <body>"))?;
    let body = iter.collect::<Vec<_>>().join(" ");
    if body.is_empty() {
        bail!("dm: empty body");
    }
    let connection = open(Vec::new(), "mash-cli-dm").await?;
    let handle = connection.handle();

    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let msg = format!("msg:cli:{secs}");
    let sender = std::env::var("MASH_CLI_SENDER")
        .unwrap_or_else(|_| "speaker:cli".to_owned());

    handle
        .witness(&msg, IS_A_TERM, MESSAGE)
        .map_err(|e| anyhow!("witness dropped: {e:?}"))?;
    handle
        .witness(&msg, WAS_SAID_BY, &sender)
        .map_err(|e| anyhow!("witness dropped: {e:?}"))?;
    handle
        .witness(&msg, ADDRESSED_TO, &recipient)
        .map_err(|e| anyhow!("witness dropped: {e:?}"))?;
    handle
        .witness(&msg, HAS_BODY, &body)
        .map_err(|e| anyhow!("witness dropped: {e:?}"))?;
    handle
        .witness(&msg, WAS_UTTERED_AT, &format!("{secs}"))
        .map_err(|e| anyhow!("witness dropped: {e:?}"))?;

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    println!("dm sent to {recipient} (msg: {msg})");
    Ok(())
}
