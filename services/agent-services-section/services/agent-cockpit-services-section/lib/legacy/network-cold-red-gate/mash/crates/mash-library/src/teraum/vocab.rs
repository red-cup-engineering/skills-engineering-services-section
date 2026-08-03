//! Scene-local vocabulary for Teraum: geography (region, culture,
//! located-at, has-culture, has-trivia), lore (era, historical-event,
//! character, faction, concept, lore-place, has-summary, has-lore,
//! occurred-in-era, member-of, rules, within-region), timeline (year,
//! month, day, era-marker, has-year, has-year-era, has-month, has-day,
//! has-date-text, plus the twelve Teraumic months), beastiary
//! (creature-species, has-type-line, has-notes), and extras
//! (minor-character, has-type-line, has-biography).
//!
//! # Inversion discipline
//!
//! The old-library vocab crates paired every converse-positive
//! predicate with an `INVERTS_AS` declaration (HAS_SUMMARY/SUMMARIZES,
//! HAS_LORE/LORE_OF, LOCATED_AT/CONTAINS, HAS_CULTURE/CULTURE_OF, …).
//! My library drops these pairs — reverse queries use fiber-scan at
//! the object axis, not a converse predicate. Only the forward
//! predicate is declared here.
//!
//! The only INVERTS_AS in my substrate is the negation pair
//! `CONTAINS` / `EXCLUDES_FROM` (container.rs); nothing in this
//! vocabulary is a negation pair, so nothing here is wired with
//! `INVERTS_AS`.
//!
//! # Why a single vocab file
//!
//! The old library split these across four vocab crates
//! (`mash-vocab-mud-lore`, `mash-vocab-mud-timeline`,
//! `mash-vocab-mud-beastiary`, `mash-vocab-mud-extras`). In this
//! library they collapse into one scene-local vocab owner-agent —
//! the vocabulary only exists to support the Teraum scene data, and
//! carrying four crates for that would be bureaucratic overhead.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::container::CONTAINER;
use crate::foundation::{IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS};

/// Owner identity for the Teraum scene-local vocabulary.
pub const IDENTITY: &str = "mash-scene-mud-teraum-vocab";

// ─────────────────────────────────────────────────────────────────────
// Geography (beyond what space.rs and container.rs already provide)
// ─────────────────────────────────────────────────────────────────────

/// A named grouping of areas with no geography of its own. Regions
/// chain upward via `located-at`; areas locate into them; region-lock
/// and region-trivia attach to them.
pub const REGION: &str = "region";

/// A demonym-like trait — `culture:ackian`, `culture:teraumi`, …
/// Cultures chain via `specializes-as`; a claim `(subj, has-culture,
/// culture:ackian)` lifts into `has-culture culture:teraumi` at
/// cascade time.
pub const CULTURE: &str = "culture";

/// `(thing, has-culture, culture-term)` — the thing bears the named
/// culture. Specialization morphisms on the culture subject lift the
/// claim into parent cultures automatically.
pub const HAS_CULTURE: &str = "has-culture";

/// `(subject, has-trivia, text)` — a bag-valued predicate carrying
/// unordered trivia strings. Asserted multiple times per subject for
/// each trivia line.
pub const HAS_TRIVIA: &str = "has-trivia";

/// `(subject, located-at, container)` — geographic-hierarchy
/// location: rooms in regions, regions in regions, etc. Declared as
/// a single-direction predicate here; reverse queries use fiber-scan.
/// Note: this is distinct from [`crate::container::CONTAINS`], which
/// has algebraic-negation semantics for dynamic containment of
/// moving things.
pub const LOCATED_AT: &str = "located-at";

// ─────────────────────────────────────────────────────────────────────
// Lore
// ─────────────────────────────────────────────────────────────────────

/// Top term for the lore taxonomy. All the specific kinds below
/// specialize-as this.
pub const LORE_ENTRY: &str = "lore-entry";

/// A span or point of in-world time.
pub const ERA: &str = "era";
/// A notable in-world occurrence located in an era.
pub const HISTORICAL_EVENT: &str = "historical-event";
/// A person referenced by lore; distinct from an in-world NPC.
pub const CHARACTER: &str = "character";
/// An in-world organization — guild, tribe, company, society.
pub const FACTION: &str = "faction";
/// An abstract entity: a force, a law, a phenomenon.
pub const CONCEPT: &str = "concept";
/// A named place at region / plane / river / mountain-range scale —
/// larger or stranger than a walkable room.
pub const LORE_PLACE: &str = "lore-place";

/// `(subject, has-summary, text)` — one-line summary.
pub const HAS_SUMMARY: &str = "has-summary";
/// `(subject, has-lore, text)` — long-form lore body.
pub const HAS_LORE: &str = "has-lore";
/// `(event, occurred-in-era, era)`.
pub const OCCURRED_IN_ERA: &str = "occurred-in-era";
/// `(character, member-of, faction)`.
pub const MEMBER_OF: &str = "member-of";
/// `(faction, rules, polity)`.
pub const RULES: &str = "rules";
/// `(lore-entry, within-region, containing-lore-place)`.
pub const WITHIN_REGION: &str = "within-region";

// ─────────────────────────────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────────────────────────────

/// A calendar year term.
pub const YEAR: &str = "year";
/// A calendar month term.
pub const MONTH: &str = "month";
/// A calendar day term.
pub const DAY: &str = "day";
/// An era marker like `bB`, `aB`, `bc`, `pc`.
pub const ERA_MARKER: &str = "era-marker";

