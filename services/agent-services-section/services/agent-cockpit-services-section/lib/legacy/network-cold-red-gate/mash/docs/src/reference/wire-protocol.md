# Wire protocol

Newline-delimited JSON over a Unix-domain socket. Types live in
`mash_math_inference::wire`. One `Message` per line; no framing
beyond the newline.

## Messages

### `Hello` (agent → hub)

```json
{"kind": "hello", "agent": "look-agent", "version": "0.1.0",
 "subscriptions": ["look-ready", "has-name"]}
```

First message after connect. The hub replies with `Welcome`.

### `Welcome` (hub → agent)

```json
{"kind": "welcome", "session": "s42"}
```

Handshake acknowledgment. `session` is the session subject the hub
minted; the agent can reference it in subsequent claims.

### `Assert` (either direction)

```json
{"kind": "assert", "subject": "alice", "predicate": "located-at",
 "object": "room:void"}
```

Witness a claim into the substrate. SPO only — the cascade assigns
`Value::True` on the kernel side. Nothing is returned.

### `Subscribe` (agent → hub)

```json
{"kind": "subscribe", "predicate": "some-predicate"}
```

Subscribe to settlements on `predicate`. On receipt the hub replays
every current cell in the fiber as an `Event` with an empty
derivation, then streams future settlements.

### `Event` (hub → agent)

```json
{"kind": "event",
 "claim": {"subject": "...", "predicate": "...", "object": "...",
           "value": "true", "timestamp": "2026-04-19T12:00:00Z"},
 "derivation": [{"via": "composition", "premises": [...]}]}
```

A matching cell settled. `derivation` is empty for directly-asserted
claims; one record per cascade step otherwise.

### `Error` (either direction)

```json
{"kind": "error", "code": "protocol", "message": "..."}
```

## Conventions

- `value` fields use lowercase names: `"none"`, `"true"`, `"false"`,
  `"both"`.
- Timestamps are ISO-8601 UTC with millisecond precision.
- Unknown fields cause `deny_unknown_fields` decode errors. Bump the
  schema rather than passing extra fields through.
- Client-to-hub messages that are server-origin (`Welcome`, `Event`)
  get rejected with a `protocol` error; same for the reverse.

## What isn't there

- **No read-by-triple.** Agents read by subscribing and caching the
  delivered events. The wire is settlement-oriented — every cell an
  agent needs arrives through a subscription, and cross-fiber joins
  are the agent's own in-state responsibility. There is no log-scan
  query primitive: asking the hub to fold history is an off-cascade
  snapshot read, and any decision a projection makes against it
  races the cascade's monotone flow. Subscribe-and-accumulate is
  the one discipline. See `explanation/architecture/hub.md`.
- **No explicit unsubscribe.** Disconnect is how a session gives up
  its subscriptions.
- **No back-pressure protocol.** Channels are unbounded; a slow
  reader can currently hold memory. A future revision will bound
  per-session queues.

## See also

- Source: `crates/mash-math-inference/src/wire.rs`.
- Client implementation: `crates/mash-sdk-client/src/lib.rs`.
- Server dispatch: `crates/mash-hub/src/conn.rs` and `kernel.rs`.
