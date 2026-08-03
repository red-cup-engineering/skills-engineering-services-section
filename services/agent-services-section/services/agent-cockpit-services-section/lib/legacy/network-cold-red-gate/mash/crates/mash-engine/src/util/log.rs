//! On-disk record types for MASH persistence.
//!
//! Two JSONL shapes, one per line of their respective files:
//!
//! - [`AssertionRecord`] — the shape of a bundle claim line and an
//!   event-log entry's payload. Three fields: `s`, `p`, `o`. Value is
//!   implicitly `true`; clients and bundles never assert non-`true`
//!   values (cascade produces those as derivations).
//! - [`EventRecord`] — an assertion plus per-event metadata (`seq`,
//!   `at`). One per line of `.mash/events/<channel>.jsonl`.
//! - [`CellRecord`] — the current state of a cell in the substrate.
//!   Four fields: `s`, `p`, `o`, `v`. One per line of
//!   `.mash/snapshot.jsonl`. Derived cells (non-`true` values) appear
//!   here but never on the wire.
//!
//! The crate is I/O-free: it defines the records, their JSONL
//! serialization, and the channel-file path conventions. The hub
//! writer (future task) owns the actual append-and-fsync discipline.

#![warn(missing_docs)]

use crate::algebra::Value;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A bundle claim line or the payload of an event log entry. SPO
/// only — assertions carry no value on the wire or in bundles.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssertionRecord {
    /// Subject.
    pub s: String,
    /// Predicate.
    pub p: String,
    /// Object.
    pub o: String,
}

/// One line of an event-log channel file. Carries an assertion plus
/// the event's position and wall-clock time.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventRecord {
    /// Subject.
    pub s: String,
    /// Predicate.
    pub p: String,
    /// Object.
    pub o: String,
    /// Monotonic sequence number within this channel.
    pub seq: u64,
    /// ISO-8601 timestamp with millisecond precision, UTC. Stored as
    /// a string rather than a typed time so the log file stays
    /// trivially readable under `cat`.
    pub at: String,
}

impl EventRecord {
    /// Construct an event from an assertion and channel-local metadata.
    #[must_use]
    pub fn from_assertion(assertion: AssertionRecord, seq: u64, at: String) -> Self {
        Self {
            s: assertion.s,
            p: assertion.p,
            o: assertion.o,
            seq,
            at,
        }
    }

    /// Drop the per-event metadata to recover the underlying assertion.
    #[must_use]
    pub fn assertion(&self) -> AssertionRecord {
        AssertionRecord {
            s: self.s.clone(),
            p: self.p.clone(),
            o: self.o.clone(),
        }
    }
}

/// One line of `.mash/snapshot.jsonl`. The current bilattice value of
/// a cell, after cascade has run to quiescence on all events up to
/// the snapshot's cutoff.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CellRecord {
    /// Subject.
    pub s: String,
    /// Predicate.
    pub p: String,
    /// Object.
    pub o: String,
    /// Current bilattice value.
    pub v: Value,
}

/// A JSONL channel name — a string that is also a subject in the
/// substrate (e.g. `"channel:kernel"`, `"channel:sessions"`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ChannelName(String);

impl ChannelName {
    /// The kernel channel carries hub-generated events: assertions
    /// committed by the hub, witness records from cascade, and
    /// snapshot-at checkpoints.
    pub const KERNEL: &'static str = "channel:kernel";

    /// Create a channel name. Channel names are conventionally
    /// `channel:<local>` (colon prefix), but no validation is
    /// performed here — any non-empty string is accepted.
    ///
    /// # Errors
    ///
    /// Returns [`ChannelError::Empty`] if `name` is empty.
    pub fn new(name: impl Into<String>) -> Result<Self, ChannelError> {
        let name = name.into();
        if name.is_empty() {
            return Err(ChannelError::Empty);
        }
        Ok(Self(name))
    }

    /// The kernel channel.
    #[must_use]
    pub fn kernel() -> Self {
        Self(Self::KERNEL.to_owned())
    }

