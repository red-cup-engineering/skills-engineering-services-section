//! South Arathel — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:south-arathel-bellybrush-road", "Bellybrush Road", "This is Bellybrush Road, in Arathel County. It leads northwest further toward Arathel County, and southeast, toward Bellybrush.", "region:south-arathel", ""),
    ("area:south-arathel-belys-blades", "Bely's Blades", "This is Bely's Blades, a two-storey stone tower hewn from an outcrop of granite, with a slate roof. It is dimly lit by paper lanterns, and fairly shabby. Ingag Bely sells weapons she buys from adventurers exploring nearby dungeons. A door leads outside, to the Arathel-Ack road.", "region:south-arathel", ""),
    ("area:south-arathel-broken-arrow-inn", "Broken Arrow Inn", "The Broken Arrow Inn is a single-storey stone-walled building, with a small fenced yard and a large cellar. Accommodations consist of several small rooms with wooden cots. The owner, Geda, makes cheddar and whey.", "region:south-arathel", ""),
    ("area:south-arathel-crossed-candles-inn", "Crossed Candles Inn", "This is the Crossed Candles Inn: a simple wooden shack with several shuttered windows. There are a few wooden cots in one corner, and a long table which serves as the bar in another. There are some people seated at the table. A door leads out to Arathel County.", "region:south-arathel", ""),
    ("area:south-arathel-dull-thorn-inn-quarters", "Dull Thorn Inn", "This is the sleeping quarters of the Dull Thorn Inn, a small room off the main inn. There are eight wooden cots scattered around.", "region:south-arathel", ""),
    ("area:south-arathel-dull-thorn-inn", "Dull Thorn Inn", "This is the Dull Thorn Inn. The building is a two-storey timber and brick structure, furnished with well-made tables and chairs. A collection of weapons hangs on the wall to the right as one enters. Across from the entry, a door leads to the sleeping quarters. A woman named Benne stands behind the bar.", "region:south-arathel", ""),
    ("area:south-arathel-fork-toward-honeyfern-labs", "intersection of two roads", "This is the intersection of two dirt roads in Arathel County. One road leads off to the northeast, toward Honeyfern Laboratories. The other runs southeast, toward Ack, or north, into Arathel County.", "region:south-arathel", ""),
    ("area:south-arathel-golden-shield-inn", "Golden Shield Inn", "This is the Golden Shield Inn. It is a large single-storey timber-framed building, with a reinforced wooden door and unusually high ceilings. Accomodations consist of a several large rooms with beds and straw mattresses, and a mezzanine with several wooden cots. The innkeeper is a young human man named Athyer.", "region:south-arathel", ""),
    ("area:south-arathel-north-arathel-ack-road", "Arathel-Ack Road", "This is the northern end of the road from Ack toward Arathel County, where it forks to the northwest and east. Both forks ultimately lead further north into the County. The difference is in what one passes on the way. The road northwest leads past Honeyfern Laboratories, while the road east passes more inns. To the southeast, the road leads to Ack.", "region:south-arathel", ""),
    ("area:south-arathel-outside-broken-arrow-inn", "outside the Broken Arrow Inn", "This is a dirt road outside the Broken Arrow Inn, in Arathel County. The road leads southeast toward the Arathel-Ack road, and northwest into Arathel County.", "region:south-arathel", ""),
    ("area:south-arathel-outside-crossed-candles-inn", "south Arathel Road, Greater Ack Metropolitan Enclave", "This is a southern length of Arathel Road, in the Greater Ack Metropolitan Enclave. On the west side of the road is the Crossed Candles Inn. The inn is a relatively simple wooden-slatted shack, with several shutter-covered windows facing the road. The road leads north, further into Arathel County, southeast toward the town of Bellybrush, and southwest toward the road to Ack.", "region:south-arathel", ""),
    ("area:south-arathel-outside-dull-thorn-inn", "outside the Dull Thorn Inn", "This is the road outside the Dull Thorn Inn, where the road from Ack ends against the Arathel-Pled road.", "region:south-arathel", ""),
    ("area:south-arathel-outside-golden-shield-inn", "outside the Golden Shield Inn", "This is the road outside the Golden Shield Inn, in Arathel County. The road continues north into Arathel County and south toward the city of Ack.", "region:south-arathel", ""),
    ("area:south-arathel-road-near-frekes-grave", "a morbid stretch of country road", "This is a length of rural road, cutting north to south through the countryside. There is grave marker set a ways back from the road, and closer, a man dressed in black is hanging by his wrists from a tree. There are some cokeberry bushes growing here.", "region:south-arathel", ""),
    ("area:south-arathel-road-to-honeyfern-labs", "South Arathel", "This is the road toward Honeyfern Laboratories, in Arathel County. Tall pines scatter the area. To the northeast is Honeyfern Laboratories, and to the southwest is a road leading elsewhere.", "region:south-arathel", ""),
    ("area:south-arathel-south-arathel-ack-road", "South Arathel", "This is the road between the city of Ack and Arathel County, its northern neighbor. The road leads southwest to Ack and northeast toward Arathel County. Near the road is a blacksmith.", "region:south-arathel", ""),
    ("area:south-arathel-turnwise-road", "Turnwise Road", "This is a stretch of the Turnwise Road, a circular road that runs through South Arathel, from the coast of the Optic Ocean north of Ack to its intersection with the Kingsroad, outside Ack's Eastgate.", "region:south-arathel", ""),
    ("area:south-arathel-west-arathel-pled-road", "South Arathel", "This is the western part of the road between Arathel and Pled Counties, itself in what would be considered eastern Arathel County. The road itself is well-packed dirt, with clear ruts from wagon wheels. Short stone walls border both sides of the road, marking the fields where local farmers graze their sheep. The road leads west toward Arathel County, and east toward Pled County.", "region:south-arathel", ""),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:south-arathel-bellybrush-road", "exit:south-arathel-bellybrush-road-southeast", "southeast", "has-southeast-exit", "area:bellybrush-arathel-road"),
    ("area:south-arathel-bellybrush-road", "exit:south-arathel-bellybrush-road-northwest", "northwest", "has-northwest-exit", "area:south-arathel-outside-crossed-candles-inn"),
    ("area:south-arathel-belys-blades", "exit:south-arathel-belys-blades-out", "out", "has-out-exit", "area:south-arathel-south-arathel-ack-road"),
    ("area:south-arathel-broken-arrow-inn", "exit:south-arathel-broken-arrow-inn-out", "out", "has-out-exit", "area:south-arathel-outside-broken-arrow-inn"),
    ("area:south-arathel-crossed-candles-inn", "exit:south-arathel-crossed-candles-inn-out", "out", "has-out-exit", "area:south-arathel-outside-crossed-candles-inn"),
    ("area:south-arathel-dull-thorn-inn-quarters", "exit:south-arathel-dull-thorn-inn-quarters-out", "out", "has-out-exit", "area:south-arathel-dull-thorn-inn"),
    ("area:south-arathel-dull-thorn-inn", "exit:south-arathel-dull-thorn-inn-out", "out", "has-out-exit", "area:south-arathel-outside-dull-thorn-inn"),
    ("area:south-arathel-dull-thorn-inn", "exit:south-arathel-dull-thorn-inn-quarters", "quarters", "has-quarters-exit", "area:south-arathel-dull-thorn-inn-quarters"),
    ("area:south-arathel-fork-toward-honeyfern-labs", "exit:south-arathel-fork-toward-honeyfern-labs-northeast", "northeast", "has-northeast-exit", "area:south-arathel-road-to-honeyfern-labs"),
    ("area:south-arathel-fork-toward-honeyfern-labs", "exit:south-arathel-fork-toward-honeyfern-labs-east", "east", "has-east-exit", "area:south-arathel-outside-broken-arrow-inn"),
    ("area:south-arathel-fork-toward-honeyfern-labs", "exit:south-arathel-fork-toward-honeyfern-labs-north", "north", "has-north-exit", "area:south-arathel-road-near-frekes-grave"),
    ("area:south-arathel-golden-shield-inn", "exit:south-arathel-golden-shield-inn-out", "out", "has-out-exit", "area:south-arathel-outside-golden-shield-inn"),
    ("area:south-arathel-north-arathel-ack-road", "exit:south-arathel-north-arathel-ack-road-northeast", "northeast", "has-northeast-exit", "area:south-arathel-outside-crossed-candles-inn"),
    ("area:south-arathel-north-arathel-ack-road", "exit:south-arathel-north-arathel-ack-road-southwest", "southwest", "has-southwest-exit", "area:south-arathel-south-arathel-ack-road"),
    ("area:south-arathel-north-arathel-ack-road", "exit:south-arathel-north-arathel-ack-road-northwest", "northwest", "has-northwest-exit", "area:south-arathel-outside-broken-arrow-inn"),
    ("area:south-arathel-outside-broken-arrow-inn", "exit:south-arathel-outside-broken-arrow-inn-north", "north", "has-north-exit", "area:south-arathel-broken-arrow-inn"),
    ("area:south-arathel-outside-broken-arrow-inn", "exit:south-arathel-outside-broken-arrow-inn-southeast", "southeast", "has-southeast-exit", "area:south-arathel-north-arathel-ack-road"),
    ("area:south-arathel-outside-broken-arrow-inn", "exit:south-arathel-outside-broken-arrow-inn-northwest", "northwest", "has-northwest-exit", "area:south-arathel-fork-toward-honeyfern-labs"),
    ("area:south-arathel-outside-crossed-candles-inn", "exit:south-arathel-outside-crossed-candles-inn-north", "north", "has-north-exit", "area:south-arathel-outside-golden-shield-inn"),
    ("area:south-arathel-outside-crossed-candles-inn", "exit:south-arathel-outside-crossed-candles-inn-southeast", "southeast", "has-southeast-exit", "area:south-arathel-bellybrush-road"),
    ("area:south-arathel-outside-crossed-candles-inn", "exit:south-arathel-outside-crossed-candles-inn-southwest", "southwest", "has-southwest-exit", "area:south-arathel-south-arathel-ack-road"),
    ("area:south-arathel-outside-crossed-candles-inn", "exit:south-arathel-outside-crossed-candles-inn-west", "west", "has-west-exit", "area:south-arathel-crossed-candles-inn"),
    ("area:south-arathel-outside-dull-thorn-inn", "exit:south-arathel-outside-dull-thorn-inn-north", "north", "has-north-exit", "area:south-arathel-dull-thorn-inn"),
    ("area:south-arathel-outside-dull-thorn-inn", "exit:south-arathel-outside-dull-thorn-inn-east", "east", "has-east-exit", "area:south-arathel-west-arathel-pled-road"),
    ("area:south-arathel-outside-dull-thorn-inn", "exit:south-arathel-outside-dull-thorn-inn-south", "south", "has-south-exit", "area:south-arathel-outside-golden-shield-inn"),
    ("area:south-arathel-outside-golden-shield-inn", "exit:south-arathel-outside-golden-shield-inn-north", "north", "has-north-exit", "area:south-arathel-outside-dull-thorn-inn"),
    ("area:south-arathel-outside-golden-shield-inn", "exit:south-arathel-outside-golden-shield-inn-east", "east", "has-east-exit", "area:south-arathel-golden-shield-inn"),
    ("area:south-arathel-outside-golden-shield-inn", "exit:south-arathel-outside-golden-shield-inn-south", "south", "has-south-exit", "area:south-arathel-outside-crossed-candles-inn"),
    ("area:south-arathel-road-near-frekes-grave", "exit:south-arathel-road-near-frekes-grave-north", "north", "has-north-exit", "area:south-arathel-outside-dull-thorn-inn"),
    ("area:south-arathel-road-near-frekes-grave", "exit:south-arathel-road-near-frekes-grave-east", "east", "has-east-exit", "area:south-arathel-golden-shield-inn"),
    ("area:south-arathel-road-near-frekes-grave", "exit:south-arathel-road-near-frekes-grave-south", "south", "has-south-exit", "area:south-arathel-outside-crossed-candles-inn"),
    ("area:south-arathel-road-to-honeyfern-labs", "exit:south-arathel-road-to-honeyfern-labs-northeast", "northeast", "has-northeast-exit", "area:honeyfern-labs-outside-gate"),
    ("area:south-arathel-road-to-honeyfern-labs", "exit:south-arathel-road-to-honeyfern-labs-southwest", "southwest", "has-southwest-exit", "area:south-arathel-fork-toward-honeyfern-labs"),
    ("area:south-arathel-south-arathel-ack-road", "exit:south-arathel-south-arathel-ack-road-northeast", "northeast", "has-northeast-exit", "area:south-arathel-north-arathel-ack-road"),
    ("area:south-arathel-south-arathel-ack-road", "exit:south-arathel-south-arathel-ack-road-south", "south", "has-south-exit", "area:ack-astar-ward"),
    ("area:south-arathel-south-arathel-ack-road", "exit:south-arathel-south-arathel-ack-road-west", "west", "has-west-exit", "area:south-arathel-belys-blades"),
    ("area:south-arathel-west-arathel-pled-road", "exit:south-arathel-west-arathel-pled-road-east", "east", "has-east-exit", "area:pled-county-west-arathel-pled-road"),
    ("area:south-arathel-west-arathel-pled-road", "exit:south-arathel-west-arathel-pled-road-west", "west", "has-west-exit", "area:south-arathel-outside-dull-thorn-inn"),
];

