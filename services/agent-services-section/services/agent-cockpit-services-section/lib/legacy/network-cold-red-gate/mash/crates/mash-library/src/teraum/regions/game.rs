//! Game — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:game-kingsroad", "Kingsroad", "This is the Kingsroad between the city of Ack, to the west, and Bellybrush, to the east.", "region:game", "culture:gamer"),
    ("area:game-widdershins-road", "Widdershins Road", "This is the Widdershins Road, which runs from the coast north of Ack to the ssouthern coast, not-quite circling the city.", "region:game", "culture:gamer"),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:game-kingsroad", "exit:game-kingsroad-east", "east", "has-east-exit", "area:bellybrush-west-kingsroad"),
    ("area:game-kingsroad", "exit:game-kingsroad-west", "west", "has-west-exit", "area:ack-eastgate"),
    ("area:game-widdershins-road", "exit:game-widdershins-road-north", "north", "has-north-exit", "area:ack-poplar-gate"),
    ("area:game-widdershins-road", "exit:game-widdershins-road-northeast", "northeast", "has-northeast-exit", "area:ack-piketown-gate"),
    ("area:game-widdershins-road", "exit:game-widdershins-road-northwest", "northwest", "has-northwest-exit", "area:ack-garys-gate"),
];

pub(super) const TRIVIA: &[Trivia] = &[];

pub(super) const LOOKABLES: &[Lookable] = &[];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[
    ("npc:game-widdershins-road-bill-hags", "area:game-widdershins-road", "Bill Hags", "Bill Hags is one of many migrant human workers. He travels the world, doing whatever labour is available.", "", &[]),
];
