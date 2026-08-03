//! Clock + staleness vocabulary and staleness projection.
//!
//! # Clock
//!
//! The wall-clock subprocess port emits a fresh [`WALL_CLOCK_TICK`]
//! subject on each tick, each with its own [`HAS_WALL_CLOCK_AT`] ISO
//! timestamp. Individuation-not-mutation: ticks accumulate in the
//! substrate as an append-only event stream; observers take the max
//! timestamp they've seen as "current time."
//!
//! # Staleness
//!
//! Three predicates:
//!
//! - [`HAS_LAST_ACTIVITY_NS`] — heartbeat (nanoseconds since Unix
//!   epoch). Each subject's "owner" refreshes this on activity.
//! - [`HAS_STALE_AFTER_SECS`] — threshold. Set once at subject
//!   creation.
//! - [`IS_STALE`] — diagonal state flag `(s, is-stale, s)`. The
//!   staleness projection watches activity + threshold + tick and
//!   emits when a subject has exceeded its threshold.
//!
//! # Deadline as specialization
//!
//! Also declares [`HAS_DEADLINE_AT`] — an absolute ISO-8601 moment
//! past which the subject is overdue. Deadline differs from stale-
//! after-secs: the latter is relative to last-activity, the former
//! is an absolute calendar time. Both reduce to IS_STALE via their
//! respective observations.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-vocab-clock/` +
//! `archive/mash-vocab-staleness/` + `archive/mash-port-projection-wall-clock/`
//! + `archive/mash-port-projection-staleness/`. Consolidated here as
//! one module since the three vocabularies are tightly coupled.

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::{Agent, Projection};
use mash_engine::sdk::client::Claim;
use std::collections::HashMap;
use async_trait::async_trait;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, THING};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-clock";

// ─────────────────────────────────────────────────────────────────────
// Clock vocabulary
// ─────────────────────────────────────────────────────────────────────

/// A wall-clock tick event. Subject convention: `tick:<ns>` where
/// `<ns>` is nanoseconds since the Unix epoch.
pub const WALL_CLOCK_TICK: &str = "wall-clock-tick";

/// `(tick, has-wall-clock-at, iso8601)` — the tick's timestamp.
pub const HAS_WALL_CLOCK_AT: &str = "has-wall-clock-at";

// ─────────────────────────────────────────────────────────────────────
// Staleness vocabulary
// ─────────────────────────────────────────────────────────────────────

/// `(subject, has-last-activity-ns, ns-string)` — heartbeat in
/// nanoseconds since the Unix epoch. Observer takes the max it has
/// seen as "current."
pub const HAS_LAST_ACTIVITY_NS: &str = "has-last-activity-ns";

/// `(subject, has-stale-after-secs, secs-string)` — relative
/// threshold. Past this many seconds since last activity, subject is
/// stale.
pub const HAS_STALE_AFTER_SECS: &str = "has-stale-after-secs";

/// `(subject, has-deadline-at, iso8601)` — absolute deadline. Past
/// this moment, subject is overdue (and hence stale).
pub const HAS_DEADLINE_AT: &str = "has-deadline-at";

/// Diagonal state flag `(s, is-stale, s)` — True when the staleness
/// projection has decided the subject is past threshold/deadline.
pub const IS_STALE: &str = "is-stale";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring clock and staleness vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Clock;

#[async_trait]
impl Agent for Clock {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Tick is a thing (specialization).
        out.push(Claim::new(WALL_CLOCK_TICK, IS_A_TERM, IDENTITY));
        out.push(Claim::new(WALL_CLOCK_TICK, SPECIALIZES_AS, THING));

        for p in [
            HAS_WALL_CLOCK_AT,
            HAS_LAST_ACTIVITY_NS,
            HAS_STALE_AFTER_SECS,
            HAS_DEADLINE_AT,
            IS_STALE,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        out
    }
}

// ─────────────────────────────────────────────────────────────────────
// Staleness projection
// ─────────────────────────────────────────────────────────────────────

/// Per-subject state tracked by the staleness projection.
#[derive(Debug, Default, Clone)]
struct SubjectState {
    last_activity_ns: Option<u128>,
    stale_after_secs: Option<u64>,
    deadline_at_ns: Option<u128>,
    is_stale: bool,
}

