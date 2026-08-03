# Port roles

A **port** is a crate that moves information across a boundary —
either between the substrate and the outside world, or between
fibers inside the substrate. The role name captures *which
boundary* and *which direction*.

Every port crate's name starts with `mash-port-<role>-`. The role
is not decorative. It tells you where the crate's coupling lives,
what it may depend on, and what it must not.

## The seven roles

| Role         | Direction                         | Discipline of origin            |
|--------------|-----------------------------------|---------------------------------|
| `sensor`     | outside → substrate               | Control engineering (input transducer); cybernetics ("receptor") |
| `actuator`   | substrate → outside (one-way)     | Control engineering (output transducer); cybernetics ("effector organ") |
| `responder`  | outside → substrate → outside     | Request-response (HTTP, RPC)    |
| `effector`   | substrate → outside → substrate   | Cybernetics, narrowed: effector with return path |
| `projection` | substrate → substrate             | Materialized views / stream processing |
| `conduit`    | outside ↔ substrate (transport)   | Civil/electrical engineering (passive carrier) |
| `coupler`    | outside ↔ substrate (state sync)  | Physics (impedance matching), DSP |

Read the `Direction` column as: where does information *enter* and
*exit*, from the substrate's point of view?

## Actuator vs effector

This is the distinction that trips readers. Both cross the boundary
*outward* from the substrate. The difference is return-path.

- **Actuator** is one-way. The substrate witnessed a claim; the
  actuator turned it into an outside-world effect; it's done. No
  return trip. Think: push notifier, SMS sender, log forwarder,
  alert dispatcher. The outside world does not report back into the
  substrate about what happened.

- **Effector** is round-trip. The substrate witnessed a claim; the
  effector turned it into an outside-world effect; the effect
  *completes* or *produces output*; the effector witnesses that
  result back into the substrate. Think: `shell-agent` — the
  substrate settles `is-ready-to-run-on-shell`, the shell port
  spawns `sh -c`, and the exit code and stdout are witnessed back.

If the outcome ever needs to reenter the substrate, you want an
effector. If witnessing-and-forgetting is correct, you want an
actuator. "Actuator" in MASH is narrower than the everyday English
word — it inherits the control-engineering meaning of a one-way
output transducer, explicitly distinguished from the cybernetic
"effector" which carries its result back.

## Sensor vs responder

Both move information *inward*.

- **Sensor** is outside-initiated, no reply. Webhook receiver, log
  shipper, RSS poller, IoT sensor. The outside world pushes or the
  sensor pulls; claims land in the substrate; that's the whole
  interaction.

- **Responder** is outside-initiated, with a reply. HTTP API, MCP
  server, GraphQL resolver. Outside sends a request, the request
  enters the substrate as claims, the cascade settles, and the
  responder reads substrate state to build a response back to the
  requester.

Responders are the only role whose external boundary is
request-response shaped.

## Projection

Projections stay inside. A projection subscribes to one or more
fibers and maintains derived state — another fiber, a local cache,
a rendering buffer — without touching the outside world.

The MUD `look` agent is a projection: it subscribes to `look-ready`
plus `has-name`, `has-description`, `contains`, and renders a room
description back into the substrate as a `has-body` claim. Nothing
about it is network-visible; the telnet conduit (a separate port)
picks up that claim and turns it into a socket write.

Projection is the role for materialized views, aggregators, caches,
dispatchers, and trigger-composition observers. Most MUD logic
lives here.

## Conduit

A conduit is a full-duplex async transport with **no semantic
coupling** to what it carries. Telnet, stdio, websocket, IRC —
these crates know nothing about verbs, rooms, puppets, or sessions
except as opaque substrate subjects they bridge bytes for.

Conduits are thin on purpose. If you find a conduit importing a
vocab crate with *domain* meaning (space, movement, perception),
that's a code smell: the conduit should only import the tiny
comms/session vocabularies — the predicates needed to mint a
session subject and to say "this utterance goes to this session."

## Coupler

A coupler holds two-way state between the substrate and an outside
system. A git↔repo coupler, a CalDAV↔calendar coupler, a
fediverse bridge. The substrate's view of a thing and the outside
system's view of it stay in sync: changes either side reconciles
the other.

No couplers exist in the current tree; the role is reserved. When
one shows up, expect it to be more complex than any of the other
six — keeping two sources of truth consistent is a different kind
of problem.

## Discipline rules (enforced)

`scripts/check-crate-taxonomy.sh` checks the following at CI time:

- **Vocab crates** have no `src/bin/` and no `tokio` dependency.
  They export `pub const &str` predicate names, `pub fn` helpers,
  and an `impl Agent` whose `translate` is the empty default.
- **Port crates** either define a `Port`-like impl in `lib.rs` OR
  have at least one `src/bin/`. They never define
  `pub const &str` vocabulary — those live in vocab crates.
- **No port crate may depend on another port crate.** Coordination
  goes through the substrate, not through Rust deps. If the telnet
  conduit needs something the shell effector produces, both
  subscribe and the substrate is the shared ground.
- **Scene crates** hold only `claims()` and instance data — no
  binaries, no async runtime, no port impls.

These aren't style preferences. They are what keeps the substrate
the source of truth. A port that imports another port has quietly
reintroduced a synchronous function call the substrate was meant
to replace.

## Picking a role

Ask, in order:

1. Does my crate touch the outside world?
   - No → **projection**.
   - Yes → continue.
2. Is the direction one-way outward?
   - Yes → **actuator**.
3. Is the direction one-way inward?
   - Yes → **sensor**.
4. Is the outside boundary request-response?
   - Yes → **responder**.
5. Does the substrate initiate and expect a result back?
   - Yes → **effector**.
6. Is it a passive transport with no domain semantics?
   - Yes → **conduit**.
7. Does it keep two systems in sync bidirectionally?
   - Yes → **coupler**.

If two answers fit, the crate is doing two things and should split.