    /// The channel name as a string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The file-system path at which this channel's events live,
    /// relative to a `.mash/` root. Channel names `channel:<local>`
    /// map to `events/<local>.jsonl`; channel names without the
    /// `channel:` prefix are used verbatim as the file stem.
    #[must_use]
    pub fn events_path(&self, mash_root: &Path) -> PathBuf {
        let stem = self.0.strip_prefix("channel:").unwrap_or(&self.0);
        mash_root.join("events").join(format!("{stem}.jsonl"))
    }
}

/// Error returned from [`ChannelName::new`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ChannelError {
    /// Channel name was empty.
    #[error("channel name must be non-empty")]
    Empty,
}

/// Encode an event as a JSONL line (no trailing newline; caller
/// appends `\n` when writing to a file).
///
/// # Errors
///
/// Returns any [`serde_json::Error`] raised during serialization.
pub fn encode_event(event: &EventRecord) -> Result<String, serde_json::Error> {
    serde_json::to_string(event)
}

/// Decode one JSONL line into an [`EventRecord`]. The line must not
/// include a trailing newline.
///
/// # Errors
///
/// Returns any [`serde_json::Error`] raised during deserialization.
pub fn decode_event(line: &str) -> Result<EventRecord, serde_json::Error> {
    serde_json::from_str(line)
}

/// Encode an assertion as a JSONL line.
///
/// # Errors
///
/// Returns any [`serde_json::Error`] raised during serialization.
pub fn encode_assertion(assertion: &AssertionRecord) -> Result<String, serde_json::Error> {
    serde_json::to_string(assertion)
}

/// Decode one JSONL line into an [`AssertionRecord`].
///
/// # Errors
///
/// Returns any [`serde_json::Error`] raised during deserialization.
pub fn decode_assertion(line: &str) -> Result<AssertionRecord, serde_json::Error> {
    serde_json::from_str(line)
}

/// Encode a cell as a JSONL line.
///
/// # Errors
///
/// Returns any [`serde_json::Error`] raised during serialization.
pub fn encode_cell(cell: &CellRecord) -> Result<String, serde_json::Error> {
    serde_json::to_string(cell)
}

/// Decode one JSONL line into a [`CellRecord`].
///
/// # Errors
///
/// Returns any [`serde_json::Error`] raised during deserialization.
pub fn decode_cell(line: &str) -> Result<CellRecord, serde_json::Error> {
    serde_json::from_str(line)
}

/// The predicate used for snapshot-at checkpoint events on the kernel
/// channel. A checkpoint event has
/// `(s=channel:kernel, p=snapshot-at, o=seq:<N>)`, meaning: the
/// snapshot on disk reflects substrate state at sequence `N` of the
/// kernel channel.
pub const SNAPSHOT_AT: &str = "snapshot-at";

/// Build a snapshot-at checkpoint event.
#[must_use]
pub fn snapshot_at_event(seq_cutoff: u64, event_seq: u64, at: String) -> EventRecord {
    EventRecord {
        s: ChannelName::KERNEL.to_owned(),
        p: SNAPSHOT_AT.to_owned(),
        o: format!("seq:{seq_cutoff}"),
        seq: event_seq,
        at,
    }
}

/// Parse a `seq:<N>` object back into the cutoff number it encodes.
/// Useful when reading snapshot-at events off disk.
///
/// # Errors
///
/// Returns [`CutoffError`] if the input does not start with `seq:` or
/// if the numeric portion does not parse.
pub fn parse_seq_cutoff(object: &str) -> Result<u64, CutoffError> {
    let rest = object
        .strip_prefix("seq:")
        .ok_or_else(|| CutoffError::MissingPrefix(object.to_owned()))?;
    rest.parse::<u64>()
        .map_err(|_| CutoffError::BadNumber(rest.to_owned()))
}

/// Error returned from [`parse_seq_cutoff`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CutoffError {
    /// Object string did not start with `seq:`.
    #[error("expected seq:<N>, got {0:?}")]
    MissingPrefix(String),
    /// Object string had `seq:` prefix but the remainder did not parse.
    #[error("not a valid sequence number: {0:?}")]
    BadNumber(String),
}

