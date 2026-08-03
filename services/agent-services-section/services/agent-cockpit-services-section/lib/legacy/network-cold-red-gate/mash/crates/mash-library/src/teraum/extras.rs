//! Extras: minor cast characters.

/// `(extra-id, name, type-line, biography)`.
pub(super) type ExtraEntry = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

pub(super) const EXTRAS: &[ExtraEntry] = &[
    ("extra:barnabus-trent", "Barnabus Trent", "Medium human, neutral good", "20pc. Born somewhere in the coast of the Wide Woods. 30pc. Kidnapped and pressganged. 35pc. Runs away to become an adventurer. 42pc. Joins the Delvers. 49pc. The Merchant Kings placed a bounty on the Delvers. 51pc. Barnabus leaves hiding, is granted a pardon in exchange for accepting Bartleby's curse. 53pc. Establishes Ye Olde Curio Shop in Bellybrush. 8th of Flowers, 80pc. Begins to hear noises at night, notice objects in his shop have been moved or are missing. ___ ___"),
    ("extra:captain-riffolk", "Captain Riffolk", "Medium human, Chaotic Evil", ""),
    ("extra:chauntea", "Chauntea", "Medium outlander, lawful good", ""),
    ("extra:group-of-ruffians", "Group of Ruffians", "Huge group of humans, chaotic neutral", ""),
    ("extra:henry-camden", "Henry Camden", "Medium human, lawful evil", ""),
    ("extra:jelf", "Jelf", "Medium human, chaotic evil", ""),
    ("extra:jerry-the-nothic", "Jerry the Nothic", "Medium aberration, Chaotic Evil", ""),
    ("extra:mother-agnes", "Mother Agnes", "Medium human, lawful good", ""),
    ("extra:nash-celson", "Nash Celson", "Medium human, chaotic evil", ""),
    ("extra:nell-humphreys", "Nell Humphreys", "Small human, chaotic good", ""),
    ("extra:nubbles", "Nubbles", "Medium human, chaotic neutral", ""),
    ("extra:ross-camden", "Ross Camden", "Medium human, lawful evil", ""),
    ("extra:siggrian-graymane", "Siggrian Graymane", "Medium human, chaotic evil", ""),
    ("extra:stevie-the-steward", "Stevie the Steward", "Medium human, lawful good", ""),
    ("extra:thomas", "Thomas", "Medium human, lawful good", ""),
];
