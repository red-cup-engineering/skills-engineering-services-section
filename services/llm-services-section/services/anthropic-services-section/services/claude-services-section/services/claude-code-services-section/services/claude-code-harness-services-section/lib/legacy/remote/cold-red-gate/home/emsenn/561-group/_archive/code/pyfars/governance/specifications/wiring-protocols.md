---
title: "Wiring protocols"
type: specification
status: draft
authors: [emsenn, claude-opus-4-7]
date: 2026-05-08
supersedes: []
---

# Wiring protocols

> **Status: draft (RFC).** Names the *protocol per wiring-kind* discipline — the captain's standing observation that different sorts of coupling between PyFARS components warrant different protocols.
> The substrate vocabulary already names *what* the wirings are ([port](../../concepts/port.md), [hook](../../concepts/hook.md), [wiring](../../concepts/wiring.md), [channel](../../objects/channel.md), [message](../../concepts/message.md), [subscription](../../concepts/subscription.md)); this specification names *how each wiring should be transported*.

## 1. Problem

PyFARS components couple to each other and to the world via many distinct wirings.
The CLI talks to a running engine.
An LLM agent talks to a polity-instance.
A webhook arrives from git.
Two polities federate.
A systemd supervisor manages a service.
Inside the engine, async services drive the polity forward.

A single transport for all of these would be wrong.
HTTP-everything is the AWS-services failure mode — gigantic per-call overhead for what should be a function call inside the same process; weak idiomatic match for tool-style LLM invocation; awkward shape for static configuration projections.
Function-calls-everywhere is the opposite failure mode — works in-process but doesn't cross address-space, doesn't survive process restarts, can't be authenticated.

The captain's diagnosis: each *wiring-kind* in the substrate vocabulary has different load-bearing properties (locality, frequency, semantics, authorship), and the right protocol per-wiring is the one that respects those properties.
This document fixes the per-wiring choice.

## 2. The wiring-protocol-discipline principle

For every cross-component act that materializes through a wiring, the protocol satisfies four conditions:

1. **Substrate-purity preserved.** Every cross-wiring act is witnessed in the polity's substrate (per [substrate purity](../decisions/substrate-purity.md) and [`witness`](../../concepts/witness.md)).
  The protocol does not bypass witness emission; if the act crosses a substrate boundary, the substrate records it.
2. **Authority-bounded.** The protocol carries (or arranges for) the authority-context of the act: who is doing what, under what office or principal, with what deontic profile.
  Auth flows naturally over the chosen protocol (HTTP can carry OAuth tokens; a Unix socket carries Unix uid/gid; in-process calls inherit caller authority).
3. **Replay-honest.** The protocol's witness is sufficient for replay: same input (witnesses, ruleset) yields same output (substrate state).
  External-state observations (HTTP responses from outside, signal arrivals) are recorded as observation-witnesses; the substrate replays the recorded observation, not the external system.
4. **Locality-respectful.** The protocol's overhead matches the locality of the wiring.
  In-process function calls cost nanoseconds; HTTP costs milliseconds; consensus costs seconds.
  A protocol that imposes wrong-locality costs is the bug.

Different wirings fail different conditions if forced into the wrong protocol.
Conditions 1–3 are *invariants*; condition 4 is *fit*.
The recommendations below pick the protocol that satisfies all four.

## 3. The wiring taxonomy

Eight wiring-kinds appear in current PyFARS.
Each is named with reference to the existing self-theory.

1. **Engine ↔ in-process service** — the engine's async tasks (web, MCP, future hook-receiver).
  Inside one process; one address space.
2. **Local CLI ↔ running engine** — a developer or operator runs `pyfars witness ...
  ` against a polity whose engine is currently running on the same host.
3. **Remote CLI / external client ↔ engine** — a CLI (or third-party client) on a different host invokes an operation on a polity-instance running elsewhere.
4. **LLM agent ↔ engine** — a frontier-model agent (Claude, etc.) invokes substrate operations as tool-calls during its reasoning loop.
5. **Inbound external event (hook)** — git pre-commit, IDE save events, webhooks, OS signals.
  External system fires; engine responds.
6. **Cross-polity federation** — two polities coordinate substrate state across a network boundary; bridge channels carry messages between their engines; bilattice consensus reconciles divergence.
7. **Polity ↔ host-OS supervisor** — systemd unit files (or launchd plists), the static configuration that makes services survive host reboot.
8. **External read clients (public)** — anonymous browsers, RSS readers, API consumers reading the polity's [public projection](../../concepts/public-projection.md) without authentication.

Each maps to one of three locality-classes: in-process, in-host, or cross-host.
The locality class is the first-order discriminator for the protocol choice.

## 4. Recommendations per wiring

### 4.1 Engine ↔ in-process service

**Protocol: direct async function calls.**

Same address space; coroutines on one event loop.
The [ServiceSupervisor](../../../src/pyfars/runtime/services.py) holds Service objects; the engine drives them via method calls and asyncio task management.
No serialization, no transport.
The witness is the engine's own emission; the service-call IS its execution.