/// `(event, has-year, signed-integer-string)`.
pub const HAS_YEAR: &str = "has-year";
/// `(event, has-year-era, era-marker)`.
pub const HAS_YEAR_ERA: &str = "has-year-era";
/// `(event, has-month, month-name)`.
pub const HAS_MONTH: &str = "has-month";
/// `(event, has-day, day-integer-string)`.
pub const HAS_DAY: &str = "has-day";
/// `(event, has-date-text, string)` — the in-world rendered date.
pub const HAS_DATE_TEXT: &str = "has-date-text";

/// The twelve Teraumic months, in calendar order.
pub const TERAUM_MONTHS: &[&str] = &[
    "Deepwinter",
    "Winter",
    "Sunsets",
    "Storms",
    "Melting",
    "Flowers",
    "Summertide",
    "Highsun",
    "Fading",
    "Leaffall",
    "Rotting",
    "Drawing",
];

// ─────────────────────────────────────────────────────────────────────
// Beastiary
// ─────────────────────────────────────────────────────────────────────

/// A creature species — a kind, not an individual.
pub const CREATURE_SPECIES: &str = "creature-species";

/// `(subject, has-type-line, text)` — full type-line
/// ("Medium beast, unaligned"). Shared with the extras vocabulary.
pub const HAS_TYPE_LINE: &str = "has-type-line";

/// `(species, has-notes, text)` — species notes / lore / habits.
pub const HAS_NOTES: &str = "has-notes";

// ─────────────────────────────────────────────────────────────────────
// Extras
// ─────────────────────────────────────────────────────────────────────

/// A minor named character.
pub const MINOR_CHARACTER: &str = "minor-character";

/// `(extra, has-biography, text)`.
pub const HAS_BIOGRAPHY: &str = "has-biography";

// ─────────────────────────────────────────────────────────────────────
// Scene-local content tags (lookable / noise / npc kinds)
// ─────────────────────────────────────────────────────────────────────

/// Kind tag for a lookable (an in-room look target without its own
/// container / exit machinery).
pub const KIND_LOOKABLE: &str = "lookable";
/// Kind tag for a noise (an ambient-port source).
pub const KIND_NOISE: &str = "noise";
/// Kind tag for an in-world NPC located in a room.
pub const KIND_NPC: &str = "npc";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Declares all the Teraum-local vocabulary: terms, predicates,
/// month-terms, specialization of the lore hierarchy.
#[derive(Debug, Clone, Copy, Default)]
pub struct TeraumVocab;

#[async_trait]
impl Agent for TeraumVocab {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // -- Geography terms beyond what space.rs / container.rs
        // already provide. Region is a container-like grouping;
        // culture is a shared-trait subject. --
        for t in [REGION, CULTURE] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }
        out.push(Claim::new(REGION, SPECIALIZES_AS, CONTAINER));

        for p in [HAS_CULTURE, HAS_TRIVIA, LOCATED_AT] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // -- Lore taxonomy. Each specific kind specializes-as
        // lore-entry. --
        for t in [
            LORE_ENTRY,
            ERA,
            HISTORICAL_EVENT,
            CHARACTER,
            FACTION,
            CONCEPT,
            LORE_PLACE,
        ] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }
        for t in [ERA, HISTORICAL_EVENT, CHARACTER, FACTION, CONCEPT, LORE_PLACE] {
            out.push(Claim::new(t, SPECIALIZES_AS, LORE_ENTRY));
        }
        for p in [HAS_SUMMARY, HAS_LORE, OCCURRED_IN_ERA, MEMBER_OF, RULES, WITHIN_REGION] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // -- Timeline terms + predicates + month-terms. --
        for t in [YEAR, MONTH, DAY, ERA_MARKER] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }
        for p in [HAS_YEAR, HAS_YEAR_ERA, HAS_MONTH, HAS_DAY, HAS_DATE_TEXT] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }
        for m in TERAUM_MONTHS {
            // Month names are terms in their own right, specializing
            // as MONTH. (Old lib used a literal "is-a month" here; we
            // use the canonical IS_A_TERM + SPECIALIZES_AS wiring.)
            out.push(Claim::new(*m, IS_A_TERM, IDENTITY));
            out.push(Claim::new(*m, SPECIALIZES_AS, MONTH));
        }

        // -- Beastiary. --
        out.push(Claim::new(CREATURE_SPECIES, IS_A_TERM, IDENTITY));
        for p in [HAS_TYPE_LINE, HAS_NOTES] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // -- Extras. --
        out.push(Claim::new(MINOR_CHARACTER, IS_A_TERM, IDENTITY));
        out.push(Claim::new(HAS_BIOGRAPHY, IS_A_PREDICATE, IDENTITY));

        // -- Content kind tags. --
        for t in [KIND_LOOKABLE, KIND_NOISE, KIND_NPC] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lore_kinds_specialize_lore_entry() {
        let claims = TeraumVocab.claims();
        for t in [ERA, HISTORICAL_EVENT, CHARACTER, FACTION, CONCEPT, LORE_PLACE] {
            assert!(
                claims.iter().any(|c| c.subject == t
                    && c.predicate == SPECIALIZES_AS
                    && c.object == LORE_ENTRY),
                "{t} should specialize-as lore-entry"
            );
        }
    }

    #[test]
    fn all_twelve_months_declared() {
        let claims = TeraumVocab.claims();
        assert_eq!(TERAUM_MONTHS.len(), 12);
        for m in TERAUM_MONTHS {
            assert!(
                claims.iter().any(|c| c.subject == *m
                    && c.predicate == SPECIALIZES_AS
                    && c.object == MONTH),
                "{m} should specialize-as month"
            );
        }
    }

    #[test]
    fn region_specializes_as_container() {
        let claims = TeraumVocab.claims();
        assert!(claims.iter().any(|c| c.subject == REGION
            && c.predicate == SPECIALIZES_AS
            && c.object == CONTAINER));
    }
}
