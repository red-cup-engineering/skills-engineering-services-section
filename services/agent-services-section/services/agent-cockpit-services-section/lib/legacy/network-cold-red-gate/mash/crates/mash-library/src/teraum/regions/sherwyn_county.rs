//! Sherwyn County — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:sherwyn-county-chauntean-monastery", "Chauntean Monastery", "", "region:sherwyn-county", "culture:deltan"),
    ("area:sherwyn-county-kingsroad", "Kingsroad", "", "region:sherwyn-county", "culture:sherwyn"),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:sherwyn-county-kingsroad", "exit:sherwyn-county-kingsroad-east", "east", "has-east-exit", "area:central-plains-west-kingsroad-2"),
    ("area:sherwyn-county-kingsroad", "exit:sherwyn-county-kingsroad-south", "south", "has-south-exit", "area:sherwyn-county-chauntean-monastery"),
    ("area:sherwyn-county-kingsroad", "exit:sherwyn-county-kingsroad-west", "west", "has-west-exit", "area:bellybrush-east-kingsroad"),
];

pub(super) const TRIVIA: &[Trivia] = &[
    ("area:sherwyn-county-chauntean-monastery", "The Chauntean Monastery in Sherwyn County was constructed around 1140bB."),
];

pub(super) const LOOKABLES: &[Lookable] = &[];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[
    ("npc:sherwyn-county-chauntean-monastery-ilea", "area:sherwyn-county-chauntean-monastery", "Ilea", "This is Ilea, a tall red-headed feminine human.", "", &[]),
    ("npc:sherwyn-county-chauntean-monastery-brother-sun", "area:sherwyn-county-chauntean-monastery", "Brother Sun", "This is Brother Sun, an androgynous human wearing orange robes which have been often repaired by not-quite-matching orange thread.", "", &[]),
    ("npc:sherwyn-county-chauntean-monastery-vagrant", "area:sherwyn-county-chauntean-monastery", "Vagrant", "", "", &[]),
];
