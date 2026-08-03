//! Teraum — the reference scene, full content.
//!
//! 97 rooms across 17 top-level regions, plus the nested region
//! hierarchy, culture hierarchy, composite-area subjects (areas that
//! are simultaneously places AND districts), lore catalogue
//! (eras, historical events, characters, factions, concepts, lore
//! places + relationship tables for membership, rulership,
//! containment, and event-era assignment), a dated timeline of
//! in-world events, a beastiary of creature species, and extras for
//! minor cast characters.
//!
//! # Structure
//!
//! - [`vocab`] — scene-local vocabulary (geography, lore, timeline,
//!   beastiary, extras terms and predicates).
//! - [`tables`] — shared row types for region data.
//! - [`regions`] — per-region area / exit / trivia / lookable / noise
//!   / NPC tables; also the region hierarchy, culture hierarchy, and
//!   composite-area list.
//! - [`lore`] — eras / events / characters / factions / concepts /
//!   lore-places + cross-references.
//! - [`timeline`] — dated timeline of in-world events.
//! - [`beastiary`] — creature species catalogue.
//! - [`extras`] — minor named-character biographies.
//!
//! # Inversion discipline
//!
//! The old library wired every converse-positive predicate pair
//! with `INVERTS_AS` (HAS_SUMMARY ↔ SUMMARIZES, HAS_LORE ↔ LORE_OF,
//! LOCATED_AT ↔ CONTAINS, HAS_CULTURE ↔ CULTURE_OF, …). In this
//! library those pairs are dropped — each predicate is declared
//! single-direction and reverse queries use fiber-scan at the object
//! axis. See [`crate::container`] module docs on the naming
//! discipline; the only `INVERTS_AS` pair in the library is the
//! genuine negation pair `CONTAINS` / `EXCLUDES_FROM`.
//!
//! # Per-direction exit predicates
//!
//! The old library additionally emitted `(room, has-<dir>-exit, exit)`
//! claims alongside the generic `(room, has-exit, exit)`. This
//! library does not — the cascade finds direction via
//! `(room, has-exit, exit)` + `(exit, goes-direction, dir)`.

pub mod vocab;

mod beastiary;
mod extras;
mod lore;
mod regions;
mod tables;
mod timeline;

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::container::{HAS_DESCRIPTION, HAS_NAME};
use crate::foundation::{IS_A_TERM, SPECIALIZES_AS};
use crate::mud::ambient::{
    AREA as ROOM_AREA, HAS_ANIMATION, HAS_NOISE_TEXT, HAS_NOISE_WEIGHT, NOISE_LOCATED_AT,
    REGION_LOCKED_TO,
};
use crate::space::{EXIT, GOES_DIRECTION, HAS_EXIT, LEADS_TO, ROOM};
use crate::welcome::HAS_SPAWN_ROOM;

use self::vocab::{
    CREATURE_SPECIES, CULTURE, HAS_BIOGRAPHY, HAS_CULTURE, HAS_DATE_TEXT, HAS_DAY, HAS_LORE,
    HAS_MONTH, HAS_NOTES, HAS_SUMMARY, HAS_TRIVIA, HAS_TYPE_LINE, HAS_YEAR, HAS_YEAR_ERA,
    HISTORICAL_EVENT, KIND_LOOKABLE, KIND_NOISE, KIND_NPC, LOCATED_AT, MEMBER_OF, MINOR_CHARACTER,
    OCCURRED_IN_ERA, REGION, RULES, WITHIN_REGION,
};

/// Scene identity; subject of the spawn declaration.
pub const IDENTITY: &str = "mash-scene-mud-teraum";

/// Spawn room: where newcomers arrive.
pub const SPAWN_ROOM: &str = "area:central-plains-fort-kelly";

/// The Teraum scene owner-agent.
#[derive(Debug, Clone, Copy, Default)]
pub struct Teraum;

