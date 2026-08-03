//! Farsteppes — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:farsteppes-castle-oru", "Castle Oru", "This is Castle Oru, though people living in distant meddlesome empires might disagree about that name.", "region:farsteppes", "culture:stepper"),
    ("area:farsteppes-culver-estate", "Culver Estate", "This is the Culver Estate. It's not quite a castle, but it's also not what anyone would call a \"house\", and \"mansion\" doesn't fit either.", "region:farsteppes", "culture:stepper"),
    ("area:farsteppes-helmets-dent", "Helmet's Dent", "This is the town of Helmet's Dent. It is the largest town in the Farsteppes, existing around a large market where traders from the local nomadic tribes do business with merchants from the Central Plains and Green Delta. The buildings of the town reflect the diverse population, highlighting architectural styles from around the world.", "region:farsteppes", "culture:stepper"),
    ("area:farsteppes-kingsroad", "Kingsroad", "This is the Kingsroad, a road that runs from the old dwarven enclaves in the Worldkeepers all the way to the Optic Ocean.", "region:farsteppes", "culture:stepper"),
    ("area:farsteppes-road-to-culver-estate", "road to Culver Estate", "This is a stretch of the road between the town of Helmet's Dent and the nearby Culver Estate. The road runs through one of the few groves in the area.", "region:farsteppes", "culture:stepper"),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:farsteppes-castle-oru", "exit:farsteppes-castle-oru-southwest", "southwest", "has-southwest-exit", "area:farsteppes-helmets-dent"),
    ("area:farsteppes-culver-estate", "exit:farsteppes-culver-estate-west", "west", "has-west-exit", "area:farsteppes-road-to-culver-estate"),
    ("area:farsteppes-helmets-dent", "exit:farsteppes-helmets-dent-northeast", "northeast", "has-northeast-exit", "area:farsteppes-castle-oru"),
    ("area:farsteppes-helmets-dent", "exit:farsteppes-helmets-dent-southeast", "southeast", "has-southeast-exit", "area:farsteppes-road-to-culver-estate"),
    ("area:farsteppes-helmets-dent", "exit:farsteppes-helmets-dent-west", "west", "has-west-exit", "area:farsteppes-kingsroad"),
    ("area:farsteppes-kingsroad", "exit:farsteppes-kingsroad-east", "east", "has-east-exit", "area:farsteppes-helmets-dent"),
    ("area:farsteppes-kingsroad", "exit:farsteppes-kingsroad-west", "west", "has-west-exit", "area:central-plains-east-kingsroad"),
    ("area:farsteppes-road-to-culver-estate", "exit:farsteppes-road-to-culver-estate-east", "east", "has-east-exit", "area:farsteppes-culver-estate"),
    ("area:farsteppes-road-to-culver-estate", "exit:farsteppes-road-to-culver-estate-northwest", "northwest", "has-northwest-exit", "area:farsteppes-helmets-dent"),
];

pub(super) const TRIVIA: &[Trivia] = &[
    ("area:farsteppes-castle-oru", "Castle Oru, in the Farsteppes, is named for the apocryphal Castle Oru of the Unseen Sea."),
];

pub(super) const LOOKABLES: &[Lookable] = &[];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[
    ("npc:farsteppes-castle-oru-renkah-oru", "area:farsteppes-castle-oru", "Renkah Oru", "Renkah Oru is a tremendously large and broad feminine human.", "", &[]),
    ("npc:farsteppes-helmets-dent-susan-baff", "area:farsteppes-helmets-dent", "Susan Baff", "Susan Baff is a feminine human who lives in Helmet's Dent, wokring as a cleaner and clerk for various businesses in town.", "", &[]),
    ("npc:farsteppes-helmets-dent-tyjeer-baff", "area:farsteppes-helmets-dent", "Tyjeer Baff", "This is Tyjeer Baff, a masculine human around 12 or 13 years old.", "", &[]),
    ("npc:farsteppes-helmets-dent-nash-celson", "area:farsteppes-helmets-dent", "Nash Celson", "Nash Celson is a non-descript masculine adult human.", "", &[]),
    ("npc:farsteppes-helmets-dent-ragar", "area:farsteppes-helmets-dent", "ragar", "This is a clay bottle filled with ragar: fermented mares milk. It was made by the Lazy Mare Tribe of the Farsteppes.", "", &[]),
];