**Rationale:** condition 4 (locality-respectful).
HTTP between engine and its own services would be absurd overhead for what is a function call.
A future split (multi-process engine) would change this; today's single-process engine doesn't need transport.

### 4.2 Local CLI ↔ running engine

**Protocol: HTTP/JSON over Unix Domain Socket at `<polity-root>/.pyfars/run.sock`.**

The engine binds an UDS for the same FastAPI app it serves over TCP.
The CLI walks `<cwd>` and ancestors looking for `.pyfars/run.sock`; if found, the CLI client makes HTTP requests against that socket; if absent, the CLI operates directly against the polity-image (read-shaped operations only — no engine running means no canonical state to transition).

**Rationale:**

- **HTTP** — reuses the FastAPI app already serving public projections, OpenAPI documentation, and write endpoints (when added).
  One handler implementation, two transports.
- **Over UDS** — locality-respectful (no TCP/IP stack overhead), authority-via-filesystem-permissions (the socket inherits Unix uid/gid; only authorized OS users can connect), and naturally encodes presence (file exists ⇔ engine is running and listening locally).
- **Walking-upward** — matches the `.pyfars/` discovery pattern already established for configured instances, without making `.pyfars/` mandatory for discovery.
  (`.pyfars/run.sock` is created on engine boot; absent means no engine running.)

### 4.3 Remote CLI / external client ↔ engine

**Protocol: HTTPS/JSON over TCP, OAuth-authenticated.**

