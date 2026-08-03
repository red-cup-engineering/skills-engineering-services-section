# MASH — Modeled Agential Semiotic Hub

A predication substrate over the Belnap 2⊗2 bilattice. One process, one
Unix-domain socket, one append-only store of subject-predicate-object
claims closed under five morphisms and behaving as a CRDT under
concurrent writers.

The name is load-bearing:

- **M**odeled — *logical inference modeling* under predication logic.
- **A**gential — *agential virtual reality*; agents are the only way
  anything happens.
- **S**emiotic — *semiotic settlement operations*; the cascade settles
  signs among possible meanings.
- **H**ub — the process that owns the substrate.

The lineage is Norbert Wiener and Karen Barad, not Claude Shannon and
Alan Turing. Computation here is not the transformation of encoded
symbols through a function; it is the iterated settlement of evidence
through an adjunction of extending and restricting on a four-valued
algebra. The algebra is the Chu multiplicative structure of Jakl's
*2⊗2 ≅ Chu(2,0)*; the top-level paper under
`library/domains/science/domains/information/texts/the-adjoint-structure-of-predication-on-bilattice-valued-fibers.md`
is the formal development.

## Quickstart

```bash
cargo build --workspace
cargo test  --workspace
```

Boot a hub with the MUD reference scene:

```bash
MASH_ROOT=.mash cargo run -p mash-cli -- up
```

The hub opens `.mash/sock`, mounts the owner-agents listed in
`mash.toml`, replays `.mash/`'s event log, and spawns any port
subprocesses the manifest names. Agents connect over the socket; the
wire format is newline-delimited JSON (see `mash-math-inference::wire`).

## Reading order

The `docs/` book follows the [Diátaxis] four-quadrant structure;
match the section to what you're looking for.

1. **Start here** — `docs/src/introduction.md`. Orients you to the
   vocabulary and gives a concrete reading path into the book.
2. **Tutorial** — `docs/src/tutorial/first-vocabulary.md`. A
   30-minute hands-on build that teaches claims, compositions, the
   cascade, and the testkit through a concrete example.
3. **How-to** — `docs/src/how-to/` (write a vocabulary, a port, a
   scene). Task-oriented recipes.
4. **Explanation** —
   - `docs/src/explanation/lineage/` (Beyond Shannon and Turing,
     Cybernetics, Agential realism) — why MASH is shaped the way
     it is.
   - `docs/src/explanation/concepts/` (values, claims, fibers and
     cascade, morphisms) — the code-level vocabulary.
   - `docs/src/explanation/mathematics/` — the formal foundation
     (finite algebra) and the research frontier (infinite
     coalgebra).
   - `docs/src/explanation/architecture/` (hub, agents and
     sessions, port roles) — how the parts assemble.
5. **Reference** — `docs/src/reference/` (glossary, taxonomy, wire
   protocol, trigger predicates). For lookup.
6. **The paper** — the adjoint-structure-of-predication paper in
   `library/` is the mathematical ground truth. Every phrase in
   these docs that reads like jargon (fiber, adjunction,
   residuation, Chu space) traces to a specific theorem there.

Build the book locally with [mdBook]:

```bash
cargo install mdbook
mdbook serve docs
```

Build the API reference:

```bash
cargo doc --workspace --no-deps --open
```

The `mash` umbrella crate is the rustdoc front page; it re-exports
the public `Agent`, `Claim`, `Value`, `Connection`, `Handle`, and
`Witness` types so downstream code can write
`use mash::{Agent, Claim};` rather than reach into five sibling
crates. Deeper surface area — the proof engine, the wire types, the
hub kernel — lives in its own crate's rustdoc, linked from the
umbrella.

## Crate taxonomy

Every crate sits in exactly one slot. The eight top-level prefixes:

| Prefix | Purpose |
|---|---|
| `mash-math-*`  | Formal math foundation (algebra, inference, proof engine). No I/O. |
| `mash-util-*`  | Cross-cutting utilities (hashing, logging, storage). No domain semantics. |
| `mash-sdk-*`   | Public-facing developer surface (agent trait, client, CLI, testkit). |
| `mash-vocab-*` | Owner-agent vocabulary. Mounted in-process at hub boot. |
| `mash-port-*`  | Behavior crates; see below. |
| `mash-scene-*` | Instance data — scenes/worlds as owner-agent claims. |
| `mash-hub-*`   | Kernel, persistence, transport plumbing. |
| `mash-lab-*`   | Research and experimentation; may never graduate. |

Port crates are further sub-prefixed by role:
`mash-port-sensor-*`, `mash-port-actuator-*`,
`mash-port-responder-*`, `mash-port-effector-*`,
`mash-port-projection-*`, `mash-port-conduit-*`,
`mash-port-coupler-*`. See
`docs/src/explanation/architecture/port-roles.md` for what each role
does and when to use it; `docs/src/reference/taxonomy.md` is the
canonical reference and the target of
`scripts/check-crate-taxonomy.sh`.

## License

MIT. See `LICENSE`.

[mdBook]: https://rust-lang.github.io/mdBook/
[Diátaxis]: https://diataxis.fr/
