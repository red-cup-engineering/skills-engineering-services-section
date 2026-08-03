//! The hub-owned `.mash/` store: lock, event log, snapshot.
//!
//! A [`Store`] owns a `.mash/` directory. On [`Store::open`] it
//! acquires an exclusive `flock(2)` on `.mash/lock`; if the lock is
//! already held by a live process, the open fails. The hub is the
//! single writer.
//!
//! # WAL-first commit discipline
//!
//! A [`CommitBatch`] is the unit of durability. Typical use by the
//! hub:
//!
//! 1. Cascade runs to quiescence in memory, producing a set of
//!    settled claims plus derivation witnesses.
//! 2. The hub assembles a `CommitBatch` containing the triggering
//!    assertion and the witness records derived from the cascade.
//! 3. [`Store::commit`] appends every event in the batch to its
//!    channel file, `fsync`s each channel, optionally rewrites the
//!    snapshot, then `fsync`s the `.mash/` root.
//!
//! Invariant `I2` from `docs/bundle-layout.md`: the event log append
//! is durable before any snapshot rewrite. A crash between the two
//! leaves a log-authoritative state that boot can rebuild from.
//!
//! # Read side
//!
//! [`Store::read_events`] and [`Store::read_snapshot`] iterate their
//! respective files lazily. Designed for boot-time replay — open the
//! snapshot, open the kernel channel from `seq > cutoff`, feed every
//! event through cascade.

#![warn(missing_docs)]

use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use fs2::FileExt;
use crate::util::log::{
    decode_cell, decode_event, encode_cell, encode_event, AssertionRecord, CellRecord,
    ChannelName, EventRecord,
};
use tracing::{debug, warn};

/// An open `.mash/` directory. Holds the flock for as long as it
/// lives; drop the [`Store`] to release it.
pub struct Store {
    root: PathBuf,
    lock: File,
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Store")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

/// One channel's next-sequence counter, updated as events are
/// appended. The hub is single-writer so no coordination is needed
/// beyond the `Store`'s `&mut self`.
#[derive(Debug, Default, Clone)]
pub struct Cursor {
    /// The next `seq` value to assign on this channel.
    pub next_seq: u64,
}

/// A unit of durability: events to append, plus an optional snapshot
/// rewrite to perform after the events are durable.
pub struct CommitBatch {
    /// `(channel, event)` pairs to append in order. Each event's
    /// `seq` is expected to be monotonic per channel; the caller is
    /// responsible for assigning sequence numbers via [`Cursor`] or
    /// equivalent.
    pub events: Vec<(ChannelName, EventRecord)>,
    /// If present, the entire snapshot is rewritten to contain these
    /// cells. If absent, the snapshot file is left untouched and the
    /// caller is presumably doing event-only commits (e.g. when no
    /// cell value changed, which is possible for re-asserts that
    /// knowledge-join to the same value).
    pub snapshot: Option<Vec<CellRecord>>,
}

impl CommitBatch {
    /// An empty batch — commits nothing. Useful as a starting point
    /// for the hub to accumulate against.
    #[must_use]
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            snapshot: None,
        }
    }
}

impl Default for CommitBatch {
    fn default() -> Self {
        Self::new()
    }
}

