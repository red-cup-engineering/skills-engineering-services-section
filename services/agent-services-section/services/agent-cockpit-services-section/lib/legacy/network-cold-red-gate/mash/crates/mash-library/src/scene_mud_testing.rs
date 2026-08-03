//! MUD testing scene — a minimal deterministic world for integration
//! tests.
//!
//! Three rooms joined bidirectionally:
//!
//! ```text
//!          [ North Chamber ]
//!                  |
//!               north / south
//!                  |
//!          [ Test Hall ]   ← spawn
//!                  |
//!               south / north
//!                  |
//!          [ South Chamber ]
//! ```
//!
//! Plus fixtures to exercise specific substrate behaviors:
//!
//! - Two lookables sharing a noun (`plaque`) that differ by adjective
//!   — disambiguation probe for look handlers.
//! - One ambient noise in the spawn room — probe for
//!   [`crate::mud::ambient::NoisePort`].
//! - One wandering NPC region-locked to the test area — probe for
//!   [`crate::mud::ambient::WanderPort`].
//!
//! # What's intentionally absent
//!
//! No lore, no beastiary, no grand atlas. Tests that need broader
//! content should either mount additional owner-agents or witness
//! their own fixture claims. The scene is small so tests are fast
//! and regressions are easy to diagnose.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::container::{CONTAINS, HAS_DESCRIPTION, HAS_NAME};
use crate::foundation::IS_A_TERM;
use crate::grammar::HAS_ADJECTIVE;
use crate::mud::ambient::{
    AREA, HAS_ANIMATION, HAS_NOISE_TEXT, HAS_NOISE_WEIGHT, NOISE_LOCATED_AT, REGION_LOCKED_TO,
    ROAM_ANIMATION,
};
use crate::space::{EXIT, GOES_DIRECTION, HAS_EXIT, LEADS_TO, ROOM};
use crate::welcome::HAS_SPAWN_ROOM;

/// Owner identity.
pub const IDENTITY: &str = "mash-library-scene-mud-testing";

// ─────────────────────────────────────────────────────────────────────
// Areas and rooms
// ─────────────────────────────────────────────────────────────────────

/// The single test area — flat one-level region.
pub const AREA_TEST: &str = "area:test";

/// Spawn room — newcomers arrive here.
pub const ROOM_HALL: &str = "room:test-hall";

/// North chamber room.
pub const ROOM_NORTH: &str = "room:test-north";

/// South chamber room.
pub const ROOM_SOUTH: &str = "room:test-south";

// ─────────────────────────────────────────────────────────────────────
// Lookables — two plaques disambiguated by adjective
// ─────────────────────────────────────────────────────────────────────

/// Brass plaque in the hall.
pub const LOOKABLE_BRASS_PLAQUE: &str = "lookable:test-hall-brass-plaque";

/// Stone plaque in the hall (same noun; different adjective).
pub const LOOKABLE_STONE_PLAQUE: &str = "lookable:test-hall-stone-plaque";

/// Shared plaque noun.
pub const PLAQUE_KEYWORD: &str = "plaque";

/// Text for looking at the brass plaque.
pub const BRASS_PLAQUE_DESCRIPTION: &str =
    "A brass plaque reads: THIS IS THE BRASS PLAQUE.";

/// Text for looking at the stone plaque.
pub const STONE_PLAQUE_DESCRIPTION: &str =
    "A stone plaque reads: THIS IS THE STONE PLAQUE.";

// ─────────────────────────────────────────────────────────────────────
// Ambient fixtures
// ─────────────────────────────────────────────────────────────────────

/// Sole noise in the hall.
pub const NOISE_CLANK: &str = "noise:test-hall-clank";

/// Text of the clank noise.
pub const NOISE_CLANK_TEXT: &str = "A distant pipe clanks somewhere in the building.";

/// Wandering NPC, region-locked to [`AREA_TEST`].
pub const NPC_MOUSE: &str = "npc:test-hall-mouse";

/// NPC display name.
pub const NPC_MOUSE_NAME: &str = "mouse";

// ─────────────────────────────────────────────────────────────────────
// Exit table (from, exit-subject, direction, to)
// ─────────────────────────────────────────────────────────────────────

const EXITS: &[(&str, &str, &str, &str)] = &[
    (ROOM_HALL, "exit:test-hall-north", "north", ROOM_NORTH),
    (ROOM_HALL, "exit:test-hall-south", "south", ROOM_SOUTH),
    (ROOM_NORTH, "exit:test-north-south", "south", ROOM_HALL),
    (ROOM_SOUTH, "exit:test-south-north", "north", ROOM_HALL),
];

const ROOMS: &[(&str, &str, &str)] = &[
    (
        ROOM_HALL,
        "Test Hall",
        "A quiet chamber used for testing. Exits lead north and south.",
    ),
    (
        ROOM_NORTH,
        "North Chamber",
        "The chamber to the north. A single exit heads south.",
    ),
    (
        ROOM_SOUTH,
        "South Chamber",
        "The chamber to the south. A single exit heads north.",
    ),
];

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// MUD testing scene owner-agent.
#[derive(Debug, Clone, Copy, Default)]
pub struct MudTestingScene;

#[async_trait]
impl Agent for MudTestingScene {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        // Area declaration + area → rooms via CONTAINS.
        out.push(Claim::new(AREA_TEST, IS_A_TERM, AREA));
        out.push(Claim::new(AREA_TEST, HAS_NAME, "Test Area"));
        for (room, _, _) in ROOMS {
            out.push(Claim::new(AREA_TEST, CONTAINS, *room));
        }