#[async_trait]
impl Agent for Teraum {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // -- Region hierarchy. Each region is a first-class subject
        // with is-a-term region, a rendered name, and a located-at
        // edge to its parent (if any). --
        for (subject, parent, name, description) in regions::REGIONS_LIST {
            out.push(Claim::new(*subject, IS_A_TERM, REGION));
            out.push(Claim::new(*subject, HAS_NAME, *name));
            if !description.is_empty() {
                out.push(Claim::new(*subject, HAS_DESCRIPTION, *description));
            }
            if !parent.is_empty() {
                out.push(Claim::new(*subject, LOCATED_AT, *parent));
            }
        }

        // -- Culture hierarchy. Each `culture:<slug>` is a subject
        // chained via specializes-as to its parent, so a claim
        // `(thing, has-culture, culture:ackian)` lifts into
        // `has-culture culture:teraumi` automatically. --
        for (subject, parent, name) in regions::CULTURES {
            out.push(Claim::new(*subject, IS_A_TERM, CULTURE));
            out.push(Claim::new(*subject, HAS_NAME, *name));
            if !parent.is_empty() {
                out.push(Claim::new(*subject, SPECIALIZES_AS, *parent));
            }
        }

        // -- Composite areas: subjects that are both a place you can
        // stand in AND a region that contains sub-places. --
        for (area, name, description, containing_region, culture) in regions::COMPOSITE_AREAS {
            out.push(Claim::new(*area, IS_A_TERM, ROOM));
            out.push(Claim::new(*area, LOCATED_AT, *containing_region));
            out.push(Claim::new(*area, HAS_NAME, *name));
            out.push(Claim::new(*area, HAS_DESCRIPTION, *description));
            if !culture.is_empty() {
                out.push(Claim::new(*area, HAS_CULTURE, *culture));
            }
        }

        // -- Per-region data tables. --
        for (_region_slug, areas, exits, trivia, lookables, noises, npcs) in regions::REGIONS {
            for (area, name, description, containing_region, culture) in *areas {
                out.push(Claim::new(*area, IS_A_TERM, ROOM));
                out.push(Claim::new(*area, LOCATED_AT, *containing_region));
                // Also emit the ambient-port's room-has-area
                // predicate so WanderPort can region-lock roaming
                // NPCs against the area. The old library's LOCATED_AT
                // double-dutied here; we keep the geographic axis
                // separate from the ambient axis.
                out.push(Claim::new(*area, ROOM_AREA, *containing_region));
                out.push(Claim::new(*area, HAS_NAME, *name));
                out.push(Claim::new(*area, HAS_DESCRIPTION, *description));
                if !culture.is_empty() {
                    out.push(Claim::new(*area, HAS_CULTURE, *culture));
                }
            }

            // Exits. The old library also emitted a per-direction
            // predicate (has-north-exit etc.); we drop that column.
            for (from, exit, direction, _has_dir_exit, to) in *exits {
                out.push(Claim::new(*exit, IS_A_TERM, EXIT));
                out.push(Claim::new(*from, HAS_EXIT, *exit));
                out.push(Claim::new(*exit, GOES_DIRECTION, *direction));
                out.push(Claim::new(*exit, LEADS_TO, *to));
            }

            for (room, text) in *trivia {
                out.push(Claim::new(*room, HAS_TRIVIA, *text));
            }

            for (lookable, parent, keyword, description) in *lookables {
                out.push(Claim::new(*lookable, IS_A_TERM, KIND_LOOKABLE));
                out.push(Claim::new(*lookable, LOCATED_AT, *parent));
                out.push(Claim::new(*lookable, HAS_NAME, *keyword));
                out.push(Claim::new(*lookable, HAS_DESCRIPTION, *description));
            }

            for (noise, parent, weight, text) in *noises {
                out.push(Claim::new(*noise, IS_A_TERM, KIND_NOISE));
                // NOISE_LOCATED_AT is the scene-local located-at from
                // ambient.rs; string-identical to vocab::LOCATED_AT
                // but referenced via the ambient port's subscription
                // predicate for clarity.
                out.push(Claim::new(*noise, NOISE_LOCATED_AT, *parent));
                out.push(Claim::new(*noise, HAS_NOISE_WEIGHT, *weight));
                out.push(Claim::new(*noise, HAS_NOISE_TEXT, *text));
            }

            for (npc, room, name, description, region_lock, animations) in *npcs {
                out.push(Claim::new(*npc, IS_A_TERM, KIND_NPC));
                out.push(Claim::new(*npc, LOCATED_AT, *room));
                out.push(Claim::new(*npc, HAS_NAME, *name));
                if !description.is_empty() {
                    out.push(Claim::new(*npc, HAS_DESCRIPTION, *description));
                }
                if !region_lock.is_empty() {
                    out.push(Claim::new(*npc, REGION_LOCKED_TO, *region_lock));
                }
                for anim in *animations {
                    out.push(Claim::new(*npc, HAS_ANIMATION, *anim));
                }
            }
        }