/// Errors returned by the store.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// Filesystem I/O error.
    #[error("io: {0}")]
    Io(#[from] io::Error),
    /// Serialization error encoding an event or cell line.
    #[error("encode: {0}")]
    Encode(#[from] serde_json::Error),
    /// Another process holds the `.mash/lock` file.
    #[error("another hub holds the lock on {0}")]
    AlreadyLocked(PathBuf),
}

impl Store {
    /// Open a store at `root`. Creates the directory (and `events/`
    /// subdirectory) if absent, then acquires the exclusive lock.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::AlreadyLocked`] if another live process
    /// holds the lock, or [`StoreError::Io`] for any filesystem
    /// failure.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, StoreError> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        std::fs::create_dir_all(root.join("events"))?;

        let lock_path = root.join("lock");
        let lock = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&lock_path)?;

        match lock.try_lock_exclusive() {
            Ok(()) => {
                debug!(path = %root.display(), "acquired .mash/lock");
            }
            Err(_) => {
                return Err(StoreError::AlreadyLocked(lock_path));
            }
        }

        Ok(Self { root, lock })
    }

    /// The path this store was opened at.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Apply a batch atomically with respect to crash ordering: every
    /// event is appended and fsynced before any snapshot rewrite, so
    /// a crash between the two leaves a replayable log.
    ///
    /// # Errors
    ///
    /// I/O or serialization errors; partial state on error is
    /// recoverable from the event log.
    pub fn commit(&mut self, batch: &CommitBatch) -> Result<(), StoreError> {
        // 1-2. Append and fsync every event first, grouped by channel
        //      so each channel file is opened once per commit.
        let mut by_channel: std::collections::BTreeMap<&ChannelName, Vec<&EventRecord>> =
            std::collections::BTreeMap::new();
        for (ch, ev) in &batch.events {
            by_channel.entry(ch).or_default().push(ev);
        }
        for (ch, events) in by_channel {
            let path = ch.events_path(&self.root);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
            for ev in events {
                let line = encode_event(ev)?;
                f.write_all(line.as_bytes())?;
                f.write_all(b"\n")?;
            }
            f.sync_data()?;
        }

        // 3-4. Rewrite snapshot atomically (tmp + rename + fsync dir).
        if let Some(cells) = &batch.snapshot {
            self.rewrite_snapshot(cells)?;
        }

        // Fsync the `.mash/` directory so created channel files and
        // the renamed snapshot are durable.
        fsync_dir(&self.root)?;
        Ok(())
    }

    fn rewrite_snapshot(&self, cells: &[CellRecord]) -> Result<(), StoreError> {
        let final_path = self.root.join("snapshot.jsonl");
        let tmp_path = self.root.join("snapshot.jsonl.tmp");

        {
            let mut f = File::create(&tmp_path)?;
            for cell in cells {
                let line = encode_cell(cell)?;
                f.write_all(line.as_bytes())?;
                f.write_all(b"\n")?;
            }
            f.sync_data()?;
        }
        std::fs::rename(&tmp_path, &final_path)?;
        Ok(())
    }

    /// Read every event from one channel in file order.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Io`] for any I/O failure. Individual
    /// malformed lines are logged and skipped (to survive partial
    /// writes at the log tail after a crash), consistent with the
    /// prior `esm-predication` implementation.
    pub fn read_events(&self, channel: &ChannelName) -> Result<Vec<EventRecord>, StoreError> {
        let path = channel.events_path(&self.root);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let f = File::open(&path)?;
        let rdr = BufReader::new(f);
        let mut out = Vec::new();
        for (i, line) in rdr.lines().enumerate() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            match decode_event(&line) {
                Ok(ev) => out.push(ev),
                Err(e) => {
                    warn!(channel = channel.as_str(), line_number = i + 1, error = %e, "skipping malformed event line");
                }
            }
        }
        Ok(out)
    }

    /// Read every cell from the snapshot.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Io`] for any I/O failure. Malformed lines
    /// are skipped with a warning.
    pub fn read_snapshot(&self) -> Result<Vec<CellRecord>, StoreError> {
        let path = self.root.join("snapshot.jsonl");
        if !path.exists() {
            return Ok(Vec::new());
        }
        let f = File::open(&path)?;
        let rdr = BufReader::new(f);
        let mut out = Vec::new();
        for (i, line) in rdr.lines().enumerate() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            match decode_cell(&line) {
                Ok(c) => out.push(c),
                Err(e) => {
                    warn!(line_number = i + 1, error = %e, "skipping malformed snapshot line");
                }
            }
        }
        Ok(out)
    }

    /// Find the maximum `seq` currently on a channel. Useful for
    /// initializing a [`Cursor`].
    ///
    /// # Errors
    ///
    /// Returns [`StoreError::Io`] for any I/O failure.
    pub fn channel_tail_seq(&self, channel: &ChannelName) -> Result<u64, StoreError> {
        let events = self.read_events(channel)?;
        Ok(events.iter().map(|e| e.seq).max().unwrap_or(0))
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.lock);
    }
}

/// Convert an [`AssertionRecord`] to an [`EventRecord`] by attaching
/// channel-local metadata. Exposed so the hub (or tests) can build
/// event records without needing to know the internal field order.
#[must_use]
pub fn event_from(assertion: AssertionRecord, seq: u64, at: String) -> EventRecord {
    EventRecord::from_assertion(assertion, seq, at)
}

