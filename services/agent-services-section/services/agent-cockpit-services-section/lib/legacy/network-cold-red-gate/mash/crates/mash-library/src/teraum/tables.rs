//! Shared row types for every region's const tables. Each region's
//! `regions/<slug>.rs` instantiates these.
//!
//! The old library carried a per-direction exit predicate
//! (`has-<dir>-exit`) as the fourth column of `Exit`; this library
//! drops that column — the cascade derives direction from
//! `(exit, goes-direction, dir)`. Old row shape is preserved for
//! drop-in data-paste compatibility, but the fourth column is
//! ignored at claim-emission time.

/// `(area-subject, display-name, description, containing-region-subject,
/// culture-subject-or-empty)`.
pub(super) type Area = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

/// `(culture-subject, parent-culture-or-empty, display-name)`.
pub(super) type Culture = (&'static str, &'static str, &'static str);

/// `(region-subject, parent-region-or-empty, display-name, description)`.
pub(super) type Region = (&'static str, &'static str, &'static str, &'static str);

/// `(from, exit-id, direction, has-<dir>-exit predicate, to)`.
/// The fourth column is preserved from the old layout but is
/// ignored — per-direction exit predicates are not part of this
/// library's idiom.
pub(super) type Exit = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

/// `(area-id, trivia-text)`.
pub(super) type Trivia = (&'static str, &'static str);

/// `(lookable-id, parent-area, keyword, description)`.
pub(super) type Lookable = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

/// `(noise-id, parent-subject, weight, text)`.
pub(super) type Noise = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

/// `(npc-id, initial-area, name, description, region-lock, animations)`.
pub(super) type Npc = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static [&'static str],
);