pub(super) const TRIVIA: &[Trivia] = &[
    ("area:south-arathel-road-near-frekes-grave", "This area is a reference to a session from the Brave Old Worlds campaign emsenn ran in rw2015"),
    ("area:south-arathel-turnwise-road", "Each Springtyg, residents of South Arathel walk the Turnwise Road in a clockward (or turnwise) direction, dropping off care packages at street-signs for those who might need them."),
];

pub(super) const LOOKABLES: &[Lookable] = &[
    ("lookable:south-arathel-crossed-candles-inn-cots", "area:south-arathel-crossed-candles-inn", "cots", "There are a few beds in one corner, more likely to be used when every other inn is full than as consistent board."),
    ("lookable:south-arathel-crossed-candles-inn-crossed-candles-inn", "area:south-arathel-crossed-candles-inn", "Crossed Candles Inn", "The Crossed Candles Inn is a relatively simple building: four posts are sunk deep into the silty clay soil of Arathel County, some crossbeams were braced into place, and vertical slats were hammered on over those. The floor is still dirt, though it's been packed so hard it almost resembles stone."),
    ("lookable:south-arathel-crossed-candles-inn-posts", "area:south-arathel-crossed-candles-inn", "posts", "The four posts that provide the foundation of the building are a dark-coloured pine."),
    ("lookable:south-arathel-crossed-candles-inn-slats", "area:south-arathel-crossed-candles-inn", "slats", "The siding of the Inn are vertical wooden slats, the ruddy colour of old pine."),
    ("lookable:south-arathel-crossed-candles-inn-windows", "area:south-arathel-crossed-candles-inn", "windows", ""),
    ("lookable:south-arathel-crossed-candles-inn-yokels", "area:south-arathel-crossed-candles-inn", "yokels", "The patrons of this bar are mostly local yokels, workers and farmers from around South Arathel."),
    ("lookable:south-arathel-outside-crossed-candles-inn-crossed-candles-inn", "area:south-arathel-outside-crossed-candles-inn", "Crossed Candles Inn", "The Crossed Candles Inn is one of several inns on the roads between the city of Ack, to the south, and the town of Arathel, seat of Arathel County, to the north. The inn is a single-storey building, resembling a barn more than a home. There are two windows on each side of the door, closed with wooden shutters. Beside the inn's door is a rubbish bin."),
    ("lookable:south-arathel-outside-crossed-candles-inn-shuttered-windows", "area:south-arathel-outside-crossed-candles-inn", "shuttered windows", "The facade of the inn has four windows, each closed by a pair of shutters."),
    ("lookable:south-arathel-outside-crossed-candles-inn-shutters", "area:south-arathel-outside-crossed-candles-inn", "shutters", "The shutters are closed, preventing people from seeing into the inn."),
];

