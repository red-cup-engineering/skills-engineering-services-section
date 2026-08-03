//! Time utilities shared across the hub and agent crates.
//!
//! We don't pull in `chrono` for a single timestamp string — this
//! module produces ISO-8601 directly from `SystemTime`. Nanosecond
//! epoch counts are useful for minting unique subject ids inside
//! short-lived agents.

use std::time::{SystemTime, UNIX_EPOCH};

/// Current UTC time as an ISO-8601 string with millisecond precision.
///
/// Format: `YYYY-MM-DDTHH:MM:SS.sssZ` (24 chars). Returned as a
/// `String` so callers don't need an arena or `Cow`.
#[must_use]
#[allow(clippy::many_single_char_names)] // y, mo, d, h, m, s track the ISO-8601 field names
pub fn now_iso8601() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    let days = secs / 86_400;
    let secs_of_day = secs % 86_400;
    let h = secs_of_day / 3_600;
    let m = (secs_of_day % 3_600) / 60;
    let s = secs_of_day % 60;
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}.{millis:03}Z")
}

/// Current Unix time in nanoseconds. Useful for minting unique
/// subject ids within a short-lived agent process. Returns `0` if
/// the system clock is before the Unix epoch — which on a running
/// system is effectively impossible, so callers may treat this as
/// monotonically non-decreasing within one process run.
#[must_use]
pub fn now_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos())
}

/// Convert days since the Unix epoch (1970-01-01) to (year, month, day).
///
/// Adapted from Howard Hinnant's date algorithms. The `u64` input is
/// sufficient for any real wall-clock date the hub will see: a day
/// count of `u64::MAX` is ~50 billion years, far past the heat death
/// of the universe.
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
fn civil_from_days(days: u64) -> (u32, u32, u32) {
    // Shift epoch so the "era" algorithm's zero lines up with
    // 0000-03-01 (Hinnant's standard trick).
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe + era * 400) as u32;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let mo = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = if mo <= 2 { y + 1 } else { y };
    (y, mo, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso8601_shape_is_sane() {
        let s = now_iso8601();
        assert_eq!(s.len(), 24, "expected YYYY-MM-DDTHH:MM:SS.sssZ, got {s:?}");
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[7..8], "-");
        assert_eq!(&s[10..11], "T");
        assert_eq!(&s[19..20], ".");
        assert_eq!(&s[23..24], "Z");
    }

    #[test]
    fn civil_from_days_known_dates() {
        // Day 0 = 1970-01-01.
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // Day 31 = 1970-02-01.
        assert_eq!(civil_from_days(31), (1970, 2, 1));
        // Leap year check: 2000-02-29 was day 11_016.
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }

    #[test]
    fn now_ns_is_post_epoch() {
        assert!(now_ns() > 0);
    }
}
