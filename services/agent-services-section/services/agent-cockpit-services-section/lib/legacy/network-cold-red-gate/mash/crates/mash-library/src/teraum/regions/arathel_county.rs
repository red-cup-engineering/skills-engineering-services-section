//! Arathel County — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:arathel-county-arathel", "Arathel", "This is Arathel, the human-populated county seat of Arathel County. The town exists straddling the Kaiper River, with the old town on the eastern side and newer development on the west.", "region:arathel-county", "culture:arathellan"),
    ("area:arathel-county-first-church-of-povator", "First Church of Povator", "This is the First Church of Povator, an old and sprawling facility dedicated to the appreciation of Povator, a god of woodlands. Since the Break, the church has been mostly empty, used as storage for various gentry and bureaucrats operating in Arathel County.", "region:arathel-county", "culture:arathellan"),
    ("area:arathel-county-kaiper-river", "Kaiper River", "This is the Kaiper River, which runs from the north to south through Arathel County.", "region:arathel-county", "culture:arathellan"),
    ("area:arathel-county-old-arathel", "Old Arathel", "This is Old Arathel: the eastern part of modern Arathel. Most of the buildings here were built before the Break, modest works of immaculate carpentry.", "region:arathel-county", "culture:arathellan"),
    ("area:arathel-county-reinhard-lumberworks", "Reinhard Lumberworks", "This is inside Reinhard Lumberworks, a living museum maintained by the local Carpenter's Union.", "region:arathel-county", "culture:arathellan"),
    ("area:arathel-county-second-church-of-povator", "Second Church of Povator", "This is the Second Church of Povator, an old and compact building that shows off the most cutting-edge carpentry aesthetics of four centuries ago.", "region:arathel-county", "culture:arathellan"),
    ("area:arathel-county-siggrit-temple", "Siggrit Temple", "This is Siggrit Temple, a squat limestone structure in Old Arathel. Siggrit was a god of earthworms.", "region:arathel-county", "culture:arathellan"),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:arathel-county-arathel", "exit:arathel-county-arathel-northeast", "northeast", "has-northeast-exit", "area:arathel-county-kaiper-river"),
    ("area:arathel-county-arathel", "exit:arathel-county-arathel-east", "east", "has-east-exit", "area:arathel-county-old-arathel"),
    ("area:arathel-county-arathel", "exit:arathel-county-arathel-southeast", "southeast", "has-southeast-exit", "area:arathel-county-reinhard-lumberworks"),
    ("area:arathel-county-first-church-of-povator", "exit:arathel-county-first-church-of-povator-northeast", "northeast", "has-northeast-exit", "area:arathel-county-old-arathel"),
    ("area:arathel-county-kaiper-river", "exit:arathel-county-kaiper-river-southeast", "southeast", "has-southeast-exit", "area:arathel-county-old-arathel"),
    ("area:arathel-county-kaiper-river", "exit:arathel-county-kaiper-river-southwest", "southwest", "has-southwest-exit", "area:arathel-county-arathel"),
    ("area:arathel-county-old-arathel", "exit:arathel-county-old-arathel-north", "north", "has-north-exit", "area:arathel-county-siggrit-temple"),
    ("area:arathel-county-old-arathel", "exit:arathel-county-old-arathel-southwest", "southwest", "has-southwest-exit", "area:arathel-county-first-church-of-povator"),
    ("area:arathel-county-old-arathel", "exit:arathel-county-old-arathel-west", "west", "has-west-exit", "area:arathel-county-old-arathel"),
    ("area:arathel-county-old-arathel", "exit:arathel-county-old-arathel-northwest", "northwest", "has-northwest-exit", "area:arathel-county-kaiper-river"),
    ("area:arathel-county-reinhard-lumberworks", "exit:arathel-county-reinhard-lumberworks-northwest", "northwest", "has-northwest-exit", "area:arathel-county-arathel"),
    ("area:arathel-county-second-church-of-povator", "exit:arathel-county-second-church-of-povator-southwest", "southwest", "has-southwest-exit", "area:arathel-county-arathel"),
    ("area:arathel-county-siggrit-temple", "exit:arathel-county-siggrit-temple-south", "south", "has-south-exit", "area:arathel-county-old-arathel"),
];

