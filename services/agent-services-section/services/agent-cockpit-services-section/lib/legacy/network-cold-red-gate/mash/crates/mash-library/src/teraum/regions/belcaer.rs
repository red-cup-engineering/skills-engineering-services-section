//! Belcaer — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:belcaer-chandlers-guild-office", "Chandlers Guild Office", "This is the office of the Chandlers Guild, in Belcaer.", "region:belcaer", "culture:belkite"),
    ("area:belcaer-lobby", "Belcaer", "This is Belcaer, a \"town\" in the Gloaming. The settlement was originally created by powerful magic users, who raised a giant mesa and carved into a fortress. In the years immediately after the Break, Belcaer was squatted by bandits, then adventurers. In recent years, it has been transformed into a large casino complex.", "region:belcaer", "culture:belkite"),
    ("area:belcaer-offices", "Offices", "This is the foyer which leads to the offices of various companies in Belcaer.", "region:belcaer", "culture:belkite"),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:belcaer-chandlers-guild-office", "exit:belcaer-chandlers-guild-office-out", "out", "has-out-exit", "area:belcaer-offices"),
    ("area:belcaer-lobby", "exit:belcaer-lobby-east", "east", "has-east-exit", "area:gloaming-central-longroad"),
    ("area:belcaer-lobby", "exit:belcaer-lobby-offices", "offices", "has-offices-exit", "area:belcaer-offices"),
    ("area:belcaer-offices", "exit:belcaer-offices-out", "out", "has-out-exit", "area:belcaer-lobby"),
    ("area:belcaer-offices", "exit:belcaer-offices-chandlers", "chandlers", "has-chandlers-exit", "area:belcaer-chandlers-guild-office"),
];

pub(super) const TRIVIA: &[Trivia] = &[];

pub(super) const LOOKABLES: &[Lookable] = &[];

pub(super) const NOISES: &[Noise] = &[
    ("noise:belcaer-chandlers-guild-office-abeth-harbrook-0", "npc:belcaer-chandlers-guild-office-abeth-harbrook", "2", "Abeth Harbrook says, \"Most people don't think about how far the paper they use has come.\""),
    ("noise:belcaer-chandlers-guild-office-abeth-harbrook-1", "npc:belcaer-chandlers-guild-office-abeth-harbrook", "1", "Abeth Harbrook says, \"I tried suggesting the casino move to paper instead of coins.\""),
];

pub(super) const NPCS: &[Npc] = &[
    ("npc:belcaer-chandlers-guild-office-abeth-harbrook", "area:belcaer-chandlers-guild-office", "Abeth Harbrook", "Abeth Harbrook is a feminine human. She is the representative of the Chandlers Guild in Belcaer, helping the casino fill its paper and office supply needs.", "", &[]),
];