        // -- Lore catalogue. --
        for (id, kind, name, summary, lore_text) in lore::ENTRIES {
            out.push(Claim::new(*id, IS_A_TERM, *kind));
            out.push(Claim::new(*id, HAS_NAME, *name));
            out.push(Claim::new(*id, HAS_SUMMARY, *summary));
            out.push(Claim::new(*id, HAS_LORE, *lore_text));
        }
        for (member, faction) in lore::MEMBERSHIPS {
            out.push(Claim::new(*member, MEMBER_OF, *faction));
        }
        for (ruler, polity) in lore::RULERSHIPS {
            out.push(Claim::new(*ruler, RULES, *polity));
        }
        for (inner, outer) in lore::WITHIN {
            out.push(Claim::new(*inner, WITHIN_REGION, *outer));
        }
        for (event, era) in lore::EVENT_ERAS {
            out.push(Claim::new(*event, OCCURRED_IN_ERA, *era));
        }

        // -- Timeline. --
        for (id, topic, text, year, era, day, month, date_text) in timeline::TIMELINE {
            out.push(Claim::new(*id, IS_A_TERM, HISTORICAL_EVENT));
            out.push(Claim::new(*id, HAS_NAME, *topic));
            out.push(Claim::new(*id, HAS_LORE, *text));
            out.push(Claim::new(*id, HAS_YEAR, *year));
            out.push(Claim::new(*id, HAS_YEAR_ERA, *era));
            if !month.is_empty() {
                out.push(Claim::new(*id, HAS_MONTH, *month));
            }
            if !day.is_empty() {
                out.push(Claim::new(*id, HAS_DAY, *day));
            }
            out.push(Claim::new(*id, HAS_DATE_TEXT, *date_text));
        }

        // -- Extras. --
        for (id, name, type_line, biography) in extras::EXTRAS {
            out.push(Claim::new(*id, IS_A_TERM, MINOR_CHARACTER));
            out.push(Claim::new(*id, HAS_NAME, *name));
            if !type_line.is_empty() {
                out.push(Claim::new(*id, HAS_TYPE_LINE, *type_line));
            }
            if !biography.is_empty() {
                out.push(Claim::new(*id, HAS_BIOGRAPHY, *biography));
            }
        }

        // -- Beastiary. --
        for (id, name, type_line, notes) in beastiary::BEASTIARY {
            out.push(Claim::new(*id, IS_A_TERM, CREATURE_SPECIES));
            out.push(Claim::new(*id, HAS_NAME, *name));
            if !type_line.is_empty() {
                out.push(Claim::new(*id, HAS_TYPE_LINE, *type_line));
            }
            if !notes.is_empty() {
                out.push(Claim::new(*id, HAS_NOTES, *notes));
            }
        }