/// Parse ISO-8601 to nanoseconds since Unix epoch. Accepts the
/// `YYYY-MM-DDTHH:MM:SS[.sss]Z` format without full RFC-3339
/// validation. Returns None on parse failure.
fn iso_to_ns(iso: &str) -> Option<u128> {
    // Minimal parser: YYYY-MM-DDTHH:MM:SS[.fff]Z
    let bytes = iso.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let year: i64 = std::str::from_utf8(&bytes[0..4]).ok()?.parse().ok()?;
    let month: u32 = std::str::from_utf8(&bytes[5..7]).ok()?.parse().ok()?;
    let day: u32 = std::str::from_utf8(&bytes[8..10]).ok()?.parse().ok()?;
    let hour: u32 = std::str::from_utf8(&bytes[11..13]).ok()?.parse().ok()?;
    let minute: u32 = std::str::from_utf8(&bytes[14..16]).ok()?.parse().ok()?;
    let second: u32 = std::str::from_utf8(&bytes[17..19]).ok()?.parse().ok()?;

    // Days-from-civil (Howard Hinnant): a well-known integer routine
    // to turn (y, m, d) into days-since-1970-01-01 without any table.
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let m = month as u64;
    let d = day as u64;
    let doy = (153 * if m > 2 { m - 3 } else { m + 9 } + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days_since_epoch = era * 146_097 + doe as i64 - 719_468;

    let secs = (days_since_epoch as i128) * 86_400
        + (hour as i128) * 3_600
        + (minute as i128) * 60
        + second as i128;
    if secs < 0 {
        return None;
    }
    // Ignore any subsecond precision for this first-pass parser.
    Some((secs as u128) * 1_000_000_000)
}

/// Staleness projection state.
#[derive(Debug, Default)]
pub struct StalenessPort {
    subjects: HashMap<String, SubjectState>,
    /// Max wall-clock nanoseconds observed from tick events.
    now_ns: u128,
}

impl StalenessPort {
    /// Fresh port.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Current nanosecond time as seen by the port. Public for
    /// testing.
    #[must_use]
    pub fn now_ns(&self) -> u128 {
        self.now_ns
    }

    fn evaluate(&mut self, subject: &str) -> Vec<Claim> {
        let state = self.subjects.get(subject).cloned().unwrap_or_default();
        let now = self.now_ns;
        if now == 0 {
            return Vec::new();
        }

        let stale_by_activity = match (state.last_activity_ns, state.stale_after_secs) {
            (Some(last), Some(secs)) => {
                let threshold_ns = (secs as u128) * 1_000_000_000;
                now.saturating_sub(last) > threshold_ns
            }
            _ => false,
        };
        let stale_by_deadline = match state.deadline_at_ns {
            Some(deadline) => now >= deadline,
            None => false,
        };
        let should_be_stale = stale_by_activity || stale_by_deadline;

        if should_be_stale && !state.is_stale {
            self.subjects
                .entry(subject.to_owned())
                .or_default()
                .is_stale = true;
            return vec![Claim::new(subject, IS_STALE, subject)];
        }
        Vec::new()
    }
}

impl Projection for StalenessPort {
    fn identity(&self) -> &str {
        "mash-library-staleness"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            HAS_WALL_CLOCK_AT.to_owned(),
            HAS_LAST_ACTIVITY_NS.to_owned(),
            HAS_STALE_AFTER_SECS.to_owned(),
            HAS_DEADLINE_AT.to_owned(),
        ]
    }

    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
        value: Value,
    ) -> Vec<Claim> {
        if value != Value::True {
            return Vec::new();
        }

        match predicate {
            HAS_WALL_CLOCK_AT => {
                if let Some(ns) = iso_to_ns(object) {
                    if ns > self.now_ns {
                        self.now_ns = ns;
                    }
                }
                // A tick arrival means every subject's staleness needs
                // re-evaluation. For a first-pass we re-eval only
                // subjects we know about.
                let subjects: Vec<String> = self.subjects.keys().cloned().collect();
                return subjects
                    .into_iter()
                    .flat_map(|s| self.evaluate(&s))
                    .collect();
            }
            HAS_LAST_ACTIVITY_NS => {
                if let Ok(ns) = object.parse::<u128>() {
                    self.subjects
                        .entry(subject.to_owned())
                        .or_default()
                        .last_activity_ns = Some(ns);
                }
            }
            HAS_STALE_AFTER_SECS => {
                if let Ok(secs) = object.parse::<u64>() {
                    self.subjects
                        .entry(subject.to_owned())
                        .or_default()
                        .stale_after_secs = Some(secs);
                }
            }
            HAS_DEADLINE_AT => {
                if let Some(ns) = iso_to_ns(object) {
                    self.subjects
                        .entry(subject.to_owned())
                        .or_default()
                        .deadline_at_ns = Some(ns);
                }
            }
            _ => return Vec::new(),
        }

        self.evaluate(subject)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_parser_handles_unix_epoch() {
        assert_eq!(iso_to_ns("1970-01-01T00:00:00Z"), Some(0));
    }

    #[test]
    fn iso_parser_handles_known_date() {
        // 2026-04-21T00:00:00Z — a fixed point for test stability.
        // Unix timestamp: 1_776_729_600 seconds since epoch.
        let ns = iso_to_ns("2026-04-21T00:00:00Z").unwrap();
        assert_eq!(ns, 1_776_729_600_u128 * 1_000_000_000);
    }

    #[test]
    fn iso_parser_rejects_malformed() {
        assert!(iso_to_ns("not-a-date").is_none());
        assert!(iso_to_ns("2026").is_none());
    }

    #[test]
    fn agent_claims_are_complete() {
        let claims = Clock.claims();
        assert!(claims.iter().any(|c| c.subject == WALL_CLOCK_TICK
            && c.predicate == SPECIALIZES_AS
            && c.object == THING));
        for p in [
            HAS_WALL_CLOCK_AT,
            HAS_LAST_ACTIVITY_NS,
            HAS_STALE_AFTER_SECS,
            HAS_DEADLINE_AT,
            IS_STALE,
        ] {
            assert!(
                claims.iter().any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared"
            );
        }
    }

    #[test]
    fn no_clock_tick_yet_means_no_staleness_eval() {
        let mut port = StalenessPort::new();
        let claims = port.ingest("task-1", HAS_LAST_ACTIVITY_NS, "100", Value::True);
        assert!(claims.is_empty());
        let claims = port.ingest("task-1", HAS_STALE_AFTER_SECS, "60", Value::True);
        assert!(claims.is_empty());
    }

    #[test]
    fn stale_by_activity_fires_after_threshold() {
        let mut port = StalenessPort::new();

        // Set up subject state.
        port.ingest("task-1", HAS_LAST_ACTIVITY_NS, "1000000000000", Value::True);
        port.ingest("task-1", HAS_STALE_AFTER_SECS, "10", Value::True);

        // A clock tick well past the threshold: 1e12 + 11e9 ns.
        let iso = "1970-01-01T00:16:51Z"; // roughly 1011 seconds
        let claims = port.ingest(
            format!("tick:{}", 1_011_000_000_000u128).as_str(),
            HAS_WALL_CLOCK_AT,
            iso,
            Value::True,
        );
        // 1011s - 1000s = 11s > 10s threshold → stale.
        assert!(
            claims.iter().any(|c| c.subject == "task-1"
                && c.predicate == IS_STALE
                && c.object == "task-1"),
            "expected IS_STALE emission; got {claims:?}"
        );
    }

    #[test]
    fn not_stale_before_threshold() {
        let mut port = StalenessPort::new();
        port.ingest("task-2", HAS_LAST_ACTIVITY_NS, "1000000000000", Value::True);
        port.ingest("task-2", HAS_STALE_AFTER_SECS, "60", Value::True);

        // Tick only 30s past last activity — still within threshold.
        let iso = "1970-01-01T00:17:10Z"; // ~1030s
        let claims = port.ingest(
            format!("tick:{}", 1_030_000_000_000u128).as_str(),
            HAS_WALL_CLOCK_AT,
            iso,
            Value::True,
        );
        assert!(
            !claims.iter().any(|c| c.predicate == IS_STALE),
            "should not be stale yet"
        );
    }

    #[test]
    fn stale_fires_only_once_per_subject() {
        let mut port = StalenessPort::new();
        port.ingest("task-3", HAS_LAST_ACTIVITY_NS, "0", Value::True);
        port.ingest("task-3", HAS_STALE_AFTER_SECS, "1", Value::True);

        // First qualifying tick → fires.
        let first = port.ingest(
            "tick:10000000000",
            HAS_WALL_CLOCK_AT,
            "1970-01-01T00:00:10Z",
            Value::True,
        );
        assert!(first.iter().any(|c| c.predicate == IS_STALE));

        // Second tick further in the future → no re-emission.
        let second = port.ingest(
            "tick:20000000000",
            HAS_WALL_CLOCK_AT,
            "1970-01-01T00:00:20Z",
            Value::True,
        );
        assert!(
            !second.iter().any(|c| c.subject == "task-3" && c.predicate == IS_STALE),
            "once-stale should not re-emit"
        );
    }

    #[test]
    fn deadline_triggers_staleness_regardless_of_activity() {
        let mut port = StalenessPort::new();
        // A subject with just a deadline, no activity tracking.
        port.ingest("task-4", HAS_DEADLINE_AT, "1970-01-01T00:00:05Z", Value::True);

        // Tick past the deadline.
        let claims = port.ingest(
            "tick:10000000000",
            HAS_WALL_CLOCK_AT,
            "1970-01-01T00:00:10Z",
            Value::True,
        );
        assert!(
            claims.iter().any(|c| c.subject == "task-4" && c.predicate == IS_STALE),
            "deadline passed → stale"
        );
    }
}
