//! Beastiary: creature species.

/// `(species-id, name, type-line, notes)`.
pub(super) type BeastEntry = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

pub(super) const BEASTIARY: &[BeastEntry] = &[
    ("species:aardvark-sloth", "Aardvark Sloth", "Medium beast, unaligned", ""),
    ("species:badgerdillo", "Badgerdillo", "Medium beast, unaligned", ""),
    ("species:boarqupine", "Boarqupine", "Large beast, unaligned", ""),
    ("species:baarilla", "Baarilla", "Large beast, unaligned", "sheep/gorilla hybrid"),
    ("species:buzzard", "Buzzard", "Medium beast, unaligned", "wasp/buzzard hybrid"),
    ("species:catigator", "Catigator", "Large beast, unaligned", ""),
    ("species:darkling", "Darkling", "Small fey, chaotic neutral", ""),
    ("species:dessert-gelatin", "Dessert Gelatin", "Medium ooze, unaligned", ""),
    ("species:ratephant", "Ratephant", "Small beast, unaligned", ""),
    ("species:feral-elf", "Feral Elf", "Medium humanoid, chaotic neutral", ""),
    ("species:garlic-boar", "Garlic Boar", "", ""),
    ("species:liondillo", "Liondillo", "Large beast, unaligned", ""),
    ("species:meowl", "Meowl", "Small beast, unaligned", ""),
    ("species:platybear", "Platybear", "Large beast, unaligned", ""),
    ("species:raven", "Raven", "Tiny beast, unaligned", ""),
    ("species:turtleduck", "Turtleduck", "Small beast, unaligned", ""),
    ("species:turtlelion", "Turtlelion", "Large beast, unaligned", ""),
    ("species:turtleseal", "Turtleseal", "Medium beast, unaligned", ""),
    ("species:usually-large-raven", "Usually Large Raven", "Medium beast, unaligned", ""),
    ("species:wolfbat", "Wolfbat", "Large beast, unaligned", ""),
];
