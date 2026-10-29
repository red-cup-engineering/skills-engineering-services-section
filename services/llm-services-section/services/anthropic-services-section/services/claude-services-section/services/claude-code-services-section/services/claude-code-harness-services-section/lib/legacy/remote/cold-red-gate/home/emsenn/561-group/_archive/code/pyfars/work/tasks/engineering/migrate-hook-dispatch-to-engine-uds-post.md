---
title: "Migrate hook-dispatch to engine UDS POST"
type: task
area: engineering
status: open
horizon: captured
milestone: m3-continuous-loop
goal: engine-runs-as-supervised-service
depends-on: [engine-runs-as-supervised-service]
requires-capabilities: [engine-development, uds-binding, http-server-development]
theory-basis: [substrate-purity, witness-as-increment]
---

# Migrate hook-dispatch to engine UDS POST

## Description

Per [`wiring-protocols`](../../../governance/specifications/wiring-protocols.md) §4.5, the inbound hook protocol's *target shape* is HTTP POST to the engine over a Unix-domain socket at `<polity-root>/.pyfars/run.sock`.
The current `pyfars hook-dispatch` verb (authored as part of [`claude-code-harness-properly-installed`](../../goals/claude-code-harness-properly-installed.md), see [`pyfars/cli/hook_dispatch.py`](../../../src/pyfars/cli/hook_dispatch.py)) writes the polity image directly: it loads the substrate hook record from disk, builds a `Witness`, and appends to the JSONL event log on its own.
This is the documented fallback per the spec — "today operates against the polity-image directly.
The migration path: hook-dispatch becomes an HTTP-POST to the running engine if one is up, falling back to direct image-modification if not."

This task migrates the verb to the target shape:

1. **Engine-side: the engine binds a UDS at `<root>/.pyfars/run.sock` and serves a hook-dispatch endpoint.** When the engine boots, the supervisor brings up an additional listener (alongside the HTTP web service and HTTP MCP service) at the socket path.
  Method: `POST /hook/dispatch` with body `{"hook_slug": "<slug>", "claude_payload": <object|str>}`.
  Returns 200 on successful witness append, 4xx on lookup failure, 5xx on internal error.
2. **CLI-side: `pyfars hook-dispatch <slug>` POSTs to the engine if the socket exists and is connectable.** Falls back to direct-image-modification (the current behaviour) if the socket is absent, the engine is not listening, or the POST times out.
  The fallback is silent in the success case; verbose only when the engine *should* have been there but wasn't (so an audit can spot the polity drifting from supervised mode).
3. **Witness lifecycle is unchanged at the substrate level.** Whether the witness is appended via direct write or via engine-mediated POST, the on-disk JSONL representation is identical.
  Auditors replaying the event log cannot distinguish the two paths — only the engine's own service-supervision telemetry tells operators which mode produced which witness, if either party cares.

## Why this matters

- **Concurrency safety.** When the engine is running its own tick loop and writing tick-witnesses to the event log, simultaneous direct-writes by hook-dispatch race against the engine's writer.
  POSIX append-line semantics save us in the single-writer case; under multi-writer they don't.
  UDS-routed hooks make the engine the sole writer.
- **Closure-rule integration.** The engine's tick fires closure rules over the latest event-log state.
  A hook-fired witness arriving via UDS POST is trivially in the engine's view by the next tick; a direct-write hook witness is only seen the next tick *if* the engine re-loads the log (or watches it).
  Routing through the engine collapses the integration window.
- **Substrate-rule-driven hook policy.** The engine has the substrate loaded into `pypredcalc.
  PredicationStore`; it can apply substrate rules to incoming hook payloads (rate-limit, capability check, audit) that a stateless CLI can't.
  The CLI fallback is correct but un-policy-able.

## Acceptance

- [ ] `pyfars run` brings up a UDS listener at `<root>/.pyfars/run.sock` exposing `POST /hook/dispatch`.
- [ ] `pyfars hook-dispatch <slug>` connects to that socket when present, POSTs the JSON body, and returns 0 on a 2xx response.
- [ ] When the socket is absent or unreachable, `pyfars hook-dispatch` falls back to direct image-write — same behaviour as today, no regression for unsupervised polities.
- [ ] On-disk witness representation is byte-identical between the two paths (audit cannot distinguish them).
- [ ] An emitted witness from a UDS-routed hook is visible to the engine's next tick's closure-rule evaluation (verified by a closure-rule test that fires on a known hook event).
- [ ] [`wiring-protocols`](../../../governance/specifications/wiring-protocols.md) §4.5 is updated: target-shape paragraph becomes the present-tense behaviour; the fallback is documented as a degraded mode for unsupervised polities, not the default.

## Out of scope

- The engine's own UDS supervision (when the socket gets stale, when permissions change, when multiple polities collide on `.pyfars/run.sock`).
  Tracked separately under [`engine-runs-as-supervised-service`](../../goals/engine-runs-as-supervised-service.md).
- TLS or auth on the UDS endpoint.
  The socket is loopback-and-permission-protected; bearer-token validation is the HTTP MCP service's concern, not the local hook channel's.
- An equivalent migration for any other harness's inbound channel.
  This task targets `claude-code-hooks` only; cline-workflows and other harnesses get sister tasks once their hook-paths are real.

## Origin

This task is the bookkeeping follow-on filed under [`file-followon-engine-uds-hook-endpoint-migration`](file-followon-engine-uds-hook-endpoint-migration.md), authored as part of [`claude-code-harness-properly-installed`](../../goals/claude-code-harness-properly-installed.md).
The current verb (under hook_dispatch.py) names the migration in its module docstring; this task is what that pointer resolves to.
