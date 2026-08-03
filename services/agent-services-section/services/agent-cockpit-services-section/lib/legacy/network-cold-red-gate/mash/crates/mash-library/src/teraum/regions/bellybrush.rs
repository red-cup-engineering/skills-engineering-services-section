//! Bellybrush — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:bellybrush-arathel-road", "Arathel Road", "This is Arathel Road, in the north part of the town of Bellybrush.", "region:bellybrush", "culture:brusher"),
    ("area:bellybrush-east-harbrook-street", "Harbrook Street", "This is east Harbrook Street, in the north part of the town of Bellybrush.", "region:bellybrush", "culture:brusher"),
    ("area:bellybrush-east-kingsroad", "Kingsroad", "This is the Kingsroad at its eastern end, within the town of Bellybrush.", "region:bellybrush", "culture:brusher"),
    ("area:bellybrush-forth-and-wahl", "Forth & Wahl", "This is Forth & Wahl, a construction company that specializes in repairing the clay walls that are common through Bellybrush. Debatably ironically, there is a large crack in the south wall.", "region:bellybrush", ""),
    ("area:bellybrush-kingsroad-outside-orphanage", "Kingsroad", "This is the Kingsroad, in the town of Bellybrush, outside Mother Jaffa's Orphanage, off the north side of the street.", "region:bellybrush", "culture:brusher"),
    ("area:bellybrush-west-harbrook-street", "Harbrook Street", "This is west Harbrook Street, in the north part of the town of Bellybrush.", "region:bellybrush", "culture:brusher"),
    ("area:bellybrush-west-kingsroad", "Kingsroad", "This is the Kingsroad at its western end, within the town of Bellybrush.", "region:bellybrush", "culture:brusher"),
    ("area:bellybrush-westgate", "Westgate", "This is the road by and under Westgate, a limestone folly built in the town of Bellybrush.", "region:bellybrush", "culture:brusher"),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:bellybrush-arathel-road", "exit:bellybrush-arathel-road-east", "east", "has-east-exit", "area:bellybrush-east-harbrook-street"),
    ("area:bellybrush-arathel-road", "exit:bellybrush-arathel-road-west", "west", "has-west-exit", "area:bellybrush-west-harbrook-street"),
    ("area:bellybrush-arathel-road", "exit:bellybrush-arathel-road-northwest", "northwest", "has-northwest-exit", "area:south-arathel-bellybrush-road"),
    ("area:bellybrush-east-harbrook-street", "exit:bellybrush-east-harbrook-street-south", "south", "has-south-exit", "area:bellybrush-east-kingsroad"),
    ("area:bellybrush-east-harbrook-street", "exit:bellybrush-east-harbrook-street-west", "west", "has-west-exit", "area:bellybrush-arathel-road"),
    ("area:bellybrush-east-kingsroad", "exit:bellybrush-east-kingsroad-north", "north", "has-north-exit", "area:bellybrush-east-harbrook-street"),
    ("area:bellybrush-east-kingsroad", "exit:bellybrush-east-kingsroad-east", "east", "has-east-exit", "area:sherwyn-county-kingsroad"),
    ("area:bellybrush-east-kingsroad", "exit:bellybrush-east-kingsroad-west", "west", "has-west-exit", "area:bellybrush-kingsroad-outside-orphanage"),
    ("area:bellybrush-kingsroad-outside-orphanage", "exit:bellybrush-kingsroad-outside-orphanage-east", "east", "has-east-exit", "area:bellybrush-east-kingsroad"),
    ("area:bellybrush-kingsroad-outside-orphanage", "exit:bellybrush-kingsroad-outside-orphanage-west", "west", "has-west-exit", "area:bellybrush-west-kingsroad"),
    ("area:bellybrush-west-harbrook-street", "exit:bellybrush-west-harbrook-street-east", "east", "has-east-exit", "area:bellybrush-arathel-road"),
    ("area:bellybrush-west-harbrook-street", "exit:bellybrush-west-harbrook-street-south", "south", "has-south-exit", "area:bellybrush-westgate"),
    ("area:bellybrush-west-kingsroad", "exit:bellybrush-west-kingsroad-north", "north", "has-north-exit", "area:bellybrush-westgate"),
    ("area:bellybrush-west-kingsroad", "exit:bellybrush-west-kingsroad-east", "east", "has-east-exit", "area:bellybrush-kingsroad-outside-orphanage"),
    ("area:bellybrush-west-kingsroad", "exit:bellybrush-west-kingsroad-west", "west", "has-west-exit", "area:ack-eastgate"),
    ("area:bellybrush-westgate", "exit:bellybrush-westgate-north", "north", "has-north-exit", "area:bellybrush-west-harbrook-street"),
    ("area:bellybrush-westgate", "exit:bellybrush-westgate-south", "south", "has-south-exit", "area:bellybrush-west-kingsroad"),
];

pub(super) const TRIVIA: &[Trivia] = &[];

pub(super) const LOOKABLES: &[Lookable] = &[];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[];
