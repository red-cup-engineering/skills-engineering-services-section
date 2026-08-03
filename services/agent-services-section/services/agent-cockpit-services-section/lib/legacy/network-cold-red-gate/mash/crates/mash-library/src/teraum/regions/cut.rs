//! Cut — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:cut-central-oasis", "central oasis", "This is the center of the Cut. The area is almost riparian, though there's no obvious waterways. Birds fly overhead, and sedges rustle in the persistent breeze, which carries scents of musky flowers. There is a small abandoned water pump built by the Red Union near the south of the oasis, with a large iron pipe running into the north, into the canyon wall. Solid canyon walls several hundred meters high bound the north and west of this oasis, but passes to the south and east allow access to the canyon network.", "region:cut", "culture:cutter"),
    ("area:cut-eastern-canyons", "canyons", "", "region:cut", "culture:cutter"),
    ("area:cut-southern-canyons", "canyons", "", "region:cut", "culture:cutter"),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:cut-central-oasis", "exit:cut-central-oasis-east", "east", "has-east-exit", "area:cut-eastern-canyons"),
    ("area:cut-central-oasis", "exit:cut-central-oasis-south", "south", "has-south-exit", "area:cut-southern-canyons"),
    ("area:cut-eastern-canyons", "exit:cut-eastern-canyons-west", "west", "has-west-exit", "area:cut-central-oasis"),
    ("area:cut-southern-canyons", "exit:cut-southern-canyons-north", "north", "has-north-exit", "area:cut-central-oasis"),
    ("area:cut-southern-canyons", "exit:cut-southern-canyons-south", "south", "has-south-exit", "area:central-plains-west-kingsroad-1"),
];

pub(super) const TRIVIA: &[Trivia] = &[];

pub(super) const LOOKABLES: &[Lookable] = &[];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[];
