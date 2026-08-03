//! Gloaming — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:gloaming-central-longroad", "Longroad", "This is Longroad, within the Gloaming.", "region:gloaming", ""),
    ("area:gloaming-north-longroad", "Longroad", "This is a stretch of the Longroad, as it meanders into the marshy Gloaming. The road ends not too far to the north, as it intersects with the Kingsroad, but it extends hundreds of miles south and southeast from here. Eventually, it ends at the gates of Tayopopopolis, a massive city in the Unseen Sea.", "region:gloaming", ""),
    ("area:gloaming-road-to-jacobs-folly", "road in the Gloaming", "This is a thin path in the Gloaming, leading from the Longroad to Jacob's Folly.", "region:gloaming", ""),
    ("area:gloaming-south-longroad", "Longroad", "This is Longroad, within the Gloaming. The way south has been blocked by deliberately laid-down trees.", "region:gloaming", ""),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:gloaming-central-longroad", "exit:gloaming-central-longroad-north", "north", "has-north-exit", "area:gloaming-north-longroad"),
    ("area:gloaming-central-longroad", "exit:gloaming-central-longroad-south", "south", "has-south-exit", "area:gloaming-south-longroad"),
    ("area:gloaming-central-longroad", "exit:gloaming-central-longroad-west", "west", "has-west-exit", "area:belcaer-lobby"),
    ("area:gloaming-north-longroad", "exit:gloaming-north-longroad-north", "north", "has-north-exit", "area:central-plains-west-kingsroad-1"),
    ("area:gloaming-north-longroad", "exit:gloaming-north-longroad-south", "south", "has-south-exit", "area:gloaming-central-longroad"),
    ("area:gloaming-road-to-jacobs-folly", "exit:gloaming-road-to-jacobs-folly-east", "east", "has-east-exit", "area:jacobs-folly-outside"),
    ("area:gloaming-road-to-jacobs-folly", "exit:gloaming-road-to-jacobs-folly-southwest", "southwest", "has-southwest-exit", "area:gloaming-south-longroad"),
    ("area:gloaming-south-longroad", "exit:gloaming-south-longroad-north", "north", "has-north-exit", "area:gloaming-central-longroad"),
    ("area:gloaming-south-longroad", "exit:gloaming-south-longroad-northeast", "northeast", "has-northeast-exit", "area:gloaming-road-to-jacobs-folly"),
];

pub(super) const TRIVIA: &[Trivia] = &[];

pub(super) const LOOKABLES: &[Lookable] = &[
    ("lookable:gloaming-north-longroad-longroad", "area:gloaming-north-longroad", "Longroad", "The Longroad ends not too far to the north, as it intersects with the Kingsroad, but it extends hundreds of miles south and southeast from here. Eventually, after passing through the Gloaming, into the Unseen Sea, it ends at the gates of the human city of Tayopopolis. The road itself is gray gravel, notable for being different in colour than the indigenous stone, which has a more red hue."),
    ("lookable:gloaming-north-longroad-gray-gravel", "area:gloaming-north-longroad", "gray gravel", "The gray gravel that paves the Longroad is clearly not from here."),
];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[];
