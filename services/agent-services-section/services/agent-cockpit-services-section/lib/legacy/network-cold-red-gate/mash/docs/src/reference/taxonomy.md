# Crate taxonomy

This is the canonical reference for crate naming in the MASH
workspace. Every crate sits in exactly one slot. New crates pick a
prefix from the table; introducing a new prefix is a charter-level
decision.

## Top-level prefixes

| Prefix         | Purpose                                                   |
|----------------|-----------------------------------------------------------|
| `mash-math-*`  | Formal math foundation (algebras, inference engines). No I/O. |
| `mash-util-*`  | Cross-cutting utilities (hashing, logging, storage). No domain semantics. |
| `mash-sdk-*`   | Public-facing developer surface (agent trait, hub client, testkit, CLI). |
| `mash-vocab-*` | Owner-agent vocabulary. Mounted in-process at hub boot. No async runtime, no `bin/`. |
| `mash-port-*`  | Behavior crates. Subscribe to fibers, hold local state, witness claims back. Sub-prefixed by role (see below). |
| `mash-scene-*` | Instance data — scenes/worlds expressed as owner-agent claims. |
| `mash-hub-*`   | Kernel, persistence, transport plumbing. |
| `mash-lab-*`   | Research and experimentation. May take heavy dev-deps; may never graduate to production. |

Two exact-match crates sit outside any prefix and appear only once
each: `mash` (the umbrella re-export crate — the rustdoc front page),
`mash-cli` (the user-facing `mash` binary), `mash-hub` (the kernel
crate itself), `mash-testkit` (dev-dep test helpers).

Within `mash-vocab-*`, `mash-port-*`, `mash-scene-*`, and
`mash-lab-*`, MUD-specific crates carry a `mud` infix immediately
after the role:

- `mash-vocab-mud-space`, `mash-vocab-mud-session`, `mash-vocab-mud-movement`
- `mash-port-projection-mud-go`, `mash-port-conduit-mud-telnet`
- `mash-scene-mud-teraum`

MUD command-handling crates (parser, verb dispatch, session input)
carry `mud-command` instead of `mud`:

- `mash-vocab-command` — the framework vocab; concrete verbs live in
  `mash-vocab-mud-verbs`.
- `mash-port-projection-mud-parser`
- `mash-port-projection-mud-command-quit`

## Port roles

Ports cross the boundary between the substrate and the outside world
(or between substrate fibers). See
[Port roles](../explanation/architecture/port-roles.md) for the full discussion,
including when to pick which. Quick reference:

| Role                    | Direction                        |
|-------------------------|----------------------------------|
| `mash-port-sensor-*`    | outside → substrate              |
| `mash-port-actuator-*`  | substrate → outside (one-way)    |
| `mash-port-responder-*` | outside → substrate → outside    |
| `mash-port-effector-*`  | substrate → outside → substrate  |
| `mash-port-projection-*`| substrate → substrate            |
| `mash-port-conduit-*`   | outside ↔ substrate (transport)  |
| `mash-port-coupler-*`   | outside ↔ substrate (state sync) |

## Per-role rules

Enforced by `scripts/check-crate-taxonomy.sh`.

- **`mash-vocab-*`** crates have no `bin/`, no `tokio` dep, and only
  export `pub const &str`, `pub fn` helpers, and an `impl Agent` whose
  `translate()` returns the empty default. Their job is to mount
  claims at boot.
- **`mash-port-*`** crates either define a `Port` impl in `lib.rs`
  (for embedded ports) OR have at least one `bin/`. They never define
  `pub const &str` for vocabulary — those live in `mash-vocab-*`
  crates and are imported.
- **No `mash-port-*` may depend on another `mash-port-*`.**
  Coordination happens through the substrate, not through Rust
  dependencies.
- **`mash-scene-*`** crates contain only `claims()` and instance data;
  no behavior, no binaries, no async runtime.
- **`mash-hub-*`** is the only family allowed to touch the kernel
  command bus directly.

## Bin naming

Inside a port crate, each `[[bin]] name = "..."` matches the crate
name when the crate has a single binary, and uses
`{crate-name}-{specific}` when the crate has multiple:

- `mash-port-effector-shell` → bin `mash-port-effector-shell`
- `mash-port-projection-task` → bins `mash-port-projection-task`,
  `mash-port-projection-task-completion`,
  `mash-port-projection-task-dependency`
- `mash-port-projection-mud-space` →
  bins `mash-port-projection-mud-space-look`,
  `mash-port-projection-mud-space-room`

Two exceptions: `mash-cli` exposes the user-facing `mash` binary,
and `mash-port-projection-dispatch` exposes a `-promoter` bin plus
three subprocess bins.

## Enforcement

Run locally from the workspace root:

```bash
scripts/check-crate-taxonomy.sh
```

Prints `OK` on a clean tree, itemized `VIOLATION:` lines otherwise.
The script is expected to run in CI.
