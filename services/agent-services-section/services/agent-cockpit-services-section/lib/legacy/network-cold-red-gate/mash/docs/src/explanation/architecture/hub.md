# The hub

The **hub** is a single process that owns the substrate.

- One `Semiotics` (the proof engine from `mash-math-proof-engine`).
- One Unix-domain socket (`.mash/sock` by default).
- One persistence root (`.mash/`).
- One kernel task, single writer, serializing every assertion.

Everything else — agents, ports, telnet listeners, shell workers —
is outside the hub and talks to it over the socket. The hub has no
business logic. Its job is: accept connections, route messages, run
the cascade, broadcast settlements, persist.

## Boot sequence

`mash-cli`'s `up` subcommand runs the boot. In order:

1. **Read the manifest** (`mash.toml`) to resolve which owner-agents
   and port subprocesses to host.
2. **Mount owner-agent claims.** For each vocab/scene in the manifest,
   call `agent.claims()` and assert each one into a fresh `Semiotics`
   at `Value::True`. This happens *before* replay: every subsequent
   assertion in the event log may rely on morphisms a vocab declared.
3. **Replay the event log.** `.mash/` is a journal of every
   externally-sourced assertion that was committed. Re-asserting each
   one rebuilds the cascade's current state.
4. **Bind the socket.** Remove any stale file at the socket path,
   create the parent directory if needed, bind a `UnixListener`.
5. **Spawn the kernel task** and the embedded-agent drivers. The
   kernel runs `Hub::run` on a single `mpsc` channel of `Cmd`s. Each
   embedded agent gets a low-numbered `SessionId` and its own driver
   task that forwards events from the kernel and witnesses back.
6. **Spawn the accept loop.** Incoming socket connections get
   `SessionId`s starting after the embedded range.
7. **Spawn port subprocesses** listed in the manifest. They connect
   over the socket like any other client.

## The kernel

`mash_hub::kernel::Hub` is the state machine. It owns the substrate
and a per-session table. All state mutation happens inside it.

Three commands drive the kernel:

- `Cmd::Connect { id, outbound }` — a session opened; remember its
  outbound channel.
- `Cmd::Message { id, msg }` — the session sent a wire message; act
  on it.
- `Cmd::Disconnect { id }` — session gone; drop its subscriptions.

The single-writer invariant is what the cascade's ≤2-step termination
guarantee relies on. Nothing outside the kernel touches the
substrate.

## Handshake

On `Message::Hello { agent, version, subscriptions }`:

1. Mint a session subject `s{id}`.
2. Assert `(s{id}, projects-through, agent)` — the session speaks
   by that driver.
3. Assert `(agent, has-version, version)`.
4. Send `Message::Welcome { session: "s{id}" }` *first*, so the
   client's handshake reader sees Welcome before any fiber replay
   events.
5. For each declared subscription, assert `(agent, driver, pred)`
   and register the session as a subscriber. Subscribing replays the
   fiber's current cells to the subscriber.

The handshake claims are session-local and not persisted: they
re-establish on reconnect.

## Assertion path

On `Message::Assert { subject, predicate, object }`:

1. Intern the three terms.
2. Cascade: `Semiotics::assert` returns a `SemiosisTrace` of every
   cell whose value changed.
3. Persist the commit (with its derivation witnesses) to the event
   log.
4. Broadcast each settled claim to every subscriber of that
   predicate as `Message::Event`.

Session-local assertions (the handshake) take the same path minus
persistence.

## Subscription

`Message::Subscribe { predicate }` registers the session under that
predicate and replays every existing fiber cell as an `Event` with an
empty derivation. Bundle-mounted cells live only in memory, so
without this replay a late-connecting agent would never see them.

## No query primitive

Earlier protocol drafts exposed a log-scan message so a subprocess
could ask the hub "give me every event matching these SPO filters."
That primitive is gone. Subscribe-and-accumulate is the whole read
discipline: every cell a projection needs arrives through its
subscriptions, and cross-fiber joins are the projection's own
in-state responsibility (typically an `object → set<subject>`
inverse index built up as cells land).

The reason is mathematical, not stylistic. The substrate is a
knowledge-monotone CRDT; its cells rise in ≤_k and never retract.
A snapshot-read from the log gives a projection information from a
moment already past — any decision it makes against that snapshot
races further settlements the cascade hasn't delivered to it yet.
The paper's fiber-functor framework has exactly three
morphism classes (specialization, inversion, composition) and none
of them are "scan the log"; a query primitive is an off-cascade
channel that cannot participate in the determinism guarantees the
cascade provides. Under Wiener / Barad, an observer is constituted
by its couplings, not by its reads — the port's subscription is
its coupling, the cascade's delivery is its perception, and
anything else is a detour through Shannon/Turing that the substrate
specifically rejects.

## Persistence

`mash_hub::persist::Persistence` locks `.mash/`, appends committed
assertions to an event log, and streams them back on replay. Only
externally-sourced assertions persist: session handshake claims and
cascade-derived claims do not. Derivation chains rebuild from the
cascade on replay.

## What the hub is not

- Not a database. It is an append-only journal + a live cascade.
- Not a transport. It is the kernel; transports are [conduit
  ports](port-roles.md).
- Not a scheduler. Agents decide when to witness; the hub responds.
