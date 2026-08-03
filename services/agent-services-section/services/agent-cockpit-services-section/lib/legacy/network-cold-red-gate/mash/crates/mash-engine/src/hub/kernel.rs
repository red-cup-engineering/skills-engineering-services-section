//! The kernel state machine.
//!
//! [`Hub`] owns the [`Semiotics`] and all per-session state. It is
//! driven by [`Cmd`] messages pulled from a single channel — no
//! mutation happens anywhere else in the daemon. That gives us the
//! single-writer invariant the cascade relies on for its ≤2-step
//! termination guarantee.

use crate::algebra::Value;
use crate::inference::time::now_iso8601;
use crate::inference::wire::{DerivationRecord, Message, WireClaim};
use crate::proof::{Claim, DerivationStep, SemiosisTrace, Semiotics, TermId};
use std::collections::{HashMap, HashSet};
use tokio::sync::mpsc;
use tracing::{error, warn};

use super::persist::Persistence;
use super::witness::witnesses_of;

/// Opaque per-connection identifier, assigned by the accept loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionId(pub u64);

/// Commands processed by the kernel loop.
///
/// All three connection lifecycle events are modelled explicitly so
/// the kernel never has to peek at underlying I/O state.
#[derive(Debug)]
pub enum Cmd {
    /// A new connection was accepted. `outbound` is how the kernel
    /// sends messages back to the client.
    Connect {
        /// Session identifier assigned by the accept loop.
        id: SessionId,
        /// Channel for outbound messages to this session.
        outbound: mpsc::UnboundedSender<Message>,
    },
    /// A decoded message arrived on this session.
    Message {
        /// Session that produced the message.
        id: SessionId,
        /// The decoded message.
        msg: Message,
    },
    /// The connection closed (EOF, error, or clean shutdown).
    Disconnect {
        /// Session that went away.
        id: SessionId,
    },
}

/// The kernel state machine.
pub struct Hub {
    substrate: Semiotics,
    sessions: HashMap<SessionId, Session>,
    /// Reverse index: predicate → sessions subscribed to it.
    by_predicate: HashMap<TermId, HashSet<SessionId>>,
    /// If set, externally-sourced assertions (from `Message::Assert`)
    /// are appended to the kernel channel before broadcasting.
    /// Session-local side effects (Hello handshake, subscribe) are
    /// *not* persisted — they are re-established on reconnect.
    persistence: Option<Persistence>,
}

struct Session {
    outbound: mpsc::UnboundedSender<Message>,
    subscriptions: HashSet<TermId>,
}

impl Hub {
    /// Wrap a `substrate` in a fresh kernel. The kernel owns the
    /// substrate from this point on; no other handle may mutate it.
    ///
    /// Callers typically mount owner-agent `claims()` into the
    /// `Semiotics` *before* wrapping it — the kernel won't persist
    /// those baseline claims, but they're visible to every session
    /// through fiber replay.
    #[must_use]
    pub fn new(substrate: Semiotics) -> Self {
        Self {
            substrate,
            sessions: HashMap::new(),
            by_predicate: HashMap::new(),
            persistence: None,
        }
    }

    /// Attach (or clear) the persistence handle for this kernel.
    ///
    /// Call once at boot, before [`run`](Self::run) starts
    /// processing commands. With persistence attached, externally-
    /// sourced assertions are journaled to `.mash/` before being
    /// broadcast to subscribers; with `None`, the substrate runs
    /// ephemerally (tests, scratch scenarios).
    pub fn set_persistence(&mut self, persistence: Option<Persistence>) {
        self.persistence = persistence;
    }

    /// Run the single-writer command loop until `rx` closes.
    ///
    /// Consumes each [`Cmd`] in order — connect, message,
    /// disconnect — and applies it under the single-writer
    /// invariant that the cascade's termination guarantee relies on.
    /// Return only happens when every sender of the command channel
    /// is dropped, typically at process shutdown.
    pub async fn run(&mut self, mut rx: mpsc::UnboundedReceiver<Cmd>) {
        while let Some(cmd) = rx.recv().await {
            self.handle(cmd);
        }
    }


