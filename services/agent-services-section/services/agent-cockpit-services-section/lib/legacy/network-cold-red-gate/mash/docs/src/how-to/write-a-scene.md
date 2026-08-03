# Writing a scene

A **scene crate** is a flat list of instance-data claims over one or
more vocabularies. Rooms, exits, characters, starting world state —
anything specific to a particular instance of the system.

This guide walks through a four-district slice of the Ack city
scene as the worked example. The real scene in the repo is
`mash-scene-mud-teraum` — 97 rooms across 17 regions, with its
data tables generated from an external atlas by
`tools/import_teraum.py`. The pattern shown here is what that
generator emits; the guide works at the minimum-viable scale so
the reader can see the whole shape in one pass.

## 1. Crate layout

```text
crates/mash-scene-mud-teraum-ack/
├── Cargo.toml
└── src/
    └── lib.rs
```

No `src/bin/`, no async runtime, no port impls. The taxonomy check
enforces all three — a scene that does side-effecting work is a port
that happens to contain instance data. Split the crates.

## 2. Cargo.toml

```toml
[package]
name         = "mash-scene-mud-teraum-ack"
description  = "Reference scene: four districts in the city of Ack."
version.workspace      = true
# ... workspace inheritance

[lints]
workspace = true

[dependencies]
mash-sdk-agent         = { workspace = true }
mash-sdk-client        = { workspace = true }
mash-vocab-mud-space   = { workspace = true }
mash-vocab-mud-session = { workspace = true }
async-trait            = { workspace = true }
```

A scene depends only on vocab crates and the SDK. Pulling in a port
or `tokio` is a smell; the check will catch it.

## 3. Data tables

Put the instance content in `const` tables at the top of `lib.rs`:

```rust,ignore
const ANGERS_PLACE: &str = "room:angers-place";
const BRASS_WARD:   &str = "room:brass-ward";
const COPPER_WARD:  &str = "room:copper-ward";
const PIKETOWN:     &str = "room:piketown";

/// `(from, exit, direction, has-<dir>-exit, to)`.
const EXITS: &[(&str, &str, &str, &str, &str)] = &[
    (ANGERS_PLACE, "exit:angers-brass",    "north",
     "has-north-exit", BRASS_WARD),
    (BRASS_WARD,   "exit:brass-angers",    "south",
     "has-south-exit", ANGERS_PLACE),
    // ...
];

/// `(room, name, description)`.
const ROOMS: &[(&str, &str, &str)] = &[
    (ANGERS_PLACE,
     "Anger's Place",
     "This is Anger's Place, a district in the city of Ack. ..."),
    // ...
];
```

Prefer data tables over imperative `Vec::push` calls in `claims()`.
Every room and exit a scene declares is visible in one view, which
matters when you come back to the file in six months and need to
find why Piketown's south exit goes to the wrong place.

The naming convention `room:<slug>`, `exit:<slug>`, `character:<slug>`
is a readable subject prefix — the substrate doesn't enforce it, but
humans reading the event log will.

## 4. The Agent impl

```rust,ignore
#[derive(Debug, Clone, Copy, Default)]
pub struct TeraumAck;

pub const IDENTITY: &str = "mash-scene-mud-teraum-ack";

#[async_trait]
impl Agent for TeraumAck {
    fn identity(&self) -> &'static str { IDENTITY }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        for (room, name, description) in ROOMS {
            out.push(Claim::new(*room, AREA,            AREA_NAME));
            out.push(Claim::new(*room, HAS_NAME,        *name));
            out.push(Claim::new(*room, HAS_DESCRIPTION, *description));
        }

        for (from, exit, direction, has_dir_exit, to) in EXITS {
            out.push(Claim::new(*exit, "exit",          AREA_NAME));
            out.push(Claim::new(*from, HAS_EXIT,        *exit));
            out.push(Claim::new(*from, *has_dir_exit,   *exit));
            out.push(Claim::new(*exit, GOES_DIRECTION, *direction));
            out.push(Claim::new(*exit, LEADS_TO,       *to));
        }

        out.push(Claim::new(IDENTITY, HAS_DEFAULT_SPAWN, ANGERS_PLACE));
        out
    }
}
```

Four patterns:

- **Use vocab constants** (`AREA`, `HAS_NAME`, `LEADS_TO`). Never
  typed string literals for predicates — if the vocab renames
  `HAS_NAME`, you want `cargo check` to tell you.
- **Two loops, two concerns.** One over `ROOMS` (every room gets
  its name and description), one over `EXITS` (every exit gets its
  direction and destination). Readers can audit each list
  independently.
- **Scene-level declarations at the bottom.** `HAS_DEFAULT_SPAWN` is
  a one-off: the scene tells the session vocabulary where new
  players arrive. Grouping these at the end keeps the loops clean.
- **Scope by subject.** Every room subject starts with `room:`,
  every exit with `exit:`. Scenes stake out a subject namespace.

## 5. A shape test

```rust,ignore
#[test]
fn spawn_is_anger_s_place() {
    assert!(TeraumAck.claims().iter().any(|c|
        c.subject   == IDENTITY
        && c.predicate == HAS_DEFAULT_SPAWN
        && c.object    == ANGERS_PLACE
    ));
}
```

Scene tests assert shape invariants — "the spawn room is set", "every
room has both a name and a description", "every exit has a
destination." They don't run the cascade.

## 6. Mount it

```toml
# mash.toml
[[scene]]
crate = "mash-scene-mud-teraum-ack"
```

The CLI mounts vocabulary *first* (in manifest order), then scenes.
A scene that references a predicate or morphism its vocab hasn't
mounted will silently not do what you want; the `composes-into`
declaration must already exist for scene-level compositions to fire.

## 7. What a scene should not do

- **React to events.** Scenes are pure `claims()`. If you want
  behavior — a room that changes when a switch is thrown — write a
  projection port that subscribes to the switch's fiber and
  witnesses the change.
- **Import another scene.** Scenes are leaves. Sharing common data
  between scenes belongs in a vocab crate (scenery constants),
  not in an inter-scene import.
- **Use `tokio`.** If you need concurrency to build `claims()`, you
  are doing something wrong — the data is `const` or trivially
  copyable from a small data table.

## 8. Larger scenes

When a scene grows past a few hundred claims:

- **Split the data tables across files** (rooms in `rooms.rs`, exits
  in `exits.rs`) but keep `claims()` in `lib.rs`.
- **Consider generating the tables** from an external authoring
  format (TOML, JSON) via a `build.rs`. The substrate sees only the
  resulting `Vec<Claim>`; the authoring pipeline is yours to
  design.
- **Keep a `scene:` anchor subject** and attach scene-wide metadata
  to it (`(scene:teraum-ack, has-author, "emsenn")`,
  `(scene:teraum-ack, has-version, "1.0")`). Then scenes are
  first-class substrate entities you can list, version, and diff.

## See also

- `mash-scene-mud-teraum` — the full scene; 97 rooms generated from
  `tools/import_teraum.py`.
- `mash-vocab-mud-space` — the vocabulary this scene instantiates.
- `mash-vocab-mud-session::HAS_DEFAULT_SPAWN` — the one cross-vocab
  reference this scene uses.
