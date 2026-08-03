# Agents and sessions

## What an agent is

An **agent** is a translator: substrate events in, claims out. The
SDK defines the trait in `mash-sdk-agent`:

```rust,ignore
#[async_trait]
pub trait Agent: Send + Sync + 'static {
    fn identity(&self) -> &'static str { "agent" }
    fn subscriptions(&self) -> &'static [&'static str] { &[] }
    fn claims(&self) -> Vec<Claim> { Vec::new() }
    async fn translate(&self, event: Event, witness: Witness) -> Vec<Claim> {
        Vec::new()
    }
}
```

Four hooks, each with a sensible default:

- **`identity`** — the agent's name on the wire.
- **`subscriptions`** — predicates to subscribe to on handshake.
- **`claims`** — foundational claims to mount into the substrate
  before the event log replays. Owner-agents (vocabularies, scenes)
  use this; pure translators don't.
- **`translate`** — react to an inbound event by returning claims to
  witness. Pure translators return synchronously and ignore the
  witness handle; port agents (bridges to sockets, shells, timers)
  spawn tasks holding the witness and return an empty vector, then
  the spawned task emits when its external work settles.

`&self` carries **immutable configuration only**. An agent that
appears to need "memory" doesn't — it needs a fiber it's subscribed
to. This is load-bearing: the substrate is the system's state,
agents are its translators.

## Two deployment modes

An agent can run **embedded** (in-process) or **subprocess** (over
the socket). The trait is the same; only the driver differs.

### Embedded

`mash_hub::drive_embedded` hosts an agent in-process. The driver:

1. Sends `Cmd::Connect` to the kernel.
2. Sends `Cmd::Message(Hello)` with the agent's subscriptions.
3. Forwards events from the kernel into `translate`.
4. Forwards the agent's returned claims back into the kernel as
   `Cmd::Message(Assert)`.

Embedded agents bypass the wire encoding but see the same message
flow the kernel serves over the socket. This is how vocabulary
crates (mash-vocab-*) and scene crates (mash-scene-*) run: their
`claims()` mount into the substrate at boot; their `translate` is
usually the empty default.

### Subprocess

`mash_sdk_agent::run_as_subprocess` is the opposite binding:

1. Open `mash_sdk_client::Connection` to the hub's socket.
2. Handshake with `Hello`, receive `Welcome`.
3. Loop over inbound events, running `translate` for each.
4. Witness returned claims.

Subprocess agents are isolated processes. They can be killed and
restarted without disturbing the hub. Every binary under a
`mash-port-*` crate's `src/bin/` or `src/main.rs` is a subprocess
agent — the telnet conduit, the shell effector, the look projection,
and so on.

Subprocess agents do **not** mount `claims()` on start. If they did,
the wire `Assert` path would persist those claims to the event log
and remounting on every boot would grow it unboundedly. Owner-agent
claims only mount in-process.

## Owner-agents

An **owner-agent** is an agent whose job is to declare vocabulary or
instance data, not to translate events. `mash-vocab-core` owns the
foundational morphism trigger predicates; `mash-vocab-mud-space`
owns rooms, exits, and directions; `mash-scene-mud-teraum`
instantiates a particular world over those predicates.

Owner-agents run embedded and their `translate` is empty. Their
purpose is to have a stable Rust binding that mounts a specific set
of claims on boot.

The term "owner" is ergonomic, not privileged: the substrate doesn't
track ownership. Any agent can witness any triple. Calling a
vocabulary crate an owner-agent means "this crate takes
responsibility for a coherent slice of the predicate space and
asserts the baseline claims that make that slice intelligible."

## Sessions

A **session** is a single connection to the hub. The kernel assigns
a `SessionId` when the session opens and holds an outbound channel
and a subscription set for its lifetime.

Sessions are *subjects* in the substrate — `s0`, `s1`, `s2`, … — so
agents can witness against them. When the telnet conduit accepts a
TCP connection, it mints a session subject `session:tcp:<peer>:<ns>`
and witnesses `(session, is-newly-connected, true)`. The session
welcome agent observes that, mints a puppet, places it in a spawn
room. When the session ends, `(session, ended-at, <timestamp>)`
lands and observers clean up.

Session subjects and kernel `SessionId`s are different things. The
kernel's `SessionId` is opaque and per-connection; the session
subject lives in the substrate and can be referenced by claims long
after the connection closes (so audit trails remain coherent).

## Subscription replay

When an agent subscribes to a predicate, the hub delivers every
current cell in that fiber as an `Event` with an empty derivation.
This is how newly-connected agents pick up bundle-mounted cells
without having to ask for them. See
[the hub](hub.md) for the boot-time flow.

## How to read the trait

- If an agent's `claims()` is populous and its `translate` is empty,
  it's a **vocab** or **scene** owner-agent.
- If `translate` does synchronous transformation of the incoming
  event into claims, it's a **pure translator** — probably a
  projection port.
- If `translate` spawns a task holding the `Witness` and returns
  empty, it's a **side-effecting port** — sensor, actuator,
  responder, effector, conduit, or coupler, depending on direction.
