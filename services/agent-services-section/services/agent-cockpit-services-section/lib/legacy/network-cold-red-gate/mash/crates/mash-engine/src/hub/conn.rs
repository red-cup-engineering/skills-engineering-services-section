//! Per-connection tasks: one reads JSONL from the stream and forwards
//! decoded [`Message`]s to the kernel; one drains outbound messages
//! and writes them back.

use super::kernel::{Cmd, SessionId};
use crate::inference::wire::Message;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc;
use tracing::{debug, warn};

/// Spawn the reader and writer tasks for `stream`, register the
/// session with the kernel, and return.
pub fn spawn(stream: UnixStream, id: SessionId, cmd_tx: &mpsc::UnboundedSender<Cmd>) {
    let (outbound_tx, outbound_rx) = mpsc::unbounded_channel::<Message>();
    // Announce the new session to the kernel before the reader fires.
    if cmd_tx
        .send(Cmd::Connect {
            id,
            outbound: outbound_tx,
        })
        .is_err()
    {
        return;
    }
    let (reader, writer) = stream.into_split();
    tokio::spawn(read_loop(reader, id, cmd_tx.clone()));
    tokio::spawn(write_loop(writer, outbound_rx, id));
}

async fn read_loop(
    reader: tokio::net::unix::OwnedReadHalf,
    id: SessionId,
    cmd_tx: mpsc::UnboundedSender<Cmd>,
) {
    let mut lines = BufReader::new(reader).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) if line.is_empty() => {}
            Ok(Some(line)) => match serde_json::from_str::<Message>(&line) {
                Ok(msg) => {
                    if cmd_tx.send(Cmd::Message { id, msg }).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    warn!(session = id.0, error = %e, "invalid JSON on socket");
                    let _ = cmd_tx.send(Cmd::Message {
                        id,
                        msg: Message::Error {
                            code: "parse".into(),
                            message: e.to_string(),
                        },
                    });
                }
            },
            Ok(None) => break,
            Err(e) => {
                warn!(session = id.0, error = %e, "socket read error");
                break;
            }
        }
    }
    let _ = cmd_tx.send(Cmd::Disconnect { id });
    debug!(session = id.0, "reader exited");
}

async fn write_loop(
    mut writer: tokio::net::unix::OwnedWriteHalf,
    mut outbound: mpsc::UnboundedReceiver<Message>,
    id: SessionId,
) {
    while let Some(msg) = outbound.recv().await {
        let mut line = match serde_json::to_vec(&msg) {
            Ok(v) => v,
            Err(e) => {
                warn!(session = id.0, error = %e, "failed to serialize outbound");
                continue;
            }
        };
        line.push(b'\n');
        if let Err(e) = writer.write_all(&line).await {
            debug!(session = id.0, error = %e, "write failed, closing");
            break;
        }
    }
    debug!(session = id.0, "writer exited");
}