        // Rooms.
        for (id, name, description) in ROOMS {
            out.push(Claim::new(*id, IS_A_TERM, ROOM));
            out.push(Claim::new(*id, HAS_NAME, *name));
            out.push(Claim::new(*id, HAS_DESCRIPTION, *description));
            // Every test room is in the test area.
            out.push(Claim::new(*id, AREA, AREA_TEST));
        }

        // Exits.
        for (from, exit, direction, to) in EXITS {
            out.push(Claim::new(*exit, IS_A_TERM, EXIT));
            out.push(Claim::new(*from, HAS_EXIT, *exit));
            out.push(Claim::new(*exit, GOES_DIRECTION, *direction));
            out.push(Claim::new(*exit, LEADS_TO, *to));
        }

        // Lookables: brass + stone plaque.
        for (id, adjective, description) in [
            (LOOKABLE_BRASS_PLAQUE, "brass", BRASS_PLAQUE_DESCRIPTION),
            (LOOKABLE_STONE_PLAQUE, "stone", STONE_PLAQUE_DESCRIPTION),
        ] {
            out.push(Claim::new(id, IS_A_TERM, "lookable"));
            out.push(Claim::new(ROOM_HALL, CONTAINS, id));
            out.push(Claim::new(id, HAS_NAME, PLAQUE_KEYWORD));
            out.push(Claim::new(id, HAS_ADJECTIVE, adjective));
            out.push(Claim::new(id, HAS_DESCRIPTION, description));
        }

        // Noise.
        out.push(Claim::new(NOISE_CLANK, IS_A_TERM, "noise"));
        out.push(Claim::new(NOISE_CLANK, NOISE_LOCATED_AT, ROOM_HALL));
        out.push(Claim::new(NOISE_CLANK, HAS_NOISE_WEIGHT, "1"));
        out.push(Claim::new(NOISE_CLANK, HAS_NOISE_TEXT, NOISE_CLANK_TEXT));

        // NPC: wanders the three rooms, region-locked.
        out.push(Claim::new(NPC_MOUSE, IS_A_TERM, "npc"));
        out.push(Claim::new(ROOM_HALL, CONTAINS, NPC_MOUSE));
        out.push(Claim::new(NPC_MOUSE, HAS_NAME, NPC_MOUSE_NAME));
        out.push(Claim::new(
            NPC_MOUSE,
            HAS_DESCRIPTION,
            "A small test-fixture mouse that wanders the test rooms.",
        ));
        out.push(Claim::new(NPC_MOUSE, HAS_ANIMATION, ROAM_ANIMATION));
        out.push(Claim::new(NPC_MOUSE, REGION_LOCKED_TO, AREA_TEST));

        // Scene-level spawn declaration.
        out.push(Claim::new(IDENTITY, HAS_SPAWN_ROOM, ROOM_HALL));

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_declares_spawn_room() {
        let claims = MudTestingScene.claims();
        assert!(claims.iter().any(|c| c.subject == IDENTITY
            && c.predicate == HAS_SPAWN_ROOM
            && c.object == ROOM_HALL));
    }

    #[test]
    fn every_room_has_name_and_description() {
        let claims = MudTestingScene.claims();
        for room in [ROOM_HALL, ROOM_NORTH, ROOM_SOUTH] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == room && c.predicate == HAS_NAME),
                "missing has-name for {room}"
            );
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == room && c.predicate == HAS_DESCRIPTION),
                "missing has-description for {room}"
            );
        }
    }

    #[test]
    fn exits_land_on_defined_rooms() {
        let rooms: std::collections::HashSet<&str> =
            [ROOM_HALL, ROOM_NORTH, ROOM_SOUTH].into_iter().collect();
        for (_, _, _, to) in EXITS {
            assert!(rooms.contains(to), "exit lands on undefined room {to}");
        }
    }

    #[test]
    fn every_exit_has_direction_and_destination() {
        let claims = MudTestingScene.claims();
        for (_, exit, _, _) in EXITS {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *exit && c.predicate == GOES_DIRECTION),
                "exit {exit} missing goes-direction"
            );
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == *exit && c.predicate == LEADS_TO),
                "exit {exit} missing leads-to"
            );
        }
    }

    #[test]
    fn two_plaques_disambiguate_by_adjective() {
        let claims = MudTestingScene.claims();
        // Both plaques share the same noun (PLAQUE_KEYWORD).
        assert!(claims.iter().any(|c| c.subject == LOOKABLE_BRASS_PLAQUE
            && c.predicate == HAS_NAME
            && c.object == PLAQUE_KEYWORD));
        assert!(claims.iter().any(|c| c.subject == LOOKABLE_STONE_PLAQUE
            && c.predicate == HAS_NAME
            && c.object == PLAQUE_KEYWORD));
        // Distinct adjectives.
        assert!(claims.iter().any(|c| c.subject == LOOKABLE_BRASS_PLAQUE
            && c.predicate == HAS_ADJECTIVE
            && c.object == "brass"));
        assert!(claims.iter().any(|c| c.subject == LOOKABLE_STONE_PLAQUE
            && c.predicate == HAS_ADJECTIVE
            && c.object == "stone"));
    }

    #[test]
    fn mouse_is_in_hall_and_region_locked() {
        let claims = MudTestingScene.claims();
        assert!(claims.iter().any(|c| c.subject == ROOM_HALL
            && c.predicate == CONTAINS
            && c.object == NPC_MOUSE));
        assert!(claims.iter().any(|c| c.subject == NPC_MOUSE
            && c.predicate == REGION_LOCKED_TO
            && c.object == AREA_TEST));
        assert!(claims.iter().any(|c| c.subject == NPC_MOUSE
            && c.predicate == HAS_ANIMATION
            && c.object == ROAM_ANIMATION));
    }
}
