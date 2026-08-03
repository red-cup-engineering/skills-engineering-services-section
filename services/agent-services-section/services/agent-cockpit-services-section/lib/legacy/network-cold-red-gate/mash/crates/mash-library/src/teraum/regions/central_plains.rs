//! Central Plains — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:central-plains-east-kingsroad", "Kingsroad", "This is the Kingsroad, toward the eastern border of the Central Plains. To the east are the Farsteppes, and to the west are the Central Plains, and beyond that the Green Delta.", "region:central-plains", ""),
    ("area:central-plains-fort-kelly", "Fort Kelly", "This is Fort Kelly, a human outpost in the central Central Plains. Despite the name, it doesn't appear to be much of a fort. It's mostly a congregation of tents flanking the Kingsroad, though a larger sandstone structure is being constructed on the east side of the \"fort\". There is also an odd swirl right off the road.", "region:central-plains", ""),
    ("area:central-plains-west-kingsroad-1", "Kingsroad", "", "region:central-plains", ""),
    ("area:central-plains-west-kingsroad-2", "Kingsroad", "", "region:central-plains", ""),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:central-plains-east-kingsroad", "exit:central-plains-east-kingsroad-east", "east", "has-east-exit", "area:farsteppes-kingsroad"),
    ("area:central-plains-east-kingsroad", "exit:central-plains-east-kingsroad-west", "west", "has-west-exit", "area:central-plains-fort-kelly"),
    ("area:central-plains-fort-kelly", "exit:central-plains-fort-kelly-east", "east", "has-east-exit", "area:central-plains-east-kingsroad"),
    ("area:central-plains-fort-kelly", "exit:central-plains-fort-kelly-west", "west", "has-west-exit", "area:central-plains-west-kingsroad-1"),
    ("area:central-plains-west-kingsroad-1", "exit:central-plains-west-kingsroad-1-east", "east", "has-east-exit", "area:central-plains-fort-kelly"),
    ("area:central-plains-west-kingsroad-1", "exit:central-plains-west-kingsroad-1-west", "west", "has-west-exit", "area:central-plains-west-kingsroad-2"),
    ("area:central-plains-west-kingsroad-2", "exit:central-plains-west-kingsroad-2-east", "east", "has-east-exit", "area:central-plains-west-kingsroad-1"),
    ("area:central-plains-west-kingsroad-2", "exit:central-plains-west-kingsroad-2-south", "south", "has-south-exit", "area:gloaming-north-longroad"),
    ("area:central-plains-west-kingsroad-2", "exit:central-plains-west-kingsroad-2-west", "west", "has-west-exit", "area:sherwyn-county-kingsroad"),
];

pub(super) const TRIVIA: &[Trivia] = &[];

pub(super) const LOOKABLES: &[Lookable] = &[
    ("lookable:central-plains-fort-kelly-tents", "area:central-plains-fort-kelly", "tents", "Most of the tents here are square and canvas. Most have large letters and numbers stenciled on their sides: tents north of the Kingsroad seem to have odd-numbers, with those south being even-numbered. Each number is preceded by a letter, M, R or W."),
];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[];
