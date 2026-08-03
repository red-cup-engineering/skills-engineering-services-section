# Writing a port

A **port** is a crate that moves information across a boundary. Each
port crate has exactly one role (sensor / actuator / responder /
effector / projection / conduit / coupler) and sits under
`mash-port-<role>-` accordingly.

This guide walks through three worked examples of increasing
complexity: a small actuator, a subscribe-and-render projection, and
a full-duplex conduit.

## 1. Pick a role

Walk the decision tree in
[Port roles](../explanation/architecture/port-roles.md). The role determines
everything else.

If two roles plausibly fit, your crate is doing two things; split
it.

## 2. Crate layout

### Minimal port (single binary)

```text
crates/mash-port-projection-mud-command-quit/
├── Cargo.toml
└── src/
    └── main.rs   # the whole port is one binary
```

### Multi-binary port (related behaviors)

```text
crates/mash-port-projection-mud-space/
├── Cargo.toml
├── src/
│   ├── lib.rs        # shared rendering/cache helpers
│   ├── render.rs
│   └── bin/
│       ├── look.rs   # the look-agent subprocess
│       └── room.rs   # the room-agent subprocess
└── tests/
    └── look_composition.rs
```

Two rules the taxonomy check enforces:

- Every port crate either defines an `Agent` impl in `lib.rs`
  (embedded port) OR has at least one `src/bin/` file or
  `src/main.rs` (subprocess port).
- **No port depends on another port.** If you think you need one,
  you don't: both sides subscribe to the substrate and coordinate
  there.

## 3. Example: the quit actuator

`mash-port-projection-mud-command-quit` is the reference one-binary
subprocess port. (In the target taxonomy it migrates to
`mash-port-actuator-mud-command-quit`; the pattern is the same.)

**Responsibility.** When the substrate settles `is-runnable-quit`,
find the session in the derivation, say "Goodbye." on its channel,
and witness `ended-at`. Then the telnet conduit and welcome
projection see the `ended-at` signal and clean up.

### The main loop

```rust,ignore
#[tokio::main]
async fn main() -> Result<()> {
    let client = ClientConfig {
        socket_path: /* from MASH_SOCKET env */,
        identity: "quit-agent".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        subscriptions: vec!["is-runnable-quit".to_owned()],
    };
    let mut connection = Connection::open(client).await?;
    let handle = connection.handle();

    while let Some(event) = connection.next_event().await {
        match event {
            InboundEvent::Settled { claim, derivation } => {
                if claim.predicate != "is-runnable-quit"
                    || claim.value != Value::True { continue; }
                let Some(step) = derivation.last() else { continue };
                let Some(session) = step
                    .find_premise("issued-by-session")
                    .map(|c| c.object.clone())
                    else { continue };
                say(&handle, &session, "Goodbye.");
                handle.witness(&session, "ended-at", &now_iso8601())?;
            }
            InboundEvent::Closed => break,
            _ => {}
        }
    }
    Ok(())
}
```

### Lessons

- **Read the derivation.** The `is-runnable-quit` claim by itself
  doesn't carry the session. The derivation's last step is the
  composition that fired, and one of its premises is
  `(request, issued-by-session, session)`. Walking the derivation
  chain is how ports find out *what* triggered the claim they
  subscribed to.
- **Don't parse the subject to find the session.** The derivation
  chain is the canonical path. Subject naming is opaque string
  interning and can change.
- **Witness, then continue.** The port emits claims (`ended-at`,
  plus `was-said-in` + `has-body` for the goodbye message) and
  returns to the loop. Downstream ports — the telnet conduit for
  the socket write, the welcome projection for cleanup — are
  separate and will each observe what they subscribe to.

## 4. Example: the look projection

`mash-port-projection-mud-space`'s `look` binary is the reference
projection: subscribe to several fibers, cache them locally, render
a derived claim back into the substrate.

### The cache

```rust,ignore
#[derive(Default)]
struct Cache {
    names:        HashMap<String, String>,
    descriptions: HashMap<String, String>,
    contents:     HashMap<String, HashSet<String>>,
}
```

The hub has no "give me the fiber" read message — agents read by
subscribing and caching. The cache holds `has-name`, `has-description`,
and `contains` cells keyed by subject. The projection updates it on
every matching `Event`.

This pattern is essentially *materialize a table by subscription*. If
the substrate has a fiber of 5,000 rooms, every agent that wants to
render a room name subscribes to `has-name` and keeps a 5,000-entry
map. The hub replays the fiber's current state on subscription, so
the cache is hot by the time the first real event arrives.

### The render

