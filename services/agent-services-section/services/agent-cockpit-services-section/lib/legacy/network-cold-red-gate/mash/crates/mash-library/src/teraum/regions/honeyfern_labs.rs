//! Honeyfern Labs — ported verbatim from the old-library scene data.

use super::super::tables::*;

pub(super) const AREAS: &[Area] = &[
    ("area:honeyfern-labs-dining-hall", "dining hall, Honeyfern Labs", "This is the dining hall of Honeyfern Laboratories. A door leads to a hallway, while another leads to the kitchen.", "region:honeyfern-labs", ""),
    ("area:honeyfern-labs-first-floor-hallway", "hallway, Honeyfern Labs", "This is the first-floor hallway of Honeyfern Laboratories. One end leads to the foyer, while a door on either side leads to the dining hall or library. There are shelves built into both sides of the wall. Most of the shelves contain old books. A few squashboard boxes are on the floor. Some are half-full of books. Others are closed, sealed with tape, and covered in soot.", "region:honeyfern-labs", ""),
    ("area:honeyfern-labs-foyer", "foyer, Honeyfern Labs", "This is the foyer of Honeyfern Laboratories.  A door leads outside. Stairs lead upstairs, but they've been blocked. There is a hallway across the room from the door, and across from the stairs, an open door to a sitting room.", "region:honeyfern-labs", ""),
    ("area:honeyfern-labs-front-path", "front path, Honeyfern Labs", "This is the path to Honeyfern Laboratories. Grass grows nearly seven feet tall to either side of the narrow gravel path. It leads to an outside gate, and toward the building's porch.", "region:honeyfern-labs", ""),
    ("area:honeyfern-labs-front-porch", "front porch, Honeyfern Labs", "This is the front porch of Honeyfern Laboratories. Down the steps is a path to the gate to to leave, and the a door leads inside.", "region:honeyfern-labs", ""),
    ("area:honeyfern-labs-kitchen", "kitchen, Honeyfern Labs", "This is the kitchen of Honeyfern Laboratories. A door leads to the pantry, and another to the dining hall. The door to the backyard has been painted shut.", "region:honeyfern-labs", ""),
    ("area:honeyfern-labs-library", "library, Honeyfern Labs", "This is the library of Honeyfern Laboratories. A door leads back out to the hallway.", "region:honeyfern-labs", ""),
    ("area:honeyfern-labs-outside-gate", "outside gate, Honeyfern Labs", "This is immediately outside the gate of Honeyfern Laboratories. The road leads southwest, elsewhere.", "region:honeyfern-labs", ""),
    ("area:honeyfern-labs-pantry", "pantry, Honeyfern Labs", "This is the pantry of Honeyfern Laboratories' kitchen. A door leads back to the kitchen.", "region:honeyfern-labs", ""),
    ("area:honeyfern-labs-sitting-room", "sitting room, Honeyfern Labs", "This is the sitting room of Honeyfern Laboratories. A door leads to the foyer.", "region:honeyfern-labs", ""),
];

pub(super) const EXITS: &[Exit] = &[
    ("area:honeyfern-labs-dining-hall", "exit:honeyfern-labs-dining-hall-hallway", "hallway", "has-hallway-exit", "area:honeyfern-labs-first-floor-hallway"),
    ("area:honeyfern-labs-dining-hall", "exit:honeyfern-labs-dining-hall-kitchen", "kitchen", "has-kitchen-exit", "area:honeyfern-labs-kitchen"),
    ("area:honeyfern-labs-first-floor-hallway", "exit:honeyfern-labs-first-floor-hallway-foyer", "foyer", "has-foyer-exit", "area:honeyfern-labs-foyer"),
    ("area:honeyfern-labs-first-floor-hallway", "exit:honeyfern-labs-first-floor-hallway-hall", "hall", "has-hall-exit", "area:honeyfern-labs-dining-hall"),
    ("area:honeyfern-labs-first-floor-hallway", "exit:honeyfern-labs-first-floor-hallway-library", "library", "has-library-exit", "area:honeyfern-labs-library"),
    ("area:honeyfern-labs-foyer", "exit:honeyfern-labs-foyer-outside", "outside", "has-outside-exit", "area:honeyfern-labs-front-porch"),
    ("area:honeyfern-labs-foyer", "exit:honeyfern-labs-foyer-hallway", "hallway", "has-hallway-exit", "area:honeyfern-labs-first-floor-hallway"),
    ("area:honeyfern-labs-foyer", "exit:honeyfern-labs-foyer-door", "door", "has-door-exit", "area:honeyfern-labs-sitting-room"),
    ("area:honeyfern-labs-front-path", "exit:honeyfern-labs-front-path-gate", "gate", "has-gate-exit", "area:honeyfern-labs-outside-gate"),
    ("area:honeyfern-labs-front-path", "exit:honeyfern-labs-front-path-porch", "porch", "has-porch-exit", "area:honeyfern-labs-front-porch"),
    ("area:honeyfern-labs-front-porch", "exit:honeyfern-labs-front-porch-path", "path", "has-path-exit", "area:honeyfern-labs-front-path"),
    ("area:honeyfern-labs-front-porch", "exit:honeyfern-labs-front-porch-inside", "inside", "has-inside-exit", "area:honeyfern-labs-foyer"),
    ("area:honeyfern-labs-kitchen", "exit:honeyfern-labs-kitchen-pantry", "pantry", "has-pantry-exit", "area:honeyfern-labs-pantry"),
    ("area:honeyfern-labs-kitchen", "exit:honeyfern-labs-kitchen-hall", "hall", "has-hall-exit", "area:honeyfern-labs-dining-hall"),
    ("area:honeyfern-labs-library", "exit:honeyfern-labs-library-hall", "hall", "has-hall-exit", "area:honeyfern-labs-first-floor-hallway"),
    ("area:honeyfern-labs-outside-gate", "exit:honeyfern-labs-outside-gate-gate", "gate", "has-gate-exit", "area:honeyfern-labs-front-path"),
    ("area:honeyfern-labs-outside-gate", "exit:honeyfern-labs-outside-gate-southwest", "southwest", "has-southwest-exit", "area:south-arathel-road-to-honeyfern-labs"),
    ("area:honeyfern-labs-pantry", "exit:honeyfern-labs-pantry-door", "door", "has-door-exit", "area:honeyfern-labs-kitchen"),
    ("area:honeyfern-labs-sitting-room", "exit:honeyfern-labs-sitting-room-door", "door", "has-door-exit", "area:honeyfern-labs-foyer"),
];

pub(super) const TRIVIA: &[Trivia] = &[];

pub(super) const LOOKABLES: &[Lookable] = &[];

pub(super) const NOISES: &[Noise] = &[];

pub(super) const NPCS: &[Npc] = &[];