pub(super) const TRIVIA: &[Trivia] = &[
    ("area:arathel-county-arathel", "Prior to 72aB, Arathel County was the capital of the Astar Empire."),
    ("area:arathel-county-arathel", "The town of Arathel, in the northern Green Delta, was first settled by humans in 478bB."),
    ("area:arathel-county-arathel", "One of the first businesses in Arathel was the Reinhard Lumber Mill, built in 477bB, founded by Osmits Reinhard."),
    ("area:arathel-county-arathel", "Arathel's first industry was exporting lumber to the fisherfolk of Ack."),
    ("area:arathel-county-arathel", "The First Church of Povator, in the town of Arathel in the Green Delta, was built in 474bB, to honor a god of woodlands."),
    ("area:arathel-county-arathel", "The Reinhard Estate, in the town of Arathel in the Green Delta, was built in 470bB, by Osmits Reinhard, founder of the Reinhard Lumber Mill."),
    ("area:arathel-county-arathel", "In 462bB, Osmits Reinhard, an aristocrat from the town of Arathel, commissioned the planting of the Borderwood, a pine forest that once stretched from Arathel to Ack."),
    ("area:arathel-county-arathel", "In 460bB, Osmits Reinhard, an aristocrat from the town of Arathel, was hanged in the town square for failing to pay his workers."),
    ("area:arathel-county-arathel", "In 460bB, workers hanged Osmits Reinhard, the owner of Reinhard Lumber Mill, and seized control of the facilities."),
    ("area:arathel-county-arathel", "The First Church of Povator, in the town of Arathel, was expanded in 460bB using the seized assets of the executed aristocrat Osmits Reinhard."),
    ("area:arathel-county-arathel", "In 454bB, residents of the town of Arathel built the Temple of Siggrit, a god of earthworms."),
    ("area:arathel-county-arathel", "In 438bB, Henri Astar from the town of Arathel hired a militia and attacked the humans living south of the Green Delta, in what was then the Indenon Empire."),
    ("area:arathel-county-arathel", "The Astar Empire was founded in the town of Arathel by Henri Astar, a local aristocrat."),
    ("area:arathel-county-first-church-of-povator", "The First Church of Povator in Old Arathel, was built in 474bB."),
    ("area:arathel-county-kaiper-river", "The Kaiper River has an unusual path, flowing north to south instead of more directly toward the Optic Ocean. This is due to the area's shifting geology, pushing the water inland and helping wash the County with silt."),
    ("area:arathel-county-reinhard-lumberworks", "The original building of the Reinhard Lumberworks was constructed in 477bB by Osmits Reinhard."),
    ("area:arathel-county-second-church-of-povator", "The Second Church of Povator in Arathel was built in 442bB."),
    ("area:arathel-county-siggrit-temple", "Siggrit Temple in Old Arathel was built in 454bB."),
];

pub(super) const LOOKABLES: &[Lookable] = &[];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[
    ("npc:arathel-county-old-arathel-clean-old-bricks", "area:arathel-county-old-arathel", "clean old bricks", "The bricks that are used to pave the town square are clearly old, but are also the bright red that only recently cleaned bricks are.", "", &[]),
    ("npc:arathel-county-reinhard-lumberworks-bust-of-osmits-reinhard", "area:arathel-county-reinhard-lumberworks", "bust of Osmits Reinhard", "This is a wooden bust of a rather angular and severe-looking masculine human. A small brass plaque screwed into the base declares the subject's name, Osmits Reinhard, and the years during which he lived: 503bB to 460bB", "", &[]),
];