```rust,ignore
LOOK_READY => {
    if let Some(step) = derivation.last() {
        let target = step.find_premise("look-target").map(|c| c.object.clone());
        let _channel = step.find_premise("reports-to");
        if let Some(target) = target {
            handle_look(&cache, &handle, &claim.subject, &target);
        }
    }
}
```

On `look-ready`, pull the target and reports-to channel out of the
derivation's last premise set. Render the room description (name,
description, contents) from the cache. Emit the resulting text as a
`was-said-in` + `has-body` pair.

The telnet conduit, subscribed to `is-surface-ready` (which settles
via the composition `was-said-in ∧ has-body → is-surface-ready`),
picks up the body and writes it to the socket. The look projection
doesn't know about sockets at all.

### Lessons

- **Side-effecting ports return empty from `translate`.** If you
  want to spawn an external task, spawn it holding the `Witness`
  handle and return `Vec::new()` from `translate`. The emission
  happens when the task finishes. The look projection doesn't spawn
  — it renders synchronously — but the shell effector does.
- **`Mutex<Cache>` is fine.** A port is a single process and its
  event loop is serial. A mutex-guarded cache is straightforward
  and readable; don't over-engineer.
- **Filter on `Value::True`.** Many claims settle at `False` or
  `Both`. If your projection should only react to positive evidence,
  filter early.

## 5. Example: the telnet conduit

`mash-port-conduit-mud-telnet` is a full-duplex transport. It has a
listening TCP socket and bridges:

- TCP line in → substrate claim (`issued-by-session`, `verb-is-<v>`,
  `requested-arg`).
- Substrate `is-surface-ready` event → TCP line out.

### Session lifecycle

On TCP connect:

1. Mint a session subject `session:tcp:<peer>:<ns>`.
2. Witness `(session, is-newly-connected, true)`. The welcome
   projection observes that and mints a puppet + places it in a
   spawn room.
3. Read lines; tokenize into verb + optional argument; for each
   line, mint a request subject and emit
   `(request, issued-by-session, session)`,
   `(request, verb-is-<verb>, true)`,
   optional `(request, requested-arg, arg)`.
4. On socket EOF, witness `(session, ended-at, <timestamp>)` so
   other ports clean up.

### The read side

```rust,ignore
// Subscribe to is-surface-ready; when the was-said-in matches a
// session this process serves, write has-body to that socket.
let subs = vec![IS_SURFACE_READY.into()];
```

The conduit doesn't know what `is-surface-ready` *means* — that it's
derived from a composition, that other projections produce its
premises. It only knows: when I see this predicate on a session I
serve, write the body to the socket.

### Lessons

- **A conduit is thin.** The telnet binary has no domain vocabulary
  imports beyond `mash-vocab-comms` (for `is-surface-ready`) and its
  own `DEFAULT_PORT`. If you catch yourself importing
  `mash-vocab-mud-space` into a conduit, you are probably trying to
  make the conduit do projection work — split the crates.
- **Route by session.** A conduit typically serves many sessions on
  one process. Keep a map from session-subject to per-connection
  channels, and dispatch outbound messages by matching the subject.
- **Don't hold the witness for outbound.** Outbound writes are
  socket-level; they don't witness claims. Inbound reads do witness.

## 6. Build and mount

```toml
# Cargo.toml — minimal subprocess port
[package]
name = "mash-port-projection-mud-command-quit"
# ... workspace inheritance

[lints]
workspace = true

[[bin]]
name = "mash-port-projection-mud-command-quit"
path = "src/main.rs"

[dependencies]
mash-sdk-client   = { workspace = true }
mash-math-bilattice = { workspace = true }
mash-math-inference = { workspace = true }
anyhow            = { workspace = true }
tokio             = { workspace = true }
tracing           = { workspace = true }
tracing-subscriber = { workspace = true }
```

Mount by adding to `mash.toml`:

```toml
[[port]]
bin = "mash-port-projection-mud-command-quit"
```

`mash up` spawns the binary as a subprocess, passes it the
`MASH_SOCKET` env var, and the binary connects over the socket like
any other client.

## 7. Testing

Port crates carry integration tests under `tests/`:

```text
crates/mash-port-projection-mud-space/
└── tests/
    └── look_composition.rs
```

Tests drive a real `Semiotics` (from `mash-math-proof-engine`)
through its public API rather than mocking. The
[taxonomy check](../reference/taxonomy.md) and the `mash-testkit`
crate help — the latter has fixtures for the common patterns
(booting an in-memory hub, asserting a set of claims, waiting for a
settled predicate).
