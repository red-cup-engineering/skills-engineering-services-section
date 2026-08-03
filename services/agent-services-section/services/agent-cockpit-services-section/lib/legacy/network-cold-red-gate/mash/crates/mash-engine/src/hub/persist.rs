//! Glue between the hub kernel and the on-disk store.
//!
//! Wraps a [`crate::util::store::Store`] with the sequence cursor the kernel
//! needs to assign event numbers on the kernel channel. Exposes two
//! operations:
//!
//! - [`Persistence::replay`] — drains every event on the kernel
//!   channel through [`Semiotics::assert`], rebuilding substrate state
//!   (including morphism installations from trigger-predicate events).
//!   Called once, before the kernel accepts any sockets.
//!
//! - [`Persistence::record_assertion`] — appends one event to the
//!   kernel channel and fsyncs. Called by the kernel after each
//!   externally-sourced [`Message::Assert`]. Hello-handshake side
//!   effects and other internally-generated assertions are *not*
//!   persisted — they are session-local and re-established on each
//!   connection.

use std::path::Path;

use anyhow::{Context, Result};
use crate::util::log::{AssertionRecord, ChannelName, EventRecord};
use crate::util::store::{CommitBatch, Store};
use crate::inference::time::now_iso8601;

/// Opened `.mash/` store plus the kernel-channel cursor.
pub struct Persistence {
    store: Store,
    kernel_seq: u64,
}

impl Persistence {
    /// Open `root` as a `.mash/` store and read the current kernel
    /// cursor.
    ///
    /// # Errors
    ///
    /// Returns any error from [`Store::open`] or from reading the
    /// existing kernel channel.
    pub fn open(root: &Path) -> Result<Self> {
        let store = Store::open(root.to_path_buf())
            .with_context(|| format!("open .mash/ store at {}", root.display()))?;
        let kernel_seq = store
            .channel_tail_seq(&ChannelName::kernel())
            .context("read kernel channel tail")?;
        Ok(Self { store, kernel_seq })
    }

    /// Drain every event on the kernel channel through
    /// `f(&AssertionRecord)`. The caller applies each assertion to
    /// substrate state.
    ///
    /// # Errors
    ///
    /// Returns any error from reading the event log or from the
    /// provided closure.
    pub fn replay<F>(&self, mut f: F) -> Result<usize>
    where
        F: FnMut(&AssertionRecord) -> Result<()>,
    {
        let events = self
            .store
            .read_events(&ChannelName::kernel())
            .context("read kernel channel for replay")?;
        let n = events.len();
        for ev in events {
            let assertion = ev.assertion();
            f(&assertion).with_context(|| {
                format!(
                    "replay assertion seq={} ({}, {}, {})",
                    ev.seq, ev.s, ev.p, ev.o
                )
            })?;
        }
        Ok(n)
    }

    /// Append the triggering assertion plus any witness records
    /// produced by the cascade it drove, in a single atomic batch.
    ///
    /// One `fsync` per cascade-commit rather than one per event. If
    /// `witnesses` is empty (i.e. the assertion settled without
    /// derivation), this is equivalent to appending just the trigger.
    ///
    /// # Errors
    ///
    /// Returns any error from [`Store::commit`].
    pub fn record_commit(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
        witnesses: &[AssertionRecord],
    ) -> Result<()> {
        let at = now_iso8601();
        let mut events: Vec<(ChannelName, EventRecord)> = Vec::with_capacity(1 + witnesses.len());

        self.kernel_seq += 1;
        events.push((
            ChannelName::kernel(),
            EventRecord {
                s: subject.to_owned(),
                p: predicate.to_owned(),
                o: object.to_owned(),
                seq: self.kernel_seq,
                at: at.clone(),
            },
        ));
        for w in witnesses {
            self.kernel_seq += 1;
            events.push((
                ChannelName::kernel(),
                EventRecord {
                    s: w.s.clone(),
                    p: w.p.clone(),
                    o: w.o.clone(),
                    seq: self.kernel_seq,
                    at: at.clone(),
                },
            ));
        }

        self.store
            .commit(&CommitBatch {
                events,
                snapshot: None,
            })
            .with_context(|| {
                format!(
                    "record commit ({subject}, {predicate}, {object}) + {} witnesses",
                    witnesses.len()
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn record_and_replay_round_trip() {
        let dir = tempdir().unwrap();
        let root = dir.path().join(".mash");

        {
            let mut p = Persistence::open(&root).unwrap();
            p.record_commit("a", "is-a", "thing", &[]).unwrap();
            p.record_commit("b", "is-a", "thing", &[]).unwrap();
            p.record_commit("c", "is-a", "thing", &[]).unwrap();
        }

        let p = Persistence::open(&root).unwrap();
        let mut seen: Vec<(String, String, String)> = Vec::new();
        p.replay(|assertion| {
            seen.push((
                assertion.s.clone(),
                assertion.p.clone(),
                assertion.o.clone(),
            ));
            Ok(())
        })
        .unwrap();

        assert_eq!(
            seen,
            vec![
                ("a".into(), "is-a".into(), "thing".into()),
                ("b".into(), "is-a".into(), "thing".into()),
                ("c".into(), "is-a".into(), "thing".into()),
            ]
        );
    }

    #[test]
    fn seq_continues_after_reopen() {
        let dir = tempdir().unwrap();
        let root = dir.path().join(".mash");

        {
            let mut p = Persistence::open(&root).unwrap();
            p.record_commit("a", "p", "o", &[]).unwrap();
            p.record_commit("b", "p", "o", &[]).unwrap();
        }

        {
            let mut p = Persistence::open(&root).unwrap();
            p.record_commit("c", "p", "o", &[]).unwrap();
        }

        let p = Persistence::open(&root).unwrap();
        let mut count = 0;
        p.replay(|_| {
            count += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(count, 3);
        assert_eq!(p.kernel_seq, 3);
    }

    #[test]
    fn record_commit_persists_witnesses_alongside_trigger() {
        let dir = tempdir().unwrap();
        let root = dir.path().join(".mash");
        {
            let mut p = Persistence::open(&root).unwrap();
            let witnesses = vec![
                AssertionRecord {
                    s: "hash-x".into(),
                    p: "derived-via".into(),
                    o: "inversion".into(),
                },
                AssertionRecord {
                    s: "hash-x".into(),
                    p: "derived-from".into(),
                    o: "hash-y".into(),
                },
            ];
            p.record_commit("a", "src", "b", &witnesses).unwrap();
        }

        let p = Persistence::open(&root).unwrap();
        let mut seen: Vec<(String, String, String)> = Vec::new();
        p.replay(|a| {
            seen.push((a.s.clone(), a.p.clone(), a.o.clone()));
            Ok(())
        })
        .unwrap();

        assert_eq!(seen.len(), 3);
        assert_eq!(seen[0], ("a".into(), "src".into(), "b".into()));
        assert!(seen.contains(&("hash-x".into(), "derived-via".into(), "inversion".into())));
        assert!(seen.contains(&("hash-x".into(), "derived-from".into(), "hash-y".into())));
    }

    #[test]
    fn lock_held_while_persistence_alive() {
        let dir = tempdir().unwrap();
        let root = dir.path().join(".mash");
        let _p = Persistence::open(&root).unwrap();
        assert!(Persistence::open(&root).is_err());
    }
}
