//! Marby County — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:marby-county-eridrin", "Eridrin", "This is the town of Eridrin. It consists of about a dozen wattle cottages erected near the gravel banks of the Marlbreen River, grey with silt. A well-worn road reveals sandy loam under thin topsoil. The road leads northwest to the large town of Bellybrush, and southeast through Marby County.", "region:marby-county", "culture:deltan"),
    ("area:marby-county-north-ack-widewoods-road", "Ack Road", "This is Ack Road, in Marby County.", "region:marby-county", ""),
];

pub(super) const EXITS: &[Exit] = &[];

pub(super) const TRIVIA: &[Trivia] = &[];

pub(super) const LOOKABLES: &[Lookable] = &[
    ("lookable:marby-county-eridrin-wattle-cottages", "area:marby-county-eridrin", "wattle cottages", "There are about a dozen wattle cottages arranged near the road."),
    ("lookable:marby-county-eridrin-gravel-riverbanks", "area:marby-county-eridrin", "gravel riverbanks", "The banks of the Marlbreen River are composed of small round pebbles. Most are an unremarkable beige, but there are a few bright blue pebbles."),
    ("lookable:marby-county-eridrin-bright-blue-pebbles", "area:marby-county-eridrin", "bright blue pebbles", "There are a few bright blue pebbles mixed in with the gravel forming the banks of the Marlbreen River."),
    ("lookable:marby-county-eridrin-beige-gravel", "area:marby-county-eridrin", "beige gravel", "Most of the Marlbreen's banks and floor are covered in beige gravel."),
    ("lookable:marby-county-eridrin-gray-silt", "area:marby-county-eridrin", "gray silt", "Grey silt is suspended in the water of the Marlbreen River, obfuscating its bottom."),
    ("lookable:marby-county-eridrin-goat", "area:marby-county-eridrin", "goat", "This is a goat."),
];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[];
