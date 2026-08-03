//! Per-region data tables plus the region hierarchy, culture
//! hierarchy, and composite-area list. Generated-style data;
//! instance-ported from the old-library `regions/` directory.

use super::tables::*;

pub(super) mod ack;
pub(super) mod arathel_county;
pub(super) mod belcaer;
pub(super) mod bellybrush;
pub(super) mod central_plains;
pub(super) mod cut;
pub(super) mod farsteppes;
pub(super) mod game;
pub(super) mod gloaming;
pub(super) mod gnalens;
pub(super) mod honeyfern_labs;
pub(super) mod jacobs_folly;
pub(super) mod marby_county;
pub(super) mod oru_valley;
pub(super) mod pled_county;
pub(super) mod sherwyn_county;
pub(super) mod south_arathel;

/// `(region-slug, rooms, exits, trivia, lookables, noises, npcs)`.
pub(super) type RegionTables = (
    &'static str,
    &'static [Area],
    &'static [Exit],
    &'static [Trivia],
    &'static [Lookable],
    &'static [Noise],
    &'static [Npc],
);

pub(super) const REGIONS: &[RegionTables] = &[
    ("ack", ack::AREAS, ack::EXITS, ack::TRIVIA, ack::LOOKABLES, ack::NOISES, ack::NPCS),
    ("arathel-county", arathel_county::AREAS, arathel_county::EXITS, arathel_county::TRIVIA, arathel_county::LOOKABLES, arathel_county::NOISES, arathel_county::NPCS),
    ("belcaer", belcaer::AREAS, belcaer::EXITS, belcaer::TRIVIA, belcaer::LOOKABLES, belcaer::NOISES, belcaer::NPCS),
    ("bellybrush", bellybrush::AREAS, bellybrush::EXITS, bellybrush::TRIVIA, bellybrush::LOOKABLES, bellybrush::NOISES, bellybrush::NPCS),
    ("central-plains", central_plains::AREAS, central_plains::EXITS, central_plains::TRIVIA, central_plains::LOOKABLES, central_plains::NOISES, central_plains::NPCS),
    ("cut", cut::AREAS, cut::EXITS, cut::TRIVIA, cut::LOOKABLES, cut::NOISES, cut::NPCS),
    ("farsteppes", farsteppes::AREAS, farsteppes::EXITS, farsteppes::TRIVIA, farsteppes::LOOKABLES, farsteppes::NOISES, farsteppes::NPCS),
    ("game", game::AREAS, game::EXITS, game::TRIVIA, game::LOOKABLES, game::NOISES, game::NPCS),
    ("gloaming", gloaming::AREAS, gloaming::EXITS, gloaming::TRIVIA, gloaming::LOOKABLES, gloaming::NOISES, gloaming::NPCS),
    ("gnalens", gnalens::AREAS, gnalens::EXITS, gnalens::TRIVIA, gnalens::LOOKABLES, gnalens::NOISES, gnalens::NPCS),
    ("honeyfern-labs", honeyfern_labs::AREAS, honeyfern_labs::EXITS, honeyfern_labs::TRIVIA, honeyfern_labs::LOOKABLES, honeyfern_labs::NOISES, honeyfern_labs::NPCS),
    ("jacobs-folly", jacobs_folly::AREAS, jacobs_folly::EXITS, jacobs_folly::TRIVIA, jacobs_folly::LOOKABLES, jacobs_folly::NOISES, jacobs_folly::NPCS),
    ("marby-county", marby_county::AREAS, marby_county::EXITS, marby_county::TRIVIA, marby_county::LOOKABLES, marby_county::NOISES, marby_county::NPCS),
    ("oru-valley", oru_valley::AREAS, oru_valley::EXITS, oru_valley::TRIVIA, oru_valley::LOOKABLES, oru_valley::NOISES, oru_valley::NPCS),
    ("pled-county", pled_county::AREAS, pled_county::EXITS, pled_county::TRIVIA, pled_county::LOOKABLES, pled_county::NOISES, pled_county::NPCS),
    ("sherwyn-county", sherwyn_county::AREAS, sherwyn_county::EXITS, sherwyn_county::TRIVIA, sherwyn_county::LOOKABLES, sherwyn_county::NOISES, sherwyn_county::NPCS),
    ("south-arathel", south_arathel::AREAS, south_arathel::EXITS, south_arathel::TRIVIA, south_arathel::LOOKABLES, south_arathel::NOISES, south_arathel::NPCS),
];