    /// Apply a single command synchronously. Useful in tests that
    /// want to drive the kernel without spinning up the async loop;
    /// the production entry point is [`run`](Self::run).
    pub fn handle(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Connect { id, outbound } => self.on_connect(id, outbound),
            Cmd::Disconnect { id } => self.on_disconnect(id),
            Cmd::Message { id, msg } => self.on_message(id, msg),
        }
    }

    fn on_connect(&mut self, id: SessionId, outbound: mpsc::UnboundedSender<Message>) {
        self.sessions.insert(
            id,
            Session {
                outbound,
                subscriptions: HashSet::new(),
            },
        );
    }

    fn on_disconnect(&mut self, id: SessionId) {
        if let Some(session) = self.sessions.remove(&id) {
            for pred in session.subscriptions {
                if let Some(subs) = self.by_predicate.get_mut(&pred) {
                    subs.remove(&id);
                    if subs.is_empty() {
                        self.by_predicate.remove(&pred);
                    }
                }
            }
        }
    }

    fn on_message(&mut self, id: SessionId, msg: Message) {
        match msg {
            Message::Hello {
                agent: driver,
                version,
                subscriptions: services,
            } => {
                let session_subject = format!("s{}", id.0);
                // Fold the driver's self-description into the substrate.
                // - The session speaks by the driver (subject=session,
                //   predicate=speaks, object=driver-name).
                // - The driver itself is witnessed by its version
                //   (subject=driver-name, predicate=version,
                //   object=version-string).
                // - Each declared service is a driver-fiber cell on
                //   the driver's subject, witnessed by the predicate
                //   it serves; `(driver, specialization, service)`
                //   from the ops bundle lifts it into the service
                //   fiber, preserving the service-predicate as
                //   witness.
                self.apply_assert(&session_subject, "projects-through", &driver);
                self.apply_assert(&driver, "has-version", &version);
                // Welcome must land before any fiber-replay events,
                // otherwise the client's handshake reader sees an
                // Event where it expected Welcome and errors. Send
                // Welcome first, then subscribe (which replays).
                self.send(
                    id,
                    Message::Welcome {
                        session: session_subject,
                    },
                );
                for pred_name in &services {
                    self.apply_assert(&driver, "driver", pred_name);
                    self.subscribe(id, pred_name);
                }
            }
            Message::Subscribe { predicate } => {
                self.subscribe(id, &predicate);
            }
            Message::Assert {
                subject,
                predicate,
                object,
            } => {
                self.commit_externally_sourced(&subject, &predicate, &object);
            }
            Message::Welcome { .. } | Message::Event { .. } => {
                self.send(
                    id,
                    Message::Error {
                        code: "protocol".into(),
                        message: "client may not send server-origin messages".into(),
                    },
                );
            }
            Message::Error { code, message } => {
                warn!(session = id.0, %code, %message, "driver reported error");
            }
        }
    }

    fn subscribe(&mut self, id: SessionId, predicate: &str) {
        let pred = self.substrate.intern(predicate);
        if let Some(session) = self.sessions.get_mut(&id) {
            session.subscriptions.insert(pred);
        }
        self.by_predicate.entry(pred).or_default().insert(id);
        // Replay the fiber's current state to the fresh subscriber.
        // Bundle-mounted cells never enter the event log, so agents
        // that need to see them have no alternative to this: without
        // replay, a `has-default-spawn` declared by a bundle at boot
        // would never reach an agent that connected later. Cells are
        // delivered as `Event` messages with an empty derivation (the
        // broadcast-side WireClaim wrapping is identical to a fresh
        // settlement, minus the derivation chain, which is already
        // empty for directly-asserted claims).
        let cells: Vec<(TermId, TermId, Value)> = self.substrate.fiber(pred).collect();
        for (s, o, v) in cells {
            let claim = Claim {
                subject: s,
                predicate: pred,
                object: o,
                value: v,
            };
            let wire_claim = self.wire_claim(&claim);
            if let Some(session) = self.sessions.get(&id) {
                let _ = session.outbound.send(Message::Event {
                    claim: wire_claim,
                    derivation: Vec::new(),
                });
            }
        }
    }

    /// Intern SPO and assert the claim with implicit [`Value::True`],
    /// returning the resulting cascade trace. Persistence and
    /// broadcast are the caller's responsibility; this method is the
    /// shared core used by both externally-sourced assertions
    /// ([`Message::Assert`]) and session-local handshake claims.
    fn assert_into_substrate(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
    ) -> SemiosisTrace {
        let s = self.substrate.intern(subject);
        let p = self.substrate.intern(predicate);
        let o = self.substrate.intern(object);
        self.substrate.assert(Claim {
            subject: s,
            predicate: p,
            object: o,
            value: Value::True,
        })
    }

    /// Session-local assertion: assert + broadcast, no persistence.
    /// Used by the Hello handshake (projects-through, has-version,
    /// driver) which references per-session subjects that have no
    /// meaning after the session ends.
    fn apply_assert(&mut self, subject: &str, predicate: &str, object: &str) {
        let trace = self.assert_into_substrate(subject, predicate, object);
        self.broadcast(&trace);
    }

    /// Full commit path for an externally-sourced assertion: cascade,
    /// witness, persist, run projectors + dispatchers, broadcast,
    /// and re-enter for each emitted assertion so answers and
    /// dispatched effects take the same path.
    fn commit_externally_sourced(&mut self, subject: &str, predicate: &str, object: &str) {
        let trace = self.assert_into_substrate(subject, predicate, object);

        if let Some(p) = self.persistence.as_mut() {
            let witnesses = witnesses_of(&trace, self.substrate.interner());
            if let Err(e) = p.record_commit(subject, predicate, object, &witnesses) {
                error!(
                    error = %e,
                    "failed to persist commit; substrate will diverge from log"
                );
            }
        }

        self.broadcast(&trace);
    }

    fn broadcast(&self, report: &SemiosisTrace) {
        for settled in &report.settled {
            let wire_claim = self.wire_claim(&settled.claim);
            let derivation: Vec<DerivationRecord> = settled
                .derivation
                .iter()
                .map(|step| self.wire_derivation(step))
                .collect();
            let Some(subs) = self.by_predicate.get(&settled.claim.predicate) else {
                continue;
            };
            for &sid in subs {
                if let Some(session) = self.sessions.get(&sid) {
                    let msg = Message::Event {
                        claim: wire_claim.clone(),
                        derivation: derivation.clone(),
                    };
                    let _ = session.outbound.send(msg);
                }
            }
        }
    }

    fn wire_claim(&self, c: &Claim) -> WireClaim {
        WireClaim {
            subject: self.term(c.subject),
            predicate: self.term(c.predicate),
            object: self.term(c.object),
            value: c.value,
            timestamp: now_iso8601(),
        }
    }

    fn wire_derivation(&self, step: &DerivationStep) -> DerivationRecord {
        DerivationRecord {
            via: step.via,
            premises: step.premises.iter().map(|c| self.wire_claim(c)).collect(),
        }
    }

    fn term(&self, id: TermId) -> String {
        self.substrate.term(id).unwrap_or("").to_owned()
    }

    fn send(&self, id: SessionId, msg: Message) {
        if let Some(session) = self.sessions.get(&id) {
            let _ = session.outbound.send(msg);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain(rx: &mut mpsc::UnboundedReceiver<Message>) -> Vec<Message> {
        let mut out = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            out.push(msg);
        }
        out
    }

    #[test]
    fn hello_responds_with_welcome_and_subscribes_to_services() {
        let mut kernel = Hub::new(Semiotics::new());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sid = SessionId(42);
        kernel.handle(Cmd::Connect {
            id: sid,
            outbound: tx,
        });
        kernel.handle(Cmd::Message {
            id: sid,
            msg: Message::Hello {
                agent: "test".into(),
                version: "0.0".into(),
                subscriptions: vec!["op:tick".into()],
            },
        });
        let msgs = drain(&mut rx);
        assert!(matches!(msgs.first(), Some(Message::Welcome { session }) if session == "s42"));
        kernel.handle(Cmd::Message {
            id: sid,
            msg: Message::Assert {
                subject: "s".into(),
                predicate: "op:tick".into(),
                object: "o".into(),
            },
        });
        let msgs = drain(&mut rx);
        assert_eq!(msgs.len(), 1);
        let Message::Event { claim, .. } = &msgs[0] else {
            panic!("expected Event, got {:?}", msgs[0])
        };
        assert_eq!(claim.predicate, "op:tick");
        assert_eq!(claim.value, Value::True);
    }

    #[test]
    fn non_subscribers_do_not_receive_events() {
        let mut kernel = Hub::new(Semiotics::new());
        let (tx_a, mut rx_a) = mpsc::unbounded_channel();
        let (tx_b, mut rx_b) = mpsc::unbounded_channel();
        let a = SessionId(1);
        let b = SessionId(2);
        kernel.handle(Cmd::Connect {
            id: a,
            outbound: tx_a,
        });
        kernel.handle(Cmd::Connect {
            id: b,
            outbound: tx_b,
        });
        kernel.handle(Cmd::Message {
            id: a,
            msg: Message::Subscribe {
                predicate: "p".into(),
            },
        });
        // Client B asserts; only A (subscriber) should see Event.
        kernel.handle(Cmd::Message {
            id: b,
            msg: Message::Assert {
                subject: "s".into(),
                predicate: "p".into(),
                object: "o".into(),
            },
        });
        let a_msgs = drain(&mut rx_a);
        let b_msgs = drain(&mut rx_b);
        assert_eq!(a_msgs.len(), 1);
        assert!(b_msgs.is_empty());
    }

    #[test]
    fn disconnect_removes_subscriptions() {
        let mut kernel = Hub::new(Semiotics::new());
        let (tx, _rx) = mpsc::unbounded_channel();
        let sid = SessionId(7);
        kernel.handle(Cmd::Connect {
            id: sid,
            outbound: tx,
        });
        kernel.handle(Cmd::Message {
            id: sid,
            msg: Message::Subscribe {
                predicate: "p".into(),
            },
        });
        assert!(!kernel.by_predicate.is_empty());
        kernel.handle(Cmd::Disconnect { id: sid });
        assert!(kernel.by_predicate.is_empty());
        assert!(!kernel.sessions.contains_key(&sid));
    }

    #[test]
    fn server_origin_message_from_client_yields_error() {
        let mut kernel = Hub::new(Semiotics::new());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sid = SessionId(9);
        kernel.handle(Cmd::Connect {
            id: sid,
            outbound: tx,
        });
        kernel.handle(Cmd::Message {
            id: sid,
            msg: Message::Welcome {
                session: "bogus".into(),
            },
        });
        let msgs = drain(&mut rx);
        assert!(matches!(msgs.first(), Some(Message::Error { .. })));
    }
}