fn fsync_dir(path: &Path) -> io::Result<()> {
    // Open the directory and sync_data on it — this persists renames
    // and creations in it. On platforms that don't support
    // open-for-read on a directory (Windows), this silently no-ops.
    #[cfg(unix)]
    {
        let d = File::open(path)?;
        d.sync_data()?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::algebra::Value;
    use tempfile::tempdir;

    fn assertion(s: &str, p: &str, o: &str) -> AssertionRecord {
        AssertionRecord {
            s: s.into(),
            p: p.into(),
            o: o.into(),
        }
    }

    fn event(s: &str, p: &str, o: &str, seq: u64) -> EventRecord {
        EventRecord::from_assertion(assertion(s, p, o), seq, "2026-04-18T17:00:00.000Z".into())
    }

    fn cell(s: &str, p: &str, o: &str, v: Value) -> CellRecord {
        CellRecord {
            s: s.into(),
            p: p.into(),
            o: o.into(),
            v,
        }
    }

    #[test]
    fn open_creates_directory_and_lock_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".mash");
        let store = Store::open(&path).unwrap();
        assert!(path.is_dir());
        assert!(path.join("events").is_dir());
        assert!(path.join("lock").is_file());
        drop(store);
    }

    #[test]
    fn second_open_on_held_store_fails() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".mash");
        let _store = Store::open(&path).unwrap();
        let err = Store::open(&path).unwrap_err();
        assert!(matches!(err, StoreError::AlreadyLocked(_)));
    }

    #[test]
    fn after_drop_another_open_succeeds() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".mash");
        {
            let _store = Store::open(&path).unwrap();
        }
        let _store2 = Store::open(&path).unwrap();
    }

    #[test]
    fn commit_appends_events_and_writes_snapshot() {
        let dir = tempdir().unwrap();
        let mut store = Store::open(dir.path().join(".mash")).unwrap();

        let batch = CommitBatch {
            events: vec![
                (ChannelName::kernel(), event("a", "is-a", "thing", 1)),
                (ChannelName::kernel(), event("b", "is-a", "thing", 2)),
            ],
            snapshot: Some(vec![
                cell("a", "is-a", "thing", Value::True),
                cell("b", "is-a", "thing", Value::True),
            ]),
        };
        store.commit(&batch).unwrap();

        let events = store.read_events(&ChannelName::kernel()).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].seq, 1);
        assert_eq!(events[1].s, "b");

        let cells = store.read_snapshot().unwrap();
        assert_eq!(cells.len(), 2);
        assert_eq!(cells[1].v, Value::True);
    }

    #[test]
    fn snapshot_rewrite_is_atomic_via_rename() {
        let dir = tempdir().unwrap();
        let root = dir.path().join(".mash");
        let mut store = Store::open(&root).unwrap();

        store
            .commit(&CommitBatch {
                events: vec![],
                snapshot: Some(vec![cell("a", "is-a", "thing", Value::True)]),
            })
            .unwrap();

        // First snapshot on disk.
        let first = std::fs::read_to_string(root.join("snapshot.jsonl")).unwrap();
        assert!(first.contains(r#""s":"a""#));

        // Rewriting replaces the file; no tmp file lingers.
        store
            .commit(&CommitBatch {
                events: vec![],
                snapshot: Some(vec![cell("b", "is-a", "thing", Value::True)]),
            })
            .unwrap();
        let second = std::fs::read_to_string(root.join("snapshot.jsonl")).unwrap();
        assert!(second.contains(r#""s":"b""#));
        assert!(!second.contains(r#""s":"a""#));
        assert!(!root.join("snapshot.jsonl.tmp").exists());
    }

    #[test]
    fn channel_tail_seq_reports_max() {
        let dir = tempdir().unwrap();
        let mut store = Store::open(dir.path().join(".mash")).unwrap();
        store
            .commit(&CommitBatch {
                events: vec![
                    (ChannelName::kernel(), event("a", "p", "o", 5)),
                    (ChannelName::kernel(), event("b", "p", "o", 17)),
                    (ChannelName::kernel(), event("c", "p", "o", 9)),
                ],
                snapshot: None,
            })
            .unwrap();
        assert_eq!(store.channel_tail_seq(&ChannelName::kernel()).unwrap(), 17);
    }

    #[test]
    fn multiple_channels_are_isolated() {
        let dir = tempdir().unwrap();
        let mut store = Store::open(dir.path().join(".mash")).unwrap();
        let sessions = ChannelName::new("channel:sessions").unwrap();

        store
            .commit(&CommitBatch {
                events: vec![
                    (ChannelName::kernel(), event("a", "p", "o", 1)),
                    (sessions.clone(), event("s", "opens", "t", 1)),
                ],
                snapshot: None,
            })
            .unwrap();

        assert_eq!(store.read_events(&ChannelName::kernel()).unwrap().len(), 1);
        assert_eq!(store.read_events(&sessions).unwrap().len(), 1);
    }

    #[test]
    fn empty_store_reads_as_empty() {
        let dir = tempdir().unwrap();
        let store = Store::open(dir.path().join(".mash")).unwrap();
        assert!(store.read_snapshot().unwrap().is_empty());
        assert!(store.read_events(&ChannelName::kernel()).unwrap().is_empty());
        assert_eq!(store.channel_tail_seq(&ChannelName::kernel()).unwrap(), 0);
    }

    #[test]
    fn malformed_log_lines_are_skipped() {
        let dir = tempdir().unwrap();
        let root = dir.path().join(".mash");
        let mut store = Store::open(&root).unwrap();
        store
            .commit(&CommitBatch {
                events: vec![(ChannelName::kernel(), event("a", "p", "o", 1))],
                snapshot: None,
            })
            .unwrap();

        // Append a partial / corrupt line directly (simulating a crash
        // mid-append).
        let path = ChannelName::kernel().events_path(&root);
        let mut f = OpenOptions::new().append(true).open(path).unwrap();
        writeln!(f, "{{not-valid").unwrap();

        let events = store.read_events(&ChannelName::kernel()).unwrap();
        assert_eq!(events.len(), 1);
    }
}