pub(super) const NOISES: &[Noise] = &[
    ("noise:south-arathel-dull-thorn-inn-benne-0", "npc:south-arathel-dull-thorn-inn-benne", "2", "Benne looks toward the window as something makes a sound outside.."),
];

pub(super) const NPCS: &[Npc] = &[
    ("npc:south-arathel-broken-arrow-inn-geda", "area:south-arathel-broken-arrow-inn", "Geda", "Geda owns the Broken Arrow Inn, where she makes cheddar and whey.", "", &[]),
    ("npc:south-arathel-crossed-candles-inn-alfric", "area:south-arathel-crossed-candles-inn", "Alfric", "This is Alfric, a ghost that haunts Crossed Candles Inn.", "", &[]),
    ("npc:south-arathel-crossed-candles-inn-lexandra-terr", "area:south-arathel-crossed-candles-inn", "Lexandra Terr", "Lexandra Terr is a short feminine human. She is wearing a simple blue cotton dress.", "", &[]),
    ("npc:south-arathel-dull-thorn-inn-benne", "area:south-arathel-dull-thorn-inn", "Benne", "This is Benne. She's a tall human woman, more timid than you'd expect, given her size.", "", &[]),
    ("npc:south-arathel-golden-shield-inn-athyer", "area:south-arathel-golden-shield-inn", "Athyer", "This is Athyer, a masculine human person.", "", &[]),
];