The same FastAPI app served on a TCP port (binding governed by the polity's [website asset](../../../governance/assets/computing/web/pyfars-website/pyfars-website.md) `default-host` / `default-port`).
External clients authenticate via OAuth; their identity binds to a substrate `kind: external-principal` (now `kind: user-account`) record.

**Rationale:** standard HTTPS is the universal cross-host protocol.
OAuth Authorization Server is already wired into pyfars (Google federation; future custom providers).
The substrate-side discipline (every operation produces a witness; authorization is per-cell per-deontic-profile) is unchanged from the local-CLI case.

### 4.4 LLM agent ↔ engine

**Protocol: MCP (Model Context Protocol).**

MCP is specialized for the tool-call invocation pattern that frontier-model agents do natively.
PyFARS already exposes verbs as MCP tools via `pyfars mcp`.
This continues; new substrate-modifying operations get exposed as MCP tools alongside the existing read tools.

**Rationale:**

- **Idiomatic match** — LLMs invoke tools, not HTTP routes.
  MCP handles the tool-discovery, schema-typing, and call-result loop without the agent having to learn a custom HTTP API.
- **Already in flight** — `pyfars install-harness claude-code-mcp` is a working harness.
  Building on this is cheaper than redesigning.
- **Authority-clean** — MCP servers can require OAuth (the OAuth-protected MCP server is already in PyFARS); agents authenticate the same way external HTTP clients do.

MCP is *layered* — at the wire level it's typically JSON-RPC over WebSocket or stdio, depending on the deployment.
The substrate-side protocol is "tool invocation"; the wire transport varies.
PyFARS doesn't need to standardize on one MCP wire transport.

### 4.5 Inbound external event (hook)

**Protocol: HTTP POST to engine's hook endpoint, invoked by a thin shell shim.**

External systems (git, IDEs, webhook senders) invoke a small wrapper script.
The script POSTs the event payload to the engine's `/hooks/<hook-slug>` endpoint over UDS (if engine is local) or HTTPS (if remote).
The engine records an observation-witness recording the event and fires substrate-side triggers.

**Rationale:**

- **Two-step indirection** — most external systems can invoke a CLI command but cannot natively speak HTTP-to-engine.
  A shim script is the bridge.
- **Idempotent** — POSTs are retryable; idempotency keys (event IDs) let the engine deduplicate.
- **Substrate-witness on every hook** — preserves substrate-purity at the boundary (every external-event arrival is recorded as an observation, replayable).

The currently-installed git pre-commit hook (per `pyfars install-hooks`) follows this pattern: a shell script that invokes `pyfars hook-dispatch`, which today operates against the polity-image directly.
The migration path: hook-dispatch becomes an HTTP-POST to the running engine if one is up, falling back to direct image-modification if not.

### 4.6 Cross-polity federation

**Protocol: HTTPS/JSON over TCP, bridge-channel-shaped, with bilattice network-sheaf consensus.**

Each federating polity declares one or more *bridge channels* (per [`channel`](../../objects/channel.md) with an external-bridge configuration).
A message sent on a bridge channel materializes as an outbound HTTP POST to the peer polity's federation endpoint; an inbound message arrives as an HTTP POST and lands on the receiving polity's bridge channel as an event-witness.

For substrate-state convergence across polities, the upstream [predication-categories network-sheaf consensus](../../../../theories/theories/humanities/theories/math/theories/categories/theories/predication-categories/) is the discipline: each polity advances its own substrate independently; conflicts surface as bilattice $\top$-cells; consensus protocols (currently abstract) reconcile them.

**Rationale:**

- **HTTPS** — universal cross-network transport, encrypted, authenticated.
- **Bridge-channel-shaped** — cross-polity coordination is *messaging*, not RPC.
  The receiving polity is not "executing" the sender's request; it's receiving content and choosing what to do with it.
  The substrate-mediated channel pattern matches.
- **Consensus-aware** — naive HTTP would not handle the substrate-divergence-and-reconciliation problem.
  The bilattice approach already exists in the theory; the federation protocol composes through it rather than reinventing.

Federation is the most architecturally-deep wiring; full implementation is post-current-phase.
The protocol choice fixed here lets future work proceed without retrofitting.

### 4.7 Polity ↔ host-OS supervisor

**Protocol: declarative file projection — systemd unit files, launchd plists, container manifests.**

This is a [wiring](../../concepts/wiring.md) (the captain's term): a substrate-derived projection that the host system actively enacts.
The polity's substrate carries service-spec cells; the harness materializes those cells as host-readable files; the host's supervisor reads the files at boot and runs the services.

**Rationale:**

- **One-shot** — the host reads the unit file once at boot (or on reload).
  There's no live wire protocol; the file IS the protocol.
- **Standard host conventions** — systemd unit files, launchd plists, etc., are the native lingua franca.
  Supplying them lets the polity participate in host-OS lifecycle without inventing.
- **Re-projection-on-substrate-change** — when the substrate's service cells change, re-running `pyfars install-harness systemd-units` (or equivalent) re-materializes the wiring.
  Standard wiring discipline.

The pyfars harness already produces `pyfars-heartbeat.service` and `pyfars-mcp.service` units.
The pattern generalizes to any service the polity declares.

### 4.8 External read clients (public)

**Protocol: HTTPS/JSON or HTTPS/HTML, no authentication.**

The polity's [public projection](../../concepts/public-projection.md) is served over HTTPS by the same FastAPI app, with the discipline that response bodies derive only from the [public fiber](../../objects/public-fiber.md).
No auth required (it's *public*); rate-limiting and abuse-prevention happen at the transport layer.

**Rationale:** public projection is the base case of the view-composition pattern (per [public-projection](../../concepts/public-projection.md)).
No new protocol — same HTTPS as authenticated TCP, but the response-shape is constrained.

## 5. Composition

The eight wirings compose into a coherent surface.
Two patterns are load-bearing:

**Same FastAPI app, multiple transports.** One Python application object, served simultaneously over UDS (for local CLI), TCP (for remote CLI and external clients), and indirectly via MCP (for LLM agents).
The substrate-write paths are protocol-agnostic; transport is a binding decision, not a code-fork.

**Substrate-mediated cross-process communication.** When components in different processes need to coordinate, the substrate is the medium.
Process A writes a witness; process B reads it on its next pulse.
The transport between A's writer and the substrate is one of the wirings above (typically UDS for local, HTTPS for cross-host).
The substrate decouples them temporally — A doesn't need to know B is listening; B picks up the witness whenever it's quiescent enough to read.

## 6. Implementation order

1. **UDS-bound HTTP API** for the local CLI ↔ engine wiring.
  The engine on boot binds `<polity-root>/.pyfars/run.sock` carrying the existing FastAPI app.
  The CLI gains an instance-detection helper (presence of socket file) and forwards substrate-modifying operations to the local engine when one is running. **Highest priority** — most-used wiring, currently entirely absent.

2. **Engine write endpoints over the same FastAPI app.** Add routes for witness emission, intent queueing, dispatch, halt-request.
  These are reused over UDS and TCP simultaneously.

3. **Hook endpoint pattern** — generalize `pyfars hook-dispatch` to POST to the engine when one is running.
  Externalize the shim wrapping in `pyfars install-hooks`.

4. **MCP write tools** — surface substrate-modifying operations as MCP tools alongside the existing read tools.

5. **Bridge channels + federation** — substrate-side first (bridge-channel cells, federation-aware closure rules), wire-side later.

6. **Service supervision via systemd** — already exists; extend to cover the website asset's WebService rather than the current pyfars-heartbeat/pyfars-mcp pair.

## 7. What this specification does not yet decide

- **MCP wire transport.** PyFARS deploys MCP via stdio (Claude Code's SDK plugin) and via HTTP/SSE (claude-code-mcp).
  Whether the polity should standardize on one or stay polyglot is open.
- **Federation transport authentication.** OAuth between polities?
  Mutual TLS?
  Per-polity signing keys?
  The bilattice consensus needs identity but the identity-mechanism is open.
- **Shared MCP-and-HTTP authorization model.** Both currently authenticate via OAuth, but the deontic-profile-to-authority binding is implemented per-protocol.
  Unifying the binding (so an MCP-authenticated agent and an HTTP-authenticated client carry the same authority) is partly settled.
- **Compaction discipline** for the engine's UDS endpoint: should the engine round-trip large substrate-reads through HTTP, or expose a streaming protocol?
  Open; depends on first measurements.
- **Multi-engine federation** — can two engines bind to the same polity-image (active-active for high-availability)?
  Open territory; relevant once first single-engine deployment is stable.