        // -- Scene-level spawn declaration. --
        out.push(Claim::new(IDENTITY, HAS_SPAWN_ROOM, SPAWN_ROOM));

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn all_room_ids() -> HashSet<&'static str> {
        let mut known = HashSet::new();
        for (_, rooms, _, _, _, _, _) in regions::REGIONS {
            for (id, _, _, _, _) in *rooms {
                known.insert(*id);
            }
        }
        known
    }

    #[test]
    fn spawn_is_a_known_room() {
        assert!(all_room_ids().contains(SPAWN_ROOM));
    }

    #[test]
    fn spawn_claim_is_emitted() {
        assert!(Teraum.claims().iter().any(|c| c.subject == IDENTITY
            && c.predicate == HAS_SPAWN_ROOM
            && c.object == SPAWN_ROOM));
    }

    #[test]
    fn every_room_has_name_and_description() {
        let claims = Teraum.claims();
        for (_, rooms, _, _, _, _, _) in regions::REGIONS {
            for (room, _, _, _, _) in *rooms {
                assert!(
                    claims
                        .iter()
                        .any(|c| c.subject == *room && c.predicate == HAS_NAME),
                    "{room} has no name",
                );
                assert!(
                    claims
                        .iter()
                        .any(|c| c.subject == *room && c.predicate == HAS_DESCRIPTION),
                    "{room} has no description",
                );
            }
        }
    }

    #[test]
    fn every_exit_leads_to_a_known_room() {
        let known = all_room_ids();
        for (_, _, exits, _, _, _, _) in regions::REGIONS {
            for (_, exit, _, _, to) in *exits {
                assert!(known.contains(to), "{exit} leads to unknown room {to}");
            }
        }
    }

    #[test]
    fn every_lookable_parents_a_known_room() {
        let known = all_room_ids();
        for (_, _, _, _, lookables, _, _) in regions::REGIONS {
            for (id, parent, _, _) in *lookables {
                assert!(known.contains(parent), "{id} parents unknown room {parent}");
            }
        }
    }

    #[test]
    fn every_npc_has_a_location() {
        let claims = Teraum.claims();
        for (_, _, _, _, _, _, npcs) in regions::REGIONS {
            for (id, _, _, _, _, _) in *npcs {
                assert!(
                    claims
                        .iter()
                        .any(|c| c.subject == *id && c.predicate == LOCATED_AT),
                    "{id} has no location",
                );
            }
        }
    }

    #[test]
    fn room_count_matches_import() {
        assert_eq!(all_room_ids().len(), 97);
    }

    fn all_lore_ids() -> HashSet<&'static str> {
        lore::ENTRIES.iter().map(|(id, _, _, _, _)| *id).collect()
    }

    #[test]
    fn every_lore_entry_has_summary_and_lore() {
        let claims = Teraum.claims();
        for (id, _, _, _, _) in lore::ENTRIES {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *id && c.predicate == HAS_SUMMARY),
                "{id} has no summary",
            );
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *id && c.predicate == HAS_LORE),
                "{id} has no lore body",
            );
        }
    }

    #[test]
    fn every_timeline_entry_has_year_and_date_text() {
        let claims = Teraum.claims();
        for (id, _, _, _, _, _, _, _) in timeline::TIMELINE {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *id && c.predicate == HAS_YEAR),
                "{id} has no year",
            );
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *id && c.predicate == HAS_DATE_TEXT),
                "{id} has no date text",
            );
        }
    }

    #[test]
    fn every_extra_has_a_name() {
        let claims = Teraum.claims();
        for (id, _, _, _) in extras::EXTRAS {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *id && c.predicate == HAS_NAME),
                "{id} has no name",
            );
        }
    }

    #[test]
    fn every_beast_has_a_name() {
        let claims = Teraum.claims();
        for (id, _, _, _) in beastiary::BEASTIARY {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *id && c.predicate == HAS_NAME),
                "{id} has no name",
            );
        }
    }

    #[test]
    fn every_lore_relation_names_a_known_entry() {
        let known = all_lore_ids();
        for (a, b) in lore::MEMBERSHIPS
            .iter()
            .chain(lore::RULERSHIPS.iter())
            .chain(lore::WITHIN.iter())
            .chain(lore::EVENT_ERAS.iter())
        {
            assert!(known.contains(a), "unknown lore entry {a}");
            assert!(known.contains(b), "unknown lore entry {b}");
        }
    }
}