/// Convert an [`AssertionRecord`] into a [`crate::util::hash::ClaimRef`] for
/// hashing. Treats the value as [`Value::True`] since assertions
/// never carry a value.
#[must_use]
pub fn assertion_as_claim_ref(assertion: &AssertionRecord) -> crate::util::hash::ClaimRef<'_> {
    crate::util::hash::ClaimRef {
        subject: &assertion.s,
        predicate: &assertion.p,
        object: &assertion.o,
        value: Value::True,
    }
}

/// Convert a [`CellRecord`] into a [`crate::util::hash::ClaimRef`] for hashing.
#[must_use]
pub fn cell_as_claim_ref(cell: &CellRecord) -> crate::util::hash::ClaimRef<'_> {
    crate::util::hash::ClaimRef {
        subject: &cell.s,
        predicate: &cell.p,
        object: &cell.o,
        value: cell.v,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_assertion() -> AssertionRecord {
        AssertionRecord {
            s: "agent:shell".into(),
            p: "is-a".into(),
            o: "service".into(),
        }
    }

    fn sample_cell() -> CellRecord {
        CellRecord {
            s: "agent:shell".into(),
            p: "is-a".into(),
            o: "service".into(),
            v: Value::True,
        }
    }

    #[test]
    fn assertion_round_trips_as_jsonl() {
        let line = encode_assertion(&sample_assertion()).unwrap();
        assert_eq!(line, r#"{"s":"agent:shell","p":"is-a","o":"service"}"#);
        assert_eq!(decode_assertion(&line).unwrap(), sample_assertion());
    }

    #[test]
    fn event_round_trips_as_jsonl() {
        let event = EventRecord::from_assertion(sample_assertion(), 42, "2026-04-18T17:00:00.000Z".into());
        let line = encode_event(&event).unwrap();
        assert_eq!(decode_event(&line).unwrap(), event);
    }

    #[test]
    fn cell_round_trips_as_jsonl() {
        let line = encode_cell(&sample_cell()).unwrap();
        assert_eq!(line, r#"{"s":"agent:shell","p":"is-a","o":"service","v":"true"}"#);
        assert_eq!(decode_cell(&line).unwrap(), sample_cell());
    }

    #[test]
    fn channel_events_path_strips_channel_prefix() {
        let root = Path::new("/tmp/mash");
        assert_eq!(
            ChannelName::kernel().events_path(root),
            Path::new("/tmp/mash/events/kernel.jsonl")
        );
        assert_eq!(
            ChannelName::new("channel:sessions").unwrap().events_path(root),
            Path::new("/tmp/mash/events/sessions.jsonl")
        );
    }

    #[test]
    fn channel_empty_name_rejected() {
        assert_eq!(ChannelName::new(""), Err(ChannelError::Empty));
    }

    #[test]
    fn snapshot_at_event_shape() {
        let event = snapshot_at_event(100, 101, "2026-04-18T17:00:00.000Z".into());
        assert_eq!(event.s, ChannelName::KERNEL);
        assert_eq!(event.p, SNAPSHOT_AT);
        assert_eq!(event.o, "seq:100");
        assert_eq!(parse_seq_cutoff(&event.o).unwrap(), 100);
    }

    #[test]
    fn parse_seq_cutoff_errors() {
        assert!(matches!(
            parse_seq_cutoff("42"),
            Err(CutoffError::MissingPrefix(_))
        ));
        assert!(matches!(
            parse_seq_cutoff("seq:abc"),
            Err(CutoffError::BadNumber(_))
        ));
    }

    #[test]
    fn claim_ref_coercion_preserves_hash_inputs() {
        // An assertion hashed implicitly as value=true matches a cell
        // with v=true — the identity-layer invariant.
        let assertion = sample_assertion();
        let cell = sample_cell();
        let a = crate::util::hash::claim_hash(&assertion_as_claim_ref(&assertion));
        let c = crate::util::hash::claim_hash(&cell_as_claim_ref(&cell));
        assert_eq!(a, c);
    }
}