// ─────────────────────────────────────────────────────────────────────
// Region hierarchy — `(subject, parent-or-empty, name, description)`.
// ─────────────────────────────────────────────────────────────────────

pub(super) const REGIONS_LIST: &[Region] = &[
    ("region:eastlands", "", "Eastlands", ""),
    ("region:westlands", "", "Westlands", ""),
    ("region:central-plains", "region:eastlands", "Central Plains", ""),
    ("region:cut", "region:eastlands", "Cut", ""),
    ("region:farsteppes", "region:eastlands", "Farsteppes", ""),
    ("region:gloaming", "region:eastlands", "Gloaming", ""),
    ("region:belcaer", "region:gloaming", "Belcaer", ""),
    ("region:jacobs-folly", "region:gloaming", "Jacob's Folly", ""),
    ("region:green-delta", "region:eastlands", "Green Delta", ""),
    ("region:arathel-county", "region:green-delta", "Arathel County", ""),
    ("region:game", "region:green-delta", "Game", ""),
    ("region:ack", "region:game", "Ack", ""),
    ("region:brass-ward", "region:ack", "Brass Ward", ""),
    ("region:dock-ward", "region:ack", "Dock Ward", ""),
    ("region:bellybrush", "region:game", "Bellybrush", ""),
    ("region:south-arathel", "region:game", "South Arathel", ""),
    ("region:honeyfern-labs", "region:south-arathel", "Honeyfern Labs", ""),
    ("region:marby-county", "region:green-delta", "Marby County", ""),
    ("region:pled-county", "region:green-delta", "Pled County", ""),
    ("region:sherwyn-county", "region:green-delta", "Sherwyn County", ""),
    ("region:halfling-country", "region:westlands", "Halfling Country", ""),
    ("region:gnalens", "region:halfling-country", "Gnalens", ""),
    ("region:oru-valley", "region:westlands", "Oru Valley", ""),
];

// ─────────────────────────────────────────────────────────────────────
// Culture hierarchy — `(subject, parent-or-empty, name)`.
// ─────────────────────────────────────────────────────────────────────

pub(super) const CULTURES: &[Culture] = &[
    ("culture:teraumi", "", "Teraumi"),
    ("culture:ackian", "culture:teraumi", "Ackian"),
    ("culture:arathellan", "culture:teraumi", "Arathellan"),
    ("culture:brusher", "culture:teraumi", "Brusher"),
    ("culture:cutter", "culture:teraumi", "Cutter"),
    ("culture:deltan", "culture:teraumi", "Deltan"),
    ("culture:gamer", "culture:teraumi", "Gamer"),
    ("culture:gloamer", "culture:teraumi", "Gloamer"),
    ("culture:belkite", "culture:gloamer", "Belkite"),
    ("culture:gnalinne", "culture:teraumi", "Gnalinne"),
    ("culture:sherwyn", "culture:teraumi", "Sherwyn"),
    ("culture:stepper", "culture:teraumi", "Stepper"),
];

// ─────────────────────────────────────────────────────────────────────
// Composite-area rows: subjects that are both an area (a place) and
// a region (a container of sub-places).
// ─────────────────────────────────────────────────────────────────────

pub(super) const COMPOSITE_AREAS: &[Area] = &[
    ("area:ack", "Ack", "This is Ack, the district-as-a-whole.", "region:ack", "culture:ackian"),
    ("area:brass-ward", "Brass Ward", "This is Brass Ward, the district-as-a-whole.", "region:brass-ward", "culture:ackian"),
    ("area:dock-ward", "Dock Ward", "This is Dock Ward, the district-as-a-whole.", "region:dock-ward", "culture:ackian"),
];
