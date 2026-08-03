//! Jacobs Folly — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:jacobs-folly-outside", "Jacob's Folly", "This is the field outside Jacob's Folly. It is a tower: three storeys and made of the same limestone as the small crags that jut up into the field, forcing the dirt path to meander, and preventing a clear view of the entire area. The door of the tower has been recently sealed with mortared stone. Wooden stakes driven into the mortar between the tower's stones could, but doesn't, provide access to the open third floor window.", "region:jacobs-folly", ""),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:jacobs-folly-outside", "exit:jacobs-folly-outside-west", "west", "has-west-exit", "area:gloaming-road-to-jacobs-folly"),
];

pub(super) const TRIVIA: &[Trivia] = &[];

pub(super) const LOOKABLES: &[Lookable] = &[];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[];
