//! Driver for an in-process embedded agent. Runs [`Agent::translate`]
//! against the kernel command bus — no socket, no wire encoding.

use crate::sdk::agent::{Agent, Event};
use crate::sdk::client::{Handle, Witness};
use crate::inference::wire::Message;
use tokio::sync::mpsc;
use tracing::warn;

use super::kernel::{Cmd, SessionId};

/// Drive one embedded agent to completion.
///
/// The caller is responsible for mounting `agent.claims()`; this
/// driver does not send them through the kernel (that path would
/// persist them to the event log).
pub async fn drive_embedded(
    agent: Box<dyn Agent>,
    id: SessionId,
    cmd_tx: mpsc::UnboundedSender<Cmd>,
) {
    let identity = agent.identity().to_owned();
    let subscriptions: Vec<String> = agent
        .subscriptions()
        .iter()
        .map(|s| (*s).to_owned())
        .collect();

    // Hub → agent events.
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<Message>();
    // Agent → hub asserts (forwarded into the kernel below).
    let (witness_tx, mut witness_rx) = mpsc::unbounded_channel::<Message>();

    if cmd_tx
        .send(Cmd::Connect {
            id,
            outbound: event_tx,
        })
        .is_err()
    {
        return;
    }

    if cmd_tx
        .send(Cmd::Message {
            id,
            msg: Message::Hello {
                agent: identity.clone(),
                version: env!("CARGO_PKG_VERSION").to_owned(),
                subscriptions,
            },
        })
        .is_err()
    {
        return;
    }

    let forward_cmd_tx = cmd_tx.clone();
    tokio::spawn(async move {
        while let Some(msg) = witness_rx.recv().await {
            if forward_cmd_tx.send(Cmd::Message { id, msg }).is_err() {
                break;
            }
        }
    });

    let handle = Handle::from_outbound(witness_tx);
    let witness: Witness = handle.into();

    while let Some(msg) = event_rx.recv().await {
        match msg {
            Message::Event { claim, derivation } => {
                let event = Event { claim, derivation };
                let claims = agent.translate(event, witness.clone()).await;
                for c in claims {
                    let assert = Message::Assert {
                        subject: c.subject,
                        predicate: c.predicate,
                        object: c.object,
                    };
                    if cmd_tx.send(Cmd::Message { id, msg: assert }).is_err() {
                        return;
                    }
                }
            }
            Message::Welcome { .. } => {}
            Message::Error { code, message } => {
                warn!(%code, %message, agent = %identity, "hub reported error");
            }
            _ => {}
        }
    }

    let _ = cmd_tx.send(Cmd::Disconnect { id });
}
