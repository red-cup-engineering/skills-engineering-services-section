//! Pled County — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:pled-county-daughts-cottage", "Daught's Cottage", "This is a single-room cottage, where Daught, an herbcrafter, lives.", "region:pled-county", "culture:deltan"),
    ("area:pled-county-west-arathel-pled-road", "Arathel-Pled Road", "This is the western part of the road between Arathel and Pled Counties, itself in what would be considered western Pled County. The road itself is well-packed dirt, with clear ruts from wagon wheels. Short stone walls border both sides of the road, marking the fields where local farmers graze their sheep. The road leads west toward Arathel County, and east toward Pled County. The road east has been flooded.", "region:pled-county", "culture:deltan"),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:pled-county-daughts-cottage", "exit:pled-county-daughts-cottage-south", "south", "has-south-exit", "area:pled-county-west-arathel-pled-road"),
    ("area:pled-county-west-arathel-pled-road", "exit:pled-county-west-arathel-pled-road-north", "north", "has-north-exit", "area:pled-county-daughts-cottage"),
    ("area:pled-county-west-arathel-pled-road", "exit:pled-county-west-arathel-pled-road-west", "west", "has-west-exit", "area:south-arathel-west-arathel-pled-road"),
];

pub(super) const TRIVIA: &[Trivia] = &[];

pub(super) const LOOKABLES: &[Lookable] = &[];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[
    ("npc:pled-county-daughts-cottage-daught", "area:pled-county-daughts-cottage", "Daught", "This is Daught, a short masculine herbalist.", "", &[]),
];
